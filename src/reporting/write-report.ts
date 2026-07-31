import fs from "node:fs";
import type { TestPlan } from "../planner/types.js";
import { buildPolishedReportSections } from "./failure-learning.js";
import {
  buildProductFindings,
  formatProductFindingsMarkdown,
} from "./product-findings.js";

type EvidenceReviewResult = {
  verdict: string;
  confidence: string;
  rationale: string;
  visibleEvidence?: string[];
  recommendedStatus?: string;
};

type VideoEvidenceReviewResult = {
  verdict: string;
  confidence: string;
  rationale: string;
  resolvedFailures?: string[];
  unresolvedFailures?: string[];
  temporalEvidence?: string[];
  framePaths?: string[];
  recommendedStatus?: string;
  resolvedByVideo?: boolean;
};

type BrowserEvidenceIdentity = {
  entityType: string;
  requestedIdentity: string | null;
  runtimeIdentity: string | null;
  handoffIdentity: string | null;
  substituted: boolean;
  policy: string | null;
  selectionSource: string;
};

type BrowserEvidenceCheckpoint = {
  stepIndex: number;
  action: string;
  label: string;
  note: string;
  screenshotPath: string;
  url: string;
  identity?: BrowserEvidenceIdentity;
};

type BrowserDeterministicEvidence = {
  stepIndex: number;
  action: string;
  expected: string;
  actualUrl: string;
  passed: boolean;
  note: string;
};

