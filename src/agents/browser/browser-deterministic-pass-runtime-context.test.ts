import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserTestCase, PlannerAcceptanceObligationLedger, PlannerAcceptanceSourceLedger } from "../../planner/types.js";
import {
  auditBrowserCaseProofReadiness,
  type BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import {
  allocateBrowserRuntimeSourceAssertions,
  buildBrowserSourceBoundAssertionSetRequirements,
  evaluateBrowserSourceBoundAssertionSet,
  evaluateBrowserSourceBoundAssertionSetDischarge,
} from "./browser-source-bound-assertion-set-proof.js";
import {
  buildBrowserDeterministicPassRuntimeContext,
  deriveBrowserDeterministicProofRuntimeSignals,
  materializeBrowserDeterministicPassRuntimePrerequisites,
} from "./browser-deterministic-pass-runtime-context.js";
import { attemptDeterministicBrowserPass } from "./browser-deterministic-pass-attempt.js";
import type { BrowserStepResult } from "./browser-execution-types.js";
import type {
  BrowserSourceBoundStructuralControlPresenceEvidence,
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "./browser-source-bound-structural-control-presence-proof.js";

const sourceLedger: PlannerAcceptanceSourceLedger = {
  sourceStatus: "RESOLVED", basis: "ACCEPTANCE_CRITERIA",
  sourceUnits: [{ id: "ac-1", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira:AC-1", text: "The control uses Alpha and Beta." }],
};
const ledger: PlannerAcceptanceObligationLedger = {
  sourceStatus: "RESOLVED", derivationStatus: "RESOLVED", unresolvedSourceUnitIds: [],
  obligations: [{ id: "ob-1", sourceUnitIds: ["ac-1"], sourceRole: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", text: "The control uses Alpha and Beta." }],
};
function browserCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  return { id: "case-1", persona: "company_admin", goal: "Observe control", startRoute: "/control", successCriteria: "Alpha and Beta visible", acceptanceObligationIds: ["ob-1"], steps: ["Alpha", "Beta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `oracle-${text}` })), ...overrides };
}
function sourceProofFixture(overrides: { allCases?: BrowserTestCase[]; actualPersona?: string | null; acceptedRoutePath?: string; evidenceRoutePath?: string } = {}) {
  const testCase = browserCase();
  const acceptedRoutePath = overrides.acceptedRoutePath ?? "/control";
  const requirement = buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: ledger, sourceLedger, acceptedRoutePath })[0]!;
  const evidence = evaluateBrowserSourceBoundAssertionSet({ requirement, deterministicEvidence: requirement.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "confirmed" })), actualPersona: overrides.actualPersona ?? "company_admin", actualRoutePath: overrides.evidenceRoutePath ?? acceptedRoutePath, freshObservation: true });
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: testCase, allCases: overrides.allCases ?? [testCase], obligationLedger: ledger, requirements: [requirement] })[0]!;
  const discharge = evaluateBrowserSourceBoundAssertionSetDischarge({ testCase, obligationLedger: ledger, allocation, requirement, evidence });
  if (discharge.status !== "DETERMINISTIC_OBLIGATION_PROVED") throw new Error("invalid source proof fixture");
  return { testCase, requirement, evidence, allocation, discharge: discharge.discharge };
}

function structuralProofFixture() {
  const testCase = browserCase({ id: "structural-case" });
  const requirement: BrowserSourceBoundStructuralControlPresenceRequirement = {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT",
    requirementId: "structural-search",
    obligationId: "ob-1",
    sourceUnitIds: ["ac-1"],
    sourceRefs: ["jira:AC-1"],
    sourceRole: "ACCEPTANCE",
    proofAuthority: "ACCEPTANCE",
    derivation: "DIRECT_ACCEPTANCE_FIELD",
    executionCaseId: testCase.id,
    persona: "company_admin",
    routePath: "/control",
    control: { semanticKind: "SEARCH_INPUT", cardinality: "AT_LEAST_ONE" },
  };
  const evidence: BrowserSourceBoundStructuralControlPresenceEvidence = {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE",
    proofRequirementId: requirement.requirementId,
    obligationId: requirement.obligationId,
    executionCaseId: testCase.id,
    sourceUnitIds: requirement.sourceUnitIds,
    sourceRefs: requirement.sourceRefs,
    persona: requirement.persona,
    routePath: requirement.routePath,
    freshObservation: true,
    control: requirement.control,
    matchingControlCount: 1,
    result: "CONFIRMED",
  };
  return { testCase, requirement, evidence };
}

