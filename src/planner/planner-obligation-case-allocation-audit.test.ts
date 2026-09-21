import assert from "node:assert/strict";
import test from "node:test";

import {
  auditPlannerObligationCaseAllocation,
} from "./planner-obligation-case-allocation-audit.js";
import {
  applyPlannerCaseLimits,
} from "./planner-case-budget.js";

const ledger: any = {
  sourceStatus: "RESOLVED",
  derivationStatus: "RESOLVED",
  obligations: [
    {
      id: "obligation-exact",
      sourceUnitIds: ["source-1"],
      sourceRole: "ACCEPTANCE",
      derivation: "DIRECT_ACCEPTANCE_FIELD",
      text: "The newest assessment appears first.",
    },
    {
      id: "obligation-notes",
      sourceUnitIds: ["source-2"],
      sourceRole: "ACCEPTANCE",
      derivation: "DIRECT_ACCEPTANCE_FIELD",
      text: "The empty state remains available.",
    },
    {
      id: "obligation-paraphrase",
      sourceUnitIds: ["source-3"],
      sourceRole: "ACCEPTANCE",
      derivation: "DIRECT_ACCEPTANCE_FIELD",
      text: "Assessment information appears exactly once.",
    },
  ],
  unresolvedSourceUnitIds: [],
};

test("audits exact case allocation without claiming paraphrase equivalence", () => {
  const plan = {
    notes: "The empty state remains available.",
    apiCases: [],
    browserCases: [
      {
        id: "web-1",
        successCriteria:
          "The newest assessment appears first.",
        automatedChecks: [
          "Assessment information is not duplicated.",
        ],
      },
    ],
  };

  const audit =
    auditPlannerObligationCaseAllocation(
      plan,
      ledger
    );

  assert.equal(audit.exactCaseRepresentationCount, 1);
  assert.equal(audit.notesOnlyCount, 1);
  assert.equal(audit.notExactlyRepresentedCount, 1);
  assert.deepEqual(
    audit.allocations.map((item) => item.status),
    [
      "EXACT_CASE_REPRESENTATION",
      "NOTES_ONLY",
      "NOT_EXACTLY_REPRESENTED",
    ]
  );
});

test("reports an exact obligation representation removed by capacity", () => {
  const obligationLedger: any = {
    ...ledger,
    obligations: [ledger.obligations[0]],
  };
  const plan = applyPlannerCaseLimits(
    {
      apiCases: [],
      browserCases: Array.from(
        { length: 5 },
        (_, index) => ({
          id: `source-${index + 1}`,
          persona: "company_admin",
          goal: `Goal ${index + 1}`,
          startRoute: "/company/assessments",
          successCriteria:
            index === 4
              ? "The newest assessment appears first."
              : `Distinct acceptance ${index + 1}.`,
          automatedChecks: [],
          manualChecks: [],
          steps: [],
        })
      ),
    },
    { obligationLedger }
  );

  const audit =
    auditPlannerObligationCaseAllocation(
      plan,
      obligationLedger
    );

  assert.equal(audit.exactRepresentationRemovedCount, 1);
  assert.deepEqual(
    audit.allocations[0],
    {
      obligationId: "obligation-exact",
      status: "EXACT_REPRESENTATION_REMOVED",
      matchedCaseIds: [],
      removedCaseIds: ["source-5"],
    }
  );
});

test("allocation audit is deterministic and contains no proof or verdict fields", () => {
  const plan = {
    apiCases: [],
    browserCases: [],
  };
  const first =
    auditPlannerObligationCaseAllocation(
      plan,
      ledger
    );
  const second =
    auditPlannerObligationCaseAllocation(
      plan,
      ledger
    );

  assert.deepEqual(first, second);
  assert.equal("passed" in first, false);
  assert.equal("verdict" in first, false);
});

test("stable obligation IDs survive paraphrased case text and take precedence over exact-text coincidence", () => {
  const plan = {
    apiCases: [],
    browserCases: [
      {
        id: "web-paraphrase",
        goal: "Confirm the latest item is at the top.",
        acceptanceObligationIds: ["obligation-exact"],
      },
    ],
  };

  const audit = auditPlannerObligationCaseAllocation(
    plan,
    ledger
  );

  assert.equal(audit.stableIdCaseRepresentationCount, 1);
  assert.deepEqual(audit.allocations[0], {
    obligationId: "obligation-exact",
    status: "STABLE_ID_CASE_REPRESENTATION",
    matchedCaseIds: ["web-paraphrase"],
    removedCaseIds: [],
  });
});
