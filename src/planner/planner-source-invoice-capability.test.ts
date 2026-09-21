import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSourceInvoiceExecutionCapabilities,
  sourceInvoiceCapabilityForCase,
} from "./planner-source-invoice-capability.js";
import {
  applyPlannerRuntimeFixturePolicies,
  splitCombinedInvoiceStateCases,
} from "./planner-runtime-fixture-policy.js";
import type { TestPlan } from "./types.js";

const sourceText =
  "In the payments table, invoice details are displayed in the sent for processing and processed tabs.";

function planFor(model: Partial<{
  goal: string;
  successCriteria: string;
  steps: any[];
}> = {}): TestPlan {
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "source invoice capability",
    apiCases: [],
    browserCases: [{
      id: "web-1",
      persona: "company_admin",
      goal: model.goal ?? "Review the records.",
      startRoute: "/company/payments",
      successCriteria: model.successCriteria ?? "Review the records.",
      steps: model.steps ?? [],
    }],
    acceptanceSourceLedger: {
      sourceStatus: "RESOLVED",
      basis: "ACCEPTANCE_CRITERIA",
      sourceUnits: [{
        id: "source-1",
        sourceKind: "ACCEPTANCE_CRITERIA",
        sourceRef: "jira.ac.1",
        text: sourceText,
      }],
    },
    acceptanceObligationLedger: {
      sourceStatus: "RESOLVED",
      derivationStatus: "RESOLVED",
      obligations: [{
        id: "obligation-1",
        sourceUnitIds: ["source-1"],
        sourceRole: "ACCEPTANCE",
        derivation: "DIRECT_ACCEPTANCE_FIELD",
        text: sourceText,
      }],
      unresolvedSourceUnitIds: [],
    },
  };
  plan.sourceInvoiceExecutionCapabilities =
    compileSourceInvoiceExecutionCapabilities(plan);
  return plan;
}

test("source invoice capability is invariant to model wording", () => {
  const current = planFor({
    goal: "Open invoice details in both tabs.",
    successCriteria: sourceText,
    steps: [{ action: "clickTopTab", text: "processed" }],
  });
  const omitted = planFor();
  const unrelated = planFor({
    goal: "Review unrelated records.",
    successCriteria: "Check the page.",
    steps: [{ action: "reload" }],
  });

  assert.deepEqual(
    omitted.sourceInvoiceExecutionCapabilities,
    current.sourceInvoiceExecutionCapabilities
  );
  assert.deepEqual(
    unrelated.sourceInvoiceExecutionCapabilities,
    current.sourceInvoiceExecutionCapabilities
  );
  assert.equal(
    sourceInvoiceCapabilityForCase(omitted, omitted.browserCases[0]!)?.resolverRef,
    "browser-visible-invoice-row"
  );
});

test("model-only invoice wording cannot create the source capability", () => {
  const plan = planFor();
  delete plan.acceptanceObligationLedger;
  delete plan.acceptanceSourceLedger;
  plan.sourceInvoiceExecutionCapabilities = [];
  plan.browserCases[0]!.goal = "Open invoice details in processed state.";
  plan.browserCases[0]!.steps = [{ action: "clickTopTab", text: "processed" }];

  assert.deepEqual(
    compileSourceInvoiceExecutionCapabilities(plan),
    []
  );
  assert.equal(
    sourceInvoiceCapabilityForCase(plan, plan.browserCases[0]!),
    undefined
  );
});

test("source states split and select compatible-state without model state wording", () => {
  const plan = planFor();

  splitCombinedInvoiceStateCases(plan);
  assert.deepEqual(
    plan.browserCases.map((item) => item.plannerExecutionShell?.partition.memberId),
    ["sent-for-processing", "processed"]
  );

  applyPlannerRuntimeFixturePolicies(
    plan,
    `--- JIRA TICKET ---\n${sourceText}\n--- GITHUB CHANGE CONTEXT ---`
  );
  assert.deepEqual(
    plan.browserCases.map((item) => item.runtimeFixturePolicy),
    ["compatible-state", "compatible-state"]
  );
  assert.deepEqual(
    plan.browserCases.map((item) => item.steps?.[0]),
    [
      { action: "clickTopTab", text: "sent for processing" },
      { action: "clickTopTab", text: "processed" },
    ]
  );
});

test("unsupported source state remains fail-safe", () => {
  const plan = planFor();
  plan.acceptanceObligationLedger!.obligations[0]!.text =
    "Invoice details are displayed in the pending tab.";
  assert.deepEqual(
    compileSourceInvoiceExecutionCapabilities(plan),
    []
  );
});