function deriveStructuralSignals(overrides: {
  testCase?: BrowserTestCase;
  requirement?: BrowserSourceBoundStructuralControlPresenceRequirement;
  evidence?: BrowserSourceBoundStructuralControlPresenceEvidence;
  acceptedRoutePath?: string;
  actualPersona?: string | null;
} = {}) {
  const fixture = structuralProofFixture();
  const testCase = overrides.testCase ?? fixture.testCase;
  const requirement = overrides.requirement ?? fixture.requirement;
  const evidence = overrides.evidence ?? fixture.evidence;
  return deriveBrowserDeterministicProofRuntimeSignals({
    testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    localStateProofs: [],
    sourceBoundAssertionSetProofs: [],
    structuralControlPresenceProofs: [{ requirement, evidence }],
    deterministicObligationDischarges: [],
    caseProofReadiness: auditBrowserCaseProofReadiness({ testCase, discharges: [], browserObligationBindings: [] }),
    acceptedRoutePath: overrides.acceptedRoutePath ?? "/control",
    actualPersona: overrides.actualPersona ?? "company_admin",
  });
}

function assertTargetNotVerified(signal: ReturnType<typeof deriveBrowserDeterministicProofRuntimeSignals>['targetVerified']): void {
  assert.equal(signal.status, "AVAILABLE");
  if (signal.status === "AVAILABLE") assert.equal(signal.value, false);
}

test("missing case-wide safety and transport signals fail closed without PASS prerequisites", () => {
  const context = buildBrowserDeterministicPassRuntimeContext({
    fixtureStatus: { status: "AVAILABLE", value: "NOT_REQUIRED", source: "fixture lifecycle" },
    acceptedRoutePath: { status: "AVAILABLE", value: "/safe", source: "accepted route" },
  });
  assert.equal(context.productNonGetCount.status, "UNAVAILABLE");
  assert.equal(context.persistenceViolation.status, "UNAVAILABLE");
  assert.equal(materializeBrowserDeterministicPassRuntimePrerequisites(context), null);
});

test("materializes only complete explicitly authoritative prerequisite signals", () => {
  const available = <T>(value: T) => ({ status: "AVAILABLE" as const, value, source: "test-authoritative-signal" });
  const context = buildBrowserDeterministicPassRuntimeContext({ fixtureStatus: available("NOT_REQUIRED" as const), acceptedRoutePath: available("/safe"), targetVerified: available(true), requiredExecutionCompleted: available(true), safetyViolation: available(false), testDataIssue: available(false), productNonGetCount: available(0), persistenceViolation: available(false) });
  assert.deepEqual(materializeBrowserDeterministicPassRuntimePrerequisites(context), { fixtureStatus: "NOT_REQUIRED", acceptedRoutePath: "/safe", targetVerified: true, requiredExecutionCompleted: true, safetyViolation: false, testDataIssue: false, productNonGetCount: 0, persistenceViolation: false });
});

test("goal or assertion handoff observations without exact deterministic proof inputs stay unavailable", () => {
  const signals = deriveBrowserDeterministicProofRuntimeSignals({});
  assert.equal(signals.targetVerified.status, "UNAVAILABLE");
  assert.equal(signals.requiredExecutionCompleted.status, "UNAVAILABLE");
});

