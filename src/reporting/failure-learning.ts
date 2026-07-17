type QaResult = {
  id?: string;
  persona?: string;
  method?: string;
  status?: string;
  reasonCategory?: string;
  notes?: string;
  originalPath?: string;
  resolvedPath?: string;
  expectedStatus?: string | number;
  actualStatus?: string | number;
  successSignal?: string;
  successSignalReached?: boolean;
  evidence?: string | string[];
};

type FailureLearning = {
  title: string;
  severity: "high" | "medium" | "low";
  category:
    | "api_context"
    | "api_expectation"
    | "browser_route"
    | "browser_action"
    | "browser_assertion"
    | "safety_guard"
    | "unknown";
  productRisk:
    | "expected_blocked"
    | "agent_limitation"
    | "possible_product_bug"
    | "needs_review";
  suggestedCodeAreas: string[];
  evidence: string[];
  recommendation: string;
};

function lower(value: any): string {
  return String(value || "").toLowerCase();
}

function compact(value: any): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resultLabel(result: QaResult): string {
  const bits = [
    result.id,
    result.persona,
    result.method,
    result.resolvedPath,
    result.status,
  ].filter(Boolean);

  return bits.join(" | ");
}

function resultText(result: QaResult): string {
  return lower(
    [
      result.id,
      result.persona,
      result.method,
      result.status,
      result.reasonCategory,
      result.notes,
      result.evidence,
      result.originalPath,
      result.resolvedPath,
      result.expectedStatus,
      result.actualStatus,
    ].join(" ")
  );
}

