import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import {
  generateTrustedDeterministicRawPass,
  type BrowserDeterministicCasePassEligibilityDecision,
  type BrowserLocalStatePassProof,
  type BrowserSourceBoundAssertionSetPassProof,
} from "./browser-deterministic-pass-policy.js";
import {
  materializeBrowserDeterministicPassRuntimePrerequisites,
  type BrowserDeterministicPassRuntimeContext,
} from "./browser-deterministic-pass-runtime-context.js";
import type { BrowserStepResult } from "./browser-execution-types.js";

export type BrowserDeterministicPassAttempt =
  | {
      status: "NOT_ATTEMPTED";
      reason:
        | "RUNTIME_PREREQUISITES_UNAVAILABLE"
        | "NO_APPROVED_PROOF_BUNDLE";
    }
  | {
      status: "ATTEMPTED";
      decision: BrowserDeterministicCasePassEligibilityDecision;
    };

/**
 * The only production entry point for deterministic raw-PASS generation.
 * It transports approved proof objects unchanged and lets the established
 * policy independently revalidate every eligibility condition.
 */
export function attemptDeterministicBrowserPass(args: {
  testCase: BrowserTestCase;
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  browserObligationBindings: PlannerBrowserObligationBinding[] | undefined;
  currentResult: BrowserStepResult;
  localStatePassProofs: BrowserLocalStatePassProof[];
  sourceBoundAssertionSetPassProofs: BrowserSourceBoundAssertionSetPassProof[];
  deterministicPassRuntimeContext: BrowserDeterministicPassRuntimeContext;
}): BrowserDeterministicPassAttempt {
  if (args.testCase.executionVerdictScope) {
    args.currentResult.executionVerdictScope =
      args.testCase.executionVerdictScope;
  }
  const runtime = materializeBrowserDeterministicPassRuntimePrerequisites(
    args.deterministicPassRuntimeContext
  );
  if (!runtime) {
    return {
      status: "NOT_ATTEMPTED",
      reason: "RUNTIME_PREREQUISITES_UNAVAILABLE",
    };
  }

  if (
    args.localStatePassProofs.length === 0 &&
    args.sourceBoundAssertionSetPassProofs.length === 0
  ) {
    return {
      status: "NOT_ATTEMPTED",
      reason: "NO_APPROVED_PROOF_BUNDLE",
    };
  }

  return {
    status: "ATTEMPTED",
    decision: generateTrustedDeterministicRawPass({
      testCase: args.testCase,
      obligationLedger: args.obligationLedger,
      browserObligationBindings: args.browserObligationBindings,
      currentResult: args.currentResult,
      localStateProofs: args.localStatePassProofs,
      sourceBoundAssertionSetProofs:
        args.sourceBoundAssertionSetPassProofs,
      runtime,
    }),
  };
}
