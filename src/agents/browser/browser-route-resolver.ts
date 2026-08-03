import {
  discoverBrowserRouteCandidates,
  getBestDiscoveredBrowserRoute,
} from "../../discovery/route-candidate-discovery.js";
import {
  areRuntimeRouteAreasCompatible,
  getCaseText,
  getPlanText,
  inferRuntimeCaseArea,
  inferRuntimeRouteArea,
  isConcreteBrowserRoute,
  isDeepTalentContractRoute,
  needsJobCreationRoute,
  needsJobDetailsRoute,
} from "./browser-route-semantics.js";
import type {
  BrowserPersona,
} from "./browser-route-semantics.js";
import {
  getCachedBrowserExecutionContext,
  resolveJobDetailsRoute,
} from "./browser-route-execution-context.js";
import {
  resolveTalentContractDetailRoute,
} from "./browser-route-talent-contract.js";

export async function resolveBrowserRoute(
  plan: any,
  testCase: any
): Promise<string> {
  const currentRoute =
    String(testCase.startRoute || "").trim();

  const persona =
    String(testCase.persona || "") as BrowserPersona;

  const planText = getPlanText(plan);
  const caseText = getCaseText(testCase);

  const normalizedCaseText = caseText
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  if (
    needsJobCreationRoute(
      caseText,
      persona
    )
  ) {
    const mutationStep =
      Array.isArray(testCase?.steps)
        ? testCase.steps.find(
            (step: any) =>
              step?.action ===
              "createDraftJobAndVerifyRedirect"
          )
        : undefined;

    const requestedOrigin =
      mutationStep?.origin === "all-jobs"
        ? "all-jobs"
        : "jobs";

    const creationRoute =
      requestedOrigin === "all-jobs"
        ? "/company/jobs/create?origin=all-jobs"
        : "/company/jobs/create";

    console.log(
      ` Browser route resolver selected job creation route ` +
        `for ${testCase.id}: ` +
        `${currentRoute || "UNKNOWN"} -> ` +
        `${creationRoute} ` +
        `(origin=${requestedOrigin})`
    );

    return creationRoute;
  }

  /*
   * READ_ONLY_JOB_WIZARD_ROUTE_V1
   *
   * Some cases inspect copy or controls inside the
   * job wizard without creating a job. A concrete
   * jobs-list entry route is not sufficient for
   * those cases and may expose a same-named sidebar
   * navigation item.
   *
   * Opening the wizard route is non-mutating. The
   * runner still does not click Save, Create,
   * Publish or any other persistence action.
   */
  const hasDedicatedJobMutationStep =
    Array.isArray(testCase?.steps) &&
    testCase.steps.some(
      (step: any) =>
        step?.action ===
        "createDraftJobAndVerifyRedirect"
    );

  const requiresReadOnlyJobWizardRoute =
    persona === "company_admin" &&
    normalizedCaseText.includes(
      "job wizard"
    ) &&
    !hasDedicatedJobMutationStep;

  if (requiresReadOnlyJobWizardRoute) {
    const readOnlyWizardRoute =
      "/company/jobs/create";

    console.log(
      ` Browser route resolver selected ` +
        `read-only job wizard route for ` +
        `${testCase.id}: ` +
        `${currentRoute || "UNKNOWN"} -> ` +
        `${readOnlyWizardRoute}`
    );

    return readOnlyWizardRoute;
  }

  if (isConcreteBrowserRoute(currentRoute)) {
    return currentRoute;
  }

  const isJobChangeRequestFlow = [
    "job change request",
    "change requests",
    "publish request",
    "field update request",
    "request publish",
    "publish comparison",
  ].some((term) =>
    normalizedCaseText.includes(term)
  );

  /**
   * The word "Assessments" may merely be one field inside
   * a full job comparison. It must not redirect a job
   * change-request case to an assessment details page.
   */
  if (
    normalizedCaseText.includes("assessment") &&
    !isJobChangeRequestFlow
  ) {
  const context =
    await getCachedBrowserExecutionContext(
      persona,
      testCase
        ?.runtimeResourceContext
    );

  if (!context.assessmentId) {
    console.log(
      ` Browser route resolver could not resolve assessmentId for ${testCase.id}.`
    );

    return "UNKNOWN";
  }

  if (persona === "company_admin") {
    return `/company/assessments/${context.assessmentId}`;
  }

  if (persona === "talent") {
    return `/talent/assessments/${context.assessmentId}/prepare`;
  }
}

  /**
   * 1. Deep talent contract flows should NOT be mapped to /talent/jobs.
   * They need a concrete contract detail route and test data.
   */
  if (isDeepTalentContractRoute(caseText, persona)) {
    const contractRoute =
      await resolveTalentContractDetailRoute(
        testCase,
        persona
      );

    if (contractRoute) {
      console.log(
        ` Browser route resolver selected talent contract route ` +
          `for ${testCase.id}: ${contractRoute}`
      );

      return contractRoute;
    }

    console.log(
      ` Browser route resolver could not resolve an accessible ` +
        `talent contract route for ${testCase.id}.`
    );

    return "UNKNOWN";
  }

  /**
   * 2. Job details / hired / applicants / review-modal flows need a real job id.
   */
  /**
   * Change-request comparison/review cases need:
   * - a suitable request fixture;
   * - a specific table row;
   * - nested modal/panel navigation.
   *
   * A generic assessment, jobs or work-setups route
   * must not be guessed for these flows.
   */
  const requiresNestedChangeRequestState = [
    "comparison modal",
    "comparison view",
    "job details comparison",
    "publish comparison",
    "opening a publish request",
    "open a publish request",
    "publish request row",
    "review controls",
    "apply and reject",
    "apply or reject",
    "approve and reject",
    "approve or reject",
    "current and proposed",
    "current versus proposed",
  ].some((term) =>
    normalizedCaseText.includes(term)
  );

  if (requiresNestedChangeRequestState) {
    console.log(
      ` Browser route resolver left ${testCase.id} unresolved: ` +
        `nested change-request state requires a concrete request fixture and row navigation.`
    );

    return "UNKNOWN";
  }

  /**
   * Existing job state cases may be resolved with
   * the runtime job fixture resolver.
   */
  const requiresSpecificJobRoute =
    needsJobDetailsRoute(caseText) ||
    normalizedCaseText.includes("draft job") ||
    normalizedCaseText.includes("non draft job") ||
    normalizedCaseText.includes("active job") ||
    normalizedCaseText.includes("job details page") ||
    normalizedCaseText.includes(
      "job details action area"
    );

  if (requiresSpecificJobRoute) {
    return resolveJobDetailsRoute(
      testCase,
      persona
    );
  }

  /**
   * 3. Let code/context discovery select feature-area routes before broad fallbacks.
   * This prevents Work Setups page cases from falling into /company/all-jobs.
   */
  const discoveredRoute = getBestDiscoveredBrowserRoute(plan, testCase);

  if (discoveredRoute) {
    console.log(
      ` Code discovery selected browser route for ${testCase.id}: ${testCase.startRoute} -> ${discoveredRoute.route} (${discoveredRoute.confidence}, ${discoveredRoute.source})`
    );
    console.log(` Route discovery reason: ${discoveredRoute.reason}`);

    return discoveredRoute.route;
  }

  /**
   * 4. Payment fallback.
   */
  if (caseText.includes("payment") || caseText.includes("payments")) {
    if (persona === "company_admin") return "/company/all-payments";
    if (persona === "talent") return "/talent/payments";
  }

  /**
   * 5. Project dropdown fallback.
   */
  if (
    caseText.includes("project dropdown") ||
    caseText.includes("project select") ||
    caseText.includes("project select issue")
  ) {
    if (persona === "company_admin") return "/company/all-jobs";

    console.log(
      ` Browser route resolver: project dropdown route for persona=${persona} is not known yet.`
    );

    return "UNKNOWN";
  }

  /**
   * 6. Broad jobs fallback.
   * Important: this uses caseText, not planText, to avoid unrelated plan-level notes
   * forcing every Work Setups case into /company/all-jobs.
   */
  if (
    caseText.includes("jobs") ||
    caseText.includes("all jobs") ||
    caseText.includes("job list")
  ) {
    if (persona === "company_admin") return "/company/all-jobs";
    if (persona === "talent") return "/talent/jobs";
  }

  /**
   * 7. Last-resort guard for known deep flows.
   */
  if (
    planText.includes("assessment") ||
    caseText.includes("assessment") ||
    caseText.includes("onboarding") ||
    caseText.includes("talent profile") ||
    caseText.includes("talent pool") ||
    caseText.includes("job change request")
  ) {
    console.log(
      ` Browser route resolver: deep/id-dependent route for ${testCase.id} is not known yet.`
    );

    return "UNKNOWN";
  }

  return "UNKNOWN";
}

