import assert from "node:assert/strict";
import test from "node:test";

import {
  attachPlannerAcceptanceVerdictGrouping,
  buildPlannerAcceptanceVerdictGrouping,
  type PlannerAcceptanceVerdictGroupProposal,
} from "./planner-acceptance-verdict-grouping.js";
import {
  normalizePlannerBrowserScopes,
} from "./planner-browser-policy.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  TestPlan,
} from "./types.js";

function metadata(texts: string[]): {
  obligationLedger:
    PlannerAcceptanceObligationLedger;
  sourceLedger: PlannerAcceptanceSourceLedger;
} {
  return {
    sourceLedger: {
      sourceStatus: "RESOLVED",
      basis: "ACCEPTANCE_CRITERIA",
      sourceUnits: texts.map((text, index) => ({
        id: `source-${index + 1}`,
        sourceKind: "ACCEPTANCE_CRITERIA",
        sourceRef: "jira.field:acceptance",
        text,
      })),
    },
    obligationLedger: {
      sourceStatus: "RESOLVED",
      derivationStatus: "RESOLVED",
      obligations: texts.map((text, index) => ({
        id: `obligation-${index + 1}`,
        sourceUnitIds: [`source-${index + 1}`],
        sourceRole: "ACCEPTANCE",
        derivation: "DIRECT_ACCEPTANCE_FIELD",
        text,
      })),
      unresolvedSourceUnitIds: [],
    },
  };
}

function proposal(args: {
  obligationIds: string[];
  relationship:
    PlannerAcceptanceVerdictGroupProposal["relationship"];
  sourceOrdinal: number;
  dependsOnObligationIds?: string[];
}): PlannerAcceptanceVerdictGroupProposal {
  return {
    obligationIds: args.obligationIds,
    relationship: args.relationship,
    ...(args.dependsOnObligationIds
      ? {
          dependsOnObligationIds:
            args.dependsOnObligationIds,
        }
      : {}),
    sourceRefs: [{
      sourceUnitId: `source-${args.sourceOrdinal}`,
      sourceRef: "jira.field:acceptance",
    }],
    reason: "Explicit synthetic grouping authority.",
  };
}

function browserCase(): BrowserTestCase {
  return {
    id: "web-1",
    persona: "company_admin",
    goal: "Verify the bounded behavior.",
    startRoute: "/settings",
    successCriteria: "The bounded behavior is correct.",
    automatedChecks: ["The label is visible."],
    manualChecks: ["Confirm the persisted value."],
    fixtureRequirements: ["An existing record."],
    acceptanceObligationIds: ["obligation-1"],
    steps: [{
      action: "assertTextVisible",
      text: "Label",
    }],
  };
}

test("explicit same-behavior authority preserves one atomic verdict unit", () => {
  const ledgers = metadata([
    "Selecting X must update Y.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      authoritativeGroups: [proposal({
        obligationIds: ["obligation-1"],
        relationship: "ATOMIC",
        sourceOrdinal: 1,
      })],
    });

  assert.equal(grouping.status, "AUTHORITATIVE");
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0]?.relationship, "ATOMIC");
  assert.deepEqual(
    grouping.groups[0]?.obligationIds,
    ["obligation-1"]
  );
});

test("different source units remain one fail-closed unknown group without authority", () => {
  const ledgers = metadata([
    "Reset restores the configured default.",
    "After reset, completed results remain unchanged.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping(ledgers);

  assert.equal(grouping.status, "UNKNOWN");
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0]?.relationship, "UNKNOWN");
  assert.deepEqual(
    grouping.groups[0]?.obligationIds,
    ["obligation-1", "obligation-2"]
  );
});

test("separate bullets and sentences do not create independent authority", () => {
  const ledgers = metadata([
    "First bullet: show the label. Second sentence: keep the value.",
    "Another bullet: preserve the layout.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping(ledgers);

  assert.equal(grouping.status, "UNKNOWN");
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0]?.relationship, "UNKNOWN");
});

