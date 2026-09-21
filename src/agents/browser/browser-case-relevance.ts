type BrowserArea =
  | "assessments"
  | "languages"
  | "skills"
  | "jobs"
  | "work-setups"
  | "payments"
  | "contracts"
  | "offers"
  | "talent-pool"
  | "onboarding"
  | "talent-profile";

const EXPLICIT_BROWSER_SURFACE_PATTERNS:
  ReadonlyArray<
    readonly [BrowserArea, RegExp]
  > = [
    ["assessments", /assessments?/],
    ["languages", /languages?/],
    ["skills", /skills?/],
    ["jobs", /jobs?/],
    ["work-setups", /work[- ]setups?/],
    ["payments", /(?:all\s+)?payments?/],
    ["contracts", /contracts?/],
    ["offers", /offers?/],
    ["talent-pool", /talent\s+pool/],
    ["onboarding", /onboarding/],
    ["talent-profile", /talent\s+profile/],
  ];

/*
 * Explicit target-surface semantics outrank relational field
 * vocabulary. For example, "job title" is a searchable field on a
 * Payments page; it does not make the target surface a Jobs page.
 *
 * Match only a known area name followed by a surface noun. Bare area
 * vocabulary continues through the existing inference rules below.
 * Multiple explicit areas remain ambiguous and therefore fail closed.
 */
function inferExplicitBrowserSurfaceArea(
  rawText: string
): BrowserArea | null | undefined {
  const text = String(rawText || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return undefined;
  }

  const areas = new Set<BrowserArea>();
  const surfaceKind =
    "(?:page|screen|view|tab|surface|workflow|list|details?)";

  for (const [area, name] of
    EXPLICIT_BROWSER_SURFACE_PATTERNS) {
    const pattern = new RegExp(
      `\\b(?:${name.source})\\s+${surfaceKind}\\b`,
      "i"
    );

    if (pattern.test(text)) {
      areas.add(area);
    }
  }

  if (areas.size > 1) {
    return null;
  }

  return areas.values().next().value;
}

