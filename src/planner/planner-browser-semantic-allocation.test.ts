import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerAcceptanceVerdictGrouping,
  type PlannerAcceptanceVerdictGroupProposal,
} from "./planner-acceptance-verdict-grouping.js";
import {
  applyPlannerBrowserSemanticAllocation,
  transportPlannerBrowserExecutionAuthority,
} from "./planner-browser-semantic-allocation.js";
import {
  getBrowserManualAcceptanceCoverageGapReason,
} from "../agents/browser/browser-result-reconciliation.js";
import {
  applyPlannerCaseLimits,
} from "./planner-case-budget.js";
import {
  applyPlannerRuntimeFixturePolicies,
  splitCombinedInvoiceStateCases,
} from "./planner-runtime-fixture-policy.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  PlannerBrowserObligationBindingState,
  PlannerBrowserSemanticCandidate,
  PlannerBrowserSemanticIr,
  TestPlan,
} from "./types.js";

process.env.QA_COMPANY_EMAIL ??= "planner-test-company@example.invalid";
process.env.QA_TALENT_EMAIL ??= "planner-test-talent@example.invalid";
process.env.FIREBASE_SERVICE_ACCOUNT_KEY ??= '{"project_id":"planner-test"}';
process.env.VITE_FIREBASE_API_KEY ??= "planner-test";
process.env.VITE_FIREBASE_AUTH_DOMAIN ??= "planner-test.invalid";
process.env.VITE_FIREBASE_PROJECT_ID ??= "planner-test";

function context(
  texts: string[],
  roles: Array<"ACCEPTANCE" | "EXPECTED_BEHAVIOR" | "TASK"> = []
) {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "ACCEPTANCE_CRITERIA",
    sourceUnits: texts.map((value, index) => ({
      id: `source-${index + 1}`,
      sourceKind: "ACCEPTANCE_CRITERIA" as const,
      sourceRef: `jira.ac.${index + 1}`,
      text: value,
    })),
  };
  const obligationLedger: PlannerAcceptanceObligationLedger = {
    sourceStatus: "RESOLVED",
    derivationStatus: "RESOLVED",
    obligations: texts.map((value, index) => ({
      id: `obligation-${index + 1}`,
      sourceUnitIds: [`source-${index + 1}`],
      sourceRole: roles[index] ?? "ACCEPTANCE",
      derivation:
        (roles[index] ?? "ACCEPTANCE") === "TASK"
          ? "DIRECT_TASK_SECTION"
          : (roles[index] ?? "ACCEPTANCE") === "EXPECTED_BEHAVIOR"
            ? "DIRECT_DESCRIPTION_SECTION"
            : "DIRECT_ACCEPTANCE_FIELD",
      text: value,
    })),
    unresolvedSourceUnitIds: [],
  };
  return { sourceLedger, obligationLedger };
}

function browserCase(id: string, options: {
  route?: string;
  persona?: "company_admin" | "talent";
  steps?: BrowserTestCase["steps"];
  fixtureRequirements?: string[];
  fixtureAuthority?: BrowserTestCase["fixtureIdentityAuthority"];
  conflictingRoute?: boolean;
  routeOrigin?: "JIRA_EXPLICIT_ROUTE" | "UI_ROUTE_CATALOG";
  routeAuthoritative?: boolean;
  routeStatus?: "RESOLVED" | "VALIDATED";
  routeSourceRef?: string;
} = {}): BrowserTestCase {
  const route = options.route ?? "/company/all-jobs";
  const candidates = [{
    route,
    confidence: "high" as const,
    source: "jira",
    origin: options.routeOrigin ?? "JIRA_EXPLICIT_ROUTE",
    authoritative: options.routeAuthoritative ?? true,
    sourceRef: options.routeSourceRef ?? "jira.ac.1",
    reason: "explicit",
    disposition: "SELECTED" as const,
  }];
  if (options.conflictingRoute) {
    candidates.push({ ...candidates[0]!, route: "/company/other" });
  }
  return {
    id,
    persona: options.persona ?? "company_admin",
    goal: "model candidate",
    startRoute: route,
    successCriteria: "model candidate",
    runtimeFixturePolicy: "exact",
    automatedChecks: ["undefined is not visible"],
    manualChecks: ["ticket-wide model proposal"],
    fixtureRequirements: options.fixtureRequirements ?? [],
    steps: options.steps ?? [{ action: "assertTextVisible", text: "Records" }],
    routeResolution: {
      status: options.routeStatus ?? "RESOLVED",
      originalRoute: route,
      selectedRoute: route,
      confidence: "high",
      totalCandidateCount: candidates.length,
      candidates,
    },
    ...(options.fixtureAuthority
      ? { fixtureIdentityAuthority: options.fixtureAuthority }
      : {}),
  };
}

function semanticCandidate(
  id: string,
  caseId: string,
  obligationIds: string[],
  ledger: PlannerAcceptanceObligationLedger,
  options: {
    checkText?: string;
    fixtureNeeds?: Array<{ text: string; obligationIds: string[] }>;
    targetSurface?: string;
    persona?: "company_admin" | "talent";
  } = {}
): PlannerBrowserSemanticCandidate {
  const obligations = obligationIds.map((obligationId) =>
    ledger.obligations.find((item) => item.id === obligationId)!
  );
  return {
    candidateId: id,
    proposedCaseId: caseId,
    obligationIds,
    sourceUnitIds: obligations.flatMap((item) => item.sourceUnitIds).sort(),
    proposedBehavior: obligations.map((item) => item.text).join(" "),
    proposedPersona: options.persona ?? "company_admin",
    proposedTargetSurface:
      options.targetSurface ?? obligations.map((item) => item.text).join(" "),
    proposedMutationClass: "READ_ONLY",
    proposedChecks: obligations.map((item, index) => ({
      text: index === 0 && options.checkText ? options.checkText : item.text,
      obligationIds: [item.id],
      proposedRole: "ACCEPTANCE_PROOF" as const,
    })),
    proposedFixtureNeeds: options.fixtureNeeds ?? [],
    proposedRelationshipHints: [],
    authority: "CANDIDATE",
  };
}

function authoritativeGroups(
  ledger: PlannerAcceptanceObligationLedger,
  sourceLedger: PlannerAcceptanceSourceLedger,
  dependencyIndex?: number
): PlannerAcceptanceVerdictGroupProposal[] {
  return ledger.obligations.map((item, index) => ({
    obligationIds: [item.id],
    relationship: index === dependencyIndex ? "DEPENDS_ON" : "INDEPENDENT",
    ...(index === dependencyIndex
      ? { dependsOnObligationIds: [ledger.obligations[0]!.id] }
      : {}),
    sourceRefs: item.sourceUnitIds.map((sourceUnitId) => ({
      sourceUnitId,
      sourceRef: sourceLedger.sourceUnits.find((unit) => unit.id === sourceUnitId)!.sourceRef,
    })),
    reason: index === dependencyIndex ? "Explicit dependency" : "Explicit independent contract",
  }));
}

function run(options: {
  texts: string[];
  roles?: Array<"ACCEPTANCE" | "EXPECTED_BEHAVIOR" | "TASK">;
  groups?: PlannerAcceptanceVerdictGroupProposal[];
  cases?: BrowserTestCase[];
  candidates?: PlannerBrowserSemanticCandidate[];
  bindingStates?: PlannerBrowserObligationBindingState[];
  sourceMemberLedger?: TestPlan["sourceDerivedObligationMemberLedger"];
  legacy?: boolean;
}) {
  const ctx = context(options.texts, options.roles);
  const cases = options.cases ?? [browserCase("candidate-1")];
  const candidates = options.candidates ?? [semanticCandidate(
    "semantic-1",
    cases[0]!.id,
    ctx.obligationLedger.obligations.map((item) => item.id),
    ctx.obligationLedger
  )];
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: options.legacy ? "LEGACY_INPUT" : "ACTIVE",
    candidates: options.legacy ? [] : candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
    ...(options.groups ? { authoritativeGroups: options.groups } : {}),
  });
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Synthetic",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
    ...(options.sourceMemberLedger ? { sourceDerivedObligationMemberLedger: options.sourceMemberLedger } : {}),
    browserObligationBindings: ctx.obligationLedger.obligations.map((item, index) => ({
      obligationId: item.id,
      sourceUnitIds: item.sourceUnitIds,
      semanticFamily: "STATE_TRANSITION",
      state: options.bindingStates?.[index] ?? "SUPPORTED_AND_BOUND",
      allocatedCaseIds: cases.map((testCase) => testCase.id),
      reason: "synthetic proof registry",
      ...((options.bindingStates?.[index] ?? "SUPPORTED_AND_BOUND") === "SUPPORTED_AND_BOUND"
        ? { emittedRequirementIds: [`requirement-${index + 1}`] }
        : {}),
    })),
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return { ...ctx, plan, grouping, semanticIr };
}

function surfacePartitionRun(options: {
  sourceText: string;
  definitions: Array<{
    id: string;
    route: string;
    goal: string;
    targetSurface: string;
    sourceUnitIds?: string[];
    fixtureNeeds?: string[];
  }>;
}) {
  const ctx = context([options.sourceText]);
  const cases = options.definitions.map((item) => {
    const testCase = browserCase(item.id, {
      route: item.route,
      routeSourceRef: "jira.ac.1",
    });
    testCase.goal = item.goal;
    testCase.successCriteria = options.sourceText;
    testCase.manualChecks = [options.sourceText];
    testCase.fixtureRequirements = item.fixtureNeeds ?? [];
    return testCase;
  });
  const candidates = options.definitions.map((item) => {
    const candidate = semanticCandidate(
      `semantic-${item.id}`,
      item.id,
      ["obligation-1"],
      ctx.obligationLedger,
      {
        targetSurface: item.targetSurface,
        fixtureNeeds: (item.fixtureNeeds ?? []).map((text) => ({
          text,
          obligationIds: ["obligation-1"],
        })),
      }
    );
    if (item.sourceUnitIds) candidate.sourceUnitIds = item.sourceUnitIds;
    return candidate;
  });
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const plan: TestPlan = {
    issueKey: "SURFACE",
    summary: "Surface partition",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return { ...ctx, plan, grouping, semanticIr };
}

const twoSurfaceDefinitions = [
  {
    id: "payments",
    route: "/company/payments",
    goal: "On the Payments page, verify the search control.",
    targetSurface: "Payments page search area",
  },
  {
    id: "all-payments",
    route: "/company/all-payments",
    goal: "On the All Payments page, verify the search control.",
    targetSurface: "All Payments page search area",
  },
];

test("atomic source surfaces retain stable ALL_REQUIRED member coverage without materializing verdict cases", () => {
  const result = surfacePartitionRun({
    sourceText: "Add a search bar to the Payments & All Payments page.",
    definitions: twoSurfaceDefinitions,
  });
  const partition = result.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(partition?.status, "VALIDATED");
  assert.deepEqual(partition?.requiredMemberIds, ["all-payments", "payments"]);
  assert.deepEqual(
    partition?.members.map((item) => [item.memberId, item.semanticCandidateId]),
    [
      ["all-payments", "semantic-all-payments"],
      ["payments", "semantic-payments"],
    ]
  );
  assert.equal(result.plan.browserCases.length, 0);
  assert.equal(result.plan.browserSemanticPlanningAudit?.duplicateObligationCoverageCount, 0);
  assert.equal(JSON.stringify(result.plan).includes("PROVED"), false);
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
});

test("AS-1011-style partial execution keeps unresolved members required and cannot bypass manual completeness", () => {
  const result = surfacePartitionRun({
    sourceText: "For payments and all payments pages, track the active tab and remaining filters in the URL.",
    definitions: twoSurfaceDefinitions,
  });
  const partition = result.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(partition?.status, "VALIDATED");
  assert.deepEqual(partition?.requiredMemberIds, ["all-payments", "payments"]);
  assert.deepEqual(partition?.plannedMemberIds, ["all-payments"]);
  assert.equal(
    partition?.members.find((item) => item.memberId === "payments")
      ?.executionReadiness,
      "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING"
    );
  const gap = getBrowserManualAcceptanceCoverageGapReason({
    manualChecks: [result.obligationLedger.obligations[0]!.text],
  });
  assert.ok(gap);
  assert.match(gap, /whole-case PASS requires complete acceptance coverage/);
});

test("source-backed search members materialize with runtime surface prerequisites, not entity fixtures", () => {
  const result = surfacePartitionRun({
    sourceText: "Add a search bar to the Payments & All Payments page.",
    definitions: twoSurfaceDefinitions.map((item) => ({
      ...item,
      fixtureNeeds: ["A searchable invoice dataset selected for convenience."],
    })),
  });
  const partition = result.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(partition?.status, "VALIDATED");
  assert.deepEqual(partition?.plannedMemberIds, ["all-payments", "payments"]);
  assert.equal(result.plan.browserCases.length, 2);

  // A source-surface prerequisite is now the execution owner. The authored
  // case must not also survive as a redundant DISCOVERY_ONLY execution unit.
  assert.equal(
    result.plan.discoveryBrowserCases?.length ?? 0,
    0
  );
  assert.ok(
    result.plan.browserSemanticPlanningAudit?.executionContainers
      ?.every((item) =>
        item.executionSurfacePrerequisite
          ? item.discoveryAdmission === undefined
          : true
      )
  );

  for (const testCase of result.plan.browserCases) {
    const prerequisite = testCase.executionSurfacePrerequisiteContract;
    assert.equal(prerequisite?.kind, "SEARCH_INPUT");
    assert.equal(prerequisite?.status, "SURFACE_RUNTIME_RESOLUTION_REQUIRED");
    assert.equal(prerequisite?.surfaceReadyForInteraction, false);
    assert.equal(prerequisite?.runtimeBinding, "NOT_YET_RESOLVED");
    assert.deepEqual(
      prerequisite?.acceptanceCoverage.requiredMemberIds,
      ["all-payments", "payments"]
    );
    assert.deepEqual(
      prerequisite?.acceptanceCoverage.plannedMemberIds,
      ["all-payments", "payments"]
    );
    assert.deepEqual(testCase.fixtureRequirements, []);
    assert.deepEqual(testCase.manualChecks, [
      "Add a search bar to the Payments & All Payments page.",
    ]);
    assert.equal(testCase.deterministicProofBindings?.length, 1);
    assert.equal(
      testCase.deterministicProofBindings?.[0]?.capabilityKind,
      "SEARCH_INPUT_PRESENT"
    );
  }
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
});

test("candidate-only planner fixture hints do not veto runtime-resolvable sibling targets", () => {
  const sourceText =
    "For payments and all payments pages, track the active tab with tab parameter and track the rest of the filters in the URL as well.";
  const result = surfacePartitionRun({
    sourceText,
    definitions: [
      {
        id: "payments",
        route: "/company/payments",
        goal: "Track the Payments query state.",
        targetSurface: "Company payments page",
        fixtureNeeds: ["A convenient payment record."],
      },
      {
        id: "all-payments",
        route: "/company/all-payments",
        goal: "Track the All Payments query state.",
        targetSurface: "Company all payments page",
        fixtureNeeds: ["A convenient payment record."],
      },
    ],
  });

  const partition = result.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];

  assert.equal(partition?.status, "VALIDATED");
  assert.deepEqual(partition?.requiredMemberIds, [
    "all-payments",
    "payments",
  ]);

  // Only the statically target-authorized surface member belongs to the
  // source-backed surface partition. Runtime target eligibility must not widen
  // this acceptance authority.
  assert.deepEqual(partition?.plannedMemberIds, ["all-payments"]);

  assert.equal(result.plan.browserCases.length, 2);

  const surfaceCase = result.plan.browserCases.find(
    (item) =>
      item.executionSurfacePrerequisiteContract
        ?.surfacePartition.memberId === "all-payments"
  );
  const prerequisite = surfaceCase?.executionSurfacePrerequisiteContract;

  assert.equal(prerequisite?.kind, "TAB_OR_FILTER_CONTROL");
  assert.equal(prerequisite?.surfacePartition.memberId, "all-payments");
  assert.deepEqual(prerequisite?.acceptanceCoverage.requiredMemberIds, [
    "all-payments",
    "payments",
  ]);
  assert.deepEqual(prerequisite?.acceptanceCoverage.plannedMemberIds, [
    "all-payments",
  ]);

  const runtimeTargetCase = result.plan.browserCases.find(
    (item) =>
      item.runtimeTargetGroundingContract
        ?.coarseEnvelope.route === "/company/payments"
  );

  assert.ok(runtimeTargetCase);
  assert.deepEqual(runtimeTargetCase?.acceptanceObligationIds, [
    "obligation-1",
  ]);
  assert.deepEqual(runtimeTargetCase?.fixtureRequirements, []);
  assert.equal(runtimeTargetCase?.deterministicProofBindings, undefined);
  assert.equal(
    runtimeTargetCase?.runtimeTargetGroundingContract?.authority,
    "SOURCE_AUTHORIZED"
  );

  const paymentsContainer = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.find((item) =>
      item.semanticCandidateId === "semantic-payments"
    );

  assert.equal(
    paymentsContainer?.readiness,
    "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING"
  );
  assert.equal(paymentsContainer?.executionSurfacePrerequisite, undefined);
  assert.ok(paymentsContainer?.runtimeTargetGrounding);
  assert.ok(
    paymentsContainer?.fixture.requirements.length &&
    paymentsContainer.fixture.requirements.every(
      (item) => item.authority === "CANDIDATE_ONLY"
    )
  );
  assert.deepEqual(
    paymentsContainer?.runtimeTargetGrounding?.fixtureRequirements,
    []
  );

  // Planner hints may preserve execution opportunity, but they still cannot
  // manufacture deterministic proof or a final verdict.
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
});

