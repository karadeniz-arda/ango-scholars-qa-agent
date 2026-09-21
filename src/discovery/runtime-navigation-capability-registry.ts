import { createHash } from "node:crypto";

import {
  findAuthoritativeParameterizedUiRouteTemplates,
} from "./ui-route-catalog.js";

import type {
  DeepRouteTemplate,
} from "../agents/browser/browser-deep-route-binding.js";
import type {
  PlannerRuntimeNavigationResolutionContract,
} from "../planner/types.js";

export type RuntimeNavigationResolverRegistration = {
  template: string;
  persona: "company_admin" | "talent";
  parameters: Array<{
    param: string;
    entityKind: string;
  }>;
  resolverRef: PlannerRuntimeNavigationResolutionContract["resolverRef"];
  resolverClassification: "AUTHENTICATED_READ_ONLY_DISCOVERY";
  resolverProvenance: PlannerRuntimeNavigationResolutionContract["resolverProvenance"];
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY";
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE";
  identityVerification: "REQUIRED";
  ownershipVerification: "REQUIRED";
  stateVerification: "WHEN_REQUIRED";
};

const resolverRegistrations: RuntimeNavigationResolverRegistration[] = [{
  template: "/talent/contracts/:contractId",
  persona: "talent",
  parameters: [{ param: "contractId", entityKind: "contract" }],
  resolverRef: "talent-contract-detail-readonly-v1",
  resolverClassification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
  resolverProvenance: {
    module: "src/agents/browser/browser-route-talent-contract.ts",
    exportName: "resolveTalentContractDetailRoute",
  },
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
  identityVerification: "REQUIRED",
  ownershipVerification: "REQUIRED",
  stateVerification: "WHEN_REQUIRED",
}];

export type RuntimeNavigationCapabilityDiscovery =
  | {
      status: "AVAILABLE";
      capability: PlannerRuntimeNavigationResolutionContract;
    }
  | {
      status: "UNAVAILABLE" | "AMBIGUOUS" | "CONFLICT";
      reason: string;
    };

function sameParameters(
  left: Array<{ param: string; entityKind: string }>,
  right: Array<{ param: string; entityKind: string }>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function capabilityId(
  template: DeepRouteTemplate,
  registration: RuntimeNavigationResolverRegistration
): string {
  const digest = createHash("sha256")
    .update([
      template.template,
      template.persona,
      template.sourceOrigin,
      template.sourceRef ?? "",
      registration.resolverRef,
      JSON.stringify(registration.parameters),
    ].join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  return `runtime-navigation-capability-${digest}`;
}

export function selectRuntimeNavigationCapability(args: {
  templates: DeepRouteTemplate[];
  registrations?: RuntimeNavigationResolverRegistration[];
  candidatePersona?: "company_admin" | "talent";
}): RuntimeNavigationCapabilityDiscovery {
  const templates = args.candidatePersona
    ? args.templates.filter((template) => template.persona === args.candidatePersona)
    : args.templates;
  if (templates.length === 0) {
    return {
      status: args.templates.length > 0 ? "CONFLICT" : "UNAVAILABLE",
      reason: args.templates.length > 0
        ? "The proposed execution persona conflicts with the authoritative route-template persona."
        : "No authoritative parameterized route template matches the grounded target surface.",
    };
  }
  if (templates.length !== 1) {
    return {
      status: "AMBIGUOUS",
      reason: "Multiple authoritative parameterized route templates match the grounded target surface.",
    };
  }

  const template = templates[0]!;
  if (args.candidatePersona && args.candidatePersona !== template.persona) {
    return {
      status: "CONFLICT",
      reason: "The proposed execution persona conflicts with the authoritative route-template persona.",
    };
  }
  const registrations = (args.registrations ?? resolverRegistrations)
    .filter((registration) =>
      registration.template === template.template &&
      registration.persona === template.persona &&
      sameParameters(registration.parameters, template.requiredBindings)
    );
  if (registrations.length !== 1) {
    return {
      status: registrations.length === 0 ? "UNAVAILABLE" : "AMBIGUOUS",
      reason: registrations.length === 0
        ? "No registered fail-closed runtime resolver matches the authoritative route template."
        : "Multiple runtime resolvers match the same authoritative route template.",
    };
  }

  const registration = registrations[0]!;
  return {
    status: "AVAILABLE",
    capability: {
      capabilityId: capabilityId(template, registration),
      status: "RUNTIME_NAVIGATION_RESOLUTION_REQUIRED",
      template: template.template,
      templateSourceOrigin: "UI_ROUTE_MANIFEST",
      ...(template.sourceRef ? { templateSourceRef: template.sourceRef } : {}),
      persona: template.persona,
      parameters: registration.parameters.map((parameter) => ({ ...parameter })),
      resolverRef: registration.resolverRef,
      resolverClassification: registration.resolverClassification,
      resolverProvenance: { ...registration.resolverProvenance },
      selectionPolicy: registration.selectionPolicy,
      ambiguityPolicy: registration.ambiguityPolicy,
      identityVerification: registration.identityVerification,
      ownershipVerification: registration.ownershipVerification,
      stateVerification: registration.stateVerification,
      runtimeIdentity: "NOT_YET_RESOLVED",
      navigationReadyForExecution: false,
    },
  };
}

export function discoverRuntimeNavigationCapability(args: {
  targetSurface: string;
  sourcePersona?: "company_admin" | "talent";
  candidatePersona?: "company_admin" | "talent";
}): RuntimeNavigationCapabilityDiscovery {
  if (args.sourcePersona && args.candidatePersona && args.sourcePersona !== args.candidatePersona) {
    return { status: "CONFLICT", reason: "The proposed execution persona conflicts with the authoritative source persona." };
  }
  return selectRuntimeNavigationCapability({
    templates: findAuthoritativeParameterizedUiRouteTemplates({
      surface: args.targetSurface,
      ...(args.sourcePersona || args.candidatePersona
        ? { persona: args.sourcePersona ?? args.candidatePersona }
        : {}),
    }),
    ...(args.candidatePersona ? { candidatePersona: args.candidatePersona } : {}),
  });
}
