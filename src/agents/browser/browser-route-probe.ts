import type { Page } from "playwright";

type ProbeArea =
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

export type BrowserRouteProbeAttempt = {
  route: string;
  finalUrl: string;
  accepted: boolean;
  reason: string;
  matchedLandmarks: string[];
};

export type BrowserRouteProbeResult = {
  acceptedRoute?: string;
  attempts: BrowserRouteProbeAttempt[];
};

function getCaseText(testCase: any): string {
  const stepsText = Array.isArray(testCase?.steps)
    ? testCase.steps
        .map((step: any) =>
          [
            step?.action,
            step?.text,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ")
    : "";

  return [
    testCase?.goal,
    testCase?.successCriteria,
    stepsText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
}

function inferCaseArea(
  testCase: any
): ProbeArea | undefined {
  const text = getCaseText(testCase);

  const isJobChangeRequest =
    text.includes("change request") ||
    text.includes("publish request") ||
    text.includes("field update request") ||
    text.includes("request publish");

  if (isJobChangeRequest) {
    return "jobs";
  }

  const isJobWizardContext =
    (
      text.includes("job") &&
      text.includes("wizard")
    ) ||
    text.includes("job creation") ||
    text.includes("create job") ||
    text.includes("create a job") ||
    text.includes("edit job") ||
    text.includes("editing a job");

  if (isJobWizardContext) {
    return "jobs";
  }

  const isJobDetailContainer =
    text.includes("job details") ||
    text.includes("job detail") ||
    text.includes("hired area") ||
    text.includes("hired section") ||
    text.includes("hired table") ||
    text.includes("applicants") ||
    text.includes("review modal") ||
    text.includes("job status") ||
    text.includes("job visibility");

  if (isJobDetailContainer) {
    return "jobs";
  }

  /*
   * Specific feature terms must be checked before
   * generic job-related words. Invoice and Work Setup
   * cases may also mention jobs in their relationships.
   */
  if (
    text.includes("payment") ||
    text.includes("invoice") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  const isContractDetailContainer =
    text.includes("talent contract") ||
    text.includes("contract details") ||
    text.includes("contract detail") ||
    text.includes("contract page") ||
    text.includes("contract section");

  if (isContractDetailContainer) {
    return "contracts";
  }

  if (
    text.includes("work setup") ||
    text.includes("worksetup")
  ) {
    return "work-setups";
  }

  const isLanguageFeature =
    text.includes("language") ||
    text.includes("proficiency") ||
    text.includes("listening") ||
    text.includes("speaking") ||
    text.includes("writing") ||
    text.includes("reading");

  if (isLanguageFeature) {
    return "languages";
  }

  if (
    text.includes("skill selector") ||
    text.includes("selected skill") ||
    text.includes("skills page") ||
    text.includes("skills taxonomy")
  ) {
    return "skills";
  }

  if (
    text.includes("assessment") &&
    !isJobChangeRequest
  ) {
    return "assessments";
  }

  const isContractFeature =
    text.includes("talent contract") ||
    text.includes("contract details") ||
    text.includes("contract page") ||
    text.includes("contract section");

  if (isContractFeature) {
    return "contracts";
  }

  if (text.includes("offer")) {
    return "offers";
  }

  if (text.includes("talent pool")) {
    return "talent-pool";
  }

  if (text.includes("onboarding")) {
    return "onboarding";
  }

  if (
    text.includes("talent profile") ||
    text.includes("profile page")
  ) {
    return "talent-profile";
  }

  if (
    text.includes("job") ||
    isJobChangeRequest ||
    text.includes("applicant") ||
    text.includes("hired")
  ) {
    return "jobs";
  }

  return undefined;
}

function inferRouteArea(
  routeOrUrl: string
): ProbeArea | undefined {
  let pathname = routeOrUrl;

  try {
    pathname = new URL(routeOrUrl).pathname;
  } catch {
    pathname = routeOrUrl.split("?")[0] ?? routeOrUrl;
  }

  const route = pathname.toLowerCase();

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

  if (route.includes("skill")) {
    return "skills";
  }

  if (route.includes("contract")) {
    return "contracts";
  }

  if (route.includes("offer")) {
    return "offers";
  }

  if (route.includes("talent-pool")) {
    return "talent-pool";
  }

  if (route.includes("onboarding")) {
    return "onboarding";
  }

  if (route.includes("profile")) {
    return "talent-profile";
  }

  if (route.includes("job")) {
    return "jobs";
  }

  return undefined;
}

function areProbeAreasCompatible(
  wantedArea: ProbeArea,
  actualArea: ProbeArea
): boolean {
  if (wantedArea === actualArea) {
    return true;
  }

  if (wantedArea === "languages") {
    return new Set<ProbeArea>([
      "talent-profile",
      "onboarding",
      "assessments",
    ]).has(actualArea);
  }

  return false;
}

function isCompatibleFeatureContainerRoute(
  wantedArea: ProbeArea,
  actualArea: ProbeArea | undefined,
  routeOrUrl: string
): boolean {
  /*
   * Job create/edit routes are workflow containers.
   * They may render wizard controls without generic
   * Jobs-list landmarks such as "All Jobs" or "Newest".
   */
  if (
    wantedArea === "jobs" &&
    actualArea === "jobs"
  ) {
    let jobPathname = routeOrUrl;

    try {
      jobPathname =
        new URL(routeOrUrl).pathname;
    } catch {
      jobPathname =
        routeOrUrl.split("?")[0] ??
        routeOrUrl;
    }

    const jobSegments = jobPathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);

    const jobsIndex =
      jobSegments.indexOf("jobs");

    const workflowSegments =
      jobsIndex >= 0
        ? jobSegments.slice(jobsIndex + 1)
        : [];

    if (
      workflowSegments.includes("create") ||
      workflowSegments.includes("edit")
    ) {
      return true;
    }
  }

  if (
    wantedArea !== "languages" ||
    !actualArea
  ) {
    return false;
  }

  /*
   * Profile and onboarding are valid containers for
   * language-related sections even when that section
   * is not initially visible.
   */
  if (
    actualArea === "talent-profile" ||
    actualArea === "onboarding"
  ) {
    return true;
  }

  /*
   * An assessment detail/deep route is a valid
   * container for assessment language configuration.
   * The top-level assessments list is not.
   */
  if (actualArea !== "assessments") {
    return false;
  }

  let pathname = routeOrUrl;

  try {
    pathname = new URL(routeOrUrl).pathname;
  } catch {
    pathname =
      routeOrUrl.split("?")[0] ?? routeOrUrl;
  }

  const segments = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean);

  const assessmentIndex =
    segments.indexOf("assessments");

  if (
    assessmentIndex < 0 ||
    assessmentIndex + 1 >= segments.length
  ) {
    return false;
  }

  const nextSegment =
    segments[assessmentIndex + 1];

  return (
    Boolean(nextSegment) &&
    nextSegment !== "create"
  );
}

const areaLandmarks: Record<
  ProbeArea,
  string[]
> = {
  assessments: [
    "assessments",
    "assessment",
    "submissions",
    "questions",
  ],
  languages: [
    "language requirements",
    "select language",
    "proficiency level",
    "listening",
    "speaking",
    "writing",
    "reading",
  ],
  skills: [
    "skills",
    "skill",
    "category",
    "discipline",
  ],
  jobs: [
    "jobs",
    "all jobs",
    "change requests",
    "applicants",
    "newest",
  ],
  "work-setups": [
    "work setups",
    "work setup",
  ],
  payments: [
    "payments",
    "payment",
    "invoice",
    "processed",
    "sent for processing",
    "timesheets",
  ],
  contracts: [
    "contracts",
    "contract",
  ],
  offers: [
    "offers",
    "offer",
  ],
  "talent-pool": [
    "talent pool",
  ],
  onboarding: [
    "onboarding",
  ],
  "talent-profile": [
    "talent profile",
    "profile",
  ],
};

async function probeSingleRoute(
  page: Page,
  baseUrl: string,
  route: string,
  testCase: any
): Promise<BrowserRouteProbeAttempt> {
  const targetUrl =
    `${baseUrl}${route}`;

  try {
    /*
     * Open the candidate only once. Authentication may still
     * be settling after Firebase custom-token sign-in, so wait
     * on the current page instead of repeatedly reloading the
     * protected route.
     */
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    for (
      let authWait = 1;
      authWait <= 3;
      authWait += 1
    ) {
      await page.waitForTimeout(800);

      const currentUrl =
        page.url().toLowerCase();

      const redirectedToLogin =
        currentUrl.includes(
          "/account/login"
        ) ||
        currentUrl.endsWith("/login") ||
        currentUrl.includes("/login?");

      if (!redirectedToLogin) {
        break;
      }

      if (authWait < 3) {
        console.log(
          ` Runtime browser route probe waiting ` +
            `for auth state: ${route} ` +
            `(${authWait}/3).`
        );
      }
    }

    await page
      .waitForLoadState(
        "networkidle",
        {
          timeout: 5000,
        }
      )
      .catch(() => {});
  } catch (error: any) {
    return {
      route,
      finalUrl: page.url(),
      accepted: false,
      reason:
        `Navigation failed: ${String(
          error?.message || error
        )}`,
      matchedLandmarks: [],
    };
  }

  const finalUrl = page.url();

  if (
    finalUrl.includes("/account/login") ||
    finalUrl.includes("/login")
  ) {
    return {
      route,
      finalUrl,
      accepted: false,
      reason:
        "Candidate redirected to a login page.",
      matchedLandmarks: [],
    };
  }

  const wantedArea = inferCaseArea(testCase);
  const actualArea = inferRouteArea(finalUrl);

  if (
    wantedArea &&
    actualArea &&
    !areProbeAreasCompatible(
      wantedArea,
      actualArea
    )
  ) {
    return {
      route,
      finalUrl,
      accepted: false,
      reason:
        `Feature mismatch: expected=${wantedArea}, ` +
        `actual=${actualArea}.`,
      matchedLandmarks: [],
    };
  }

  const bodyText = (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

  /*
   * Navigation and sidebar labels are useful for route
   * discovery, but they must not validate the feature
   * currently rendered in the main content area.
   */
  const mainText = (
    await page
      .locator("main, [role=\"main\"]")
      .first()
      .innerText()
      .catch(() => "")
  )
    .toLowerCase()
    .replace(/\s+/g, " ");

  const landmarkText =
    mainText.trim() ? mainText : bodyText;

  if (
    !bodyText ||
    bodyText.includes("page cannot be reached")
  ) {
    return {
      route,
      finalUrl,
      accepted: false,
      reason:
        "Candidate page has no usable application content.",
      matchedLandmarks: [],
    };
  }

  if (!wantedArea) {
    return {
      route,
      finalUrl,
      accepted: true,
      reason:
        "No exact feature area was inferred; the route loaded usable application content.",
      matchedLandmarks: [],
    };
  }

  const matchedLandmarks =
    areaLandmarks[wantedArea].filter(
      (landmark) =>
        landmarkText.includes(landmark)
    );

  const isCompatibleContainer =
    isCompatibleFeatureContainerRoute(
      wantedArea,
      actualArea,
      finalUrl
    );

  /*
   * A compatible container route may be accepted even
   * when the nested feature panel is not open yet.
   * Interaction execution will determine whether that
   * panel can be reached automatically.
   */
  if (isCompatibleContainer) {
    return {
      route,
      finalUrl,
      accepted: true,
      reason:
        `Matched compatible ${actualArea} container ` +
        `route for ${wantedArea}; nested feature ` +
        `navigation may still be required.`,
      matchedLandmarks,
    };
  }

  /*
   * Individual skill words may appear in assessment
   * titles or unrelated records. They are insufficient
   * to prove that a language editor is open.
   */
  const strongLanguageLandmarks = new Set([
    "language requirements",
    "select language",
    "proficiency level",
    "level adjustment",
  ]);

  const hasStrongLanguageLandmark =
    matchedLandmarks.some((landmark) =>
      strongLanguageLandmarks.has(landmark)
    );

  if (
    wantedArea === "languages" &&
    !hasStrongLanguageLandmark
  ) {
    return {
      route,
      finalUrl,
      accepted: false,
      reason:
        "No high-signal languages editor landmark was visible.",
      matchedLandmarks,
    };
  }

  if (matchedLandmarks.length === 0) {
    return {
      route,
      finalUrl,
      accepted: false,
      reason:
        `No ${wantedArea} landmark was visible.`,
      matchedLandmarks,
    };
  }

  return {
    route,
    finalUrl,
    accepted: true,
    reason:
      `Matched ${wantedArea} route and live page landmarks.`,
    matchedLandmarks,
  };
}

export async function probeBrowserRouteCandidates(
  page: Page,
  baseUrl: string,
  testCase: any,
  candidates: string[]
): Promise<BrowserRouteProbeResult> {
  const attempts: BrowserRouteProbeAttempt[] = [];

  for (const route of candidates.slice(0, 3)) {
    console.log(
      ` Runtime browser route probe trying ` +
        `${testCase.id}: ${route}`
    );

    const attempt = await probeSingleRoute(
      page,
      baseUrl,
      route,
      testCase
    );

    attempts.push(attempt);

    console.log(
      ` Runtime browser route probe ` +
        `${attempt.accepted ? "accepted" : "rejected"} ` +
        `${testCase.id}: ${route} — ${attempt.reason}`
    );

    if (attempt.matchedLandmarks.length > 0) {
      console.log(
        ` Runtime route landmarks: ` +
          attempt.matchedLandmarks.join(", ")
      );
    }

    if (attempt.accepted) {
      return {
        acceptedRoute: route,
        attempts,
      };
    }
  }

  return { attempts };
}
