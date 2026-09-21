/*
 * GENERIC_BROWSER_USEFULNESS_TELEMETRY_SEMANTICS_V1
 *
 * Pure measurement semantics for autonomous generic-browser
 * usefulness.
 *
 * This module does not:
 * - enable autonomous execution,
 * - authorize an action,
 * - classify safety,
 * - execute browser interactions,
 * - decide acceptance proof,
 * - change a browser-case verdict.
 *
 * It only summarizes already-observed lifecycle events.
 */

export type GenericBrowserUsefulnessProposalDecision =
  | "PROPOSE_ACTION"
  | "PROPOSE_ROUTE"
  | "GOAL_ALREADY_SATISFIED"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT";

export type GenericBrowserUsefulnessEvent =

    | {
      kind: "OBSERVATION_RECORDED";
      iteration: number;
      url: string;
      controlCount: number;
      inputCount: number;
      surfaceCount: number;
    }

  | {
      kind: "PROPOSAL_ATTEMPTED";
      iteration: number;
    }
  | {
      kind: "PROPOSAL_RECORDED";
      iteration: number;
      decision:
        GenericBrowserUsefulnessProposalDecision;
      /*
       * GENERIC_BROWSER_USEFULNESS_PROPOSAL_PROVENANCE_V1
       *
       * Exact shadow artifact containing the observation,
       * proposal, and deterministic evaluation that produced
       * this recorded lifecycle decision.
       *
       * Measurement metadata only.
       */
      artifactPath?: string;
    }
  | {
      kind: "EVALUATION_RECORDED";
      iteration: number;
      status: string;
    }
  | {
      kind: "EXECUTION_RECORDED";
      iteration: number;
      status: string;
      executed: boolean;
      stateChanged: boolean;
    }
  | {
      kind: "HANDOFF_ELIGIBILITY_RECORDED";
      iteration: number;
      eligible: boolean;
    }
  | {
      kind: "HANDOFF_RESULT_RECORDED";
      iteration: number;
      attempted: boolean;
      passed: boolean;
    };



export type GenericBrowserUsefulnessTelemetrySummary = {
  schemaVersion: 1;

  proposalOpportunityCount: number;
  proposalRecordedCount: number;
  proposalRate: number | null;

  decisionCounts: Record<
    GenericBrowserUsefulnessProposalDecision,
    number
  >;

  noSafeActionCount: number;
  noSafeActionRate: number | null;

  needsMoreContextCount: number;
  goalAlreadySatisfiedCount: number;

  safeExecutableEvaluationCount: number;

  executionAttemptCount: number;
  verifiedStateChangingExecutionCount: number;
  verifiedStateChangingExecutionRate:
    | number
    | null;

  handoffEligibleCount: number;
  handoffAttemptCount: number;
  handoffPassCount: number;
  handoffSuccessRate: number | null;

  duplicateEventCount: number;
};

