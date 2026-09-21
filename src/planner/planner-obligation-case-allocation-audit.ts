import type {
  PlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";

export type PlannerObligationCaseAllocation = {
  obligationId: string;
  status:
    | "STABLE_ID_CASE_REPRESENTATION"
    | "EXACT_CASE_REPRESENTATION"
    | "EXACT_REPRESENTATION_REMOVED"
    | "NOTES_ONLY"
    | "NOT_EXACTLY_REPRESENTED";
  matchedCaseIds: string[];
  removedCaseIds: string[];
};

export type PlannerObligationCaseAllocationAudit = {
  obligationCount: number;
  stableIdCaseRepresentationCount: number;
  exactCaseRepresentationCount: number;
  exactRepresentationRemovedCount: number;
  notesOnlyCount: number;
  notExactlyRepresentedCount: number;
  allocations: PlannerObligationCaseAllocation[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitTextUnits(value: unknown): string[] {
  const text = String(value ?? "").trim();

  if (!text) return [];

  return text
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map(normalizeText)
    .filter(Boolean);
}

function caseFragments(testCase: any): string[] {
  return [
    testCase?.goal,
    testCase?.successCriteria,
    ...(Array.isArray(testCase?.automatedChecks)
      ? testCase.automatedChecks
      : []),
    ...(Array.isArray(testCase?.manualChecks)
      ? testCase.manualChecks
      : []),
    ...(Array.isArray(testCase?.fixtureRequirements)
      ? testCase.fixtureRequirements
      : []),
    testCase?.expect?.notes,
  ].flatMap(splitTextUnits);
}

export function findExactObligationIdsForCase(
  testCase: any,
  ledger?: PlannerAcceptanceObligationLedger
): string[] {
  const fragments = new Set(
    caseFragments(testCase)
  );

  return (Array.isArray(ledger?.obligations)
    ? ledger.obligations
    : []
  )
    .filter((obligation) =>
      fragments.has(
        normalizeText(obligation.text)
      )
    )
    .map((obligation) => obligation.id)
    .sort();
}

function findStableObligationIdsForCase(
  testCase: any,
  ledger?: PlannerAcceptanceObligationLedger
): string[] {
  const authoritativeIds = new Set(
    (ledger?.obligations ?? []).map(
      (obligation) => obligation.id
    )
  );

  return (Array.isArray(
    testCase?.acceptanceObligationIds
  )
    ? testCase.acceptanceObligationIds
    : []
  )
    .map(String)
    .filter((id: string) =>
      authoritativeIds.has(id)
    )
    .sort();
}

/** Stable-ID allocation first; legacy exact-text matching remains observational. */
export function auditPlannerObligationCaseAllocation(
  plan: any,
  ledger: PlannerAcceptanceObligationLedger
): PlannerObligationCaseAllocationAudit {
  const obligations = Array.isArray(
    ledger?.obligations
  )
    ? ledger.obligations
    : [];
  const cases = [
    ...(Array.isArray(plan?.apiCases)
      ? plan.apiCases
      : []),
    ...(Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : []),
  ];
  const removals = Array.isArray(
    plan?.plannerCaseBudgetAudit?.removals
  )
    ? plan.plannerCaseBudgetAudit.removals
    : [];
  const notesFragments = new Set(
    splitTextUnits(plan?.notes)
  );

  const allocations = obligations.map(
    (obligation) => {
      const stableIdCaseIds = cases
        .filter((testCase) =>
          findStableObligationIdsForCase(
            testCase,
            ledger
          ).includes(obligation.id)
        )
        .map((testCase) =>
          String(testCase?.id ?? "")
        )
        .filter(Boolean);
      const matchedCaseIds = cases
        .filter((testCase) =>
          findExactObligationIdsForCase(
            testCase,
            ledger
          ).includes(obligation.id)
        )
        .map((testCase) =>
          String(testCase?.id ?? "")
        )
        .filter(Boolean);
      const removedCaseIds = removals
        .filter((removal: any) =>
          Array.isArray(
            removal?.exactObligationIds
          ) &&
          removal.exactObligationIds.includes(
            obligation.id
          )
        )
        .map((removal: any) =>
          String(
            removal?.originalCaseId ?? ""
          )
        )
        .filter(Boolean);
      const notesOnly =
        notesFragments.has(
          normalizeText(obligation.text)
        );

      return {
        obligationId: obligation.id,
        status:
          stableIdCaseIds.length > 0
            ? "STABLE_ID_CASE_REPRESENTATION"
            : matchedCaseIds.length > 0
            ? "EXACT_CASE_REPRESENTATION"
            : removedCaseIds.length > 0
              ? "EXACT_REPRESENTATION_REMOVED"
              : notesOnly
                ? "NOTES_ONLY"
                : "NOT_EXACTLY_REPRESENTED",
        matchedCaseIds:
          stableIdCaseIds.length > 0
            ? stableIdCaseIds
            : matchedCaseIds,
        removedCaseIds,
      } satisfies PlannerObligationCaseAllocation;
    }
  );

  return {
    obligationCount: allocations.length,
    stableIdCaseRepresentationCount:
      allocations.filter(
        (item) =>
          item.status ===
          "STABLE_ID_CASE_REPRESENTATION"
      ).length,
    exactCaseRepresentationCount:
      allocations.filter(
        (item) =>
          item.status ===
          "EXACT_CASE_REPRESENTATION"
      ).length,
    exactRepresentationRemovedCount:
      allocations.filter(
        (item) =>
          item.status ===
          "EXACT_REPRESENTATION_REMOVED"
      ).length,
    notesOnlyCount: allocations.filter(
      (item) => item.status === "NOTES_ONLY"
    ).length,
    notExactlyRepresentedCount:
      allocations.filter(
        (item) =>
          item.status ===
          "NOT_EXACTLY_REPRESENTED"
      ).length,
    allocations,
  };
}