type TestResult = {
  id: string;
  status: string;
  reasonCategory?: string;
  notes?: string;
  evidence?: string;
  startRoute?: string;
  videoPath?: string;
  checkpointEvidence?:
    BrowserEvidenceCheckpoint[];
  deterministicEvidence?:
    BrowserDeterministicEvidence[];
  evidenceReview?: EvidenceReviewResult | null;
  videoEvidenceReview?:
    | VideoEvidenceReviewResult
    | null;
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

function formatStringList(
  values: string[] | undefined
): string {
  if (!values || values.length === 0) {
    return "none";
  }

  return values.join("; ");
}

function formatCheckpointIdentity(
  identity:
    BrowserEvidenceIdentity | undefined
): string {
  if (!identity) {
    return "";
  }

  return [
    `entity=${identity.entityType}`,
    `requested=${
      identity.requestedIdentity ??
      "none"
    }`,
    `runtime=${
      identity.runtimeIdentity ??
      "none"
    }`,
    `handoff=${
      identity.handoffIdentity ??
      "none"
    }`,
    `substituted=${
      identity.substituted
    }`,
    `policy=${
      identity.policy ?? "none"
    }`,
    `source=${
      identity.selectionSource
    }`,
  ].join(", ");
}

function renderCompactBrowserEvidence(
  result: TestResult
): string {
  if (
    result.evidenceReview &&
    result.videoEvidenceReview
  ) {
    return (
      `Screenshot: ` +
      `${result.evidenceReview.verdict} ` +
      `(${result.evidenceReview.confidence})` +
      ` → Video: ` +
      `${result.videoEvidenceReview.verdict} ` +
      `(${result.videoEvidenceReview.confidence})`
    );
  }

  if (result.evidenceReview) {
    return (
      `${result.evidenceReview.verdict} ` +
      `(${result.evidenceReview.confidence})`
    );
  }

  if (result.videoEvidenceReview) {
    return (
      `Video: ` +
      `${result.videoEvidenceReview.verdict} ` +
      `(${result.videoEvidenceReview.confidence})`
    );
  }

  if (result.status === "PASS") {
    return "Assertions passed";
  }

  return result.notes ?? "";
}

function renderBrowserEvidenceDetails(
  browserResults: TestResult[] = []
): string {
  const detailedResults =
    browserResults.filter(
      (result) =>
        result.status !== "PASS" ||
        Boolean(
          result.checkpointEvidence?.length
        ) ||
        Boolean(
          result.deterministicEvidence?.length
        )
    );

  if (detailedResults.length === 0) {
    return `## Browser Evidence Details

No non-pass browser cases for this run.
`;
  }

  const sections = detailedResults.map(
    (result) => {
      const lines: string[] = [
        `### ${result.id}`,
        "",
        `- **Runner Result:** ${result.status}`,
      ];

      if (result.reasonCategory) {
        lines.push(
          `- **Reason Category:** ` +
            result.reasonCategory
        );
      }

      if (result.startRoute) {
        lines.push(
          `- **Start Route:** ` +
            result.startRoute
        );
      }

      if (result.evidenceReview) {
        const review = result.evidenceReview;

        lines.push(
          `- **Screenshot Verdict:** ` +
            review.verdict
        );

        lines.push(
          `- **Screenshot Confidence:** ` +
            review.confidence
        );

        lines.push(
          `- **Screenshot Recommendation:** ` +
            (
              review.recommendedStatus ??
              "none"
            )
        );

        lines.push(
          `- **Screenshot Rationale:** ` +
            review.rationale
        );

        lines.push(
          `- **Visible Evidence:** ` +
            formatStringList(
              review.visibleEvidence
            )
        );
      }

      if (
        result.checkpointEvidence &&
        result.checkpointEvidence.length > 0
      ) {
        lines.push(
          `- **Evidence Checkpoints:** ` +
            result.checkpointEvidence
              .map(
                (checkpoint) =>
                  `step ${checkpoint.stepIndex} ` +
                  `(${checkpoint.label})` +
                  (
                    checkpoint.identity
                      ? ` [${
                          formatCheckpointIdentity(
                            checkpoint.identity
                          )
                        }]`
                      : ""
                  ) +
                  `: ${checkpoint.screenshotPath}`
              )
              .join("; ")
        );
      }

      if (
        result.deterministicEvidence &&
        result.deterministicEvidence.length > 0
      ) {
        lines.push(
          `- **Deterministic URL Evidence:** ` +
            result.deterministicEvidence
              .map(
                (item) =>
                  `step ${item.stepIndex} ` +
                  `${item.action} ` +
                  `"${item.expected}" = ` +
                  `${
                    item.passed
                      ? "PASS"
                      : "FAIL"
                  } ` +
                  `(actual: ${item.actualUrl})`
              )
              .join("; ")
        );
      }

      if (result.videoPath) {
        lines.push(
          `- **Video:** ${result.videoPath}`
        );
      }

      if (result.videoEvidenceReview) {
        const review =
          result.videoEvidenceReview;

        lines.push(
          `- **Video Verdict:** ` +
            review.verdict
        );

        lines.push(
          `- **Video Confidence:** ` +
            review.confidence
        );

        lines.push(
          `- **Video Recommendation:** ` +
            (
              review.recommendedStatus ??
              "none"
            )
        );

        lines.push(
          `- **Resolved By Video:** ` +
            String(
              review.resolvedByVideo ??
                false
            )
        );

        lines.push(
          `- **Video Rationale:** ` +
            review.rationale
        );

        lines.push(
          `- **Resolved Failures:** ` +
            formatStringList(
              review.resolvedFailures
            )
        );

        lines.push(
          `- **Unresolved Failures:** ` +
            formatStringList(
              review.unresolvedFailures
            )
        );

        lines.push(
          `- **Temporal Evidence:** ` +
            formatStringList(
              review.temporalEvidence
            )
        );

        lines.push(
          `- **Video Frames:** ` +
            formatStringList(
              review.framePaths
            )
        );
      }

      if (result.evidence) {
        const structuredPrefixes = [
          "Evidence review verdict:",
          "Evidence review confidence:",
          "Evidence review rationale:",
          "Visible evidence:",
          "Evidence review recommended status:",
          "Video fallback triggered:",
          "Video review verdict:",
          "Video review confidence:",
          "Video review rationale:",
          "Resolved failures:",
          "Unresolved failures:",
          "Temporal evidence:",
          "Frame paths:",
          "Video recommended status:",
          "Resolved by video:",
        ];

        const evidenceItems =
          result.evidence
            .split(" | ")
            .filter(Boolean)
            .filter(
              (item) =>
                !structuredPrefixes.some(
                  (prefix) =>
                    item.startsWith(prefix)
                )
            )
            .map(
              (item) => `- ${item}`
            )
            .join("\n");

        lines.push(
          "",
          "<details>",
          "<summary>Full execution evidence</summary>",
          "",
          evidenceItems,
          "",
          "</details>"
        );
      }

      return lines.join("\n");
    }
  );

  return `## Browser Evidence Details

${sections.join("\n\n")}
`;
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
- **MUTATION_SAFETY_GUARD:** A browser state-changing action was intentionally blocked because QA_ALLOW_BROWSER_MUTATIONS is disabled.
- **CLEANUP_FAILED:** The Jira-scoped product assertion may have completed, but deletion of the exact QA-created resource failed and requires attention.
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
    const testCase = browserCases.find(
      (item: any) =>
        item.id === result.id
    );

    return [
      result.id,
      testCase?.persona ?? "",
      result.startRoute ??
        testCase?.startRoute ??
        "",
      result.status,
      result.reasonCategory ?? "",
      renderCompactBrowserEvidence(
        result
      ),
      testCase?.goal ?? "",
    ];
  });

  const tableRows = rows
    .map(
      (row) =>
        `| ${row
          .map(escapeTableCell)
          .join(" |")} |`
    )
    .join("\n");

  return `## Browser Results

| Case ID | Persona | Start Route | Result | Reason Category | Evidence Summary | Goal |
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
    observations.push("- Browser result summaries are shown in the main table. Detailed screenshot, video, and execution evidence is included in **Browser Evidence Details**.");
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
  const productFindings =
  buildProductFindings({
    issueId,
    plan,
    browserResults,
  });

const productFindingsMarkdown =
  formatProductFindingsMarkdown(
    productFindings
  );
  const report = `# QA Agent Report

## Issue

- **Issue:** ${issueId}
- **Plan Issue Key:** ${(plan as any).issueKey ?? issueId}
- **Summary:** ${(plan as any).summary ?? ""}
- **Generated At:** ${now}

## Plan Notes

${(plan as any).notes ?? "No plan-level notes."}

${buildPolishedReportSections({
  issueKey: issueId,
  apiResults,
  browserResults,
})}
${productFindingsMarkdown}

## Result Summary

${renderStatusSummary("API Summary", apiResults)}

${renderStatusSummary("Browser Summary", browserResults)}

${renderResultSemantics()}

${renderApiTable(plan, apiResults)}

${renderBrowserTable(plan, browserResults)}

${renderBrowserEvidenceDetails(browserResults)}

## Observations

${renderObservations(apiResults, browserResults)}
`;

  fs.writeFileSync("qa-results/report.md", report, "utf8");

  console.log("Report saved to qa-results/report.md");
}