import type { Page } from "playwright";

import {
  runGenericBrowserShadow,
  type BrowserShadowAction,
} from "./browser-agent-shadow.js";

import {
  executeBrowserReadOnlyProposal,
} from "./browser-agent-readonly-executor.js";

import {
  buildGenericBrowserActionSignature,
} from "./generic-browser-action-cycle.js";
import {
  appendGenericBrowserProgressionTransition,
  buildGenericBrowserProgressionState,
  type GenericBrowserProgressionTransition,
} from "./generic-browser-progression-memory.js";

import {
  GENERIC_BROWSER_BASE_ACTION_BUDGET,
  extendGenericBrowserActionBudgetAfterVerifiedExecution,
} from "./generic-browser-action-budget.js";

import type {
  BrowserObservation,
} from "./browser-observation.js";
import type { BrowserShadowMatchedTarget } from "./browser-agent-shadow-evaluator.js";

import type {
  GenericBrowserUsefulnessEvent,
} from "./generic-browser-usefulness-telemetry.js";

import {
  recognizeOperationalCapabilityTransition,
  type BrowserStandardRunCapabilityRecognition,
  type RecognizeOperationalCapabilityTransitionArgs,
} from "./browser-standard-run-capability-recognition.js";

export type GenericBrowserRuntimeAttemptPolicy = {
  allowActionExecution: boolean;
};

export type GenericBrowserRuntimeAttemptResult = {
  stopReason: string;
  goalAlreadySatisfied: boolean;
  goalIteration: number | null;
  goalObservation: BrowserObservation | null;
  /** Exact evaluator match retained only as runtime-binding candidate evidence. */
  goalMatchedTarget: BrowserShadowMatchedTarget | null;
  events: GenericBrowserUsefulnessEvent[];
  capabilityRecognitions: BrowserStandardRunCapabilityRecognition[];
  executedActionHistory: BrowserShadowAction[];
  verifiedStateChangingActionCount: number;
  actionBudget: number;
  budgetExhausted: boolean;
};

/*
 * GENERIC_BROWSER_RUNTIME_ATTEMPT_SEAM_V1
 *
 * Interaction-only runtime seam.
 *
 * This helper may observe, propose, deterministically evaluate and,
 * when policy permits, execute the existing bounded read-only browser
 * interaction loop.
 *
 * It owns no fixture preparation, deterministic acceptance proof,
 * evidence reconciliation, requirement discharge, or final verdict.
 */
