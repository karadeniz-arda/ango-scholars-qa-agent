import assert from "node:assert/strict";
import test from "node:test";
import { formatCompiledPlanSummary, summarizeCompiledPlan } from "./planner-plan-summary.js";
import type { TestPlan } from "./types.js";

const browser = (id: string, lane?: "DISCOVERY_ONLY") => ({
  id, persona: "talent" as const, goal: "goal", startRoute: "/talent", successCriteria: "criteria",
  ...(lane ? { executionPolicy: { lane } } : {}), automatedChecks: [], manualChecks: [], fixtureRequirements: [], steps: [],
});

test("summary exposes unified browser and effective runtime counts", () => {
  const plan: TestPlan = { issueKey: "AS-1058", summary: "x", apiCases: [{ id: "a", persona: "talent", method: "GET", path: "x", expect: { status: 200 } }, { id: "b", persona: "talent", method: "GET", path: "y", expect: { status: 200 } }], browserCases: [], discoveryBrowserCases: [browser("d1", "DISCOVERY_ONLY"), browser("d2", "DISCOVERY_ONLY"), browser("d3", "DISCOVERY_ONLY"), browser("d4", "DISCOVERY_ONLY")] };
  const summary = summarizeCompiledPlan(plan, 4, 4, 0);
  assert.equal(summary.apiCaseCount, 2);
  assert.equal(summary.browserCaseCount, 4);
  assert.equal(summary.effectiveBrowserRuntimeCaseCount, 4);
  assert.equal(summary.effectiveTotalRuntimeUnits, 6);
  assert.deepEqual(summary.compilationSummary, { version: "V1", apiCaseCount: 2, proposedBrowserCaseCount: 4, semanticCandidateCount: 4, rejectedSemanticCandidateCount: 0, browserCaseCount: 4, effectiveBrowserRuntimeCaseCount: 4, effectiveRuntimeUnitCount: 6 });
  assert.match(formatCompiledPlanSummary(summary), /API cases: 2/);
  assert.match(formatCompiledPlanSummary(summary), /Browser cases: 4/);
  assert.doesNotMatch(formatCompiledPlanSummary(summary), /Trusted browser cases|Discovery browser cases/);
  assert.match(formatCompiledPlanSummary(summary), /Effective total runtime units: 6/);
});

test("legacy collections are counted without mutating the plan", () => {
  const plan: TestPlan = { issueKey: "x", summary: "x", apiCases: [], browserCases: [browser("t1"), browser("t2")], discoveryBrowserCases: [browser("d1", "DISCOVERY_ONLY"), browser("d2", "DISCOVERY_ONLY"), browser("d3", "DISCOVERY_ONLY")] };
  const before = JSON.stringify(plan);
  assert.equal(summarizeCompiledPlan(plan).effectiveBrowserRuntimeCaseCount, 5);
  assert.equal(JSON.stringify(plan), before);
  plan.discoveryBrowserCases = [];
  assert.equal(summarizeCompiledPlan(plan).browserCaseCount, 2);
});

test("compilation summary keeps proposal and rejected-candidate accounting separate", () => {
  const plan: TestPlan = { issueKey: "x", summary: "x", apiCases: [{ id: "a", persona: "talent", method: "GET", path: "x", expect: { status: 200 } }], browserCases: [], discoveryBrowserCases: [browser("d1", "DISCOVERY_ONLY")] };
  const summary = summarizeCompiledPlan(plan, 4, 4, 2);
  assert.equal(summary.compilationSummary.proposedBrowserCaseCount, 4);
  assert.equal(summary.compilationSummary.semanticCandidateCount, 4);
  assert.equal(summary.compilationSummary.rejectedSemanticCandidateCount, 2);
  assert.equal(summary.compilationSummary.effectiveRuntimeUnitCount, 2);
});
