export type BrowserPersona = "company_admin" | "talent";
export type DesiredJobStatus =
  | "active"
  | "closed"
  | "draft";

export function isInternalBrowserRoute(
  route: string
): boolean {
  const normalized =
    String(route || "").trim();

  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.startsWith("/api/")
  ) {
    return false;
  }

  return (
    normalized === "/company" ||
    normalized.startsWith("/company/") ||
    normalized === "/talent" ||
    normalized.startsWith("/talent/") ||
    normalized === "/admin" ||
    normalized.startsWith("/admin/")
  );
}

export function isBrowserRouteCompatibleWithPersona(
  route: string,
  persona: BrowserPersona
): boolean {
  const normalized =
    String(route || "").trim();

  return persona === "company_admin"
    ? normalized.startsWith(
        "/company/"
      )
    : normalized.startsWith(
        "/talent/"
      );
}

export function isConcreteBrowserRoute(route: string): boolean {
  const normalized = String(route || "").trim();

  if (!normalized || normalized.toUpperCase() === "UNKNOWN") {
    return false;
  }

  if (
    normalized.includes("UNKNOWN") ||
    normalized.includes("{") ||
    normalized.includes("}") ||
    /:[A-Za-z0-9_]+/.test(normalized) ||
    normalized.includes("$")
  ) {
    return false;
  }

  return isInternalBrowserRoute(
    normalized
  );
}

export function getCaseText(testCase: any) {
  const stepTexts = Array.isArray(testCase.steps)
    ? testCase.steps.map((step: any) => step.text).filter(Boolean).join(" ")
    : "";

  return [testCase.goal, testCase.successCriteria, stepTexts]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getPlanText(plan: any) {
  return [plan.issueKey, plan.summary, plan.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function needsJobDetailsRoute(caseText: string) {
  return (
    caseText.includes("job details") ||
    caseText.includes("hired section") ||
    caseText.includes("hired table") ||
    caseText.includes("applicants") ||
    caseText.includes("review modal") ||
    caseText.includes("pending review") ||
    caseText.includes("approve/reject") ||
    caseText.includes("rejection note") ||
    caseText.includes("job status") ||
    caseText.includes("job visibility") ||
    caseText.includes("visibility badge") ||
    caseText.includes("status badge")
  );
}

export function needsJobCreationRoute(
  caseText: string,
  persona: BrowserPersona
) {
  if (persona !== "company_admin") {
    return false;
  }

  const normalized = caseText
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const directJobCreationIntent =
    [
      "job creation",
      "create job",
      "create a job",
      "creating a job",
      "edit job",
      "editing a job",
      "job creation wizard",
      "job create wizard",
      "job edit wizard",
    ].some((term) =>
      normalized.includes(term)
    ) ||
    (
      normalized.includes("job") &&
      normalized.includes("wizard")
    );

  const projectCreationInsideJobWizard =
    normalized.includes("project selector") &&
    [
      "create project",
      "create a project",
      "creating a project",
      "project creation",
      "newly created project",
    ].some((term) =>
      normalized.includes(term)
    );

  return (
    directJobCreationIntent ||
    projectCreationInsideJobWizard
  );
}

export function isDeepTalentContractRoute(caseText: string, persona: BrowserPersona) {
  if (persona !== "talent") return false;

  return (
    caseText.includes("talent contract") ||
    caseText.includes("contract details") ||
    caseText.includes("work setup card") ||
    caseText.includes("submit document") ||
    caseText.includes("pending review") ||
    caseText.includes("rejected") ||
    caseText.includes("reupload") ||
    caseText.includes("no work setups are required")
  );
}

export function detectDesiredJobStatus(testCase: any): DesiredJobStatus | undefined {
  const visibleAssertionTexts = Array.isArray(testCase.steps)
    ? testCase.steps
        .filter((step: any) => step.action === "assertTextVisible")
        .map((step: any) => String(step.text || "").toLowerCase())
    : [];

  const hasVisibleClosed = visibleAssertionTexts.some(
    (text: string) => text === "closed"
  );
  const hasVisibleDraft = visibleAssertionTexts.some(
    (text: string) => text === "draft"
  );
  const hasVisibleActive = visibleAssertionTexts.some(
    (text: string) => text === "active"
  );

  if (hasVisibleClosed) return "closed";
  if (hasVisibleDraft) return "draft";
  if (hasVisibleActive) return "active";

  const caseText = getCaseText(testCase);

  if (/\bclosed job\b/.test(caseText)) return "closed";
  if (/\bdraft job\b/.test(caseText)) return "draft";
  if (/\bactive job\b/.test(caseText) || /\bactive public job\b/.test(caseText)) {
    return "active";
  }

  return undefined;
}

export type RuntimeRouteArea =
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

export function inferRuntimeCaseArea(
  testCase: any
): RuntimeRouteArea | undefined {
  const text = getCaseText(testCase)
    .replace(/[-_]+/g, " ");

  const isChangeRequest =
    text.includes("change request") ||
    text.includes("publish request") ||
    text.includes("field update request") ||
    text.includes("request publish");

  if (isChangeRequest) {
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
    !isChangeRequest
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

  if (text.includes("talent profile")) {
    return "talent-profile";
  }

  if (
    text.includes("job") ||
    text.includes("applicant") ||
    text.includes("hired") ||
    isChangeRequest
  ) {
    return "jobs";
  }

  return undefined;
}

export function inferRuntimeRouteArea(
  route: string
): RuntimeRouteArea | undefined {
  const normalized =
    String(route || "")
      .split("?")[0]!
      .toLowerCase();

  if (normalized.includes("assessment")) {
    return "assessments";
  }

  if (normalized.includes("work-setup")) {
    return "work-setups";
  }

  if (
    normalized.includes("payment") ||
    normalized.includes("timesheet")
  ) {
    return "payments";
  }

  if (normalized.includes("skill")) {
    return "skills";
  }

  if (normalized.includes("contract")) {
    return "contracts";
  }

  if (normalized.includes("offer")) {
    return "offers";
  }

  if (normalized.includes("talent-pool")) {
    return "talent-pool";
  }

  if (normalized.includes("onboarding")) {
    return "onboarding";
  }

  if (normalized.includes("profile")) {
    return "talent-profile";
  }

  if (normalized.includes("job")) {
    return "jobs";
  }

  return undefined;
}

export function areRuntimeRouteAreasCompatible(
  wantedArea: RuntimeRouteArea,
  routeArea: RuntimeRouteArea
): boolean {
  if (wantedArea === routeArea) {
    return true;
  }

  if (wantedArea === "languages") {
    return new Set<RuntimeRouteArea>([
      "talent-profile",
      "onboarding",
      "assessments",
    ]).has(routeArea);
  }

  return false;
}
