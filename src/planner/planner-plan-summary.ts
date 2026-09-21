import type { PlannerCompilationSummary, TestPlan } from "./types.js";

export type PlannerPlanSummary = {
  apiCaseCount: number;
  trustedBrowserCaseCount: number;
  discoveryBrowserCaseCount: number;
  effectiveBrowserRuntimeCaseCount: number;
  effectiveTotalRuntimeUnits: number;
  browserCaseMaterialization: string[];
  compilationSummary: PlannerCompilationSummary;
};

export function summarizeCompiledPlan(plan: TestPlan, proposedBrowserCaseCount = 0, semanticCandidateCount = 0, rejectedSemanticCandidateCount = 0): PlannerPlanSummary {
  const trusted = Array.isArray(plan.browserCases) ? plan.browserCases : [];
  const discovery = Array.isArray(plan.discoveryBrowserCases)
    ? plan.discoveryBrowserCases
    : [];
  const containers = plan.browserSemanticPlanningAudit?.executionContainers ?? [];
  const browserCaseMaterialization = discovery.map((testCase) => {
    const container = containers.find((item) => item.executionCaseIds.includes(testCase.id));
    const sourceCaseId = testCase.plannerExecutionShell?.sourceCaseId;
    const lineage = sourceCaseId && sourceCaseId !== testCase.id
      ? `${sourceCaseId} -> ${testCase.id}`
      : testCase.id;
    const readiness = container?.readiness ?? "UNAVAILABLE";
    return `${lineage} -> DISCOVERY_ONLY (${readiness})`;
  });
  const effectiveBrowserRuntimeCaseCount = trusted.length + discovery.length;
  const apiCaseCount = Array.isArray(plan.apiCases) ? plan.apiCases.length : 0;
  const summary = {
    apiCaseCount,
    trustedBrowserCaseCount: trusted.length,
    discoveryBrowserCaseCount: discovery.length,
    effectiveBrowserRuntimeCaseCount,
    effectiveTotalRuntimeUnits: apiCaseCount + effectiveBrowserRuntimeCaseCount,
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
      trustedBrowserCaseCount: trusted.length,
      discoveryBrowserCaseCount: discovery.length,
      effectiveBrowserRuntimeCaseCount,
      effectiveRuntimeUnitCount: summary.effectiveTotalRuntimeUnits,
    },
  };
}

export function formatCompiledPlanSummary(summary: PlannerPlanSummary): string {
  const lines = [
    "Test plan compiled:",
    `API cases: ${summary.apiCaseCount}`,
    `Trusted browser cases: ${summary.trustedBrowserCaseCount}`,
    `Discovery browser cases: ${summary.discoveryBrowserCaseCount}`,
    `Effective browser runtime cases: ${summary.effectiveBrowserRuntimeCaseCount}`,
    `Effective total runtime units: ${summary.effectiveTotalRuntimeUnits}`,
  ];
  if (summary.browserCaseMaterialization.length > 0) {
    lines.push("Browser case materialization:", ...summary.browserCaseMaterialization);
  }
  return lines.join("\n");
}