test("source-authorized entity fixture requirements cannot be reclassified as surface prerequisites", () => {
  const sourceText =
    "Add a search bar to the Payments & All Payments page using the required invoice dataset.";
  const result = surfacePartitionRun({
    sourceText,
    definitions: twoSurfaceDefinitions.map((item) => ({
      ...item,
      fixtureNeeds: ["invoice dataset"],
    })),
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.ok(result.plan.browserSemanticPlanningAudit?.executionContainers
    ?.every((item) => item.executionSurfacePrerequisite === undefined));
});

test("surface prerequisite case and member identity survive serialization and replay", () => {
  const result = surfacePartitionRun({
    sourceText: "Add a search bar to the Payments & All Payments page.",
    definitions: twoSurfaceDefinitions.map((item) => ({
      ...item,
      fixtureNeeds: ["A candidate-only searchable dataset."],
    })),
  });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.deepEqual(
    reloaded.browserCases.map((item) =>
      item.executionSurfacePrerequisiteContract
    ),
    result.plan.browserCases.map((item) =>
      item.executionSurfacePrerequisiteContract
    )
  );
  assert.equal(reloaded.browserCases.length, 2);
  const replayed = structuredClone(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: replayed,
    obligationLedger: result.obligationLedger,
  });
  assert.deepEqual(replayed, reloaded);
});

test("surface membership fails closed for missing, duplicate, invented, or forged candidate bindings", () => {
  const missing = surfacePartitionRun({
    sourceText: "Add search on the Payments and All Payments pages.",
    definitions: [twoSurfaceDefinitions[0]!],
  }).plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(missing?.status, "INCOMPLETE");
  assert.deepEqual(missing?.plannedMemberIds, []);

  const duplicate = surfacePartitionRun({
    sourceText: "Add search on the Payments and All Payments pages.",
    definitions: [
      twoSurfaceDefinitions[0]!,
      { ...twoSurfaceDefinitions[0]!, id: "payments-copy" },
      twoSurfaceDefinitions[1]!,
    ],
  }).plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(duplicate?.status, "AMBIGUOUS");
  assert.deepEqual(duplicate?.plannedMemberIds, []);

  const invented = surfacePartitionRun({
    sourceText: "Add search on the Payments and All Payments pages.",
    definitions: [
      ...twoSurfaceDefinitions,
      {
        id: "refunds",
        route: "/company/refunds",
        goal: "On the Refunds page, verify the search control.",
        targetSurface: "Refunds page search area",
      },
    ],
  }).plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(invented?.status, "REJECTED");
  assert.deepEqual(invented?.plannedMemberIds, []);

  const forged = surfacePartitionRun({
    sourceText: "Add search on the Payments and All Payments pages.",
    definitions: [
      { ...twoSurfaceDefinitions[0]!, sourceUnitIds: ["forged-source"] },
      twoSurfaceDefinitions[1]!,
    ],
  }).plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.equal(forged?.status, "REJECTED");
});

test("surface partition identity is candidate-order independent and serialization stable", () => {
  const forward = surfacePartitionRun({
    sourceText: "Add search to the Payments & All Payments page.",
    definitions: twoSurfaceDefinitions,
  });
  const reverse = surfacePartitionRun({
    sourceText: "Add search to the Payments & All Payments page.",
    definitions: [...twoSurfaceDefinitions].reverse(),
  });
  const forwardPartition = forward.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];
  const reversePartition = reverse.plan.browserSemanticPlanningAudit
    ?.sourceBackedAtomicSurfacePartitions?.[0];
  assert.deepEqual(reversePartition, forwardPartition);

  const reloaded = JSON.parse(JSON.stringify(forward.plan)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: forward.obligationLedger,
  });
  assert.deepEqual(
    reloaded.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions,
    forward.plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions
  );
});

test("AS-1093-style separate task units remain UNKNOWN_GROUPING with no surface partition", () => {
  const texts = [
    "Display a Request Publish button whenever the job is in draft mode.",
    "Once requested, display the request in the table and show full comparison details.",
    "Also add a filter for filtering change requests based on types.",
  ];
  const ctx = context(texts);
  const cases = texts.map((text, index) => {
    const testCase = browserCase(`case-${index + 1}`);
    testCase.goal = text;
    return testCase;
  });
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: cases.map((testCase, index) => semanticCandidate(
      `semantic-${index + 1}`,
      testCase.id,
      [`obligation-${index + 1}`],
      ctx.obligationLedger
    )),
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const plan: TestPlan = {
    issueKey: "AS-1093-CONTROL",
    summary: "Unknown grouping control",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  assert.equal(grouping.groups[0]?.relationship, "UNKNOWN");
  assert.equal(grouping.status, "UNKNOWN");
  assert.deepEqual(
    plan.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions,
    []
  );
  assert.equal(plan.browserCases.length, 0);
});

test("single obligation becomes one stable atomic verdict case", () => {
  const result = run({ texts: ["Company users can search records."] });
  assert.equal(result.grouping.groups[0]?.relationship, "ATOMIC");
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserSemanticPlanningAudit?.contracts[0]?.disposition, "AUTOMATED_ALLOCATED");
});

test("one action-and-consequence statement is not split", () => {
  const result = run({
    texts: ["Company users can select X and verify Y changes."],
  });
  assert.equal(result.grouping.groups.length, 1);
  assert.deepEqual(result.plan.browserCases[0]?.acceptanceObligationIds, ["obligation-1"]);
});

test("one obligation with four candidate contexts stays fail-closed independent of candidate order", () => {
  const ctx = context([
    "Display the required details in contexts A, B, C, and D.",
  ]);
  const execute = (ids: string[]) => run({
    texts: ["Display the required details in contexts A, B, C, and D."],
    cases: ids.map((id) => browserCase(id)),
    candidates: ids.map((id) => semanticCandidate(
      `semantic-${id}`,
      id,
      ["obligation-1"],
      ctx.obligationLedger
    )),
  });
  const forward = execute(["a", "b", "c", "d"]);
  const reverse = execute(["d", "c", "b", "a"]);

  assert.equal(forward.plan.browserCases.length, 0);
  assert.equal(reverse.plan.browserCases.length, 0);
  assert.equal(
    forward.plan.browserSemanticPlanningAudit?.contracts[0]?.disposition,
    "CANDIDATE_UNAVAILABLE"
  );
  assert.equal(
    forward.plan.browserSemanticPlanningAudit?.contracts[0]?.reason,
    reverse.plan.browserSemanticPlanningAudit?.contracts[0]?.reason
  );
  assert.match(
    forward.plan.browserSemanticPlanningAudit?.contracts[0]?.reason ?? "",
    /4 source-anchored candidates.*alternatives or required subcoverage/
  );
});

test("separate sentences and bullets remain one unknown coupled group", () => {
  const result = run({ texts: [
    "Company users can reset the configured default.",
    "After reset, completed results remain unchanged.",
  ] });
  assert.equal(result.grouping.groups[0]?.relationship, "UNKNOWN");
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(result.plan.browserCases[0]?.acceptanceObligationIds, ["obligation-1", "obligation-2"]);
});

test("explicit authoritative independence produces distinct verdict contracts", () => {
  const texts = [
    "Company users can verify requirement A.",
    "Company users can verify requirement B.",
  ];
  const ctx = context(texts);
  const cases = [browserCase("a"), browserCase("b")];
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases,
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });
  assert.equal(result.plan.browserCases.length, 2);
  assert.notEqual(
    result.plan.browserCases[0]?.semanticVerdictContract?.verdictGroupId,
    result.plan.browserCases[1]?.semanticVerdictContract?.verdictGroupId
  );
  for (const testCase of result.plan.browserCases) {
    assert.deepEqual(
      testCase.executionVerdictScope?.executionObligationIds,
      testCase.executionVerdictScope?.verdictScopeObligationIds
    );
    assert.equal(testCase.executionVerdictScope?.verdictAuthority, "INDEPENDENT");
  }
});

test("unknown whole-group automation is allowed only as one whole case", () => {
  const result = run({ texts: [
    "Company users can verify behavior A.", "Behavior B.",
  ] });
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserSemanticPlanningAudit?.unknownGroupCount, 1);
});

test("unknown grouping materializes a uniquely source-backed partial execution unit as GROUP_ONLY", () => {
  const texts = [
    "Company users can verify behavior A.",
    "Behavior B.",
    "Behavior C.",
    "Behavior D.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    cases: [browserCase("a")],
    candidates: [semanticCandidate(
      "semantic-a", "a", ["obligation-1"], ctx.obligationLedger
    )],
  });
  assert.equal(result.plan.browserCases.length, 1);
  const testCase = result.plan.browserCases[0]!;
  assert.deepEqual(testCase.acceptanceObligationIds, ["obligation-1"]);
  assert.deepEqual(testCase.executionVerdictScope, {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: [
      "obligation-1", "obligation-2", "obligation-3", "obligation-4",
    ],
    verdictAuthority: "GROUP_ONLY",
  });
  assert.deepEqual(testCase.automatedChecks, [texts[0]]);
  assert.deepEqual(testCase.manualChecks, []);
  assert.deepEqual(
    testCase.semanticVerdictContract?.obligationIds,
    ["obligation-1", "obligation-2", "obligation-3", "obligation-4"]
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.contracts[0]?.disposition,
    "UNKNOWN_GROUPING"
  );
});

test("unknown grouping rejects empty, out-of-group, and ambiguous partial candidates", () => {
  const texts = [
    "Company users can verify behavior A.",
    "Behavior B.",
    "Behavior C.",
    "Behavior D.",
  ];
  const ctx = context(texts);
  const source = semanticCandidate(
    "semantic-a", "a", ["obligation-1"], ctx.obligationLedger
  );
  const scenarios: Array<{
    candidates: PlannerBrowserSemanticCandidate[];
    cases: BrowserTestCase[];
  }> = [
    {
      candidates: [{ ...source, obligationIds: [] }],
      cases: [browserCase("a")],
    },
    {
      candidates: [{ ...source, obligationIds: ["obligation-1", "outside"] }],
      cases: [browserCase("a")],
    },
    {
      candidates: [
        source,
        { ...source, candidateId: "semantic-a-duplicate", proposedCaseId: "a-duplicate" },
      ],
      cases: [browserCase("a"), browserCase("a-duplicate")],
    },
  ];
  for (const scenario of scenarios) {
    const result = run({ texts, ...scenario });
    assert.equal(result.plan.browserCases.length, 0);
    assert.equal(result.plan.browserSemanticPlanningAudit?.unknownGroupCount, 1);
  }
});

test("unknown partial proof remains one manual-blocked case and cannot split", () => {
  const result = run({
    texts: ["Company users can verify behavior A.", "Behavior B."],
    bindingStates: ["SUPPORTED_AND_BOUND", "UNSUPPORTED_AUTOMATION_SEMANTIC"],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserCases[0]?.semanticVerdictContract?.disposition, "ALLOCATED_MANUAL");
  assert.deepEqual(result.plan.browserCases[0]?.manualChecks, ["Behavior B."]);
});

test("explicit dependency survives allocation and serialization", () => {
  const texts = [
    "Company users can verify A exists.",
    "Company users can verify that after A, B is visible.",
  ];
  const ctx = context(texts);
  const groups = authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger, 1);
  const result = run({
    texts, groups,
    cases: [browserCase("a"), browserCase("b")],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });
  const reloaded = JSON.parse(JSON.stringify(result.plan));
  const dependent = reloaded.browserSemanticPlanningAudit.contracts.find(
    (item: any) => item.relationship === "DEPENDS_ON"
  );
  assert.equal(dependent.dependencyVerdictGroupIds.length, 1);
  const dependentCase = reloaded.browserCases.find(
    (item: any) => item.semanticVerdictContract?.relationship === "DEPENDS_ON"
  );
  assert.equal(
    dependentCase.semanticVerdictContract.dependencyVerdictGroupIds.length,
    1
  );
});

test("dependent group is not materialized when its prerequisite has no safe case", () => {
  const texts = [
    "Company users can verify A exists.",
    "Company users can verify that after A, B is visible.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger, 1),
    cases: [
      browserCase("a", {
        steps: [{ action: "createDraftJobAndVerifyRedirect", origin: "jobs" }],
      }),
      browserCase("b"),
    ],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.contracts.find(
      (item) => item.relationship === "DEPENDS_ON"
    )?.disposition,
    "CANDIDATE_UNAVAILABLE"
  );
});

test("five authoritative independent groups allocate four without merging", () => {
  const texts = Array.from(
    { length: 5 },
    (_, index) => `Company users can verify requirement ${index + 1}.`
  );
  const ctx = context(texts);
  const cases = texts.map((_, index) => browserCase(
    `candidate-${index + 1}`,
    { routeSourceRef: `jira.ac.${index + 1}` }
  ));
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases,
    candidates: ctx.obligationLedger.obligations.map((item, index) =>
      semanticCandidate(`semantic-${index + 1}`, cases[index]!.id, [item.id], ctx.obligationLedger)
    ),
  });
  assert.equal(result.plan.browserCases.length, 4);
  assert.equal(result.plan.browserSemanticPlanningAudit?.unallocatedBudgetObligationIds.length, 1);
  assert.equal(result.plan.browserSemanticPlanningAudit?.duplicateObligationCoverageCount, 0);
});

test("same route persona fixture and proof family do not merge independent groups", () => {
  const texts = [
    "Company users can verify A.",
    "Company users can verify B.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases: [browserCase("a"), browserCase("b")],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });
  assert.equal(result.plan.browserCases.length, 2);
});

test("manual sibling remains ticket-accounted and cannot leak into automated case", () => {
  const texts = [
    "Company users can verify automated A.",
    "Company users can assess subjective B.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases: [browserCase("a"), browserCase("b")],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
    bindingStates: ["SUPPORTED_AND_BOUND", "MANUAL_BY_NATURE"],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(result.plan.browserCases[0]?.manualChecks, []);
  assert.deepEqual(result.plan.browserSemanticPlanningAudit?.ticketManualObligationIds, ["obligation-2"]);
});

test("manual consequence in the same atomic group remains a case blocker", () => {
  const result = run({
    texts: [
      "Company users can verify the action succeeds.",
      "Visual consequence is correct.",
    ],
    bindingStates: ["SUPPORTED_AND_BOUND", "MANUAL_BY_NATURE"],
  });
  assert.equal(result.plan.browserCases[0]?.manualChecks?.length, 1);
  assert.equal(result.plan.browserCases[0]?.semanticVerdictContract?.disposition, "ALLOCATED_MANUAL");
});

test("persistent sibling is policy blocked without contaminating read-only sibling", () => {
  const texts = [
    "Company users can view read-only A.",
    "Company users can persist B.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases: [browserCase("a"), browserCase("b", {
      steps: [{ action: "createDraftJobAndVerifyRedirect", origin: "jobs" }],
    })],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(result.plan.browserSemanticPlanningAudit?.policyBlockedObligationIds, ["obligation-2"]);
});

test("unsupported semantics do not become sanity-only automated cases", () => {
  const result = run({
    texts: ["Company users can verify rich acceptance behavior."],
    bindingStates: ["UNSUPPORTED_AUTOMATION_SEMANTIC"],
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.deepEqual(result.plan.browserSemanticPlanningAudit?.unsupportedObligationIds, ["obligation-1"]);
});

test("undefined sanity text cannot discharge rich acceptance", () => {
  const text = "Company users can verify rich acceptance behavior.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { checkText: "undefined is not visible" }
    )],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(
    result.plan.browserCases[0]?.semanticVerdictContract?.disposition,
    "ALLOCATED_MANUAL"
  );
  assert.deepEqual(result.plan.browserCases[0]?.manualChecks, [text]);
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.contracts[0]?.acceptanceChecks[0]?.role,
    "SUPPLEMENTAL_SANITY"
  );
});

test("authoritative route replaces a neighboring planner literal", () => {
  const candidateCase = browserCase("candidate-1", { route: "/company/affected" });
  candidateCase.startRoute = "/company/neighbor";
  const result = run({
    texts: ["Company users can verify behavior."], cases: [candidateCase],
  });
  assert.equal(result.plan.browserCases[0]?.startRoute, "/company/affected");
});

test("validated repository surface metadata can ground a target without becoming acceptance proof", () => {
  const result = run({
    texts: ["Company users can verify behavior."],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "VALIDATED",
    })],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.contracts[0]?.target.basis,
    "ROUTE_MANIFEST"
  );
});

test("an exact static manifest route may bind navigation without becoming an acceptance route", () => {
  const result = run({
    texts: ["Company users can verify behavior."],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.target
      .sourceScope.status,
    "AUTHORITATIVE"
  );
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.acceptanceRouteConstraint.status, "NONE");
  assert.equal(container?.executionNavigationBinding.status, "BOUND");
  assert.equal(container?.executionNavigationBinding.basis, "UI_ROUTE_MANIFEST");
});

