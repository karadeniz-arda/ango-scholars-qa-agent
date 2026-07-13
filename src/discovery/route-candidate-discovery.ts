export type RouteConfidence = "high" | "medium" | "low";

export type RouteCandidate = {
  route: string;
  confidence: RouteConfidence;
  source: string;
  reason: string;
};

const confidenceScore: Record<RouteConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function normalizeRoute(route: string): string {
  return route.trim().replace(/["'`),.;]+$/, "");
}

function isConcreteExecutableRoute(route: string): boolean {
  if (!route.startsWith("/")) return false;

  if (
    route === "UNKNOWN" ||
    route.includes("UNKNOWN") ||
    route.includes("{") ||
    route.includes("}")
  ) {
    return false;
  }

  return (
    route.startsWith("/company") ||
    route.startsWith("/talent") ||
    route.startsWith("/admin")
  );
}

function uniqByRoute(candidates: RouteCandidate[]): RouteCandidate[] {
  const seen = new Map<string, RouteCandidate>();

  for (const candidate of candidates) {
    const existing = seen.get(candidate.route);

    if (!existing) {
      seen.set(candidate.route, candidate);
      continue;
    }

    if (
      confidenceScore[candidate.confidence] >
      confidenceScore[existing.confidence]
    ) {
      seen.set(candidate.route, candidate);
    }
  }

  return [...seen.values()];
}

function collectFullText(plan: any, testCase: any): string {
  return [
    plan?.issueKey,
    plan?.summary,
    plan?.notes,
    collectCaseText(testCase),
  ]
    .filter(Boolean)
    .join("\n");
}

function collectCaseText(testCase: any): string {
  const stepsText = Array.isArray(testCase?.steps)
    ? testCase.steps
        .map((step: any) =>
          [step.action, step.text, step.width, step.height]
            .filter((value) => value !== undefined && value !== null)
            .join(" ")
        )
        .join(" ")
    : "";

  return [
    testCase?.id,
    testCase?.persona,
    testCase?.goal,
    testCase?.startRoute,
    testCase?.successCriteria,
    stepsText,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractLiteralRoutes(text: string): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];

  const routeRegex =
    /(?:^|[\s"'`(])((?:\/(?:company|talent|admin)[A-Za-z0-9_?&=/:{}.-]*))/g;

  for (const match of text.matchAll(routeRegex)) {
    const route = normalizeRoute(match[1] ?? "");

    if (!route) continue;

    candidates.push({
      route,
      confidence: route.includes("{") ? "low" : "high",
      source: "literal-route",
      reason:
        "A concrete browser route-like string was found in Jira/GitHub/planner context.",
    });
  }

  return candidates;
}

function inferFeatureAreaRoutes(testCase: any): RouteCandidate[] {
  const caseText = collectCaseText(testCase);
  const lower = caseText.toLowerCase();
  const candidates: RouteCandidate[] = [];

  const isCompanyPersona = testCase?.persona === "company_admin";
  const isTalentPersona = testCase?.persona === "talent";

  const isWorkSetupContext =
    lower.includes("work setups") ||
    lower.includes("work setup") ||
    lower.includes("worksetups") ||
    lower.includes("worksetup") ||
    lower.includes("document requirement") ||
    lower.includes("manager approval") ||
    lower.includes("require approval");

  const isJobWizardContext =
    lower.includes("job wizard") ||
    lower.includes("job setup") ||
    lower.includes("attach work") ||
    lower.includes("selected setups");

  const isJobDetailsContext =
    lower.includes("job details") ||
    lower.includes("hired section") ||
    lower.includes("hired table") ||
    lower.includes("applicants") ||
    lower.includes("review modal") ||
    lower.includes("pending review") ||
    lower.includes("approve/reject") ||
    lower.includes("rejection note");

  const isTalentContractDeepContext =
    lower.includes("talent contract") ||
    lower.includes("contract details") ||
    lower.includes("completion flow") ||
    lower.includes("reupload") ||
    lower.includes("rejected work setup") ||
    lower.includes("work setup card") ||
    lower.includes("card opens a modal") ||
    lower.includes("empty state") ||
    lower.includes("submit document");

  if (isWorkSetupContext) {
    if (isTalentPersona || isTalentContractDeepContext) {
      candidates.push({
        route: "UNKNOWN",
        confidence: "low",
        source: "deep-flow",
        reason:
          "Talent Work Setups cases require a concrete talent contract detail route and test data; generic /talent/jobs would create false negatives.",
      });

      return candidates;
    }

    if (isCompanyPersona && isJobDetailsContext) {
      candidates.push({
        route: "/company/all-jobs",
        confidence: "medium",
        source: "feature-area",
        reason:
          "This Work Setups case targets job details/hired/applicants/review context, so company jobs is the safest known entry point.",
      });

      return candidates;
    }

    if (isCompanyPersona && isJobWizardContext) {
      candidates.push({
        route: "/company/all-jobs",
        confidence: "medium",
        source: "feature-area",
        reason:
          "This Work Setups case targets the job wizard; company jobs is the safest known entry point.",
      });

      return candidates;
    }

    if (isCompanyPersona) {
      candidates.push({
        route: "/company/all-work-setups",
        confidence: "high",
        source: "feature-area",
        reason:
          "This case targets top-level company Work Setups management/list/create/details/permissions UI.",
      });

      return candidates;
    }
  }

  if (
    lower.includes("companyjobslist") ||
    lower.includes("company jobs list") ||
    lower.includes("jobs list") ||
    lower.includes("job list")
  ) {
    candidates.push({
      route: "/company/all-jobs",
      confidence: "medium",
      source: "feature-area",
      reason: "Context points to company jobs list area.",
    });
  }

  if (lower.includes("job details") || lower.includes("job wizard")) {
    candidates.push({
      route: "/company/all-jobs",
      confidence: "medium",
      source: "feature-area",
      reason:
        "Context points to company job details/job wizard area; a job detail resolver may refine this.",
    });
  }

  if (lower.includes("payments") || lower.includes("timesheet weeks")) {
    if (isTalentPersona) {
      candidates.push({
        route: "/talent/payments",
        confidence: "medium",
        source: "feature-area",
        reason: "Context points to talent payments area.",
      });
    } else {
      candidates.push({
        route: "/company/all-payments",
        confidence: "medium",
        source: "feature-area",
        reason: "Context points to company payments area.",
      });
    }
  }

  if (
    lower.includes("skills taxonomy") ||
    lower.includes("company skills page") ||
    lower.includes("all skills") ||
    lower.includes("skills page")
  ) {
    candidates.push({
      route: "/company/skills",
      confidence: "medium",
      source: "feature-area",
      reason: "Context points to company skills page.",
    });
  }

  if (
    lower.includes("talent jobs") &&
    !lower.includes("contract details") &&
    !lower.includes("work setups")
  ) {
    candidates.push({
      route: "/talent/jobs",
      confidence: "medium",
      source: "feature-area",
      reason: "Context points to talent jobs area.",
    });
  }

  if (
    lower.includes("assessment") ||
    lower.includes("onboarding") ||
    lower.includes("talent profile") ||
    lower.includes("talent pool") ||
    lower.includes("job change request")
  ) {
    candidates.push({
      route: "UNKNOWN",
      confidence: "low",
      source: "deep-flow",
      reason:
        "Context points to a deep/id-dependent UI flow. It needs route/test-data discovery before safe execution.",
    });
  }

  return candidates;
}

export function discoverBrowserRouteCandidates(
  plan: any,
  testCase: any
): RouteCandidate[] {
  const fullText = collectFullText(plan, testCase);

  const candidates = [
    ...extractLiteralRoutes(fullText),
    ...inferFeatureAreaRoutes(testCase),
  ];

  return uniqByRoute(candidates).sort(
    (a, b) => confidenceScore[b.confidence] - confidenceScore[a.confidence]
  );
}

export function getBestDiscoveredBrowserRoute(
  plan: any,
  testCase: any
): RouteCandidate | undefined {
  const candidates = discoverBrowserRouteCandidates(plan, testCase);

  return candidates.find(
    (candidate) =>
      candidate.confidence !== "low" &&
      isConcreteExecutableRoute(candidate.route)
  );
}