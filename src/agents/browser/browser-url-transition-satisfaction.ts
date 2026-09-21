import type {
  UrlTransitionRequirement,
} from "../../planner/types.js";

import type {
  BrowserInteractionExecutionEvidence,
} from "./browser-execution-types.js";

import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";

type UrlTransitionSatisfactionInput = {
  requirement:
    UrlTransitionRequirement;

  interactionExecutionEvidence:
    BrowserInteractionExecutionEvidence[];

  deterministicEvidence:
    BrowserDeterministicEvidence[];
};

export function isUrlTransitionRequirementSatisfied({
  requirement,
  interactionExecutionEvidence,
  deterministicEvidence,
}: UrlTransitionSatisfactionInput): boolean {
  const interactionSatisfied =
    interactionExecutionEvidence.some(
      (evidence) =>
        evidence.interactionId ===
          requirement.interactionId &&
        evidence.succeeded === true
    );

  if (!interactionSatisfied) {
    return false;
  }

  const urlAssertionSatisfied =
    deterministicEvidence.some(
      (evidence) =>
        evidence.oracleId ===
          requirement.urlAssertionOracleId &&
        evidence.action ===
          "assertUrlContains" &&
        evidence.passed === true
    );

  return urlAssertionSatisfied;
}