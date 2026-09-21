import {
  browserMutationsAllowed,
} from "./browser-mutation-policy.js";

import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";

import type {
  BrowserObservation,
  BrowserObservationControl,
  BrowserObservationInput,
} from "./browser-observation.js";

import type {
  BrowserShadowProposal,
} from "./browser-agent-shadow.js";
import type {
  PlannerRuntimeTargetGroundingContract,
} from "../../planner/types.js";

export type BrowserShadowEvaluationStatus =
  | "SAFE_TO_EXECUTE"
  | "ALREADY_SATISFIED"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT"
  | "UNSUPPORTED_ACTION"
  | "TARGET_NOT_GROUNDED"
  | "TARGET_DISABLED"
  | "MUTATION_RISK"
  | "EXTERNAL_NAVIGATION"
  | "BLOCKED";

export type BrowserShadowMatchedTarget = {
  source:
    | "control"
    | "input"
    | "heading"
    | "surface"
    | "visibleText"
    | "route";
  label: string;
  kind?: string;
  contextText?: string;
  externalPopup?: boolean;
  semanticOptionBinding?: boolean;
};

export type BrowserShadowContextTargetResolution = {
  resolved: boolean;
  reason: string;
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
  contextTargetResolution?:
    BrowserShadowContextTargetResolution;
};

export type EvaluateRuntimeDeferredTargetProposalArgs =
  EvaluateBrowserShadowProposalArgs & {
    contract: PlannerRuntimeTargetGroundingContract;
    actualPersona: "company_admin" | "talent";
  };

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findExactControls(
  observation: BrowserObservation,
  target: string
): BrowserObservationControl[] {
  const normalizedTarget =
    normalize(target);

  return observation.controls.filter(
    (control) =>
      normalize(control.label) ===
      normalizedTarget
  );
}

function findExactControl(
  observation: BrowserObservation,
  target: string
): BrowserObservationControl | null {
  return (
    findExactControls(
      observation,
      target
    )[0] ?? null
  );
}

