import assert from "node:assert/strict";
import test from "node:test";

import { attemptDeterministicBrowserPass } from "./browser-deterministic-pass-attempt.js";

test("transports exact GROUP_ONLY scope even when no PASS attempt can run", () => {
  const executionVerdictScope = {
    executionObligationIds: ["obligation-a"],
    verdictScopeObligationIds: ["obligation-a", "obligation-b"],
    verdictAuthority: "GROUP_ONLY" as const,
  };
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    notes: [],
  };
  const attempt = attemptDeterministicBrowserPass({
    testCase: {
      id: "case-a",
      persona: "company_admin",
      goal: "Observe A.",
      startRoute: "/company/a",
      successCriteria: "A.",
      acceptanceObligationIds: ["obligation-a"],
      executionVerdictScope,
    },
    obligationLedger: undefined,
    browserObligationBindings: undefined,
    currentResult,
    localStatePassProofs: [],
    sourceBoundAssertionSetPassProofs: [],
    deterministicPassRuntimeContext: {
      fixtureStatus: { status: "AVAILABLE", value: "NOT_REQUIRED", source: "test" },
      acceptedRoutePath: { status: "AVAILABLE", value: "/company/a", source: "test" },
      targetVerified: { status: "AVAILABLE", value: true, source: "test" },
      requiredExecutionCompleted: { status: "AVAILABLE", value: true, source: "test" },
      safetyViolation: { status: "AVAILABLE", value: false, source: "test" },
      testDataIssue: { status: "AVAILABLE", value: false, source: "test" },
      productNonGetCount: { status: "AVAILABLE", value: 0, source: "test" },
      persistenceViolation: { status: "AVAILABLE", value: false, source: "test" },
    },
  });
  assert.equal(attempt.status, "NOT_ATTEMPTED");
  assert.deepEqual(currentResult.executionVerdictScope, executionVerdictScope);
  assert.equal(currentResult.status, "MANUAL_REQUIRED");
});
