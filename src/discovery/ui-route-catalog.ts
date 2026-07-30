import fs from "node:fs";
import yaml from "yaml";
import type { RouteCandidate } from "./route-candidate-discovery.js";

type UiRouteEntry = {
  path: string;
  file?: string;
  params?: string[];
  area?: string;
  persona?: "company_admin" | "talent" | "admin" | "unknown";
};

type UiRoutesManifest = {
  routes?: UiRouteEntry[];
};

let cachedRoutes: UiRouteEntry[] | undefined;

function readCatalog(): UiRouteEntry[] {
  if (cachedRoutes) return cachedRoutes;

  const manifestPath =
    process.env.QA_UI_ROUTES_MANIFEST || "config/ui-routes.manifest.yaml";

  if (!fs.existsSync(manifestPath)) {
    cachedRoutes = [];
    return cachedRoutes;
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = yaml.parse(raw) as UiRoutesManifest;

  cachedRoutes = Array.isArray(parsed.routes) ? parsed.routes : [];

  return cachedRoutes;
}

function collectText(plan: any, testCase: any): string {
  const stepsText = Array.isArray(testCase?.steps)
    ? testCase.steps
        .map((step: any) =>
          [step.action, step.text]
            .filter((value) => value !== undefined && value !== null)
            .join(" ")
        )
        .join(" ")
    : "";

  return [
    plan?.issueKey,
    plan?.summary,
    plan?.notes,
    testCase?.id,
    testCase?.persona,
    testCase?.goal,
    testCase?.successCriteria,
    stepsText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferWantedArea(text: string): string | undefined {
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
    text.includes("work setups") ||
    text.includes("work setup") ||
    text.includes("document requirement") ||
    text.includes("manager approval")
  ) {
    return "work-setups";
  }

  if (
    text.includes("language") ||
    text.includes("proficiency") ||
    text.includes("listening") ||
    text.includes("speaking") ||
    text.includes("writing") ||
    text.includes("reading")
  ) {
    return "languages";
  }

  if (
    text.includes("skill") ||
    text.includes("skills") ||
    text.includes("taxonomy") ||
    text.includes("discipline")
  ) {
    return "skills";
  }

  /*
   * Specific feature areas must be evaluated before
   * generic relationship words such as "job".
   */
  if (
    text.includes("talent pool") ||
    text.includes("talent-pool")
  ) {
    return "talent-pool";
  }

  if (
    text.includes("job") ||
    text.includes("jobs") ||
    text.includes("job wizard") ||
    text.includes("hired") ||
    text.includes("applicants") ||
    text.includes("newest") ||
    text.includes("latest") ||
    text.includes("oldest")
  ) {
    return "jobs";
  }

  if (text.includes("payment") || text.includes("timesheet")) {
    return "payments";
  }

  if (text.includes("assessment")) {
    return "assessments";
  }

  if (text.includes("contract")) {
    return "contracts";
  }

  return undefined;
}

function isCatalogAreaCompatible(
  wantedArea: string,
  routePath: string,
  area: string
): boolean {
  if (wantedArea === area) {
    return true;
  }

  if (wantedArea === "languages") {
    return (
      area === "assessments" ||
      routePath.includes("/talent/profile") ||
      routePath.includes("/talent/onboarding")
    );
  }

  return false;
}

function routeMatchesPersona(route: UiRouteEntry, persona: string): boolean {
  const routePath = String(route.path || "");

  if (persona === "company_admin") {
    return routePath.startsWith("/company");
  }

  if (persona === "talent") {
    return routePath.startsWith("/talent");
  }

  return true;
}

function hasParams(route: UiRouteEntry): boolean {
  return Array.isArray(route.params) && route.params.length > 0;
}

function scoreRoute(route: UiRouteEntry, text: string, persona: string): number {
  let score = 0;

  const wantedArea = inferWantedArea(text);
  const routePath = String(route.path || "").toLowerCase();
  const filePath = String(route.file || "").toLowerCase();
  const area = String(route.area || "").toLowerCase();

  if (
    routePath === "/company" ||
    routePath === "/talent" ||
    routePath === "/admin"
    ) {
    return -999;
  }

  if (filePath.includes("acceptinvitation")) {
    return -999;
  }

  if (!routeMatchesPersona(route, persona)) {
    return -999;
  }

  score += 20;

  if (
    wantedArea &&
    isCatalogAreaCompatible(
      wantedArea,
      routePath,
      area
    )
  ) {
    score += 60;
  }

  if (wantedArea && routePath.includes(wantedArea)) {
    score += 30;
  }

  if (wantedArea && filePath.includes(wantedArea)) {
    score += 20;
  }

  if (text.includes(routePath)) {
    score += 80;
  }

  /*
   * When one feature may live on multiple surfaces,
   * prefer the surface explicitly named by the case.
   */
  if (
    wantedArea === "languages" &&
    text.includes("profile") &&
    routePath.includes("profile")
  ) {
    score += 30;
  }

  if (
    wantedArea === "languages" &&
    text.includes("onboarding") &&
    routePath.includes("onboarding")
  ) {
    score += 30;
  }

  if (
    wantedArea === "languages" &&
    text.includes("assessment") &&
    area === "assessments"
  ) {
    score += 30;
  }

  /**
   * Prefer safe list/index routes as start routes.
   */
  if (
    routePath.includes("/all-") ||
    routePath.endsWith("/skills") ||
    routePath.endsWith("/jobs") ||
    routePath.endsWith("/payments") ||
    routePath.endsWith("/work-setups") ||
    routePath.endsWith("/all-work-setups") ||
    routePath.endsWith("/all-jobs")
  ) {
    score += 25;
  }

  /**
   * Param routes are useful in the catalog, but unsafe as generic start routes
   * unless another resolver fills IDs later.
   */
  if (hasParams(route) || routePath.includes(":") || routePath.includes("$")) {
    score -= 50;
  }

  /**
   * Product-specific preference: top-level Work Setups page is safer than
   * project/detail routes when the case asks for generic Work Setups UI.
   */
  if (wantedArea === "work-setups" && routePath.includes("all-work-setups")) {
    score += 40;
  }

  return score;
}

function confidenceFromScore(score: number): RouteCandidate["confidence"] {
  if (score >= 80) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function findRouteCandidatesFromCatalog(
  plan: any,
  testCase: any
): RouteCandidate[] {
  const routes = readCatalog();

  if (routes.length === 0) {
    return [];
  }

  const text = collectText(plan, testCase);
  const persona = String(testCase?.persona || "");

  return routes
    .map((route) => {
      const score = scoreRoute(route, text, persona);

      return {
        route: route.path,
        score,
        confidence: confidenceFromScore(score),
        source: "ui-route-catalog",
        reason: `Selected from UI route manifest. file=${route.file || "unknown"}, area=${route.area || "unknown"}, score=${score}`,
      };
    })
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...candidate }) => candidate);
}