
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
  | { action: "setViewport"; width: number; height: number }
  | { action: "clickTopTab"; text: string }
  | { action: "clickButton"; text: string }
  | { action: "clickText"; text: string }
  | { action: "assertTextVisible"; text: string }
  | { action: "assertTextNotVisible"; text: string };

// One browser test
export type BrowserTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  goal: string;
  startRoute: string;
  successCriteria: string;
  steps?: BrowserStep[];
};

// Full plan for one ticket
export type TestPlan = {
  issueKey: string;
  summary: string;
  apiCases: ApiTestCase[];
  browserCases: BrowserTestCase[];
};
