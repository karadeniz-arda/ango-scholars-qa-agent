import { createHash } from "node:crypto";
import type {
  PlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import {
  findExactObligationIdsForCase,
} from "./planner-obligation-case-allocation-audit.js";

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

/*
 * PLANNER_ACCEPTANCE_AWARE_CASE_DEDUP_V1
 *
 * Execution-shape equality is not enough to establish
 * that two planner cases cover the same acceptance
 * requirement.
 *
 * Deduplication may collapse cases only when their
 * normalized acceptance allocation is also identical.
 * Different acceptance semantics fail safe by remaining
 * distinct, even when route, method, body, or executable
 * steps are the same.
 */
function normalizePlannerAcceptanceList(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      normalizePlannerFingerprintText(
        item
      )
    )
    .filter(Boolean);
}

function getPlannerAcceptanceFingerprint(
  testCase: any,
  kind: "api" | "browser"
): string {
  if (kind === "api") {
    return plannerValueFingerprint({
      notes:
        normalizePlannerFingerprintText(
          testCase?.expect?.notes
        ),
    });
  }

  return plannerValueFingerprint({
    goal:
      normalizePlannerFingerprintText(
        testCase?.goal
      ),
    successCriteria:
      normalizePlannerFingerprintText(
        testCase?.successCriteria
      ),
    automatedChecks:
      normalizePlannerAcceptanceList(
        testCase?.automatedChecks
      ),
    manualChecks:
      normalizePlannerAcceptanceList(
        testCase?.manualChecks
      ),
  });
}

type PlannerCaseKind = "api" | "browser";

type PlannerCaseBudgetRemoval = {
  originalCaseId: string;
  kind: PlannerCaseKind;
  reason:
    | "REMOVED_EXACT_DUPLICATE"
    | "REMOVED_REPEATED_DEPENDENCY"
    | "REMOVED_SEMANTIC_SPECIAL_DUPLICATE"
    | "REMOVED_CAPACITY_OVERFLOW";
  acceptanceFingerprint: string;
  exactObligationIds?: string[];
};

function boundedAcceptanceFingerprint(
  testCase: any,
  kind: PlannerCaseKind
): string {
  return createHash("sha256")
    .update(
      getPlannerAcceptanceFingerprint(
        testCase,
        kind
      )
    )
    .digest("hex")
    .slice(0, 12);
}

function removalAudit(
  testCase: any,
  kind: PlannerCaseKind,
  reason: PlannerCaseBudgetRemoval["reason"],
  obligationLedger?:
    PlannerAcceptanceObligationLedger
): PlannerCaseBudgetRemoval {
  const exactObligationIds =
    findExactObligationIdsForCase(
      testCase,
      obligationLedger
    );

  return {
    originalCaseId: String(
      testCase?.id ?? "unknown"
    ),
    kind,
    reason,
    acceptanceFingerprint:
      boundedAcceptanceFingerprint(
        testCase,
        kind
      ),
    ...(exactObligationIds.length > 0
      ? { exactObligationIds }
      : {}),
  };
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
    getPlannerAcceptanceFingerprint(
      testCase,
      "api"
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
    getPlannerAcceptanceFingerprint(
      testCase,
      "browser"
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
        getPlannerAcceptanceFingerprint(
          testCase,
          "api"
        ),
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
      getPlannerAcceptanceFingerprint(
        testCase,
        "browser"
      ),
    ].join("|");
  }

  return null;
}

