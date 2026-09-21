import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerBrowserObligationBinding,
  TestPlan,
} from "../planner/types.js";
import type {
  BrowserStepResult,
} from "../agents/browser/browser-execution-types.js";
import type {
  BrowserEvidenceCheckpoint,
  EvidenceReviewResult,
} from "../agents/browser/evidence-review.js";
import type {
  VideoEvidenceReviewResult,
} from "../agents/browser/video-evidence-review.js";
import {
  getRemainingBrowserManualAcceptanceChecks,
} from "../agents/browser/browser-result-reconciliation.js";
import type { BrowserHumanReadableQaResult } from "../agents/browser/browser-human-readable-result.js";

export type ReviewerBlockerFamily =
  | "AUTHORITY"
  | "CASE_REPRESENTATION"
  | "TYPED_AUTOMATION_SUPPORT"
  | "ROUTE"
  | "TARGET"
  | "FIXTURE_DATA"
  | "RUNTIME_GROUNDING"
  | "SAFETY"
  | "DETERMINISTIC_PROOF"
  | "COMPLETENESS"
  | "ORCHESTRATION";

export type ReviewerObligationState =
  | "PROVED"
  | "CONTRADICTED"
  | "SUPPORTED_NOT_PROVED"
  | "UNSUPPORTED_AUTOMATION"
  | "UNALLOCATED"
  | "AMBIGUOUS_ALLOCATION"
  | "BLOCKED_BY_TEST_DATA"
  | "BLOCKED_BY_ROUTE"
  | "BLOCKED_BY_TARGET"
  | "BLOCKED_BY_GROUNDING"
  | "NOT_ESTABLISHED";

export type ReviewerBrowserResultInput =
  {
    id: string;
    status?: string;
    reasonCategory?: string;
    notes?: string | string[];
    terminationReason?:
      NonNullable<BrowserStepResult["terminationReason"]>;
    deterministicEvidence?:
      NonNullable<BrowserStepResult["deterministicEvidence"]>;
    collectionFilterEvidence?:
      NonNullable<BrowserStepResult["collectionFilterEvidence"]>;
    localStateTransitionEvidence?:
      NonNullable<BrowserStepResult["localStateTransitionEvidence"]>;
    deterministicObligationDischarges?:
      NonNullable<BrowserStepResult["deterministicObligationDischarges"]>;
    caseProofReadiness?:
      NonNullable<BrowserStepResult["caseProofReadiness"]>;
    deterministicPassEligibility?:
      NonNullable<BrowserStepResult["deterministicPassEligibility"]>;
    deterministicPassValidationContext?:
      NonNullable<BrowserStepResult["deterministicPassValidationContext"]>;
    interactionExecutionEvidence?:
      NonNullable<BrowserStepResult["interactionExecutionEvidence"]>;
    runtimeTopTabObservations?:
      NonNullable<BrowserStepResult["runtimeTopTabObservations"]>;
    expandedSurfaceObservations?:
      NonNullable<BrowserStepResult["expandedSurfaceObservations"]>;
    evidence?: string;
    startRoute?: string;
    videoPath?: string;
    checkpointEvidence?:
      BrowserEvidenceCheckpoint[];
    evidenceReview?:
      EvidenceReviewResult | null;
    videoEvidenceReview?:
      VideoEvidenceReviewResult | null;
    reconciliationAudit?:
      Record<string, unknown>[];
    humanReadableResult?: BrowserHumanReadableQaResult;
  };

export type ReviewerBrowserBlocker = {
  family: ReviewerBlockerFamily;
  typedReason: string;
  explanation: string;
};

export type ReviewerBrowserEvidence = {
  kind: string;
  authority:
    | "DETERMINISTIC_ACCEPTANCE_PROOF"
    | "DETERMINISTIC_CHECK"
    | "SUPPLEMENTARY";
  result?: string | undefined;
  reference?: string | undefined;
  summary: string;
};

export type ReviewerBrowserObligation = {
  obligationId: string;
  text: string;
  sourceRole:
    PlannerAcceptanceObligation["sourceRole"];
  bindingState:
    | PlannerBrowserObligationBinding["state"]
    | "V2_RUNTIME_CASE_REPRESENTED"
    | "MISSING";
  automationSupport:
    | "SUPPORTED"
    | "SUPPORTED_NOT_BOUND"
    | "UNSUPPORTED"
    | "MANUAL_BY_NATURE"
    | "NOT_ESTABLISHED";
  proofState: ReviewerObligationState;
};