test("case-local structural target proof is independent from ticket readiness", () => {
  const fixture = structuralProofFixture();
  const signals = deriveBrowserDeterministicProofRuntimeSignals({
    testCase: fixture.testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    localStateProofs: [],
    sourceBoundAssertionSetProofs: [],
    structuralControlPresenceProofs: [{ requirement: fixture.requirement, evidence: fixture.evidence }],
    deterministicObligationDischarges: [],
    acceptedRoutePath: "/control",
    actualPersona: "company_admin",
  });
  assert.deepEqual(signals.targetVerified, {
    status: "AVAILABLE",
    value: true,
    source: "Fresh source-bound evidence independently verified the exact case-local target context.",
  });
  assert.equal(signals.requiredExecutionCompleted.status, "UNAVAILABLE");
});

test("fresh source assertion evidence verifies the local target without unlocking ticket completion", () => {
  const fixture = sourceProofFixture();
  const readiness = auditBrowserCaseProofReadiness({
    testCase: fixture.testCase,
    discharges: [],
    browserObligationBindings: [],
  });

  const signals = deriveBrowserDeterministicProofRuntimeSignals({
    testCase: fixture.testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    localStateProofs: [],
    sourceBoundAssertionSetProofs: [{
      kind: "SOURCE_BOUND_ASSERTION_SET",
      requirement: fixture.requirement,
      evidence: fixture.evidence,
      allocation: fixture.allocation,
    }],
    deterministicObligationDischarges: [],
    caseProofReadiness: readiness,
    acceptedRoutePath: "/control",
    actualPersona: "company_admin",
  });

  assert.equal(signals.targetVerified.status, "AVAILABLE");
  if (signals.targetVerified.status === "AVAILABLE") {
    assert.equal(signals.targetVerified.value, true);
  }

  assert.equal(
    signals.requiredExecutionCompleted.status,
    "AVAILABLE"
  );
  if (signals.requiredExecutionCompleted.status === "AVAILABLE") {
    assert.equal(
      signals.requiredExecutionCompleted.value,
      false
    );
  }
});

test("fresh source-authorized structural evidence verifies the exact local target", () => {
  const testCase = browserCase({
    id: "discovery-search",
    executionPolicy: { lane: "DISCOVERY_ONLY" },
  });
  const requirement: BrowserSourceBoundStructuralControlPresenceRequirement = {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT",
    requirementId: "structural-search",
    obligationId: "ob-1",
    sourceUnitIds: ["ac-1"],
    sourceRefs: ["jira:AC-1"],
    sourceRole: "ACCEPTANCE",
    proofAuthority: "ACCEPTANCE",
    derivation: "DIRECT_ACCEPTANCE_FIELD",
    executionCaseId: testCase.id,
    persona: "company_admin",
    routePath: "/control",
    control: { semanticKind: "SEARCH_INPUT", cardinality: "AT_LEAST_ONE" },
  };
  const evidence: BrowserSourceBoundStructuralControlPresenceEvidence = {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE",
    proofRequirementId: requirement.requirementId,
    obligationId: requirement.obligationId,
    executionCaseId: testCase.id,
    sourceUnitIds: requirement.sourceUnitIds,
    sourceRefs: requirement.sourceRefs,
    persona: requirement.persona,
    routePath: requirement.routePath,
    freshObservation: true,
    control: requirement.control,
    matchingControlCount: 1,
    result: "CONFIRMED",
  };
  const signals = deriveBrowserDeterministicProofRuntimeSignals({
    testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    localStateProofs: [],
    sourceBoundAssertionSetProofs: [],
    structuralControlPresenceProofs: [{ requirement, evidence }],
    deterministicObligationDischarges: [],
    caseProofReadiness: auditBrowserCaseProofReadiness({ testCase, discharges: [], browserObligationBindings: [] }),
    acceptedRoutePath: "/control",
    actualPersona: "company_admin",
  });
  assert.deepEqual(signals.targetVerified, {
    status: "AVAILABLE",
    value: true,
    source: "Fresh source-bound evidence independently verified the exact case-local target context.",
  });
});