/**
 * Returns up to three ranked routes for live browser probing.
 *
 * Ranking uses the current route, special runtime fixture
 * resolution and all codebase/catalog discovery candidates.
 * Feature-area agreement is more important than the original
 * confidence label.
 */
export async function resolveBrowserRouteCandidates(
  plan: any,
  testCase: any,
  limit = 3
): Promise<string[]> {
  const wantedArea =
    inferRuntimeCaseArea(testCase);

  const ranked = new Map<
    string,
    {
      route: string;
      score: number;
      reason: string;
    }
  >();

  const addCandidate = (
    routeValue: unknown,
    baseScore: number,
    reason: string
  ) => {
    const route =
      String(routeValue || "").trim();

    if (!isConcreteBrowserRoute(route)) {
      return;
    }

    const routeArea =
      inferRuntimeRouteArea(route);

    let score = baseScore;

    if (
      wantedArea &&
      routeArea &&
      areRuntimeRouteAreasCompatible(
        wantedArea,
        routeArea
      )
    ) {
      score += 100;
    } else if (
      wantedArea &&
      routeArea
    ) {
      score -= 100;
    }

    const existing = ranked.get(route);

    if (
      !existing ||
      score > existing.score
    ) {
      ranked.set(route, {
        route,
        score,
        reason,
      });
    }
  };

  addCandidate(
    testCase?.startRoute,
    25,
    "planner-current-route"
  );

  /*
   * Run existing dynamic fixture resolution using a cloned
   * UNKNOWN route so a planner-selected route cannot short
   * circuit runtime job/assessment resolution.
   */
  const runtimeResolutionCase = {
    ...testCase,
    startRoute: "UNKNOWN",
  };

  const runtimeResolvedRoute =
    await resolveBrowserRoute(
      plan,
      runtimeResolutionCase
    );

  const runtimeFixtureResolutionFailure =
    String(
      runtimeResolutionCase
        .runtimeFixtureResolutionFailure ??
        ""
    ).trim();

  if (runtimeFixtureResolutionFailure) {
    testCase.runtimeFixtureResolutionFailure =
      runtimeFixtureResolutionFailure;
  } else {
    delete testCase
      .runtimeFixtureResolutionFailure;
  }

  addCandidate(
    runtimeResolvedRoute,
    70,
    "runtime-fixture-resolver"
  );

  for (
    const candidate of
    discoverBrowserRouteCandidates(
      plan,
      testCase
    )
  ) {
    const confidenceScore =
      candidate.confidence === "high"
        ? 60
        : candidate.confidence === "medium"
          ? 40
          : 10;

    addCandidate(
      candidate.route,
      confidenceScore,
      `${candidate.source}: ${candidate.reason}`
    );
  }

  const selected = [...ranked.values()]
    .sort(
      (left, right) =>
        right.score - left.score
    )
    .slice(0, Math.max(1, limit));

  console.log(
    ` Runtime route candidates for ` +
      `${testCase?.id ?? "case"}: ` +
      (
        selected
          .map(
            (candidate) =>
              `${candidate.route}(${candidate.score})`
          )
          .join(", ") ||
        "none"
      )
  );

  return selected.map(
    (candidate) => candidate.route
  );
}
