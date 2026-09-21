import type {
  SelectedStateRequirement,
} from "../../planner/types.js";

import type {
  BrowserInteractionExecutionEvidence,
} from "./browser-execution-types.js";

import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";

type SelectedStateSatisfactionInput = {
  requirement:
    SelectedStateRequirement;

  interactionExecutionEvidence:
    BrowserInteractionExecutionEvidence[];

  deterministicEvidence:
    BrowserDeterministicEvidence[];
};

export function isSelectedStateRequirementSatisfied({
  requirement,
  interactionExecutionEvidence,
  deterministicEvidence,
}: SelectedStateSatisfactionInput): boolean {
  const interactionSatisfied =
    interactionExecutionEvidence.some(
      (evidence) =>
        evidence.interactionId ===
          requirement.interactionId &&
        evidence.action ===
          "selectRuntimeFilterOption" &&
        evidence.succeeded === true
    );

  if (!interactionSatisfied) {
    return false;
  }

  return deterministicEvidence.some(
    (evidence) =>
      evidence.oracleId ===
        requirement.selectionOracleId &&
      evidence.action ===
        "selectRuntimeFilterOption" &&
      evidence.verificationMode ===
        "visible-state" &&
      evidence.passed === true
  );
}