function ratio(
  numerator: number,
  denominator: number
): number | null {
  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function eventIdentity(
  event: GenericBrowserUsefulnessEvent
): string {
  return `${event.kind}:${event.iteration}`;
}

export function summarizeGenericBrowserUsefulness(
  events: readonly GenericBrowserUsefulnessEvent[]
): GenericBrowserUsefulnessTelemetrySummary {
  const seenEvents =
    new Set<string>();

  let duplicateEventCount = 0;

  let proposalOpportunityCount = 0;
  let proposalRecordedCount = 0;

  const decisionCounts: Record<
    GenericBrowserUsefulnessProposalDecision,
    number
  > = {
    PROPOSE_ACTION: 0,
    PROPOSE_ROUTE: 0,
    GOAL_ALREADY_SATISFIED: 0,
    NO_SAFE_ACTION: 0,
    NEEDS_MORE_CONTEXT: 0,
  };

  let safeExecutableEvaluationCount = 0;

  let executionAttemptCount = 0;
  let verifiedStateChangingExecutionCount = 0;

  let handoffEligibleCount = 0;
  let handoffAttemptCount = 0;
  let handoffPassCount = 0;

  for (const event of events) {
    const identity =
      eventIdentity(event);

    if (seenEvents.has(identity)) {
      duplicateEventCount += 1;
      continue;
    }

    seenEvents.add(identity);

    switch (event.kind) {
      case "PROPOSAL_ATTEMPTED": {
        proposalOpportunityCount += 1;
        break;
      }

      case "PROPOSAL_RECORDED": {
        proposalRecordedCount += 1;

        decisionCounts[event.decision] =
          decisionCounts[event.decision] + 1;

        break;
      }

      case "EVALUATION_RECORDED": {
        if (
          event.status ===
          "SAFE_TO_EXECUTE"
        ) {
          safeExecutableEvaluationCount += 1;
        }

        break;
      }

      case "EXECUTION_RECORDED": {
        executionAttemptCount += 1;

        if (
          event.status === "EXECUTED" &&
          event.executed === true &&
          event.stateChanged === true
        ) {
          verifiedStateChangingExecutionCount += 1;
        }

        break;
      }

      case "HANDOFF_ELIGIBILITY_RECORDED": {
        if (event.eligible) {
          handoffEligibleCount += 1;
        }

        break;
      }

      case "HANDOFF_RESULT_RECORDED": {
        if (event.attempted) {
          handoffAttemptCount += 1;

          if (event.passed) {
            handoffPassCount += 1;
          }
        }

        break;
      }
    }
  }

  const noSafeActionCount =
    decisionCounts.NO_SAFE_ACTION;

  const needsMoreContextCount =
    decisionCounts.NEEDS_MORE_CONTEXT;

  const goalAlreadySatisfiedCount =
    decisionCounts.GOAL_ALREADY_SATISFIED;

  return {
    schemaVersion: 1,

    proposalOpportunityCount,
    proposalRecordedCount,
    proposalRate: ratio(
      proposalRecordedCount,
      proposalOpportunityCount
    ),

    decisionCounts,

    noSafeActionCount,
    noSafeActionRate: ratio(
      noSafeActionCount,
      proposalRecordedCount
    ),

    needsMoreContextCount,
    goalAlreadySatisfiedCount,

    safeExecutableEvaluationCount,

    executionAttemptCount,
    verifiedStateChangingExecutionCount,
    verifiedStateChangingExecutionRate:
      ratio(
        verifiedStateChangingExecutionCount,
        executionAttemptCount
      ),

    handoffEligibleCount,
    handoffAttemptCount,
    handoffPassCount,
    handoffSuccessRate: ratio(
      handoffPassCount,
      handoffAttemptCount
    ),

    duplicateEventCount,
  };
}

/*
 * GENERIC_BROWSER_USEFULNESS_AGGREGATION_V1
 *
 * Run-level aggregation recomputes rates from summed
 * numerators and denominators.
 *
 * It intentionally does not average per-case rates and does
 * not produce a combined autonomy/usefulness score.
 */

export type GenericBrowserUsefulnessAggregate = {
  schemaVersion: 1;
  caseCount: number;

  proposalOpportunityCount: number;
  proposalRecordedCount: number;
  proposalRate: number | null;

  decisionCounts: Record<
    GenericBrowserUsefulnessProposalDecision,
    number
  >;

  noSafeActionCount: number;
  noSafeActionRate: number | null;

  needsMoreContextCount: number;
  goalAlreadySatisfiedCount: number;

  safeExecutableEvaluationCount: number;

  executionAttemptCount: number;
  verifiedStateChangingExecutionCount: number;
  verifiedStateChangingExecutionRate:
    | number
    | null;

  handoffEligibleCount: number;
  handoffAttemptCount: number;
  handoffPassCount: number;
  handoffSuccessRate: number | null;

  duplicateEventCount: number;
};

export function aggregateGenericBrowserUsefulness(
  summaries: readonly GenericBrowserUsefulnessTelemetrySummary[]
): GenericBrowserUsefulnessAggregate {
  const aggregate: GenericBrowserUsefulnessAggregate = {
    schemaVersion: 1,
    caseCount: summaries.length,

    proposalOpportunityCount: 0,
    proposalRecordedCount: 0,
    proposalRate: null,

    decisionCounts: {
      PROPOSE_ACTION: 0,
      PROPOSE_ROUTE: 0,
      GOAL_ALREADY_SATISFIED: 0,
      NO_SAFE_ACTION: 0,
      NEEDS_MORE_CONTEXT: 0,
    },

    noSafeActionCount: 0,
    noSafeActionRate: null,

    needsMoreContextCount: 0,
    goalAlreadySatisfiedCount: 0,

    safeExecutableEvaluationCount: 0,

    executionAttemptCount: 0,
    verifiedStateChangingExecutionCount: 0,
    verifiedStateChangingExecutionRate:
      null,

    handoffEligibleCount: 0,
    handoffAttemptCount: 0,
    handoffPassCount: 0,
    handoffSuccessRate: null,

    duplicateEventCount: 0,
  };

  for (const summary of summaries) {
    aggregate.proposalOpportunityCount +=
      summary.proposalOpportunityCount;

    aggregate.proposalRecordedCount +=
      summary.proposalRecordedCount;

    for (
      const decision of [
        "PROPOSE_ACTION",
        "PROPOSE_ROUTE",
        "GOAL_ALREADY_SATISFIED",
        "NO_SAFE_ACTION",
        "NEEDS_MORE_CONTEXT",
      ] as const
    ) {
      aggregate.decisionCounts[decision] +=
        summary.decisionCounts[decision];
    }

    aggregate.noSafeActionCount +=
      summary.noSafeActionCount;

    aggregate.needsMoreContextCount +=
      summary.needsMoreContextCount;

    aggregate.goalAlreadySatisfiedCount +=
      summary.goalAlreadySatisfiedCount;

    aggregate.safeExecutableEvaluationCount +=
      summary.safeExecutableEvaluationCount;

    aggregate.executionAttemptCount +=
      summary.executionAttemptCount;

    aggregate.verifiedStateChangingExecutionCount +=
      summary.verifiedStateChangingExecutionCount;

    aggregate.handoffEligibleCount +=
      summary.handoffEligibleCount;

    aggregate.handoffAttemptCount +=
      summary.handoffAttemptCount;

    aggregate.handoffPassCount +=
      summary.handoffPassCount;

    aggregate.duplicateEventCount +=
      summary.duplicateEventCount;
  }

  aggregate.proposalRate = ratio(
    aggregate.proposalRecordedCount,
    aggregate.proposalOpportunityCount
  );

  aggregate.noSafeActionRate = ratio(
    aggregate.noSafeActionCount,
    aggregate.proposalRecordedCount
  );

  aggregate.verifiedStateChangingExecutionRate =
    ratio(
      aggregate.verifiedStateChangingExecutionCount,
      aggregate.executionAttemptCount
    );

  aggregate.handoffSuccessRate = ratio(
    aggregate.handoffPassCount,
    aggregate.handoffAttemptCount
  );

  return aggregate;
}
