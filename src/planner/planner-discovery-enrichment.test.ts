import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichTestPlanWithDiscovery,
} from "./planner-discovery-enrichment.js";

function browserCase(
  overrides: Record<string, unknown> = {}
): any {
  return {
    id: "web-1",
    persona: "company_admin",
    goal:
      "Verify the Payments page provides invoice search.",
    startRoute: "UNKNOWN",
    successCriteria:
      "The Payments page displays matching invoices.",
    runtimeFixturePolicy:
      "compatible-state",
    automatedChecks: [
      "Payments is visible.",
    ],
    manualChecks: [],
    fixtureRequirements: [],
    steps: [],
    ...overrides,
  };
}

function candidate(
  route: string,
  groundingScore = 600
) {
  return {
    route,
    confidence: "high" as const,
    source: "ui-route-catalog",
    groundingScore,
    evidence: [
      "EXPLICIT_CASE_SURFACE_REFERENCE",
    ],
    reason:
      "Synthetic grounded route candidate.",
  };
}

test(
  "unrelated plan notes cannot redirect a case away from its explicit surface",
  () => {
    const testCase = browserCase();
    const plan = {
      issueKey: "ISSUE-1",
      summary:
        "Add invoice search to Payments pages",
      notes:
        "An unrelated collateral change touched the Jobs list.",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.notEqual(
      testCase.startRoute,
      "/company/all-jobs"
    );
  }
);

test(
  "a manifest-compatible concrete model route is deterministically validated",
  () => {
    const testCase = browserCase({
      startRoute:
        "/company/payments",
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "/company/payments"
    );
    assert.equal(
      testCase.routeResolution?.status,
      "VALIDATED"
    );
    assert.equal(
      testCase.routeResolution
        ?.candidates[0]?.origin,
      "UI_ROUTE_CATALOG"
    );
  }
);

test(
  "a planner route literal is not authoritative but may be validated by strong manifest compatibility",
  () => {
    const testCase = browserCase({
      goal:
        "Open /company/payments and verify invoice search.",
    });
    const plan = {
      summary:
        "Invoice search",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "/company/payments"
    );
    assert.equal(
      testCase.routeResolution
        ?.candidates[0]?.source,
      "ui-route-catalog"
    );
    assert.notEqual(
      testCase.routeResolution
        ?.candidates[0]?.origin,
      "PLANNER_LITERAL"
    );
  }
);

test(
  "a concrete planner route with exact Jira route evidence is validated as source grounded",
  () => {
    const testCase = browserCase({
      goal: "Verify the intended authenticated surface.",
      startRoute: "/company/payments",
      successCriteria: "The intended surface is available.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/payments",
          origin: "JIRA_EXPLICIT_ROUTE",
          sourceRef: "JIRA_DESCRIPTION",
          authoritative: true,
        },
      ],
    });

    assert.equal(testCase.startRoute, "/company/payments");
    assert.equal(testCase.routeResolution?.status, "VALIDATED");
    assert.equal(
      testCase.routeResolution?.candidates[0]?.origin,
      "JIRA_EXPLICIT_ROUTE"
    );
    assert.equal(
      testCase.routeResolution?.candidates[0]?.authoritative,
      true
    );
  }
);

test(
  "exact Jira route evidence replaces a conflicting concrete planner literal",
  () => {
    const testCase = browserCase({
      goal: "Verify the intended authenticated surface.",
      startRoute: "/company/all-jobs",
      successCriteria: "The intended surface is available.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/payments",
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: true,
        },
      ],
    });

    assert.equal(testCase.startRoute, "/company/payments");
    assert.equal(testCase.routeResolution?.status, "REPLACED");
    assert.equal(
      testCase.routeResolution?.originalRoute,
      "/company/all-jobs"
    );
  }
);

