import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  bindPlannerBrowserProofCapability,
} from "./planner-browser-proof-binding.js";
import {
  transportPlannerBrowserExecutionAuthority,
} from "./planner-browser-semantic-allocation.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerExecutionSurfacePrerequisiteContract,
  TestPlan,
} from "./types.js";

function synthetic(overrides: {
  obligationText?: string;
  sourceLabel?: string;
  assertionText?: string;
  oracleId?: string;
} = {}) {
  const obligation: PlannerAcceptanceObligation = {
    id: "obligation-1",
    sourceUnitIds: ["source-surface"],
    sourceRole: "TASK",
    derivation: "DIRECT_TASK_SECTION",
    text: overrides.obligationText ??
      "Open the item details drawer and display Owner Name.",
  };
  const testCase: BrowserTestCase = {
    id: "case-1",
    persona: "company_admin",
    goal: "candidate",
    startRoute: "/company/items",
    successCriteria: "candidate",
    steps: [{
      action: "assertTextVisible",
      text: overrides.assertionText ?? "Owner Name",
      ...(overrides.oracleId === "" ? {} : {
        oracleId: overrides.oracleId ?? "oracle-1",
      }),
    }],
  };
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "synthetic",
    apiCases: [],
    browserCases: [testCase],
    acceptanceSourceLedger: {
      sourceStatus: "RESOLVED",
      basis: "SUMMARY_DESCRIPTION_FALLBACK",
      sourceUnits: [
        {
          id: "source-surface",
          sourceKind: "DESCRIPTION",
          sourceRef: "jira.description",
          sectionHeading: "Task",
          text: obligation.text,
        },
        {
          id: "source-label",
          sourceKind: "DESCRIPTION",
          sourceRef: "jira.description",
          sectionHeading: "Task",
          text: overrides.sourceLabel ?? "Owner Name",
        },
      ],
    },
  };
  return { plan, obligation, testCase };
}

function searchInputContract(
  overrides: Partial<PlannerExecutionSurfacePrerequisiteContract> = {}
): PlannerExecutionSurfacePrerequisiteContract {
  return {
    schemaVersion: 1,
    prerequisiteId: "search-prerequisite-1",
    status: "SURFACE_RUNTIME_RESOLUTION_REQUIRED",
    kind: "SEARCH_INPUT",
    authority: "SOURCE_AUTHORIZED",
    sourceUnitRefs: [{ sourceUnitId: "source-surface", sourceRef: "jira.description" }],
    surfacePartition: {
      partitionId: "surface-partition-1", verdictGroupId: "group-1",
      obligationId: "obligation-1", memberId: "all-payments", surface: "all payments",
    },
    executionContext: {
      executionContainerId: "container-1", semanticCandidateId: "candidate-1",
      executionCaseId: "case-1", route: "/company/all-payments", persona: "company_admin",
    },
    acceptanceCoverage: {
      policy: "ALL_REQUIRED", requiredMemberIds: ["all-payments", "payments"],
      plannedMemberIds: ["all-payments"], memberId: "all-payments",
    },
    selectionPolicy: "UNIQUE_GROUNDED_CONTROL_ONLY",
    ambiguityPolicy: "BLOCK_SURFACE_UNAVAILABLE",
    runtimeBinding: "NOT_YET_RESOLVED",
    surfaceReadyForInteraction: false,
    ...overrides,
  };
}

test("MODEL_STEP_ABSENCE_CANNOT_ERASE_SOURCE_SUPPORTED_EXPANDED_SURFACE_PROOF_V1", () => {
  const { plan, obligation, testCase } = synthetic();
  testCase.steps = [];
  const result = bindPlannerBrowserProofCapability({
    plan,
    obligation,
    evidenceContractId: "contract-1",
    executionCases: [testCase],
    targetCompatible: true,
    baseCapability: {
      obligationId: obligation.id,
      state: "UNKNOWN",
      requirementIds: [],
      reason: "none",
    },
  });
  assert.equal(result.state, "SUPPORTED_AND_BOUND");
  assert.equal(result.bindings?.length, 1);
  const item = result.bindings?.[0];
  assert.equal(item?.capabilityKind, "VISIBLE_TEXT_IN_EXPANDED_SURFACE");
  if (!item || item.capabilityKind !== "VISIBLE_TEXT_IN_EXPANDED_SURFACE") {
    throw new Error("expected text proof binding");
  }
  assert.deepEqual(item.assertion, {
    action: "assertTextVisible",
    oracleId: item.assertion.oracleId,
    expectedText: "Owner Name",
    sourceUnitId: "source-label",
    sourceRef: "jira.description",
  });
  assert.ok(item.assertion.oracleId.startsWith("source-expanded-label-"));
});

test("source-expanded proof remains fail closed for wrong source labels or unsupported surface semantics", () => {
  for (const fixture of [
    synthetic({ assertionText: "Reviewer Name", sourceLabel: "Reviewer Name" }),
    synthetic({ obligationText: "Navigate to the item page.", sourceLabel: "Owner Name" }),
    synthetic({ sourceLabel: "Different Label" }),
  ]) {
    const result = bindPlannerBrowserProofCapability({
      plan: fixture.plan,
      obligation: fixture.obligation,
      evidenceContractId: "contract-1",
      executionCases: [fixture.testCase],
      targetCompatible: true,
      baseCapability: {
        obligationId: fixture.obligation.id,
        state: "UNKNOWN",
        requirementIds: [],
        reason: "none",
      },
    });
    assert.notEqual(result.state, "SUPPORTED_AND_BOUND");
    assert.equal(result.bindings, undefined);
  }
});

