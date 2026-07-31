import fs from "fs";
import {
  getReasoningOptions,
  ollamaClient,
} from "../llm/ollama-client.js";
import { getJiraIssue } from "../agents/api/jiraFetcher.js";
import { getGithubChangeContext } from "../agents/api/githubFetcher.js";
import { findApiEndpointCandidateFromCatalog } from "../discovery/api-endpoint-catalog.js";
import { discoverBrowserRouteCandidates } from "../discovery/route-candidate-discovery.js";

type ADFNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
};

function isUnknownApiPath(path: unknown): boolean {
  const value = String(path ?? "").trim().toUpperCase();

  return value === "UNKNOWN" || value.startsWith("UNKNOWN?");
}

function isUnknownMethod(method: unknown): boolean {
  const value = String(method ?? "").trim().toUpperCase();

  return value === "" || value === "UNKNOWN";
}

function isUnknownBrowserRoute(route: unknown): boolean {
  return String(route ?? "").trim().toUpperCase() === "UNKNOWN";
}

function isExplicitBrowserSurfaceRouteCompatible(
  testCase: any,
  route: string
): boolean {
  const goal = String(
    testCase?.goal || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

  const pathname =
    String(route || "")
      .trim()
      .split(/[?#]/)[0]
      ?.replace(/\/+$/, "") || "";

  const segments = pathname
    .split("/")
    .filter(Boolean);

  const routeSurface =
    String(
      segments[segments.length - 1] || ""
    )
      .toLowerCase()
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (!goal || !routeSurface) {
    return true;
  }

  const routeTargetsAll =
    routeSurface.startsWith("all ");

  const baseSurface = routeTargetsAll
    ? routeSurface.slice(4).trim()
    : routeSurface;

  if (!baseSurface) {
    return true;
  }

  const explicitPageTarget =
    goal.match(
      new RegExp(
        `\\b(all\\s+)?` +
          `${escapeRegularExpression(
            baseSurface
          )}\\s+page\\b`,
        "i"
      )
    );

  /*
   * The goal does not explicitly distinguish
   * an X page from an All X page.
   */
  if (!explicitPageTarget) {
    return true;
  }

  const goalTargetsAll =
    Boolean(explicitPageTarget[1]);

  return (
    goalTargetsAll === routeTargetsAll
  );
}

function mergeResolvedApiPath(
  originalPath: unknown,
  resolvedPath: string
): string {
  const original = String(originalPath ?? "").trim();
  const queryIndex = original.indexOf("?");

  if (queryIndex === -1) {
    return resolvedPath;
  }

  const query = original.slice(queryIndex + 1).trim();

  if (!query) {
    return resolvedPath;
  }

  return resolvedPath.includes("?")
    ? `${resolvedPath}&${query}`
    : `${resolvedPath}?${query}`;
}

function isConcretePlannerRoute(route: string): boolean {
  const value = route.trim();

  if (!value.startsWith("/")) return false;
  if (value.toUpperCase().includes("UNKNOWN")) return false;
  if (value.includes("{") || value.includes("}")) return false;
  if (/:[A-Za-z0-9_]+/.test(value)) return false;

  return true;
}

function isMutatingApiMethod(method: unknown): boolean {
  const value = String(method ?? "")
    .trim()
    .toUpperCase();

  return ["POST", "PATCH", "PUT", "DELETE"].includes(
    value
  );
}

function collectBrowserIntentText(
  testCase: any
): string {
  const steps = Array.isArray(testCase?.steps)
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
    steps,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isDeepBrowserCase(testCase: any): boolean {
  const text = collectBrowserIntentText(testCase);

  const explicitDeepTerms = [
    "details page",
    "detail page",
    "job details",
    "details panel",
    "detail panel",
    "action area",
    "comparison view",
    "comparison modal",
    "review modal",
    "review controls",
    "current versus proposed",
    "current-versus-proposed",
    "open a publish request",
    "opening a publish request",
    "open a seeded",
    "opening a seeded",
    "apply and reject",
    "apply or reject",
    "approve and reject",
    "approve or reject",
  ];

  if (
    explicitDeepTerms.some((term) =>
      text.includes(term)
    )
  ) {
    return true;
  }

  const normalizedText = text.replace(
    /[-_]+/g,
    " "
  );

  const needsSpecificJobState =
    normalizedText.includes("job") &&
    (
      normalizedText.includes("draft job") ||
      normalizedText.includes("non draft job") ||
      normalizedText.includes("active job") ||
      normalizedText.includes("job details") ||
      normalizedText.includes("existing job")
    );

  return needsSpecificJobState;
}

function isGenericBrowserEntryRoute(
  route: string
): boolean {
  const normalizedRoute = route
    .trim()
    .replace(/\/$/, "");

  if (
    normalizedRoute === "/company/jobs/create" ||
    normalizedRoute === "/company/jobs/new"
  ) {
    return true;
  }

  return new Set([
    "/company/jobs",
    "/company/all-jobs",
    "/company/work-setups",
    "/company/all-work-setups",
    "/company/all-payments",
    "/company/contracts",
    "/talent/jobs",
    "/talent/payments",
  ]).has(normalizedRoute);
}

function getUrlAssertionQueryKey(
  expected: string
): string | null {
  const match =
    String(expected || "")
      .trim()
      .match(
        /(?:^|[?&])([A-Za-z][A-Za-z0-9_.-]*)=/
      );

  return match?.[1]?.toLowerCase() ?? null;
}

function isGenericPaymentsNavigationLabel(
  value: unknown
): boolean {
  const normalized =
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  return new Set([
    "payment",
    "payments",
    "all payment",
    "all payments",
    "timesheet",
    "timesheets",
    "all timesheet",
    "all timesheets",
  ]).has(normalized);
}

function hasOrderedBrowserActions(
  steps: any[],
  firstAction: string,
  secondAction: string
): boolean {
  let firstActionSeen = false;

  for (const step of steps) {
    const action =
      String(step?.action || "");

    if (action === firstAction) {
      firstActionSeen = true;
      continue;
    }

    if (
      firstActionSeen &&
      action === secondAction
    ) {
      return true;
    }
  }

  return false;
}

function hasRuntimeFilterSelectionPrerequisite(
  steps: any[],
  expectedQueryKey: string
): boolean {
  let menuOpened = false;

  for (const step of steps) {
    const action =
      String(step?.action || "");

    if (action === "openMenu") {
      menuOpened = true;
      continue;
    }

    if (
      menuOpened &&
      action ===
        "selectRuntimeFilterOption" &&
      String(
        step?.queryKey || ""
      )
        .trim()
        .toLowerCase() ===
        expectedQueryKey
          .trim()
          .toLowerCase()
    ) {
      return true;
    }
  }

  return false;
}

function hasUrlAssertionStatePrerequisite(
  args: {
    stepsBeforeAssertion: any[];
    expected: string;
    startRoute: string;
  }
): boolean {
  const {
    stepsBeforeAssertion,
    expected,
    startRoute,
  } = args;

  if (
    expected &&
    startRoute.includes(expected)
  ) {
    return true;
  }

  const hasJobCreationRedirectAction =
    stepsBeforeAssertion.some(
      (step: any) =>
        step?.action ===
        "createDraftJobAndVerifyRedirect"
    );

  if (
    hasJobCreationRedirectAction &&
    new Set([
      "/company/jobs/",
      "/company/all-jobs/",
      "project=",
    ]).has(expected)
  ) {
    return true;
  }

  const queryKey =
    getUrlAssertionQueryKey(expected);

  /*
   * Positive query assertions must use an exact
   * query-key substring such as "tab=".
   *
   * Bare strings such as "tab" or "project" are
   * too broad and can accidentally match unrelated
   * paths, text, or parameter names.
   */
  if (!queryKey) {
    return false;
  }

  if (queryKey === "tab") {
    return stepsBeforeAssertion.some(
      (step: any) =>
        step?.action ===
          "selectRuntimeTopTab" ||
        (
          step?.action ===
            "clickTopTab" &&
          String(
            step?.text || ""
          ).trim() &&
          !isGenericPaymentsNavigationLabel(
            step?.text
          )
        )
    );
  }

  if (queryKey === "project") {
    return (
      hasRuntimeFilterSelectionPrerequisite(
        stepsBeforeAssertion,
        queryKey
      ) ||
      hasOrderedBrowserActions(
        stepsBeforeAssertion,
        "clickProjectDropdown",
        "selectLastDropdownOption"
      ) ||
      hasOrderedBrowserActions(
        stepsBeforeAssertion,
        "openMenu",
        "selectOption"
      )
    );
  }

  /*
   * Generic filter query keys require an actual
   * option selection. Merely opening a menu does
   * not establish URL state.
   */
  if (
    hasRuntimeFilterSelectionPrerequisite(
      stepsBeforeAssertion,
      queryKey
    ) ||
    hasOrderedBrowserActions(
      stepsBeforeAssertion,
      "openMenu",
      "selectOption"
    )
  ) {
    return true;
  }

  /*
   * Non-filter tab-like URL keys may be established
   * by a real tab interaction, but generic sidebar
   * navigation labels are deliberately excluded.
   */
  return stepsBeforeAssertion.some(
    (step: any) =>
      step?.action === "clickTopTab" &&
      String(step?.text || "").trim() &&
      !isGenericPaymentsNavigationLabel(
        step?.text
      )
  );
}

function escapeRegularExpression(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function hasSourceGroundedQueryAssertion(
  expected: string,
  sourceContext: string
): boolean {
  const match =
    /^([A-Za-z][A-Za-z0-9_.-]*)=([^\s&#]*)$/
      .exec(expected);

  if (!match) {
    return true;
  }

  /*
   * An exact literal such as "?tab=" or
   * "tab=processed" is always sufficient.
   */
  if (sourceContext.includes(expected)) {
    return true;
  }

  const queryKey = match[1] ?? "";
  const assertedValue = match[2] ?? "";

  /*
   * Value-specific assertions require the exact
   * literal mapping in source context.
   */
  if (!queryKey || assertedValue) {
    return false;
  }

  const escapedKey =
    escapeRegularExpression(queryKey);

  const groundedKeyPatterns = [
    /*
     * searchParams.get("tab")
     * queryParams.set("project", ...)
     */
    new RegExp(
      `\\b[A-Za-z_$][A-Za-z0-9_$]*` +
        `(?:Params|Parameters)` +
        `\\s*\\.\\s*` +
        `(?:get|set|append|delete|has)` +
        `\\s*\\(\\s*["'\`]` +
        `${escapedKey}["'\`]`,
      "i"
    ),

    /*
     * queryKey: "project"
     * queryParameter = "tab"
     */
    new RegExp(
      `\\b(?:queryKey|queryParam|queryParameter)` +
        `\\s*[:=]\\s*["'\`]` +
        `${escapedKey}["'\`]`,
      "i"
    ),

    /*
     * "tab query parameter"
     */
    new RegExp(
      `\\b${escapedKey}\\b\\s+` +
        `(?:query\\s+)?` +
        `(?:key|parameter|param)\\b`,
      "i"
    ),

    /*
     * "query parameter tab"
     */
    new RegExp(
      `\\b(?:query\\s+)?` +
        `(?:key|parameter|param)\\s+` +
        `(?:named\\s+)?["'\`]?` +
        `${escapedKey}["'\`]?\\b`,
      "i"
    ),
  ];

  return groundedKeyPatterns.some(
    (pattern) => pattern.test(sourceContext)
  );
}

function normalizeSourceGroundedVisibleText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVerbatimSourceGroundedVisibleText(
  expectedText: string,
  sourceContext: string
): boolean {
  const expected =
    normalizeSourceGroundedVisibleText(
      expectedText
    );

  if (!expected) {
    return false;
  }

  const source =
    normalizeSourceGroundedVisibleText(
      sourceContext
    );

  return source.includes(expected);
}

function normalizePlannerScopeList(
  value: unknown
): string[] {
  const values =
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : [];

  return [
    ...new Set(
      values
        .map((item) =>
          String(item ?? "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean)
    ),
  ];
}

function splitPlannerCriteria(
  value: unknown
): string[] {
  const text =
    Array.isArray(value)
      ? value.join("\n")
      : String(value ?? "");

  return text
    .split(
      /(?:\r?\n)+|(?<=[.!?])\s+/
    )
    .map((item) =>
      item.replace(/\s+/g, " ").trim()
    )
    .filter(Boolean);
}

function buildAutomatedCheckFromStep(
  step: any
): string | null {
  const action = String(
    step?.action || ""
  );

  const text = String(
    step?.text ||
      step?.target ||
      ""
  ).trim();

  if (
    action === "assertTextVisible" &&
    text
  ) {
    return `Verify "${text}" is visible.`;
  }

  if (
    action === "assertTextNotVisible" &&
    text
  ) {
    return `Verify "${text}" is not visible.`;
  }

  if (
    action === "assertUrlContains" &&
    text
  ) {
    return `Verify the URL contains "${text}".`;
  }

  if (
    action === "assertUrlNotContains" &&
    text
  ) {
    return `Verify the URL does not contain "${text}".`;
  }

  if (
    action === "openRuntimeControl" &&
    text
  ) {
    return `Verify the runtime control "${text}" opens.`;
  }

  if (
    action ===
    "createDraftJobAndVerifyRedirect"
  ) {
    return (
      "Verify the QA-owned draft job is created, " +
      "redirected to its concrete details route, " +
      "and cleaned up exactly."
    );
  }

  return null;
}

/*
 * PLANNER_URL_SYNC_STEP_NORMALIZER_V1
 *
 * Canonicalize the safe browser flow that verifies one
 * runtime tab and one runtime filter through URL query keys.
 *
 * This prevents harmless LLM variation such as reloading
 * once per query key versus reloading once after both
 * interactions from creating structural planner drift.
 *
 * Cases containing any additional action are left unchanged.
 */
function normalizePlannerUrlSynchronizationSteps(
  plan: any
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const allowedActions =
    new Set([
      "selectRuntimeTopTab",
      "assertUrlContains",
      "openMenu",
      "selectRuntimeFilterOption",
      "reload",
    ]);

  let normalizedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    if (
      steps.length === 0 ||
      steps.some(
        (step: any) =>
          !allowedActions.has(
            String(step?.action || "")
          )
      )
    ) {
      continue;
    }

    const tabSteps =
      steps.filter(
        (step: any) =>
          step?.action ===
          "selectRuntimeTopTab"
      );

    const menuSteps =
      steps.filter(
        (step: any) =>
          step?.action === "openMenu"
      );

    const filterSteps =
      steps.filter(
        (step: any) =>
          step?.action ===
          "selectRuntimeFilterOption"
      );

    const reloadSteps =
      steps.filter(
        (step: any) =>
          step?.action === "reload"
      );

    if (
      tabSteps.length !== 1 ||
      menuSteps.length !== 1 ||
      filterSteps.length !== 1 ||
      reloadSteps.length < 1
    ) {
      continue;
    }

    const filterStep =
      filterSteps[0];

    const queryKey =
      String(
        filterStep?.queryKey || ""
      ).trim();

    if (!queryKey) {
      continue;
    }

    const expectedFilterAssertion =
      `${queryKey}=`;

    const urlAssertions =
      steps.filter(
        (step: any) =>
          step?.action ===
          "assertUrlContains"
      );

    const hasTabAssertion =
      urlAssertions.some(
        (step: any) =>
          String(step?.text || "")
            .trim() === "tab="
      );

    const hasFilterAssertion =
      urlAssertions.some(
        (step: any) =>
          String(step?.text || "")
            .trim() ===
          expectedFilterAssertion
      );

    const containsOnlyCanonicalAssertions =
      urlAssertions.every(
        (step: any) => {
          const expected =
            String(step?.text || "")
              .trim();

          return (
            expected === "tab=" ||
            expected ===
              expectedFilterAssertion
          );
        }
      );

    if (
      !hasTabAssertion ||
      !hasFilterAssertion ||
      !containsOnlyCanonicalAssertions
    ) {
      continue;
    }

    browserCase.steps = [
      {
        ...tabSteps[0],
      },
      {
        action: "assertUrlContains",
        text: "tab=",
      },
      {
        ...menuSteps[0],
      },
      {
        ...filterStep,
        queryKey,
      },
      {
        action: "assertUrlContains",
        text: expectedFilterAssertion,
      },
      {
        action: "reload",
      },
      {
        action: "assertUrlContains",
        text: "tab=",
      },
      {
        action: "assertUrlContains",
        text: expectedFilterAssertion,
      },
    ];

    normalizedCases += 1;
  }

  if (normalizedCases > 0) {
    console.log(
      ` Planner URL synchronization normalization: ` +
        `${normalizedCases} browser case(s) normalized.`
    );
  }

  return plan;
}

/*
 * PLANNER_VERDICT_SCOPE_NORMALIZER_V1
 *
 * Keep automatically verifiable behavior separate from
 * manual coverage and runtime fixture prerequisites.
 */
function normalizePlannerBrowserScopes(
  plan: any
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const manualPattern =
    /\b(?:manual|manually|human|checked separately|verify separately|external verification|unsupported interaction|unavailable deterministic oracle)\b/i;

  const fixturePattern =
    /\b(?:fixture|prerequisite|test data|runtime data|lifecycle state|ownership|permission combination|exact permission|route (?:is )?not supplied|record (?:is )?(?:unavailable|missing))\b/i;

  for (const browserCase of browserCases) {
    const criteria =
      splitPlannerCriteria(
        browserCase?.successCriteria
      );

    const plannerAutomatedChecks =
  normalizePlannerScopeList(
    browserCase?.automatedChecks
  );

    const manualChecks =
      normalizePlannerScopeList(
        browserCase?.manualChecks
      );

    const fixtureRequirements =
      normalizePlannerScopeList(
        browserCase?.fixtureRequirements
      );

    const retainedCriteria: string[] = [];

    for (const criterion of criteria) {
      const isManual =
        manualPattern.test(criterion);

      const isFixture =
        fixturePattern.test(criterion);

      if (isManual) {
        manualChecks.push(criterion);
      }

      if (isFixture) {
        fixtureRequirements.push(
          criterion
        );
      }

      if (!isManual && !isFixture) {
        retainedCriteria.push(
          criterion
        );
      }
    }

    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

const derivedAutomatedChecks =
  normalizePlannerScopeList(
    steps
      .map((step: any) =>
        buildAutomatedCheckFromStep(step)
      )
      .filter(Boolean)
  );

const automatedChecks =
  derivedAutomatedChecks.length > 0
    ? derivedAutomatedChecks
    : plannerAutomatedChecks.length > 0
      ? plannerAutomatedChecks
      : retainedCriteria;

    browserCase.automatedChecks =
      normalizePlannerScopeList(
        automatedChecks
      );

    browserCase.manualChecks =
      normalizePlannerScopeList(
        manualChecks
      );

    browserCase.fixtureRequirements =
      normalizePlannerScopeList(
        fixtureRequirements
      );

    if (retainedCriteria.length > 0) {
      browserCase.successCriteria =
        retainedCriteria.join(" ");
    } else if (
      browserCase.automatedChecks.length > 0
    ) {
      browserCase.successCriteria =
        browserCase.automatedChecks.join(
          " "
        );
    } else {
      browserCase.successCriteria =
        String(
          browserCase?.goal ||
            "Verify the scoped product behavior."
        ).trim();
    }
  }

  return plan;
}

/*
 * MULTIWORD_UI_ASSERTION_PROVENANCE_GATE_V1
 *
 * Positive multi-word visible-text assertions are executable
 * only when the exact case-sensitive UI text occurs verbatim
 * in Jira/change-context/GitHub input.
 *
 * Semantic prose such as "document requirement" must not be
 * transformed into an invented title-cased UI oracle such as
 * "Document Requirement".
 */
function applyBrowserTextAssertionProvenanceGate(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const groundedSourceContext =
    String(sourceContext || "");

  let blockedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    const unsupportedAssertions =
      steps
        .filter(
          (step: any) =>
            step?.action ===
            "assertTextVisible"
        )
        .map((step: any) =>
          normalizeSourceGroundedVisibleText(
            step?.text
          )
        )
        .filter((expected: string) => {
          const wordCount =
            expected
              .split(/\s+/)
              .filter(Boolean)
              .length;

          return (
            wordCount >= 2 &&
            !hasVerbatimSourceGroundedVisibleText(
              expected,
              groundedSourceContext
            )
          );
        });

    if (unsupportedAssertions.length === 0) {
      delete browserCase
        .runtimeTextAssertionProvenanceFailure;

      continue;
    }

    const uniqueUnsupportedAssertions =
      [...new Set(unsupportedAssertions)];

    const failureReason =
      `Browser text assertion provenance gate blocked ` +
      `${browserCase?.id || "case"}: positive visible-text ` +
      `assertion(s) ${uniqueUnsupportedAssertions
        .map((value) => `"${value}"`)
        .join(", ")} do not occur verbatim with matching ` +
      `case in Jira, change context, or GitHub diff input.`;

    browserCase
      .runtimeTextAssertionProvenanceFailure =
        failureReason;

    blockedCases += 1;

    console.log(` ${failureReason}`);
  }

  console.log(
    ` Browser text assertion provenance gate: ` +
      `${blockedCases} case(s) blocked.`
  );

  return plan;
}

function applyBrowserUrlAssertionPrerequisiteGate(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const groundedSourceContext =
    String(sourceContext || "");

  let blockedCases = 0;

  for (const browserCase of browserCases) {
    const steps =
      Array.isArray(browserCase?.steps)
        ? browserCase.steps
        : [];

    const startRoute =
      String(
        browserCase?.startRoute || ""
      );

    const caseText = [
      browserCase?.goal,
      browserCase?.successCriteria,
      JSON.stringify(steps),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const hasUrlSynchronizationIntent =
      (
        /\burl\b/.test(caseText) ||
        caseText.includes(
          "query parameter"
        ) ||
        caseText.includes(
          "query key"
        ) ||
        caseText.includes(
          "query string"
        )
      );

    const hasUrlAssertion =
      steps.some(
        (step: any) =>
          step?.action ===
            "assertUrlContains" ||
          step?.action ===
            "assertUrlNotContains"
      );

    let failureReason = "";

    /*
     * A case whose acceptance goal is URL/query
     * synchronization cannot PASS from visual text
     * assertions alone.
     */
    if (
      hasUrlSynchronizationIntent &&
      !hasUrlAssertion
    ) {
      failureReason =
        `Browser URL assertion gate blocked ` +
        `${browserCase?.id || "case"}: ` +
        `the case requires URL/query synchronization ` +
        `but contains no deterministic URL assertion.`;
    }

    if (!failureReason) {
      for (
        let index = 0;
        index < steps.length;
        index += 1
      ) {
        const step = steps[index];

        if (
          step?.action !==
          "assertUrlContains"
        ) {
          continue;
        }

        const expected =
          String(step?.text || "").trim();

        /*
         * EXACT_QUERY_ASSERTION_PROVENANCE_GATE_V1
         *
         * An executable exact query assertion must occur
         * verbatim in Jira/change-context/GitHub input.
         * Prompt examples and planner inference are not
         * sufficient product contracts.
         */
        const queryAssertion =
          /^[A-Za-z][A-Za-z0-9_.-]*=[^\s&#]*$/
            .test(expected);

        if (
          queryAssertion &&
          !hasSourceGroundedQueryAssertion(
            expected,
            groundedSourceContext
          )
        ) {
          failureReason =
            `Browser URL assertion provenance gate blocked ` +
            `${browserCase?.id || "case"}: query assertion ` +
            `"${expected}" has no exact literal or ` +
            `source-grounded query-key contract in Jira, ` +
            `change context, or GitHub diff input.`;

          break;
        }

        const stepsBeforeAssertion =
          steps.slice(0, index);

        const prerequisiteEstablished =
          hasUrlAssertionStatePrerequisite({
            stepsBeforeAssertion,
            expected,
            startRoute,
          });

        if (prerequisiteEstablished) {
          continue;
        }

        const bareQueryKey =
          /^[A-Za-z][A-Za-z0-9_.-]*$/
            .test(expected);

        failureReason =
          `Browser URL assertion gate blocked ` +
          `${browserCase?.id || "case"}: ` +
          `positive URL assertion ` +
          `"${expected || "(empty)"}" ` +
          (
            bareQueryKey
              ? `must use an exact query-key substring ` +
                `including "=" and `
              : ""
          ) +
          `has no matching preceding state-establishing ` +
          `interaction and is not already present in ` +
          `startRoute "${startRoute || "UNKNOWN"}".`;

        break;
      }
    }

    if (failureReason) {
      browserCase
        .runtimeUrlAssertionPrerequisiteFailure =
          failureReason;

      blockedCases += 1;

      console.log(
        ` ${failureReason}`
      );
    } else {
      delete browserCase
        .runtimeUrlAssertionPrerequisiteFailure;
    }
  }

  console.log(
    ` Browser URL assertion prerequisite gate: ` +
      `${blockedCases} case(s) blocked.`
  );

  return plan;
}

function enrichTestPlanWithDiscovery(plan: any): any {
  const apiCases = Array.isArray(plan?.apiCases)
    ? plan.apiCases
    : [];

  const browserCases = Array.isArray(plan?.browserCases)
    ? plan.browserCases
    : [];

  let resolvedApiPaths = 0;
  let resolvedApiMethods = 0;
  let resolvedBrowserRoutes = 0;

  for (const apiCase of apiCases) {
    const needsPathResolution = isUnknownApiPath(
      apiCase?.path
    );

    const needsMethodResolution = isUnknownMethod(
      apiCase?.method
    );

    if (!needsPathResolution && !needsMethodResolution) {
      continue;
    }

    /**
     * Do not guess both the HTTP method and endpoint.
     * Apply/reject-style cases must stay unresolved until
     * their canonical API contract is known.
     */
    if (needsMethodResolution) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `HTTP method is unknown.`
      );
      continue;
    }

    /**
     * Mutating operations require an exact canonical endpoint.
     * Area-level catalog scoring is not sufficient because it
     * can incorrectly map change-request creation to job creation.
     */
    if (
      needsPathResolution &&
      isMutatingApiMethod(apiCase?.method)
    ) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `${String(apiCase?.method || "").toUpperCase()} path requires an exact contract.`
      );
      continue;
    }

    const candidate = findApiEndpointCandidateFromCatalog(
      plan,
      apiCase
    );

    if (!candidate) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: no candidate.`
      );
      continue;
    }

    if (candidate.confidence !== "high") {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `${candidate.confidence} confidence candidate ${candidate.method} ${candidate.path}.`
      );
      continue;
    }

    if (needsPathResolution) {
      const originalPath = apiCase.path;

      apiCase.path = mergeResolvedApiPath(
        originalPath,
        candidate.path
      );

      resolvedApiPaths += 1;
    }

    if (needsMethodResolution) {
      apiCase.method = candidate.method;
      resolvedApiMethods += 1;
    }

    console.log(
      ` Discovery enriched API ${apiCase?.id ?? "case"}: ` +
        `${apiCase.method} ${apiCase.path} (${candidate.confidence})`
    );
  }

  for (const browserCase of browserCases) {
    if (!isUnknownBrowserRoute(browserCase?.startRoute)) {
      continue;
    }

    const deepCase =
      isDeepBrowserCase(browserCase);

    const candidate = discoverBrowserRouteCandidates(
      plan,
      browserCase
    ).find((item) => {
      if (item.confidence !== "high") {
        return false;
      }

      if (!isConcretePlannerRoute(item.route)) {
        return false;
      }

      if (
  !isExplicitBrowserSurfaceRouteCompatible(
    browserCase,
    item.route
  )
) {
  return false;
}

      /**
       * A generic list/landing page is not enough for
       * job details, comparison, modal, or review cases.
       */
      if (
        deepCase &&
        isGenericBrowserEntryRoute(item.route)
      ) {
        return false;
      }

      return true;
    });

    if (!candidate) {
      console.log(
        ` Discovery enrichment left browser ${browserCase?.id ?? "case"} unresolved: ` +
          `${
            deepCase
              ? "deep UI case has no safe concrete detail route."
              : "no high-confidence concrete route."
          }`
      );
      continue;
    }

    browserCase.startRoute = candidate.route;
    resolvedBrowserRoutes += 1;

    console.log(
      ` Discovery enriched browser ${browserCase?.id ?? "case"}: ` +
        `${candidate.route} (${candidate.confidence}, ${candidate.source})`
    );
  }

  console.log(
    ` Discovery enrichment summary: ` +
      `${resolvedApiPaths} API paths, ` +
      `${resolvedApiMethods} API methods, ` +
      `${resolvedBrowserRoutes} browser routes resolved.`
  );

  return plan;
}

const MAX_API_CASES = 4;
const MAX_BROWSER_CASES = 4;

function normalizePlannerFingerprintText(
  value: unknown
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,
      "{id}"
    )
    .replace(
      /\/\d+(?=\/|$|\?)/g,
      "/{id}"
    )
    .replace(
      /([?&][^=&#]+=)\d+(?=(&|$))/g,
      "$1{id}"
    )
    .replace(/\s+/g, " ");
}

function stablePlannerValue(
  value: any
): any {
  if (Array.isArray(value)) {
    return value.map(
      stablePlannerValue
    );
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.keys(value)
      .sort()
      .reduce(
        (
          result: Record<string, any>,
          key
        ) => {
          result[key] =
            stablePlannerValue(
              value[key]
            );

          return result;
        },
        {}
      );
  }

  return value;
}

function plannerValueFingerprint(
  value: any
): string {
  try {
    return JSON.stringify(
      stablePlannerValue(value)
    );
  } catch {
    return String(value ?? "");
  }
}

function getApiCaseFingerprint(
  testCase: any
): string {
  return [
    normalizePlannerFingerprintText(
      testCase?.persona
    ),
    normalizePlannerFingerprintText(
      testCase?.method
    ),
    normalizePlannerFingerprintText(
      testCase?.path
    ),
    String(
      testCase?.expect?.status ?? ""
    ),
    plannerValueFingerprint(
      testCase?.body ?? {}
    ),
  ].join("|");
}

function getBrowserStepsFingerprint(
  testCase: any
): string {
  if (!Array.isArray(testCase?.steps)) {
    return "";
  }

  return testCase.steps
    .map((step: any) =>
      [
        normalizePlannerFingerprintText(
          step?.action
        ),
        normalizePlannerFingerprintText(
          step?.text
        ),
        String(step?.ms ?? ""),
        String(step?.width ?? ""),
        String(step?.height ?? ""),
      ].join(":")
    )
    .join(">");
}

function getBrowserCaseFingerprint(
  testCase: any
): string {
  return [
    normalizePlannerFingerprintText(
      testCase?.persona
    ),
    normalizePlannerFingerprintText(
      testCase?.startRoute
    ),

    getBrowserStepsFingerprint(
      testCase
    ),
  ].join("|");
}

function getMissingDependencyFingerprint(
  testCase: any,
  kind: "api" | "browser"
): string | null {
  if (kind === "api") {
    const method =
      normalizePlannerFingerprintText(
        testCase?.method
      );

    const apiPath =
      normalizePlannerFingerprintText(
        testCase?.path
      );

    if (
      !method ||
      method === "unknown" ||
      !apiPath ||
      apiPath.startsWith("unknown")
    ) {
      /*
       * Preserve meaningful query distinctions such as
       * UNKNOWN?type=publish-request versus
       * UNKNOWN?type=field-update-request, but do not
       * create repeated cases for the same missing contract.
       */
      return [
        "api-dependency",
        method || "unknown",
        apiPath || "unknown",
      ].join("|");
    }

    return null;
  }

  const startRoute =
    normalizePlannerFingerprintText(
      testCase?.startRoute
    );

  if (
    !startRoute ||
    startRoute === "unknown"
  ) {
    return [
      "browser-route-dependency",
      normalizePlannerFingerprintText(
        testCase?.persona
      ),
      getBrowserStepsFingerprint(
        testCase
      ),
    ].join("|");
  }

  return null;
}

function deduplicatePlannerCases(
  cases: any[],
  kind: "api" | "browser"
): any[] {
  const seenCases =
    new Set<string>();

  const seenMissingDependencies =
    new Set<string>();

  const result: any[] = [];

  for (const testCase of cases) {
    const fingerprint =
      kind === "api"
        ? getApiCaseFingerprint(
            testCase
          )
        : getBrowserCaseFingerprint(
            testCase
          );

    if (seenCases.has(fingerprint)) {
      continue;
    }

    const dependencyFingerprint =
      getMissingDependencyFingerprint(
        testCase,
        kind
      );

    if (
      dependencyFingerprint &&
      seenMissingDependencies.has(
        dependencyFingerprint
      )
    ) {
      continue;
    }

    seenCases.add(fingerprint);

    if (dependencyFingerprint) {
      seenMissingDependencies.add(
        dependencyFingerprint
      );
    }

    result.push(testCase);
  }

  return result;
}

/*
 * INVOICE_DRAWER_SEMANTIC_DEDUP_V1
 *
 * Payments ve All Payments açıklamaları discovery
 * sonrasında aynı executable route ve aynı invoice
 * state davranışına dönüşebilir.
 *
 * Aynı davranıştan birden fazla case varsa daha fazla
 * explicit assertion içeren case tutulur.
 */
function mergeInvoiceDrawerSemanticDuplicates(
  cases: any[]
): any[] {
  const result: any[] = [];

  const resultIndexByKey =
    new Map<string, number>();

  const getCaseScore = (
    testCase: any
  ): number => {
    const steps =
      Array.isArray(testCase?.steps)
        ? testCase.steps
        : [];

    const assertionCount =
      steps.filter(
        (step: any) =>
          normalizePlannerFingerprintText(
            step?.action
          ).startsWith("assert")
      ).length;

    return (
      assertionCount * 100 +
      steps.length
    );
  };

  const getStableValue = (
    testCase: any
  ): string => {
    const value = {
      ...(testCase ?? {}),
    };

    delete value.id;

    return plannerValueFingerprint(
      value
    );
  };

  for (const testCase of cases) {
    const steps =
      Array.isArray(testCase?.steps)
        ? testCase.steps
        : [];

    const caseText = [
      String(testCase?.goal || ""),
      String(
        testCase?.successCriteria || ""
      ),
      JSON.stringify(steps),
    ].join(" ");

    const invoiceStateStep =
      steps.find(
        (step: any) => {
          const action =
            normalizePlannerFingerprintText(
              step?.action
            );

          const text =
            normalizePlannerFingerprintText(
              step?.text
            );

          return (
            action === "clicktoptab" &&
            [
              "sent for processing",
              "processed",
            ].includes(text)
          );
        }
      );

    const invoiceState =
      normalizePlannerFingerprintText(
        invoiceStateStep?.text
      );

    const isInvoiceDrawerCase =
      /invoice/i.test(caseText) &&
      /(drawer|details)/i.test(
        caseText
      );

    const semanticKey =
      isInvoiceDrawerCase &&
      invoiceState
        ? [
            "invoice-drawer",
            normalizePlannerFingerprintText(
              testCase?.persona
            ),
            normalizePlannerFingerprintText(
              testCase?.startRoute
            ),
            invoiceState,
            normalizePlannerFingerprintText(
              testCase
                ?.runtimeFixturePolicy
            ),
          ].join("|")
        : null;

    if (!semanticKey) {
      result.push(testCase);
      continue;
    }

    const existingIndex =
      resultIndexByKey.get(
        semanticKey
      );

    if (existingIndex === undefined) {
      resultIndexByKey.set(
        semanticKey,
        result.length
      );

      result.push(testCase);
      continue;
    }

    const existingCase =
      result[existingIndex];

    const candidateScore =
      getCaseScore(testCase);

    const existingScore =
      getCaseScore(existingCase);

    const candidateIsPreferred =
      candidateScore > existingScore ||
      (
        candidateScore ===
          existingScore &&
        getStableValue(testCase) <
          getStableValue(existingCase)
      );

    if (candidateIsPreferred) {
      result[existingIndex] =
        testCase;
    }
  }

  return result;
}

function applyPlannerCaseLimits(
  plan: any
): any {
  const rawApiCases =
    Array.isArray(plan?.apiCases)
      ? plan.apiCases
      : [];

  const rawBrowserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const distinctApiCases =
    deduplicatePlannerCases(
      rawApiCases,
      "api"
    );

const mergedBrowserCases =
  mergeInvoiceDrawerSemanticDuplicates(
    rawBrowserCases
  );

if (
  mergedBrowserCases.length !==
  rawBrowserCases.length
) {
  console.log(
    ` Planner semantic invoice dedup: ` +
      `${rawBrowserCases.length} -> ` +
      `${mergedBrowserCases.length} ` +
      `browser cases.`
  );
}

const distinctBrowserCases =
  deduplicatePlannerCases(
    mergedBrowserCases,
    "browser"
  );

  const limitedApiCases =
    distinctApiCases
      .slice(0, MAX_API_CASES)
      .map(
        (
          testCase: any,
          index: number
        ) => ({
          ...testCase,
          id: `api-${index + 1}`,
        })
      );

  const limitedBrowserCases =
    distinctBrowserCases
      .slice(0, MAX_BROWSER_CASES)
      .map(
        (
          testCase: any,
          index: number
        ) => ({
          ...testCase,
          id: `web-${index + 1}`,
        })
      );

  const originalTotal =
    rawApiCases.length +
    rawBrowserCases.length;

  const retainedTotal =
    limitedApiCases.length +
    limitedBrowserCases.length;

  const removedTotal =
    originalTotal -
    retainedTotal;

  plan.apiCases =
    limitedApiCases;

  plan.browserCases =
    limitedBrowserCases;

  if (removedTotal > 0) {
    const capNote =
      `Planner case budget applied: retained ` +
      `${limitedApiCases.length} API and ` +
      `${limitedBrowserCases.length} browser cases; ` +
      `${removedTotal} duplicate, repeated-dependency, ` +
      `or lower-priority overflow case(s) were omitted.`;

    plan.notes = [
      String(plan?.notes || "").trim(),
      capNote,
    ]
      .filter(Boolean)
      .join(" ");
  }

  console.log(
    ` Planner case budget: ` +
      `${rawApiCases.length} -> ` +
      `${limitedApiCases.length} API, ` +
      `${rawBrowserCases.length} -> ` +
      `${limitedBrowserCases.length} browser.`
  );

  return plan;
}

/*
 * PLANNER_FIXTURE_POLICY_V1
 *
 * The LLM is instructed to distinguish an exact
 * Jira identity from a GitHub/test fixture.
 *
 * This deterministic gate provides the safe
 * fallback for invoice cases:
 *
 * - invoice appears in Jira section:
 *     exact
 * - invoice appears only outside Jira:
 *     compatible-state
 * - no Jira identity + grounded invoice state:
 *     compatible-state through the specialized resolver
 * - missing invoice state:
 *     exact
 *
 * compatible-state is currently accepted only for
 * invoice cases handled by the specialized invoice
 * runtime resolver.
 */
function extractPlannerJiraSection(
  sourceContext: string
): string {
  const jiraMarker =
    "--- JIRA TICKET ---";

  const githubMarker =
    "--- GITHUB CHANGE CONTEXT ---";

  const jiraStart =
    sourceContext.indexOf(
      jiraMarker
    );

  if (jiraStart < 0) {
    /*
     * Without reliable source boundaries, use the
     * whole context as Jira-equivalent. This safely
     * defaults concrete identities to exact.
     */
    return sourceContext;
  }

  const githubStart =
    sourceContext.indexOf(
      githubMarker,
      jiraStart +
        jiraMarker.length
    );

  if (githubStart < 0) {
    return sourceContext.slice(
      jiraStart
    );
  }

  return sourceContext.slice(
    jiraStart,
    githubStart
  );
}

function findInvoiceNumbers(
  value: unknown
): string[] {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(
          value ?? {}
        );

  const matches =
    text.match(
      /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/gi
    ) ?? [];

  return [
    ...new Set(
      matches.map(
        (match) =>
          match.toUpperCase()
      )
    ),
  ];
}

/*
 * AS1014_INVOICE_STATE_SPLIT_V1
 *
 * The planner may merge sent-for-processing and
 * processed coverage into one browser case.
 *
 * Split that combined case before discovery and
 * deduplication so the two material states cannot
 * collapse into one executable case.
 */
function splitCombinedInvoiceStateCases(
  plan: any
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const expandedCases: any[] = [];

  for (const browserCase of browserCases) {
    const caseText = [
      String(browserCase?.goal || ""),
      String(
        browserCase?.successCriteria ||
          ""
      ),
      JSON.stringify(
        browserCase?.steps ?? []
      ),
    ].join(" ");

    const isInvoiceDrawerCase =
      /invoice/i.test(caseText) &&
      /(drawer|details)/i.test(
        caseText
      );

    const containsSentState =
      /sent\s+for\s+processing/i.test(
        caseText
      );

    const containsProcessedState =
      /\bprocessed\b/i.test(
        caseText
      );

    if (
      !isInvoiceDrawerCase ||
      !containsSentState ||
      !containsProcessedState
    ) {
      expandedCases.push(
        browserCase
      );

      continue;
    }

    expandedCases.push(
      {
        ...browserCase,
        id:
          `${String(
            browserCase?.id || "web"
          )}-sent`,
        __plannerInvoiceState:
          "sent for processing",
      },
      {
        ...browserCase,
        id:
          `${String(
            browserCase?.id || "web"
          )}-processed`,
        __plannerInvoiceState:
          "processed",
      }
    );
  }

  plan.browserCases =
    expandedCases;

  return plan;
}

function applyPlannerRuntimeFixturePolicies(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const jiraSection =
    extractPlannerJiraSection(
      sourceContext
    );

  const jiraInvoices =
    new Set(
      findInvoiceNumbers(
        jiraSection
      )
    );

  const sourceInvoices =
    findInvoiceNumbers(
      sourceContext
    );

  const compatibleCandidates =
    sourceInvoices.filter(
      (invoiceNumber) =>
        !jiraInvoices.has(
          invoiceNumber
        )
    );

  const policyNotes: string[] = [];

  for (
    const browserCase
    of browserCases
  ) {
    const goal =
      String(
        browserCase?.goal || ""
      );

    const successCriteria =
      String(
        browserCase
          ?.successCriteria || ""
      );

    const caseText = [
      goal,
      successCriteria,
      JSON.stringify(
        browserCase?.steps ?? []
      ),
    ].join(" ");

        const plannerInvoiceState =
      String(
        browserCase
          ?.__plannerInvoiceState ||
          ""
      )
        .trim()
        .toLowerCase();

    /*
     * Internal planner metadata must not appear
     * in the final generated test plan.
     */
    delete browserCase
      .__plannerInvoiceState;


    const isInvoiceDrawerCase =
      /invoice/i.test(caseText) &&
      /(drawer|details)/i.test(
        caseText
      );

    /*
     * compatible-state is currently supported
     * only by the specialized invoice resolver.
     */
    if (!isInvoiceDrawerCase) {
      browserCase.runtimeFixturePolicy =
        "exact";

      continue;
    }

    const caseInvoices =
      findInvoiceNumbers(
        browserCase
      );

    const exactJiraInvoice =
      caseInvoices.find(
        (invoiceNumber) =>
          jiraInvoices.has(
            invoiceNumber
          )
      );

    if (exactJiraInvoice) {
      browserCase.runtimeFixturePolicy =
        "exact";

      policyNotes.push(
        `${String(
          browserCase?.id ||
          "browser-case"
        )}: exact invoice identity is ` +
        `grounded in Jira.`
      );

      continue;
    }

    const candidateInvoice =
      caseInvoices.find(
        (invoiceNumber) =>
          !jiraInvoices.has(
            invoiceNumber
          )
      ) ??
      compatibleCandidates[0];

    /*
     * INVOICE_RUNTIME_RESOLVER_WITHOUT_HINT_V1
     *
     * A concrete planner invoice is optional. The specialized
     * browser resolver can safely select a runtime invoice and
     * verify the required table state and opened identity.
     */
    const resolverRequestText =
      candidateInvoice ??
      "invoice number";

        const requiredTableView =
      plannerInvoiceState ===
        "sent for processing" ||
      plannerInvoiceState ===
        "processed"
        ? plannerInvoiceState
        : /sent\s+for\s+processing/i.test(
              caseText
            )
          ? "sent for processing"
          : /\bprocessed\b/i.test(
                caseText
              )
            ? "processed"
            : null;

    if (requiredTableView) {
      browserCase.runtimeFixturePolicy =
        "compatible-state";

      /*
       * Convert unstable generic tab steps into a
       * canonical state-specific invoice flow.
       * This also ensures Sent for processing and
       * Processed receive different fingerprints.
       */
      /*
       * SOURCE_GROUNDED_INVOICE_ASSERTIONS_V1
       *
       * Assertion completeness must not depend on which labels
       * the LLM happened to repeat in its generated case.
       */
      const visibleLabels = [
        "Invoice No",
        "Payment Provider",
        "Line Items",
        "Invoice Approved By",
        "Invoice Approved At",
        "Timesheets",
        "ID",
        "Timesheet Approved By",
        "Timesheet Approved At",
      ].filter(
        (label) =>
          hasVerbatimSourceGroundedVisibleText(
            label,
            sourceContext
          )
      );

      const shouldAssertUndefined =
        /\bundefined\b/i.test(
          sourceContext
        );

      const shouldAssertNull =
        /\bnull\b/i.test(
          sourceContext
        );

      const normalizedSteps: any[] = [
        {
          action: "clickTopTab",
          text: requiredTableView,
        },
        {
          action: "clickText",
          text: resolverRequestText,
        },
        {
          action: "wait",
          ms: 1000,
        },
        ...visibleLabels.map(
          (label) => ({
            action:
              "assertTextVisible",
            text: label,
          })
        ),
      ];

      if (
        shouldAssertUndefined
      ) {
        normalizedSteps.push({
          action:
            "assertTextNotVisible",
          text: "undefined",
        });
      }

      if (
        shouldAssertNull
      ) {
        normalizedSteps.push({
          action:
            "assertTextNotVisible",
          text: "null",
        });
      }

      browserCase.steps =
        normalizedSteps;

            /*
       * Each executable case must claim only the
       * single state that its steps verify.
       *
       * Quick timesheet redirection stays in the
       * overall plan notes as manual coverage.
       */
      browserCase.goal =
        `Verify that a compatible company ` +
        `invoice in the ${requiredTableView} ` +
        `state opens the invoice details ` +
        `drawer.`;

      browserCase.successCriteria = [
        `A compatible runtime invoice in the ` +
          `${requiredTableView} state opens ` +
          `the invoice details drawer.`,

        visibleLabels.length > 0
          ? `The drawer displays ` +
            `${visibleLabels.join(", ")}.`
          : "",

        shouldAssertUndefined
          ? `The drawer does not display ` +
            `undefined.`
          : "",

        shouldAssertNull
          ? `The drawer does not display ` +
            `null.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      policyNotes.push(
        `${String(
          browserCase?.id ||
          "browser-case"
        )}: compatible-state invoice ` +
        `flow normalized for ` +
        `"${requiredTableView}" using ` +
        `resolver hint ${
          candidateInvoice ??
          "invoice number"
        }; ` +
        `quick timesheet redirection ` +
        `remains manual-only.`
      );

      continue;
    }

    browserCase.runtimeFixturePolicy =
      "exact";

    policyNotes.push(
      `${String(
        browserCase?.id ||
        "browser-case"
      )}: exact fixture policy used ` +
      `because the required invoice ` +
      `table state could not be resolved.`
    );
  }

  if (
    policyNotes.length > 0
  ) {
    plan.notes = [
      String(
        plan?.notes || ""
      ).trim(),
      `Planner runtime fixture policy: ` +
        policyNotes.join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return plan;
}

function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  const children = node.content?.map(adfToText).join("") ?? "";

  if (node.type === "heading") return `\n${children}\n`;
  if (node.type === "paragraph") return `${children}\n`;
  if (node.type === "listItem") return `- ${children.trim()}\n`;

  return children;
}

function stripMarkdownFences(raw: string): string {
  return String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractFirstJsonObject(raw: string): string {
  const text = stripMarkdownFences(raw);

  const start = text.indexOf("{");

  if (start === -1) {
    throw new Error("Model output does not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("Model output contains an incomplete JSON object.");
}

function removeKnownBadJsonLines(jsonText: string): string {
  const lines = jsonText.split("\n");

  return lines
    .filter((line, index) => {
      const trimmed = line.trim();
      const nextLine = lines[index + 1]?.trim() || "";

      /**
       * Fixes invalid model mistakes like:
       *
       * {
       *   "id": "api-4",
       *   "company_admin",
       *   "persona": "company_admin"
       * }
       *
       * A standalone string line inside an object is invalid JSON.
       */
      const isStandaloneString = /^"[^"]+"\s*,?$/.test(trimmed);
      const nextLooksLikeProperty = /^"[^"]+"\s*:/.test(nextLine);

      return !(isStandaloneString && nextLooksLikeProperty);
    })
    .join("\n");
}

function removeTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,\s*([}\]])/g, "$1");
}

function cleanJsonOutput(raw: string): string {
  const extracted = extractFirstJsonObject(raw);

  try {
    const parsed = JSON.parse(extracted);
    return JSON.stringify(parsed, null, 2);
  } catch (firstError) {
    const repaired = removeTrailingCommas(removeKnownBadJsonLines(extracted));

    try {
      const parsed = JSON.parse(repaired);
      return JSON.stringify(parsed, null, 2);
    } catch {
      throw firstError;
    }
  }
}

async function repairJsonWithModel(raw: string, parseError: any): Promise<string> {
  console.log("Initial test plan JSON parse failed. Retrying JSON repair...");
  console.log(`Parse error: ${parseError.message}`);

  const repairResponse = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini",
    ...getReasoningOptions(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are a JSON repair assistant.

Return ONLY valid JSON.
Do not use markdown fences.
Do not add explanation.
Do not add new test cases.
Do not remove valid test cases.
Preserve the original test plan schema and content as much as possible.
Only fix invalid JSON syntax.
`,
      },
      {
        role: "user",
        content: `
This test plan failed JSON.parse with this error:

${parseError.message}

Return the corrected valid JSON object only:

${raw}
`,
      },
    ],
  });

  const repairedAnswer = repairResponse.choices[0]?.message.content || "{}";

  return cleanJsonOutput(repairedAnswer);
}

export async function readTicketFiles(ticketId: string) {
  const jiraIssue = await getJiraIssue(ticketId);

  if (!jiraIssue) {
    throw new Error(`Could not fetch Jira issue: ${ticketId}`);
  }

  const descriptionText = adfToText(jiraIssue.description);
  let githubContext = "";

  try {
    githubContext = await getGithubChangeContext(ticketId);
  } catch (error: any) {
    githubContext = `
--- GITHUB CHANGE CONTEXT ---
Could not fetch GitHub changes. Reason: ${error.message}
`;
  }

  return `
--- JIRA TICKET ---
Key: ${jiraIssue.key}
Summary: ${jiraIssue.summary}
Status: ${jiraIssue.status}
Description: ${descriptionText}

${githubContext}
`;
}

export async function generateTestPlan(ticketId: string) {
  const fileContents = await readTicketFiles(ticketId);

  const systemPrompt = `
You are a senior QA engineer. I will give you a real Jira ticket. Create a test plan and return ONLY valid JSON.

Important context:
- You will receive a real Jira ticket and GitHub change context.
- The Jira issue defines the test scope. Treat its summary, description, and acceptance criteria as the authoritative product behavior to test.
- Use GitHub changed files, patches, commit messages, endpoints, routes, components, fields, labels, and UI copy only as technical evidence for behavior already within the Jira scope.
- Do not generate coverage for unrelated, collateral, cleanup, refactor, copy, or regression changes merely because they appear in the same pull request, commit, or merged diff.
- When Jira acceptance criteria are empty, infer scope from the Jira summary and description. Do not treat the entire GitHub diff as the issue scope.
- Before returning JSON, verify that every apiCase and browserCase directly tests the Jira issue. Remove any case whose only justification is that it appears in the same GitHub change.
- If GitHub context is missing or incomplete, mark unknown paths/routes as "UNKNOWN" instead of inventing them.
- Do not reuse routes, issue names, or test data from previous issues.
- Every concrete fixture value must be grounded in the supplied Jira ticket or GitHub change context. This includes numeric IDs, UUIDs, project names, skill names, talent names, job names, invoice numbers, emails, labels, record titles, and query-parameter values.
- Before using a concrete fixture value in an API path, query string, request body, browser click step, browser assertion, goal, or success criterion, verify that the exact value appears in the supplied context.
- Never create illustrative fixture values such as fake record names, sample IDs, alphabetic example names, or convenient project/skill labels. Examples shown in these instructions describe JSON shape only and are never test data.
- When the required fixture value is not supplied, do not guess it. Keep the route or endpoint unresolved where necessary, describe the missing runtime data, lifecycle state, ownership, or permission prerequisite in fixtureRequirements, and generate a case that will honestly become BLOCKED rather than FAIL.
- Do not click or assert record-specific browser text unless that exact record text is grounded in the supplied context. Stable product UI labels, headings, buttons, tabs, fields, and acceptance-criterion copy may still be asserted when they are supported by Jira or GitHub evidence.
- For assertTextVisible, copy multi-word UI text verbatim from Jira or GitHub evidence. Do not transform a semantic requirement into a guessed title-cased field, column, heading, button, status, or indicator label. When no exact visible label is supplied, omit that exact assertion and place the unsupported human-verification requirement in manualChecks.
- Do not place ungrounded numeric or named values into query parameters. When a query behavior requires unavailable fixture IDs, document the fixture requirement instead of inventing executable values.
- The dedicated createDraftJobAndVerifyRedirect action is allowed to generate its own unique QA-owned job title at runtime. Do not put that generated title or any invented record value into the plan.
- PLANNER_FIXTURE_POLICY_V1: Every browserCase must include runtimeFixturePolicy with either "exact" or "compatible-state".
- Use "exact" when the concrete record identity itself is required by the Jira summary, description, or acceptance criteria. Under exact policy the runner must not replace the requested entity with another runtime record.
- Use "compatible-state" when a concrete record appears in GitHub tests, seed data, mocks, fixtures, examples, or implementation context but Jira requires the behavior or state rather than that exact record identity.
- For invoice drawer cases, compatible-state is also allowed without a planner invoice number when Jira or GitHub grounds the required invoice state and the specialized runtime resolver can safely select and verify a real invoice. Do not invent a concrete invoice value.
- A compatible-state candidate remains only a grounded resolver hint. The goal, successCriteria, and automatedChecks must describe opening a compatible runtime record in the required state and must not claim that the candidate identity itself was opened.
- Never use compatible-state as permission for arbitrary substitution. It is valid only when a specialized runner-owned resolver verifies the required route, table view, entity type, state, and selected runtime identity.
- When exactness is unclear, use "exact". Missing or incompatible fixture data must become BLOCKED with TEST_DATA_ISSUE classification rather than FAIL or MANUAL_REQUIRED.

General rules:
1. Include API cases and browser cases if relevant.
2. Focus on acceptance criteria and risky edge cases.
3. Do not hardcode the old Skills export ticket.
4. API personas may be: "company_admin", "talent", and "unauthenticated".
5. Browser personas may be only: "company_admin" and "talent".
6. Do NOT generate unauthenticated browserCases yet because the browser runner does not support unauthenticated execution. Mention unauthenticated browser coverage in notes instead.
7. Do NOT use unsupported personas such as "company_member".
8. Do NOT invent endpoint paths. If the Jira ticket or GitHub diff does not provide an endpoint base path, set the base path as "UNKNOWN".
8a. If query parameters and their concrete values are clearly visible in the Jira ticket or GitHub diff, append that exact grounded query string after UNKNOWN. If the values are not supplied, do not invent or append query-parameter values. This lets the runner preserve only source-grounded query intent while resolving the base path later.
9. Do NOT invent browser routes. If the Jira ticket or GitHub diff does not provide a route, set "startRoute": "UNKNOWN".
10. When an exact API path template is visible in the GitHub diff, generated API contract, or supplied endpoint catalog, preserve the canonical placeholders such as "{companyId}", "{projectId}", "{jobId}", "{talentId}", "{requestId}", or "{id}". The runner resolves supported placeholders from execution context. Do not invent placeholder names or numeric IDs. Use "UNKNOWN" only when no sufficiently relevant canonical path template is available.
11. For POST, PATCH, or DELETE requests, include a realistic "body" only if the Jira ticket or GitHub diff clearly provides enough information. Otherwise set "path": "UNKNOWN" and explain that GitHub diff/API contract is needed.
12. Generic destructive browser actions remain prohibited. Do not use clickButton, clickText, openMenu, or selectOption to trigger Reject, Delete, Submit, Send, Approve, Archive, Invite, Remove, Save Draft, Publish, Create, or similar state-changing operations. The only permitted browser mutation is createDraftJobAndVerifyRedirect, and only when the Jira scope explicitly requires verification of the post-creation job redirect. That dedicated action creates one uniquely named QA draft, verifies its exact redirect, and cleans up the exact created resource. Next and Previous remain allowed only for safe, non-persisting wizard navigation.
13. Balance meaningful coverage with executability. Missing routes, API contracts, fixtures, or required states should reduce confidence, but must not erase important Jira-scope acceptance coverage. Generate separate cases only for distinct behaviors or states that are directly supported by the Jira scope. GitHub context alone is not sufficient justification for an additional case. Do not generate duplicates that test the same behavior with trivial wording or data changes.
14. Return ONLY valid JSON. No markdown.
15. Never output standalone string values inside objects. Every object field must be a valid "key": value pair.
16. Do not output duplicate malformed fields such as "company_admin", before "persona".
17. Every apiCase object must contain exactly these top-level fields: id, persona, method, path, body, expect.
18. Every browserCase object must contain exactly these top-level fields: id, persona, goal, startRoute, successCriteria, runtimeFixturePolicy, automatedChecks, manualChecks, fixtureRequirements, steps.
19. Decompose the Jira acceptance criteria into distinct testable behaviors before generating cases. Every major acceptance criterion must be covered by at least one API or browser case when relevant. If acceptance criteria are empty, use only the Jira summary and description to establish scope; use the GitHub diff only to discover the implementation details of that scoped behavior.
19a. Every browserCase must separate verdict scope into three arrays:
    - automatedChecks: acceptance criteria that the supported runner steps and captured evidence can verify automatically.
    - manualChecks: acceptance criteria that require human judgment, unsupported interaction, external verification, or an unavailable deterministic oracle.
    - fixtureRequirements: runtime records, lifecycle states, ownership conditions, data shapes, or permission combinations required before execution.
19b. successCriteria must be a concise description of the expected product behavior. Do not put phrases such as route not supplied, prerequisite not supplied, must be checked manually, requires a specific fixture, or checked separately into successCriteria.
19c. A non-empty manualChecks array must not by itself downgrade an otherwise valid automated PASS. Manual checks remain separately reported coverage.
19d. Missing or incompatible fixtureRequirements must produce BLOCKED or TEST_DATA_ISSUE behavior, not an ordinary product FAIL.
19e. automatedChecks must correspond to supported deterministic steps, visible source-grounded UI evidence, URL assertions, or another available automated oracle. Do not claim automated coverage for a criterion that the generated steps cannot verify.
20. The test-case budget is strict:
   - Generate at most 4 apiCases.
   - Generate at most 4 browserCases.
   - Generate at most 8 total cases.
   - Treat these as hard maximums, not target quotas.
   - Order cases from highest to lowest acceptance-criterion and regression value.
   - Merge compatible checks from the same workflow into one case when they use the same persona, route or endpoint, fixture state, and prerequisite chain.
   - Do not create separate cases for trivial wording, data-value, status-code, undefined/null, viewport, or persona variations unless they represent a distinct acceptance criterion or material product risk.
   - When the ticket contains more behaviors than the budget allows, prioritize the major acceptance criteria and highest-risk behavior, then describe omitted manual or unsupported coverage in overall notes.
21. For stateful features, consider positive, negative, permission, error, empty, and lifecycle-state coverage, but include only the highest-value distinct states supported by the Jira scope. GitHub context may provide implementation evidence, but must not independently expand the issue scope.
22. Missing GitHub context must not create several repeated UNKNOWN cases. Generate one representative case for the same missing route, endpoint contract, fixture, permission set, or unsupported dependency, and describe the remaining blocked coverage in notes.
23. A test plan containing zero total cases is invalid. When execution details are unavailable, generate the smallest meaningful representative coverage with UNKNOWN paths or routes and clearly document why it is blocked.

Browser step rules:
Every browserCase MUST include a "steps" array. The browser runner supports ONLY these actions:
1. wait
   Example: { "action": "wait", "ms": 1000 }
2. setViewport
   Example: { "action": "setViewport", "width": 430, "height": 900 }
3. clickTopTab
   Use only when the exact safe main-content tab label is grounded in Jira or GitHub context.
   Example: { "action": "clickTopTab", "text": "Details" }
4. selectRuntimeTopTab
   Use for label-agnostic active-tab URL tracking when the exact tab labels are unavailable. The runner discovers one visible main-content tab group, selects a safe inactive tab and verifies that it becomes selected.
   Example: { "action": "selectRuntimeTopTab" }
5. clickButton
   Use only for safe non-destructive buttons.
   Example: { "action": "clickButton", "text": "Filters" }
6. clickText
   Use for safe visible text in the main content area when it is not a menu option.
   Example: { "action": "clickText", "text": "Payments" }
7. openMenu
   Use to open a safe dropdown, sort control, filter popover, or icon-only menu trigger. The text is a semantic hint such as Filters, Sort, Newest, Actions, or More.
   Example: { "action": "openMenu", "text": "Filters" }
8. selectOption
   Use only after openMenu when the exact safe option label is grounded in Jira or GitHub context.
   Example: { "action": "selectOption", "text": "Newest" }
9. selectRuntimeFilterOption
   Use after openMenu when a filter query key is grounded but the exact safe option label or value is unavailable. The runner discovers the related visible filter control, selects one safe unselected runtime option, and requires that the exact query key changes in the URL.
   queryKey is the exact URL key without "=". hint is an optional human-readable control hint.
   Example: { "action": "selectRuntimeFilterOption", "queryKey": "project", "hint": "Project" }
10. createDraftJobAndVerifyRedirect
    Use only for Jira-scoped post-creation job redirect behavior. The runner generates one unique QA-owned draft title, selects source-grounded safe wizard values, observes the exact create response, verifies the concrete details route, and deletes the exact created job.
    Use origin "jobs" for the project-scoped workflow and origin "all-jobs" for the all-jobs workflow.
    Example: { "action": "createDraftJobAndVerifyRedirect", "origin": "jobs" }
11. reload
    Safely reload the current page to verify URL or visible-state restoration without changing product data.
    Example: { "action": "reload" }
12. assertUrlContains
    Deterministically verify that the current Playwright URL contains an exact source-grounded path or query substring.
    Example: { "action": "assertUrlContains", "text": "tab=processed" }
13. assertUrlNotContains
    Deterministically verify that the current Playwright URL does not contain an obsolete or forbidden exact substring.
    Example: { "action": "assertUrlNotContains", "text": "jobId=" }
14. assertTextVisible
    Use for expected headings, labels, badges, columns, validation messages, and UI copy.
    Example: { "action": "assertTextVisible", "text": "Active" }
15. assertTextNotVisible
    Use for negative checks such as undefined, null, raw errors, leaked data, or removed old copy.
    Example: { "action": "assertTextNotVisible", "text": "undefined" }
16. openRuntimeControl
    Use when an exact source-grounded placeholder, accessible name, or visible control label must be opened so its currently rendered options, results, or empty-state surface can be inspected without selecting a value.
    target must be copied exactly from Jira or GitHub context. This action proves only that the control and an expanded surface opened.
    Example: { "action": "openRuntimeControl", "target": "Search work setups" }

Browser step requirements:
- Every executable browserCase must include at least one assertion step.
- Do not claim that a form, modal, details panel, applicant row, review screen, or post-action state is tested unless the steps explicitly navigate to and open that state.
- When the acceptance criterion describes a nested flow, include the complete safe prerequisite chain using supported actions. Example: open Applicants, select Hired, open the relevant Work Setup or applicant details, then assert the review content.
- A browserCase may contain only assertion steps when the expected state is directly visible on the start route. Otherwise include at least one meaningful interaction step before assertions.
- When a grounded combobox or searchable selector must be expanded without choosing a value, use openRuntimeControl immediately before assertions about its expanded options, results, or empty state.
- openRuntimeControl proves only that the control opened. It does not prove an empty state, available option, selected value, backend result, or persisted state unless following deterministic assertions prove those claims.
- Never invent the openRuntimeControl target. Copy its placeholder, accessible name, or visible control label exactly from Jira or GitHub context; otherwise leave the interaction MANUAL_REQUIRED.
- For sort, filter, dropdown, popover, Actions, More, or icon-only controls, use openMenu before asserting or selecting menu content.
- Use selectOption only after openMenu. Do not use clickText for an option that is hidden inside a closed menu or listbox.
- For Jira behavior involving browser URL paths or query parameters, use assertUrlContains or assertUrlNotContains immediately after the relevant interaction.
- Never place the first positive assertUrlContains step before the action that establishes the expected URL state, unless the exact asserted substring is already present in startRoute.
- URL query assertions must include the equals sign, such as "tab=" or "project=". Never use a bare assertion such as "tab" or "project".
- clickTopTab must refer to a real tab control whose exact label is grounded in Jira or GitHub context. Do not use page headings or sidebar labels such as Payments or All payments as invented tab labels.
- When Jira requires label-agnostic active-tab URL synchronization and exact tab labels are unavailable, prefer selectRuntimeTopTab instead of inventing a clickTopTab label.
- selectRuntimeTopTab proves only that one safe visible inactive main-content tab was selected and visibly became active. It does not prove an exact tab-label-to-query-value mapping.
- A typical label-agnostic tab URL flow is selectRuntimeTopTab, assertUrlContains "tab=", reload, then assertUrlContains "tab=" again.
- Do not use selectRuntimeTopTab when the acceptance criterion requires one specific named tab. That case requires the exact grounded label and clickTopTab.
- Opening Filters does not establish filter URL state.
- When the exact safe option label is grounded, use openMenu followed by selectOption.
- When the exact option label or fixture value is unavailable but an exact URL query key is grounded, use openMenu followed by selectRuntimeFilterOption with that exact queryKey.
- A typical runtime filter URL flow is openMenu "Filters", selectRuntimeFilterOption with queryKey "project", assertUrlContains "project=", reload, then assertUrlContains "project=" again.
- selectRuntimeFilterOption may prove only that one safe runtime option changed the grounded query key. It must not claim an exact label-to-value mapping, backend filtering, or filtered record correctness without another oracle.
- Do not use selectRuntimeFilterOption when Jira requires one specific named filter option. That case requires the exact grounded option label and selectOption.
- Do not invent a query key. If neither an exact option label nor an exact query key is grounded, leave the case BLOCKED or MANUAL_REQUIRED.
- wait, reload, assertTextVisible, assertTextNotVisible and URL assertions do not establish tab, filter, sorting or selection state.
- A tab query assertion requires first selecting or changing the relevant tab. A filter query assertion requires first selecting or changing the relevant filter.
- When the exact interaction, tab value, filter option or required fixture is unavailable, do not assert that the query key already exists on the initial page. Describe the missing prerequisite and allow the case to become BLOCKED or MANUAL_REQUIRED instead of producing a product FAIL.
- Use reload only when reload persistence or restoration is part of the Jira behavior. After reload, repeat the URL assertion and add a visible UI assertion when the acceptance criterion also requires the selected control or tab to restore.
- URL assertion text must be an exact substring grounded in Jira or GitHub context. A grounded query key without a grounded value may verify only key presence and must not overclaim the selected value mapping.
- Do not infer network request bodies, backend filtering, database persistence, or record ordering from URL assertions.
- For a sorting control whose current visible value is Newest, Latest, or Oldest, use that current value or the semantic hint Sort in openMenu, then use selectOption for the desired value.
- Separate directly visible control behavior from hidden semantic behavior. URL synchronization may be included only when assertUrlContains or assertUrlNotContains directly proves the URL requirement. Record ordering, backend request semantics, permissions, and untested persistence must remain separate.
- For sort or filter changes, prefer one browserCase limited to visibly opening the control, seeing the grounded options, selecting them, and observing the selected UI label. Add URL synchronization to that case only when exact grounded URL assertions can prove it. Keep createdAt/updatedAt ordering, backend filtering, and unsupported network semantics in a separate case that honestly becomes MANUAL_REQUIRED when no supported oracle is available.
- A UI interaction case must not claim that selecting a sort label proves the underlying record order. Its goal and successCriteria must remain limited to the visible control behavior it can actually demonstrate.
- For a funnel or icon-only filter control, use { "action": "openMenu", "text": "Filters" }; the runner resolves safe semantic icon metadata and verifies that a menu or listbox actually opened.
- Do not assert modal content before opening the modal.
- Do not assert form fields before opening the form.
- Do not assert post-submit, post-approve, post-reject, or completed state unless the action is safely executable.
- createDraftJobAndVerifyRedirect is the sole exception for post-creation job redirect coverage. Do not combine it with generic Save as Draft, Publish, Create, or Delete clicks.
- When both standard Jobs and All Jobs origins are explicitly within the Jira scope, generate two separate browser cases because they require different origins and expected route bases.
- For origin "jobs", use startRoute "/company/jobs/create" and assert "/company/jobs/" plus "project=" after the dedicated action.
- For origin "all-jobs", use startRoute "/company/jobs/create?origin=all-jobs" and assert "/company/all-jobs/" plus "project=" after the dedicated action.
- In both cases, assert that "jobId=", "undefined", and "null" are absent when those malformed URL risks are within the Jira scope.
- When a state-changing action is otherwise prohibited, verify only the safe pre-action controls in automatedChecks and place the unsupported state-changing coverage in manualChecks. Do not put that limitation in successCriteria.
- If startRoute is "UNKNOWN", include only steps that clearly belong to the intended product area and document the missing route or fixture in fixtureRequirements. Keep goal and successCriteria limited to the expected product behavior.
- Do not combine mutually exclusive fixture states such as pending, rejected, approved, empty, and no-file completion in one browserCase.
- Do not generate permission-specific browser cases unless the available persona can actually represent the required permission set. Put unsupported permission coverage in the overall notes instead of creating a false-pass-prone browser case.
- Each case must cover a distinct acceptance criterion or high-risk behavior. Do not create duplicate cases that differ only by wording or trivial data permutations.
- Prefer a concise but complete plan. Cover every distinct acceptance criterion and high-risk state without duplicate or trivial cases.
- Do not invent CSS selectors, XPath, Playwright code, or unsupported action names.
- For visual/layout issues, include one normal viewport case and optionally one narrow/mobile case.
- For table/column issues, navigate to the relevant table state before asserting the expected column text.
- Include negative assertions for "undefined" and "null" only when missing or partial server data is relevant to that case.

The JSON structure MUST match exactly this:
{
  "issueKey": "ticket id",
  "summary": "ticket summary",
  "notes": "overall assumptions, missing context, route limitations, or unauthenticated browser coverage notes",
  "apiCases": [
    {
      "id": "api-1",
      "persona": "company_admin",
      "method": "GET",
      "path": "UNKNOWN",
      "body": {},
      "expect": {
        "status": 200,
        "notes": "why this case matters or why it is blocked"
      }
    }
  ],
  "browserCases": [
    {
      "id": "web-1",
      "persona": "company_admin",
      "goal": "what to verify",
      "startRoute": "UNKNOWN",
      "successCriteria": "what should be true",
      "runtimeFixturePolicy": "exact",
      "automatedChecks": [
        "behavior verified by supported runner steps"
      ],
      "manualChecks": [],
      "fixtureRequirements": [],
      "steps": [
        { "action": "assertTextVisible", "text": "expected text" },
        { "action": "assertTextNotVisible", "text": "undefined" },
        { "action": "assertTextNotVisible", "text": "null" }
      ]
    }
  ]
}
`;

  console.log("AI test plan from real Jira issue");

  const response = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini",
    ...getReasoningOptions(),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fileContents },
    ],
  });

  const aiAnswer = response.choices[0]?.message.content || "{}";

  console.log("Given Answer:\n", aiAnswer);

  let cleanPlan: string;

  try {
    cleanPlan = cleanJsonOutput(aiAnswer);
  } catch (error: any) {
    cleanPlan = await repairJsonWithModel(aiAnswer, error);
  }

  const parsedPlan = JSON.parse(cleanPlan) as any;

  if (parsedPlan.issueKey !== ticketId) {
    throw new Error(
      `Planner returned issueKey ${String(parsedPlan.issueKey)} instead of ${ticketId}`
    );
  }

    const enrichedPlan =
    applyBrowserTextAssertionProvenanceGate(
      applyBrowserUrlAssertionPrerequisiteGate(
        applyPlannerCaseLimits(
          enrichTestPlanWithDiscovery(
normalizePlannerBrowserScopes(
  normalizePlannerUrlSynchronizationSteps(
    applyPlannerRuntimeFixturePolicies(
      splitCombinedInvoiceStateCases(
        parsedPlan
      ),
      fileContents
    )
  )
)
          )
        ),
        fileContents
      ),
      fileContents
    );

  const enrichedJson =
    JSON.stringify(enrichedPlan, null, 2);

  const apiCaseCount = Array.isArray(
    enrichedPlan.apiCases
  )
    ? enrichedPlan.apiCases.length
    : 0;

  const browserCaseCount = Array.isArray(
    enrichedPlan.browserCases
  )
    ? enrichedPlan.browserCases.length
    : 0;

  const totalCaseCount =
    apiCaseCount + browserCaseCount;

  if (totalCaseCount === 0) {
    throw new Error(
      `Planner produced an empty test plan for ${ticketId}`
    );
  }

  if (!fs.existsSync("qa-results")) {
    fs.mkdirSync("qa-results");
  }

  fs.writeFileSync(
    "qa-results/test-plan.json",
    enrichedJson,
    "utf-8"
  );

  console.log(
    `Test plan saved: ${apiCaseCount} API + ` +
      `${browserCaseCount} browser = ` +
      `${totalCaseCount} total`
  );

  return enrichedJson;
}