test(
  "a negated Jira route remains diagnostic and cannot validate a concrete planner literal",
  () => {
    const testCase = browserCase({
      goal: "Verify the authenticated experience.",
      startRoute: "/company/payments",
      successCriteria: "Expected content is available.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/payments",
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: false,
          disposition: "NEGATED",
          reason: "Jira explicitly forbids this route.",
        },
      ],
    });

    assert.equal(testCase.startRoute, "UNKNOWN");
    assert.equal(testCase.routeResolution?.status, "UNVERIFIED");
    assert.ok(
      testCase.routeResolution?.candidates.some(
        (item: any) =>
          item.routeEvidenceDisposition === "NEGATED" &&
          item.authoritative === false
      )
    );
  }
);

test(
  "replacement Jira evidence selects the current route rather than the replaced-from route",
  () => {
    const testCase = browserCase({
      goal: "Verify the intended authenticated surface.",
      startRoute: "/company/all-jobs",
      successCriteria: "Expected content is available.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/all-jobs",
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: false,
          disposition: "REPLACED_FROM",
        },
        {
          route: "/company/payments",
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: true,
          disposition: "CURRENT",
        },
      ],
    });

    assert.equal(testCase.startRoute, "/company/payments");
    assert.equal(testCase.routeResolution?.status, "REPLACED");
  }
);

test(
  "an unknown planner persona cannot broaden source route matching",
  () => {
    const testCase = browserCase({
      persona: "unknown_persona",
      goal: "Verify the intended authenticated surface.",
      startRoute: "/company/payments",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/payments",
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: true,
          disposition: "CURRENT",
        },
      ],
    });

    assert.equal(testCase.startRoute, "UNKNOWN");
    assert.equal(testCase.routeResolution?.status, "UNVERIFIED");
  }
);

test(
  "a relevant GitHub router mapping replaces a conflicting planner literal",
  () => {
    const testCase = browserCase({
      startRoute: "/company/all-jobs",
    });
    const plan = {
      summary: "Payments search",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route: "/company/payments",
          origin: "GITHUB_ROUTER_MAPPING",
          sourceRef: "src/routes/payments.route.tsx",
          authoritative: true,
        },
      ],
    });

    assert.equal(testCase.startRoute, "/company/payments");
    assert.equal(testCase.routeResolution?.status, "REPLACED");
    assert.equal(
      testCase.routeResolution?.candidates[0]?.origin,
      "GITHUB_ROUTER_MAPPING"
    );
  }
);

