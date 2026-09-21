import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeGenericBrowserUsefulness,
} from "./generic-browser-usefulness-telemetry.js";

test(
  "uses null rates when no autonomous opportunity was observed",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([]);

    assert.equal(
      summary.proposalOpportunityCount,
      0
    );

    assert.equal(
      summary.proposalRate,
      null
    );

    assert.equal(
      summary.noSafeActionRate,
      null
    );

    assert.equal(
      summary.verifiedStateChangingExecutionRate,
      null
    );

    assert.equal(
      summary.handoffSuccessRate,
      null
    );
  }
);

test(
  "summarizes proposal, execution, and deterministic handoff observations separately",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision: "PROPOSE_ACTION",
        },
        {
          kind: "EVALUATION_RECORDED",
          iteration: 1,
          status: "SAFE_TO_EXECUTE",
        },
        {
          kind: "EXECUTION_RECORDED",
          iteration: 1,
          status: "EXECUTED",
          executed: true,
          stateChanged: true,
        },
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 2,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 2,
          decision:
            "GOAL_ALREADY_SATISFIED",
        },
        {
          kind:
            "HANDOFF_ELIGIBILITY_RECORDED",
          iteration: 2,
          eligible: true,
        },
        {
          kind: "HANDOFF_RESULT_RECORDED",
          iteration: 2,
          attempted: true,
          passed: true,
        },
      ]);

    assert.equal(
      summary.proposalOpportunityCount,
      2
    );

    assert.equal(
      summary.proposalRecordedCount,
      2
    );

    assert.equal(
      summary.proposalRate,
      1
    );

    assert.equal(
      summary.decisionCounts.PROPOSE_ACTION,
      1
    );

    assert.equal(
      summary.goalAlreadySatisfiedCount,
      1
    );

    assert.equal(
      summary.safeExecutableEvaluationCount,
      1
    );

    assert.equal(
      summary.executionAttemptCount,
      1
    );

    assert.equal(
      summary.verifiedStateChangingExecutionCount,
      1
    );

    assert.equal(
      summary.verifiedStateChangingExecutionRate,
      1
    );

    assert.equal(
      summary.handoffEligibleCount,
      1
    );

    assert.equal(
      summary.handoffAttemptCount,
      1
    );

    assert.equal(
      summary.handoffPassCount,
      1
    );

    assert.equal(
      summary.handoffSuccessRate,
      1
    );
  }
);

test(
  "reports NO_SAFE_ACTION without pretending a useful action existed",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision: "NO_SAFE_ACTION",
        },
        {
          kind: "EVALUATION_RECORDED",
          iteration: 1,
          status: "NO_SAFE_ACTION",
        },
      ]);

    assert.equal(
      summary.noSafeActionCount,
      1
    );

    assert.equal(
      summary.noSafeActionRate,
      1
    );

    assert.equal(
      summary.executionAttemptCount,
      0
    );

    assert.equal(
      summary.verifiedStateChangingExecutionCount,
      0
    );
  }
);

test(
  "deduplicates repeated lifecycle records instead of reproducing log-line inflation",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision:
            "NEEDS_MORE_CONTEXT",
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision:
            "NEEDS_MORE_CONTEXT",
        },
      ]);

    assert.equal(
      summary.proposalOpportunityCount,
      1
    );

    assert.equal(
      summary.proposalRecordedCount,
      1
    );

    assert.equal(
      summary.needsMoreContextCount,
      1
    );

    assert.equal(
      summary.duplicateEventCount,
      2
    );
  }
);

test(
  "does not count an impossible unattempted handoff as a successful handoff",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([
        {
          kind: "HANDOFF_RESULT_RECORDED",
          iteration: 1,
          attempted: false,
          passed: true,
        },
      ]);

    assert.equal(
      summary.handoffAttemptCount,
      0
    );

    assert.equal(
      summary.handoffPassCount,
      0
    );

    assert.equal(
      summary.handoffSuccessRate,
      null
    );
  }
);

test(
  "aggregates run metrics from summed denominators instead of averaging case rates",
  async () => {
    const {
      aggregateGenericBrowserUsefulness,
    } = await import(
      "./generic-browser-usefulness-telemetry.js"
    );

    const first =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision: "PROPOSE_ACTION",
        },
        {
          kind: "EVALUATION_RECORDED",
          iteration: 1,
          status: "SAFE_TO_EXECUTE",
        },
        {
          kind: "EXECUTION_RECORDED",
          iteration: 1,
          status: "EXECUTED",
          executed: true,
          stateChanged: true,
        },
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 2,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 2,
          decision:
            "GOAL_ALREADY_SATISFIED",
        },
        {
          kind:
            "HANDOFF_ELIGIBILITY_RECORDED",
          iteration: 2,
          eligible: true,
        },
        {
          kind: "HANDOFF_RESULT_RECORDED",
          iteration: 2,
          attempted: true,
          passed: true,
        },
      ]);

    const second =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision:
            "NEEDS_MORE_CONTEXT",
        },
      ]);

    const aggregate =
      aggregateGenericBrowserUsefulness([
        first,
        second,
      ]);

    assert.equal(
      aggregate.caseCount,
      2
    );

    assert.equal(
      aggregate.proposalOpportunityCount,
      3
    );

    assert.equal(
      aggregate.proposalRecordedCount,
      3
    );

    assert.equal(
      aggregate.proposalRate,
      1
    );

    assert.equal(
      aggregate.decisionCounts
        .PROPOSE_ACTION,
      1
    );

    assert.equal(
      aggregate.decisionCounts
        .GOAL_ALREADY_SATISFIED,
      1
    );

    assert.equal(
      aggregate.decisionCounts
        .NEEDS_MORE_CONTEXT,
      1
    );

    assert.equal(
      aggregate.handoffAttemptCount,
      1
    );

    assert.equal(
      aggregate.handoffPassCount,
      1
    );

    assert.equal(
      aggregate.handoffSuccessRate,
      1
    );
  }
);

test(
  "keeps run-level rates null when their aggregate denominator is zero",
  async () => {
    const {
      aggregateGenericBrowserUsefulness,
    } = await import(
      "./generic-browser-usefulness-telemetry.js"
    );

    const aggregate =
      aggregateGenericBrowserUsefulness([]);

    assert.equal(
      aggregate.caseCount,
      0
    );

    assert.equal(
      aggregate.proposalRate,
      null
    );

    assert.equal(
      aggregate.noSafeActionRate,
      null
    );

    assert.equal(
      aggregate.verifiedStateChangingExecutionRate,
      null
    );

    assert.equal(
      aggregate.handoffSuccessRate,
      null
    );
  }
);

test(
  "proposal artifact provenance does not change usefulness metric semantics",
  () => {
    const summary =
      summarizeGenericBrowserUsefulness([
        {
          kind: "PROPOSAL_ATTEMPTED",
          iteration: 1,
        },
        {
          kind: "PROPOSAL_RECORDED",
          iteration: 1,
          decision: "NO_SAFE_ACTION",
          artifactPath:
            "/tmp/shadow/as-1058/web-1-example.json",
        },
        {
          kind: "EVALUATION_RECORDED",
          iteration: 1,
          status: "NO_SAFE_ACTION",
        },
      ]);

    assert.equal(
      summary.proposalOpportunityCount,
      1
    );

    assert.equal(
      summary.proposalRecordedCount,
      1
    );

    assert.equal(
      summary.decisionCounts.NO_SAFE_ACTION,
      1
    );

    assert.equal(
      summary.noSafeActionCount,
      1
    );

    assert.equal(
      summary.noSafeActionRate,
      1
    );
  }
);
