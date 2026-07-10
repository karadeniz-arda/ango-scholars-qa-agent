import fs from "node:fs";
import type { TestPlan } from "../planner/types.js";

type TestResult = {
  id: string;
  status: string;
  reasonCategory?: string;
  notes?: string;
  evidence?: string;
};

type WriteReportInput = {
  issueId: string;
  plan: TestPlan;
  apiResults?: TestResult[];
  browserResults?: TestResult[];
};

function escapeTableCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function countByStatus(results: TestResult[] = []) {
  return results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
}

function renderStatusSummary(title: string, results: TestResult[] = []) {
  const counts = countByStatus(results);

  if (results.length === 0) {
    return `### ${title}\n\nNo results.\n`;
  }

  const lines = Object.entries(counts)
    .map(([status, count]) => `- **${status}:** ${count}`)
    .join("\n");

  return `### ${title}\n\n${lines}\n`;
}

function renderResultSemantics() {
  return `## Result Semantics

- **PASS:** The test executed successfully and all explicit expectations were verified.
- **FAIL:** The target page or endpoint was reached, but the expected product behavior was not observed.
- **BLOCKED:** The test could not be executed because route, persona, auth, setup data, or environment context was missing.
- **MANUAL_REQUIRED:** The test needs human verification because it is destructive, ambiguous, visual-only, or not reliably automatable yet.
- **ERROR:** The agent or runtime failed unexpectedly.

### Reason Categories

- **ASSERTIONS_PASSED:** All explicit browser assertions passed.
- **PRODUCT_ASSERTION_FAILED:** The page or endpoint was reached, but an expected product behavior was not observed.
- **EXPECTED_STATUS_MATCHED:** API response status matched the expected status.
- **API_EXPECTATION_FAILED:** API response was received but did not match the expected product/API expectation.
- **MISSING_API_CONTEXT:** API path, setup data, request body, or API contract is missing.
- **MISSING_BROWSER_ROUTE:** Browser route could not be resolved.
- **AUTOMATION_LIMITATION:** The agent reached the page but could not safely or reliably automate/verify the required interaction.
- **NO_STRUCTURED_STEPS:** The browser case does not include executable structured steps.
- **NO_EXPLICIT_ASSERTIONS:** The browser case executed actions but did not verify explicit expectations.
- **AGENT_RUNTIME_ERROR:** The agent/runtime failed unexpectedly.

`;
}

function renderApiTable(plan: any, apiResults: TestResult[] = []) {
  if (apiResults.length === 0) {
    return `## API Results\n\nNo API results.\n`;
  }

  const rows = apiResults.map((result: any) => {
    return [
      result.id,
      result.persona ?? "",
      result.method ?? "",
      result.originalPath ?? "",
      result.resolvedPath ?? "",
      result.expectedStatus ?? "",
      result.actualStatus ?? "",
      result.status,
      result.reasonCategory ?? "",
      result.notes ?? "",
    ];
  });

  const tableRows = rows
    .map((row) => `| ${row.map(escapeTableCell).join(" |")} |`)
    .join("\n");

  return `## API Results

| Case ID | Persona | Method | Original Path | Resolved Path | Expected | Actual | Result | Reason Category | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${tableRows}
`;
}

function renderBrowserTable(plan: any, browserResults: TestResult[] = []) {
  if (browserResults.length === 0) {
    return `## Browser Results\n\nNo browser results for this run.\n`;
  }

  const browserCases = plan.browserCases ?? [];

  const rows = browserResults.map((result) => {
    const testCase = browserCases.find((item: any) => item.id === result.id);

    return [
      result.id,
      testCase?.persona ?? "",
      (result as any).startRoute ?? testCase?.startRoute ?? "",
      result.status,
      result.reasonCategory ?? "",
      result.evidence ?? result.notes ?? "",
      testCase?.goal ?? "",
    ];
  });

  const tableRows = rows
    .map((row) => `| ${row.map(escapeTableCell).join(" |")} |`)
    .join("\n");

  return `## Browser Results

| Case ID | Persona | Start Route | Result | Reason Category | Evidence / Notes | Goal |
| --- | --- | --- | --- | --- | --- | --- |
${tableRows}
`;
}

function renderObservations(apiResults: TestResult[] = [], browserResults: TestResult[] = []) {
  const observations: string[] = [];

  if (apiResults.length > 0) {
    observations.push("- API cases marked **PASS** matched the expected HTTP status.");
    observations.push("- API cases marked **FAIL** reached the endpoint but did not match the expected product/API expectation.");
    observations.push("- API cases marked **BLOCKED** were not executed because route, setup data, body, persona, or required context was missing.");
    observations.push("- API cases marked **ERROR** failed because of an agent/runtime execution problem.");
  }

  if (browserResults.length > 0) {
    observations.push("- Browser cases marked **PASS** completed all generic browser assertions successfully.");
    observations.push("- Browser cases marked **FAIL** reached the target page but at least one expected product assertion failed.");
    observations.push("- Browser cases marked **MANUAL_REQUIRED** reached a point where human verification is needed because the action is not safely or reliably automatable yet.");
    observations.push("- Browser cases marked **BLOCKED** were not executed because route, persona, setup data, or required context was missing.");
    observations.push("- Browser cases marked **ERROR** failed because of an agent/runtime execution problem.");
    observations.push("- Browser assertion details are included in the **Evidence / Notes** column.");
  }

  if (apiResults.length === 0 && browserResults.length === 0) {
    observations.push("- No execution results were provided for this report.");
  }

  return observations.join("\n");
}

export function writeReport({
  issueId,
  plan,
  apiResults = [],
  browserResults = [],
}: WriteReportInput) {
  fs.mkdirSync("qa-results", { recursive: true });

  const now = new Date().toISOString();

  const report = `# QA Agent Report

## Issue

- **Issue:** ${issueId}
- **Plan Issue Key:** ${(plan as any).issueKey ?? issueId}
- **Summary:** ${(plan as any).summary ?? ""}
- **Generated At:** ${now}

## Plan Notes

${(plan as any).notes ?? "No plan-level notes."}

## Result Summary

${renderStatusSummary("API Summary", apiResults)}

${renderStatusSummary("Browser Summary", browserResults)}

${renderResultSemantics()}

${renderApiTable(plan, apiResults)}

${renderBrowserTable(plan, browserResults)}

## Observations

${renderObservations(apiResults, browserResults)}
`;

  fs.writeFileSync("qa-results/report.md", report, "utf8");

  console.log("Report saved to qa-results/report.md");
}