test("preserves stronger existing typed proof capability instead of reconstructing it", () => {
  const { plan, obligation, testCase } = synthetic();
  const result = bindPlannerBrowserProofCapability({
    plan,
    obligation,
    evidenceContractId: "contract-1",
    executionCases: [testCase],
    targetCompatible: true,
    baseCapability: {
      obligationId: obligation.id,
      state: "SUPPORTED_AND_BOUND",
      requirementIds: ["typed-requirement"],
      reason: "existing typed proof",
    },
  });
  assert.deepEqual(result.requirementIds, ["typed-requirement"]);
  assert.equal(result.bindings, undefined);
});

test("source-backed proof semantics remain unbound when target compatibility is unresolved", () => {
  const { plan, obligation, testCase } = synthetic();
  const result = bindPlannerBrowserProofCapability({
    plan,
    obligation,
    evidenceContractId: "contract-1",
    executionCases: [testCase],
    targetCompatible: false,
    baseCapability: {
      obligationId: obligation.id,
      state: "UNKNOWN",
      requirementIds: [],
      reason: "none",
    },
  });
  assert.equal(result.state, "SUPPORTED_BUT_UNBOUND");
  assert.equal(result.bindings, undefined);
});

test("binds a generic source-authorized SEARCH_INPUT presence contract without a product assertion", () => {
  const { plan, obligation } = synthetic({
    obligationText: "Add a search bar to the available records page.",
  });
  const result = bindPlannerBrowserProofCapability({
    plan, obligation, evidenceContractId: "contract-1", executionCases: [],
    executionSurfacePrerequisites: [searchInputContract()], targetCompatible: true,
    baseCapability: {
      obligationId: obligation.id, state: "UNKNOWN", requirementIds: [], reason: "none",
    },
  });
  assert.equal(result.state, "SUPPORTED_AND_BOUND");
  const item = result.bindings?.[0];
  assert.equal(item?.capabilityKind, "SEARCH_INPUT_PRESENT");
  if (!item || item.capabilityKind !== "SEARCH_INPUT_PRESENT") {
    throw new Error("expected search-input proof binding");
  }
  assert.equal(item.prerequisite.kind, "SEARCH_INPUT");
  assert.equal(item.acceptanceCoverage.memberId, "all-payments");
  assert.equal("assertion" in item, false);
});

test("does not materialize search-input proof without an exact source-authorized contract", () => {
  const { plan, obligation } = synthetic({
    obligationText: "Add a search bar to the available records page.",
  });
  for (const contract of [
    { ...searchInputContract(), authority: "SOURCE_AUTHORIZED" as const,
      sourceUnitRefs: [] },
    { ...searchInputContract(), selectionPolicy: "GROUNDED_CONTROL_SURFACE_PRESENT" as const },
  ]) {
    const result = bindPlannerBrowserProofCapability({
      plan, obligation, evidenceContractId: "contract-1", executionCases: [],
      executionSurfacePrerequisites: [contract], targetCompatible: true,
      baseCapability: {
        obligationId: obligation.id, state: "UNKNOWN", requirementIds: [], reason: "none",
      },
    });
    assert.notEqual(result.state, "SUPPORTED_AND_BOUND");
    assert.equal(result.bindings, undefined);
  }
});

test("archived AS-1014 replay binds four atomic contracts and preserves stable identities through serialization", () => {
  const artifact = JSON.parse(fs.readFileSync(
    "qa-results/runs/browser-planner-overhaul-canary-20260902-191206/AS-1014/test-plan.json",
    "utf8"
  )) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: artifact,
    obligationLedger: artifact.acceptanceObligationLedger!,
  });
  const contracts = artifact.browserSemanticPlanningAudit?.evidenceContracts ?? [];
  const bindings = contracts.flatMap(
    (item) => item.proofCapability.bindings ?? []
  );
  assert.equal(contracts.length, 4);
  assert.equal(bindings.length, 4);
  assert.equal(contracts.every(
    (item) => item.proofCapability.state === "SUPPORTED_AND_BOUND"
  ), true);
  assert.equal(artifact.browserCases.length, 4);
  assert.equal(artifact.browserCases.every(
    (item) => item.deterministicProofBindings?.length === 1
  ), true);
  assert.deepEqual(
    [...new Set(bindings.flatMap(
      (item) => item.acceptanceCoverage.requiredMemberIds
    ))].sort(),
    ["processed", "sent-for-processing"]
  );
  assert.deepEqual(
    [...new Set(bindings.flatMap((item) =>
      item.capabilityKind === "VISIBLE_TEXT_IN_EXPANDED_SURFACE"
        ? [item.assertion.expectedText]
        : []
    ))],
    ["Invoice Approved By"]
  );
  const beforeIds = bindings.map((item) => item.bindingId).sort();
  const reloaded = JSON.parse(JSON.stringify(artifact)) as TestPlan;
  transportPlannerBrowserExecutionAuthority({
    plan: reloaded,
    obligationLedger: reloaded.acceptanceObligationLedger!,
  });
  const afterBindings = reloaded.browserSemanticPlanningAudit
    ?.evidenceContracts?.flatMap(
      (item) => item.proofCapability.bindings ?? []
    ) ?? [];
  assert.deepEqual(
    afterBindings.map((item) => item.bindingId).sort(),
    beforeIds
  );
  assert.equal(new Set(afterBindings.map(
    (item) => item.bindingId
  )).size, 4);
});