test("structural target verification fails closed for stale, foreign, or mismatched proof", () => {
  const fixture = structuralProofFixture();
  assertTargetNotVerified(deriveStructuralSignals({ evidence: { ...fixture.evidence, result: "NOT_CONFIRMED" } }).targetVerified);
  assertTargetNotVerified(deriveStructuralSignals({ evidence: { ...fixture.evidence, executionCaseId: "other-case" } }).targetVerified);
  assertTargetNotVerified(deriveStructuralSignals({ evidence: { ...fixture.evidence, routePath: "/other" } }).targetVerified);
  assertTargetNotVerified(deriveStructuralSignals({ evidence: { ...fixture.evidence, persona: "talent" }, actualPersona: "company_admin" }).targetVerified);
});

test("exact source-bound proof verifies its target, while proof readiness independently controls completion", () => {
  const fixture = sourceProofFixture();
  const readiness = auditBrowserCaseProofReadiness({ testCase: fixture.testCase, discharges: [fixture.discharge], browserObligationBindings: [] });
  const base = {
    testCase: fixture.testCase, obligationLedger: ledger, browserObligationBindings: [], localStateProofs: [],
    sourceBoundAssertionSetProofs: [{ kind: "SOURCE_BOUND_ASSERTION_SET" as const, requirement: fixture.requirement, evidence: fixture.evidence, allocation: fixture.allocation }],
    deterministicObligationDischarges: [fixture.discharge], caseProofReadiness: readiness, acceptedRoutePath: "/control", actualPersona: "company_admin",
  };
  const complete = deriveBrowserDeterministicProofRuntimeSignals(base);
  assert.deepEqual(complete.targetVerified, { status: "AVAILABLE", value: true, source: "An approved deterministic proof independently revalidated the exact case target context." });
  assert.deepEqual(complete.requiredExecutionCompleted, { status: "AVAILABLE", value: true, source: "Independent deterministic discharge validation and readiness audit prove complete allocated-obligation execution." });

  const partialCase = { ...fixture.testCase, acceptanceObligationIds: ["ob-1", "ob-2"] };
  const partialReadiness = auditBrowserCaseProofReadiness({ testCase: partialCase, discharges: [fixture.discharge], browserObligationBindings: [] });
  const partial = deriveBrowserDeterministicProofRuntimeSignals({ ...base, testCase: partialCase, caseProofReadiness: partialReadiness });
  assert.equal(partial.requiredExecutionCompleted.status, "AVAILABLE");
  if (partial.requiredExecutionCompleted.status === "AVAILABLE") assert.equal(partial.requiredExecutionCompleted.value, false);
});

test("planner lane does not participate in proof-owned prerequisite derivation", () => {
  const fixture = sourceProofFixture();
  const readiness = auditBrowserCaseProofReadiness({ testCase: fixture.testCase, discharges: [fixture.discharge], browserObligationBindings: [] });
  const derive = (testCase: BrowserTestCase) => deriveBrowserDeterministicProofRuntimeSignals({
    testCase, obligationLedger: ledger, browserObligationBindings: [], localStateProofs: [],
    sourceBoundAssertionSetProofs: [{ kind: "SOURCE_BOUND_ASSERTION_SET", requirement: fixture.requirement, evidence: fixture.evidence, allocation: fixture.allocation }],
    deterministicObligationDischarges: [fixture.discharge], caseProofReadiness: readiness, acceptedRoutePath: "/control", actualPersona: "company_admin",
  });
  assert.deepEqual(
    derive({ ...fixture.testCase, executionPolicy: { lane: "DISCOVERY_ONLY" } }),
    derive(fixture.testCase)
  );
});