function deduplicatePlannerCases(
  cases: any[],
  kind: PlannerCaseKind,
  obligationLedger?:
    PlannerAcceptanceObligationLedger
): {
  cases: any[];
  removals: PlannerCaseBudgetRemoval[];
} {
  const seenCases =
    new Set<string>();

  const seenMissingDependencies =
    new Set<string>();

  const result: any[] = [];
  const removals:
    PlannerCaseBudgetRemoval[] = [];

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
      removals.push(
        removalAudit(
          testCase,
          kind,
          "REMOVED_EXACT_DUPLICATE",
          obligationLedger
        )
      );
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
      removals.push(
        removalAudit(
          testCase,
          kind,
          "REMOVED_REPEATED_DEPENDENCY",
          obligationLedger
        )
      );
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

  return {
    cases: result,
    removals,
  };
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
  cases: any[],
  obligationLedger?:
    PlannerAcceptanceObligationLedger
): {
  cases: any[];
  removals: PlannerCaseBudgetRemoval[];
} {
  const result: any[] = [];
  const removals:
    PlannerCaseBudgetRemoval[] = [];

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
            getPlannerAcceptanceFingerprint(
              testCase,
              "browser"
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
      removals.push(
        removalAudit(
          existingCase,
          "browser",
          "REMOVED_SEMANTIC_SPECIAL_DUPLICATE",
          obligationLedger
        )
      );
      result[existingIndex] =
        testCase;
    } else {
      removals.push(
        removalAudit(
          testCase,
          "browser",
          "REMOVED_SEMANTIC_SPECIAL_DUPLICATE",
          obligationLedger
        )
      );
    }
  }

  return {
    cases: result,
    removals,
  };
}

export function applyPlannerCaseLimits(
  plan: any,
  options: {
    obligationLedger?:
      PlannerAcceptanceObligationLedger;
    /** Candidate interaction shells are budgeted later by semantic allocation. */
    deferBrowserAllocation?: boolean;
  } = {}
): any {
  const rawApiCases =
    Array.isArray(plan?.apiCases)
      ? plan.apiCases
      : [];

  const rawBrowserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const apiDeduplication =
    deduplicatePlannerCases(
      rawApiCases,
      "api",
      options.obligationLedger
    );

  const invoiceDeduplication =
    options.deferBrowserAllocation
      ? { cases: rawBrowserCases, removals: [] }
      : mergeInvoiceDrawerSemanticDuplicates(
          rawBrowserCases,
          options.obligationLedger
        );
  const mergedBrowserCases =
    invoiceDeduplication.cases;

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

  const browserDeduplication =
    options.deferBrowserAllocation
      ? { cases: mergedBrowserCases, removals: [] }
      : deduplicatePlannerCases(
          mergedBrowserCases,
          "browser",
          options.obligationLedger
        );
  const distinctApiCases =
    apiDeduplication.cases;
  const distinctBrowserCases =
    browserDeduplication.cases;

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
    options.deferBrowserAllocation
      ? distinctBrowserCases
      : distinctBrowserCases
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

  const capacityRemovals = [
    ...distinctApiCases
      .slice(MAX_API_CASES)
      .map((testCase: any) =>
        removalAudit(
          testCase,
          "api",
          "REMOVED_CAPACITY_OVERFLOW",
          options.obligationLedger
        )
      ),
    ...distinctBrowserCases
      .slice(
        options.deferBrowserAllocation
          ? distinctBrowserCases.length
          : MAX_BROWSER_CASES
      )
      .map((testCase: any) =>
        removalAudit(
          testCase,
          "browser",
          "REMOVED_CAPACITY_OVERFLOW",
          options.obligationLedger
        )
      ),
  ];
  const removals = [
    ...apiDeduplication.removals,
    ...invoiceDeduplication.removals,
    ...browserDeduplication.removals,
    ...capacityRemovals,
  ];

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

  plan.plannerCaseBudgetAudit = {
    api: {
      inputCount: rawApiCases.length,
      distinctCount:
        distinctApiCases.length,
      retainedCount:
        limitedApiCases.length,
      overflowCount: Math.max(
        0,
        distinctApiCases.length -
          MAX_API_CASES
      ),
    },
    browser: {
      inputCount:
        rawBrowserCases.length,
      distinctCount:
        distinctBrowserCases.length,
      retainedCount:
        limitedBrowserCases.length,
      overflowCount: Math.max(
        0,
        options.deferBrowserAllocation
          ? 0
          : distinctBrowserCases.length -
            MAX_BROWSER_CASES
      ),
    },
    removals,
  };

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
