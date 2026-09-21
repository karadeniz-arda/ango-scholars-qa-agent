import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlannerCaseLimits,
} from "./planner-case-budget.js";

function browserCase(
  overrides: Record<string, any> = {}
): any {
  return {
    id: "web-x",
    persona: "talent",
    goal: "Open the assessment view.",
    startRoute: "/talent/assessments",
    successCriteria:
      "The assessment view is correct.",
    runtimeFixturePolicy:
      "compatible-state",
    automatedChecks: [
      "The page is visible.",
    ],
    manualChecks: [],
    fixtureRequirements: [],
    steps: [
      {
        action: "wait",
        ms: 1000,
      },
      {
        action: "assertTextNotVisible",
        text: "undefined",
      },
    ],
    ...overrides,
  };
}

function apiCase(
  overrides: Record<string, any> = {}
): any {
  return {
    id: "api-x",
    persona: "talent",
    method: "POST",
    path: "UNKNOWN",
    body: {},
    expect: {
      status: "UNKNOWN",
      notes:
        "Verify the intended API behavior.",
    },
    ...overrides,
  };
}

test(
  "retains resolved browser cases with different acceptance semantics",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: [],
      browserCases: [
        browserCase({
          id: "web-1",
          successCriteria:
            "The newest assessment appears first.",
        }),
        browserCase({
          id: "web-2",
          successCriteria:
            "Assessment card information is not duplicated.",
        }),
      ],
    });

    assert.equal(
      plan.browserCases.length,
      2
    );
  }
);

test(
  "retains unresolved browser dependency cases with different acceptance semantics",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: [],
      browserCases: [
        browserCase({
          id: "web-1",
          startRoute: "UNKNOWN",
          successCriteria:
            "The preview renders right-to-left content correctly.",
        }),
        browserCase({
          id: "web-2",
          startRoute: "UNKNOWN",
          successCriteria:
            "The evaluation view renders right-to-left content correctly.",
        }),
      ],
    });

    assert.equal(
      plan.browserCases.length,
      2
    );
  }
);

test(
  "retains unresolved API dependency cases with different acceptance semantics",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: [
        apiCase({
          id: "api-1",
          expect: {
            status: "UNKNOWN",
            notes:
              "Verify the offer compliance snapshot remains unchanged.",
          },
        }),
        apiCase({
          id: "api-2",
          expect: {
            status: "UNKNOWN",
            notes:
              "Verify the contract compliance snapshot remains unchanged.",
          },
        }),
      ],
      browserCases: [],
    });

    assert.equal(
      plan.apiCases.length,
      2
    );
  }
);

test(
  "still deduplicates exact browser execution and acceptance duplicates",
  () => {
    const first =
      browserCase({
        id: "web-1",
      });

    const second =
      browserCase({
        id: "web-2",
      });

    const plan =
      applyPlannerCaseLimits({
        apiCases: [],
        browserCases: [
          first,
          second,
        ],
      });

    assert.equal(
      plan.browserCases.length,
      1
    );
    assert.equal(
      plan.plannerCaseBudgetAudit.removals[0].reason,
      "REMOVED_EXACT_DUPLICATE"
    );
  }
);

test(
  "still deduplicates exact API execution and acceptance duplicates",
  () => {
    const plan =
      applyPlannerCaseLimits({
        apiCases: [
          apiCase({
            id: "api-1",
          }),
          apiCase({
            id: "api-2",
          }),
        ],
        browserCases: [],
      });

    assert.equal(
      plan.apiCases.length,
      1
    );
  }
);

test(
  "labels repeated unresolved API dependency separately from exact duplication",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: [
        apiCase({
          id: "api-original",
          body: { attempt: 1 },
        }),
        apiCase({
          id: "api-repeated",
          body: { attempt: 2 },
        }),
      ],
      browserCases: [],
    });

    assert.equal(plan.apiCases.length, 1);
    assert.equal(
      plan.plannerCaseBudgetAudit.removals[0].reason,
      "REMOVED_REPEATED_DEPENDENCY"
    );
  }
);

