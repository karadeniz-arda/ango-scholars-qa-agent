import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET,
  GENERIC_BROWSER_BASE_ACTION_BUDGET,
  extendGenericBrowserActionBudgetAfterVerifiedExecution,
} from "./generic-browser-action-budget.js";

test(
  "keeps the six-action budget before six verified executions",
  () => {
    for (
      let verifiedExecutedSteps = 0;
      verifiedExecutedSteps < 6;
      verifiedExecutedSteps += 1
    ) {
      assert.equal(
        extendGenericBrowserActionBudgetAfterVerifiedExecution({
          currentBudget:
            GENERIC_BROWSER_BASE_ACTION_BUDGET,
          verifiedExecutedSteps,
        }),
        GENERIC_BROWSER_BASE_ACTION_BUDGET
      );
    }
  }
);

test(
  "earns one bounded extension after the sixth verified execution",
  () => {
    assert.equal(
      extendGenericBrowserActionBudgetAfterVerifiedExecution({
        currentBudget:
          GENERIC_BROWSER_BASE_ACTION_BUDGET,
        verifiedExecutedSteps: 6,
      }),
      GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET
    );
  }
);

test(
  "never extends beyond the absolute eight-action budget",
  () => {
    for (const verifiedExecutedSteps of [
      6,
      7,
      8,
      9,
    ]) {
      assert.equal(
        extendGenericBrowserActionBudgetAfterVerifiedExecution({
          currentBudget:
            GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET,
          verifiedExecutedSteps,
        }),
        GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET
      );
    }
  }
);

test(
  "does not grant a late extension when the six-action boundary was not earned",
  () => {
    assert.equal(
      extendGenericBrowserActionBudgetAfterVerifiedExecution({
        currentBudget:
          GENERIC_BROWSER_BASE_ACTION_BUDGET,
        verifiedExecutedSteps: 7,
      }),
      GENERIC_BROWSER_BASE_ACTION_BUDGET
    );
  }
);
