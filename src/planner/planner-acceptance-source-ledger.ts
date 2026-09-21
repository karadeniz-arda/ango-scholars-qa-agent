import {
  createHash,
} from "node:crypto";

import type {
  JiraAcceptanceCriteriaDiscovery,
} from "../agents/api/jira-acceptance-criteria.js";

export type PlannerAcceptanceSourceUnit = {
  id: string;
  sourceKind:
    | "ACCEPTANCE_CRITERIA"
    | "SUMMARY"
    | "DESCRIPTION";
  sourceRef: string;
  sectionHeading?: string;
  text: string;
};

export type PlannerAcceptanceSourceLedger = {
  sourceStatus:
    | "RESOLVED"
    | "UNAVAILABLE";
  basis:
    | "ACCEPTANCE_CRITERIA"
    | "SUMMARY_DESCRIPTION_FALLBACK"
    | "SOURCE_UNAVAILABLE";
  sourceUnits:
    PlannerAcceptanceSourceUnit[];
};

function normalizeText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSourceText(
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

/*
 * PLANNER_DESCRIPTION_SECTION_PROVENANCE_V1
 *
 * Preserve Jira's explicit ADF heading structure before
 * description text is flattened for the model prompt.
 *
 * This is structural provenance only:
 * - heading names are not semantically classified here;
 * - headings themselves are not acceptance source units;
 * - content following a heading retains that heading until
 *   another explicit top-level ADF heading appears.
 */
type JiraDescriptionAdfNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

function getAdfNodeText(
  value: unknown
): string {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return "";
  }

  const node =
    value as JiraDescriptionAdfNode;

  if (
    node.type === "text" &&
    typeof node.text === "string"
  ) {
    return node.text;
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  if (!Array.isArray(node.content)) {
    return "";
  }

  return node.content
    .map(getAdfNodeText)
    .filter(Boolean)
    .join(" ");
}

function getAdfContentBlocks(
  value: unknown
): string[] {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return [];
  }

  const node =
    value as JiraDescriptionAdfNode;

  if (
    node.type === "paragraph" ||
    node.type === "listItem" ||
    node.type === "taskItem" ||
    node.type === "codeBlock" ||
    node.type === "blockquote"
  ) {
    const text =
      normalizeText(
        getAdfNodeText(node)
      );

    return text
      ? [text]
      : [];
  }

  if (!Array.isArray(node.content)) {
    return [];
  }

  return node.content.flatMap(
    getAdfContentBlocks
  );
}

function buildStableUnitId(
  sourceKind:
    PlannerAcceptanceSourceUnit[
      "sourceKind"
    ],
  sourceRef: string,
  text: string,
  sectionHeading?: string
): string {
  const identityParts = [
    sourceKind,
    sourceRef,
  ];

  if (sectionHeading) {
    identityParts.push(
      `section:${sectionHeading}`
    );
  }

  identityParts.push(text);

  const digest =
    createHash("sha256")
      .update(
        identityParts.join("\u0000")
      )
      .digest("hex")
      .slice(0, 12);

  return `jira-req-${digest}`;
}

function buildUnits(
  sourceKind:
    PlannerAcceptanceSourceUnit[
      "sourceKind"
    ],
  sourceRef: string,
  text: unknown,
  sectionHeading?: string
): PlannerAcceptanceSourceUnit[] {
  return splitSourceText(text)
    .map((unitText) => ({
      id: buildStableUnitId(
        sourceKind,
        sourceRef,
        unitText,
        sectionHeading
      ),
      sourceKind,
      sourceRef,
      ...(sectionHeading
        ? {
            sectionHeading,
          }
        : {}),
      text: unitText,
    }));
}

function buildStructuredUnit(
  sourceKind:
    PlannerAcceptanceSourceUnit[
      "sourceKind"
    ],
  sourceRef: string,
  text: unknown,
  sectionHeading?: string
): PlannerAcceptanceSourceUnit[] {
  const unitText = normalizeText(text);

  if (!unitText) {
    return [];
  }

  return [{
    id: buildStableUnitId(
      sourceKind,
      sourceRef,
      unitText,
      sectionHeading
    ),
    sourceKind,
    sourceRef,
    ...(sectionHeading
      ? { sectionHeading }
      : {}),
    text: unitText,
  }];
}

