import {
  createHash,
} from "node:crypto";

import type {
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
} from "./planner-acceptance-source-ledger.js";
import {
  isBoundedExplicitTaskBehavior,
} from "./planner-browser-obligation-semantics.js";

export type PlannerDescriptionSectionRole =
  | "ACCEPTANCE"
  | "EXPECTED_BEHAVIOR"
  | "ACTUAL_BEHAVIOR"
  | "CONTEXT"
  | "REPRODUCTION"
  | "ENVIRONMENT"
  | "TECHNICAL_NOTE"
  | "REQUIREMENTS"
  | "TASK"
  | "UNCLASSIFIED";

export type PlannerAcceptanceObligation = {
  id: string;
  sourceUnitIds: string[];
  sourceRole:
    | "ACCEPTANCE"
    | "EXPECTED_BEHAVIOR"
    | "TASK";
  derivation:
    | "DIRECT_ACCEPTANCE_FIELD"
    | "DIRECT_DESCRIPTION_SECTION"
    | "DIRECT_TASK_SECTION";
  text: string;
};

export type PlannerAcceptanceObligationLedger = {
  sourceStatus:
    | "RESOLVED"
    | "UNAVAILABLE";
  derivationStatus:
    | "RESOLVED"
    | "NO_HIGH_CONFIDENCE_OBLIGATIONS"
    | "SOURCE_UNAVAILABLE";
  obligations:
    PlannerAcceptanceObligation[];
  unresolvedSourceUnitIds: string[];
};

function normalizeHeading(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:;,.]+$/g, "")
    .trim()
    .toLowerCase();
}

/*
 * PLANNER_DESCRIPTION_SECTION_ROLE_V0
 *
 * Exact, formatting-normalized Jira heading roles only.
 * Unknown or extended headings deliberately abstain instead
 * of relying on substring, fuzzy, or semantic matching.
 */
export function classifyPlannerDescriptionSection(
  sectionHeading: unknown
): PlannerDescriptionSectionRole {
  switch (normalizeHeading(sectionHeading)) {
    case "acceptance criteria":
    case "acceptance criterion":
      return "ACCEPTANCE";
    case "expected behavior":
    case "expected behaviour":
    case "expected result":
    case "expected results":
      return "EXPECTED_BEHAVIOR";
    case "actual behavior":
    case "actual behaviour":
      return "ACTUAL_BEHAVIOR";
    case "context":
      return "CONTEXT";
    case "steps to reproduce":
      return "REPRODUCTION";
    case "environment":
      return "ENVIRONMENT";
    case "technical note":
    case "technical notes":
      return "TECHNICAL_NOTE";
    case "requirements":
      return "REQUIREMENTS";
    case "task":
      return "TASK";
    default:
      return "UNCLASSIFIED";
  }
}

function buildStableObligationId(
  derivation:
    PlannerAcceptanceObligation[
      "derivation"
    ],
  sourceUnitIds: string[]
): string {
  const digest =
    createHash("sha256")
      .update(
        [
          derivation,
          ...[...sourceUnitIds].sort(),
        ].join("\u0000")
      )
      .digest("hex")
      .slice(0, 12);

  return `jira-obligation-${digest}`;
}

function hasStrongRequirementModality(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim().toLowerCase();
  return /\b(?:must|shall|should)\b/.test(text) ||
    /^(?:add|allow|display|do not|hide|include|mention|open|prevent|provide|render|show|use|view)\b/.test(text) ||
    /^when\b.+\b(?:display|hide|open|prevent|render|show)\b/.test(text);
}

