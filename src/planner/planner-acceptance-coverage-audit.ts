import type {
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
} from "./planner-acceptance-source-ledger.js";

export type PlannerAcceptanceCoverageUnitAudit = {
  sourceUnitId: string;
  status:
    | "REPRESENTED"
    | "UNRESOLVED";
  matchedCaseIds: string[];
};

export type PlannerAcceptanceCoverageAudit = {
  status:
    | "COMPLETE"
    | "INCOMPLETE"
    | "SOURCE_UNAVAILABLE";
  sourceUnitCount: number;
  representedUnitCount: number;
  unresolvedUnitCount: number;
  units: PlannerAcceptanceCoverageUnitAudit[];
};

function normalizeText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitPlanTextUnits(
  value: unknown
): string[] {
  const text =
    String(value ?? "").trim();

  if (!text) {
    return [];
  }

  return text
    .split(
      /(?:\r?\n)+|(?<=[.!?])\s+/
    )
    .map(normalizeText)
    .filter(Boolean);
}

function planCaseFragments(
  testCase: any
): string[] {
  return [
    testCase?.goal,
    testCase?.successCriteria,
    ...(Array.isArray(
      testCase?.automatedChecks
    )
      ? testCase.automatedChecks
      : []),
    ...(Array.isArray(
      testCase?.manualChecks
    )
      ? testCase.manualChecks
      : []),
    ...(Array.isArray(
      testCase?.fixtureRequirements
    )
      ? testCase.fixtureRequirements
      : []),
    testCase?.expect?.notes,
  ]
    .flatMap(splitPlanTextUnits)
    .filter(Boolean);
}

function exactRepresentationExists(
  sourceUnit:
    PlannerAcceptanceSourceUnit,
  testCase: any
): boolean {
  const source =
    normalizeText(sourceUnit.text);

  if (!source) {
    return false;
  }

  return planCaseFragments(testCase)
    .some(
      (fragment) =>
        fragment === source
    );
}

/*
 * PLANNER_ACCEPTANCE_COVERAGE_AUDIT_V1
 *
 * This audit is deliberately conservative.
 *
 * REPRESENTED is emitted only when one normalized plan
 * text unit exactly equals the authoritative Jira source unit.
 *
 * Plan fields are split into sentence/newline units first so
 * an exact requirement can still be preserved inside a larger
 * multi-sentence field without relying on substring matching.
 *
 * Paraphrase similarity, surrounding polarity changes, and
 * transformed wording remain UNRESOLVED.
 *
 * This metadata does not prove product behavior and does not
 * itself change a runtime verdict.
 */
export function auditPlannerAcceptanceCoverage(
  plan: any,
  ledger:
    PlannerAcceptanceSourceLedger
): PlannerAcceptanceCoverageAudit {
  if (
    ledger?.sourceStatus !== "RESOLVED"
  ) {
    return {
      status: "SOURCE_UNAVAILABLE",
      sourceUnitCount: 0,
      representedUnitCount: 0,
      unresolvedUnitCount: 0,
      units: [],
    };
  }

  const sourceUnits =
    Array.isArray(ledger?.sourceUnits)
      ? ledger.sourceUnits
      : [];

  const cases = [
    ...(Array.isArray(plan?.apiCases)
      ? plan.apiCases
      : []),
    ...(Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : []),
  ];

  const units =
    sourceUnits.map((sourceUnit) => {
      const matchedCaseIds =
        cases
          .filter((testCase) =>
            exactRepresentationExists(
              sourceUnit,
              testCase
            )
          )
          .map((testCase) =>
            String(
              testCase?.id ?? ""
            ).trim()
          )
          .filter(Boolean);

      return {
        sourceUnitId:
          sourceUnit.id,
        status:
          matchedCaseIds.length > 0
            ? "REPRESENTED"
            : "UNRESOLVED",
        matchedCaseIds,
      } satisfies
        PlannerAcceptanceCoverageUnitAudit;
    });

  const representedUnitCount =
    units.filter(
      (unit) =>
        unit.status === "REPRESENTED"
    ).length;

  const unresolvedUnitCount =
    units.length -
    representedUnitCount;

  return {
    status:
      unresolvedUnitCount === 0
        ? "COMPLETE"
        : "INCOMPLETE",
    sourceUnitCount:
      units.length,
    representedUnitCount,
    unresolvedUnitCount,
    units,
  };
}