test(
  "labels a distinct fifth browser case as capacity overflow",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: [],
      browserCases: Array.from(
        { length: 5 },
        (_, index) =>
          browserCase({
            id: `browser-source-${index + 1}`,
            successCriteria: `Distinct browser acceptance ${index + 1}.`,
          })
      ),
    });

    assert.equal(plan.browserCases.length, 4);
    assert.equal(
      plan.plannerCaseBudgetAudit.browser.overflowCount,
      1
    );
    assert.deepEqual(
      plan.plannerCaseBudgetAudit.removals.map(
        (item: any) => [item.originalCaseId, item.reason]
      ),
      [["browser-source-5", "REMOVED_CAPACITY_OVERFLOW"]]
    );
  }
);

test(
  "labels a distinct fifth API case as capacity overflow",
  () => {
    const plan = applyPlannerCaseLimits({
      apiCases: Array.from(
        { length: 5 },
        (_, index) =>
          apiCase({
            id: `api-source-${index + 1}`,
            method: "GET",
            path: `/api/records/${index + 1}`,
            expect: {
              status: 200,
              notes: `Distinct API acceptance ${index + 1}.`,
            },
          })
      ),
      browserCases: [],
    });

    assert.equal(plan.apiCases.length, 4);
    assert.equal(
      plan.plannerCaseBudgetAudit.api.overflowCount,
      1
    );
    assert.equal(
      plan.plannerCaseBudgetAudit.removals[0].reason,
      "REMOVED_CAPACITY_OVERFLOW"
    );
  }
);

test(
  "four distinct cases are unchanged and audit metadata is deterministic",
  () => {
    const createPlan = () => ({
      apiCases: [],
      browserCases: Array.from(
        { length: 4 },
        (_, index) =>
          browserCase({
            id: `source-${index + 1}`,
            successCriteria: `Distinct acceptance ${index + 1}.`,
          })
      ),
    });
    const first = applyPlannerCaseLimits(createPlan());
    const second = applyPlannerCaseLimits(createPlan());

    assert.equal(first.browserCases.length, 4);
    assert.deepEqual(
      first.plannerCaseBudgetAudit,
      second.plannerCaseBudgetAudit
    );
    assert.deepEqual(
      first.plannerCaseBudgetAudit.removals,
      []
    );
    assert.equal("verdict" in first.plannerCaseBudgetAudit, false);
  }
);

test(
  "invoice semantic merge preserves different acceptance semantics",
  () => {
    const common = {
      persona: "company_admin",
      startRoute:
        "/company/payments",
      runtimeFixturePolicy:
        "compatible-state",
      steps: [
        {
          action: "clickTopTab",
          text: "Processed",
        },
        {
          action: "assertTextVisible",
          text: "Invoice",
        },
      ],
    };

    const plan =
      applyPlannerCaseLimits({
        apiCases: [],
        browserCases: [
          browserCase({
            ...common,
            id: "web-1",
            goal:
              "Open invoice drawer details.",
            successCriteria:
              "The invoice amount is visible.",
          }),
          browserCase({
            ...common,
            id: "web-2",
            goal:
              "Open invoice drawer details.",
            successCriteria:
              "The invoice payment status is visible.",
          }),
        ],
      });

    assert.equal(
      plan.browserCases.length,
      2
    );
  }
);

test(
  "invoice semantic merge still collapses identical acceptance while keeping stronger execution evidence",
  () => {
    const common = {
      persona: "company_admin",
      goal:
        "Open invoice drawer details.",
      startRoute:
        "/company/payments",
      successCriteria:
        "The invoice details are visible.",
      runtimeFixturePolicy:
        "compatible-state",
      automatedChecks: [
        "The invoice details are visible.",
      ],
      manualChecks: [],
      fixtureRequirements: [],
    };

    const plan =
      applyPlannerCaseLimits({
        apiCases: [],
        browserCases: [
          {
            ...common,
            id: "web-1",
            steps: [
              {
                action: "clickTopTab",
                text: "Processed",
              },
            ],
          },
          {
            ...common,
            id: "web-2",
            steps: [
              {
                action: "clickTopTab",
                text: "Processed",
              },
              {
                action:
                  "assertTextVisible",
                text: "Invoice",
              },
            ],
          },
        ],
      });

    assert.equal(
      plan.browserCases.length,
      1
    );

    assert.equal(
      plan.browserCases[0]
        .steps.length,
      2
    );
    assert.equal(
      plan.plannerCaseBudgetAudit.removals[0].reason,
      "REMOVED_SEMANTIC_SPECIAL_DUPLICATE"
    );
  }
);