export async function runGenericBrowserRuntimeAttempt(args: {
  page: Page;
  issueKey: string;
  testCase: Parameters<typeof runGenericBrowserShadow>[0]["testCase"];
  policy: GenericBrowserRuntimeAttemptPolicy;
  runShadow?: typeof runGenericBrowserShadow;
  executeProposal?: typeof executeBrowserReadOnlyProposal;
  recordSafetyEvaluation?: (evaluation: { safeToExecute: boolean; executed: boolean }) => void;
}): Promise<GenericBrowserRuntimeAttemptResult> {
  const runShadow =
    args.runShadow ?? runGenericBrowserShadow;

  const executeProposal =
    args.executeProposal ?? executeBrowserReadOnlyProposal;

  let genericBrowserActionBudget =
    GENERIC_BROWSER_BASE_ACTION_BUDGET;

  let genericBrowserExecutedSteps = 0;

  let genericBrowserStopReason = "";

  const genericBrowserUsefulnessEvents:
    GenericBrowserUsefulnessEvent[] = [];

  const genericBrowserCapabilityRecognitions:
    BrowserStandardRunCapabilityRecognition[] = [];

  let pendingOperationalCapabilityTransition:
    Omit<
      RecognizeOperationalCapabilityTransitionArgs,
      "settlementObservation"
    > | null = null;

  let genericBrowserGoalIteration:
    number | null = null;

  const genericBrowserExecutedActions =
    new Set<string>();

  let genericBrowserGoalObservation:
    BrowserObservation | null = null;
  let genericBrowserGoalMatchedTarget:
    BrowserShadowMatchedTarget | null = null;

  const genericBrowserExecutedActionHistory:
    BrowserShadowAction[] = [];

  let genericBrowserProgressionHistory:
    GenericBrowserProgressionTransition[] = [];

  for (
    let genericStepIndex = 0;
    genericStepIndex < genericBrowserActionBudget;
    genericStepIndex += 1
  ) {
    const genericBrowserIteration =
      genericStepIndex + 1;

    const shadowResult =
      await runShadow({
        page: args.page,
        issueKey: args.issueKey,
        testCase: args.testCase,
        executedActions:
          genericBrowserExecutedActionHistory,
        progressionHistory:
          genericBrowserProgressionHistory,
      });
    const proposalEvaluated =
      shadowResult.status === "RECORDED" ||
      shadowResult.status === "EVALUATED";

    /*
     * Preserve the existing capability-recognition settlement bridge.
     *
     * Recognition is observational only and cannot affect proposal,
     * execution authorization, proof, fallback, or verdict.
     */
    if (
      pendingOperationalCapabilityTransition &&
      proposalEvaluated
    ) {
      const recognition =
        recognizeOperationalCapabilityTransition({
          ...pendingOperationalCapabilityTransition,
          settlementObservation:
            shadowResult.observation,
        });

      if (recognition) {
        genericBrowserCapabilityRecognitions.push(
          recognition
        );
      }

      pendingOperationalCapabilityTransition = null;
    }

    if (
      proposalEvaluated
    ) {
      genericBrowserUsefulnessEvents.push({
        kind: "OBSERVATION_RECORDED",
        iteration: genericBrowserIteration,
        url: shadowResult.observation.url,
        controlCount:
          shadowResult.observation.counts.controls,
        inputCount:
          shadowResult.observation.counts.inputs,
        surfaceCount:
          shadowResult.observation.counts.surfaces,
      });
    }

    /*
     * SKIPPED means autonomous proposal generation is disabled,
     * so the iteration is not a usefulness opportunity.
     */
    if (
      shadowResult.status !== "SKIPPED"
    ) {
      genericBrowserUsefulnessEvents.push({
        kind: "PROPOSAL_ATTEMPTED",
        iteration: genericBrowserIteration,
      });
    }

    if (
      proposalEvaluated
    ) {
      genericBrowserUsefulnessEvents.push(
        {
          kind: "PROPOSAL_RECORDED",
          iteration: genericBrowserIteration,
          decision:
            shadowResult.proposal.decision,
          ...(shadowResult.status === "RECORDED"
            ? { artifactPath: shadowResult.artifactPath }
            : {}),
        },
        {
          kind: "EVALUATION_RECORDED",
          iteration: genericBrowserIteration,
          status:
            shadowResult.evaluation.status,
        }
      );
    }

    if (
      shadowResult.status !== "SKIPPED"
    ) {
      console.log(
        ` Generic browser shadow ` +
          `[${genericStepIndex + 1}/` +
          `${genericBrowserActionBudget}]: ` +
          `${shadowResult.note}`
      );
    }

    if (
      !proposalEvaluated
    ) {
      genericBrowserStopReason =
        shadowResult.status;

      break;
    }

    if (
      shadowResult.proposal.decision ===
        "GOAL_ALREADY_SATISFIED" &&
      shadowResult.evaluation.status ===
        "ALREADY_SATISFIED" &&
      shadowResult.evaluation.grounded === true
    ) {
      genericBrowserStopReason =
        "GOAL_ALREADY_SATISFIED";

      genericBrowserGoalIteration =
        genericBrowserIteration;

      genericBrowserGoalObservation =
        shadowResult.observation;
      genericBrowserGoalMatchedTarget =
        shadowResult.evaluation.matchedTarget ?? null;

      console.log(
        ` Generic browser navigation reached ` +
          `GOAL_ALREADY_SATISFIED; canonical ` +
          `deterministic handoff eligibility will be evaluated separately.`
      );

      break;
    }

    /*
     * Non-executable decisions are terminal outcomes for the
     * bounded interaction attempt.
     */
    if (
      shadowResult.evaluation.safeToExecute !== true ||
      shadowResult.evaluation.grounded !== true
    ) {
      args.recordSafetyEvaluation?.({
        safeToExecute: shadowResult.evaluation.safeToExecute,
        executed: false,
      });
      console.log(
        ` Generic browser navigation stopped: ` +
          `${shadowResult.evaluation.status} - ` +
          `${shadowResult.evaluation.reason}`
      );

      genericBrowserStopReason =
        shadowResult.evaluation.status;

      break;
    }

    /*
     * Observation-only benchmark policy:
     *
     * Evaluation has completed, but the executor must never be
     * reached even if the existing evaluator says SAFE_TO_EXECUTE.
     */
    if (!args.policy.allowActionExecution) {
      genericBrowserStopReason =
        "OBSERVATION_ONLY_POLICY_STOP";

      console.log(
        ` Generic browser navigation stopped: ` +
          `OBSERVATION_ONLY_POLICY_STOP - action execution ` +
          `is disabled by the runtime-attempt caller policy.`
      );

      break;
    }

    const proposedAction =
      shadowResult.proposal.action;

    const actionSignature =
      buildGenericBrowserActionSignature(
        proposedAction,
        shadowResult.evaluation.matchedTarget
      );

    if (
      actionSignature &&
      genericBrowserExecutedActions.has(
        actionSignature
      )
    ) {
      genericBrowserStopReason =
        "REPEATED_ACTION";

      console.log(
        ` Generic browser navigation stopped: ` +
          `REPEATED_ACTION - the same exact action was ` +
          `already executed in this bounded navigation attempt.`
      );

      break;
    }

    const readOnlyExecutionResult =
      await executeProposal({
        page: args.page,
        proposal:
          shadowResult.proposal,
        evaluation:
          shadowResult.evaluation,
      });

    args.recordSafetyEvaluation?.({
      safeToExecute: shadowResult.evaluation.safeToExecute,
      executed: readOnlyExecutionResult.executed,
    });

    const operationalCapabilityCandidate =
      proposedAction &&
      shadowResult.evaluation.matchedTarget
        ? recognizeOperationalCapabilityTransition({
            beforeObservation:
              shadowResult.observation,
            proposedAction,
            matchedTarget:
              shadowResult.evaluation.matchedTarget,
            executionResult:
              readOnlyExecutionResult,
          })
        : null;

    if (operationalCapabilityCandidate) {
      if (
        readOnlyExecutionResult.status === "EXECUTED" &&
        readOnlyExecutionResult.executed === true &&
        readOnlyExecutionResult.stateChanged === true &&
        readOnlyExecutionResult.afterObservation
      ) {
        pendingOperationalCapabilityTransition = {
          beforeObservation:
            shadowResult.observation,
          proposedAction: proposedAction!,
          matchedTarget:
            shadowResult.evaluation.matchedTarget!,
          executionResult:
            readOnlyExecutionResult,
        };
      } else {
        genericBrowserCapabilityRecognitions.push(
          operationalCapabilityCandidate
        );
      }
    }

    if (
      readOnlyExecutionResult.status !== "SKIPPED"
    ) {
      genericBrowserUsefulnessEvents.push({
        kind: "EXECUTION_RECORDED",
        iteration: genericBrowserIteration,
        status:
          readOnlyExecutionResult.status,
        executed:
          readOnlyExecutionResult.executed,
        stateChanged:
          readOnlyExecutionResult.stateChanged,
      });
    }

    if (
      readOnlyExecutionResult.status !== "SKIPPED"
    ) {
      console.log(
        ` Generic browser read-only execution ` +
          `[${genericStepIndex + 1}/` +
          `${genericBrowserActionBudget}]: ` +
          `${readOnlyExecutionResult.status} - ` +
          `${readOnlyExecutionResult.note}`
      );
    }

    /*
     * Observation is a read-only context-acquisition primitive.
     *
     * A successful observe intentionally reports stateChanged=false. It may
     * advance to the next bounded decision, but it must not become verified
     * state-changing interaction history or consume the verified-execution
     * counter.
     */
    const successfulObservationRefresh =
      proposedAction?.kind === "observe" &&
      readOnlyExecutionResult.status === "EXECUTED" &&
      readOnlyExecutionResult.executed === true &&
      readOnlyExecutionResult.stateChanged === false &&
      Boolean(readOnlyExecutionResult.afterObservation);

    if (successfulObservationRefresh) {
      continue;
    }

    /*
     * All other autonomous actions continue only after a verified observable
     * state change.
     */
    if (
      readOnlyExecutionResult.status !== "EXECUTED" ||
      readOnlyExecutionResult.executed !== true ||
      readOnlyExecutionResult.stateChanged !== true
    ) {
      genericBrowserStopReason =
        readOnlyExecutionResult.status;

      break;
    }

    if (actionSignature) {
      genericBrowserExecutedActions.add(
        actionSignature
      );
    }

    if (proposedAction) {
      genericBrowserExecutedActionHistory.push({
        kind: proposedAction.kind,
        target: proposedAction.target,
        ...(
          proposedAction.value
            ? {
                value: proposedAction.value,
              }
            : {}
        ),
        ...(
          proposedAction.contextText
            ? {
                contextText:
                  proposedAction.contextText,
              }
            : {}
        ),
      });
    }

    if (
      proposedAction &&
      actionSignature &&
      shadowResult.evaluation.matchedTarget
    ) {
      genericBrowserProgressionHistory =
        appendGenericBrowserProgressionTransition(
          genericBrowserProgressionHistory,
          {
            iteration: genericBrowserIteration,
            startState:
              buildGenericBrowserProgressionState(
                shadowResult.observation
              ),
            action: proposedAction,
            actionSignature,
            /* Goal/proof completion is terminal in this loop. */
            goalOrProofProgressed: false,
          }
        );
    }

    genericBrowserExecutedSteps += 1;

    const extendedGenericBrowserActionBudget =
      extendGenericBrowserActionBudgetAfterVerifiedExecution({
        currentBudget:
          genericBrowserActionBudget,
        verifiedExecutedSteps:
          genericBrowserExecutedSteps,
      });

    if (
      extendedGenericBrowserActionBudget >
      genericBrowserActionBudget
    ) {
      console.log(
        `Generic browser verified-execution budget ` +
          `extended: ${genericBrowserActionBudget} -> ` +
          `${extendedGenericBrowserActionBudget} after ` +
          `${genericBrowserExecutedSteps} verified ` +
          `state-changing actions.`
      );
    }

    genericBrowserActionBudget =
      extendedGenericBrowserActionBudget;
  }

  /*
   * Preserve the old loop's unsettled-transition fallback.
   */
  if (pendingOperationalCapabilityTransition) {
    const unsettledRecognition =
      recognizeOperationalCapabilityTransition(
        pendingOperationalCapabilityTransition
      );

    if (unsettledRecognition) {
      genericBrowserCapabilityRecognitions.push(
        unsettledRecognition
      );
    }

    pendingOperationalCapabilityTransition = null;
  }

  const genericBrowserBudgetExhausted =
    genericBrowserExecutedSteps ===
    genericBrowserActionBudget;

  return {
    stopReason:
      genericBrowserStopReason,
    goalAlreadySatisfied:
      genericBrowserStopReason ===
      "GOAL_ALREADY_SATISFIED",
    goalIteration:
      genericBrowserGoalIteration,
    goalObservation:
      genericBrowserGoalObservation,
    goalMatchedTarget:
      genericBrowserGoalMatchedTarget,
    events:
      genericBrowserUsefulnessEvents,
    capabilityRecognitions:
      genericBrowserCapabilityRecognitions,
    executedActionHistory:
      genericBrowserExecutedActionHistory,
    verifiedStateChangingActionCount:
      genericBrowserExecutedSteps,
    actionBudget:
      genericBrowserActionBudget,
    budgetExhausted:
      genericBrowserBudgetExhausted,
  };
}
