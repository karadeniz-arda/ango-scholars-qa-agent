import fs from "node:fs";
import type {
  CompiledPlanMetadata,
  CompiledTestPlan,
  PlannerCompilationSummary,
  PlannerDiagnostics,
  TestPlan,
} from "./types.js";

export const compiledPlanMetadata: CompiledPlanMetadata = {
  schemaVersion: 1,
  kind: "DETERMINISTIC_COMPILED_TEST_PLAN",
  compilerContract: "PLANNER_PROPOSAL_REQUIRES_DETERMINISTIC_MATERIALIZATION_V1",
};

export function markDeterministicallyCompiledTestPlan(plan: TestPlan): CompiledTestPlan {
  return { ...plan, compiledPlanMetadata };
}

export type PlannerCompilationInputPlan = TestPlan & {
  browserSemanticCandidates?: unknown;
};

/**
 * Final artifact boundary: raw model semantic candidates are compilation input
 * only and are never serialized at the executable-plan root.
 */
export function finalizeCompiledTestPlanArtifact(args: {
  compilationInputPlan: PlannerCompilationInputPlan;
  plannerDiagnostics: PlannerDiagnostics;
  compilationSummary: PlannerCompilationSummary;
}): CompiledTestPlan {
  const {
    browserSemanticCandidates: _rawSemanticCandidates,
    ...compiledArtifactBase
  } = args.compilationInputPlan;
  return markDeterministicallyCompiledTestPlan({
    ...compiledArtifactBase,
    plannerDiagnostics: args.plannerDiagnostics,
    compilationSummary: args.compilationSummary,
  });
}

export function isCompiledTestPlan(value: unknown): value is CompiledTestPlan {
  if (!value || typeof value !== "object") return false;
  const marker = (value as { compiledPlanMetadata?: unknown }).compiledPlanMetadata;
  return JSON.stringify(marker) === JSON.stringify(compiledPlanMetadata);
}

export type PlanAdmissionMode = "COMPILED" | "LEGACY_EXPLICIT_OPT_IN";

export function readExecutionTestPlan(options: {
  path?: string;
  allowLegacy?: boolean;
} = {}): { plan: TestPlan; planAdmissionMode: PlanAdmissionMode } {
  const path = options.path ?? "qa-results/test-plan.json";
  const raw = fs.readFileSync(path, "utf8").replace(/```json/g, "").replace(/```/g, "").trim();
  const value: unknown = JSON.parse(raw);
  if (isCompiledTestPlan(value)) return { plan: value, planAdmissionMode: "COMPILED" };
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "compiledPlanMetadata")) {
    throw new Error("INVALID_COMPILED_TEST_PLAN");
  }
  if (options.allowLegacy || process.env.QA_ALLOW_LEGACY_UNCOMPILED_PLAN === "true") {
    console.warn("PLAN_ADMISSION_MODE=LEGACY_EXPLICIT_OPT_IN: unmarked plan admitted without compiled authority.");
    return { plan: value as TestPlan, planAdmissionMode: "LEGACY_EXPLICIT_OPT_IN" };
  }
  throw new Error("UNCOMPILED_TEST_PLAN");
}