test("conflicting authoritative routes fail closed", () => {
  const result = run({
    texts: ["Company users can verify behavior."],
    cases: [browserCase("candidate-1", { conflictingRoute: true })],
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.deepEqual(
    result.plan.browserSemanticPlanningAudit?.navigationUnresolvedObligationIds,
    ["obligation-1"]
  );
});

test("MODEL_PERSONA_MISMATCH_CANNOT_OVERRIDE_UNAMBIGUOUS_SOURCE_PERSONA_V1", () => {
  const ctx = context(["Company users can view records."]);
  const result = run({
    texts: ["Company users can view records."],
    cases: [browserCase("candidate-1", {
      persona: "company_admin", route: "/company/all-jobs",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { persona: "talent" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.deepEqual(container?.persona, {
    status: "AUTHORITATIVE",
    value: "company_admin",
    basis: "SOURCE_ACTOR",
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.ac.1" }],
  });
  assert.equal(container?.executionSessionBinding.persona, "company_admin");
  assert.notEqual(container?.persona.status, "CONFLICT");
});

test("MODEL_PERSONA_ABSENCE_CANNOT_ERASE_UNAMBIGUOUS_SOURCE_PERSONA_V1", () => {
  const ctx = context(["Company users can view records."]);
  const candidate = semanticCandidate(
    "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger
  );
  delete candidate.proposedPersona;
  const result = run({
    texts: ["Company users can view records."],
    candidates: [candidate],
  });
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.persona.value,
    "company_admin"
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.persona.basis,
    "SOURCE_ACTOR"
  );
});

test("conflicting source actors remain unresolved", () => {
  const result = run({ texts: [
    "Company users can view records.",
    "Talents can edit records.",
  ] });
  assert.equal(result.plan.browserCases.length, 0);
});

test("fixture speculation and ambiguous identity fail closed", () => {
  const text = "Company users can verify behavior.";
  const ctx = context([text]);
  const speculative = semanticCandidate(
    "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
    { fixtureNeeds: [{ text: "An ideal seeded record", obligationIds: ["obligation-1"] }] }
  );
  const result = run({
    texts: [text], candidates: [speculative],
    cases: [browserCase("candidate-1", {
      fixtureRequirements: ["An ideal seeded record"],
      fixtureAuthority: {
        authority: "SOURCE_UNAVAILABLE",
        entityKind: "record",
        reason: "ambiguous",
      },
    })],
  });
  assert.equal(result.plan.browserCases.length, 0);
  assert.deepEqual(result.plan.browserSemanticPlanningAudit?.fixtureUnavailableObligationIds, ["obligation-1"]);
});

test("obligation-traceable fixtures stay local to their own group", () => {
  const texts = [
    "Company users can verify requirement A.",
    "Company users require fixture B.",
  ];
  const ctx = context(texts);
  const cases = [browserCase("a"), browserCase("b", {
    routeSourceRef: "jira.ac.2",
    fixtureRequirements: [texts[1]!],
    fixtureAuthority: {
      authority: "EXPLICIT_SOURCE_IDENTITY",
      entityKind: "record",
      entityId: "source-id",
      sourceRef: "jira.ac.2",
      reason: "explicit",
    },
  })];
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases,
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger, {
        fixtureNeeds: [{ text: texts[1]!, obligationIds: ["obligation-2"] }],
      }),
    ],
  });
  const caseA = result.plan.browserCases.find((item) =>
    item.acceptanceObligationIds?.includes("obligation-1")
  );
  const caseB = result.plan.browserCases.find((item) =>
    item.acceptanceObligationIds?.includes("obligation-2")
  );
  assert.deepEqual(caseA?.fixtureRequirements, []);
  assert.equal(caseB?.fixtureRequirements?.length, 1);
});

test("planner-only exact literal stays candidate and cannot become acceptance proof", () => {
  const text = "Company users can verify behavior changes correctly.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { checkText: "Invented Exact Heading" }
    )],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(result.plan.browserCases[0]?.automatedChecks, []);
  assert.deepEqual(result.plan.browserCases[0]?.manualChecks, [text]);
  assert.equal(result.plan.browserSemanticPlanningAudit?.hallucinatedAuthorityCount, 0);
});

test("ticket accounting has zero silent obligation loss", () => {
  const result = run({ texts: ["A.", "B.", "C."] });
  assert.equal(result.plan.browserSemanticPlanningAudit?.authoritativeObligationCount, 3);
  assert.equal(result.plan.browserSemanticPlanningAudit?.unaccountedObligationIds.length, 0);
});

test("semantic allocation survives serialization and is idempotent", () => {
  const result = run({ texts: ["Company users can verify behavior."] });
  const before = JSON.stringify(result.plan);
  applyPlannerBrowserSemanticAllocation({
    plan: result.plan,
    semanticIr: result.semanticIr,
    verdictGrouping: result.grouping,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(result.plan), before);
  const reloaded = JSON.parse(before) as TestPlan;
  assert.equal(reloaded.browserSemanticIr?.version, "V1");
  assert.equal(reloaded.browserCases[0]?.semanticVerdictContract?.obligationIds[0], "obligation-1");
});

test("legacy plans retain byte-equivalent browser cases and API planning", () => {
  const legacyCase = browserCase("legacy");
  const result = run({
    texts: ["Behavior."], cases: [legacyCase], legacy: true,
  });
  assert.deepEqual(result.plan.browserCases, [legacyCase]);
  assert.equal(result.plan.browserSemanticPlanningAudit?.status, "LEGACY_COMPATIBILITY");
  result.plan.apiCases.push({
    id: "api-1", persona: "company_admin", method: "GET", path: "/api",
    expect: { status: 200 },
  });
  assert.equal(result.plan.apiCases.length, 1);
});

test("no grounded semantic candidate yields explicit fail-closed ticket accounting", () => {
  const result = run({ texts: ["Behavior."] });
  const emptyIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "NO_GROUNDED_CANDIDATES",
    candidates: [],
    rejectedCandidates: [{ candidateId: "forged", reason: "UNKNOWN_OBLIGATION" }],
  };
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Fail closed",
    apiCases: [],
    browserCases: [browserCase("candidate")],
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr: emptyIr,
    verdictGrouping: result.grouping,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(plan.browserCases.length, 0);
  assert.equal(plan.browserSemanticPlanningAudit?.status, "FAIL_CLOSED");
  assert.equal(plan.browserSemanticPlanningAudit?.unaccountedObligationIds.length, 0);
});

test("semantic mode defers browser budgeting while preserving the API budget", () => {
  const plan = {
    issueKey: "SYNTHETIC",
    summary: "Budget",
    apiCases: Array.from({ length: 5 }, (_, index) => ({
      id: `api-candidate-${index + 1}`,
      persona: "company_admin",
      method: "GET",
      path: `/api/${index + 1}`,
      expect: { status: 200, notes: `distinct-${index + 1}` },
    })),
    browserCases: Array.from({ length: 5 }, (_, index) =>
      browserCase(`browser-candidate-${index + 1}`)
    ),
  };
  applyPlannerCaseLimits(plan, { deferBrowserAllocation: true });
  assert.equal(plan.apiCases.length, 4);
  assert.equal(plan.browserCases.length, 5);
  assert.equal(plan.browserCases[4]?.id, "browser-candidate-5");
});

test("unknown grouping permits isolated obligation evidence planning without case or verdict promotion", () => {
  const ctx = context(["Behavior A.", "Behavior B.", "Behavior C."]);
  const cases = [browserCase("a"), browserCase("b")];
  const result = run({
    texts: ["Behavior A.", "Behavior B.", "Behavior C."],
    cases,
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger),
    ],
  });

  assert.equal(result.grouping.groups[0]?.relationship, "UNKNOWN");
  assert.equal(result.plan.browserCases.length, 0);
  assert.deepEqual(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts?.map(
      (item) => item.obligationId
    ).sort(),
    ["obligation-1", "obligation-2"]
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.obligationEvidenceAccounting
      ?.find((item) => item.obligationId === "obligation-3")?.disposition,
    "UNALLOCATED"
  );
  assert.equal(result.plan.acceptanceVerdictGrouping, undefined);
  assert.equal(
    JSON.stringify(result.plan.browserSemanticPlanningAudit?.evidenceContracts)
      .includes("PASS"),
    false
  );
  assert.ok(
    (result.plan.browserSemanticPlanningAudit?.evidenceContracts ?? [])
      .every((item) => !("verdict" in item))
  );
});

test("all unknown-group obligations may receive contracts while planning alone remains verdict-neutral", () => {
  const ctx = context(["A.", "B.", "C."]);
  const cases = [browserCase("a"), browserCase("b"), browserCase("c")];
  const candidates = cases.map((item, index) => semanticCandidate(
    item.id,
    item.id,
    [`obligation-${index + 1}`],
    ctx.obligationLedger
  ));
  candidates[0]!.proposedRelationshipHints = [{
    relationship: "INDEPENDENT",
    obligationIds: ["obligation-1"],
    dependsOnObligationIds: [],
    reason: "Model-only independence hint.",
  }];
  const result = run({ texts: ["A.", "B.", "C."], cases, candidates });

  assert.equal(result.grouping.groups[0]?.relationship, "UNKNOWN");
  assert.equal(result.grouping.groups[0]?.authority.status, "UNRESOLVED");
  assert.equal(result.plan.browserCases.length, 0);
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts?.length,
    3
  );
  assert.equal(
    JSON.stringify(result.plan.browserSemanticPlanningAudit).includes("PROVED"),
    false
  );
});

test("manual and unsupported siblings remain explicit ticket accounting beside an automatable contract", () => {
  const ctx = context([
    "Company users can verify automatable A.",
    "Manual B.",
    "Unsupported C.",
  ]);
  const result = run({
    texts: [
      "Company users can verify automatable A.",
      "Manual B.",
      "Unsupported C.",
    ],
    cases: [browserCase("a")],
    candidates: [semanticCandidate(
      "a", "a", ["obligation-1"], ctx.obligationLedger
    )],
    bindingStates: [
      "SUPPORTED_AND_BOUND",
      "MANUAL_BY_NATURE",
      "UNSUPPORTED_AUTOMATION_SEMANTIC",
    ],
  });
  const accounting = new Map(
    result.plan.browserSemanticPlanningAudit?.obligationEvidenceAccounting
      ?.map((item) => [item.obligationId, item.disposition])
  );
  assert.equal(accounting.get("obligation-1"), "EVIDENCE_CONTRACT_ALLOCATED");
  assert.equal(accounting.get("obligation-2"), "MANUAL");
  assert.equal(accounting.get("obligation-3"), "UNSUPPORTED_AUTOMATION");
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(result.plan.browserCases[0]?.executionVerdictScope, {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: ["obligation-1", "obligation-2", "obligation-3"],
    verdictAuthority: "GROUP_ONLY",
  });
});

test("one multi-obligation candidate creates isolated contracts and cannot discharge a sibling", () => {
  const result = run({ texts: ["A.", "B."] });
  const contracts = result.plan.browserSemanticPlanningAudit?.evidenceContracts ?? [];
  assert.equal(contracts.length, 2);
  assert.ok(contracts.every((item) => typeof item.obligationId === "string"));
  assert.deepEqual(
    contracts.map((item) => item.obligationId).sort(),
    ["obligation-1", "obligation-2"]
  );
});

test("a candidate reference outside the authoritative ledger cannot create evidence authority", () => {
  const ctx = context(["Authoritative A."]);
  const forged = semanticCandidate(
    "forged", "candidate-1", ["obligation-1"], ctx.obligationLedger
  );
  forged.obligationIds = ["non-authoritative-obligation"];
  const result = run({
    texts: ["Authoritative A."],
    candidates: [forged],
  });
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts?.length,
    0
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.obligationEvidenceAccounting?.[0]
      ?.disposition,
    "UNALLOCATED"
  );
});

test("duplicate evidence inputs dedupe deterministically and candidate order does not affect contract identity", () => {
  const ctx = context(["A.", "B."]);
  const cases = [browserCase("a"), browserCase("b")];
  const a = semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger);
  const b = semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger);
  const duplicateA = { ...a };
  const forward = run({ texts: ["A.", "B."], cases, candidates: [a, duplicateA, b] });
  const reverse = run({ texts: ["A.", "B."], cases, candidates: [b, duplicateA, a] });
  const ids = (plan: TestPlan) => plan.browserSemanticPlanningAudit
    ?.evidenceContracts?.map((item) => item.evidenceContractId).sort();
  assert.deepEqual(ids(forward.plan), ids(reverse.plan));
  assert.equal(ids(forward.plan)?.length, 2);
});

test("execution-container budget is deterministic and explicitly accounts overflow", () => {
  const texts = Array.from(
    { length: 5 },
    (_, index) => `Company users can verify requirement ${index + 1}.`
  );
  const ctx = context(texts);
  const cases = texts.map((_, index) => browserCase(
    `candidate-${index + 1}`,
    { routeSourceRef: `jira.ac.${index + 1}` }
  ));
  const result = run({
    texts,
    groups: authoritativeGroups(ctx.obligationLedger, ctx.sourceLedger),
    cases,
    candidates: cases.map((item, index) => semanticCandidate(
      `semantic-${index + 1}`,
      item.id,
      [`obligation-${index + 1}`],
      ctx.obligationLedger
    )),
  });
  const containers = result.plan.browserSemanticPlanningAudit
    ?.executionContainers ?? [];
  assert.equal(containers.length, 5);
  assert.equal(
    containers.filter((item) => item.readiness === "UNALLOCATED_BUDGET").length,
    1
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.obligationEvidenceAccounting
      ?.filter((item) => item.disposition === "UNALLOCATED").length,
    1
  );
});

test("required split execution shells preserve parent identity without first-child selection", () => {
  const ctx = context([
    "Company users see invoice details in sent for processing and processed states.",
  ]);
  const original = browserCase("candidate", { persona: "company_admin" });
  original.goal = "Open invoice details in sent for processing and processed states.";
  original.successCriteria = original.goal;
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Required partition",
    apiCases: [],
    browserCases: [original],
    acceptanceSourceLedger: ctx.sourceLedger,
    browserObligationBindings: [{
      obligationId: "obligation-1",
      sourceUnitIds: ["source-1"],
      semanticFamily: "OTHER",
      state: "SUPPORTED_AND_BOUND",
      allocatedCaseIds: [],
      emittedRequirementIds: ["requirement-1"],
      reason: "synthetic",
    }],
  };
  splitCombinedInvoiceStateCases(plan);
  const once = JSON.stringify(plan.browserCases);
  splitCombinedInvoiceStateCases(plan);
  assert.equal(JSON.stringify(plan.browserCases), once);
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: [semanticCandidate(
      "semantic", "candidate", ["obligation-1"], ctx.obligationLedger
    )],
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  applyPlannerBrowserSemanticAllocation({
    plan, semanticIr, verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });

  const container = plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(container?.sourceCaseId, "candidate");
  assert.equal(container?.requiredExecutionCaseIds.length, 2);
  assert.deepEqual(container?.executionCaseIds, [
    "candidate-processed", "candidate-sent",
  ]);
  assert.equal(
    plan.browserSemanticPlanningAudit?.evidenceContracts?.[0]?.disposition,
    "PLANNED"
  );
  assert.equal(plan.browserCases.length, 0);
  assert.match(
    plan.browserSemanticPlanningAudit?.contracts[0]?.reason ?? "",
    /complete required execution-shell partition/
  );
});

test("source-backed approved invoice uses the bounded runtime invoice resolver without trusting a model invoice hint", () => {
  const sourceText =
    "On the talent payments page, clicking the invoice number of an approved invoice opens its details drawer and displays approved-by information.";
  const ctx = context([sourceText]);
  const obligationId =
    ctx.obligationLedger.obligations[0]!.id;

  const testCase = browserCase("approved-invoice", {
    route: "/talent/payments",
    persona: "talent",
    routeOrigin: "UI_ROUTE_CATALOG",
    routeAuthoritative: false,
    routeStatus: "RESOLVED",
  });

  testCase.goal =
    "Open an approved invoice from its invoice number and inspect the invoice details drawer.";
  testCase.successCriteria =
    "The approved invoice details drawer displays approved-by information.";
  testCase.runtimeFixturePolicy = "exact";
  testCase.steps = [
    {
      action: "clickText",
      text: "INV-MODEL-HINT",
    },
    {
      action: "assertTextVisible",
      text: "Invoice Approved By",
    },
  ];

  const policyPlan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Approved invoice resolver parity",
    apiCases: [],
    browserCases: [testCase],
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };

  applyPlannerRuntimeFixturePolicies(
    policyPlan,
    [
      "--- JIRA TICKET ---",
      sourceText,
      "--- GITHUB CHANGE CONTEXT ---",
      'const exampleInvoice = "INV-MODEL-HINT";',
    ].join("\n")
  );

  assert.equal(
    testCase.runtimeFixturePolicy,
    "compatible-state"
  );

  assert.equal(
    (testCase.steps ?? []).find(
      (step) => step.action === "clickText"
    )?.text,
    "invoice number"
  );

  const result = run({
    texts: [sourceText],
    cases: [testCase],
    candidates: [
      semanticCandidate(
        "approved-invoice-semantic",
        testCase.id,
        [obligationId],
        ctx.obligationLedger,
        {
          targetSurface: "talent payments table",
          persona: "talent",
        }
      ),
    ],
  });

  const container =
    result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];

  assert.equal(
    container?.mutationClass,
    "READ_ONLY"
  );

  const labelOnly = browserCase(
    "approved-label-only",
    {
      route: "/talent/payments",
      persona: "talent",
    }
  );

  labelOnly.goal =
    "Open invoice details and display Invoice Approved By.";
  labelOnly.successCriteria =
    "Invoice Approved By is visible.";
  labelOnly.runtimeFixturePolicy = "exact";
  labelOnly.steps = [
    {
      action: "clickText",
      text: "INV-MODEL-HINT",
    },
  ];

  const labelPlan: TestPlan = {
    issueKey: "SYNTHETIC-LABEL",
    summary: "Approved-by label is not approved-state authority",
    apiCases: [],
    browserCases: [labelOnly],
  };

  applyPlannerRuntimeFixturePolicies(
    labelPlan,
    [
      "--- JIRA TICKET ---",
      "The invoice details drawer displays Invoice Approved By.",
      "--- GITHUB CHANGE CONTEXT ---",
      'const exampleInvoice = "INV-MODEL-HINT";',
    ].join("\n")
  );

  assert.equal(
    labelOnly.runtimeFixturePolicy,
    "exact"
  );
});

test("atomic invoice execution identity is not widened by parent success criteria", () => {
  const parentCriteria =
    "Invoice details are displayed in the sent for processing and processed states.";

  for (const expected of [
    "sent for processing",
    "processed",
  ] as const) {
    const testCase = browserCase(`atomic-${expected}`);
    testCase.goal =
      `Open the invoice details drawer in the ${expected} state.`;
    testCase.successCriteria = parentCriteria;
    testCase.steps = [{
      action: "clickTopTab",
      text: expected,
    }];
    const plan: TestPlan = {
      issueKey: "SYNTHETIC",
      summary: "Atomic execution identity",
      apiCases: [],
      browserCases: [testCase],
    };

    splitCombinedInvoiceStateCases(plan);

    assert.equal(plan.browserCases.length, 1);
    assert.equal(plan.browserCases[0]?.id, testCase.id);
    assert.equal(
      (plan.browserCases[0] as BrowserTestCase & {
        __plannerInvoiceState?: string;
      }).__plannerInvoiceState,
      expected
    );

    applyPlannerRuntimeFixturePolicies(
      plan,
      `--- JIRA TICKET ---\n${parentCriteria}\n--- GITHUB CHANGE CONTEXT ---`
    );

    assert.deepEqual(plan.browserCases[0]?.steps?.[0], {
      action: "clickTopTab",
      text: expected,
    });
    assert.match(plan.browserCases[0]?.goal ?? "", new RegExp(expected));
    assert.equal(
      "__plannerInvoiceState" in (plan.browserCases[0] ?? {}),
      false
    );
  }
});

