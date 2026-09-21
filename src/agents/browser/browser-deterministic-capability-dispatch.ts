import type {
  BrowserAcceptanceScope,
  BrowserLocalControlStateTransitionRequirement,
} from "../../planner/types.js";
import type {
  BrowserGroundedLocalStateTransitionEvidence,
} from "./browser-local-state-transition-proof.js";

export type BrowserDeterministicCapabilityKind =
  BrowserGroundedLocalStateTransitionEvidence["kind"];

export type BrowserCapabilityDispatchCandidate = {
  caseId: string;
  requirementId: string;
  obligationId: string;
  requirementKind:
    "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT";
  capabilityKind:
    BrowserDeterministicCapabilityKind;
  requirement:
    BrowserLocalControlStateTransitionRequirement;
};

export type BrowserCapabilityDispatchDecision =
  | {
      status: "MATCHED";
      candidate:
        BrowserCapabilityDispatchCandidate;
      note: string;
    }
  | {
      status: "NO_CAPABILITY_MATCH";
      note: string;
    }
  | {
      status:
        "AMBIGUOUS_CAPABILITY_DISPATCH";
      matchingRequirementIds: string[];
      note: string;
    };

export type DispatchBrowserDeterministicCapabilityArgs = {
  caseId: string;
  obligationId: string;
  acceptanceScope:
    BrowserAcceptanceScope | undefined;
};

const localStateDescriptor = {
  requirementKind:
    "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
  capabilityKind:
    "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
} as const satisfies {
  requirementKind:
    BrowserLocalControlStateTransitionRequirement["kind"];
  capabilityKind:
    BrowserDeterministicCapabilityKind;
};

function nonEmpty(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isAuthorizedLocalStateRequirement(
  value: unknown
): value is BrowserLocalControlStateTransitionRequirement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const requirement = value as Partial<
    BrowserLocalControlStateTransitionRequirement
  >;
  const sourceRefs = requirement.sourceRefs;
  const structuralBinding =
    requirement.structuralBinding;

  return (
    requirement.kind ===
      localStateDescriptor.requirementKind &&
    nonEmpty(requirement.requirementId) &&
    nonEmpty(requirement.obligationId) &&
    Array.isArray(sourceRefs) &&
    sourceRefs.length > 0 &&
    sourceRefs.every(
      (sourceRef) =>
        nonEmpty(sourceRef.sourceUnitId) &&
        nonEmpty(sourceRef.sourceRef) &&
        sourceRef.sourceRole === "ACCEPTANCE"
    ) &&
    requirement.authority?.sourceRole ===
      "ACCEPTANCE" &&
    requirement.authority?.proofAuthority ===
      "ACCEPTANCE" &&
    requirement.transition?.semantic ===
      "RESET_RESTORES_DEFAULT" &&
    Number.isFinite(
      requirement.transition?.expectedValue
    ) &&
    requirement.transition
      ?.expectedValueAuthority ===
      "JIRA_AUTHORIZED" &&
    Array.isArray(
      structuralBinding?.sourceEvidenceRefs
    ) &&
    structuralBinding.sourceEvidenceRefs.length >
      0 &&
    structuralBinding.sourceEvidenceRefs.every(
      nonEmpty
    ) &&
    structuralBinding.valueBinding
      ?.evidenceKind ===
      "LABELLED_DEFAULT_PROPERTY" &&
    nonEmpty(
      structuralBinding.valueBinding.sourceLabel
    ) &&
    nonEmpty(
      structuralBinding.valueBinding.sourceProperty
    )
  );
}

/**
 * Pure P0.2 dispatch. A match identifies only which deterministic capability
 * corresponds to one exact authoritative requirement. It does not establish
 * runtime prerequisites, ownership, execution, evidence, or a verdict.
 */
export function dispatchBrowserDeterministicCapability(
  args: DispatchBrowserDeterministicCapabilityArgs
): BrowserCapabilityDispatchDecision {
  if (
    !nonEmpty(args.caseId) ||
    !nonEmpty(args.obligationId)
  ) {
    return {
      status: "NO_CAPABILITY_MATCH",
      note:
        "Capability dispatch requires exact non-empty case and obligation identities.",
    };
  }

  const requirements = Array.isArray(
    args.acceptanceScope
      ?.localControlStateTransitionRequirements
  )
    ? args.acceptanceScope
        .localControlStateTransitionRequirements
    : [];
  const matchingRequirements = requirements.filter(
    (requirement) =>
      isAuthorizedLocalStateRequirement(
        requirement
      ) &&
      requirement.obligationId ===
        args.obligationId
  );

  if (matchingRequirements.length === 0) {
    return {
      status: "NO_CAPABILITY_MATCH",
      note:
        "No exact typed source-authorized requirement matches the requested obligation scope.",
    };
  }

  if (matchingRequirements.length !== 1) {
    return {
      status:
        "AMBIGUOUS_CAPABILITY_DISPATCH",
      matchingRequirementIds:
        matchingRequirements
          .map(
            (requirement) =>
              requirement.requirementId
          )
          .sort(),
      note:
        "More than one typed requirement matches the requested obligation scope; dispatch abstained without selecting by array order.",
    };
  }

  const requirement =
    matchingRequirements[0]!;

  return {
    status: "MATCHED",
    candidate: {
      caseId: args.caseId,
      requirementId:
        requirement.requirementId,
      obligationId:
        requirement.obligationId,
      requirementKind: requirement.kind,
      capabilityKind:
        localStateDescriptor.capabilityKind,
      requirement,
    },
    note:
      "The exact typed requirement maps to the grounded local-control state-transition capability; runtime prerequisites remain unevaluated.",
  };
}