export type ReviewerBrowserCaseSummary = {
  caseId: string;
  goal: string;
  finalStatus: string;
  finalReason: string;
  startRoute: string;
  route: {
    state:
      | "ACCEPTED_OR_REACHED"
      | "UNRESOLVED"
      | "WRONG_OR_INCOMPATIBLE"
      | "UNKNOWN";
    detail: string;
  };
  target: {
    state:
      | "VERIFIED"
      | "UNAVAILABLE"
      | "INCOMPATIBLE"
      | "AMBIGUOUS"
      | "UNKNOWN";
    detail: string;
  };
  fixture: {
    state:
      | "READY"
      | "NOT_REQUIRED"
      | "UNAVAILABLE"
      | "UNKNOWN"
      | "INCOMPATIBLE"
      | "INSUFFICIENT_STATE";
    detail: string;
  };
  authorityEstablished: boolean;
  authorityNote: string;
  authoritativeObligations:
    ReviewerBrowserObligation[];
  verified: string[];
  observedButNotProved: string[];
  unverified: string[];
  blockers: ReviewerBrowserBlocker[];
  evidence: ReviewerBrowserEvidence[];
  caseProofReadiness:
    | "CASE_PROOF_READY"
    | "CASE_PROOF_NOT_READY"
    | "NOT_ESTABLISHED";
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function structuredRequirementIds(
  testCase: BrowserTestCase
): Set<string> {
  const scope = testCase.acceptanceScope;
  const ids = [
    ...(scope?.orderingRequirements ?? [])
      .map((item) => item.requirementId),
    ...(scope?.collectionFilterRequirements ?? [])
      .map((item) => item.requirementId),
    ...(scope?.localControlStateTransitionRequirements ?? [])
      .map((item) => item.requirementId),
    ...(scope?.urlTransitionRequirements ?? [])
      .map((item) => item.urlAssertionOracleId),
    ...(scope?.selectedStateRequirements ?? [])
      .map((item) => item.selectionOracleId),
  ].filter(Boolean);

  return new Set(ids);
}

function uniqueBinding(
  bindings: PlannerBrowserObligationBinding[],
  obligationId: string
): PlannerBrowserObligationBinding | undefined {
  const matches = bindings.filter(
    (binding) =>
      binding.obligationId === obligationId
  );

  return matches.length === 1
    ? matches[0]
    : undefined;
}

type ReviewerCaseRepresentation =
  | "REPRESENTED"
  | "UNALLOCATED"
  | "AMBIGUOUS";

function v2StableCaseRepresentation(args: {
  plan: TestPlan;
  obligationId: string;
  caseId: string;
}): boolean {
  if (
    args.plan.browserSemanticPlanningAudit?.version !== "V2"
  ) {
    return false;
  }
  const allocation =
    args.plan.obligationCaseAllocationAudit
      ?.allocations.find(
        (item) => item.obligationId === args.obligationId
      );
  return Boolean(
    allocation &&
    [
      "STABLE_ID_CASE_REPRESENTATION",
      "EXACT_CASE_REPRESENTATION",
    ].includes(allocation.status) &&
    allocation.matchedCaseIds.includes(args.caseId)
  );
}

function caseRepresentation(args: {
  plan: TestPlan;
  obligationId: string;
  caseId: string;
  binding: PlannerBrowserObligationBinding | undefined;
}): ReviewerCaseRepresentation {
  if (v2StableCaseRepresentation(args)) {
    return "REPRESENTED";
  }
  if (
    !args.binding ||
    args.binding.state ===
      "UNALLOCATED_AUTHORITATIVE_OBLIGATION" ||
    !args.binding.allocatedCaseIds.includes(args.caseId)
  ) {
    return "UNALLOCATED";
  }
  if (
    args.binding.state === "AMBIGUOUS_CASE_ALLOCATION" ||
    args.binding.allocatedCaseIds.length !== 1
  ) {
    return "AMBIGUOUS";
  }
  return "REPRESENTED";
}

function hasV2BoundProofCapability(
  testCase: BrowserTestCase,
  obligationId: string
): boolean {
  return (testCase.deterministicProofBindings ?? []).some(
    (binding) =>
      binding.authority === "SOURCE_AUTHORIZED" &&
      binding.obligationId === obligationId
  );
}

function automationSupport(
  binding: PlannerBrowserObligationBinding | undefined,
  requirementIds: Set<string>
): ReviewerBrowserObligation["automationSupport"] {
  if (!binding) return "NOT_ESTABLISHED";
  if (binding.state === "MANUAL_BY_NATURE") {
    return "MANUAL_BY_NATURE";
  }
  if (
    binding.state ===
      "UNSUPPORTED_AUTOMATION_SEMANTIC"
  ) {
    return "UNSUPPORTED";
  }
  if (binding.state === "SUPPORTED_BUT_UNBOUND") {
    return "SUPPORTED_NOT_BOUND";
  }
  if (binding.state !== "SUPPORTED_AND_BOUND") {
    return "NOT_ESTABLISHED";
  }

  const emittedIds = binding.emittedRequirementIds ?? [];
  if (
    emittedIds.length > 0 &&
    !emittedIds.every((id) => requirementIds.has(id))
  ) {
    return "NOT_ESTABLISHED";
  }

  return "SUPPORTED";
}

function addBlocker(
  blockers: ReviewerBrowserBlocker[],
  blocker: ReviewerBrowserBlocker
): void {
  if (
    blockers.some(
      (item) =>
        item.family === blocker.family &&
        item.typedReason === blocker.typedReason
    )
  ) {
    return;
  }
  blockers.push(blocker);
}

function runtimeStates(args: {
  testCase: BrowserTestCase;
  result: ReviewerBrowserResultInput | undefined;
}) {
  const { testCase, result } = args;
  const runtime =
    result?.deterministicPassValidationContext
      ?.runtime;
  const passReason =
    result?.deterministicPassEligibility
      ?.status ===
      "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE"
      ? result.deterministicPassEligibility.reason
      : undefined;

  let route:
    ReviewerBrowserCaseSummary["route"] = {
      state: "UNKNOWN",
      detail:
        "No typed runtime route acceptance result was recorded.",
    };
  if (runtime?.acceptedRoutePath) {
    route = {
      state: "ACCEPTED_OR_REACHED",
      detail: runtime.acceptedRoutePath,
    };
  } else if (
    result?.reasonCategory === "WRONG_ROUTE" ||
    result?.reasonCategory ===
      "IRRELEVANT_BROWSER_ROUTE"
  ) {
    route = {
      state: "WRONG_OR_INCOMPATIBLE",
      detail: result.reasonCategory,
    };
  } else if (
    passReason === "ROUTE_NOT_ACCEPTED" ||
    result?.reasonCategory ===
      "MISSING_BROWSER_ROUTE" ||
    result?.reasonCategory ===
      "ROUTE_DISCOVERY_EXHAUSTED" ||
    result?.terminationReason === "MISSING_ROUTE" ||
    testCase.routeResolution?.status === "UNRESOLVED" ||
    testCase.routeResolution?.status === "AMBIGUOUS"
  ) {
    const typedRouteReason =
      passReason === "ROUTE_NOT_ACCEPTED"
        ? passReason
        : result?.reasonCategory ===
            "MISSING_BROWSER_ROUTE" ||
          result?.reasonCategory ===
            "ROUTE_DISCOVERY_EXHAUSTED"
          ? result.reasonCategory
          : result?.terminationReason ===
              "MISSING_ROUTE"
            ? result.terminationReason
            : testCase.routeResolution?.status ??
              "MISSING_ROUTE";
    route = {
      state: "UNRESOLVED",
      detail: typedRouteReason,
    };
  }

  let target:
    ReviewerBrowserCaseSummary["target"] = {
      state: "UNKNOWN",
      detail:
        "No typed runtime target verification result was recorded.",
    };
  if (runtime?.targetVerified === true) {
    target = {
      state: "VERIFIED",
      detail:
        "The deterministic runtime prerequisites record the target as verified.",
    };
  } else if (
    result?.terminationReason ===
      "GROUNDING_AMBIGUITY"
  ) {
    target = {
      state: "AMBIGUOUS",
      detail: "GROUNDING_AMBIGUITY",
    };
  } else if (passReason === "TARGET_NOT_VERIFIED") {
    target = {
      state: "UNAVAILABLE",
      detail: passReason,
    };
  }

  let fixture:
    ReviewerBrowserCaseSummary["fixture"] = {
      state: Array.isArray(testCase.fixtureRequirements)
        && testCase.fixtureRequirements.length === 0
        ? "NOT_REQUIRED"
        : "UNKNOWN",
      detail: Array.isArray(testCase.fixtureRequirements)
        && testCase.fixtureRequirements.length === 0
        ? "The case declares no fixture requirements."
        : "No typed runtime fixture readiness result was recorded.",
    };
  if (
    runtime?.fixtureStatus === "READY" ||
    runtime?.fixtureStatus === "NOT_REQUIRED"
  ) {
    fixture = {
      state: runtime.fixtureStatus,
      detail: `Runtime fixture status: ${runtime.fixtureStatus}.`,
    };
  } else if (
    runtime?.fixtureStatus === "UNAVAILABLE" ||
    runtime?.testDataIssue === true ||
    passReason === "FIXTURE_NOT_READY" ||
    passReason === "TEST_DATA_ISSUE" ||
    result?.reasonCategory === "TEST_DATA_ISSUE"
  ) {
    fixture = {
      state: "UNAVAILABLE",
      detail:
        passReason ??
        result?.reasonCategory ??
        "Runtime fixture status: UNAVAILABLE.",
    };
  } else if (runtime?.fixtureStatus === "UNKNOWN") {
    fixture = {
      state: "UNKNOWN",
      detail: "Runtime fixture status: UNKNOWN.",
    };
  }

  return { route, target, fixture, runtime, passReason };
}

function obligationProofState(args: {
  obligationId: string;
  representation: ReviewerCaseRepresentation;
  support: ReviewerBrowserObligation["automationSupport"];
  result: ReviewerBrowserResultInput | undefined;
  route: ReviewerBrowserCaseSummary["route"];
  target: ReviewerBrowserCaseSummary["target"];
  fixture: ReviewerBrowserCaseSummary["fixture"];
}): ReviewerObligationState {
  const {
    obligationId,
    representation,
    support,
    result,
    route,
    target,
    fixture,
  } = args;
  const proved =
    result?.deterministicObligationDischarges?.some(
      (item) =>
        item.kind ===
          "DETERMINISTIC_OBLIGATION_PROVED" &&
        item.evidenceResult === "CONFIRMED" &&
        item.obligationId === obligationId
    ) === true;
  if (proved) return "PROVED";

  const contradicted =
    result?.localStateTransitionEvidence?.some(
      (item) =>
        item.obligationId === obligationId &&
        item.result === "CONTRADICTED"
    ) === true;
  if (contradicted) return "CONTRADICTED";

  const groundingAbstained =
    result?.localStateTransitionEvidence?.some(
      (item) =>
        item.obligationId === obligationId &&
        item.result === "ABSTAINED" &&
        (
          item.reason === "CONTROL_NOT_GROUNDED" ||
          item.reason === "CONTROL_IDENTITY_CHANGED" ||
          item.reason === "TARGET_SURFACE_LOST"
        )
    ) === true;

  if (representation === "UNALLOCATED") {
    return "UNALLOCATED";
  }
  if (representation === "AMBIGUOUS") {
    return "AMBIGUOUS_ALLOCATION";
  }
  if (support === "UNSUPPORTED") {
    return "UNSUPPORTED_AUTOMATION";
  }
  if (groundingAbstained) {
    return "BLOCKED_BY_GROUNDING";
  }
  if (fixture.state === "UNAVAILABLE") {
    return "BLOCKED_BY_TEST_DATA";
  }
  if (
    route.state === "UNRESOLVED" ||
    route.state === "WRONG_OR_INCOMPATIBLE"
  ) {
    return "BLOCKED_BY_ROUTE";
  }
  if (
    target.state === "UNAVAILABLE" ||
    target.state === "INCOMPATIBLE"
  ) {
    return "BLOCKED_BY_TARGET";
  }
  if (target.state === "AMBIGUOUS") {
    return "BLOCKED_BY_GROUNDING";
  }
  if (support === "SUPPORTED") {
    return "SUPPORTED_NOT_PROVED";
  }
  return "NOT_ESTABLISHED";
}

function buildEvidence(
  result: ReviewerBrowserResultInput | undefined
): ReviewerBrowserEvidence[] {
  if (!result) return [];
  const evidence: ReviewerBrowserEvidence[] = [];

  for (const item of
    result.deterministicObligationDischarges ?? []) {
    if (
      item.kind ===
        "DETERMINISTIC_OBLIGATION_PROVED" &&
      item.evidenceResult === "CONFIRMED"
    ) {
      evidence.push({
        kind: item.proofKind,
        authority:
          "DETERMINISTIC_ACCEPTANCE_PROOF",
        result: item.evidenceResult,
        reference: item.proofRequirementId,
        summary:
          `Exact obligation ${item.obligationId} was discharged.`,
      });
    }
  }

  for (const item of
    result.localStateTransitionEvidence ?? []) {
    evidence.push({
      kind: item.kind,
      authority: "DETERMINISTIC_CHECK",
      result: item.result,
      reference: item.proofRequirementId,
      summary:
        `Local-state evidence is ${item.result}; exact obligation proof requires a separate discharge.`,
    });
  }

  for (const item of
    result.collectionFilterEvidence ?? []) {
    evidence.push({
      kind: item.kind,
      authority: "DETERMINISTIC_CHECK",
      result: item.status,
      reference: item.requirementId,
      summary:
        `Collection-filter evidence is ${item.status}` +
        `${item.proofReady ? " and proof-ready" : ""}; exact obligation proof is reported separately.`,
    });
  }

  for (const item of
    result.deterministicEvidence ?? []) {
    evidence.push({
      kind: item.action,
      authority: "DETERMINISTIC_CHECK",
      result: item.passed ? "CONFIRMED" : "CONTRADICTED",
      reference: item.oracleId,
      summary:
        `Step ${item.stepIndex} checked ${item.action} against ${JSON.stringify(item.expected)}.`,
    });
  }

  if (result.evidenceReview) {
    evidence.push({
      kind: "SCREENSHOT_REVIEW",
      authority: "SUPPLEMENTARY",
      result: result.evidenceReview.verdict,
      summary:
        "Screenshot review is supplementary and cannot discharge an acceptance obligation.",
    });
    for (const visible of
      result.evidenceReview.visibleEvidence ?? []) {
      evidence.push({
        kind: "VISUAL_OBSERVATION",
        authority: "SUPPLEMENTARY",
        result: "OBSERVED_BUT_NOT_PROVED",
        summary: visible,
      });
    }
  }
  for (const checkpoint of
    result.checkpointEvidence ?? []) {
    evidence.push({
      kind: "SCREENSHOT_CHECKPOINT",
      authority: "SUPPLEMENTARY",
      reference: checkpoint.screenshotPath,
      summary:
        `Step ${checkpoint.stepIndex}: ${checkpoint.label}.`,
    });
  }
  if (result.videoEvidenceReview || result.videoPath) {
    evidence.push({
      kind: "VIDEO_REVIEW",
      authority: "SUPPLEMENTARY",
      result: result.videoEvidenceReview?.verdict,
      reference: result.videoPath,
      summary:
        "Video evidence is supplementary and cannot discharge an acceptance obligation.",
    });
  }
  for (const item of
    result.runtimeTopTabObservations ?? []) {
    evidence.push({
      kind: "RUNTIME_TAB_OBSERVATION",
      authority: "SUPPLEMENTARY",
      result: item.activeStateVerified
        ? "OBSERVED_BUT_NOT_PROVED"
        : "NOT_VERIFIED",
      summary:
        `Step ${item.stepIndex} targeted ${JSON.stringify(item.targetTabLabel)}; active-state verification=${item.activeStateVerified}.`,
    });
  }
  for (const item of
    result.expandedSurfaceObservations ?? []) {
    evidence.push({
      kind: "EXPANDED_SURFACE_OBSERVATION",
      authority: "SUPPLEMENTARY",
      result: item.expandedSurfaceVerified
        ? "OBSERVED_BUT_NOT_PROVED"
        : "NOT_VERIFIED",
      summary:
        `Step ${item.stepIndex} triggered ${JSON.stringify(item.triggerText)}; expanded-surface verification=${item.expandedSurfaceVerified}` +
        `${item.surfaceName ? ` (${item.surfaceName})` : ""}.`,
    });
  }
  for (const item of
    result.interactionExecutionEvidence ?? []) {
    evidence.push({
      kind: "INTERACTION_EXECUTION",
      authority: "SUPPLEMENTARY",
      result: "OBSERVED_BUT_NOT_PROVED",
      reference: item.interactionId,
      summary:
        `Step ${item.stepIndex} executed ${item.action}; execution alone is not acceptance proof.`,
    });
  }

  return evidence;
}

function buildCaseSummary(args: {
  plan: TestPlan;
  testCase: BrowserTestCase;
  result: ReviewerBrowserResultInput | undefined;
}): ReviewerBrowserCaseSummary {
  const { plan, testCase, result } = args;
  const blockers: ReviewerBrowserBlocker[] = [];
  const ledger = plan.acceptanceObligationLedger;
  const bindings = plan.browserObligationBindings ?? [];
  const requirementIds =
    structuredRequirementIds(testCase);
  const relevantIds = unique([
    ...(testCase.acceptanceObligationIds ?? []),
    ...bindings
      .filter((binding) =>
        binding.allocatedCaseIds.includes(testCase.id)
      )
      .map((binding) => binding.obligationId),
  ]);
  const ledgerById = new Map(
    (ledger?.obligations ?? []).map(
      (obligation) => [obligation.id, obligation]
    )
  );
  const obligations = relevantIds
    .map((id) => ledgerById.get(id))
    .filter(
      (item): item is PlannerAcceptanceObligation =>
        Boolean(item)
    );
  const authorityEstablished =
    ledger?.sourceStatus === "RESOLVED" &&
    ledger.derivationStatus === "RESOLVED" &&
    obligations.length > 0;

  if (!authorityEstablished) {
    addBlocker(blockers, {
      family: "AUTHORITY",
      typedReason:
        ledger?.derivationStatus ?? "LEDGER_UNAVAILABLE",
      explanation:
        "No high-confidence authoritative browser obligation was established for this generated case; planner goals and manual checks were not promoted to authority.",
    });
  }
  const missingLedgerIds = relevantIds.filter(
    (id) => !ledgerById.has(id)
  );
  if (missingLedgerIds.length > 0) {
    addBlocker(blockers, {
      family: "CASE_REPRESENTATION",
      typedReason: "ALLOCATED_OBLIGATION_MISSING_FROM_LEDGER",
      explanation:
        `${missingLedgerIds.length} case obligation ID(s) do not resolve to the authoritative ledger.`,
    });
  }

  const states = runtimeStates({ testCase, result });
  if (
    states.passReason ===
      "NO_AUTHORITATIVE_ACCEPTANCE_OBLIGATION" ||
    states.passReason ===
      "AUTHORITATIVE_OBLIGATION_LEDGER_UNRESOLVED" ||
    states.passReason === "OBLIGATION_NOT_AUTHORITATIVE"
  ) {
    addBlocker(blockers, {
      family: "AUTHORITY",
      typedReason: states.passReason,
      explanation:
        "The deterministic PASS audit did not establish authoritative acceptance scope.",
    });
  }
  if (
    states.passReason === "OBLIGATION_ALLOCATION_INVALID" ||
    states.passReason ===
      "OBLIGATION_ALLOCATION_AMBIGUOUS"
  ) {
    addBlocker(blockers, {
      family: "CASE_REPRESENTATION",
      typedReason: states.passReason,
      explanation:
        "The deterministic PASS audit did not find one valid exact obligation allocation for this case.",
    });
  }
  if (
    states.passReason === "OBLIGATION_PROOF_MISSING" ||
    states.passReason === "OBLIGATION_DISCHARGE_INVALID" ||
    states.passReason === "OBLIGATION_DISCHARGE_MISSING" ||
    states.passReason === "REQUIRED_EXECUTION_INCOMPLETE"
  ) {
    addBlocker(blockers, {
      family: "DETERMINISTIC_PROOF",
      typedReason: states.passReason,
      explanation:
        "The deterministic PASS audit found incomplete or invalid exact proof.",
    });
  }
  if (states.passReason === "MANUAL_ACCEPTANCE_GAP") {
    addBlocker(blockers, {
      family: "COMPLETENESS",
      typedReason: states.passReason,
      explanation:
        "The deterministic PASS audit found remaining manual acceptance coverage.",
    });
  }
  if (
    states.route.state === "UNRESOLVED" ||
    states.route.state === "WRONG_OR_INCOMPATIBLE"
  ) {
    addBlocker(blockers, {
      family: "ROUTE",
      typedReason: states.route.detail,
      explanation:
        "The required browser route was not accepted as a compatible runtime route.",
    });
  }
  if (states.target.state === "AMBIGUOUS") {
    addBlocker(blockers, {
      family: "RUNTIME_GROUNDING",
      typedReason: states.target.detail,
      explanation:
        "Runtime grounding did not identify one unambiguous target.",
    });
  } else if (
    states.target.state === "UNAVAILABLE" ||
    states.target.state === "INCOMPATIBLE"
  ) {
    addBlocker(blockers, {
      family: "TARGET",
      typedReason: states.target.detail,
      explanation:
        "The exact acceptance-compatible runtime target was not verified.",
    });
  }
  if (states.fixture.state === "UNAVAILABLE") {
    addBlocker(blockers, {
      family: "FIXTURE_DATA",
      typedReason: states.fixture.detail,
      explanation:
        "Required compatible test data was not established as available.",
    });
  }
  if (
    states.runtime?.safetyViolation === true ||
    (
      states.runtime?.productNonGetCount !== undefined &&
      states.runtime.productNonGetCount > 0
    ) ||
    states.runtime?.persistenceViolation === true ||
    states.passReason === "SAFETY_VIOLATION" ||
    states.passReason === "TRANSPORT_VIOLATION" ||
    states.passReason === "PERSISTENCE_VIOLATION" ||
    result?.reasonCategory === "MUTATION_SAFETY_GUARD"
  ) {
    addBlocker(blockers, {
      family: "SAFETY",
      typedReason:
        states.passReason ??
        result?.reasonCategory ??
        "SAFETY_VIOLATION",
      explanation:
        "Existing browser safety prerequisites prevent acceptance proof.",
    });
  }
  for (const item of
    result?.localStateTransitionEvidence ?? []) {
    if (item.result !== "ABSTAINED") continue;
    if (
      item.reason === "CONTROL_NOT_GROUNDED" ||
      item.reason === "CONTROL_IDENTITY_CHANGED" ||
      item.reason === "TARGET_SURFACE_LOST"
    ) {
      addBlocker(blockers, {
        family: "RUNTIME_GROUNDING",
        typedReason: item.reason,
        explanation:
          "The deterministic proof mechanism honestly abstained because exact runtime grounding was not established.",
      });
    } else if (
      item.reason === "LOCAL_ACTION_NOT_AUTHORIZED" ||
      item.reason === "NON_GET_REQUEST_ATTEMPTED"
    ) {
      addBlocker(blockers, {
        family: "SAFETY",
        typedReason: item.reason,
        explanation:
          "The deterministic proof mechanism honestly abstained at an existing safety boundary.",
      });
    } else {
      addBlocker(blockers, {
        family: "DETERMINISTIC_PROOF",
        typedReason: item.reason,
        explanation:
          "The deterministic proof mechanism honestly abstained without creating proof or contradiction.",
      });
    }
  }

  const reviewerObligations = obligations.map(
    (obligation): ReviewerBrowserObligation => {
      const binding = uniqueBinding(
        bindings,
        obligation.id
      );
      const v2Represented =
        v2StableCaseRepresentation({
          plan,
          obligationId: obligation.id,
          caseId: testCase.id,
        });
      const representation = caseRepresentation({
        plan,
        obligationId: obligation.id,
        caseId: testCase.id,
        binding,
      });
      const support =
        v2Represented &&
        hasV2BoundProofCapability(
          testCase,
          obligation.id
        )
          ? "SUPPORTED" as const
          : automationSupport(
              binding,
              requirementIds
            );
      if (
        support === "UNSUPPORTED" ||
        support === "SUPPORTED_NOT_BOUND" ||
        support === "NOT_ESTABLISHED"
      ) {
        addBlocker(blockers, {
          family: "TYPED_AUTOMATION_SUPPORT",
          typedReason:
            binding?.state ?? "BINDING_MISSING",
          explanation:
            binding?.emittedRequirementIds?.length &&
            support === "NOT_ESTABLISHED"
              ? "A requirement ID was emitted, but the corresponding typed requirement object is absent from this case. Reporting does not reconstruct it."
              : "Typed automation support is absent, unsupported, or not bound for this obligation.",
        });
      }
      if (representation !== "REPRESENTED") {
        addBlocker(blockers, {
          family: "CASE_REPRESENTATION",
          typedReason:
            binding?.state ?? "BINDING_MISSING",
          explanation:
            "The authoritative obligation is not represented by a stable V2 runtime case or one exact legacy case allocation.",
        });
      }

      return {
        obligationId: obligation.id,
        text: obligation.text,
        sourceRole: obligation.sourceRole,
        bindingState: v2Represented
          ? "V2_RUNTIME_CASE_REPRESENTED"
          : binding?.state ?? "MISSING",
        automationSupport: support,
        proofState: obligationProofState({
          obligationId: obligation.id,
          representation,
          support,
          result,
          route: states.route,
          target: states.target,
          fixture: states.fixture,
        }),
      };
    }
  );

  const remainingManual =
    getRemainingBrowserManualAcceptanceChecks(
      testCase,
      result
    );
  const unproved = reviewerObligations.filter(
    (item) => item.proofState !== "PROVED"
  );
  if (remainingManual.length > 0 || unproved.length > 0) {
    addBlocker(blockers, {
      family: "COMPLETENESS",
      typedReason:
        result?.caseProofReadiness?.status ??
        "ACCEPTANCE_COVERAGE_REMAINS",
      explanation:
        `${unproved.length} authoritative obligation(s) and ${remainingManual.length} manual acceptance check(s) remain unproved.`,
    });
  }
  if (
    reviewerObligations.some(
      (item) =>
        item.proofState === "SUPPORTED_NOT_PROVED"
    )
  ) {
    addBlocker(blockers, {
      family: "DETERMINISTIC_PROOF",
      typedReason: "EXACT_DISCHARGE_MISSING",
      explanation:
        "Typed automation support exists, but no exact deterministic obligation discharge was recorded.",
    });
  }

  const evidence = buildEvidence(result);
  const verified = evidence
    .filter(
      (item) =>
        item.authority ===
          "DETERMINISTIC_ACCEPTANCE_PROOF" ||
        item.authority === "DETERMINISTIC_CHECK" &&
          item.result === "CONFIRMED"
    )
    .map((item) =>
      item.authority ===
        "DETERMINISTIC_ACCEPTANCE_PROOF"
        ? `${item.summary} (${item.kind})`
        : `${item.summary} (narrow deterministic check; not an obligation discharge)`
    );
  const observedButNotProved = evidence
    .filter((item) => item.authority === "SUPPLEMENTARY")
    .map((item) =>
      `${item.kind}${item.result ? ` ${item.result}` : ""}: ${item.summary}`
    );
  const unverified = [
    ...unproved.map(
      (item) =>
        `${item.obligationId}: ${item.text} [${item.proofState}]`
    ),
    ...remainingManual.map(
      (check) => `Manual acceptance check: ${check}`
    ),
  ];

  return {
    caseId: testCase.id,
    goal: testCase.goal,
    finalStatus: result?.status ?? "NOT_RUN",
    finalReason:
      result?.reasonCategory ??
      (result
        ? "No typed final reason was provided."
        : "No runtime result was provided."),
    startRoute:
      result?.startRoute ?? testCase.startRoute,
    route: states.route,
    target: states.target,
    fixture: states.fixture,
    authorityEstablished,
    authorityNote: authorityEstablished
      ? `${reviewerObligations.length} authoritative obligation(s) are allocated to this case.`
      : "Deterministic acceptance verification was not attempted from planner prose because no high-confidence authoritative browser obligation was established for this generated case.",
    authoritativeObligations:
      reviewerObligations,
    verified,
    observedButNotProved,
    unverified,
    blockers,
    evidence,
    caseProofReadiness:
      result?.caseProofReadiness?.status ??
      "NOT_ESTABLISHED",
  };
}

export function buildReviewerBrowserCaseSummaries(args: {
  plan: TestPlan;
  browserResults?: ReviewerBrowserResultInput[];
}): ReviewerBrowserCaseSummary[] {
  const results = args.browserResults ?? [];
  const resultById = new Map(
    results.map((result) => [result.id, result])
  );
  const summaries = args.plan.browserCases.map(
    (testCase) =>
      buildCaseSummary({
        plan: args.plan,
        testCase,
        result: resultById.get(testCase.id),
      })
  );

  return summaries;
}

function md(value: unknown): string {
  return String(value ?? "")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function list(values: string[], empty: string): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${empty}`;
}

export function renderReviewerBrowserQaSection(args: {
  plan: TestPlan;
  browserResults?: ReviewerBrowserResultInput[];
}): string {
  const summaries =
    buildReviewerBrowserCaseSummaries(args);
  const statusCounts = summaries.reduce<
    Record<string, number>
  >((counts, summary) => {
    counts[summary.finalStatus] =
      (counts[summary.finalStatus] ?? 0) + 1;
    return counts;
  }, {});
  const obligations = summaries.flatMap(
    (summary) => summary.authoritativeObligations
  );
  const uniqueObligationIds = new Set(
    obligations.map((item) => item.obligationId)
  );
  const provedObligationIds = new Set(
    obligations
      .filter((item) => item.proofState === "PROVED")
      .map((item) => item.obligationId)
  );
  const casesWith = (families: ReviewerBlockerFamily[]) =>
    summaries.filter((summary) =>
      summary.blockers.some((blocker) =>
        families.includes(blocker.family)
      )
    ).length;

  const summaryLines = [
    `- **Browser cases:** ${summaries.length}`,
    ...Object.entries(statusCounts)
      .sort(([left], [right]) =>
        left.localeCompare(right)
      )
      .map(([status, count]) =>
        `- **Final ${status}:** ${count}`
      ),
    `- **Authoritative obligations represented:** ${uniqueObligationIds.size}`,
    `- **Exactly proved obligations:** ${provedObligationIds.size}`,
    `- **Unsupported or unverified obligations:** ${uniqueObligationIds.size - provedObligationIds.size}`,
    `- **Cases blocked by route:** ${casesWith(["ROUTE"])}`,
    `- **Cases blocked by fixture/data:** ${casesWith(["FIXTURE_DATA"])}`,
    `- **Cases blocked by target/grounding:** ${casesWith(["TARGET", "RUNTIME_GROUNDING"])}`,
  ];

  const sections = summaries.map((summary) => {
    const obligationsTable =
      summary.authoritativeObligations.length > 0
        ? [
            "| Requirement | Source role | Allocation | Automation | Proof |",
            "| --- | --- | --- | --- | --- |",
            ...summary.authoritativeObligations.map(
              (item) =>
                `| ${md(item.text)} | ${item.sourceRole} | ${item.bindingState} | ${item.automationSupport} | ${item.proofState} |`
            ),
          ].join("\n")
        : summary.authorityNote;
    const blockers = summary.blockers.map(
      (item) =>
        `**${item.family}** — ${item.typedReason}: ${item.explanation}`
    );
    const evidence = summary.evidence.map(
      (item) =>
        `**${item.authority} / ${item.kind}**` +
        `${item.result ? ` — ${item.result}` : ""}` +
        `${item.reference ? ` — ${item.reference}` : ""}: ` +
        item.summary
    );

    return `### ${md(summary.caseId)} — ${md(summary.goal)}

- **Final:** ${summary.finalStatus}
- **Final reason:** ${summary.finalReason}
- **Route:** ${summary.route.state} — ${summary.route.detail}
- **Target:** ${summary.target.state} — ${summary.target.detail}
- **Fixture:** ${summary.fixture.state} — ${summary.fixture.detail}
- **Case proof readiness:** ${summary.caseProofReadiness} (independent completeness metadata; not a final verdict)

#### Authoritative acceptance coverage

${obligationsTable}

#### Deterministically verified

${list(summary.verified, "No deterministic verification was recorded.")}

#### Observed but not proved — supplementary

${list(summary.observedButNotProved, "No supplementary observation was recorded.")}

#### Still unverified

${list(summary.unverified, "No remaining authoritative or manual acceptance item was recorded.")}

#### Blockers

${list(blockers, "No typed blocker was established.")}

#### Evidence

${list(evidence, "No typed evidence reference was recorded.")}`;
  });

  return `## Reviewer Browser QA Summary

${summaryLines.join("\n")}

${sections.join("\n\n")}
`;
}
