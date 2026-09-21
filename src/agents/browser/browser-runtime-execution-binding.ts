import type {
  BrowserExecutionCheckContract,
  BrowserExecutionVerdictScope,
  PlannerBrowserSemanticMutationClass,
  PlannerRuntimeTargetInteractionClass,
  RuntimeNavigationBinding,
} from "../../planner/types.js";
import type { BrowserShadowMatchedTarget } from "./browser-agent-shadow-evaluator.js";
import type { BrowserObservation } from "./browser-observation.js";

type BrowserBoundPersona = "company_admin" | "talent";
type BrowserSafeMutationClass = Extract<
  PlannerBrowserSemanticMutationClass,
  "READ_ONLY" | "TRANSIENT_REVERSIBLE"
>;

export type BrowserExecutionIntentAuthority = {
  schemaVersion: 1;
  caseId: string;
  executionObligationIds: string[];
  executionVerdictScope: BrowserExecutionVerdictScope;
  sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
  /**
   * Source actors constrain execution only when the source actually names
   * one. Otherwise the selected supported persona is execution configuration
   * and must be confirmed by the runtime session, never reclassified as
   * source authority.
   */
  personaPolicy:
    | {
        kind: "EXACT_PERSONA";
        persona: BrowserBoundPersona;
        authority: "SOURCE_ACTOR" | "ROUTE_ENVELOPE";
      }
    | {
        kind: "CONFIGURED_EXECUTION_PERSONA";
        persona: BrowserBoundPersona;
      };
  executionSafety: {
    allowedMutationClasses: BrowserSafeMutationClass[];
    allowedInteractionClasses: PlannerRuntimeTargetInteractionClass[];
  };
  fixtureRequirementRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  /** Existing source-authorized checks; this transport neither proves nor executes them. */
  executionCheckContract?: BrowserExecutionCheckContract;
  sourceTargetEnvelope: {
    semanticIdentity: string;
    sourceSurface: string;
    sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
    compatibleTargetSources: BrowserShadowMatchedTarget["source"][];
    routePolicy:
      | {
          kind: "PREBOUND_EXACT";
          route: string;
          authority: "SOURCE_ROUTE" | "UI_ROUTE_MANIFEST";
          sourceRefs: string[];
        }
      | {
          kind: "RUNTIME_DISCOVERABLE";
          sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
        };
  };
};

export type BrowserRuntimeExecutionBinding = {
  schemaVersion: 1;
  caseId: string;
  executionObligationIds: string[];
  actualPersona: BrowserBoundPersona;
  resolvedRoute: string;
  resolvedTarget: {
    semanticIdentity: string;
    source: BrowserShadowMatchedTarget["source"];
    label: string;
    kind?: string;
    contextText?: string;
  };
  routeBindingEvidence: {
    kind:
      | "RUNTIME_NAVIGATION_BINDING"
      | "ROUTE_MANIFEST_CONFIRMED"
      | "FRESH_BROWSER_OBSERVATION"
      | "PLANNER_ROUTE_PROSE"
      | "SCREENSHOT_REVIEW";
    routeCandidateCount: number;
    evidenceReference: string;
    navigationBinding?: RuntimeNavigationBinding;
    compatibleSourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
  };
  targetBindingEvidence: {
    kind:
      | "FRESH_BROWSER_OBSERVATION"
      | "PLANNER_TARGET_PROSE"
      | "SCREENSHOT_REVIEW";
    observationId: string;
    candidateCount: number;
    selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY";
    authority: "DETERMINISTIC_BROWSER_OBSERVATION" | "PLANNER_ONLY" | "REVIEW_ONLY";
    heuristic: "NONE" | "DOM_ORDER" | "NTH_SELECTOR" | "PIXEL" | "PROXIMITY";
    compatibleSourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
  };
  freshness: {
    executionId: string;
    stateIdentity: string;
    observedAt: string;
    fresh: boolean;
  };
  observedMutationClass: PlannerBrowserSemanticMutationClass;
};

export type BrowserRuntimeExecutionBindingValidationReason =
  | "CASE_ID_MISMATCH"
  | "EXECUTION_SCOPE_MISMATCH"
  | "INTENT_VERDICT_SCOPE_MISMATCH"
  | "INTENT_CHECK_SCOPE_MISMATCH"
  | "PERSONA_POLICY_MISMATCH"
  | "UNKNOWN_OR_EMPTY_ROUTE"
  | "ROUTE_CANDIDATE_NOT_UNIQUE"
  | "ROUTE_EVIDENCE_UNAUTHORIZED"
  | "ROUTE_NOT_COMPATIBLE_WITH_INTENT"
  | "TARGET_CANDIDATE_NOT_UNIQUE"
  | "TARGET_EVIDENCE_UNAUTHORIZED"
  | "TARGET_HEURISTIC_FORBIDDEN"
  | "TARGET_NOT_COMPATIBLE_WITH_INTENT"
  | "BINDING_NOT_FRESH"
  | "BINDING_STATE_MISMATCH"
  | "MUTATION_CLASS_FORBIDDEN";