test("ticket allocation ambiguity does not erase local target proof, while stale or wrong runtime context still does", () => {
  const first = sourceProofFixture();

  const ambiguousAllocation =
    allocateBrowserRuntimeSourceAssertions({
      currentCase: first.testCase,
      allCases: [
        first.testCase,
        { ...first.testCase, id: "case-2" },
      ],
      obligationLedger: ledger,
      requirements: [first.requirement],
    })[0]!;

  const candidates = [
    {
      name: "ticket allocation ambiguity",
      allocation: ambiguousAllocation,
      evidence: first.evidence,
      actualPersona: "company_admin",
      acceptedRoutePath: "/control",
      suppliedDischarges: [],
      expectedTargetVerified: true,
    },
    {
      name: "stale evidence",
      allocation: first.allocation,
      evidence: {
        ...first.evidence,
        freshObservation: false,
      },
      actualPersona: "company_admin",
      acceptedRoutePath: "/control",
      suppliedDischarges: [first.discharge],
      expectedTargetVerified: false,
    },
    {
      name: "wrong persona",
      allocation: first.allocation,
      evidence: first.evidence,
      actualPersona: "talent",
      acceptedRoutePath: "/control",
      suppliedDischarges: [first.discharge],
      expectedTargetVerified: false,
    },
    {
      name: "wrong route",
      allocation: first.allocation,
      evidence: first.evidence,
      actualPersona: "company_admin",
      acceptedRoutePath: "/other",
      suppliedDischarges: [first.discharge],
      expectedTargetVerified: false,
    },
  ];

  for (const candidate of candidates) {
    const readiness = auditBrowserCaseProofReadiness({
      testCase: first.testCase,
      discharges: candidate.suppliedDischarges,
      browserObligationBindings: [],
    });

    const signals =
      deriveBrowserDeterministicProofRuntimeSignals({
        testCase: first.testCase,
        obligationLedger: ledger,
        browserObligationBindings: [],
        localStateProofs: [],
        sourceBoundAssertionSetProofs: [{
          kind: "SOURCE_BOUND_ASSERTION_SET",
          requirement: first.requirement,
          evidence: candidate.evidence,
          allocation: candidate.allocation,
        }],
        deterministicObligationDischarges:
          candidate.suppliedDischarges,
        caseProofReadiness: readiness,
        acceptedRoutePath:
          candidate.acceptedRoutePath,
        actualPersona: candidate.actualPersona,
      });

    assert.equal(
      signals.targetVerified.status,
      "AVAILABLE",
      candidate.name
    );

    if (signals.targetVerified.status === "AVAILABLE") {
      assert.equal(
        signals.targetVerified.value,
        candidate.expectedTargetVerified,
        candidate.name
      );
    }
  }
});

function completeRuntimeContext(overrides: Partial<{
  targetVerified: boolean;
  requiredExecutionCompleted: boolean;
  safetyViolation: boolean;
  testDataIssue: boolean;
  productNonGetCount: number;
  persistenceViolation: boolean;
}> = {}) {
  const available = <T>(value: T) => ({ status: "AVAILABLE" as const, value, source: "controlled authoritative test signal" });
  return buildBrowserDeterministicPassRuntimeContext({
    fixtureStatus: available("NOT_REQUIRED" as const),
    acceptedRoutePath: available("/control"),
    targetVerified: available(overrides.targetVerified ?? true),
    requiredExecutionCompleted: available(overrides.requiredExecutionCompleted ?? true),
    safetyViolation: available(overrides.safetyViolation ?? false),
    testDataIssue: available(overrides.testDataIssue ?? false),
    productNonGetCount: available(overrides.productNonGetCount ?? 0),
    persistenceViolation: available(overrides.persistenceViolation ?? false),
  });
}