function runtimeInvoiceFixturePlan(options: {
  sourceText?: string;
  removeMember?: boolean;
} = {}) {
  const text = options.sourceText ??
    "In the company payments table, invoice details are displayed in the sent for processing and processed tabs.";
  const ctx = context([text]);
  const original = browserCase("candidate", {
    route: "/company/payments",
    persona: "company_admin",
    routeSourceRef: "jira.ac.1",
  });
  original.goal = "Open the invoice details drawer in sent for processing and processed states.";
  original.successCriteria = original.goal;
  original.fixtureRequirements = ["Model asks for any convenient invoice row."];
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Runtime invoice fixture contract",
    apiCases: [],
    browserCases: [original],
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
    browserObligationBindings: [{
      obligationId: "obligation-1",
      sourceUnitIds: ["source-1"],
      semanticFamily: "OTHER",
      state: "SUPPORTED_BUT_UNBOUND",
      allocatedCaseIds: [],
      reason: "proof remains outside fixture resolution",
    }],
  };
  splitCombinedInvoiceStateCases(plan);
  applyPlannerRuntimeFixturePolicies(
    plan,
    `--- JIRA TICKET ---\n${text}\n--- GITHUB CHANGE CONTEXT ---`
  );
  assert.ok(plan.browserCases.every((testCase) =>
    testCase.runtimeFixturePolicy === "compatible-state"
  ), JSON.stringify(plan.browserCases.map((testCase) => ({
    id: testCase.id,
    policy: testCase.runtimeFixturePolicy,
    state: (testCase as BrowserTestCase & { __plannerInvoiceState?: string })
      .__plannerInvoiceState,
  }))));
  if (options.removeMember) plan.browserCases.pop();
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: [semanticCandidate(
      "semantic", "candidate", ["obligation-1"], ctx.obligationLedger,
      {
        targetSurface: "Company payments table invoice details drawer",
        fixtureNeeds: [{
          text: "Model asks for any convenient invoice row.",
          obligationIds: ["obligation-1"],
        }],
      }
    )],
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  applyPlannerBrowserSemanticAllocation({
    plan, semanticIr, verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return { plan, ...ctx };
}

test("source-backed invoice shell members become runtime-resolution-required without becoming fixture-ready", () => {
  const { plan } = runtimeInvoiceFixturePlan();
  const container = plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(
    container?.readiness,
    "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION",
    JSON.stringify(container?.runtimeFixtureResolution)
  );
  assert.equal(
    container?.fixture.status,
    "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
  );
  assert.equal(container?.runtimeFixtureResolution?.fixtureReadyForInteraction, false);
  assert.deepEqual(
    container?.runtimeFixtureResolution?.members.map((member) => ({
      state: member.acceptanceFixtureConstraint?.fixtureKind === "invoice"
        ? member.acceptanceFixtureConstraint.semantic.state
        : undefined,
      authority: member.acceptanceFixtureConstraint?.authority,
      capability: member.fixtureResolutionCapability?.classification,
      selection: member.fixtureResolutionCapability?.selectionPolicy,
      ambiguity: member.fixtureResolutionCapability?.ambiguityPolicy,
      binding: member.runtimeFixtureBinding,
    })),
    [
      {
        state: "processed", authority: "SOURCE_AUTHORIZED",
        capability: "READ_ONLY_DISCOVERY", selection: "UNIQUE_COMPATIBLE_ONLY",
        ambiguity: "BLOCK_TEST_DATA_ISSUE", binding: "NOT_YET_RESOLVED",
      },
      {
        state: "sent-for-processing", authority: "SOURCE_AUTHORIZED",
        capability: "READ_ONLY_DISCOVERY", selection: "UNIQUE_COMPATIBLE_ONLY",
        ambiguity: "BLOCK_TEST_DATA_ISSUE", binding: "NOT_YET_RESOLVED",
      },
    ]
  );
  assert.equal(plan.browserCases.length, 2);
  assert.ok(plan.browserCases.every((testCase) =>
    testCase.runtimeFixtureResolutionContract?.members.length === 2 &&
    testCase.runtimeFixtureResolutionContract.fixtureReadyForInteraction === false
  ));
  assert.deepEqual(
    container?.runtimeFixtureResolution?.acceptanceCoverage,
    {
      kind: "INVOICE_STATE",
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["processed", "sent-for-processing"],
      plannedMemberIds: ["processed", "sent-for-processing"],
    }
  );
  assert.equal(JSON.stringify(plan).includes("PROVED"), false);
  assert.equal(JSON.stringify(plan).includes('"verdict":"PASS"'), false);
  assert.equal(JSON.stringify(plan).includes('"verdict":"FAIL"'), false);
});

function atomicRuntimeInvoiceFixturePlan(options: {
  id?: string;
  state: "processed" | "sent for processing";
  sourceText?: string;
  route?: string;
  targetSurface?: string;
}) {
  const sourceText = options.sourceText ??
    "In the company payments table, invoice details are displayed in the sent for processing and processed tabs.";
  const ctx = context([sourceText]);
  const testCase = browserCase(options.id ?? "atomic", {
    route: options.route ?? "/company/payments",
    persona: "company_admin",
    routeSourceRef: "jira.ac.1",
  });
  testCase.goal =
    `Open invoice details in the ${options.state} state.`;
  testCase.successCriteria = testCase.goal;
  testCase.runtimeFixturePolicy = "compatible-state";
  testCase.fixtureRequirements = ["Model proposes a convenient invoice."];
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Atomic practical browser authoring",
    apiCases: [],
    browserCases: [testCase],
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
    browserObligationBindings: [{
      obligationId: "obligation-1",
      sourceUnitIds: ["source-1"],
      semanticFamily: "OTHER",
      state: "SUPPORTED_BUT_UNBOUND",
      allocatedCaseIds: [],
      reason: "Proof binding intentionally remains outside authoring.",
    }],
  };
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: [semanticCandidate(
      `semantic-${options.id ?? "atomic"}`,
      testCase.id,
      ["obligation-1"],
      ctx.obligationLedger,
      {
        targetSurface: options.targetSurface ??
          "Company payments table invoice details drawer",
        fixtureNeeds: [{
          text: "Model proposes a convenient invoice.",
          obligationIds: ["obligation-1"],
        }],
      }
    )],
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const sourceCases = [structuredClone(testCase)];
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return { plan, semanticIr, grouping, sourceCases, ...ctx };
}

test("archived runtime-fixture replay refreshes a stale derived startRoute without replacing case provenance", () => {
  const result = atomicRuntimeInvoiceFixturePlan({ state: "processed" });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const container = reloaded.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.ok(container);
  assert.equal(reloaded.browserCases.length, 1);
  const testCase = reloaded.browserCases[0]!;
  const caseId = testCase.id;
  const routeResolutionBefore = JSON.stringify(testCase.routeResolution);

  container.route = {
    status: "CANDIDATE",
    value: "/company/all-timesheets",
    basis: "PLANNER_CANDIDATE",
  };
  testCase.startRoute = "/company/all-timesheets";

  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
    sourceCases: result.sourceCases,
  });

  assert.equal(container.route.value, "/company/payments");
  assert.equal(container.executionNavigationBinding.route, "/company/payments");
  assert.equal(reloaded.browserCases[0]?.id, caseId);
  assert.equal(reloaded.browserCases[0]?.startRoute, "/company/payments");
  assert.equal(
    JSON.stringify(reloaded.browserCases[0]?.routeResolution),
    routeResolutionBefore
  );

  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
    sourceCases: result.sourceCases,
  });
  assert.equal(JSON.stringify(reloaded), once);
});

test("archived runtime transport refreshes obligation allocation audit after stable derived case materialization", () => {
  const result = atomicRuntimeInvoiceFixturePlan({ state: "processed" });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;

  reloaded.browserCases = [];
  reloaded.obligationCaseAllocationAudit = {
    obligationCount: 1,
    stableIdCaseRepresentationCount: 0,
    exactCaseRepresentationCount: 0,
    exactRepresentationRemovedCount: 0,
    notesOnlyCount: 0,
    notExactlyRepresentedCount: 1,
    allocations: [{
      obligationId: "obligation-1",
      status: "NOT_EXACTLY_REPRESENTED",
      matchedCaseIds: [],
      removedCaseIds: [],
    }],
  };

  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
    sourceCases: result.sourceCases,
  });

  assert.equal(reloaded.browserCases.length, 1);
  const runtimeCaseId = reloaded.browserCases[0]!.id;
  assert.match(runtimeCaseId, /^web-runtime-fixture-/);
  assert.deepEqual(reloaded.obligationCaseAllocationAudit, {
    obligationCount: 1,
    stableIdCaseRepresentationCount: 1,
    exactCaseRepresentationCount: 0,
    exactRepresentationRemovedCount: 0,
    notesOnlyCount: 0,
    notExactlyRepresentedCount: 0,
    allocations: [{
      obligationId: "obligation-1",
      status: "STABLE_ID_CASE_REPRESENTATION",
      matchedCaseIds: [runtimeCaseId],
      removedCaseIds: [],
    }],
  });

  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
    sourceCases: result.sourceCases,
  });
  assert.equal(JSON.stringify(reloaded), once);
});

test("practical atomic invoice states materialize independently with source-backed singleton fixture members", () => {
  for (const expected of [
    { authored: "processed" as const, canonical: "processed" as const },
    {
      authored: "sent for processing" as const,
      canonical: "sent-for-processing" as const,
    },
  ]) {
    const { plan } = atomicRuntimeInvoiceFixturePlan({ state: expected.authored });
    const container = plan.browserSemanticPlanningAudit?.executionContainers?.[0];
    const contract = container?.runtimeFixtureResolution;
    assert.equal(
      container?.readiness,
      "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
    );
    assert.deepEqual(container?.requiredExecutionCaseIds, ["atomic"]);
    assert.equal(contract?.members.length, 1);
    assert.equal(
      contract?.members[0]?.acceptanceFixtureConstraint?.fixtureKind === "invoice"
        ? contract.members[0].acceptanceFixtureConstraint.semantic.state
        : undefined,
      expected.canonical
    );
    assert.equal(
      contract?.members[0]?.acceptanceFixtureConstraint?.authority,
      "SOURCE_AUTHORIZED"
    );
    assert.equal(
      contract?.members[0]?.fixtureResolutionCapability?.classification,
      "READ_ONLY_DISCOVERY"
    );
    assert.equal(
      contract?.members[0]?.runtimeFixtureBinding,
      "NOT_YET_RESOLVED"
    );
    assert.equal(contract?.fixtureReadyForInteraction, false);
    assert.deepEqual(contract?.acceptanceCoverage, {
      kind: "INVOICE_STATE",
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["processed", "sent-for-processing"],
      plannedMemberIds: [expected.canonical],
    });
    assert.equal(container?.fixture.requirements[0]?.authority, "CANDIDATE_ONLY");
    assert.equal(plan.browserCases.length, 1);
    assert.equal(
      plan.browserCases[0]?.runtimeFixtureResolutionContract
        ?.interactionExecutionCaseId,
      "atomic"
    );
    assert.equal(
      plan.browserSemanticPlanningAudit?.evidenceContracts?.[0]
        ?.proofCapability.state,
      "SUPPORTED_BUT_UNBOUND"
    );
    assert.equal(JSON.stringify(plan).includes("PROVED"), false);
    assert.equal(JSON.stringify(plan).includes('"verdict":"PASS"'), false);
    assert.equal(JSON.stringify(plan).includes('"verdict":"FAIL"'), false);
  }
});

test("an atomic practical case cannot claim another source-required state", () => {
  const { plan } = atomicRuntimeInvoiceFixturePlan({
    state: "sent for processing",
    sourceText:
      "In the company payments table, processed invoice details are displayed.",
  });
  const container = plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(container?.runtimeFixtureResolution, undefined);
  assert.equal(container?.readiness, "FIXTURE_UNAVAILABLE");
  assert.equal(plan.browserCases.length, 0);
});

function fourAtomicInvoiceContexts(reverse = false) {
  const sourceText =
    "In the company payments and all payments tables, invoice details are displayed in the sent for processing and processed tabs.";
  const ctx = context([sourceText]);
  const definitions = [
    ["payments-processed", "/company/payments", "processed", "Company payments table invoice details drawer"],
    ["payments-sent", "/company/payments", "sent for processing", "Company payments table invoice details drawer"],
    ["all-payments-processed", "/company/all-payments", "processed", "Company all payments table invoice details drawer"],
    ["all-payments-sent", "/company/all-payments", "sent for processing", "Company all payments table invoice details drawer"],
  ] as const;
  const cases = definitions.map(([id, route, state]) => {
    const testCase = browserCase(id, {
      route,
      persona: "company_admin",
      routeSourceRef: "jira.ac.1",
    });
    testCase.goal = `Open invoice details in the ${state} state.`;
    testCase.successCriteria = sourceText;
    testCase.fixtureRequirements = ["Model proposes a convenient invoice."];
    testCase.steps = [{ action: "clickTopTab", text: state }];
    return testCase;
  });
  const candidates = definitions.map(([id, , , targetSurface]) =>
    semanticCandidate(
      `semantic-${id}`,
      id,
      ["obligation-1"],
      ctx.obligationLedger,
      {
        targetSurface,
        fixtureNeeds: [{
          text: "Model proposes a convenient invoice.",
          obligationIds: ["obligation-1"],
        }],
      }
    )
  );
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: reverse ? [...candidates].reverse() : candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Four practical contexts",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };
  splitCombinedInvoiceStateCases(plan);
  applyPlannerRuntimeFixturePolicies(
    plan,
    `--- JIRA TICKET ---\n${sourceText}\n--- GITHUB CHANGE CONTEXT ---`
  );
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return plan;
}

function coarseMultiSurfaceAtomicInvoiceContexts(options: {
  reverse?: boolean;
  sourceText?: string;
  states?: Array<"processed" | "sent for processing">;
  targetSurface?: string;
} = {}) {
  const sourceText = options.sourceText ??
    "In the payments and all payments table, invoice details are displayed in the sent for processing and processed tabs.";
  const states = options.states ?? ["processed", "sent for processing"];
  const ctx = context([sourceText]);
  const cases = states.map((state) => {
    const id = `coarse-${state.replaceAll(" ", "-")}`;
    const testCase = browserCase(id, {
      route: "/company/all-payments",
      persona: "company_admin",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    });
    testCase.goal = `Open invoice details in the ${state} state.`;
    testCase.successCriteria = testCase.goal;
    testCase.runtimeFixturePolicy = "compatible-state";
    testCase.fixtureRequirements = ["Model proposes a convenient invoice."];
    testCase.steps = [{ action: "clickTopTab", text: state }];
    return testCase;
  });
  const candidates = cases.map((testCase, index) => semanticCandidate(
    `semantic-${testCase.id}`,
    testCase.id,
    ["obligation-1"],
    ctx.obligationLedger,
    {
      targetSurface: options.targetSurface ??
        `Payments and all payments table, ${states[index]} tab, invoice details drawer`,
      fixtureNeeds: [{
        text: "Model proposes a convenient invoice.",
        obligationIds: ["obligation-1"],
      }],
    }
  ));
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: options.reverse ? [...candidates].reverse() : candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Coarse multi-surface atomic authoring",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return plan;
}

function invoiceSurfaceStateCoverage(plan: TestPlan): string[] {
  return plan.browserCases.map((testCase) => {
    const constraint = testCase.runtimeFixtureResolutionContract?.members[0]
      ?.acceptanceFixtureConstraint;
    const state = constraint?.fixtureKind === "invoice"
      ? constraint.semantic.state
      : "unknown";
    return `${testCase.startRoute}|${state}`;
  }).sort();
}

test("coarse source-authorized surfaces cross only a complete atomic fixture dimension", () => {
  const coarse = coarseMultiSurfaceAtomicInvoiceContexts();
  assert.deepEqual(invoiceSurfaceStateCoverage(coarse), [
    "/company/all-payments|processed",
    "/company/all-payments|sent-for-processing",
    "/company/payments|processed",
    "/company/payments|sent-for-processing",
  ]);
  assert.equal(coarse.browserCases.length, 4);
  assert.ok(coarse.browserCases.every((testCase) =>
    testCase.plannerExecutionShell?.sourceCaseId.startsWith("coarse-") &&
    testCase.acceptanceObligationIds?.includes("obligation-1") &&
    testCase.runtimeFixtureResolutionContract?.members[0]
      ?.acceptanceFixtureConstraint?.authority === "SOURCE_AUTHORIZED"
  ));
  assert.equal(JSON.stringify(coarse).includes("PROVED"), false);
  assert.equal(JSON.stringify(coarse).includes('"verdict":"PASS"'), false);
});

test("coarse and explicit surface-state authoring have equivalent execution coverage without duplicates", () => {
  const coarse = coarseMultiSurfaceAtomicInvoiceContexts();
  const explicit = fourAtomicInvoiceContexts();
  assert.deepEqual(
    invoiceSurfaceStateCoverage(coarse),
    invoiceSurfaceStateCoverage(explicit)
  );
  assert.equal(new Set(coarse.browserCases.map((item) => item.id)).size, 4);
});

test("coarse multi-surface derived identity is candidate-order independent", () => {
  const forward = coarseMultiSurfaceAtomicInvoiceContexts();
  const reverse = coarseMultiSurfaceAtomicInvoiceContexts({ reverse: true });
  assert.deepEqual(reverse.browserCases, forward.browserCases);
  assert.deepEqual(reverse.browserSemanticIr, forward.browserSemanticIr);

  const reloaded = JSON.parse(JSON.stringify(forward)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: reloaded.acceptanceObligationLedger!,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: reloaded.acceptanceObligationLedger!,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.deepEqual(
    invoiceSurfaceStateCoverage(reloaded),
    invoiceSurfaceStateCoverage(forward)
  );
});

test("coarse expansion cannot invent a surface or an unsupported atomic state", () => {
  const oneSurface = coarseMultiSurfaceAtomicInvoiceContexts({
    sourceText:
      "In the payments table, invoice details are displayed in the sent for processing and processed tabs.",
  });
  assert.ok(oneSurface.browserCases.every((testCase) =>
    !testCase.id.startsWith("web-surface-member-")
  ));
  assert.ok(oneSurface.browserCases.every((testCase) =>
    testCase.startRoute !== "/company/all-timesheets"
  ));

  const unsupportedState = coarseMultiSurfaceAtomicInvoiceContexts({
    sourceText:
      "In the payments and all payments table, processed invoice details are displayed.",
    states: ["sent for processing"],
  });
  assert.equal(unsupportedState.browserCases.length, 0);
});

test("coarse expansion fails closed when candidate surface structure is ambiguous", () => {
  const ambiguous = coarseMultiSurfaceAtomicInvoiceContexts({
    targetSurface: "Invoice details drawer",
  });
  assert.ok(ambiguous.browserCases.every((testCase) =>
    !testCase.id.startsWith("web-surface-member-")
  ));
  assert.ok(ambiguous.browserCases.length <= 2);
});

function disclosureRun(options: {
  sourceText: string;
  targetText: string;
  extraSteps?: BrowserTestCase["steps"];
}) {
  const ctx = context([options.sourceText]);
  const source = browserCase("disclosure-case", {
    persona: "talent",
    steps: [
      { action: "clickText", text: options.targetText },
      ...(options.extraSteps ?? []),
      { action: "assertTextNotVisible", text: "undefined" },
    ],
  });
  source.startRoute = "UNKNOWN";
  source.runtimeFixturePolicy = "compatible-state";
  delete source.routeResolution;
  return run({
    texts: [options.sourceText],
    cases: [source],
    candidates: [semanticCandidate(
      "disclosure-semantic",
      source.id,
      ["obligation-1"],
      ctx.obligationLedger,
      {
        targetSurface: `Talent contract details ${options.targetText}`,
        persona: "talent",
      }
    )],
    bindingStates: ["SUPPORTED_BUT_UNBOUND"],
  });
}

function multiDisclosureBudgetRun(options: {
  targetPairs: Array<[string, string]>;
  directTargets?: string[];
  reverse?: boolean;
}) {
  const targets = [
    ...options.targetPairs.flat(),
    ...(options.directTargets ?? []),
  ];
  const sourceText =
    `When viewing my contract details, the talent can click both ${targets.join(", ")} items to display readonly signed details.`;
  const ctx = context([sourceText]);
  const cases = [
    ...options.targetPairs.map(([first, second], index) => {
      const source = browserCase(`multi-${index + 1}`, {
        persona: "talent",
        route: "/talent/dashboard?tab=contracts",
        routeOrigin: "UI_ROUTE_CATALOG",
        routeAuthoritative: false,
        routeStatus: "RESOLVED",
        steps: [
          { action: "clickText", text: first },
          { action: "clickText", text: second },
        ],
      });
      source.startRoute = "UNKNOWN";
      source.runtimeFixturePolicy = "compatible-state";
      delete source.routeResolution;
      return source;
    }),
    ...(options.directTargets ?? []).map((target, index) => {
      const source = browserCase(`direct-${index + 1}`, {
        persona: "talent",
        route: "/talent/dashboard?tab=contracts",
        routeOrigin: "UI_ROUTE_CATALOG",
        routeAuthoritative: false,
        routeStatus: "RESOLVED",
        steps: [{ action: "clickText", text: target }],
      });
      source.startRoute = "UNKNOWN";
      source.runtimeFixturePolicy = "compatible-state";
      delete source.routeResolution;
      return source;
    }),
  ];
  const candidates = cases.map((source) => semanticCandidate(
    `semantic-${source.id}`,
    source.id,
    ["obligation-1"],
    ctx.obligationLedger,
    {
      targetSurface: `Talent contract details ${
        (source.steps ?? []).find((step) => step.action === "clickText")
          ?.text ?? ""
      }`,
      persona: "talent",
    }
  ));
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates: options.reverse ? [...candidates].reverse() : candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
  });
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Bounded deterministic disclosure expansion",
    apiCases: [],
    browserCases: options.reverse ? [...cases].reverse() : cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
  };
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  return { plan, semanticIr, grouping, ...ctx };
}