export type BrowserRuntimeExecutionBindingValidationResult =
  | { status: "VALID"; binding: BrowserRuntimeExecutionBinding }
  | {
      status: "INVALID";
      reason: BrowserRuntimeExecutionBindingValidationReason;
    };

function sameIds(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000");
}

function sameRefs(
  left: Array<{ sourceUnitId: string; sourceRef: string }>,
  right: Array<{ sourceUnitId: string; sourceRef: string }>
): boolean {
  const key = (ref: { sourceUnitId: string; sourceRef: string }) =>
    `${ref.sourceUnitId}\u0000${ref.sourceRef}`;
  return sameIds(left.map(key), right.map(key));
}

function invalid(
  reason: BrowserRuntimeExecutionBindingValidationReason
): BrowserRuntimeExecutionBindingValidationResult {
  return { status: "INVALID", reason };
}

function isBrowserSafeMutationClass(
  mutationClass: PlannerBrowserSemanticMutationClass
): mutationClass is BrowserSafeMutationClass {
  return mutationClass === "READ_ONLY" || mutationClass === "TRANSIENT_REVERSIBLE";
}

/**
 * Validates a finalized runtime HOW binding against immutable source-backed
 * execution intent. It neither executes the browser nor derives a verdict.
 */
export function validateBrowserRuntimeExecutionBinding(args: {
  intent: BrowserExecutionIntentAuthority;
  binding: BrowserRuntimeExecutionBinding;
  currentExecutionId: string;
  currentStateIdentity: string;
}): BrowserRuntimeExecutionBindingValidationResult {
  const { intent, binding } = args;
  if (intent.caseId !== binding.caseId) return invalid("CASE_ID_MISMATCH");
  if (!sameIds(intent.executionObligationIds, binding.executionObligationIds)) {
    return invalid("EXECUTION_SCOPE_MISMATCH");
  }
  if (!sameIds(
    intent.executionObligationIds,
    intent.executionVerdictScope.executionObligationIds
  )) return invalid("INTENT_VERDICT_SCOPE_MISMATCH");
  if (intent.executionCheckContract &&
      (intent.executionCheckContract.caseId !== intent.caseId ||
       !sameIds(intent.executionCheckContract.executionObligationIds, intent.executionObligationIds))) {
    return invalid("INTENT_CHECK_SCOPE_MISMATCH");
  }
  if (intent.personaPolicy.persona !== binding.actualPersona) {
    return invalid("PERSONA_POLICY_MISMATCH");
  }
  if (!binding.resolvedRoute || binding.resolvedRoute === "UNKNOWN") {
    return invalid("UNKNOWN_OR_EMPTY_ROUTE");
  }
  if (binding.routeBindingEvidence.routeCandidateCount !== 1) {
    return invalid("ROUTE_CANDIDATE_NOT_UNIQUE");
  }
  if (![
    "RUNTIME_NAVIGATION_BINDING",
    "ROUTE_MANIFEST_CONFIRMED",
    "FRESH_BROWSER_OBSERVATION",
  ].includes(binding.routeBindingEvidence.kind)) {
    return invalid("ROUTE_EVIDENCE_UNAUTHORIZED");
  }
  if (binding.routeBindingEvidence.kind === "RUNTIME_NAVIGATION_BINDING" &&
      (!binding.routeBindingEvidence.navigationBinding ||
       binding.routeBindingEvidence.navigationBinding.status !== "RESOLVED" ||
       binding.routeBindingEvidence.navigationBinding.concreteRoute !== binding.resolvedRoute ||
       binding.routeBindingEvidence.navigationBinding.persona !== binding.actualPersona)) {
    return invalid("ROUTE_EVIDENCE_UNAUTHORIZED");
  }
  const routePolicy = intent.sourceTargetEnvelope.routePolicy;
  if (routePolicy.kind === "PREBOUND_EXACT" && routePolicy.route !== binding.resolvedRoute) {
    return invalid("ROUTE_NOT_COMPATIBLE_WITH_INTENT");
  }
  if (!sameRefs(
    binding.routeBindingEvidence.compatibleSourceUnitRefs,
    routePolicy.kind === "RUNTIME_DISCOVERABLE"
      ? routePolicy.sourceUnitRefs
      : intent.sourceTargetEnvelope.sourceUnitRefs
  )) return invalid("ROUTE_NOT_COMPATIBLE_WITH_INTENT");
  if (binding.targetBindingEvidence.candidateCount !== 1) {
    return invalid("TARGET_CANDIDATE_NOT_UNIQUE");
  }
  if (binding.targetBindingEvidence.kind !== "FRESH_BROWSER_OBSERVATION" ||
      binding.targetBindingEvidence.authority !== "DETERMINISTIC_BROWSER_OBSERVATION") {
    return invalid("TARGET_EVIDENCE_UNAUTHORIZED");
  }
  if (binding.targetBindingEvidence.heuristic !== "NONE") {
    return invalid("TARGET_HEURISTIC_FORBIDDEN");
  }
  if (binding.resolvedTarget.semanticIdentity !== intent.sourceTargetEnvelope.semanticIdentity ||
      !intent.sourceTargetEnvelope.compatibleTargetSources.includes(binding.resolvedTarget.source) ||
      !sameRefs(
        binding.targetBindingEvidence.compatibleSourceUnitRefs,
        intent.sourceTargetEnvelope.sourceUnitRefs
      )) {
    return invalid("TARGET_NOT_COMPATIBLE_WITH_INTENT");
  }
  if (!binding.freshness.fresh ||
      binding.freshness.executionId !== args.currentExecutionId) {
    return invalid("BINDING_NOT_FRESH");
  }
  if (binding.freshness.stateIdentity !== args.currentStateIdentity) {
    return invalid("BINDING_STATE_MISMATCH");
  }
  if (!isBrowserSafeMutationClass(binding.observedMutationClass) ||
      !intent.executionSafety.allowedMutationClasses.includes(binding.observedMutationClass)) {
    return invalid("MUTATION_CLASS_FORBIDDEN");
  }
  return { status: "VALID", binding };
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function observedTargetCount(args: {
  observation: BrowserObservation;
  target: BrowserShadowMatchedTarget;
  expectedSurface: string;
}): number {
  const expected = normalized(args.expectedSurface);
  if (normalized(args.target.label) !== expected) return 0;
  if (args.target.source === "surface") {
    return args.observation.surfaces.filter((item) => normalized(item.label) === expected).length;
  }
  if (args.target.source === "heading") {
    return args.observation.headings.filter((item) => normalized(item) === expected).length;
  }
  if (args.target.source === "visibleText") {
    return args.observation.visibleText.filter((item) => normalized(item) === expected).length;
  }
  return 0;
}

/**
 * Converts an existing fresh generic-browser observation into a binding
 * candidate only when it has one exact source-envelope target. It does not
 * navigate, select a target, or create source authority.
 */
export function createValidatedBrowserRuntimeExecutionBinding(args: {
  intent: BrowserExecutionIntentAuthority;
  actualPersona: BrowserBoundPersona;
  resolvedRoute: string;
  observation: BrowserObservation;
  matchedTarget: BrowserShadowMatchedTarget | null;
  executionId: string;
  stateIdentity: string;
  observedMutationClass: PlannerBrowserSemanticMutationClass;
  observationId: string;
}): BrowserRuntimeExecutionBindingValidationResult {
  if (!args.matchedTarget) return invalid("TARGET_CANDIDATE_NOT_UNIQUE");
  const targetCandidateCount = observedTargetCount({
    observation: args.observation,
    target: args.matchedTarget,
    expectedSurface: args.intent.sourceTargetEnvelope.sourceSurface,
  });
  const routeRefs = args.intent.sourceTargetEnvelope.routePolicy.kind ===
    "RUNTIME_DISCOVERABLE"
    ? args.intent.sourceTargetEnvelope.routePolicy.sourceUnitRefs
    : args.intent.sourceTargetEnvelope.sourceUnitRefs;
  const binding: BrowserRuntimeExecutionBinding = {
    schemaVersion: 1,
    caseId: args.intent.caseId,
    executionObligationIds: args.intent.executionObligationIds,
    actualPersona: args.actualPersona,
    resolvedRoute: args.resolvedRoute,
    resolvedTarget: {
      semanticIdentity: args.intent.sourceTargetEnvelope.semanticIdentity,
      source: args.matchedTarget.source,
      label: args.matchedTarget.label,
      ...(args.matchedTarget.kind ? { kind: args.matchedTarget.kind } : {}),
      ...(args.matchedTarget.contextText ? { contextText: args.matchedTarget.contextText } : {}),
    },
    routeBindingEvidence: {
      kind: "FRESH_BROWSER_OBSERVATION",
      routeCandidateCount: args.resolvedRoute && args.resolvedRoute !== "UNKNOWN" ? 1 : 0,
      evidenceReference: args.observationId,
      compatibleSourceUnitRefs: routeRefs,
    },
    targetBindingEvidence: {
      kind: "FRESH_BROWSER_OBSERVATION",
      observationId: args.observationId,
      candidateCount: targetCandidateCount,
      selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY",
      authority: "DETERMINISTIC_BROWSER_OBSERVATION",
      heuristic: "NONE",
      compatibleSourceUnitRefs: args.intent.sourceTargetEnvelope.sourceUnitRefs,
    },
    freshness: {
      executionId: args.executionId,
      stateIdentity: args.stateIdentity,
      observedAt: args.observationId,
      fresh: true,
    },
    observedMutationClass: args.observedMutationClass,
  };
  return validateBrowserRuntimeExecutionBinding({
    intent: args.intent,
    binding,
    currentExecutionId: args.executionId,
    currentStateIdentity: args.stateIdentity,
  });
}