function deriveObligation(
  sourceUnit:
    PlannerAcceptanceSourceUnit
): PlannerAcceptanceObligation | undefined {
  let sourceRole:
    PlannerAcceptanceObligation[
      "sourceRole"
    ];
  let derivation:
    PlannerAcceptanceObligation[
      "derivation"
    ];

  if (
    sourceUnit.sourceKind ===
    "ACCEPTANCE_CRITERIA"
  ) {
    sourceRole = "ACCEPTANCE";
    derivation =
      "DIRECT_ACCEPTANCE_FIELD";
  } else if (
    sourceUnit.sourceKind ===
    "DESCRIPTION"
  ) {
    const sectionRole =
      classifyPlannerDescriptionSection(
        sourceUnit.sectionHeading
      );

    if (sectionRole === "TASK") {
      if (
        !isBoundedExplicitTaskBehavior(
          sourceUnit.text
        )
      ) {
        return undefined;
      }

      sourceRole = "TASK";
      derivation =
        "DIRECT_TASK_SECTION";
    } else if (
      sectionRole === "UNCLASSIFIED" &&
      hasStrongRequirementModality(sourceUnit.text) &&
      isBoundedExplicitTaskBehavior(sourceUnit.text)
    ) {
      /*
       * Jira descriptions often use domain-specific subsection headings rather
       * than the canonical Task/Expected Behavior labels. A strong normative
       * clause under such a heading can carry source authority, but declarative,
       * vague, contextual, actual-state, and summary prose still abstain.
       */
      sourceRole = "TASK";
      derivation =
        "DIRECT_TASK_SECTION";
    } else if (
      sectionRole === "ACCEPTANCE" ||
      sectionRole ===
        "EXPECTED_BEHAVIOR"
    ) {
      sourceRole = sectionRole;
      derivation =
        "DIRECT_DESCRIPTION_SECTION";
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }

  const sourceUnitIds = [
    sourceUnit.id,
  ];

  return {
    id: buildStableObligationId(
      derivation,
      sourceUnitIds
    ),
    sourceUnitIds,
    sourceRole,
    derivation,
    text: sourceUnit.text,
  };
}

/*
 * PLANNER_ACCEPTANCE_OBLIGATION_LEDGER_V0
 *
 * Conservatively identify only direct custom-field acceptance
 * criteria and content under exact expected-behavior headings.
 * This is observational provenance metadata: it neither assigns
 * runner support nor proves behavior or changes any verdict.
 */
export function buildPlannerAcceptanceObligationLedger(
  sourceLedger:
    PlannerAcceptanceSourceLedger
): PlannerAcceptanceObligationLedger {
  if (
    sourceLedger?.sourceStatus !==
    "RESOLVED"
  ) {
    return {
      sourceStatus: "UNAVAILABLE",
      derivationStatus:
        "SOURCE_UNAVAILABLE",
      obligations: [],
      unresolvedSourceUnitIds: [],
    };
  }

  const sourceUnits =
    Array.isArray(
      sourceLedger.sourceUnits
    )
      ? sourceLedger.sourceUnits
      : [];

  const obligations:
    PlannerAcceptanceObligation[] = [];
  const obligationIds =
    new Set<string>();
  const resolvedSourceUnitIds =
    new Set<string>();

  for (const sourceUnit of sourceUnits) {
    const obligation =
      deriveObligation(sourceUnit);

    if (!obligation) {
      continue;
    }

    resolvedSourceUnitIds.add(
      sourceUnit.id
    );

    if (
      obligationIds.has(obligation.id)
    ) {
      continue;
    }

    obligationIds.add(obligation.id);
    obligations.push(obligation);
  }

  const unresolvedSourceUnitIds =
    sourceUnits
      .filter(
        (sourceUnit) =>
          !resolvedSourceUnitIds.has(
            sourceUnit.id
          )
      )
      .map(
        (sourceUnit) =>
          sourceUnit.id
      );

  return {
    sourceStatus: "RESOLVED",
    derivationStatus:
      obligations.length > 0
        ? "RESOLVED"
        : "NO_HIGH_CONFIDENCE_OBLIGATIONS",
    obligations,
    unresolvedSourceUnitIds,
  };
}