test("source-grounded existing-detail disclosure becomes execution-safe without proof authority", () => {
  const result = disclosureRun({
    sourceText:
      "When viewing my contract details, I can click on the compliance document and display the version I signed, my signature, and the date I signed.",
    targetText: "compliance document",
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  const contract = result.plan.browserCases[0]
    ?.readOnlyDisclosureExecutionContract;
  assert.equal(container?.mutationClass, "READ_ONLY");
  assert.equal(
    container?.readiness,
    "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
  );
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(contract?.authority, "SOURCE_AUTHORIZED");
  assert.equal(contract?.interaction.targetText, "compliance document");
  assert.equal(
    contract?.interaction.runtimeGroundingPolicy,
    "UNIQUE_EXACT_VISIBLE_TARGET"
  );
  assert.equal(contract?.proofAuthority, "NONE");
  assert.equal(JSON.stringify(result.plan).includes("PROVED"), false);
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);

  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.deepEqual(
    reloaded.browserCases[0]?.readOnlyDisclosureExecutionContract,
    contract
  );
  assert.equal(
    reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.mutationClass,
    "READ_ONLY"
  );
});

test("source-grounded disclosure contracts are candidate-order independent", () => {
  const texts = [
    "The talent can open the existing compliance document to display readonly signed details.",
    "The talent can open the existing background check to view readonly status details.",
  ];
  const ctx = context(texts);
  const cases = ["compliance document", "background check"].map((target, index) => {
    const source = browserCase(`disclosure-${index + 1}`, {
      persona: "talent",
      steps: [{ action: "clickText", text: target }],
    });
    source.startRoute = "UNKNOWN";
    source.runtimeFixturePolicy = "compatible-state";
    delete source.routeResolution;
    return source;
  });
  const candidates = cases.map((source, index) => semanticCandidate(
    `semantic-${index + 1}`,
    source.id,
    [`obligation-${index + 1}`],
    ctx.obligationLedger,
    {
      targetSurface: `Talent contract details ${
        index === 0 ? "compliance document" : "background check"
      }`,
      persona: "talent",
    }
  ));
  const forward = run({
    texts,
    cases: structuredClone(cases),
    candidates,
    bindingStates: ["SUPPORTED_BUT_UNBOUND", "SUPPORTED_BUT_UNBOUND"],
  }).plan;
  const reverse = run({
    texts,
    cases: structuredClone(cases),
    candidates: [...candidates].reverse(),
    bindingStates: ["SUPPORTED_BUT_UNBOUND", "SUPPORTED_BUT_UNBOUND"],
  }).plan;
  const snapshot = (plan: TestPlan) => plan.browserSemanticPlanningAudit
    ?.executionContainers?.map((item) => ({
      sourceCaseId: item.sourceCaseId,
      mutationClass: item.mutationClass,
    })).sort((left, right) => left.sourceCaseId.localeCompare(right.sourceCaseId));
  assert.deepEqual(snapshot(reverse), snapshot(forward));
  assert.deepEqual(
    reverse.browserCases.map((item) =>
      item.readOnlyDisclosureExecutionContract?.contractId
    ).sort(),
    forward.browserCases.map((item) =>
      item.readOnlyDisclosureExecutionContract?.contractId
    ).sort()
  );
});

test("LLM READ_ONLY and an ordinary click cannot create disclosure authority", () => {
  const result = disclosureRun({
    sourceText: "The talent contract contains a compliance document requirement.",
    targetText: "compliance document",
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.mutationClass, "UNKNOWN");
  assert.equal(container?.readiness, "POLICY_BLOCKED");
  assert.equal(result.plan.browserCases.length, 0);
});

test("mutation-command targets remain blocked despite disclosure-shaped source and READ_ONLY proposal", () => {
  for (const targetText of [
    "Publish", "Save", "Submit", "Approve", "Reject", "Delete", "Create",
    "Update", "Request Publish", "Edit",
  ]) {
    const result = disclosureRun({
      sourceText:
        `The talent can click ${targetText} to display readonly contract details.`,
      targetText,
    });
    const container = result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];
    assert.equal(container?.mutationClass, "UNKNOWN", targetText);
    assert.equal(
      result.plan.browserCases.some((item) =>
        item.readOnlyDisclosureExecutionContract
      ),
      false,
      targetText
    );
  }

  const mixedConsequence = disclosureRun({
    sourceText:
      "The talent can click compliance document to display readonly details and approve it.",
    targetText: "compliance document",
  });
  assert.equal(
    mixedConsequence.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.mutationClass,
    "UNKNOWN"
  );
  assert.equal(mixedConsequence.plan.browserCases.length, 0);
});

test("source-backed multi-disclosure proposals atomize into independently safe members", () => {
  const result = disclosureRun({
    sourceText:
      "The talent can open both compliance document and background check items to view readonly details.",
    targetText: "compliance document",
    extraSteps: [{ action: "clickText", text: "background check" }],
  });
  const cases = result.plan.browserCases.filter((item) =>
    item.readOnlyDisclosureExecutionContract
  );
  assert.equal(cases.length, 2);
  assert.deepEqual(
    cases.map((item) => item.readOnlyDisclosureExecutionContract!.interaction.targetText)
      .sort(),
    ["background check", "compliance document"]
  );
  assert.equal(new Set(cases.map((item) => item.id)).size, 2);
  assert.ok(cases.every((item) =>
    item.steps?.filter((step) => step.action === "clickText").length === 1
  ));
  assert.ok(cases.every((item) =>
    item.readOnlyDisclosureExecutionContract?.proofAuthority === "NONE"
  ));
  assert.ok(cases.every((item) =>
    item.deterministicExecutionExpansion?.kind === "SOURCE_BACKED_ATOMIC_MEMBER" &&
    item.deterministicExecutionExpansion.authority === "SOURCE_AUTHORIZED"
  ));
});

test("four raw candidates may retain six validated deterministic execution units", () => {
  const result = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document", "background check"],
      ["Trolley", "Deel"],
    ],
    directTargets: ["work authorization", "tax form"],
  });
  const containers = result.plan.browserSemanticPlanningAudit
    ?.executionContainers ?? [];
  assert.equal(result.semanticIr.candidates.length, 6);
  assert.equal(containers.length, 6, JSON.stringify(containers.map((item) => ({
    readiness: item.readiness,
    reason: item.reason,
    target: item.target.sourceScope,
  }))));
  assert.equal(
    containers.filter((item) => item.readiness === "UNALLOCATED_BUDGET").length,
    0
  );
  assert.equal(result.plan.browserCases.length, 6);
  assert.equal(new Set(result.plan.browserCases.map((item) => item.id)).size, 6);
  assert.ok(result.plan.browserCases.every((item) =>
    item.readOnlyDisclosureExecutionContract?.proofAuthority === "NONE"
  ));
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
});

test("raw model over-generation remains capped at four direct execution units", () => {
  const texts = Array.from(
    { length: 6 },
    (_, index) => `Company users can verify requirement ${index + 1}.`
  );
  const ctx = context(texts);
  const cases = texts.map((_, index) => browserCase(`raw-${index + 1}`));
  const candidates = cases.map((item, index) => semanticCandidate(
    `raw-semantic-${index + 1}`,
    item.id,
    [`obligation-${index + 1}`],
    ctx.obligationLedger
  ));
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Raw proposal ceiling",
    apiCases: [],
    browserCases: cases,
    acceptanceSourceLedger: ctx.sourceLedger,
    acceptanceObligationLedger: ctx.obligationLedger,
    browserObligationBindings: ctx.obligationLedger.obligations.map((item) => ({
      obligationId: item.id,
      sourceUnitIds: item.sourceUnitIds,
      semanticFamily: "STATE_TRANSITION" as const,
      state: "SUPPORTED_AND_BOUND" as const,
      allocatedCaseIds: cases.map((testCase) => testCase.id),
      emittedRequirementIds: [`requirement-${item.id}`],
      reason: "synthetic proof registry",
    })),
  };
  const semanticIr: PlannerBrowserSemanticIr = {
    version: "V1",
    status: "ACTIVE",
    candidates,
    rejectedCandidates: [],
  };
  const grouping = buildPlannerAcceptanceVerdictGrouping({
    obligationLedger: ctx.obligationLedger,
    sourceLedger: ctx.sourceLedger,
    authoritativeGroups: ctx.obligationLedger.obligations.map((item, index) => ({
      obligationIds: [item.id],
      relationship: "INDEPENDENT" as const,
      sourceRefs: [{
        sourceUnitId: item.sourceUnitIds[0]!,
        sourceRef: ctx.sourceLedger.sourceUnits[index]!.sourceRef,
      }],
      reason: "synthetic independent source obligation",
    })),
  });
  applyPlannerBrowserSemanticAllocation({
    plan,
    semanticIr,
    verdictGrouping: grouping,
    obligationLedger: ctx.obligationLedger,
  });
  assert.equal(plan.browserCases.length, 4, JSON.stringify({
    containers: plan.browserSemanticPlanningAudit?.executionContainers?.map((item) => ({
      readiness: item.readiness,
      reason: item.reason,
      mutation: item.mutationClass,
      target: item.target.sourceScope,
      cases: item.executionCaseIds,
    })),
    contracts: plan.browserSemanticPlanningAudit?.contracts?.map((item) => ({
      disposition: item.disposition,
      reason: item.reason,
    })),
  }));
  assert.equal(
    plan.browserSemanticPlanningAudit?.contracts
      ?.filter((item) => item.disposition === "UNALLOCATED_BUDGET").length,
    2
  );
});

test("duplicate derived targets do not consume a second execution slot", () => {
  const result = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document", "background check"],
      ["Trolley", "Deel"],
      ["compliance document", "tax form"],
    ],
    directTargets: [],
  });
  const containers = result.plan.browserSemanticPlanningAudit
    ?.executionContainers ?? [];
  assert.equal(result.plan.browserCases.length, 5);
  assert.equal(
    containers.filter((item) => item.readiness === "UNALLOCATED_BUDGET").length,
    1
  );
  assert.match(
    containers.find((item) => item.readiness === "UNALLOCATED_BUDGET")?.reason ?? "",
    /effective execution identity duplicated/i
  );
});

test("deterministic expansion has a finite derived safety ceiling", () => {
  const result = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document 1", "compliance document 2"],
      ["compliance document 3", "compliance document 4"],
      ["compliance document 5", "compliance document 6"],
      ["compliance document 7", "compliance document 8"],
      ["compliance document 9", "compliance document 10"],
    ],
  });
  const containers = result.plan.browserSemanticPlanningAudit
    ?.executionContainers ?? [];
  assert.equal(result.semanticIr.candidates.length, 10);
  assert.equal(result.plan.browserCases.length, 8, JSON.stringify({
    candidates: result.semanticIr.candidates.length,
    containers: containers.map((item) => ({
      readiness: item.readiness,
      reason: item.reason,
      mutation: item.mutationClass,
      target: item.target.sourceScope,
      cases: item.executionCaseIds,
    })),
  }));
  assert.equal(
    containers.filter((item) => item.readiness === "UNALLOCATED_BUDGET").length,
    2
  );
  assert.ok(containers.filter((item) => item.readiness === "UNALLOCATED_BUDGET")
    .every((item) => /derived execution ceiling/i.test(item.reason)));
});

test("global browser execution sanity ceiling fails closed after bounded classes", () => {
  const result = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document 1", "compliance document 2"],
      ["compliance document 3", "compliance document 4"],
      ["compliance document 5", "compliance document 6"],
      ["compliance document 7", "compliance document 8"],
    ],
    directTargets: [
      "compliance document 9",
      "compliance document 10",
      "compliance document 11",
      "compliance document 12",
    ],
  });
  const containers = result.plan.browserSemanticPlanningAudit
    ?.executionContainers ?? [];
  assert.equal(result.plan.browserCases.length, 10);
  assert.ok(containers.some((item) =>
    item.readiness === "UNALLOCATED_BUDGET" &&
    /global browser execution sanity ceiling/i.test(item.reason)
  ));
});

test("bounded expansion is candidate-order independent and serialization stable", () => {
  const forward = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document", "background check"],
      ["Trolley", "Deel"],
    ],
    directTargets: ["work authorization", "tax form"],
  });
  const reverse = multiDisclosureBudgetRun({
    targetPairs: [
      ["compliance document", "background check"],
      ["Trolley", "Deel"],
    ],
    directTargets: ["work authorization", "tax form"],
    reverse: true,
  });
  assert.deepEqual(reverse.plan.browserCases, forward.plan.browserCases);
  assert.deepEqual(
    reverse.plan.browserSemanticPlanningAudit?.executionContainers,
    forward.plan.browserSemanticPlanningAudit?.executionContainers
  );
  const reloaded = JSON.parse(JSON.stringify(forward.plan)) as TestPlan;
  const before = JSON.stringify(reloaded);
  applyPlannerBrowserSemanticAllocation({
    plan: reloaded,
    semanticIr: forward.semanticIr,
    verdictGrouping: forward.grouping,
    obligationLedger: forward.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), before);
});

test("ambiguous multi-click disclosure shell fails closed", () => {
  const result = disclosureRun({
    sourceText:
      "The talent can open compliance document and background check items to view readonly details.",
    targetText: "compliance document",
    extraSteps: [{ action: "clickText", text: "background check" }],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.mutationClass, "UNKNOWN");
  assert.equal(container?.readiness, "POLICY_BLOCKED");
  assert.equal(result.plan.browserCases.length, 0);
});

test("existing transient local-state navigation classification is unchanged", () => {
  const text = "The company user can view the records table in either status tab.";
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      steps: [{ action: "clickTopTab", text: "Active" }],
    })],
    bindingStates: ["SUPPORTED_BUT_UNBOUND"],
  });
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.mutationClass,
    "TRANSIENT_REVERSIBLE"
  );
  assert.equal(
    result.plan.browserCases[0]?.readOnlyDisclosureExecutionContract,
    undefined
  );
});

test("four atomic surface-state proposals remain bounded, materializable, and order independent", () => {
  const forward = fourAtomicInvoiceContexts();
  const reverse = fourAtomicInvoiceContexts(true);
  assert.equal(forward.browserCases.length, 4);
  assert.deepEqual(
    forward.browserSemanticPlanningAudit?.sourceBackedAtomicSurfacePartitions,
    []
  );
  assert.equal(
    forward.browserSemanticPlanningAudit?.executionContainers
      ?.filter((item) =>
        item.readiness ===
          "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
      ).length,
    4
  );
  assert.deepEqual(
    forward.browserCases.map((item) => item.id),
    reverse.browserCases.map((item) => item.id)
  );
  assert.ok(forward.browserCases.every((item) =>
    item.runtimeFixtureResolutionContract?.members.length === 1 &&
    item.runtimeFixtureResolutionContract.fixtureReadyForInteraction === false
  ));
  const signatures = forward.browserCases.map((item) => [
    item.startRoute,
    item.runtimeFixtureResolutionContract?.members[0]
      ?.acceptanceFixtureConstraint?.fixtureKind === "invoice"
      ? item.runtimeFixtureResolutionContract.members[0]
        .acceptanceFixtureConstraint.semantic.state
      : undefined,
  ].join("|"));
  assert.equal(new Set(signatures).size, 4);
  assert.ok(forward.browserCases.every((item) => {
    const contract = item.runtimeFixtureResolutionContract;
    const coverage = contract?.acceptanceCoverage;
    const planned = coverage?.kind === "INVOICE_STATE"
      ? coverage.plannedMemberIds
      : [];
    const member = contract?.members[0];
    const constraint = member?.acceptanceFixtureConstraint;
    const capability = member?.fixtureResolutionCapability;
    return contract !== undefined &&
      coverage?.kind === "INVOICE_STATE" &&
      coverage.requiredMemberIds.length === 2 &&
      planned.length === 1 &&
      constraint?.fixtureKind === "invoice" &&
      constraint.semantic.state === planned[0] &&
      capability?.fixtureKind === "invoice" &&
      capability.supportedState === planned[0] &&
      member?.runtimeFixtureBinding === "NOT_YET_RESOLVED";
  }));
  assert.equal(JSON.stringify(forward).includes("PROVED"), false);
  assert.equal(JSON.stringify(forward).includes('"verdict":"PASS"'), false);
  assert.equal(JSON.stringify(forward).includes('"verdict":"FAIL"'), false);
});

test("atomic hybrid authoring is serialization-stable and allocation-idempotent", () => {
  const result = atomicRuntimeInvoiceFixturePlan({ state: "processed" });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const before = JSON.stringify(reloaded);
  applyPlannerBrowserSemanticAllocation({
    plan: reloaded,
    semanticIr: result.semanticIr,
    verdictGrouping: result.grouping,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), before);
  assert.deepEqual(
    reloaded.browserCases[0]?.runtimeFixtureResolutionContract
      ?.acceptanceCoverage,
    {
      kind: "INVOICE_STATE",
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["processed", "sent-for-processing"],
      plannedMemberIds: ["processed"],
    }
  );
});

test("runtime fixture materialization is ALL_REQUIRED, source-authorized, exact-safe, and round-trip stable", () => {
  const incomplete = runtimeInvoiceFixturePlan({ removeMember: true }).plan;
  assert.equal(
    incomplete.browserSemanticPlanningAudit?.executionContainers?.length,
    0
  );
  assert.equal(incomplete.browserCases.length, 0);

  const exact = runtimeInvoiceFixturePlan({
    sourceText: "In the company payments table, invoice INV-ABC-123-XYZ details are displayed in the sent for processing and processed tabs.",
  }).plan;
  const exactContainer = exact.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.notEqual(
    exactContainer?.readiness,
    "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
  );
  assert.equal(exact.browserCases.length, 0);

  const result = runtimeInvoiceFixturePlan();
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const before = JSON.stringify(
    reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeFixtureResolution
  );
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.equal(
    JSON.stringify(
      reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
        ?.runtimeFixtureResolution
    ),
    before
  );
});

test("incomplete required split is fail-closed and cannot masquerade as one complete shell", () => {
  const ctx = context(["A."]);
  const incomplete = browserCase("candidate-one");
  incomplete.plannerExecutionShell = {
    sourceCaseId: "candidate",
    partition: { mode: "ALL_REQUIRED", memberId: "one", memberCount: 2 },
  };
  const result = run({
    texts: ["A."],
    cases: [incomplete],
    candidates: [semanticCandidate(
      "semantic", "candidate", ["obligation-1"], ctx.obligationLedger
    )],
  });
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts?.[0]?.disposition,
    "CANDIDATE_UNAVAILABLE"
  );
  assert.equal(
    result.plan.browserSemanticPlanningAudit?.executionContainers?.length,
    0
  );
});

test("a complete one-member derived shell retains candidate identity through materialization", () => {
  const ctx = context(["Company users can view A."]);
  const derived = browserCase("candidate-derived");
  derived.plannerExecutionShell = {
    sourceCaseId: "candidate",
    partition: { mode: "ALL_REQUIRED", memberId: "only", memberCount: 1 },
  };
  const result = run({
    texts: ["Company users can view A."],
    cases: [derived],
    candidates: [semanticCandidate(
      "semantic", "candidate", ["obligation-1"], ctx.obligationLedger
    )],
  });
  assert.equal(result.plan.browserCases.length, 1);
  assert.deepEqual(
    result.plan.browserCases[0]?.acceptanceObligationIds,
    ["obligation-1"]
  );
});