test("affirmative source contracts can establish independent verdict units", () => {
  const ledgers = metadata([
    "Independently verdictable: the selected tab remains visible.",
    "Independently verdictable: the mobile layout remains aligned.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping(ledgers);

  assert.equal(grouping.status, "AUTHORITATIVE");
  assert.deepEqual(
    grouping.groups.map((group) => group.relationship),
    ["INDEPENDENT", "INDEPENDENT"]
  );
  assert.equal(
    grouping.groups.every((group) =>
      group.authority.status === "AUTHORITATIVE" &&
      group.authority.source === "EXPLICIT_SOURCE" &&
      group.authority.sourceRefs.length === 1
    ),
    true
  );
});

test("an exact quoted source prerequisite establishes a dependency", () => {
  const ledgers = metadata([
    "The import completes.",
    "After \"The import completes.\", the summary becomes visible.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping(ledgers);
  const repeated =
    buildPlannerAcceptanceVerdictGrouping(ledgers);
  const reloaded = JSON.parse(
    JSON.stringify(grouping)
  ) as typeof grouping;
  const prerequisite = grouping.groups.find((group) =>
    group.obligationIds.includes("obligation-1")
  );
  const dependent = grouping.groups.find((group) =>
    group.obligationIds.includes("obligation-2")
  );

  assert.equal(grouping.status, "AUTHORITATIVE");
  assert.equal(prerequisite?.relationship, "ATOMIC");
  assert.equal(dependent?.relationship, "DEPENDS_ON");
  assert.deepEqual(
    dependent?.dependencyVerdictGroupIds,
    [prerequisite?.verdictGroupId]
  );
  assert.deepEqual(
    dependent?.authority.sourceRefs.map((item) => item.sourceUnitId),
    ["source-1", "source-2"]
  );
  assert.deepEqual(repeated, grouping);
  assert.deepEqual(reloaded, grouping);
});

test("an ambiguous quoted prerequisite remains unknown", () => {
  const ledgers = metadata([
    "The import completes.",
    "The import completes.",
    "After \"The import completes.\", the summary becomes visible.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping(ledgers);

  assert.equal(grouping.status, "UNKNOWN");
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0]?.relationship, "UNKNOWN");
});

test("a complete explicit partition preserves independent verdict groups", () => {
  const ledgers = metadata([
    "The URL tracks the selected tab.",
    "The mobile layout aligns correctly.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      authoritativeGroups: [
        proposal({
          obligationIds: ["obligation-1"],
          relationship: "INDEPENDENT",
          sourceOrdinal: 1,
        }),
        proposal({
          obligationIds: ["obligation-2"],
          relationship: "INDEPENDENT",
          sourceOrdinal: 2,
        }),
      ],
    });

  assert.equal(grouping.status, "AUTHORITATIVE");
  assert.equal(grouping.groups.length, 2);
  assert.equal(
    grouping.groups.every(
      (group) =>
        group.relationship === "INDEPENDENT" &&
        group.authority.status === "AUTHORITATIVE"
    ),
    true
  );
});

test("an authoritative dependency resolves to a stable group identity and survives serialization", () => {
  const ledgers = metadata([
    "The existing record exposes label X.",
    "Creating a record persists X after refresh.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      authoritativeGroups: [
        proposal({
          obligationIds: ["obligation-1"],
          relationship: "ATOMIC",
          sourceOrdinal: 1,
        }),
        proposal({
          obligationIds: ["obligation-2"],
          relationship: "DEPENDS_ON",
          dependsOnObligationIds: ["obligation-1"],
          sourceOrdinal: 2,
        }),
      ],
    });
  const reloaded = JSON.parse(
    JSON.stringify(grouping)
  ) as typeof grouping;
  const dependency = reloaded.groups.find(
    (group) =>
      group.relationship === "DEPENDS_ON"
  );

  assert.equal(dependency?.dependencyVerdictGroupIds.length, 1);
  assert.equal(
    dependency?.dependencyVerdictGroupIds[0],
    reloaded.groups.find(
      (group) =>
        group.obligationIds.includes("obligation-1")
    )?.verdictGroupId
  );
});

test("candidate grouping remains diagnostic and cannot replace the unknown effective group", () => {
  const ledgers = metadata([
    "The URL tracks the selected tab.",
    "The mobile layout aligns correctly.",
  ]);
  const candidateGroups = [
    proposal({
      obligationIds: ["obligation-1"],
      relationship: "INDEPENDENT",
      sourceOrdinal: 1,
    }),
    proposal({
      obligationIds: ["obligation-2"],
      relationship: "INDEPENDENT",
      sourceOrdinal: 2,
    }),
  ];
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      candidateGroups,
    });
  const reloaded = JSON.parse(
    JSON.stringify(grouping)
  ) as typeof grouping;

  assert.equal(reloaded.status, "CANDIDATE_ONLY");
  assert.equal(reloaded.groups.length, 1);
  assert.equal(reloaded.groups[0]?.relationship, "UNKNOWN");
  assert.equal(
    reloaded.candidateGroups.every(
      (group) =>
        group.authority.status === "CANDIDATE" &&
        group.accountingDisposition === "CANDIDATE_ONLY"
    ),
    true
  );
});

