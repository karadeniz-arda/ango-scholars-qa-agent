import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import type {
  BrowserTestCase,
  PlannerBrowserDeterministicProofBinding,
  PlannerExecutionSurfacePrerequisiteContract,
} from "../../planner/types.js";
import type { BrowserDeterministicEvidence } from "./evidence-review.js";
import {
  executeBrowserEvidenceContractProofs,
  summarizeBrowserEvidenceContractProofCoverage,
  type BrowserEvidenceContractProofResult,
} from "./browser-evidence-contract-proof.js";
import type {
  BrowserRuntimeFixturePreparationResult,
} from "./browser-runtime-fixture-preparation.js";
import type { BrowserObservation } from "./browser-observation.js";

type TextProofBinding = Extract<
  PlannerBrowserDeterministicProofBinding,
  { capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE" }
>;
type SearchInputProofBinding = Extract<
  PlannerBrowserDeterministicProofBinding,
  { capabilityKind: "SEARCH_INPUT_PRESENT" }
>;

function searchContract(): PlannerExecutionSurfacePrerequisiteContract {
  return {
    schemaVersion: 1, prerequisiteId: "search-prerequisite-1",
    status: "SURFACE_RUNTIME_RESOLUTION_REQUIRED", kind: "SEARCH_INPUT",
    authority: "SOURCE_AUTHORIZED",
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.description" }],
    surfacePartition: {
      partitionId: "partition-1", verdictGroupId: "group-1", obligationId: "obligation-1",
      memberId: "all-payments", surface: "all payments",
    },
    executionContext: {
      executionContainerId: "container-1", semanticCandidateId: "candidate-1",
      executionCaseId: "source-search", route: "/company/all-payments", persona: "company_admin",
    },
    acceptanceCoverage: {
      policy: "ALL_REQUIRED", requiredMemberIds: ["all-payments", "payments"],
      plannedMemberIds: ["all-payments"], memberId: "all-payments",
    },
    selectionPolicy: "UNIQUE_GROUNDED_CONTROL_ONLY",
    ambiguityPolicy: "BLOCK_SURFACE_UNAVAILABLE", runtimeBinding: "NOT_YET_RESOLVED",
    surfaceReadyForInteraction: false,
  };
}

function searchBinding(): SearchInputProofBinding {
  const contract = searchContract();
  return {
    schemaVersion: 1, bindingId: "search-binding-1", evidenceContractId: "contract-1",
    obligationId: "obligation-1", executionCaseId: contract.executionContext.executionCaseId,
    capabilityKind: "SEARCH_INPUT_PRESENT", authority: "SOURCE_AUTHORIZED",
    prerequisite: {
      kind: "SEARCH_INPUT", prerequisiteId: contract.prerequisiteId,
      sourceUnitRefs: contract.sourceUnitRefs,
      selectionPolicy: "UNIQUE_GROUNDED_CONTROL_ONLY",
      ambiguityPolicy: "BLOCK_SURFACE_UNAVAILABLE",
      surfacePartitionId: contract.surfacePartition.partitionId,
    },
    runtimePreconditions: {
      persona: "company_admin", route: "/company/all-payments",
      requiresRuntimeFixtureBinding: false,
    },
    acceptanceCoverage: contract.acceptanceCoverage,
  };
}

function searchCase(proofBinding: SearchInputProofBinding): BrowserTestCase {
  return {
    id: "runtime-search-case", persona: "company_admin", goal: "candidate",
    startRoute: "/company/all-payments", successCriteria: "candidate",
    deterministicProofBindings: [proofBinding],
    executionSurfacePrerequisiteContract: searchContract(),
  };
}

function searchObservation(inputs: BrowserObservation["inputs"]): BrowserObservation {
  return { url: "https://staging.invalid/company/all-payments", inputs } as BrowserObservation;
}

const visibleSearchInput: BrowserObservation["inputs"][number] = {
  label: "", placeholder: "Search invoices", role: "searchbox", type: "search",
  disabled: false, activationSafe: true, expanded: null, required: false, hasValue: false,
};

function binding(
  memberId: "processed" | "sent-for-processing",
  overrides: Partial<TextProofBinding> = {}
): TextProofBinding {
  return {
    schemaVersion: 1,
    bindingId: `binding-${memberId}`,
    evidenceContractId: `contract-${memberId}`,
    obligationId: "obligation-1",
    executionCaseId: `source-${memberId}`,
    capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE",
    authority: "SOURCE_AUTHORIZED",
    assertion: {
      action: "assertTextVisible",
      oracleId: `oracle-${memberId}`,
      expectedText: "Owner Name",
      sourceUnitId: "source-label",
      sourceRef: "jira.description",
    },
    surface: {
      kind: "EXPANDED_DETAIL_SURFACE",
      sourceUnitId: "source-surface",
      sourceRef: "jira.description",
    },
    runtimePreconditions: {
      persona: "company_admin",
      route: "/company/items",
      requiresRuntimeFixtureBinding: true,
    },
    acceptanceCoverage: {
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["processed", "sent-for-processing"],
      plannedMemberIds: [memberId],
      memberId,
    },
    ...overrides,
  };
}

function browserCase(
  proofBinding: PlannerBrowserDeterministicProofBinding
): BrowserTestCase {
  return {
    id: `runtime-${proofBinding.executionCaseId}`,
    persona: "company_admin",
    goal: "candidate",
    startRoute: "/company/items",
    successCriteria: "candidate",
    deterministicProofBindings: [proofBinding],
    runtimeFixtureResolutionContract: {
      status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      policy: "ALL_REQUIRED",
      members: [],
      interactionExecutionCaseId: proofBinding.executionCaseId,
      fixtureReadyForInteraction: false,
    },
  };
}

function preparation(
  proofBinding: PlannerBrowserDeterministicProofBinding
): BrowserRuntimeFixturePreparationResult {
  const state = proofBinding.acceptanceCoverage.memberId as
    "processed" | "sent-for-processing";
  return {
    schemaVersion: 1,
    caseId: `runtime-${proofBinding.executionCaseId}`,
    status: "RESOLVED",
    candidateCount: 1,
    selectedIdentity: "invoice-1",
    requiredState: state,
    verifiedState: state,
    persona: "company_admin",
    resolver: "browser-visible-invoice-row",
    binding: {
      status: "RESOLVED",
      executionCaseId: proofBinding.executionCaseId,
      fixtureKind: "invoice",
      fixtureIdentityRef: "invoice-1",
      verifiedState: state,
      ownerPersonaRef: "company_admin",
      resolverProvenance: {
        resolverRef: "browser-visible-invoice-row",
        evidenceRef: "runtime-evidence-1",
      },
      identityPolicy: "compatible-state",
      selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
      verifiedAt: "2026-09-03T00:00:00.000Z",
    },
    fixtureReadyForInteraction: true,
    failureClassification: null,
    failureReason: null,
    preparedAt: "2026-09-03T00:00:00.000Z",
    evidenceRef: "runtime-evidence-1",
    note: "resolved",
  };
}

function assertionEvidence(
  proofBinding: TextProofBinding,
  passed = true
): BrowserDeterministicEvidence {
  return {
    stepIndex: 1,
    action: "assertTextVisible",
    oracleId: proofBinding.assertion.oracleId,
    expected: proofBinding.assertion.expectedText,
    passed,
    note: "canonical assertion",
  };
}

function page(path = "/company/items"): Page {
  return { url: () => `https://staging.invalid${path}` } as Page;
}

const visible = async () => ({
  visible: true,
  attempted: true,
  scrolled: false,
  surfaceCount: 1,
  note: "found",
});

async function execute(
  proofBinding: TextProofBinding,
  options: {
    evidence?: BrowserDeterministicEvidence[];
    preparations?: BrowserRuntimeFixturePreparationResult[];
    persona?: string;
    route?: string;
    surfaceCount?: number;
    surfaceVisible?: boolean;
  } = {}
) {
  return executeBrowserEvidenceContractProofs({
    page: page(options.route),
    testCase: browserCase(proofBinding),
    actualPersona: options.persona ?? "company_admin",
    deterministicEvidence:
      options.evidence ?? [assertionEvidence(proofBinding)],
    runtimeFixturePreparations:
      options.preparations ?? [preparation(proofBinding)],
    observe: async () => ({
      ...(await visible()),
      visible: options.surfaceVisible ?? true,
      surfaceCount: options.surfaceCount ?? 1,
    }),
  });
}

test("fresh unique structured search input confirms only source-authorized presence", async () => {
  const item = searchBinding();
  const result = await executeBrowserEvidenceContractProofs({
    page: page("/company/all-payments"), testCase: searchCase(item),
    actualPersona: "company_admin", deterministicEvidence: [], runtimeFixturePreparations: [],
    observeSearchInput: async () => searchObservation([visibleSearchInput]),
  });
  assert.equal(result[0]?.status, "CONFIRMED");
  assert.equal(result[0]?.capabilityKind, "SEARCH_INPUT_PRESENT");
  assert.equal(result[0]?.freshObservation, true);
  assert.equal("expectedText" in result[0]!, false);
  assert.equal("PASS" in result[0]!, false);
});

test("search-input proof fails closed for zero, ambiguous, text-only, and disabled observations", async () => {
  const item = searchBinding();
  const scenarios: BrowserObservation["inputs"][] = [
    [],
    [visibleSearchInput, { label: "Search records", role: "searchbox", type: "search",
      disabled: false, activationSafe: true, expanded: null, required: false, hasValue: false }],
    [{ label: "Search invoices", role: "", type: "text", disabled: false,
      activationSafe: true, expanded: null, required: false, hasValue: false }],
    [{ ...visibleSearchInput, disabled: true }],
  ];
  for (const inputs of scenarios) {
    const result = await executeBrowserEvidenceContractProofs({
      page: page("/company/all-payments"), testCase: searchCase(item),
      actualPersona: "company_admin", deterministicEvidence: [], runtimeFixturePreparations: [],
      observeSearchInput: async () => searchObservation(inputs),
    });
    assert.equal(result[0]?.status, "CONTRADICTED");
  }
});

test("visual evidence and partial search-input presence cannot complete unrelated member coverage", () => {
  const item = searchBinding();
  const second = { ...item, bindingId: "search-binding-2", executionCaseId: "source-search-2",
    acceptanceCoverage: { ...item.acceptanceCoverage, memberId: "payments", plannedMemberIds: ["payments"] } };
  const coverage = summarizeBrowserEvidenceContractProofCoverage({
    bindings: [item, second],
    results: [{
      schemaVersion: 1, bindingId: item.bindingId, evidenceContractId: item.evidenceContractId,
      obligationId: item.obligationId, executionCaseId: item.executionCaseId,
      memberId: item.acceptanceCoverage.memberId, capabilityKind: item.capabilityKind,
      status: "CONFIRMED", freshObservation: true, surfaceCount: 0, candidateCount: 1,
      note: "deterministic presence only; visual PASS_CONFIRMED is not an input",
    }],
  })[0]!;
  assert.equal(coverage.status, "UNSATISFIED");
  assert.deepEqual(coverage.provedMemberIds, ["all-payments"]);
  assert.deepEqual(coverage.remainingMemberIds, ["payments"]);
});

test("planning binding, fixture preparation, navigation, clicks, and screenshots do not satisfy proof", async () => {
  const item = binding("processed");
  const noAssertion = await execute(item, { evidence: [] });
  assert.equal(noAssertion[0]?.status, "NOT_EXECUTED");
  const unrelated = await execute(item, {
    evidence: [{
      stepIndex: 1,
      action: "resolveRuntimeInvoiceFixture",
      expected: "opened",
      passed: true,
      note: "navigation/action only",
    }],
  });
  assert.equal(unrelated[0]?.status, "NOT_EXECUTED");
  assert.equal("status" in item, false);
  assert.equal("screenshot" in noAssertion[0]!, false);
  assert.equal("finalStatus" in noAssertion[0]!, false);
});

test("fresh exact surface observation confirms proof without creating PASS", async () => {
  const result = await execute(binding("processed"));
  assert.equal(result[0]?.status, "CONFIRMED");
  assert.equal(result[0]?.freshObservation, true);
  assert.equal(result[0]?.surfaceCount, 1);
  assert.equal("finalStatus" in result[0]!, false);
  assert.equal("PASS" in result[0]!, false);
});

test("fails closed for fixture, identity, persona, route, oracle, surface ambiguity, and missing text", async () => {
  const item = binding("processed");
  const wrongPreparation = preparation(item);
  wrongPreparation.binding!.executionCaseId = "another-case";
  const cases = [
    await execute(item, { preparations: [] }),
    await execute(item, { preparations: [wrongPreparation] }),
    await execute(item, { persona: "talent" }),
    await execute(item, { route: "/company/other" }),
    await execute(item, { evidence: [assertionEvidence({
      ...item,
      assertion: { ...item.assertion, oracleId: "wrong" },
    })] }),
    await execute(item, { surfaceCount: 2 }),
    await execute(item, { surfaceVisible: false }),
  ];
  assert.deepEqual(
    cases.map((result) => result[0]?.status),
    [
      "NOT_EXECUTED",
      "NOT_EXECUTED",
      "NOT_EXECUTED",
      "NOT_EXECUTED",
      "NOT_EXECUTED",
      "CONTRADICTED",
      "CONTRADICTED",
    ]
  );
});

for (const scenario of [
  {
    name: "fixture preparation without the canonical oracle does not execute proof",
    options: (item: TextProofBinding) => ({
      evidence: [] as BrowserDeterministicEvidence[],
      preparations: [preparation(item)],
    }),
    expected: "NOT_EXECUTED",
  },
  {
    name: "a failed canonical assertion does not execute proof",
    options: (item: TextProofBinding) => ({
      evidence: [assertionEvidence(item, false)],
    }),
    expected: "NOT_EXECUTED",
  },
  {
    name: "a wrong execution-case fixture binding does not execute proof",
    options: (item: TextProofBinding) => {
      const value = preparation(item);
      value.binding!.executionCaseId = "wrong-case";
      return { preparations: [value] };
    },
    expected: "NOT_EXECUTED",
  },
  {
    name: "a wrong verified fixture state does not execute proof",
    options: (item: TextProofBinding) => {
      const value = preparation(item);
      value.requiredState = "sent-for-processing";
      value.verifiedState = "sent-for-processing";
      value.binding!.verifiedState = "sent-for-processing";
      return { preparations: [value] };
    },
    expected: "NOT_EXECUTED",
  },
  {
    name: "a wrong active persona does not execute proof",
    options: () => ({ persona: "talent" }),
    expected: "NOT_EXECUTED",
  },
  {
    name: "a wrong active route does not execute proof",
    options: () => ({ route: "/company/other" }),
    expected: "NOT_EXECUTED",
  },
  {
    name: "no active expanded surface contradicts rather than satisfies proof",
    options: () => ({ surfaceCount: 0, surfaceVisible: false }),
    expected: "CONTRADICTED",
  },
  {
    name: "multiple active expanded surfaces fail closed",
    options: () => ({ surfaceCount: 2 }),
    expected: "CONTRADICTED",
  },
  {
    name: "missing source-bound text contradicts rather than satisfies proof",
    options: () => ({ surfaceCount: 1, surfaceVisible: false }),
    expected: "CONTRADICTED",
  },
] as const) {
  test(scenario.name, async () => {
    const item = binding("processed");
    const result = await execute(item, scenario.options(item));
    assert.equal(result[0]?.status, scenario.expected);
    assert.notEqual(result[0]?.status, "PASS");
  });
}

test("canonical evidence from a GOAL_ALREADY_SATISFIED assertion handoff remains eligible for fresh proof", async () => {
  const item = binding("processed");
  const result = await execute(item, {
    evidence: [assertionEvidence(item)],
  });
  assert.equal(result[0]?.status, "CONFIRMED");
});

test("an exact wrong oracle identity cannot satisfy the binding", async () => {
  const item = binding("processed");
  const evidence = assertionEvidence(item);
  evidence.oracleId = "another-oracle";
  const result = await execute(item, { evidence: [evidence] });
  assert.equal(result[0]?.status, "NOT_EXECUTED");
});

function confirmed(
  item: TextProofBinding,
  status: BrowserEvidenceContractProofResult["status"] = "CONFIRMED"
): BrowserEvidenceContractProofResult {
  return {
    schemaVersion: 1,
    bindingId: item.bindingId,
    evidenceContractId: item.evidenceContractId,
    obligationId: item.obligationId,
    executionCaseId: item.executionCaseId,
    memberId: item.acceptanceCoverage.memberId,
    capabilityKind: item.capabilityKind,
    status,
    freshObservation: status !== "NOT_EXECUTED",
    surfaceCount: status === "CONFIRMED" ? 1 : 0,
    expectedText: item.assertion.expectedText,
    oracleId: item.assertion.oracleId,
    note: status,
  };
}

test("ALL_REQUIRED coverage is partial for either state and satisfied only for both independent members", () => {
  const processed = binding("processed");
  const sent = binding("sent-for-processing");
  for (const only of [processed, sent]) {
    const coverage = summarizeBrowserEvidenceContractProofCoverage({
      bindings: [processed, sent],
      results: [confirmed(only)],
    })[0]!;
    assert.equal(coverage.status, "UNSATISFIED");
    assert.equal(coverage.provedMemberIds.length, 1);
    assert.equal(coverage.remainingMemberIds.length, 1);
  }
  const coverage = summarizeBrowserEvidenceContractProofCoverage({
    bindings: [processed, sent],
    results: [confirmed(processed), confirmed(sent)],
  })[0]!;
  assert.equal(coverage.status, "SATISFIED");
  assert.deepEqual(coverage.provedMemberIds, [
    "processed",
    "sent-for-processing",
  ]);
  assert.equal("finalStatus" in coverage, false);
});

test("duplicate routes/evidence do not multiply authority and a redundant failure does not erase independent confirmation", () => {
  const processed = binding("processed");
  const sent = binding("sent-for-processing");
  const duplicateProcessed = {
    ...processed,
    bindingId: "binding-processed-duplicate-route",
    evidenceContractId: "contract-processed-duplicate-route",
  };
  const coverage = summarizeBrowserEvidenceContractProofCoverage({
    bindings: [processed, duplicateProcessed, sent],
    results: [
      confirmed(processed),
      confirmed(processed),
      confirmed(duplicateProcessed, "CONTRADICTED"),
      confirmed(sent),
    ],
  })[0]!;
  assert.equal(coverage.status, "SATISFIED");
  assert.deepEqual(coverage.provedMemberIds, [
    "processed",
    "sent-for-processing",
  ]);
  assert.deepEqual(coverage.confirmedBindingIds, [
    "binding-processed",
    "binding-sent-for-processing",
  ]);
});

test("artifact-only replay and blocked execution remain unsatisfied", () => {
  const processed = binding("processed");
  const sent = binding("sent-for-processing");
  for (const results of [
    [],
    [confirmed(processed, "NOT_EXECUTED")],
    [confirmed(processed, "CONTRADICTED")],
  ]) {
    const coverage = summarizeBrowserEvidenceContractProofCoverage({
      bindings: [processed, sent],
      results,
    })[0]!;
    assert.equal(coverage.status, "UNSATISFIED");
  }
});

for (const scenario of [
  {
    name: "processed-only proof cannot discharge sent-for-processing coverage",
    results: (processed: TextProofBinding) =>
      [confirmed(processed)],
    expected: "UNSATISFIED",
  },
  {
    name: "sent-for-processing-only proof cannot discharge processed coverage",
    results: (_processed: TextProofBinding, sent: TextProofBinding) =>
      [confirmed(sent)],
    expected: "UNSATISFIED",
  },
  {
    name: "both independent state members satisfy ALL_REQUIRED coverage",
    results: (processed: TextProofBinding, sent: TextProofBinding) =>
      [confirmed(processed), confirmed(sent)],
    expected: "SATISFIED",
  },
  {
    name: "duplicate evidence for one member cannot discharge the missing member",
    results: (processed: TextProofBinding) =>
      [confirmed(processed), confirmed(processed)],
    expected: "UNSATISFIED",
  },
  {
    name: "a contradicted result cannot discharge a member",
    results: (processed: TextProofBinding) =>
      [confirmed(processed, "CONTRADICTED")],
    expected: "UNSATISFIED",
  },
  {
    name: "a not-executed result cannot discharge a member",
    results: (processed: TextProofBinding) =>
      [confirmed(processed, "NOT_EXECUTED")],
    expected: "UNSATISFIED",
  },
  {
    name: "planning bindings without runtime results remain unsatisfied",
    results: () => [] as BrowserEvidenceContractProofResult[],
    expected: "UNSATISFIED",
  },
] as const) {
  test(scenario.name, () => {
    const processed = binding("processed");
    const sent = binding("sent-for-processing");
    const coverage = summarizeBrowserEvidenceContractProofCoverage({
      bindings: [processed, sent],
      results: scenario.results(processed, sent),
    })[0]!;
    assert.equal(coverage.status, scenario.expected);
    assert.equal("finalStatus" in coverage, false);
  });
}

test("an unrelated obligation result cannot satisfy this obligation", () => {
  const processed = binding("processed");
  const sent = binding("sent-for-processing");
  const unrelated = {
    ...confirmed(processed),
    obligationId: "obligation-other",
  };
  const coverage = summarizeBrowserEvidenceContractProofCoverage({
    bindings: [processed, sent],
    results: [unrelated],
  })[0]!;
  assert.equal(coverage.status, "UNSATISFIED");
  assert.deepEqual(coverage.provedMemberIds, []);
});

test("a legacy case with no proof binding performs no proof work", async () => {
  const item = binding("processed");
  const legacy = browserCase(item);
  delete legacy.deterministicProofBindings;
  const result = await executeBrowserEvidenceContractProofs({
    page: page(),
    testCase: legacy,
    actualPersona: "company_admin",
    deterministicEvidence: [assertionEvidence(item)],
    runtimeFixturePreparations: [preparation(item)],
    observe: visible,
  });
  assert.deepEqual(result, []);
});

test("blocked preparation remains non-failing evidence metadata", async () => {
  const item = binding("processed");
  const result = await execute(item, { preparations: [] });
  assert.equal(result[0]?.status, "NOT_EXECUTED");
  assert.equal("failed" in result[0]!, false);
  assert.equal("verdict" in result[0]!, false);
});