test("unresolved target fixture and proof remain explicit planning states and never proof results", () => {
  const texts = [
    "Company users can verify A.",
    "Company users can verify B.",
    "Company users can verify C.",
  ];
  const ctx = context(texts);
  const weakTarget = browserCase("a", {
    routeOrigin: "UI_ROUTE_CATALOG",
    routeAuthoritative: false,
    routeStatus: "RESOLVED",
  });
  const fixtureCase = browserCase("b", {
    routeSourceRef: "jira.ac.2",
    fixtureRequirements: ["B."],
    fixtureAuthority: {
      authority: "SOURCE_UNAVAILABLE",
      entityKind: "record",
      reason: "unavailable",
    },
  });
  const proofUnknown = browserCase("c", { routeSourceRef: "jira.ac.3" });
  const result = run({
    texts,
    cases: [weakTarget, fixtureCase, proofUnknown],
    candidates: [
      semanticCandidate("a", "a", ["obligation-1"], ctx.obligationLedger),
      semanticCandidate("b", "b", ["obligation-2"], ctx.obligationLedger, {
        fixtureNeeds: [{ text: "B.", obligationIds: ["obligation-2"] }],
      }),
      semanticCandidate("c", "c", ["obligation-3"], ctx.obligationLedger),
    ],
    bindingStates: [
      "SUPPORTED_AND_BOUND",
      "SUPPORTED_AND_BOUND",
      "UNALLOCATED_AUTHORITATIVE_OBLIGATION",
    ],
  });
  const byObligation = new Map(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts
      ?.map((item) => [item.obligationId, item])
  );
  assert.equal(byObligation.get("obligation-1")?.disposition, "PLANNED");
  assert.equal(byObligation.get("obligation-2")?.disposition, "FIXTURE_UNAVAILABLE");
  assert.equal(byObligation.get("obligation-3")?.disposition, "PLANNED");
  assert.equal(byObligation.get("obligation-3")?.proofCapability.state, "UNKNOWN");
  assert.equal(JSON.stringify([...byObligation.values()]).includes("PROVED"), false);
  assert.equal(JSON.stringify([...byObligation.values()]).includes("DISPROVED"), false);
});

test("V2 separates authoritative source scope from unresolved target compatibility", () => {
  const text = "The payments table displays approved information.";
  const ctx = context([text]);
  const candidate = semanticCandidate(
    "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger
  );
  candidate.proposedTargetSurface = "Model-authored neighboring admin page";
  const testCase = browserCase("candidate-1", {
    routeOrigin: "UI_ROUTE_CATALOG",
    routeAuthoritative: false,
    routeStatus: "RESOLVED",
  });
  const result = run({ texts: [text], cases: [testCase], candidates: [candidate] });
  const container = result.plan.browserSemanticPlanningAudit?.executionContainers?.[0];

  assert.deepEqual(container?.target.sourceScope, {
    status: "AUTHORITATIVE",
    surface: text,
    basis: "SOURCE_OBLIGATION",
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.ac.1" }],
  });
  assert.equal(container?.target.candidateSurface, "Model-authored neighboring admin page");
  assert.deepEqual(container?.target.constraint, {
    status: "UNRESOLVED",
    policy: "ALL_REQUIRED",
    basis: "NO_STRONG_SOURCE_ANCHOR_MATCH",
    obligations: [container?.target.constraint.obligations[0]],
  });
  assert.deepEqual(container?.target.constraint.obligations[0]?.sourceUnitRefs, [
    { sourceUnitId: "source-1", sourceRef: "jira.ac.1" },
  ]);
  assert.equal(
    container?.target.constraint.obligations[0]?.sourceAnchors.includes("admin"),
    false
  );
  assert.equal(container?.target.constraint.obligations[0]?.status, "UNRESOLVED");
  assert.equal(container?.persona.status, "CANDIDATE");
  assert.equal(container?.route.status, "CANDIDATE");
  assert.equal(container?.readiness, "TARGET_UNRESOLVED");
});

test("exact strong source anchors establish target compatibility", () => {
  const text = "Compliance Requirements section remains unchanged.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Compliance Requirements section" }
    )],
  });
  const target = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.target;
  assert.equal(target?.sourceScope.status, "AUTHORITATIVE");
  assert.equal(target?.constraint.status, "COMPATIBLE");
  assert.equal(target?.constraint.basis, "SOURCE_ANCHOR_MATCH");
  assert.ok(target?.constraint.obligations[0]?.matchedAnchors.includes(
    "compliance requirements"
  ));
});

test("source-defined surface identity binds without requiring behavior words in the surface label", () => {
  const text = "Add a search bar to the Payments page.";
  const ctx = context([text]);
  const candidate = semanticCandidate(
    "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
    { targetSurface: "Payments" }
  );
  candidate.validatedSourceMemberCoverageClaims = [{ memberId: "surface-payments", provenance: "VALIDATED_MODEL_MEMBER_CLAIM" }];
  const sourceMemberLedger = { version: "V1" as const, sourceStatus: "RESOLVED" as const, memberSets: [{ memberSetId: "set", parentObligationId: "obligation-1", sourceUnitRef: { sourceUnitId: "source-1", sourceRef: "jira.ac.1" }, dimension: "SURFACE" as const, policy: "ALL_REQUIRED" as const, members: [{ memberId: "surface-payments", exactSourceText: "Payments", canonicalMemberText: "payments", kind: "SURFACE" as const, ordinal: 0, required: true as const }] }], obligationAudits: [{ parentObligationId: "obligation-1", status: "DECOMPOSED" as const }] };
  const result = run({
    texts: [text],
    candidates: [candidate], sourceMemberLedger,
  });
  const target = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.target;
  assert.equal(target?.constraint.status, "COMPATIBLE");
  assert.equal(target?.constraint.basis, "SOURCE_ANCHOR_MATCH");
});

test("MODEL_TARGET_MISMATCH_CANNOT_OVERRIDE_UNAMBIGUOUS_SOURCE_TARGET_V1", () => {
  const text = "Add a search bar to the Payments page.";
  const ctx = context([text]);
  for (const targetSurface of ["Search Bar", "Payment Settings"]) {
    const candidate = semanticCandidate("semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger, { targetSurface });
    candidate.validatedSourceMemberCoverageClaims = [{ memberId: "surface-payments", provenance: "VALIDATED_MODEL_MEMBER_CLAIM" }];
    const result = run({
      texts: [text],
      candidates: [candidate],
      sourceMemberLedger: { version: "V1" as const, sourceStatus: "RESOLVED" as const, memberSets: [{ memberSetId: "set", parentObligationId: "obligation-1", sourceUnitRef: { sourceUnitId: "source-1", sourceRef: "jira.ac.1" }, dimension: "SURFACE" as const, policy: "ALL_REQUIRED" as const, members: [{ memberId: "surface-payments", exactSourceText: "Payments", canonicalMemberText: "payments", kind: "SURFACE" as const, ordinal: 0, required: true as const }] }], obligationAudits: [{ parentObligationId: "obligation-1", status: "DECOMPOSED" as const }] },
    });
    const target = result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0]?.target;
    assert.equal(target?.candidateSurface, "payments");
    assert.equal(target?.constraint.status, "COMPATIBLE");
  }
});

test("MODEL_TARGET_ABSENCE_CANNOT_ERASE_UNAMBIGUOUS_SOURCE_TARGET_V1", () => {
  const text = "Add a search bar to the Payments page.";
  const ctx = context([text]);
  const candidate = semanticCandidate(
    "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger
  );
  delete candidate.proposedTargetSurface;
  const result = run({
    texts: [text],
    candidates: [candidate],
    sourceMemberLedger: { version: "V1" as const, sourceStatus: "RESOLVED" as const, memberSets: [{ memberSetId: "set", parentObligationId: "obligation-1", sourceUnitRef: { sourceUnitId: "source-1", sourceRef: "jira.ac.1" }, dimension: "SURFACE" as const, policy: "ALL_REQUIRED" as const, members: [{ memberId: "surface-payments", exactSourceText: "Payments", canonicalMemberText: "payments", kind: "SURFACE" as const, ordinal: 0, required: true as const }] }], obligationAudits: [{ parentObligationId: "obligation-1", status: "DECOMPOSED" as const }] },
  });
  const target = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.target;
  assert.equal(target?.candidateSurface, "payments");
  assert.equal(target?.constraint.status, "COMPATIBLE");
});

test("neighboring surfaces and generic structural tokens fail closed", () => {
  const attacks = [
    {
      source: "Compliance Requirements section remains unchanged.",
      candidate: "Work Setups details page",
    },
    {
      source: "Work Setups section remains unchanged.",
      candidate: "Compliance Requirements section",
    },
    {
      source: "Compliance Requirements section",
      candidate: "Work Setups section",
    },
    {
      source: "Payments table",
      candidate: "Job change requests table",
    },
    {
      source: "Payments details drawer",
      candidate: "Neighboring admin details page",
    },
  ];
  for (const attack of attacks) {
    const ctx = context([attack.source]);
    const result = run({
      texts: [attack.source],
      candidates: [semanticCandidate(
        "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
        { targetSurface: attack.candidate }
      )],
    });
    const container = result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];
    assert.equal(container?.target.sourceScope.status, "AUTHORITATIVE");
    assert.equal(container?.target.constraint.status, "UNRESOLVED");
    assert.equal(container?.readiness, "TARGET_UNRESOLVED");
  }
});

test("bounded multi-token anchors cover profile, publish, and filter targets without persona or route promotion", () => {
  for (const example of [
    {
      source: "Talent scholar profile language fields are displayed.",
      candidate: "Talent profile language section",
    },
    {
      source: "Display Request Publish when the job is draft.",
      candidate: "Draft job Request Publish action area",
    },
    {
      source: "Add a filter for filtering change requests based on types.",
      candidate: "Job change requests table type filter",
    },
  ]) {
    const ctx = context([example.source]);
    const result = run({
      texts: [example.source],
      cases: [browserCase("candidate-1", {
        routeOrigin: "UI_ROUTE_CATALOG",
        routeAuthoritative: false,
        routeStatus: "RESOLVED",
      })],
      candidates: [semanticCandidate(
        "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
        { targetSurface: example.candidate }
      )],
    });
    const container = result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];
    assert.equal(container?.target.constraint.status, "COMPATIBLE");
    assert.equal(container?.persona.status, "CANDIDATE");
    assert.equal(container?.route.status, "CANDIDATE");
    assert.equal(container?.fixture.status, "READY");
    assert.equal(container?.acceptanceActorConstraint.status, "NONE");
    assert.equal(container?.actorCompatibility.status, "NO_CONSTRAINT");
    assert.equal(container?.readiness, "READY");
  }
});

test("no actor constraint advances only through an independently bound session", () => {
  const text = "Payments drawer displays Approved By information.";
  const valid = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  });
  const bound = valid.plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(bound?.acceptanceActorConstraint.status, "NONE");
  assert.equal(bound?.executionNavigationBinding.status, "BOUND");
  assert.equal(bound?.executionSessionBinding.status, "BOUND");
  assert.equal(bound?.actorCompatibility.status, "NO_CONSTRAINT");
  assert.equal(bound?.persona.status, "CANDIDATE");

  const previous = process.env.QA_COMPANY_EMAIL;
  delete process.env.QA_COMPANY_EMAIL;
  try {
    const invalid = run({
      texts: [text],
      cases: [browserCase("candidate-1", {
        routeOrigin: "UI_ROUTE_CATALOG",
        routeAuthoritative: false,
        routeStatus: "RESOLVED",
      })],
    });
    const unresolved = invalid.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];
    assert.equal(unresolved?.acceptanceActorConstraint.status, "NONE");
    assert.equal(unresolved?.executionSessionBinding.status, "UNRESOLVED");
    assert.equal(unresolved?.readiness, "SESSION_UNRESOLVED");
  } finally {
    if (previous) process.env.QA_COMPANY_EMAIL = previous;
  }
});

