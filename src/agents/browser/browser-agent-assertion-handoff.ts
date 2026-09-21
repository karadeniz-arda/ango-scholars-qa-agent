import type {
  BrowserExecutionCheckContract,
  BrowserStep,
} from "../../planner/types.js";
import {
  hasValidBrowserExecutionCheckContract,
} from "../../planner/browser-execution-check-contract.js";

import type {
  BrowserObservation,
} from "./browser-observation.js";
import type {
  BrowserSourceBoundAssertionSetRequirement,
} from "./browser-source-bound-assertion-set-proof.js";

const DETERMINISTIC_ASSERTION_ACTIONS =
  new Set<string>([
    "assertUrlContains",
    "assertUrlNotContains",
    "assertTextVisible",
    "assertSurfaceControls",
    "assertTextNotVisible",
  ]);

/* Must stay aligned with BROWSER_ASSERTION_ORACLE_ID_V1 planner derivation. */
const ORACLE_IDENTIFIED_ASSERTION_ACTIONS =
  new Set<string>([
    "assertUrlContains",
    "assertUrlNotContains",
    "assertTextVisible",
    "assertTextNotVisible",
  ]);

type CanonicalAssertionStep = Extract<
  BrowserStep,
  { action: "assertUrlContains" | "assertUrlNotContains" | "assertTextVisible" | "assertTextNotVisible" }
>;

function completeCanonicalAssertionOracleIds(
  caseId: string,
  steps: BrowserStep[]
): BrowserStep[] {
  const used = new Set(
    steps.map((step: any) => String(step?.oracleId || "").trim())
      .filter(Boolean)
  );
  let ordinal = 1;
  return steps.map((step: any) => {
    if (!ORACLE_IDENTIFIED_ASSERTION_ACTIONS.has(String(step?.action || ""))) {
      return step;
    }
    if (String(step?.oracleId || "").trim()) return step;
    let oracleId = `${caseId}:assertion-${ordinal}`;
    while (used.has(oracleId)) {
      ordinal += 1;
      oracleId = `${caseId}:assertion-${ordinal}`;
    }
    used.add(oracleId);
    ordinal += 1;
    return { ...step, oracleId };
  });
}

/**
 * AUTONOMOUS_ASSERTION_HANDOFF_V1
 *
 * Autonomous navigation may move the browser into the
 * acceptance state before canonical planner execution.
 *
 * After that navigation succeeds, replaying planner-authored
 * interaction steps would act against a different browser
 * state and may repeat or mutate the workflow.
 *
 * Preserve only canonical deterministic assertions so the
 * reached state can be independently evaluated.
 */
export function buildGenericBrowserAssertionHandoffCase(
  testCase: any,
  goalObservation: BrowserObservation | null = null,
  sourceBoundAssertionSetRequirements: BrowserSourceBoundAssertionSetRequirement[] = []
): any | null {
  const canonicalSteps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps as BrowserStep[]
    : [];

  const assertionSteps: CanonicalAssertionStep[] =
    completeCanonicalAssertionOracleIds(
      String(testCase?.id || "browser-case"),
      canonicalSteps
    ).filter(
      (step): step is CanonicalAssertionStep =>
        DETERMINISTIC_ASSERTION_ACTIONS.has(
          String(step?.action || "")
        )
    );

  const contract: BrowserExecutionCheckContract | undefined =
    testCase?.executionCheckContract;
  const requiredChecks = contract?.requiredChecks ?? [];
  const sourceBoundAssertions =
    sourceBoundAssertionSetRequirements.length > 0
      ? sourceBoundAssertionSetRequirements.flatMap((requirement) =>
          requirement.members.flatMap((member) =>
            member.action === "assertTextVisible" || member.action === "assertTextNotVisible"
              ? [{
                  action: member.action,
                  text: member.expectedText,
                  oracleId: member.oracleId,
                } satisfies CanonicalAssertionStep]
              : []
          )
        )
      : hasValidBrowserExecutionCheckContract({
      caseId: String(testCase?.id || ""),
      contract,
    })
      ? assertionSteps.filter((step) =>
          requiredChecks.some(
            (check) =>
              check.kind === "SOURCE_BOUND_ASSERTION_MEMBER" &&
              check.oracle.action === step.action &&
              check.oracle.oracleId === step.oracleId &&
              check.oracle.expectedText === step.text
          )
        )
      : assertionSteps;

  if (sourceBoundAssertions.length === 0) {
    return null;
  }

  /*
 * GENERIC_BROWSER_GOAL_OBSERVATION_HANDOFF_PROVENANCE_V1
 *
 * Carries the exact observation snapshot that grounded the
 * terminal autonomous goal decision.
 *
 * Provenance only:
 * - does not generate assertions
 * - does not modify verdict semantics
 * - does not change PASS/FAIL behavior
 */
return {
  ...testCase,
  ...(goalObservation
    ? {
        genericBrowserGoalObservation:
          goalObservation,
      }
    : {}),
  steps: [...sourceBoundAssertions],
};
}
