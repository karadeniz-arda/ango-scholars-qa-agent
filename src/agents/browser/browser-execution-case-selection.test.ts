import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTestCase,
  TestPlan,
} from "../../planner/types.js";
import {
  deriveBrowserCaseVerdict,
  isOperationalDiscoverySupportUnit,
} from "./browser-case-verdict.js";
import {
  getBrowserBlockReason,
} from "./browser-case-blocking-policy.js";
import {
  selectMaterializedBrowserRuntimeCases,
} from "./browser-execution-case-selection.js";

function browserCase(
  id: string,
  overrides: Partial<BrowserTestCase> = {}
): BrowserTestCase {
  return {
    id,
    persona: "company_admin",
    goal: "Inspect the materialized browser surface.",
    startRoute: "/company/items",
    successCriteria: "The requested surface is observable.",
    steps: [],
    ...overrides,
  };
}

function plan(args: {
  browserCases?: BrowserTestCase[];
  discoveryBrowserCases?: BrowserTestCase[];
}): Pick<TestPlan, "browserCases" | "discoveryBrowserCases"> {
  return {
    browserCases: args.browserCases ?? [],
    discoveryBrowserCases: args.discoveryBrowserCases ?? [],
  };
}

function withBrowserCaseId<T>(
  requestedCaseId: string | undefined,
  callback: () => T
): T {
  const previous = process.env.QA_BROWSER_CASE_ID;

  if (requestedCaseId === undefined) {
    delete process.env.QA_BROWSER_CASE_ID;
  } else {
    process.env.QA_BROWSER_CASE_ID = requestedCaseId;
  }

  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.QA_BROWSER_CASE_ID;
    } else {
      process.env.QA_BROWSER_CASE_ID = previous;
    }
  }
}

test("source/proof-rich materialized cases remain execution selected", () => {
  const sourceCase = browserCase("source", {
    acceptanceObligationIds: ["obligation-a"],
    executionCheckContract: {
      schemaVersion: 1,
      caseId: "source",
      executionObligationIds: ["obligation-a"],
      requiredChecks: [{
        checkId: "check-a",
        kind: "LOCAL_STATE_TRANSITION",
        authority: "SOURCE_AUTHORIZED",
        requirementId: "requirement-a",
      }],
      requiredManualCheckIds: [],
    },
  });

  assert.deepEqual(
    selectMaterializedBrowserRuntimeCases(plan({
      browserCases: [sourceCase],
    })).cases,
    [sourceCase]
  );
});

test("authority-free discovery support is execution selected but not acceptance-verdict eligible", () => {
  const supportCase = browserCase("support", {
    executionPolicy: { lane: "DISCOVERY_ONLY" },
    acceptanceObligationIds: [],
  });
  const selection = selectMaterializedBrowserRuntimeCases(plan({
    discoveryBrowserCases: [supportCase],
  }));

  assert.equal(selection.browserExecutionSelectedCount, 1);
  assert.equal(selection.cases[0], supportCase);
  assert.equal(isOperationalDiscoverySupportUnit(supportCase), true);
});

test("proof-unavailable cases execute but cannot synthesize PASS", () => {
  const proofUnavailable = browserCase("proof-unavailable");
  const selection = selectMaterializedBrowserRuntimeCases(plan({
    discoveryBrowserCases: [proofUnavailable],
  }));

  assert.equal(selection.browserExecutionSelectedCount, 1);
  assert.deepEqual(
    deriveBrowserCaseVerdict({
      testCase: proofUnavailable,
      executionAuthority: {
        actualPersona: {
          status: "AVAILABLE",
          value: "company_admin",
          source: "test",
        },
        acceptedRoutePath: {
          status: "AVAILABLE",
          value: "/company/items",
          source: "test",
        },
        targetVerified: {
          status: "AVAILABLE",
          value: true,
          source: "test",
        },
        fixtureStatus: {
          status: "AVAILABLE",
          value: "NOT_REQUIRED",
          source: "test",
        },
      },
    }).reason,
    "EXECUTION_CONTRACT_UNAVAILABLE"
  );
});

test("missing acceptance obligations do not filter execution selection", () => {
  const noObligation = browserCase("no-obligation", {
    acceptanceObligationIds: [],
  });
  assert.deepEqual(
    selectMaterializedBrowserRuntimeCases(plan({
      browserCases: [noObligation],
    })).cases,
    [noObligation]
  );
});