test("explicit source actor is checked against the independently selected session", () => {
  const matching = run({
    texts: ["Company users can view payment records."],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(matching?.acceptanceActorConstraint.status, "PRESENT");
  assert.equal(matching?.executionSessionBinding.persona, "company_admin");
  assert.equal(matching?.actorCompatibility.status, "SATISFIED");

  const wrong = run({
    texts: ["Company users can view assessment records."],
    cases: [browserCase("candidate-1", {
      route: "/talent/assessments",
      persona: "company_admin",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(wrong?.executionSessionBinding.persona, "talent");
  assert.equal(wrong?.actorCompatibility.status, "UNSATISFIED");
  assert.equal(wrong?.readiness, "ACTOR_CONSTRAINT_UNRESOLVED");
});

test("a source permission remains unresolved even when the broad persona session matches", () => {
  const result = run({
    texts: ["Company admins with job change request permission can view requests."],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  const constraint = container?.acceptanceActorConstraint.obligations[0];
  assert.equal(constraint?.basis, "SOURCE_PERMISSION");
  assert.equal(constraint?.actor, "company_admin");
  assert.equal(container?.executionSessionBinding.status, "BOUND");
  assert.equal(container?.actorCompatibility.status, "UNRESOLVED");
  assert.equal(container?.readiness, "ACTOR_CONSTRAINT_UNRESOLVED");
});

test("one contract actor constraint cannot silently apply to or bless a sibling", () => {
  const texts = [
    "Company admins with review permission can view records.",
    "Records remain visible.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1", "obligation-2"],
      ctx.obligationLedger,
      { targetSurface: "Review permission records remain visible" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.deepEqual(
    container?.acceptanceActorConstraint.obligations.map((item) => [
      item.obligationId, item.status, item.basis,
    ]),
    [
      ["obligation-1", "PRESENT", "SOURCE_PERMISSION"],
      ["obligation-2", "NONE", "NO_SOURCE_CONSTRAINT"],
    ]
  );
  assert.deepEqual(
    container?.actorCompatibility.obligations.map((item) => [
      item.obligationId, item.status,
    ]),
    [
      ["obligation-1", "UNRESOLVED"],
      ["obligation-2", "NO_CONSTRAINT"],
    ]
  );
  assert.equal(container?.actorCompatibility.status, "UNRESOLVED");
  assert.equal(container?.readiness, "ACTOR_CONSTRAINT_UNRESOLVED");
});

test("acceptance route and execution navigation retain independent provenance", () => {
  const sourceRoute = run({ texts: ["Company users can view records."] })
    .plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(sourceRoute?.acceptanceRouteConstraint.status, "PRESENT");
  assert.equal(sourceRoute?.acceptanceRouteConstraint.obligations[0]?.basis, "SOURCE_ROUTE");
  assert.equal(sourceRoute?.executionNavigationBinding.status, "BOUND");

  const repositoryRoute = run({
    texts: ["Records are displayed."],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(repositoryRoute?.acceptanceRouteConstraint.status, "NONE");
  assert.equal(repositoryRoute?.executionNavigationBinding.status, "BOUND");
  assert.equal(repositoryRoute?.executionNavigationBinding.basis, "UI_ROUTE_MANIFEST");

  const plannerLiteral = run({
    texts: ["Records are displayed."],
    cases: [browserCase("candidate-1", {
      route: "/company/planner-only-route",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(plannerLiteral?.acceptanceRouteConstraint.status, "NONE");
  assert.equal(plannerLiteral?.executionNavigationBinding.status, "CANDIDATE");
  assert.equal(plannerLiteral?.executionSessionBinding.status, "CANDIDATE");
  assert.equal(plannerLiteral?.readiness, "NAVIGATION_UNRESOLVED");
});

test("an exact compatible static manifest surface recovers unresolved execution navigation", () => {
  const text = "The Payments table displays invoice records.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", {
    fixtureRequirements: ["A compatible runtime invoice must exist."],
  });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.status, "COMPATIBLE");
  assert.deepEqual(container?.route, {
    status: "AUTHORITATIVE",
    value: "/company/payments",
    basis: "ROUTE_MANIFEST",
    sourceRef: "src/routes/utils/document-title.utils.ts",
  });
  assert.equal(container?.executionNavigationBinding.status, "BOUND");
  assert.equal(container?.executionNavigationBinding.basis, "UI_ROUTE_MANIFEST");
  assert.equal(container?.executionSessionBinding.status, "BOUND");
  assert.equal(container?.acceptanceRouteConstraint.status, "NONE");
  assert.equal(container?.readiness, "FIXTURE_UNAVAILABLE");
});

test("exact semantic target corrects a conflicting non-authoritative candidate route", () => {
  const text = "The Payments table displays invoice records.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      route: "/company/all-timesheets",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.status, "COMPATIBLE");
  assert.deepEqual(container?.route, {
    status: "AUTHORITATIVE",
    value: "/company/payments",
    basis: "ROUTE_MANIFEST",
    sourceRef: "src/routes/utils/document-title.utils.ts",
  });
  assert.equal(container?.executionNavigationBinding.status, "BOUND");
  assert.equal(container?.executionNavigationBinding.route, "/company/payments");
  assert.equal(container?.acceptanceRouteConstraint.status, "NONE");
});

test("matching non-authoritative candidate route is preserved", () => {
  const text = "The Payments table displays invoice records.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      route: "/company/payments",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.deepEqual(container?.route, {
    status: "CANDIDATE",
    value: "/company/payments",
    basis: "PLANNER_CANDIDATE",
  });
  assert.equal(container?.executionNavigationBinding.status, "BOUND");
  assert.equal(container?.executionNavigationBinding.route, "/company/payments");
});

test("authoritative route is never overridden by exact semantic recovery", () => {
  const text = "The Payments table displays invoice records.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      route: "/company/all-timesheets",
      routeOrigin: "JIRA_EXPLICIT_ROUTE",
      routeAuthoritative: true,
      routeStatus: "RESOLVED",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.deepEqual(container?.route, {
    status: "AUTHORITATIVE",
    value: "/company/all-timesheets",
    basis: "SOURCE_ROUTE",
    sourceRef: "jira.ac.1",
  });
});

test("no exact semantic binding preserves the existing candidate route", () => {
  const text = "The Ledger table displays invoice records.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      route: "/company/all-timesheets",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Ledger table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.status, "COMPATIBLE");
  assert.deepEqual(container?.route, {
    status: "CANDIDATE",
    value: "/company/all-timesheets",
    basis: "PLANNER_CANDIDATE",
  });
});

test("ambiguous exact semantic binding fails closed instead of retaining a candidate route", () => {
  const text = "The Payments table and All payments table display invoice records.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      route: "/company/all-timesheets",
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table and All payments table" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.status, "COMPATIBLE");
  assert.deepEqual(container?.route, {
    status: "CONFLICT",
    basis: "UNAVAILABLE",
  });
  assert.equal(container?.executionNavigationBinding.status, "UNRESOLVED");
  assert.equal(container?.readiness, "NAVIGATION_UNRESOLVED");
});

test("source-authoritative read-only unresolved navigation materializes for bounded runtime discovery", () => {
  const text = "Company users can view the Experimental workflow queue.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", {
    persona: "company_admin",
  });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.goal = "Verify the Experimental workflow queue.";
  unresolved.successCriteria = text;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      {
        targetSurface: "Experimental workflow queue",
        persona: "company_admin",
      }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  const materialized = result.plan.discoveryBrowserCases?.find((item) =>
    item.id.startsWith("web-runtime-navigation-discovery-")
  );
  assert.equal(container?.target.sourceScope.status, "AUTHORITATIVE");
  assert.equal(container?.target.constraint.status, "COMPATIBLE");
  assert.equal(container?.mutationClass, "READ_ONLY");
  assert.equal(container?.executionNavigationBinding.status, "UNRESOLVED");
  assert.equal(container?.executionSessionBinding.status, "CANDIDATE");
  assert.equal(
    container?.readiness,
    "NAVIGATION_UNRESOLVED"
  );
  assert.equal(container?.discoveryAdmission?.status, "ELIGIBLE");
  assert.equal(materialized?.startRoute, "UNKNOWN");
  assert.equal(materialized?.goal, unresolved.goal);
  assert.equal(materialized?.successCriteria, unresolved.successCriteria);
  assert.deepEqual(materialized?.executionPolicy, { lane: "DISCOVERY_ONLY" });
  assert.deepEqual(materialized?.acceptanceObligationIds, ["obligation-1"]);
  assert.equal(materialized?.executionIntentAuthority?.caseId, materialized?.id);
  assert.deepEqual(materialized?.executionIntentAuthority?.personaPolicy, {
    kind: "EXACT_PERSONA",
    persona: "company_admin",
    authority: "SOURCE_ACTOR",
  });
  assert.deepEqual(
    materialized?.executionIntentAuthority?.executionObligationIds,
    ["obligation-1"]
  );
  assert.equal(
    materialized?.executionIntentAuthority?.sourceTargetEnvelope.routePolicy.kind,
    "RUNTIME_DISCOVERABLE"
  );
  assert.equal(
    materialized?.executionIntentAuthority?.executionCheckContract?.requiredChecks.length,
    0
  );
  assert.equal(result.plan.browserCases.length, 0);
  assert.equal(result.plan.discoveryBrowserCases?.length, 1);
});

test("source-silent read-only discovery uses configured persona without laundering source authority", () => {
  const text = "Users can view the Experimental workflow queue. The control uses Alpha, Beta, Gamma, and Delta.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", { persona: "company_admin" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.steps = ["Alpha", "Beta", "Gamma", "Delta"].map((text, index) => ({
    action: "assertTextVisible" as const,
    text,
    oracleId: `source-silent-${index}`,
  }));
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      {
        targetSurface: "Experimental workflow queue",
        persona: "company_admin",
      }
    )],
  });
  const materialized = result.plan.discoveryBrowserCases?.find((item) =>
    item.id.startsWith("web-runtime-navigation-discovery-")
  );
  assert.deepEqual(materialized?.executionIntentAuthority?.personaPolicy, {
    kind: "CONFIGURED_EXECUTION_PERSONA",
    persona: "company_admin",
  });
  assert.equal(materialized?.startRoute, "UNKNOWN");
  assert.equal(
    materialized?.executionIntentAuthority?.executionCheckContract?.requiredChecks.length,
    4
  );
});

test("runtime fixture propagates exact direct Task BUTTON_LABEL authority", () => {
  const text =
    "Add a “Download as PDF” button to the top right part of the contract details page.";
  const ctx = context([text], ["TASK"]);
  const unresolved = browserCase("candidate-1", { persona: "talent" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.steps = [{
    action: "assertTextVisible",
    text: "Download as PDF",
    oracleId: "planner-download-as-pdf",
  }];
  const result = run({
    texts: [text],
    roles: ["TASK"],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: text, persona: "talent" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(
    container?.readiness,
    "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
  );

  const materialized = result.plan.browserCases.find((item) =>
    item.id.startsWith("web-runtime-fixture-")
  );
  assert.ok(materialized?.executionIntentAuthority);
  assert.deepEqual(materialized?.acceptanceObligationIds, ["obligation-1"]);
  assert.deepEqual(
    materialized?.executionCheckContract?.requiredChecks.map((check) => ({
      kind: check.kind,
      action: check.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
        ? check.oracle.action
        : undefined,
      expectedText: check.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
        ? check.oracle.expectedText
        : undefined,
    })),
    [{
      kind: "SOURCE_BOUND_ASSERTION_MEMBER",
      action: "assertExactVisibleButton",
      expectedText: "download as pdf",
    }]
  );
});

test("source-authorized runtime fixture observation ignores an extra unsafe candidate click", () => {
  const text =
    "Add a “Download as PDF” button to the top right part of the contract details page.";
  const ctx = context([text], ["TASK"]);

  const unresolved = browserCase(
    "candidate-1",
    { persona: "talent" }
  );
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;

  unresolved.steps = [
    {
      action: "assertTextVisible",
      text: "Download as PDF",
      oracleId: "planner-download-as-pdf",
    },
    {
      action: "clickButton",
      text: "Download as PDF",
    },
    {
      action: "wait",
      ms: 1000,
    },
  ];

  const result = run({
    texts: [text],
    roles: ["TASK"],
    cases: [unresolved],
    candidates: [
      semanticCandidate(
        "semantic",
        "candidate-1",
        ["obligation-1"],
        ctx.obligationLedger,
        {
          targetSurface: text,
          persona: "talent",
        }
      ),
    ],
  });

  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];

  assert.equal(
    container?.mutationClass,
    "READ_ONLY"
  );

  assert.equal(
    container?.readiness,
    "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
  );

  const materialized = result.plan.browserCases.find(
    (item) => item.id.startsWith("web-runtime-fixture-")
  );

  assert.ok(materialized);

  assert.equal(
    (materialized.steps ?? []).some(
      (step) => step.action === "clickButton"
    ),
    false
  );

  assert.deepEqual(
    materialized.executionCheckContract?.requiredChecks.map(
      (check) => ({
        kind: check.kind,
        action:
          check.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
            ? check.oracle.action
            : undefined,
        expectedText:
          check.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
            ? check.oracle.expectedText
            : undefined,
      })
    ),
    [
      {
        kind: "SOURCE_BOUND_ASSERTION_MEMBER",
        action: "assertExactVisibleButton",
        expectedText: "download as pdf",
      },
    ]
  );
});

test("runtime discovery does not promote semantic direct Task prose into exact authority", () => {
  const text =
    "Update the Skills step description to mention that users can add up to 10 skills.";
  const ctx = context([text], ["TASK"]);
  const unresolved = browserCase("candidate-1", { persona: "talent" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.steps = [{
    action: "assertTextVisible",
    text: "Add up to 10 skills to get better job matches. You can edit them later.",
    oracleId: "planner-long-skills-description",
  }];
  const result = run({
    texts: [text],
    roles: ["TASK"],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: text, persona: "talent" }
    )],
  });
  const materialized = result.plan.discoveryBrowserCases?.find((item) =>
    item.id.startsWith("web-runtime-navigation-discovery-")
  );
  assert.ok(materialized);
  assert.deepEqual(materialized?.acceptanceObligationIds, []);
  assert.equal(materialized?.executionIntentAuthority, undefined);
  assert.equal(materialized?.executionCheckContract, undefined);
});

test("runtime-bindable discovery retains independently source-authorized checks without a prebound route", () => {
  const text = "Company users view the Experimental workflow queue. The control uses Alpha, Beta, Gamma, and Delta.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", { persona: "company_admin" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.steps = [
    { action: "assertTextVisible", text: "Alpha", oracleId: "alpha" },
    { action: "assertTextVisible", text: "Beta", oracleId: "beta" },
    { action: "assertTextVisible", text: "Gamma", oracleId: "gamma" },
    { action: "assertTextVisible", text: "Delta", oracleId: "delta" },
  ];
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Experimental workflow queue", persona: "company_admin" }
    )],
  });
  const materialized = result.plan.discoveryBrowserCases?.find((item) =>
    item.id.startsWith("web-runtime-navigation-discovery-")
  );
  assert.ok(materialized?.executionIntentAuthority);
  assert.equal(materialized?.startRoute, "UNKNOWN");
  assert.deepEqual(
    materialized?.executionIntentAuthority?.executionCheckContract?.requiredChecks
      .filter((item): item is Extract<typeof item, { kind: "SOURCE_BOUND_ASSERTION_MEMBER" }> =>
        item.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
      )
      .map((item) => item.oracle.expectedText)
      .sort(),
    ["Alpha", "Beta", "Delta", "Gamma"]
  );
});

test("runtime discovery transports only ACCEPTANCE-role obligations", () => {
  const acceptance =
    "Company users can view the Experimental workflow queue.";
  const task =
    "The UI should show the new workflow fields clearly.";

  const ctx = context(
    [acceptance, task],
    ["ACCEPTANCE", "TASK"]
  );

  const unresolved =
    browserCase("candidate-1", {
      persona: "company_admin",
    });

  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  unresolved.goal =
    "Verify the Experimental workflow queue.";
  unresolved.successCriteria =
    `${acceptance} ${task}`;

  const result = run({
    texts: [acceptance, task],
    roles: ["ACCEPTANCE", "TASK"],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic",
      "candidate-1",
      ["obligation-1", "obligation-2"],
      ctx.obligationLedger,
      {
        targetSurface:
          "Experimental workflow queue",
        persona: "company_admin",
      }
    )],
  });

  const materialized =
    result.plan.discoveryBrowserCases?.find(
      (item) =>
        item.id.startsWith(
          "web-runtime-navigation-discovery-"
        )
    );

  assert.ok(materialized);
  assert.deepEqual(
    materialized?.acceptanceObligationIds,
    ["obligation-1"]
  );

  assert.equal(
    ctx.obligationLedger.obligations
      .find((item) => item.id === "obligation-2")
      ?.sourceRole,
    "TASK"
  );
});

test("runtime navigation discovery admits source-authoritative deferred targets but remains closed for unsafe mutation", () => {
  const cases = [
    {
      name: "source-authoritative deferred target",
      text: "Company users can view the Experimental workflow queue.",
      target: "Model-authored payroll approval calendar",
      mutate: undefined,
      fixture: undefined,
      expectedEligible: true,
    },
    {
      name: "unknown mutation",
      text: "Company users can view the Experimental workflow queue.",
      target: "Experimental workflow queue",
      mutate: [{ action: "clickButton", text: "Save" }] as BrowserTestCase["steps"],
      fixture: undefined,
      expectedEligible: false,
    },
  ];

  for (const example of cases) {
    const ctx = context([example.text]);
    const unresolved = browserCase("candidate-1", { persona: "company_admin" });
    unresolved.startRoute = "UNKNOWN";
    delete unresolved.routeResolution;

    if (example.mutate) unresolved.steps = example.mutate;
    if (example.fixture) unresolved.fixtureRequirements = example.fixture;

    const result = run({
      texts: [example.text],
      cases: [unresolved],
      candidates: [semanticCandidate(
        "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
        { targetSurface: example.target, persona: "company_admin" }
      )],
    });

    const container = result.plan.browserSemanticPlanningAudit
      ?.executionContainers?.[0];

    const materialized = result.plan.discoveryBrowserCases?.find((item) =>
      item.id.startsWith("web-runtime-navigation-discovery-")
    );

    if (example.expectedEligible) {
      // Discovery reach is allowed, but lexical target authority is not promoted.
      assert.equal(container?.target.sourceScope.status, "AUTHORITATIVE");
      assert.equal(container?.target.constraint.status, "UNRESOLVED");
      assert.equal(
        container?.target.constraint.basis,
        "NO_STRONG_SOURCE_ANCHOR_MATCH"
      );
      assert.equal(container?.mutationClass, "READ_ONLY");
      assert.equal(container?.readiness, "TARGET_UNRESOLVED");
      assert.equal(container?.discoveryAdmission?.status, "ELIGIBLE");

      assert.ok(materialized);
      assert.equal(materialized?.startRoute, "UNKNOWN");
      assert.deepEqual(
        materialized?.executionPolicy,
        { lane: "DISCOVERY_ONLY" }
      );
      assert.deepEqual(
        materialized?.deterministicProofBindings,
        []
      );

      // Discovery remains separate from normal proof/verdict execution.
      assert.equal(result.plan.browserCases.length, 0);
      assert.equal(result.plan.discoveryBrowserCases?.length, 1);
    } else {
      assert.notEqual(
        container?.discoveryAdmission?.status,
        "ELIGIBLE",
        example.name
      );
      assert.equal(materialized, undefined, example.name);
    }
  }
});

test("a unique parameterized route capability reaches fixture evaluation without becoming bound", () => {
  const text = "The talent contract details display compliance requirements.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", {
    persona: "talent",
    fixtureRequirements: ["A contract with compliance requirements must exist."],
  });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      {
        targetSurface: "Talent contract details compliance requirements",
        persona: "talent",
      }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.executionNavigationBinding.status, "UNRESOLVED");
  assert.equal(
    container?.runtimeNavigationResolution?.status,
    "RUNTIME_NAVIGATION_RESOLUTION_REQUIRED"
  );
  assert.equal(
    container?.runtimeNavigationResolution?.template,
    "/talent/contracts/:contractId"
  );
  assert.equal(
    container?.runtimeNavigationResolution?.runtimeIdentity,
    "NOT_YET_RESOLVED"
  );
  assert.equal(
    container?.runtimeNavigationResolution?.navigationReadyForExecution,
    false
  );
  assert.equal(container?.executionSessionBinding.status, "BOUND");
  assert.equal(container?.executionSessionBinding.persona, "talent");
  assert.equal(
    container?.executionSessionBinding.personaSource,
    "PARAMETERIZED_RUNTIME_NAVIGATION_CAPABILITY"
  );
  assert.equal(container?.fixture.status, "RUNTIME_FIXTURE_RESOLUTION_REQUIRED");
  assert.equal(container?.runtimeFixtureResolution?.members.length, 1);
  assert.equal(
    container?.runtimeFixtureResolution?.members[0]
      ?.acceptanceFixtureConstraint?.fixtureKind,
    "talent-contract"
  );
  assert.equal(container?.readiness, "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION");
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserCases[0]?.startRoute, "UNKNOWN");
  assert.equal(result.plan.browserCases[0]?.composedRuntimeResolution?.runtimeReadyForInteraction, false);
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
  assert.equal(JSON.stringify(result.plan).includes("PROVED"), false);
});

test("a source-backed document fixture remains runtime-deferred and survives stable replay", () => {
  const text = "Contract details show the required document.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", { persona: "talent" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Talent contract details document", persona: "talent" }
    )],
  });
  const original = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(original?.fixture.status, "RUNTIME_FIXTURE_RESOLUTION_REQUIRED");
  assert.equal(original?.readiness, "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION");
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserCases[0]?.startRoute, "UNKNOWN");
  assert.equal(result.plan.browserCases[0]?.composedRuntimeResolution?.runtimeReadyForInteraction, false);

  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const capabilityId = reloaded.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.runtimeNavigationResolution?.capabilityId;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.equal(
    reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeNavigationResolution?.capabilityId,
    capabilityId
  );
  assert.equal(reloaded.browserCases.length, 1);
});

test("source-backed owned contract semantics create a closed compatible fixture capability", () => {
  const text = "The talent can access the contract details surface.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", { persona: "talent" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Talent contract details", persona: "talent" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  const fixture = container?.runtimeFixtureResolution;
  const member = fixture?.members[0];
  const constraint = member?.acceptanceFixtureConstraint;
  const capability = member?.fixtureResolutionCapability;
  assert.equal(fixture?.status, "RUNTIME_FIXTURE_RESOLUTION_REQUIRED");
  assert.equal(fixture?.fixtureReadyForInteraction, false);
  assert.equal(constraint?.fixtureKind, "talent-contract");
  assert.equal(
    constraint?.fixtureKind === "talent-contract"
      ? constraint.identityPolicy
      : undefined,
    "compatible-state"
  );
  assert.deepEqual(
    constraint?.fixtureKind === "talent-contract"
      ? constraint.semantic.predicates.map((item) => item.key)
      : [],
    ["contract.accessibleToOwner"]
  );
  assert.equal(capability?.fixtureKind, "talent-contract");
  assert.equal(member?.runtimeFixtureBinding, "NOT_YET_RESOLVED");
  assert.equal(JSON.stringify(fixture).includes("fixtureIdentityRef"), false);
  assert.equal(container?.readiness, "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION");
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserCases[0]?.startRoute, "UNKNOWN");
  assert.equal(result.plan.browserCases[0]?.composedRuntimeResolution?.runtimeReadyForInteraction, false);

  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const fixtureContractId = fixture?.fixtureContractId;
  const constraintId = constraint?.fixtureKind === "talent-contract"
    ? constraint.constraintId
    : undefined;
  const capabilityId = capability?.fixtureKind === "talent-contract"
    ? capability.capabilityId
    : undefined;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  const replayed = reloaded.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.runtimeFixtureResolution;
  assert.equal(replayed?.fixtureContractId, fixtureContractId);
  const replayedConstraint =
    replayed?.members[0]?.acceptanceFixtureConstraint;
  assert.equal(
    replayedConstraint?.fixtureKind === "talent-contract"
      ? replayedConstraint.constraintId
      : undefined,
    constraintId
  );
  const replayedCapability = replayed?.members[0]?.fixtureResolutionCapability;
  assert.equal(
    replayedCapability?.fixtureKind === "talent-contract"
      ? replayedCapability.capabilityId
      : undefined,
    capabilityId
  );
  assert.equal(replayed?.members[0]?.runtimeFixtureBinding, "NOT_YET_RESOLVED");
  assert.equal(reloaded.browserCases.length, 1);
});

test("composed materialization still requires target, session, and safe action semantics", () => {
  const text = "The talent can access the contract details surface.";
  const ctx = context([text]);
  const make = (surface: string, persona: "talent" | "company_admin", steps: BrowserTestCase["steps"] = []) => {
    const source = browserCase("candidate-1", { persona, steps });
    source.startRoute = "UNKNOWN";
    delete source.routeResolution;
    return run({ texts: [text], cases: [source], candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: surface, persona }
    )] }).plan;
  };
  const wrongTarget = make("Company payment invoices", "talent");
  assert.equal(wrongTarget.browserCases.length, 0);
  assert.equal(wrongTarget.browserSemanticPlanningAudit?.executionContainers?.[0]?.composedRuntimeResolution, undefined);
  const wrongActor = make("Talent contract details", "company_admin");
  assert.equal(
    wrongActor.browserSemanticPlanningAudit?.executionContainers?.[0]?.persona.value,
    "talent"
  );
  assert.equal(wrongActor.browserCases.length, 1);
  const email = process.env.QA_TALENT_EMAIL;
  try {
    delete process.env.QA_TALENT_EMAIL;
    const noSession = make("Talent contract details", "talent");
    assert.equal(noSession.browserCases.length, 0);
    assert.equal(noSession.browserSemanticPlanningAudit?.executionContainers?.[0]?.composedRuntimeResolution, undefined);
  } finally {
    if (email !== undefined) process.env.QA_TALENT_EMAIL = email;
  }
  const mutation = make("Talent contract details", "talent", [{ action: "clickButton", text: "Delete" }]);
  assert.equal(mutation.browserCases.length, 0);
});

