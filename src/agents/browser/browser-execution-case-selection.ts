import type {
  BrowserTestCase,
  TestPlan,
} from "../../planner/types.js";

export type BrowserExecutionCaseSelection = {
  materializedBrowserRuntimeUnitCount: number;
  browserExecutionSelectedCount: number;
  sourceProofRichDiagnosticLaneCount: number;
  discoverySupportDiagnosticLaneCount: number;
  diagnosticExecutionFilter: {
    enabled: boolean;
    requestedCaseId?: string;
    preFilterCount: number;
    postFilterCount: number;
  };
  cases: BrowserTestCase[];
};

function requestedBrowserCaseId(): string | undefined {
  const requested = String(process.env.QA_BROWSER_CASE_ID ?? "").trim();
  return requested || undefined;
}

/**
 * Select every materialized browser runtime unit for execution.
 *
 * Planner lanes remain useful provenance, but they are not execution
 * authority. Proof contracts and acceptance obligations are evaluated only
 * after execution and therefore cannot filter this selection.
 */
export function selectMaterializedBrowserRuntimeCases(
  plan: Pick<TestPlan, "browserCases" | "discoveryBrowserCases">
): BrowserExecutionCaseSelection {
  const sourceProofRichDiagnosticLane = Array.isArray(plan.browserCases)
    ? plan.browserCases
    : [];
  const discoverySupportDiagnosticLane = Array.isArray(
    plan.discoveryBrowserCases
  )
    ? plan.discoveryBrowserCases
    : [];
  const materializedCases = [
    ...sourceProofRichDiagnosticLane,
    ...discoverySupportDiagnosticLane,
  ];
  const requestedCaseId = requestedBrowserCaseId();
  const matchingCases = requestedCaseId
    ? materializedCases.filter((testCase) =>
        testCase.id === requestedCaseId
      )
    : materializedCases;

  if (requestedCaseId && matchingCases.length !== 1) {
    const cardinality = matchingCases.length === 0
      ? "not found"
      : `ambiguous (${matchingCases.length} matches)`;
    throw new Error(
      `Requested browser case ID ${cardinality}: ${requestedCaseId}`
    );
  }

  return {
    materializedBrowserRuntimeUnitCount: materializedCases.length,
    browserExecutionSelectedCount: matchingCases.length,
    sourceProofRichDiagnosticLaneCount:
      sourceProofRichDiagnosticLane.length,
    discoverySupportDiagnosticLaneCount:
      discoverySupportDiagnosticLane.length,
    diagnosticExecutionFilter: {
      enabled: Boolean(requestedCaseId),
      ...(requestedCaseId
        ? { requestedCaseId }
        : {}),
      preFilterCount: materializedCases.length,
      postFilterCount: matchingCases.length,
    },
    cases: matchingCases,
  };
}