function isMutatingBlocked(result: QaResult): boolean {
  const method = String(result.method || "").toUpperCase();
  const text = resultText(result);

  return (
    result.status === "BLOCKED" &&
    ["POST", "PATCH", "PUT", "DELETE"].includes(method) &&
    text.includes("mutating api case")
  );
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function summarizeStatuses(results: QaResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>((acc, result) => {
    const status = String(result.status || "UNKNOWN");
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function formatStatusCounts(counts: Record<string, number>): string {
  const preferredOrder = ["PASS", "FAIL", "BLOCKED", "MANUAL_REQUIRED", "ERROR"];

  return preferredOrder
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${status}`)
    .join(" / ");
}

export function buildFailureLearnings(
  apiResults: QaResult[] = [],
  browserResults: QaResult[] = []
): FailureLearning[] {
  const learnings: FailureLearning[] = [];

  const mutatingBlocked = apiResults.filter(isMutatingBlocked);

  if (mutatingBlocked.length > 0) {
    learnings.push({
  title: "Mutating API cases are safely blocked",
  severity: "low",
  category: "safety_guard",
  productRisk: "expected_blocked",
  suggestedCodeAreas: ["src/agents/api/run-api-cases.ts"],
  evidence: mutatingBlocked.slice(0, 5).map(resultLabel),
  recommendation:
    "Keep this as expected behavior. Only enable QA_ALLOW_API_MUTATIONS=true with isolated test data.",
});
  }

    const missingApiContext = apiResults.filter((result) => {
    if (isMutatingBlocked(result)) return false;

    const text = resultText(result);

    return (
      result.status === "BLOCKED" &&
      (text.includes("unresolved setup data") ||
        text.includes("missing_api_context") ||
        text.includes("unknown setup data") ||
        text.includes("real test data is needed"))
    );
  });

  if (missingApiContext.length > 0) {
    learnings.push({
      title: "Some API cases still need runtime context resolvers",
      severity: "high",
      category: "api_context",
      productRisk: "agent_limitation",
      suggestedCodeAreas: [
        "src/agents/api/run-api-cases.ts",
        "src/agents/api/setup-resolver.ts",
      ],
      evidence: missingApiContext.slice(0, 5).map(resultLabel),
      recommendation:
        "Add or improve runtime resolvers for the missing path params before treating these as product failures.",
    });
  }

  const apiExpectationFailures = apiResults.filter((result) => {
    return result.status === "FAIL" || result.reasonCategory === "API_EXPECTATION_FAILED";
  });

  if (apiExpectationFailures.length > 0) {
    
    const authLike = apiExpectationFailures.some((result) =>
      hasAny(lower(`${result.actualStatus} ${result.notes} ${result.resolvedPath}`), [
        "401",
        "403",
        "forbidden",
        "permission",
      ])
    );

    learnings.push({
        productRisk: authLike ? "agent_limitation" : "needs_review",
suggestedCodeAreas: [
  "src/planner/plan-from-issue.ts",
  "src/agents/api/run-api-cases.ts",
],
      title: authLike
        ? "API expectation mismatch may be auth/persona-context related"
        : "API expectation mismatch needs contract review",
      severity: "medium",
      category: "api_expectation",
      evidence: apiExpectationFailures.slice(0, 5).map(resultLabel),
      recommendation: authLike
        ? "Check whether the persona token matches the resolved entity id. Prefer own-context resolvers such as /talents/me before marking this as product bug."
        : "Compare planner expected status with actual API contract. Update planner rules if the endpoint behavior is valid.",
    });
  }

  const missingBrowserRoutes = browserResults.filter((result) => {
    const text = lower(`${result.reasonCategory} ${result.notes}`);
    return (
      result.status === "BLOCKED" &&
      (text.includes("browser startroute is unknown") ||
        text.includes("route context is needed") ||
        text.includes("missing_browser_route") ||
        text.includes("irrelevant_browser_route") ||
        text.includes("browser relevance gate rejected")
      )
    )
  });

  if (missingBrowserRoutes.length > 0) {
    
    learnings.push({
        productRisk: "agent_limitation",
suggestedCodeAreas: [
  "src/agents/browser/browser-route-resolver.ts",
  "src/discovery/ui-route-catalog.ts",
],
      title: "Browser route resolver needs deeper route/context support",
      severity: "high",
      category: "browser_route",
      evidence: missingBrowserRoutes.slice(0, 5).map(resultLabel),
      recommendation:
        "Add route/context resolver for deep talent contract, assessment, or modal flows. Keep these BLOCKED until the route is known.",
    });
  }

  const automationLimits = browserResults.filter((result) => {
    const text = lower(`${result.reasonCategory} ${result.notes}`);
    return (
      result.status === "MANUAL_REQUIRED" ||
      text.includes("automation limitation") ||
      text.includes("manual verification")
    );
  });

  if (automationLimits.length > 0) {
    learnings.push({
        productRisk: "agent_limitation",
suggestedCodeAreas: [
  "src/agents/browser/generic-browser-actions.ts",
  "src/agents/browser/run-browser-cases.ts",
],
      title: "Browser generic actions need flow-specific openers",
      severity: "medium",
      category: "browser_action",
      evidence: automationLimits.slice(0, 5).map(resultLabel),
      recommendation:
        "For modal/form assertions, add generic openers such as Add/Edit/View details before checking field labels. Do not mark these as product bugs automatically.",
    });
  }

  const browserAssertionFailures = browserResults.filter((result) => {
    const text = resultText(result);
    return (
      result.status === "FAIL" &&
      !text.includes("manual verification") &&
      !text.includes("automation limitation")
    );
  });

      if (browserAssertionFailures.length > 0) {
    const screenshotCopyFailures = browserAssertionFailures.filter((result) => {
      const text = resultText(result);

      return hasAny(text, [
        'assert not visible "screenshot": fail',
        'assert not visible "screenshot required": fail',
        'assert not visible "screenshot optional": fail',
        'assert not visible "screenshot requirement": fail',
        "legacy screenshot copy",
        "old screenshot copy",
        "unexpected screenshot copy",
      ]);
    });

    const otherAssertionFailures = browserAssertionFailures.filter(
      (result) => !screenshotCopyFailures.includes(result)
    );

    if (screenshotCopyFailures.length > 0) {
      learnings.push({
        title: "Browser detected possible legacy Screenshot UI copy",
        severity: "medium",
        category: "browser_assertion",
        productRisk: "possible_product_bug",
        suggestedCodeAreas: [
          "product UI copy",
          "src/agents/browser/run-browser-cases.ts",
        ],
        evidence: screenshotCopyFailures.slice(0, 5).map(resultLabel),
        recommendation:
          "Check screenshot evidence. If the legacy Screenshot copy is visible in the relevant UI area, report it as a possible product issue. If the text belongs to an unrelated area, scope the negative assertion more narrowly.",
      });
    }

    if (otherAssertionFailures.length > 0) {
      learnings.push({
        title: "Browser assertion failures need review",
        severity: "medium",
        category: "browser_assertion",
        productRisk: "needs_review",
        suggestedCodeAreas: [
          "src/agents/browser/run-browser-cases.ts",
          "src/agents/browser/generic-browser-actions.ts",
        ],
        evidence: otherAssertionFailures.slice(0, 5).map(resultLabel),
        recommendation:
          "Review screenshots and trace before deciding whether the failure is a product bug, missing setup data, or an assertion scope issue.",
      });
    }
  }

  return learnings;
}

export function formatFailureLearningsMarkdown(
  learnings: FailureLearning[]
): string {
  if (learnings.length === 0) {
    return [
      "## Failure Learning",
      "",
      "No failure-learning items were detected in this run.",
      "",
    ].join("\n");
  }

  const lines = ["## Failure Learning", ""];

  const ranked = learnings
  .filter((learning) => learning.productRisk !== "expected_blocked")
  .sort((a, b) => {
    const severityRank = { high: 3, medium: 2, low: 1 };
    return severityRank[b.severity] - severityRank[a.severity];
  })
  .slice(0, 5);

if (ranked.length > 0) {
  lines.push("### Next Agent Improvements");
  lines.push("");

  for (const [index, learning] of ranked.entries()) {
    lines.push(
      `${index + 1}. **${learning.title}** — ${learning.recommendation}`
    );
  }

  lines.push("");
}

  for (const learning of learnings) {
    lines.push(`### ${learning.title}`);
    lines.push("");
    lines.push(`- Severity: ${learning.severity}`);
lines.push(`- Category: ${learning.category}`);
lines.push(`- Product Risk: ${learning.productRisk}`);
lines.push(`- Suggested Code Area: ${learning.suggestedCodeAreas.join(", ")}`);
lines.push(`- Recommendation: ${learning.recommendation}`);
    if (learning.evidence.length > 0) {
      lines.push("- Evidence:");
      for (const evidence of learning.evidence) {
        lines.push(`  - ${compact(evidence)}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function formatPolishedSummaryMarkdown(args: {
  issueKey?: string;
  apiResults?: QaResult[];
  browserResults?: QaResult[];
}): string {
  const apiResults = args.apiResults || [];
  const browserResults = args.browserResults || [];

  const apiCounts = summarizeStatuses(apiResults);
  const browserCounts = summarizeStatuses(browserResults);

  const lines = [
    "## Executive Summary",
    "",
    `Issue: ${args.issueKey || "UNKNOWN"}`,
    "",
    `- API: ${formatStatusCounts(apiCounts) || "No API cases"}`,
    `- Browser: ${formatStatusCounts(browserCounts) || "No browser cases"}`,
    "",
  ];

  const apiPassCount = apiCounts.PASS || 0;
  const browserPassCount = browserCounts.PASS || 0;

  lines.push("## What worked");
  lines.push("");

  if (apiPassCount > 0) {
    lines.push(`- API runner executed ${apiPassCount} passing case(s).`);
  }

  if (browserPassCount > 0) {
    lines.push(`- Browser runner executed ${browserPassCount} passing case(s) with screenshot/trace evidence.`);
  }

  if ((apiCounts.BLOCKED || 0) > 0) {
    lines.push("- Mutating or missing-context API cases were blocked instead of producing false product failures.");
  }

  lines.push("");

  return lines.join("\n");
}

export function buildPolishedReportSections(args: {
  issueKey?: string;
  apiResults?: QaResult[];
  browserResults?: QaResult[];
}): string {
  const apiResults = args.apiResults || [];
  const browserResults = args.browserResults || [];
  const learnings = buildFailureLearnings(apiResults, browserResults);

  const summaryArgs: {
    issueKey?: string;
    apiResults?: QaResult[];
    browserResults?: QaResult[];
  } = {
    apiResults,
    browserResults,
  };

  if (args.issueKey) {
    summaryArgs.issueKey = args.issueKey;
  }

  return [
    formatPolishedSummaryMarkdown(summaryArgs),
    formatFailureLearningsMarkdown(learnings),
  ].join("\n");
}