test(
  "a concrete catalog route with only persona compatibility becomes UNKNOWN",
  () => {
    const testCase = browserCase({
      goal: "Verify the authenticated experience.",
      startRoute: "/company/all-jobs",
      successCriteria: "Expected content is available.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(testCase.startRoute, "UNKNOWN");
    assert.equal(testCase.routeResolution?.status, "UNVERIFIED");
    const plannerCandidate = testCase.routeResolution?.candidates.find(
      (item: any) => item.origin === "PLANNER_LITERAL"
    );
    assert.equal(plannerCandidate?.confidence, "medium");
    assert.equal(plannerCandidate?.authoritative, false);
  }
);

test(
  "a non-Jobs case does not retain a concrete model Jobs route",
  () => {
    const testCase = browserCase({
      startRoute: "/company/all-jobs",
    });
    const plan = {
      summary: "Payments search",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(testCase.startRoute, "/company/payments");
    assert.equal(testCase.routeResolution?.status, "REPLACED");
  }
);

test(
  "a source-grounded parameterized route remains non-executable without inventing identity",
  () => {
    const route = "/talent/contracts/{contractId}";
    const testCase = browserCase({
      persona: "talent",
      goal: "Verify the contract details flow.",
      startRoute: route,
      successCriteria: "Contract details are correct.",
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route,
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: true,
        },
      ],
    });

    assert.equal(testCase.startRoute, "UNKNOWN");
    assert.equal(testCase.routeResolution?.status, "UNVERIFIED");
    assert.ok(
      testCase.routeResolution?.candidates.some(
        (item: any) =>
          item.route === route &&
          item.rejectionReason ===
            "ROUTE_REQUIRES_RUNTIME_IDENTITY"
      )
    );
  }
);

test(
  "an exact grounded query-bearing browser route retains its query contract",
  () => {
    const route = "/company/payments?tab=processed";
    const testCase = browserCase({
      goal: "Verify the intended authenticated surface.",
      startRoute: route,
      automatedChecks: [],
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan, {
      routeEvidence: [
        {
          route,
          origin: "JIRA_EXPLICIT_ROUTE",
          authoritative: true,
        },
      ],
    });

    assert.equal(testCase.startRoute, route);
    assert.equal(testCase.routeResolution?.status, "VALIDATED");
  }
);

test(
  "persona-compatible catalog routes remain unresolved without surface grounding",
  () => {
    const testCase = browserCase({
      goal:
        "Verify the authenticated experience.",
      successCriteria:
        "The expected content is visible.",
      automatedChecks: [],
    });
    const plan = {
      summary:
        "Authenticated UI improvement",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "UNKNOWN"
    );
    assert.equal(
      testCase.routeResolution?.status,
      "UNRESOLVED"
    );
  }
);

test(
  "one broad shared product noun does not create high-confidence routing",
  () => {
    const testCase = browserCase({
      goal: "Verify a job value.",
      successCriteria:
        "The job value is correct.",
      automatedChecks: [],
    });
    const plan = {
      summary: "Update one value",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "UNKNOWN"
    );
    assert.equal(
      testCase.routeResolution
        ?.candidates.some(
          (item: any) =>
            item.route.includes("jobs") &&
            item.confidence === "high"
        ),
      false
    );
  }
);

test(
  "equally grounded competing routes fail safe instead of selecting by order",
  () => {
    const testCase = browserCase({
      goal:
        "Verify the records list.",
    });
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(
      plan,
      {
        discoverBrowserRouteCandidates:
          () => [
            candidate(
              "/company/records-a"
            ),
            candidate(
              "/company/records-b"
            ),
          ],
      }
    );

    assert.equal(
      testCase.startRoute,
      "UNKNOWN"
    );
    assert.equal(
      testCase.routeResolution?.status,
      "AMBIGUOUS"
    );
    assert.deepEqual(
      testCase.routeResolution
        ?.candidates.map(
          (item: any) =>
            item.rejectionReason
        ),
      [
        "COMPETING_EQUIVALENT_GROUNDING",
        "COMPETING_EQUIVALENT_GROUNDING",
      ]
    );
  }
);

test(
  "UNKNOWN remains UNKNOWN when discovery has no candidate",
  () => {
    const testCase = browserCase();
    const plan = {
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(
      plan,
      {
        discoverBrowserRouteCandidates:
          () => [],
      }
    );

    assert.equal(
      testCase.startRoute,
      "UNKNOWN"
    );
    assert.deepEqual(
      testCase.routeResolution,
      {
        status: "UNRESOLVED",
        originalRoute: "UNKNOWN",
        confidence: "low",
        totalCandidateCount: 0,
        candidates: [],
      }
    );
  }
);

test(
  "strong existing jobs-list grounding retains the proven catalog entry capability",
  () => {
    const testCase = browserCase({
      goal:
        "Verify the company jobs list sorting controls.",
      successCriteria:
        "The jobs list exposes its sorting choices.",
      automatedChecks: [],
    });
    const plan = {
      summary:
        "Update CompanyJobsList sorting",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "/company/all-jobs"
    );
    assert.equal(
      testCase.routeResolution?.status,
      "RESOLVED"
    );
  }
);

test(
  "case acceptance scope outranks an unrelated plan summary surface",
  () => {
    const testCase = browserCase();
    const plan = {
      summary:
        "Collateral jobs maintenance",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.equal(
      testCase.startRoute,
      "/company/payments"
    );
    assert.ok(
      testCase.routeResolution
        ?.candidates[0]?.evidence
        ?.includes(
          "WANTED_AREA_SOURCE:CASE_GOAL"
        )
    );
  }
);

test(
  "route enrichment changes only navigation and observational provenance",
  () => {
    const testCase = browserCase({
      steps: [
        {
          action:
            "assertTextVisible",
          text: "Payments",
        },
      ],
    });
    const original = {
      goal: testCase.goal,
      successCriteria:
        testCase.successCriteria,
      automatedChecks:
        structuredClone(
          testCase.automatedChecks
        ),
      manualChecks:
        structuredClone(
          testCase.manualChecks
        ),
      fixtureRequirements:
        structuredClone(
          testCase.fixtureRequirements
        ),
      runtimeFixturePolicy:
        testCase.runtimeFixturePolicy,
      steps:
        structuredClone(testCase.steps),
    };
    const plan = {
      summary:
        "Invoice search on Payments",
      apiCases: [],
      browserCases: [testCase],
    };

    enrichTestPlanWithDiscovery(plan);

    assert.deepEqual(
      {
        goal: testCase.goal,
        successCriteria:
          testCase.successCriteria,
        automatedChecks:
          testCase.automatedChecks,
        manualChecks:
          testCase.manualChecks,
        fixtureRequirements:
          testCase.fixtureRequirements,
        runtimeFixturePolicy:
          testCase.runtimeFixturePolicy,
        steps: testCase.steps,
      },
      original
    );
    assert.equal(
      "passed" in
        (testCase.routeResolution ?? {}),
      false
    );
    assert.equal(
      "verdict" in
        (testCase.routeResolution ?? {}),
      false
    );
  }
);

test(
  "route-resolution provenance is deterministic",
  () => {
    const makePlan = () => {
      const testCase = browserCase({
        goal:
          "Verify the records list.",
      });

      return {
        testCase,
        plan: {
          apiCases: [],
          browserCases: [testCase],
        },
      };
    };
    const first = makePlan();
    const second = makePlan();
    const dependencies = {
      discoverBrowserRouteCandidates:
        () => [
          candidate(
            "/company/records-a",
            650
          ),
          candidate(
            "/company/records-b",
            600
          ),
        ],
    };

    enrichTestPlanWithDiscovery(
      first.plan,
      dependencies
    );
    enrichTestPlanWithDiscovery(
      second.plan,
      dependencies
    );

    assert.deepEqual(
      first.testCase.routeResolution,
      second.testCase.routeResolution
    );
  }
);


test("source route ambiguity survives unequal lexical ranking and parameterized filtering", () => {
  for (const secondRoute of ["/company/history", "/company/contracts/:contractId"]) {
    const testCase = browserCase({ goal: "Verify the account overview", startRoute: "/company/overview" });
    enrichTestPlanWithDiscovery({ browserCases: [testCase] }, {
      discoverBrowserRouteCandidates: () => [
        { ...candidate("/company/overview", 1200), evidence: ["SOURCE_SURFACE_PROVENANCE"] },
        { ...candidate(secondRoute, 1000), evidence: ["SOURCE_SURFACE_PROVENANCE"] },
      ],
    });
    assert.equal(testCase.startRoute, "UNKNOWN");
    assert.equal(testCase.routeResolution.status, "AMBIGUOUS");
    assert.ok(testCase.routeResolution.candidates.every((item: any) => item.disposition === "REJECTED"));
  }
});

test("a sole source-backed runtime template cannot fall back to an unrelated concrete route", () => {
  const testCase = browserCase({ goal: "Verify the account overview" });
  enrichTestPlanWithDiscovery({ browserCases: [testCase] }, {
    discoverBrowserRouteCandidates: () => [
      { ...candidate("/company/contracts/:contractId", 1200), evidence: ["SOURCE_SURFACE_PROVENANCE"] },
      candidate("/company/overview", 800),
    ],
  });
  assert.equal(testCase.startRoute, "UNKNOWN");
  assert.notEqual(testCase.routeResolution.status, "RESOLVED");
});

test("source ambiguity is evaluated within the candidate persona", () => {
  const testCase = browserCase({ goal: "Verify the account overview" });
  enrichTestPlanWithDiscovery({ browserCases: [testCase] }, {
    discoverBrowserRouteCandidates: () => [
      { ...candidate("/company/overview", 1200), evidence: ["SOURCE_SURFACE_PROVENANCE"] },
      { ...candidate("/talent/overview", 1400), evidence: ["SOURCE_SURFACE_PROVENANCE"] },
    ],
  });
  assert.equal(testCase.startRoute, "/company/overview");
});
