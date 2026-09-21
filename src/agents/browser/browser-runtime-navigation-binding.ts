import type {
  PlannerRuntimeNavigationResolutionContract,
  RuntimeNavigationBinding,
} from "../../planner/types.js";
import type {
  DeepRouteBindingResult,
  DeepRouteEntityRequirement,
} from "./browser-deep-route-binding.js";

function sameStateValue(
  left: string | number | boolean | null | undefined,
  right: string | number | boolean | null
): boolean {
  return left === right;
}

/**
 * Converts an existing verified deep-route resolution into the durable runtime
 * contract. It does not discover candidates and cannot turn planner metadata
 * into a concrete route on its own.
 */
export function createRuntimeNavigationBinding(args: {
  executionCaseId: string;
  capability: PlannerRuntimeNavigationResolutionContract;
  resolution: DeepRouteBindingResult;
  requirements: DeepRouteEntityRequirement[];
  resolvedAt: string;
  evidenceReference: string;
}): RuntimeNavigationBinding | undefined {
  const bound = args.resolution.status === "RESOLVED"
    ? args.resolution.boundRoute
    : undefined;
  if (
    !bound ||
    bound.template !== args.capability.template ||
    args.capability.runtimeIdentity !== "NOT_YET_RESOLVED" ||
    args.capability.navigationReadyForExecution !== false ||
    bound.provenance.templateOrigin !== args.capability.templateSourceOrigin ||
    (args.capability.templateSourceRef &&
      bound.provenance.templateSourceRef !== args.capability.templateSourceRef)
  ) {
    return undefined;
  }

  const requirementByParam = new Map(
    args.requirements.map((requirement) => [requirement.param, requirement])
  );
  const identityByParam = new Map(
    bound.provenance.identities.map((identity) => [identity.param, identity])
  );
  if (
    requirementByParam.size !== args.capability.parameters.length ||
    identityByParam.size !== args.capability.parameters.length
  ) {
    return undefined;
  }

  let ownershipRequired = false;
  let stateRequired = false;
  for (const parameter of args.capability.parameters) {
    const requirement = requirementByParam.get(parameter.param);
    const identity = identityByParam.get(parameter.param);
    if (
      !requirement ||
      !identity ||
      requirement.entityKind !== parameter.entityKind ||
      identity.entityKind !== parameter.entityKind ||
      identity.identityVerified !== true ||
      identity.source === "MODEL_PROPOSAL" ||
      bound.bindings[parameter.param] !== identity.entityId
    ) {
      return undefined;
    }
    if (requirement.requiresOwnershipVerification) {
      ownershipRequired = true;
      if (identity.ownershipVerified !== true) return undefined;
    }
    if (requirement.requiredState) {
      stateRequired = true;
      const keys = Object.keys(requirement.requiredState);
      if (!keys.every((key) =>
        identity.verifiedStateKeys?.includes(key) &&
        sameStateValue(identity.verifiedState?.[key], requirement.requiredState![key]!)
      )) {
        return undefined;
      }
    }
  }

  return {
    status: "RESOLVED",
    navigationReadyForExecution: true,
    executionCaseId: args.executionCaseId,
    template: bound.template,
    concreteRoute: bound.route,
    selectedIdentityReferences: args.capability.parameters.map((parameter) => {
      const identity = identityByParam.get(parameter.param)!;
      return {
        param: parameter.param,
        entityKind: parameter.entityKind,
        identityRef: identity.entityId,
        source: identity.source as RuntimeNavigationBinding[
          "selectedIdentityReferences"
        ][number]["source"],
      };
    }),
    persona: args.capability.persona,
    resolverRef: args.capability.resolverRef,
    ownershipVerification: ownershipRequired ? "VERIFIED" : "NOT_REQUIRED",
    stateVerification: stateRequired ? "VERIFIED" : "NOT_REQUIRED",
    resolvedAt: args.resolvedAt,
    evidenceReference: args.evidenceReference,
  };
}
