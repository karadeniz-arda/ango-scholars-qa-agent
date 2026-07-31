
// One HTTP test
export type ApiTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  expect: { status: number; contentType?: string; notes?: string };
};

export type BrowserStep =
  | { action: "wait"; ms: number }
  | { action: "reload" }
  | { action: "setViewport"; width: number; height: number }
  | { action: "clickTopTab"; text: string }
  | { action: "selectRuntimeTopTab" }
  | {
      action: "openRuntimeControl";
      target: string;
    }
  | {
      action: "selectRuntimeFilterOption";
      queryKey: string;
      hint?: string;
    }
  | {
      action: "createDraftJobAndVerifyRedirect";
      origin: "jobs" | "all-jobs";
    }
  | { action: "clickButton"; text: string }
  | { action: "clickText"; text: string }
  | { action: "openMenu"; text: string }
  | { action: "selectOption"; text: string }
  | { action: "assertUrlContains"; text: string }
  | { action: "assertUrlNotContains"; text: string }
  | { action: "assertTextVisible"; text: string }
  | { action: "assertTextNotVisible"; text: string };

// One browser test
export type BrowserTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  goal: string;
  startRoute: string;
  successCriteria: string;

  /*
   * INVOICE_FIXTURE_POLICY_ENFORCEMENT_V1
   *
   * exact:
   *   The requested entity identity is part of
   *   the test oracle. Do not substitute another
   *   runtime record.
   *
   * compatible-state:
   *   A safe record in the same required runtime
   *   state may replace the candidate fixture.
   */
  runtimeFixturePolicy?:
    | "exact"
    | "compatible-state";

  /**
   * Acceptance criteria that the runner and evidence reviewer
   * can verify automatically.
   */
  automatedChecks?: string[];

  /**
   * Acceptance criteria that require human verification and
   * must not downgrade an otherwise valid automated result.
   */
  manualChecks?: string[];

  /**
   * Runtime records, lifecycle states, or permission fixtures
   * required before the case can execute.
   */
  fixtureRequirements?: string[];

  steps?: BrowserStep[];
};

// Full plan for one ticket
export type TestPlan = {
  issueKey: string;
  summary: string;
  apiCases: ApiTestCase[];
  browserCases: BrowserTestCase[];
};