export function getBrowserCaseText(testCase: any): string {
  const stepText = Array.isArray(testCase.steps)
    ? testCase.steps
        .map((step: any) => [step.action, step.text].filter(Boolean).join(" "))
        .join(" ")
    : "";

  return [testCase.goal, testCase.successCriteria, stepText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferBrowserAreaFromText(
  rawText: string
): BrowserArea | undefined {
  const text = String(rawText || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return undefined;
  }

  if (text.includes("assessment")) {
    return "assessments";
  }

  /*
   * Specific feature areas must be evaluated before
   * generic relationship words such as "job".
   */
  if (text.includes("talent pool")) {
    return "talent-pool";
  }

  if (
    text.includes("job change request") ||
    text.includes("job review") ||
    text.includes("job details") ||
    text.includes("job list") ||
    /\bjob\b/.test(text)
  ) {
    return "jobs";
  }

/*
 * Work Setup terminology may appear alongside
 * negative legacy-name assertions such as
 * "without onboarding-document naming".
 *
 * The concrete feature must win over the legacy
 * area mentioned only as an excluded term.
 */
if (
  text.includes("work setup") ||
  text.includes("work-setup")
) {
  return "work-setups";
}

if (text.includes("onboarding")) {
  return "onboarding";
}

if (
  text.includes(
    "skills and languages profile"
  ) ||
  text.includes("profile tab") ||
  text.includes("talent profile")
) {
  return "talent-profile";
}

  if (
    text.includes("payment") ||
    text.includes("payout") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  if (text.includes("contract")) {
    return "contracts";
  }

  if (text.includes("offer")) {
    return "offers";
  }

  if (
    text.includes("skill selector") ||
    text.includes("skills page") ||
    text.includes("selected skills")
  ) {
    return "skills";
  }

  if (text.includes("language")) {
    return "languages";
  }

  return undefined;
}

function getPositiveBrowserStepText(
  testCase: any
): string {
  if (!Array.isArray(testCase?.steps)) {
    return "";
  }

  return testCase.steps
    .filter(
      (step: any) =>
        step?.action !==
        "assertTextNotVisible"
    )
    .map(
      (step: any) =>
        [
          step?.action,
          step?.text,
        ]
          .filter(Boolean)
          .join(" ")
    )
    .join(" ");
}

function getPositiveSuccessCriteriaText(
  testCase: any
): string {
  const criteria = String(
    testCase?.successCriteria || ""
  );

  /*
   * Negative oracle clauses describe what must
   * not be present. They must not redefine the
   * intended feature area.
   */
  return criteria
    .split(/[.!?]+/)
    .filter((clause) => {
      const normalized =
        clause.trim().toLowerCase();

      if (!normalized) {
        return false;
      }

      return !(
        /\bmust not\b/.test(normalized) ||
        /\bshould not\b/.test(normalized) ||
        /\bdoes not\b/.test(normalized) ||
        /\bdo not\b/.test(normalized) ||
        /\bnot displayed\b/.test(normalized) ||
        /\bnot visible\b/.test(normalized) ||
        /\babsent\b/.test(normalized) ||
        /\bprohibited\b/.test(normalized) ||
        /\brather than\b/.test(normalized) ||
        /\binstead of\b/.test(normalized)
      );
    })
    .join(" ");
}

export function inferBrowserCaseArea(
  testCase: any
): BrowserArea | undefined {
  /*
   * Source priority:
   *
   * 1. The explicit goal defines the feature.
   * 2. Positive executable steps provide evidence.
   * 3. Positive success-criteria clauses are fallback.
   *
   * Negative assertions are deliberately excluded.
   */
  const inferenceSources = [
    String(testCase?.goal || ""),
    getPositiveBrowserStepText(testCase),
    getPositiveSuccessCriteriaText(
      testCase
    ),
  ];

  for (const source of inferenceSources) {
    const explicitArea =
      inferExplicitBrowserSurfaceArea(
        source
      );

    if (explicitArea === null) {
      return undefined;
    }

    if (explicitArea) {
      return explicitArea;
    }

    const area =
      inferBrowserAreaFromText(source);

    if (area) {
      return area;
    }
  }

  return undefined;
}

function inferBrowserRouteArea(
  startRoute: string
): BrowserArea | undefined {
  const route = String(startRoute || "")
    .split("?")[0]!
    .toLowerCase();

  if (!route || route === "unknown") {
    return undefined;
  }

  if (route.includes("assessment")) {
    return "assessments";
  }

  if (route.includes("work-setup")) {
    return "work-setups";
  }

  if (
    route.includes("payment") ||
    route.includes("timesheet")
  ) {
    return "payments";
  }

  if (route.includes("contract")) {
    return "contracts";
  }

  if (route.includes("offer")) {
    return "offers";
  }

  if (
    route.includes("talent-pool") ||
    route.includes("/company/talents")
  ) {
    return "talent-pool";
  }

  if (route.includes("onboarding")) {
    return "onboarding";
  }

  if (
    route.includes("/talent/profile") ||
    route.includes("profile")
  ) {
    return "talent-profile";
  }

  if (route.includes("skills")) {
    return "skills";
  }

  if (route.includes("jobs")) {
    return "jobs";
  }

  return undefined;
}

function areBrowserAreasCompatible(
  wantedArea: BrowserArea,
  selectedArea: BrowserArea
): boolean {
  if (wantedArea === selectedArea) {
    return true;
  }

  const compatibleRoutes: Record<
    BrowserArea,
    Set<BrowserArea>
  > = {
    assessments: new Set(["assessments", "jobs"]),
    languages: new Set([
      "languages",
      "talent-profile",
      "onboarding",
      "assessments",
    ]),
    skills: new Set([
      "skills",
      "jobs",
      "talent-profile",
    ]),
    jobs: new Set(["jobs"]),
    "work-setups": new Set([
      "work-setups",
      "jobs",
      "contracts",
    ]),
    payments: new Set(["payments"]),
    contracts: new Set(["contracts", "jobs"]),
    offers: new Set(["offers", "jobs"]),
    "talent-pool": new Set(["talent-pool"]),
    onboarding: new Set(["onboarding"]),
    "talent-profile": new Set(["talent-profile"]),
  };

  return compatibleRoutes[wantedArea].has(selectedArea);
}

export function getBrowserRelevanceBlockReason(
  testCase: any
): string | null {
  const wantedArea =
    inferBrowserCaseArea(testCase);

  const selectedArea =
    inferBrowserRouteArea(testCase.startRoute);

  /**
   * V1 is conservative:
   * unknown intent or unknown route area is not rejected.
   */
  if (!wantedArea || !selectedArea) {
    return null;
  }

  if (
    areBrowserAreasCompatible(
      wantedArea,
      selectedArea
    )
  ) {
    return null;
  }

  return (
    `Browser relevance gate rejected ` +
    `${testCase.id || "case"}: ` +
    `expected area=${wantedArea}, ` +
    `selected area=${selectedArea}, ` +
    `route=${testCase.startRoute}`
  );
}

export function isComplexDropdownCase(testCase: any): boolean {
  const text = getBrowserCaseText(testCase);

  const mentionsDropdown =
    text.includes("dropdown") ||
    text.includes("selector") ||
    text.includes("select issue") ||
    text.includes("last item") ||
    text.includes("scrollable") ||
    text.includes("scroll inside");

  const mentionsProjectOrSelection =
    text.includes("project") ||
    text.includes("select") ||
    text.includes("selection");

  return mentionsDropdown && mentionsProjectOrSelection;
}

export function isMenuOrFilterCase(testCase: any): boolean {
  const text = getBrowserCaseText(testCase);

  return (
    text.includes("filter") ||
    text.includes("filters") ||
    text.includes("sort") ||
    text.includes("sorting") ||
    text.includes("dropdown") ||
    text.includes("menu") ||
    text.includes("newest") ||
    text.includes("latest") ||
    text.includes("oldest") ||
    text.includes("processed by") ||
    text.includes("paid on") ||
    text.includes("work period") ||
    text.includes("submit by") ||
    text.includes("approved by")
  );
}

export function buildManualRequiredNotesForFailedAssertions(
  notes: string[],
  testCase: any
): string[] {
  const caseText = getBrowserCaseText(testCase);

  if (isMenuOrFilterCase(testCase)) {
    const reason =
      "One or more assertions failed in a menu/filter/sort/dropdown or deep-detail UI case. Manual verification is required before treating this as a product bug.";

    if (caseText.includes("filter") || caseText.includes("sort")) {
      return [
        ...notes,
        reason,
        "Generic browser runner may not have opened the correct nested filter/sort menu or dropdown options.",
      ];
    }

    return [...notes, reason];
  }

  return [
    ...notes,
    "One or more assertions failed after a generic browser action limitation. Manual verification is required before treating this as a product bug.",
  ];
}