test("only an explicit authoritative contract ID creates exact fixture identity", () => {
  const exactText = "The talent can access contract ID: source-contract-9 details.";
  const exactCtx = context([exactText]);
  const exactCase = browserCase("candidate-1", { persona: "talent" });
  exactCase.startRoute = "UNKNOWN";
  delete exactCase.routeResolution;
  const exact = run({
    texts: [exactText],
    cases: [exactCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], exactCtx.obligationLedger,
      { targetSurface: "Talent contract details", persona: "talent" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0]
    ?.runtimeFixtureResolution?.members[0]?.acceptanceFixtureConstraint;
  assert.equal(exact?.fixtureKind, "talent-contract");
  if (exact?.fixtureKind === "talent-contract") {
    assert.equal(exact.identityPolicy, "exact");
    assert.equal(exact.exactEntityId, "source-contract-9");
  }

  const compatibleText = "The talent can access the contract details surface.";
  const compatibleCtx = context([compatibleText]);
  const historical = browserCase("candidate-1", {
    persona: "talent",
    fixtureAuthority: {
      authority: "EXPLICIT_SOURCE_IDENTITY",
      entityKind: "contract",
      entityId: "historical-contract-387",
      sourceRef: "jira.explicitFixtureIdentity",
      reason: "historical planner metadata is not source authority for this obligation",
    },
  });
  historical.startRoute = "UNKNOWN";
  delete historical.routeResolution;
  const compatible = run({
    texts: [compatibleText],
    cases: [historical],
    candidates: [semanticCandidate(
      "semantic-contract-386", "candidate-1", ["obligation-1"],
      compatibleCtx.obligationLedger,
      { targetSurface: "Talent contract 386 details", persona: "talent" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0]
    ?.runtimeFixtureResolution?.members[0]?.acceptanceFixtureConstraint;
  assert.equal(compatible?.fixtureKind, "talent-contract");
  if (compatible?.fixtureKind === "talent-contract") {
    assert.equal(compatible.identityPolicy, "compatible-state");
    assert.equal(compatible.exactEntityId, undefined);
  }
});

test("compound authoritative talent-contract predicates remain obligation-scoped and stable", () => {
  const text = "The signed compliance document and signed Master Service Agreement include signature data, the BACKGROUND_CHECK has status and issue date, the WORK_AUTHORIZATION snapshot exists, and Trolley and Deel setup statuses are present on the contract.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1", { persona: "talent" });
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Talent contract details compliance", persona: "talent" }
    )],
  });
  const fixture = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.runtimeFixtureResolution;
  const constraint = fixture?.members[0]?.acceptanceFixtureConstraint;
  assert.equal(constraint?.fixtureKind, "talent-contract");
  const keys = constraint?.fixtureKind === "talent-contract"
    ? constraint.semantic.predicates.map((item) => item.key)
    : [];
  assert.ok(keys.includes("compliance.MASTER_SERVICE_AGREEMENT.signed"));
  assert.ok(keys.includes("compliance.BACKGROUND_CHECK.statusPresent"));
  assert.ok(keys.includes("compliance.BACKGROUND_CHECK.issueDatePresent"));
  assert.ok(keys.includes("contract.workAuthorizationSnapshotPresent"));
  assert.ok(keys.includes("compliance.TROLLEY_ONBOARDING_SETUP.present"));
  assert.ok(keys.includes("compliance.TROLLEY_ONBOARDING_SETUP.statusPresent"));
  assert.ok(keys.includes("compliance.DEEL_ONBOARDING_SETUP.present"));
  assert.ok(keys.includes("compliance.DEEL_ONBOARDING_SETUP.statusPresent"));
  if (constraint?.fixtureKind === "talent-contract") {
    assert.ok(constraint.semantic.predicates.every((predicate) =>
      predicate.authority === "SOURCE_AUTHORIZED" &&
      predicate.obligationIds.join() === "obligation-1" &&
      predicate.sourceUnitRefs[0]?.sourceRef === "jira.ac.1"
    ));
  }
  const serialized = JSON.stringify(fixture);
  const reloaded = JSON.parse(serialized);
  assert.equal(JSON.stringify(reloaded), serialized);
  assert.equal(result.plan.browserCases.length, 1);
  assert.equal(result.plan.browserCases[0]?.startRoute, "UNKNOWN");
  assert.equal(result.plan.browserCases[0]?.composedRuntimeResolution?.runtimeReadyForInteraction, false);
  assert.equal(JSON.stringify(result.plan).includes("PROVED"), false);
  assert.equal(JSON.stringify(result.plan).includes('"verdict":"PASS"'), false);
});

test("unsupported baseline, candidate-only contract prose, and actor conflict create no fixture capability", () => {
  const baselineText = "The talent contract compliance requirements remain unchanged from the baseline.";
  const baselineCtx = context([baselineText]);
  const baselineCase = browserCase("candidate-1", { persona: "talent" });
  baselineCase.startRoute = "UNKNOWN";
  delete baselineCase.routeResolution;
  const baseline = run({
    texts: [baselineText],
    cases: [baselineCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], baselineCtx.obligationLedger,
      { targetSurface: "Talent contract details compliance", persona: "talent" }
    )],
  });
  assert.equal(
    baseline.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeFixtureResolution,
    undefined
  );

  const genericText = "The talent can view the expected details.";
  const genericCtx = context([genericText]);
  const genericCase = browserCase("candidate-1", { persona: "talent" });
  genericCase.startRoute = "UNKNOWN";
  delete genericCase.routeResolution;
  const candidateOnly = run({
    texts: [genericText],
    cases: [genericCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], genericCtx.obligationLedger,
      { targetSurface: "Talent contract details", persona: "talent" }
    )],
  });
  assert.equal(
    candidateOnly.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeFixtureResolution,
    undefined
  );

  const conflictText = "Company users can access the talent contract details.";
  const conflictCtx = context([conflictText]);
  const conflictCase = browserCase("candidate-1", { persona: "talent" });
  conflictCase.startRoute = "UNKNOWN";
  delete conflictCase.routeResolution;
  const conflict = run({
    texts: [conflictText],
    cases: [conflictCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], conflictCtx.obligationLedger,
      { targetSurface: "Talent contract details", persona: "talent" }
    )],
  });
  assert.equal(
    conflict.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeFixtureResolution,
    undefined
  );

  const unsupportedText = "The talent must use a terminated contract.";
  const unsupportedCtx = context([unsupportedText]);
  const unsupportedCase = browserCase("candidate-1", { persona: "talent" });
  unsupportedCase.startRoute = "UNKNOWN";
  delete unsupportedCase.routeResolution;
  const unsupported = run({
    texts: [unsupportedText],
    cases: [unsupportedCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], unsupportedCtx.obligationLedger,
      { targetSurface: "Talent contract details", persona: "talent" }
    )],
  });
  assert.equal(
    unsupported.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.runtimeFixtureResolution,
    undefined
  );
});

test("parameterized navigation fails closed on persona conflict and static binding wins", () => {
  const companyText = "Company users can view the contract details.";
  const companyCtx = context([companyText]);
  const companyCase = browserCase("candidate-1");
  companyCase.startRoute = "UNKNOWN";
  delete companyCase.routeResolution;
  const conflict = run({
    texts: [companyText],
    cases: [companyCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], companyCtx.obligationLedger,
      { targetSurface: "Company contract details", persona: "company_admin" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(conflict?.runtimeNavigationResolution, undefined);
  assert.equal(
    conflict?.readiness,
    "NAVIGATION_UNRESOLVED"
  );

  const talentText = "The talent contracts dashboard displays contract records.";
  const talentCtx = context([talentText]);
  const staticCase = browserCase("candidate-1", {
    persona: "talent",
    route: "/talent/dashboard?tab=contracts",
    routeOrigin: "UI_ROUTE_CATALOG",
    routeAuthoritative: false,
    routeStatus: "VALIDATED",
  });
  const bound = run({
    texts: [talentText],
    cases: [staticCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], talentCtx.obligationLedger,
      { targetSurface: "Talent contracts dashboard", persona: "talent" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(bound?.executionNavigationBinding.status, "BOUND");
  assert.equal(bound?.runtimeNavigationResolution, undefined);

  const sourceBoundCase = browserCase("candidate-1", {
    persona: "talent",
    route: "/talent/dashboard?tab=contracts",
  });
  const sourceBound = run({
    texts: [talentText],
    cases: [sourceBoundCase],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], talentCtx.obligationLedger,
      { targetSurface: "Talent contracts dashboard", persona: "talent" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(sourceBound?.executionNavigationBinding.status, "BOUND");
  assert.equal(sourceBound?.runtimeNavigationResolution, undefined);
});

test("static navigation recovery is serialized, idempotent, and does not promote weak surfaces", () => {
  const text = "The Payments table displays invoice records.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1");
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const result = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Company Payments table" }
    )],
  });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.equal(
    reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.executionNavigationBinding.status,
    "BOUND"
  );

  const weak = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic-weak", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Payments" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.notEqual(weak?.target.constraint.status, "COMPATIBLE");
  assert.equal(weak?.executionNavigationBinding.status, "UNRESOLVED");
});

test("static navigation recovery preserves the source actor despite a planner persona mismatch", () => {
  const text = "Talents can view the Payments table.";
  const ctx = context([text]);
  const unresolved = browserCase("candidate-1");
  unresolved.startRoute = "UNKNOWN";
  delete unresolved.routeResolution;
  const container = run({
    texts: [text],
    cases: [unresolved],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Payments table" }
    )],
  }).plan.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(container?.persona.status, "AUTHORITATIVE");
  assert.equal(container?.persona.value, "talent");
  assert.equal(container?.persona.basis, "SOURCE_ACTOR");
  assert.equal(container?.executionNavigationBinding.status, "BOUND");
  assert.equal(container?.executionSessionBinding.persona, "talent");
});

test("target compatibility remains a prerequisite for navigation and session binding", () => {
  const text = "Compliance Requirements section remains unchanged.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Work Setups details page" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.status, "UNRESOLVED");
  assert.equal(container?.executionNavigationBinding.status, "UNRESOLVED");
  assert.equal(container?.runtimeNavigationResolution, undefined);
  assert.equal(container?.executionSessionBinding.status, "CANDIDATE");
  assert.equal(container?.readiness, "TARGET_UNRESOLVED");
});

test("ALL_REQUIRED target compatibility keeps each evidence contract isolated", () => {
  const texts = [
    "Compliance Requirements section remains unchanged.",
    "Work Setups cards remain unchanged.",
  ];
  const ctx = context(texts);
  const result = run({
    texts,
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1", "obligation-2"],
      ctx.obligationLedger,
      { targetSurface: "Compliance Requirements section" }
    )],
  });
  const container = result.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0];
  assert.equal(container?.target.constraint.policy, "ALL_REQUIRED");
  assert.equal(container?.target.constraint.status, "UNRESOLVED");
  assert.deepEqual(
    container?.target.constraint.obligations.map((item) => [
      item.obligationId, item.status,
    ]),
    [
      ["obligation-1", "COMPATIBLE"],
      ["obligation-2", "UNRESOLVED"],
    ]
  );
  assert.deepEqual(
    result.plan.browserSemanticPlanningAudit?.evidenceContracts?.map((item) => [
      item.obligationId, item.targetConstraint?.status,
    ]).sort(),
    [
      ["obligation-1", "COMPATIBLE"],
      ["obligation-2", "UNRESOLVED"],
    ]
  );
  assert.equal(container?.readiness, "TARGET_UNRESOLVED");
});

test("target compatibility is independent of candidate order", () => {
  const text = "Compliance Requirements section remains unchanged.";
  const ctx = context([text]);
  const candidates = [
    semanticCandidate(
      "semantic-compatible", "candidate-1", ["obligation-1"],
      ctx.obligationLedger,
      { targetSurface: "Compliance Requirements section" }
    ),
    semanticCandidate(
      "semantic-unresolved", "candidate-2", ["obligation-1"],
      ctx.obligationLedger,
      { targetSurface: "Work Setups details page" }
    ),
  ];
  const cases = [browserCase("candidate-1"), browserCase("candidate-2")];
  const statuses = (orderedCandidates: typeof candidates) => run({
    texts: [text],
    cases,
    candidates: orderedCandidates,
  }).plan.browserSemanticPlanningAudit?.executionContainers?.map((item) => [
    item.semanticCandidateId,
    item.target.constraint.status,
  ]).sort();

  assert.deepEqual(statuses(candidates), statuses([...candidates].reverse()));
  assert.deepEqual(statuses(candidates), [
    ["semantic-compatible", "COMPATIBLE"],
    ["semantic-unresolved", "UNRESOLVED"],
  ]);
});

test("target constraint serialization preserves IDs and replay is idempotent", () => {
  const text = "Compliance Requirements section remains unchanged.";
  const ctx = context([text]);
  const result = run({
    texts: [text],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"], ctx.obligationLedger,
      { targetSurface: "Compliance Requirements section" }
    )],
  });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const ids = {
    evidence: reloaded.browserSemanticPlanningAudit?.evidenceContracts
      ?.map((item) => item.evidenceContractId),
    containers: reloaded.browserSemanticPlanningAudit?.executionContainers
      ?.map((item) => item.executionContainerId),
  };
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.deepEqual({
    evidence: reloaded.browserSemanticPlanningAudit?.evidenceContracts
      ?.map((item) => item.evidenceContractId),
    containers: reloaded.browserSemanticPlanningAudit?.executionContainers
      ?.map((item) => item.executionContainerId),
  }, ids);
  assert.equal(
    reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.target.constraint.status,
    "COMPATIBLE"
  );
});

test("surface nouns and route prefixes never become persona authority", () => {
  for (const text of [
    "Talent profile is visible.",
    "Company profile is visible.",
    "Admin page is visible.",
  ]) {
    const result = run({
      texts: [text],
      cases: [browserCase("candidate-1", { route: "/company/foo" })],
    });
    const container = result.plan.browserSemanticPlanningAudit?.executionContainers?.[0];
    assert.equal(container?.target.sourceScope.status, "AUTHORITATIVE");
    assert.equal(container?.route.status, "AUTHORITATIVE");
    assert.equal(container?.persona.status, "CANDIDATE");
    assert.equal(container?.persona.basis, "PLANNER_CANDIDATE");
    assert.equal(container?.acceptanceActorConstraint.status, "NONE");
  }
});

test("explicit source actor transports with provenance and conflicts fail closed", () => {
  const authoritative = run({ texts: ["Company users can view records."] });
  const persona = authoritative.plan.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.persona;
  assert.deepEqual(persona, {
    status: "AUTHORITATIVE",
    value: "company_admin",
    basis: "SOURCE_ACTOR",
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.ac.1" }],
  });

  const mismatchContext = context(["Company users can view records."]);
  const mismatch = run({
    texts: ["Company users can view records."],
    cases: [browserCase("candidate-1")],
    candidates: [semanticCandidate(
      "semantic", "candidate-1", ["obligation-1"],
      mismatchContext.obligationLedger, { persona: "talent" }
    )],
  });
  assert.equal(
    mismatch.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.persona.value,
    "company_admin"
  );

  const ambiguous = run({ texts: [
    "Company users can view records.",
    "Talents can edit records.",
  ] });
  assert.equal(
    ambiguous.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.persona.status,
    "CONFLICT"
  );
});

test("source-backed route transports but weak, candidate, and conflicting routes do not", () => {
  const text = "Company users can view records.";
  const sourceRoute = run({ texts: [text] });
  assert.deepEqual(
    sourceRoute.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.route,
    {
      status: "AUTHORITATIVE",
      value: "/company/all-jobs",
      basis: "SOURCE_ROUTE",
      sourceRef: "jira.ac.1",
    }
  );

  const weak = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      routeOrigin: "UI_ROUTE_CATALOG",
      routeAuthoritative: false,
      routeStatus: "RESOLVED",
    })],
  });
  assert.equal(
    weak.plan.browserSemanticPlanningAudit?.executionContainers?.[0]?.route.status,
    "CANDIDATE"
  );

  const conflict = run({
    texts: [text],
    cases: [browserCase("candidate-1", {
      routeSourceRef: "jira.unrelated",
    })],
  });
  assert.equal(
    conflict.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.route.status,
    "CONFLICT"
  );
  assert.equal(
    conflict.plan.browserSemanticPlanningAudit?.executionContainers?.[0]
      ?.readiness,
    "NAVIGATION_UNRESOLVED"
  );
});

test("summary-only authority and model fields remain non-authoritative on replay", () => {
  const result = run({ texts: ["Company users can view records."] });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  reloaded.acceptanceSourceLedger!.sourceUnits[0]!.sourceKind = "SUMMARY";
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const container = reloaded.browserSemanticPlanningAudit?.executionContainers?.[0];
  assert.equal(container?.target.sourceScope.status, "UNRESOLVED");
  assert.equal(container?.target.constraint.status, "UNRESOLVED");
  assert.equal(container?.persona.status, "CANDIDATE");
  assert.equal(container?.route.status, "CONFLICT");
  assert.equal(container?.readiness, "TARGET_UNRESOLVED");
});

test("replay never substitutes authoritative source text for a missing candidate surface", () => {
  const result = run({ texts: ["Compliance Requirements section remains unchanged."] });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  delete reloaded.browserSemanticIr?.candidates[0]?.proposedTargetSurface;
  delete reloaded.browserSemanticPlanningAudit?.executionContainers?.[0]
    ?.target.candidateSurface;

  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const target = reloaded.browserSemanticPlanningAudit
    ?.executionContainers?.[0]?.target;
  assert.equal(target?.sourceScope.status, "AUTHORITATIVE");
  assert.equal(target?.candidateSurface, undefined);
  assert.equal(target?.constraint.status, "UNRESOLVED");
  assert.equal(target?.constraint.basis, "CANDIDATE_SURFACE_UNAVAILABLE");
});

test("authority replay is stable, idempotent, and verdict-neutral", () => {
  const result = run({ texts: ["Company users can view records."] });
  const reloaded = JSON.parse(JSON.stringify(result.plan)) as TestPlan;
  const idsBefore = {
    evidence: reloaded.browserSemanticPlanningAudit?.evidenceContracts
      ?.map((item) => item.evidenceContractId),
    containers: reloaded.browserSemanticPlanningAudit?.executionContainers
      ?.map((item) => item.executionContainerId),
  };
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  const once = JSON.stringify(reloaded);
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), once);
  assert.deepEqual({
    evidence: reloaded.browserSemanticPlanningAudit?.evidenceContracts
      ?.map((item) => item.evidenceContractId),
    containers: reloaded.browserSemanticPlanningAudit?.executionContainers
      ?.map((item) => item.executionContainerId),
  }, idsBefore);
  assert.equal(JSON.stringify(reloaded).includes('"verdict":"PASS"'), false);
  assert.equal(JSON.stringify(reloaded).includes("PROVED"), false);
});

test("V2 evidence planning survives serialization and normalization is idempotent", () => {
  const result = run({ texts: ["Behavior."] });
  const serialized = JSON.stringify(result.plan);
  const reloaded = JSON.parse(serialized) as TestPlan;
  assert.equal(reloaded.browserSemanticPlanningAudit?.version, "V2");
  assert.deepEqual(
    reloaded.browserSemanticPlanningAudit?.evidenceContracts,
    result.plan.browserSemanticPlanningAudit?.evidenceContracts
  );
  applyPlannerBrowserSemanticAllocation({
    plan: reloaded,
    semanticIr: result.semanticIr,
    verdictGrouping: result.grouping,
    obligationLedger: result.obligationLedger,
  });
  assert.equal(JSON.stringify(reloaded), serialized);
});