function buildDescriptionUnits(
  descriptionAdf: unknown,
  descriptionText: unknown
): PlannerAcceptanceSourceUnit[] {
  if (
    !descriptionAdf ||
    typeof descriptionAdf !== "object"
  ) {
    return buildUnits(
      "DESCRIPTION",
      "jira.description",
      descriptionText
    );
  }

  const root =
    descriptionAdf as JiraDescriptionAdfNode;

  if (!Array.isArray(root.content)) {
    return buildUnits(
      "DESCRIPTION",
      "jira.description",
      descriptionText
    );
  }

  const units:
    PlannerAcceptanceSourceUnit[] = [];

  let sectionHeading:
    string | undefined;

  for (const child of root.content) {
    if (
      child &&
      typeof child === "object" &&
      (
        child as JiraDescriptionAdfNode
      ).type === "heading"
    ) {
      const headingText =
        normalizeText(
          getAdfNodeText(child)
        );

      sectionHeading =
        headingText || undefined;

      continue;
    }

    const blockTexts =
      getAdfContentBlocks(child);

    for (const blockText of blockTexts) {
      units.push(
        ...buildStructuredUnit(
          "DESCRIPTION",
          "jira.description",
          blockText,
          sectionHeading
        )
      );
    }
  }

  return units;
}

/**
 * Preserve all bounded Jira source units for deterministic
 * source-context consumers such as route-polarity extraction.
 * Unlike the acceptance ledger, this does not select one
 * acceptance basis over another.
 */
export function buildPlannerJiraSourceUnits(
  args: {
    summary: unknown;
    descriptionText: unknown;
    descriptionAdf?: unknown;
    acceptanceCriteriaDiscovery:
      JiraAcceptanceCriteriaDiscovery;
  }
): PlannerAcceptanceSourceUnit[] {
  const acceptanceSources =
    Array.isArray(
      args.acceptanceCriteriaDiscovery?.sources
    )
      ? args.acceptanceCriteriaDiscovery.sources
      : [];

  return [
    ...buildUnits(
      "SUMMARY",
      "jira.summary",
      args.summary
    ),
    ...buildDescriptionUnits(
      args.descriptionAdf,
      args.descriptionText
    ),
    ...acceptanceSources.flatMap(
      (source) =>
        buildUnits(
          "ACCEPTANCE_CRITERIA",
          `jira.field:${source.fieldId}`,
          source.text
        )
    ),
  ];
}

/*
 * PLANNER_ACCEPTANCE_SOURCE_LEDGER_V1
 *
 * Preserve authoritative Jira acceptance source independently
 * from the model-generated test plan.
 *
 * This ledger is observational metadata only:
 * - it does not prove behavior;
 * - it does not decide PASS;
 * - it does not infer missing acceptance criteria;
 * - SOURCE_UNAVAILABLE is never treated as confirmed-empty.
 */
export function buildPlannerAcceptanceSourceLedger(
  args: {
    summary: unknown;
    descriptionText: unknown;
    descriptionAdf?: unknown;
    acceptanceCriteriaDiscovery:
      JiraAcceptanceCriteriaDiscovery;
  }
): PlannerAcceptanceSourceLedger {
  const discovery =
    args.acceptanceCriteriaDiscovery;

  if (
    discovery?.status !== "RESOLVED"
  ) {
    return {
      sourceStatus: "UNAVAILABLE",
      basis: "SOURCE_UNAVAILABLE",
      sourceUnits: [],
    };
  }

  const acceptanceSources =
    Array.isArray(discovery.sources)
      ? discovery.sources
      : [];

  if (acceptanceSources.length > 0) {
    const sourceUnits =
      acceptanceSources.flatMap(
        (source) =>
          buildUnits(
            "ACCEPTANCE_CRITERIA",
            `jira.field:${source.fieldId}`,
            source.text
          )
      );

    return {
      sourceStatus: "RESOLVED",
      basis: "ACCEPTANCE_CRITERIA",
      sourceUnits,
    };
  }

  const summaryUnits =
    buildUnits(
      "SUMMARY",
      "jira.summary",
      args.summary
    );

  const descriptionUnits =
    buildDescriptionUnits(
      args.descriptionAdf,
      args.descriptionText
    );

  return {
    sourceStatus: "RESOLVED",
    basis:
      "SUMMARY_DESCRIPTION_FALLBACK",
    sourceUnits: [
      ...summaryUnits,
      ...descriptionUnits,
    ],
  };
}