test("incomplete authoritative metadata fails closed while accounting for every obligation", () => {
  const ledgers = metadata([
    "Requirement A.",
    "Requirement B.",
  ]);
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      authoritativeGroups: [proposal({
        obligationIds: ["obligation-1"],
        relationship: "INDEPENDENT",
        sourceOrdinal: 1,
      })],
    });

  assert.equal(grouping.status, "UNKNOWN");
  assert.deepEqual(
    grouping.accounting.accountedObligationIds,
    ["obligation-1", "obligation-2"]
  );
  assert.deepEqual(
    grouping.accounting.unaccountedObligationIds,
    []
  );
  assert.deepEqual(
    grouping.groups[0]?.obligationIds,
    ["obligation-1", "obligation-2"]
  );
  assert.equal(
    grouping.accounting.invalidProposalCount,
    1
  );
});

test("a dependency on a rejected authority proposal fails closed", () => {
  const ledgers = metadata([
    "Requirement A.",
    "Requirement B.",
  ]);
  const invalidTarget = proposal({
    obligationIds: ["obligation-1"],
    relationship: "ATOMIC",
    sourceOrdinal: 1,
  });
  invalidTarget.sourceRefs[0]!.sourceRef =
    "jira.field:unrelated";
  const grouping =
    buildPlannerAcceptanceVerdictGrouping({
      ...ledgers,
      authoritativeGroups: [
        invalidTarget,
        proposal({
          obligationIds: ["obligation-2"],
          relationship: "DEPENDS_ON",
          dependsOnObligationIds: ["obligation-1"],
          sourceOrdinal: 2,
        }),
      ],
    });

  assert.equal(grouping.status, "UNKNOWN");
  assert.equal(grouping.groups.length, 1);
  assert.equal(grouping.groups[0]?.relationship, "UNKNOWN");
  assert.equal(
    grouping.accounting.invalidProposalCount,
    1
  );
});

test("attachment is idempotent and metadata survives planner normalization and reload", () => {
  const ledgers = metadata([
    "Selecting X must update Y.",
  ]);
  const plan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Synthetic",
    acceptanceSourceLedger: ledgers.sourceLedger,
    acceptanceObligationLedger: ledgers.obligationLedger,
    apiCases: [],
    browserCases: [browserCase()],
  };
  const args = {
    ...ledgers,
    authoritativeGroups: [proposal({
      obligationIds: ["obligation-1"],
      relationship: "ATOMIC" as const,
      sourceOrdinal: 1,
    })],
  };

  attachPlannerAcceptanceVerdictGrouping(plan, args);
  const once = JSON.stringify(
    plan.acceptanceVerdictGrouping
  );
  attachPlannerAcceptanceVerdictGrouping(plan, args);
  normalizePlannerBrowserScopes(plan);
  const reloaded = JSON.parse(
    JSON.stringify(plan)
  ) as TestPlan;

  assert.equal(
    JSON.stringify(plan.acceptanceVerdictGrouping),
    once
  );
  assert.deepEqual(
    reloaded.acceptanceVerdictGrouping,
    plan.acceptanceVerdictGrouping
  );
});

test("verdict grouping metadata has no browser case or allocation effect", () => {
  const ledgers = metadata([
    "Selecting X must update Y.",
  ]);
  const basePlan: TestPlan = {
    issueKey: "SYNTHETIC",
    summary: "Synthetic",
    apiCases: [],
    browserCases: [browserCase()],
    browserObligationBindings: [{
      obligationId: "obligation-1",
      sourceUnitIds: ["source-1"],
      semanticFamily: "STATE_TRANSITION",
      state: "UNSUPPORTED_AUTOMATION_SEMANTIC",
      allocatedCaseIds: ["web-1"],
      reason: "Synthetic binding.",
    }],
  };
  const withoutGrouping = structuredClone(basePlan);
  const withGrouping = structuredClone(basePlan);

  normalizePlannerBrowserScopes(withoutGrouping);
  attachPlannerAcceptanceVerdictGrouping(
    withGrouping,
    ledgers
  );
  normalizePlannerBrowserScopes(withGrouping);

  assert.deepEqual(
    withGrouping.browserCases,
    withoutGrouping.browserCases
  );
  assert.deepEqual(
    withGrouping.browserObligationBindings,
    withoutGrouping.browserObligationBindings
  );
  assert.equal(withGrouping.browserCases.length, 1);
  assert.deepEqual(
    withGrouping.browserCases[0]?.manualChecks,
    ["Confirm the persisted value."]
  );
  assert.deepEqual(
    withGrouping.browserCases[0]?.automatedChecks,
    ["Verify \"Label\" is visible."]
  );
});
