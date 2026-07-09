import fs from "node:fs";
import type { TestPlan } from "../planner/types.js";

type TestResult = {
  id: string;
  status: string;
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
      result.notes ?? "",
    ];
  });

  const tableRows = rows
    .map((row) => `| ${row.map(escapeTableCell).join(" |")} |`)
    .join("\n");

  return `## API Results

| Case ID | Persona | Method | Original Path | Resolved Path | Expected | Actual | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
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
      testCase?.startRoute ?? "",
      result.status,
      result.evidence ?? result.notes ?? "",
      testCase?.goal ?? "",
    ];
  });

  const tableRows = rows
    .map((row) => `| ${row.map(escapeTableCell).join(" |")} |`)
    .join("\n");

  return `## Browser Results

| Case ID | Persona | Start Route | Result | Evidence / Notes | Goal |
| --- | --- | --- | --- | --- | --- |
${tableRows}
`;
}

function renderObservations(apiResults: TestResult[] = [], browserResults: TestResult[] = []) {
  const observations: string[] = [];

  if (apiResults.length > 0) {
    observations.push("- API cases marked **PASS** matched the expected HTTP status.");
    observations.push("- API cases marked **FAIL** reached the endpoint but did not match the expected status or failed during execution.");
    observations.push("- API cases marked **BLOCKED** were not executed because route, setup data, body, persona, or required context was missing.");
  }

  if (browserResults.length > 0) {
    observations.push("- Browser cases marked **PASS** completed all generic browser assertions successfully.");
    observations.push("- Browser cases marked **FAIL** reached the target page but at least one generic browser assertion failed.");
    observations.push("- Browser cases marked **DONE** completed navigation/actions and screenshot capture without explicit assertions.");
    observations.push("- Browser cases marked **BLOCKED** were not executed because route, persona, setup data, or required context was missing.");
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

${renderApiTable(plan, apiResults)}

${renderBrowserTable(plan, browserResults)}

## Observations

${renderObservations(apiResults, browserResults)}
`;

  fs.writeFileSync("qa-results/report.md", report, "utf8");

  console.log("Report saved to qa-results/report.md");
}