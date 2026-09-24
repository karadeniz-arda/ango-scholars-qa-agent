import type { PlannerCompilationSummary, TestPlan } from "./types.js";

export type PlannerPlanSummary = {
  apiCaseCount: number;
  browserCaseCount: number;
  effectiveBrowserRuntimeCaseCount: number;
  effectiveTotalRuntimeUnits: number;
  browserCaseMaterialization: string[];
  compilationSummary: PlannerCompilationSummary;
};

export function summarizeCompiledPlan(plan: TestPlan, proposedBrowserCaseCount = 0, semanticCandidateCount = 0, rejectedSemanticCandidateCount = 0): PlannerPlanSummary {
  const browserCases = Array.isArray(plan.browserCases) ? plan.browserCases : [];
  // Frozen artifacts can still be observed through the old collection.
  const legacyDiscoveryCases = Array.isArray(plan.discoveryBrowserCases)
    ? plan.discoveryBrowserCases
    : [];
  const containers = plan.browserSemanticPlanningAudit?.executionContainers ?? [];
  const browserCaseMaterialization = browserCases.map((testCase) => {
    const container = containers.find((item) => item.executionCaseIds.includes(testCase.id));
    const sourceCaseId = testCase.plannerExecutionShell?.sourceCaseId;
    const lineage = sourceCaseId && sourceCaseId !== testCase.id
      ? `${sourceCaseId} -> ${testCase.id}`
      : testCase.id;
    const readiness = container?.readiness ?? "UNAVAILABLE";
    return `${lineage} -> runtime prerequisites: ${readiness}`;
  });
  const browserCaseCount = browserCases.length + legacyDiscoveryCases.length;
  const apiCaseCount = Array.isArray(plan.apiCases) ? plan.apiCases.length : 0;
  const summary = {
    apiCaseCount,
    browserCaseCount,
    effectiveBrowserRuntimeCaseCount: browserCaseCount,
    effectiveTotalRuntimeUnits: apiCaseCount + browserCaseCount,
    browserCaseMaterialization,
  };
  return {
    ...summary,
    compilationSummary: {
      version: "V1",
      apiCaseCount,
      proposedBrowserCaseCount,
      semanticCandidateCount,
      rejectedSemanticCandidateCount,
      browserCaseCount,
      effectiveBrowserRuntimeCaseCount: browserCaseCount,
      effectiveRuntimeUnitCount: summary.effectiveTotalRuntimeUnits,
    },
  };
}

export function formatCompiledPlanSummary(summary: PlannerPlanSummary): string {
  const lines = [
    "Test plan compiled:",
    `API cases: ${summary.apiCaseCount}`,
    `Browser cases: ${summary.browserCaseCount}`,
    `Effective browser runtime cases: ${summary.effectiveBrowserRuntimeCaseCount}`,
    `Effective total runtime units: ${summary.effectiveTotalRuntimeUnits}`,
  ];
  if (summary.browserCaseMaterialization.length > 0) {
    lines.push("Browser case materialization:", ...summary.browserCaseMaterialization);
  }
  return lines.join("\n");
}
