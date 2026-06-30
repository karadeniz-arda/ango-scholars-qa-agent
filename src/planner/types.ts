
// One HTTP test
export type ApiTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  expect: { status: number; contentType?: string; notes?: string };
};

// One browser test
export type BrowserTestCase = {
  id: string;
  persona: "talent" | "company_admin";
  goal: string;
  startRoute: string;
  successCriteria: string;
};

// Full plan for one ticket
export type TestPlan = {
  issueKey: string;
  summary: string;
  apiCases: ApiTestCase[];
  browserCases: BrowserTestCase[];
};
