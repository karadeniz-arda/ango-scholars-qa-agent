/*
 * GENERIC_BROWSER_VERIFIED_EXECUTION_BUDGET_V1
 *
 * This policy does not claim verified goal convergence.
 * It only grants one small bounded continuation after the
 * existing runner has already verified six successful
 * state-changing actions.
 */

export const GENERIC_BROWSER_BASE_ACTION_BUDGET =
  6;

export const GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET =
  8;

type GenericBrowserActionBudgetInput = {
  currentBudget: number;
  verifiedExecutedSteps: number;
};

export function extendGenericBrowserActionBudgetAfterVerifiedExecution({
  currentBudget,
  verifiedExecutedSteps,
}: GenericBrowserActionBudgetInput): number {
  if (
    currentBudget !==
      GENERIC_BROWSER_BASE_ACTION_BUDGET ||
    verifiedExecutedSteps !==
      GENERIC_BROWSER_BASE_ACTION_BUDGET
  ) {
    return currentBudget;
  }

  return GENERIC_BROWSER_ABSOLUTE_ACTION_BUDGET;
}
