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

export function isDeepBrowserCase(testCase: any): boolean {
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

export function isGenericBrowserEntryRoute(
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

export function escapeRegularExpression(
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

export function hasVerbatimSourceGroundedVisibleText(
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
export function normalizePlannerUrlSynchronizationSteps(
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
export function normalizePlannerBrowserScopes(
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
export function applyBrowserTextAssertionProvenanceGate(
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

export function applyBrowserUrlAssertionPrerequisiteGate(
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