function findExactInputs(
  observation: BrowserObservation,
  target: string
): BrowserObservationInput[] {
  const normalizedTarget =
    normalize(target);

  return observation.inputs.filter(
    (input) =>
      normalize(input.label) ===
      normalizedTarget
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
      ...(
        control.externalPopup === true
          ? { externalPopup: true }
          : {}
      ),
      ...(
        control.semanticOptionBinding ===
          true
          ? {
              semanticOptionBinding:
                true,
            }
          : {}
      ),
    };
  }

  const input =
    findExactInputs(
      observation,
      target
    )[0];

  if (input) {
    return {
      source: "input",
      label: input.label,
      kind: input.role,
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
    contextTargetResolution,
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

  /*
   * GENERIC_BROWSER_BOUND_OPTION_LEXICAL_POLICY_V1
   *
   * Consequence-bearing words such as "publish" normally remain
   * blocked by the lexical mutation guard.
   *
   * A uniquely grounded semantic option binding is different: its
   * provenance establishes that the observed target is a transient
   * selection option, not a same-label consequential command.
   *
   * Bypass the lexical label guard only for an exact click on that
   * proven option provenance and only with explicit browser mutation
   * permission. Ordinary buttons/controls and action.kind="select"
   * retain their existing safety boundaries.
   */
  /*
   * GENERIC_BROWSER_DETERMINISTIC_SAFETY_EVALUATOR_V1
   *
   * Semantic effect classification is deterministic and independent
   * from authorization. Existing permission/provenance gates below
   * remain authoritative.
   *
   * Inputs are classified later because activationSafe is available
   * only after exact input resolution.
   */
  const controlSafetyClass =
    matchedTarget.source === "control"
      ? classifyGenericBrowserActionSafety({
          actionKind: action.kind,
          targetSource: "control",
          label: action.target,
          ...(
            matchedTarget.kind !==
            undefined
              ? {
                  targetKind:
                    matchedTarget.kind,
                }
              : {}
          ),
          ...(
            matchedTarget.externalPopup !==
            undefined
              ? {
                  externalPopup:
                    matchedTarget.externalPopup,
                }
              : {}
          ),
          ...(
            matchedTarget.semanticOptionBinding !==
            undefined
              ? {
                  semanticOptionBinding:
                    matchedTarget
                      .semanticOptionBinding,
                }
              : {}
          ),
        })
      : null;

  const authorizedSemanticOptionClick =
    action.kind === "click" &&
    matchedTarget.source === "control" &&
    matchedTarget.kind === "option" &&
    matchedTarget.semanticOptionBinding ===
      true &&
    browserMutationsAllowed();

  if (
    controlSafetyClass ===
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
  ) {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: true,
      reason:
        "The deterministic action-safety classifier identified a persisted or consequential control action.",
      matchedTarget,
    };
  }

  if (action.kind === "select") {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: true,
      reason:
        "Selecting a value changes form state and is outside the read-only execution phase.",
      matchedTarget,
    };
  }

  if (
    controlSafetyClass ===
      "TRANSIENT_VALUE_CHANGE" &&
    action.kind === "click" &&
    matchedTarget.source === "control" &&
    matchedTarget.externalPopup === true &&
    !browserMutationsAllowed()
  ) {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: true,
      reason:
        "Activating a control exposed through an external popup may change transient or form selection state; browser mutation permission is disabled.",
      matchedTarget,
    };
  }

  /*
   * GENERIC_BROWSER_BOUND_OPTION_AUTHORIZATION_V1
   *
   * Ordinary observed options remain a mutation boundary.
   *
   * A semantic option binding is eligible for transient click
   * execution only when browser mutation permission is explicitly
   * enabled. The provenance proves that the observer established a
   * unique hidden semantic identity -> visible execution binding.
   *
   * This does not authorize action.kind="select" and does not widen
   * permission for persistent/consequential controls.
   */
  if (
    matchedTarget.source === "control" &&
    matchedTarget.kind === "option" &&
    !authorizedSemanticOptionClick
  ) {
    return {
      status: "MUTATION_RISK",
      safeToExecute: false,
      grounded: true,
      reason:
        matchedTarget
          .semanticOptionBinding ===
          true
          ? "Activating the bound transient option requires explicit browser mutation permission."
          : "Activating an observed option changes selection state and is outside the read-only execution phase.",
      matchedTarget,
    };
  }

  if (
    matchedTarget.source === "input"
  ) {
    if (action.kind !== "click") {
      return {
        status: "UNSUPPORTED_ACTION",
        safeToExecute: false,
        grounded: true,
        reason:
          "Observed input activation is supported only for read-only click proposals.",
        matchedTarget,
      };
    }

    const inputs = findExactInputs(
      observation,
      action.target
    );

    if (inputs.length !== 1) {
      return {
        status: "TARGET_NOT_GROUNDED",
        safeToExecute: false,
        grounded: false,
        reason:
          "A read-only input activation requires one exact observed input; contextText cannot disambiguate input targets.",
      };
    }

    const input = inputs[0]!;

    if (input.disabled) {
      return {
        status: "TARGET_DISABLED",
        safeToExecute: false,
        grounded: true,
        reason:
          "The proposed input is currently disabled.",
        matchedTarget,
      };
    }

    const inputSafetyClass =
      classifyGenericBrowserActionSafety({
        actionKind: action.kind,
        targetSource: "input",
        targetKind: input.role,
        label: action.target,
        activationSafe:
          input.activationSafe,
      });

    if (
      inputSafetyClass !==
      "TRANSIENT_REVEAL"
    ) {
      return {
        status: "MUTATION_RISK",
        safeToExecute: false,
        grounded: true,
        reason:
          input.activationSafe
            ? "The deterministic action-safety classifier identified a persisted or consequential input action."
            : "The observed input is not eligible for read-only activation.",
        matchedTarget,
      };
    }

    return {
      status: "SAFE_TO_EXECUTE",
      safeToExecute: true,
      grounded: true,
      reason:
        "The proposal uniquely matches an enabled activation-safe observed input.",
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

  const contextText =
    action.kind === "click"
      ? action.contextText?.trim()
      : undefined;

  if (contextText) {
    const observedContextMatches =
      observation.controls.filter(
        (candidate) =>
          normalize(candidate.label) ===
            normalize(action.target) &&
          normalize(
            candidate.contextText
          ) === normalize(contextText)
      );

    if (
      observedContextMatches.length !==
      1
    ) {
      return {
        status: "TARGET_NOT_GROUNDED",
        safeToExecute: false,
        grounded: false,
        reason:
          "The proposed context did not uniquely match context exposed by the current browser observation.",
      };
    }

    if (
      contextTargetResolution
        ?.resolved !== true
    ) {
      return {
        status: "TARGET_NOT_GROUNDED",
        safeToExecute: false,
        grounded: false,
        reason:
          contextTargetResolution
            ?.reason ||
          "The proposed context was not resolved to one exact semantic control.",
      };
    }

    return {
      status: "SAFE_TO_EXECUTE",
      safeToExecute: true,
      grounded: true,
      reason:
        "The proposal resolves to one exact enabled semantic control within the requested context.",
      matchedTarget: {
        source: "control",
        label:
          observedContextMatches[0]!
            .label,
        kind:
          observedContextMatches[0]!
            .kind,
        contextText,
      },
    };
  }

  /*
   * GENERIC_BROWSER_UNIQUE_TARGET_EVALUATION_V1
   *
   * A context-free interactive proposal must resolve to
   * exactly one observed semantic control.
   *
   * The executor already fails safe when multiple live
   * controls match. Enforce the same uniqueness contract
   * during evaluation so SAFE_TO_EXECUTE never means
   * "pick one duplicate now and discover ambiguity later".
   *
   * Context-bearing proposals are handled separately above
   * and retain their existing semantic-context resolution.
   */
  const exactControls =
    findExactControls(
      observation,
      action.target
    );

  if (exactControls.length !== 1) {
    return {
      status: "TARGET_NOT_GROUNDED",
      safeToExecute: false,
      grounded: false,
      reason:
        exactControls.length === 0
          ? "The proposed interactive target could not be resolved to a control."
          : "A context-free interactive proposal requires exactly one exact observed semantic control.",
    };
  }

  const control =
    exactControls[0]!;

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

function routePath(value: string): string | null {
  try {
    return new URL(value, "https://runtime.invalid").pathname
      .replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function exactRuntimeTargetCount(
  observation: BrowserObservation,
  proposal: BrowserShadowProposal
): number {
  const action = proposal.action;
  if (!action || action.kind === "observe" || action.kind === "navigate") {
    return 0;
  }
  const target = normalize(action.target);
  if (action.kind === "click" || action.kind === "select") {
    return observation.controls.filter((item) => normalize(item.label) === target).length +
      observation.inputs.filter((item) => normalize(item.label) === target).length;
  }
  return [
    ...observation.controls.map((item) => item.label),
    ...observation.inputs.map((item) => item.label),
    ...observation.headings,
    ...observation.surfaces.flatMap((item) => [item.label, item.textPreview]),
    ...observation.visibleText,
  ].filter((value) => normalize(value) === target).length;
}

/**
 * Applies planner-owned runtime target authority around the existing proposal
 * evaluator. The proposal supplies only a current target candidate; the route,
 * persona, consequence, interaction and proof boundaries remain deterministic.
 */
export function evaluateRuntimeDeferredTargetProposal(
  args: EvaluateRuntimeDeferredTargetProposalArgs
): BrowserShadowProposalEvaluation {
  const { contract, observation, proposal } = args;
  if (
    contract.schemaVersion !== 1 ||
    contract.status !== "RUNTIME_TARGET_GROUNDING_REQUIRED" ||
    contract.authority !== "SOURCE_AUTHORIZED" ||
    contract.runtimeBinding !== "NOT_YET_RESOLVED" ||
    contract.targetReadyForInteraction !== false ||
    contract.obligationIds.length === 0 ||
    contract.sourceUnitRefs.length === 0
  ) {
    return {
      status: "BLOCKED", safeToExecute: false, grounded: false,
      reason: "The runtime target grounding contract is incomplete or not planner-authorized.",
    };
  }
  if (args.actualPersona !== contract.persona.value) {
    return {
      status: "BLOCKED", safeToExecute: false, grounded: false,
      reason: "The active browser persona is outside the authorized target envelope.",
    };
  }
  const currentPath = routePath(observation.url);
  const envelopePath = routePath(contract.coarseEnvelope.route);
  if (!currentPath || !envelopePath || currentPath !== envelopePath) {
    return {
      status: "BLOCKED", safeToExecute: false, grounded: false,
      reason: "The current page is outside the authorized coarse route envelope.",
    };
  }

  if (["NO_SAFE_ACTION", "NEEDS_MORE_CONTEXT", "GOAL_ALREADY_SATISFIED"]
    .includes(proposal.decision)) {
    return evaluateBrowserShadowProposal(args);
  }
  const action = proposal.action;
  if (!action) return evaluateBrowserShadowProposal(args);
  if (action.kind === "navigate") {
    const proposedPath = routePath(action.target);
    if (
      !contract.allowedInteractionClasses.includes("INTERNAL_NAVIGATION") ||
      !proposedPath || proposedPath !== envelopePath
    ) {
      return {
        status: "BLOCKED", safeToExecute: false, grounded: false,
        reason: "The proposed navigation leaves or lacks authority within the coarse route envelope.",
      };
    }
    return evaluateBrowserShadowProposal(args);
  }
  if (action.kind === "observe") {
    return contract.allowedInteractionClasses.includes("OBSERVE")
      ? evaluateBrowserShadowProposal(args)
      : { status: "BLOCKED", safeToExecute: false, grounded: false,
          reason: "Observation is not authorized by the runtime target contract." };
  }

  const targetCount = exactRuntimeTargetCount(observation, proposal);
  if (targetCount === 0) {
    return {
      status: "BLOCKED", safeToExecute: false, grounded: false,
      reason: "Target grounding unavailable: no compatible current target exists inside the authorized envelope.",
    };
  }
  if (targetCount !== 1) {
    return {
      status: "NO_SAFE_ACTION", safeToExecute: false, grounded: false,
      reason: "Multiple plausible runtime targets remain; unique fail-closed grounding is unavailable.",
    };
  }

  const base = evaluateBrowserShadowProposal(args);
  if (!base.safeToExecute || !base.matchedTarget) return base;
  if (action.kind === "assert") {
    return contract.allowedInteractionClasses.includes("ASSERT_VISIBLE")
      ? base
      : { status: "BLOCKED", safeToExecute: false, grounded: true,
          reason: "Visible assertion is outside the authorized interaction classes.",
          matchedTarget: base.matchedTarget };
  }
  if (action.kind !== "click" || base.matchedTarget.source !== "control") {
    return {
      status: "MUTATION_RISK", safeToExecute: false, grounded: true,
      reason: "The deterministic consequence of the proposed runtime target action is unknown.",
      matchedTarget: base.matchedTarget,
    };
  }
  if (
    base.matchedTarget.kind === "option" &&
    base.matchedTarget.semanticOptionBinding === true
  ) {
    return contract.allowedInteractionClasses.includes(
      "EXISTING_SEMANTIC_OPTION_SELECTION"
    ) ? base : {
      status: "MUTATION_RISK", safeToExecute: false, grounded: true,
      reason: "Semantic option selection is permitted only through the existing authorized option path.",
      matchedTarget: base.matchedTarget,
    };
  }
  const control = findExactControls(observation, action.target)[0];
  const boundedReveal = Boolean(
    control?.controlledSurface ||
    control?.kind === "tab" ||
    control?.kind === "menuitem" ||
    (control?.kind === "link" && control.href &&
      routePath(control.href) === envelopePath)
  );
  if (
    !contract.allowedInteractionClasses.includes("TRANSIENT_REVEAL") ||
    !boundedReveal
  ) {
    return {
      status: "MUTATION_RISK", safeToExecute: false, grounded: true,
      reason: "The deterministic consequence of the proposed runtime target action is unknown.",
      matchedTarget: base.matchedTarget,
    };
  }
  return base;
}