function attemptSourceBoundPass(args: {
  testCase: BrowserTestCase;
  requirement: ReturnType<typeof buildBrowserSourceBoundAssertionSetRequirements>[number];
  evidence: ReturnType<typeof evaluateBrowserSourceBoundAssertionSet>;
  allocation: ReturnType<typeof allocateBrowserRuntimeSourceAssertions>[number];
  discharges: BrowserDeterministicObligationDischarge[];
  context: ReturnType<typeof buildBrowserDeterministicPassRuntimeContext>;
}) {
  const currentResult: BrowserStepResult = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    notes: [],
    deterministicObligationDischarges: args.discharges,
    caseProofReadiness: auditBrowserCaseProofReadiness({
      testCase: args.testCase,
      discharges: args.discharges,
      browserObligationBindings: [],
    }),
  };
  const attempt = attemptDeterministicBrowserPass({
    testCase: args.testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    currentResult,
    localStatePassProofs: [],
    sourceBoundAssertionSetPassProofs: [{
      kind: "SOURCE_BOUND_ASSERTION_SET",
      requirement: args.requirement,
      evidence: args.evidence,
      allocation: args.allocation,
    }],
    deterministicPassRuntimeContext: args.context,
  });
  return { attempt, currentResult };
}

test("shared deterministic PASS attempt records complete proof without owning canonical case status", () => {
  for (const testCase of [
    browserCase(),
    browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } }),
  ]) {
    const fixture = sourceProofFixture();
    const { attempt, currentResult } = attemptSourceBoundPass({
      testCase,
      requirement: fixture.requirement,
      evidence: fixture.evidence,
      allocation: fixture.allocation,
      discharges: [fixture.discharge],
      context: completeRuntimeContext(),
    });
    assert.equal(attempt.status, "ATTEMPTED");
    assert.equal(currentResult.status, "MANUAL_REQUIRED");
  }
});

test("shared deterministic PASS attempt fails closed for unavailable context or no proof bundle", () => {
  const fixture = sourceProofFixture();
  const missingContextResult: BrowserStepResult = { status: "MANUAL_REQUIRED", reasonCategory: "AUTOMATION_LIMITATION", notes: [] };
  const missingContext = attemptDeterministicBrowserPass({
    testCase: fixture.testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    currentResult: missingContextResult,
    localStatePassProofs: [],
    sourceBoundAssertionSetPassProofs: [{ kind: "SOURCE_BOUND_ASSERTION_SET", requirement: fixture.requirement, evidence: fixture.evidence, allocation: fixture.allocation }],
    deterministicPassRuntimeContext: buildBrowserDeterministicPassRuntimeContext({}),
  });
  assert.deepEqual(missingContext, { status: "NOT_ATTEMPTED", reason: "RUNTIME_PREREQUISITES_UNAVAILABLE" });
  assert.equal(missingContextResult.status, "MANUAL_REQUIRED");

  const noProofResult: BrowserStepResult = { status: "MANUAL_REQUIRED", reasonCategory: "AUTOMATION_LIMITATION", notes: [] };
  const noProof = attemptDeterministicBrowserPass({
    testCase: fixture.testCase,
    obligationLedger: ledger,
    browserObligationBindings: [],
    currentResult: noProofResult,
    localStatePassProofs: [],
    sourceBoundAssertionSetPassProofs: [],
    deterministicPassRuntimeContext: completeRuntimeContext(),
  });
  assert.deepEqual(noProof, { status: "NOT_ATTEMPTED", reason: "NO_APPROVED_PROOF_BUNDLE" });
  assert.equal(noProofResult.status, "MANUAL_REQUIRED");
});

test("shared deterministic PASS attempt does not override incomplete proof or unsafe runtime prerequisites", () => {
  const fixture = sourceProofFixture();
  for (const context of [
    completeRuntimeContext({ requiredExecutionCompleted: false }),
    completeRuntimeContext({ targetVerified: false }),
    completeRuntimeContext({ safetyViolation: true }),
    completeRuntimeContext({ productNonGetCount: 1 }),
    completeRuntimeContext({ persistenceViolation: true }),
    completeRuntimeContext({ testDataIssue: true }),
  ]) {
    const { attempt, currentResult } = attemptSourceBoundPass({
      testCase: fixture.testCase,
      requirement: fixture.requirement,
      evidence: fixture.evidence,
      allocation: fixture.allocation,
      discharges: [fixture.discharge],
      context,
    });
    assert.equal(attempt.status, "ATTEMPTED");
    assert.equal(currentResult.status, "MANUAL_REQUIRED");
  }
});
