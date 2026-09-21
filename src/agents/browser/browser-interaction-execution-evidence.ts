import type {
  BrowserInteractionExecutionEvidence,
  BrowserStep,
} from "./browser-execution-types.js";

type BuildSuccessfulInteractionEvidenceArgs = {
  stepIndex: number;
  step: BrowserStep;
  note: string;
};

export function buildSuccessfulInteractionEvidence({
  stepIndex,
  step,
  note,
}: BuildSuccessfulInteractionEvidenceArgs):
  | BrowserInteractionExecutionEvidence
  | undefined {
  if (
    step.action !== "clickButton" &&
    step.action !== "clickText" &&
    !(
      step.action ===
        "selectRuntimeFilterOption" &&
      step.verification ===
        "visible-state"
    )
  ) {
    return undefined;
  }

  const interactionId =
    String(
      step.interactionId || ""
    ).trim();

  if (!interactionId) {
    return undefined;
  }

  return {
    stepIndex,
    interactionId,
    action: step.action,
    succeeded: true,
    note,
  };
}
