import type {
  BrowserObservation,
  BrowserObservationControl,
} from "./browser-observation.js";

import type {
  BrowserShadowProposal,
} from "./browser-agent-shadow.js";

export type BrowserShadowEvaluationStatus =
  | "SAFE_TO_EXECUTE"
  | "ALREADY_SATISFIED"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT"
  | "UNSUPPORTED_ACTION"
  | "TARGET_NOT_GROUNDED"
  | "TARGET_DISABLED"
  | "MUTATION_RISK"
  | "EXTERNAL_NAVIGATION";

export type BrowserShadowMatchedTarget = {
  source:
    | "control"
    | "heading"
    | "surface"
    | "visibleText"
    | "route";
  label: string;
  kind?: string;
};

export type BrowserShadowProposalEvaluation = {
  status: BrowserShadowEvaluationStatus;
  safeToExecute: boolean;
  grounded: boolean;
  reason: string;
  matchedTarget?: BrowserShadowMatchedTarget;
};

export type EvaluateBrowserShadowProposalArgs = {
  proposal: BrowserShadowProposal;
  observation: BrowserObservation;
};

const MUTATION_RISK_LABEL =
  /\b(?:add|create|save|submit|delete|remove|approve|reject|publish|send|invite|upload|pay|checkout|confirm|apply)\b/i;

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findExactControl(
  observation: BrowserObservation,
  target: string
): BrowserObservationControl | null {
  const normalizedTarget =
    normalize(target);

  return (
    observation.controls.find(
      (control) =>
        normalize(control.label) ===
        normalizedTarget
    ) ?? null
  );
}

function findVisibleTarget(
  observation: BrowserObservation,
  target: string
): BrowserShadowMatchedTarget | null {
  const control =
    findExactControl(
      observation,
      target
    );

  if (control) {
    return {
      source: "control",
      label: control.label,
      kind: control.kind,
    };
  }

  const normalizedTarget =
    normalize(target);

  const heading =
    observation.headings.find(
      (value) =>
        normalize(value) ===
        normalizedTarget
    );

  if (heading) {
    return {
      source: "heading",
      label: heading,
    };
  }

  const surface =
    observation.surfaces.find(
      (value) =>
        normalize(value.label) ===
          normalizedTarget ||
        normalize(value.textPreview) ===
          normalizedTarget
    );

  if (surface) {
    return {
      source: "surface",
      label:
        surface.label ||
        surface.textPreview,
      kind: surface.kind,
    };
  }

  const visibleText =
    observation.visibleText.find(
      (value) =>
        normalize(value) ===
        normalizedTarget
    );

  if (visibleText) {
    return {
      source: "visibleText",
      label: visibleText,
    };
  }

  return null;
}

function evaluateInternalNavigation(
  target: string
): BrowserShadowProposalEvaluation {
  const normalized =
    target.trim();

  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//")
  ) {
    return {
      status: "EXTERNAL_NAVIGATION",
      safeToExecute: false,
      grounded: false,
      reason:
        "Only concrete same-application routes beginning with a single slash are eligible.",
    };
  }

  if (
    normalized.toUpperCase().startsWith(
      "UNKNOWN"
    ) ||
    /^(?:javascript|data):/i.test(
      normalized
    )
  ) {
    return {
      status: "EXTERNAL_NAVIGATION",
      safeToExecute: false,
      grounded: false,
      reason:
        "The proposed navigation target is not a safe internal route.",
    };
  }

  return {
    status: "SAFE_TO_EXECUTE",
    safeToExecute: true,
    grounded: true,
    reason:
      "The proposal is a concrete internal navigation route.",
    matchedTarget: {
      source: "route",
      label: normalized,
      kind: "navigate",
    },
  };
}

export function evaluateBrowserShadowProposal(
  args: EvaluateBrowserShadowProposalArgs
): BrowserShadowProposalEvaluation {
  const {
    proposal,
    observation,
  } = args;

  if (
    proposal.decision ===
    "GOAL_ALREADY_SATISFIED"
  ) {
    return {
      status: "ALREADY_SATISFIED",
      safeToExecute: false,
      grounded: true,
      reason:
        "The proposal reports that no further action is required.",
    };
  }

  if (
    proposal.decision ===
    "NO_SAFE_ACTION"
  ) {
    return {
      status: "NO_SAFE_ACTION",
      safeToExecute: false,
      grounded: true,
      reason:
        "The proposal explicitly declined to recommend an executable action.",
    };
  }

  if (
    proposal.decision ===
    "NEEDS_MORE_CONTEXT"
  ) {
    return {
      status: "NEEDS_MORE_CONTEXT",
      safeToExecute: false,
      grounded: false,
      reason:
        "The proposal requires more context before any action can be considered.",
    };
  }

  const action =
    proposal.action;

  if (!action) {
    return {
      status: "UNSUPPORTED_ACTION",
      safeToExecute: false,
      grounded: false,
      reason:
        "The proposal decision requires an action object.",
    };
  }

  if (
    proposal.decision ===
      "PROPOSE_ROUTE" ||
    action.kind === "navigate"
  ) {
    return evaluateInternalNavigation(
      action.target
    );
  }

  if (
    action.kind === "fill"
  ) {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: false,
      reason:
        "Form input is not eligible for the first read-only execution phase.",
    };
  }

  if (
    action.kind === "observe"
  ) {
    return {
      status: "SAFE_TO_EXECUTE",
      safeToExecute: true,
      grounded: true,
      reason:
        "A repeated observation is read-only and does not modify application state.",
    };
  }

  if (
    action.kind !== "click" &&
    action.kind !== "select" &&
    action.kind !== "assert"
  ) {
    return {
      status: "UNSUPPORTED_ACTION",
      safeToExecute: false,
      grounded: false,
      reason:
        `Action kind "${action.kind}" is not supported by the current evaluator.`,
    };
  }

  const matchedTarget =
    findVisibleTarget(
      observation,
      action.target
    );

  if (!matchedTarget) {
    return {
      status: "TARGET_NOT_GROUNDED",
      safeToExecute: false,
      grounded: false,
      reason:
        "The exact proposed target was not found in the current browser observation.",
    };
  }

  if (
    action.kind === "assert"
  ) {
    return {
      status: "SAFE_TO_EXECUTE",
      safeToExecute: true,
      grounded: true,
      reason:
        "The assertion target is present in the current observation.",
      matchedTarget,
    };
  }

  if (
    MUTATION_RISK_LABEL.test(
      action.target
    )
  ) {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: true,
      reason:
        "The target label indicates a potentially mutating or consequential operation.",
      matchedTarget,
    };
  }

  if (
    matchedTarget.source !==
    "control"
  ) {
    return {
      status: "TARGET_NOT_GROUNDED",
      safeToExecute: false,
      grounded: true,
      reason:
        "Interactive actions require an exact semantic control match.",
      matchedTarget,
    };
  }

  const control =
    findExactControl(
      observation,
      action.target
    );

  if (!control) {
    return {
      status: "TARGET_NOT_GROUNDED",
      safeToExecute: false,
      grounded: false,
      reason:
        "The proposed interactive target could not be resolved to a control.",
    };
  }

  if (control.disabled) {
    return {
      status: "TARGET_DISABLED",
      safeToExecute: false,
      grounded: true,
      reason:
        "The proposed control is currently disabled.",
      matchedTarget,
    };
  }

  return {
    status: "SAFE_TO_EXECUTE",
    safeToExecute: true,
    grounded: true,
    reason:
      "The proposal exactly matches an enabled semantic control and has no mutation-risk label.",
    matchedTarget,
  };
}