test("execution selection does not bypass independent runtime safety blocking", () => {
  const unsafePersona = browserCase("unsafe-persona", {
    persona: "unauthenticated",
  });
  const selection = selectMaterializedBrowserRuntimeCases(plan({
    discoveryBrowserCases: [unsafePersona],
  }));

  assert.equal(selection.browserExecutionSelectedCount, 1);
  assert.match(
    getBrowserBlockReason(unsafePersona) ?? "",
    /Unsupported browser persona/
  );
});

test("mixed materialized lanes select the full five-case execution denominator without mutation", () => {
  const trusted = [browserCase("source-a"), browserCase("source-b")];
  const discovery = [
    browserCase("support-a", { executionPolicy: { lane: "DISCOVERY_ONLY" } }),
    browserCase("support-b", { executionPolicy: { lane: "DISCOVERY_ONLY" } }),
    browserCase("support-c", { executionPolicy: { lane: "DISCOVERY_ONLY" } }),
  ];
  const input = plan({
    browserCases: trusted,
    discoveryBrowserCases: discovery,
  });
  const before = structuredClone(input);
  const selection = selectMaterializedBrowserRuntimeCases(input);

  assert.equal(selection.materializedBrowserRuntimeUnitCount, 5);
  assert.equal(selection.browserExecutionSelectedCount, 5);
  assert.equal(selection.sourceProofRichDiagnosticLaneCount, 2);
  assert.equal(selection.discoverySupportDiagnosticLaneCount, 3);
  assert.deepEqual(selection.cases.map((item) => item.id), [
    "source-a",
    "source-b",
    "support-a",
    "support-b",
    "support-c",
  ]);
  assert.deepEqual(input, before);
});

test("an unset diagnostic selector retains every materialized case", () => {
  const input = plan({
    browserCases: [browserCase("A"), browserCase("B")],
    discoveryBrowserCases: [browserCase("C", {
      executionPolicy: { lane: "DISCOVERY_ONLY" },
    })],
  });

  const selection = withBrowserCaseId(undefined, () =>
    selectMaterializedBrowserRuntimeCases(input)
  );

  assert.deepEqual(selection.cases.map((testCase) => testCase.id), ["A", "B", "C"]);
  assert.deepEqual(selection.diagnosticExecutionFilter, {
    enabled: false,
    preFilterCount: 3,
    postFilterCount: 3,
  });
});

test("an exact diagnostic selector executes one matching materialized case without changing its authority", () => {
  const supportCase = browserCase("B", {
    executionPolicy: { lane: "DISCOVERY_ONLY" },
    acceptanceObligationIds: [],
  });
  const input = plan({
    browserCases: [browserCase("A")],
    discoveryBrowserCases: [supportCase, browserCase("C")],
  });
  const before = structuredClone(input);

  const selection = withBrowserCaseId("B", () =>
    selectMaterializedBrowserRuntimeCases(input)
  );

  assert.deepEqual(selection.cases, [supportCase]);
  assert.equal(selection.materializedBrowserRuntimeUnitCount, 3);
  assert.equal(selection.browserExecutionSelectedCount, 1);
  assert.deepEqual(selection.diagnosticExecutionFilter, {
    enabled: true,
    requestedCaseId: "B",
    preFilterCount: 3,
    postFilterCount: 1,
  });
  assert.equal(isOperationalDiscoverySupportUnit(selection.cases[0]!), true);
  assert.deepEqual(input, before);
});

test("an unknown diagnostic selector fails closed before browser execution", () => {
  assert.throws(
    () => withBrowserCaseId("Z", () =>
      selectMaterializedBrowserRuntimeCases(plan({
        browserCases: [browserCase("A"), browserCase("B")],
      }))
    ),
    /Requested browser case ID not found: Z/
  );
});

test("a duplicate diagnostic selector fails closed rather than choosing an arbitrary case", () => {
  assert.throws(
    () => withBrowserCaseId("A", () =>
      selectMaterializedBrowserRuntimeCases(plan({
        browserCases: [browserCase("A")],
        discoveryBrowserCases: [browserCase("A")],
      }))
    ),
    /Requested browser case ID ambiguous \(2 matches\): A/
  );
});
