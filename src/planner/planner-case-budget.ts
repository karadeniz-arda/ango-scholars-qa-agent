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

export function applyPlannerCaseLimits(
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
