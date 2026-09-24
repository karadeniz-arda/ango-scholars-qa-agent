import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finalizeCompiledTestPlanArtifact, isCompiledTestPlan, markDeterministicallyCompiledTestPlan, readExecutionTestPlan } from "./compiled-test-plan.js";
import { clonePlannerSemanticCandidateProposals, normalizePlannerModelProposal } from "./planner-model-proposal.js";
import type { TestPlan } from "./types.js";

const plan: TestPlan = { issueKey: "AS-1", summary: "x", apiCases: [], browserCases: [] };
const tempPlan = (value: unknown): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compiled-plan-"));
  const file = path.join(dir, "test-plan.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};

test("finalization adds the exact deterministic compiled marker", () => {
  const compiled = markDeterministicallyCompiledTestPlan(plan);
  assert.equal(isCompiledTestPlan(compiled), true);
  assert.equal(JSON.stringify(compiled), JSON.stringify(markDeterministicallyCompiledTestPlan(plan)));
});

test("proposal normalization cannot inject compiled metadata", () => {
  const proposal = normalizePlannerModelProposal({ ...plan, compiledPlanMetadata: { schemaVersion: 1, kind: "DETERMINISTIC_COMPILED_TEST_PLAN" } });
  assert.equal((proposal as any).compiledPlanMetadata, undefined);
});

test("loader admits marked plans and preserves the marker after reload", () => {
  const result = readExecutionTestPlan({ path: tempPlan(markDeterministicallyCompiledTestPlan(plan)) });
  assert.equal(result.planAdmissionMode, "COMPILED");
  assert.equal(isCompiledTestPlan(result.plan), true);
});

test("loader rejects fake, unmarked, and malformed plans by default", () => {
  assert.throws(() => readExecutionTestPlan({ path: tempPlan({ ...plan, compiled: true }) }), /UNCOMPILED_TEST_PLAN/);
  assert.throws(() => readExecutionTestPlan({ path: tempPlan({ ...plan, compiledPlanMetadata: { schemaVersion: 1 } }), allowLegacy: true }), /INVALID_COMPILED_TEST_PLAN/);
});

test("legacy admission requires explicit opt-in and never mutates the plan", () => {
  const value = { ...plan };
  const result = readExecutionTestPlan({ path: tempPlan(value), allowLegacy: true });
  assert.equal(result.planAdmissionMode, "LEGACY_EXPLICIT_OPT_IN");
  assert.equal((result.plan as any).compiledPlanMetadata, undefined);
});

test("final artifact removes raw semantic candidates while retaining cloned diagnostics", () => {
  const proposal = normalizePlannerModelProposal({
    issueKey: "AS-1", summary: "x", apiCases: [], browserCases: [],
    browserSemanticCandidates: [{ id: "candidate-1", proposedCaseId: "web-1", obligationIds: ["o1"], sourceUnitIds: ["s1"], proposedBehavior: "x", proposedChecks: [], proposedFixtureNeeds: [], proposedRelationshipHints: [] }],
  });
  const rawCandidates = proposal.browserSemanticCandidates ?? [];
  const input = { ...plan, browserSemanticCandidates: rawCandidates };
  const before = JSON.stringify(input);
  const compiled = finalizeCompiledTestPlanArtifact({
    compilationInputPlan: input,
    plannerDiagnostics: { rawSemanticCandidates: clonePlannerSemanticCandidateProposals(rawCandidates) },
    compilationSummary: { version: "V1", apiCaseCount: 0, proposedBrowserCaseCount: 1, semanticCandidateCount: 1, rejectedSemanticCandidateCount: 0, browserCaseCount: 0, effectiveBrowserRuntimeCaseCount: 0, effectiveRuntimeUnitCount: 0 },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(compiled, "browserSemanticCandidates"), false);
  assert.deepEqual(compiled.plannerDiagnostics?.rawSemanticCandidates, rawCandidates);
  assert.notEqual(compiled.plannerDiagnostics?.rawSemanticCandidates, rawCandidates);
  assert.equal(JSON.stringify(input), before);
  assert.equal(isCompiledTestPlan(compiled), true);
});
