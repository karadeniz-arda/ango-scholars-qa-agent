import { createHash } from "node:crypto";

import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
} from "../../planner/types.js";
import type { BrowserObservation } from "./browser-observation.js";

export type BrowserStructuralControlSemanticKind = "SEARCH_INPUT";

export type BrowserSourceBoundStructuralControlPresenceRequirement = {
  schemaVersion: 1;
  kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT";
  requirementId: string;
  obligationId: string;
  sourceUnitIds: string[];
  sourceRefs: string[];
  sourceRole: "ACCEPTANCE" | "TASK";
  proofAuthority: "ACCEPTANCE" | "DIRECT_TASK";
  derivation: "DIRECT_ACCEPTANCE_FIELD" | "DIRECT_DESCRIPTION_SECTION" | "DIRECT_TASK_SECTION";
  executionCaseId: string;
  persona: "company_admin" | "talent";
  routePath: string;
  control: {
    semanticKind: BrowserStructuralControlSemanticKind;
    cardinality: "AT_LEAST_ONE";
  };
};

export type BrowserSourceBoundStructuralControlPresenceEvidence = {
  schemaVersion: 1;
  kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE";
  proofRequirementId: string;
  obligationId: string;
  executionCaseId: string;
  sourceUnitIds: string[];
  sourceRefs: string[];
  persona: "company_admin" | "talent";
  routePath: string;
  freshObservation: boolean;
  control: BrowserSourceBoundStructuralControlPresenceRequirement["control"];
  matchingControlCount: number;
  result: "CONFIRMED" | "NOT_CONFIRMED";
};

function normalized(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function containsStandaloneSearchToken(value: unknown): boolean {
  return /\bsearch\b/i.test(normalized(value));
}

function isSearchInput(input: BrowserObservation["inputs"][number]): boolean {
  if (input.role === "searchbox" || input.type === "search") return true;
  if (input.role !== "textbox" || (input.type !== "" && input.type !== "text")) return false;
  return containsStandaloneSearchToken(input.label) || containsStandaloneSearchToken(input.placeholder);
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

/** Exact, bounded ACCEPTANCE phrasing; planner goal text is deliberately ignored. */
function sourceStructuralControl(sourceText: string): BrowserStructuralControlSemanticKind | null {
  const source = normalized(sourceText);
  return /\b(?:add\s+(?:a|the)|(?:a|the)\s+search\s+(?:bar|input|field)\s+(?:is|should be))\s+search\s+(?:bar|input|field)\b/.test(source) ||
    /\b(?:a|the)\s+search\s+(?:bar|input|field)\s+(?:is|should be)\s+(?:available|visible|shown|displayed)\b/.test(source)
    ? "SEARCH_INPUT"
    : null;
}

export function buildBrowserSourceBoundStructuralControlPresenceRequirements(args: {
  testCase: BrowserTestCase;
  /** Canonical upstream execution authority; raw case membership is insufficient. */
  executionObligationIds: string[];
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  sourceLedger: PlannerAcceptanceSourceLedger | undefined;
  acceptedRoutePath: string | null;
}): BrowserSourceBoundStructuralControlPresenceRequirement[] {
  if (
    args.testCase.persona !== "company_admin" && args.testCase.persona !== "talent" ||
    !args.acceptedRoutePath ||
    args.obligationLedger?.sourceStatus !== "RESOLVED" ||
    args.obligationLedger.derivationStatus !== "RESOLVED" ||
    args.sourceLedger?.sourceStatus !== "RESOLVED"
  ) return [];
  const persona = args.testCase.persona;
  const routePath = args.acceptedRoutePath;
  const sources = new Map(args.sourceLedger.sourceUnits.map((unit) => [unit.id, unit]));
  return [...new Set(args.testCase.acceptanceObligationIds ?? [])].flatMap((obligationId) => {
    const obligation = args.obligationLedger!.obligations.find((item) => item.id === obligationId);
    const executionAuthorized = new Set(args.executionObligationIds);
    if (!obligation || !executionAuthorized.has(obligationId)) return [];
    const approvedDirectTask = obligation.sourceRole === "TASK" && obligation.derivation === "DIRECT_TASK_SECTION";
    if (obligation.sourceRole !== "ACCEPTANCE" && !approvedDirectTask) return [];
    const sourceRole: "ACCEPTANCE" | "TASK" =
      obligation.sourceRole === "TASK" ? "TASK" : "ACCEPTANCE";
    const candidates = obligation.sourceUnitIds
      .map((id) => sources.get(id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .flatMap((source) => {
        const semanticKind = sourceStructuralControl(source.text);
        return semanticKind ? [{ source, semanticKind }] : [];
      });
    if (candidates.length !== 1) return [];
    const { source, semanticKind } = candidates[0]!;
    return [{
      schemaVersion: 1,
      kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT",
      requirementId: `source-structural-control-${stableId([obligationId, args.testCase.id, routePath, source.id, semanticKind])}`,
      obligationId,
      sourceUnitIds: [source.id],
      sourceRefs: [source.sourceRef],
      sourceRole,
      proofAuthority: sourceRole === "TASK" ? "DIRECT_TASK" : "ACCEPTANCE",
      derivation: obligation.derivation,
      executionCaseId: args.testCase.id,
      persona,
      routePath,
      control: { semanticKind, cardinality: "AT_LEAST_ONE" },
    }];
  });
}

/** Fresh semantic input observation only; no labels, placeholders, CSS, or page text participate. */
export function evaluateBrowserSourceBoundStructuralControlPresence(args: {
  requirement: BrowserSourceBoundStructuralControlPresenceRequirement;
  observation: BrowserObservation;
  actualPersona: string | null | undefined;
  actualRoutePath: string | null;
  freshObservation: boolean;
}): BrowserSourceBoundStructuralControlPresenceEvidence {
  const matchingControlCount = args.requirement.control.semanticKind === "SEARCH_INPUT"
    ? args.observation.inputs.filter(isSearchInput).length
    : 0;
  const confirmed = args.freshObservation &&
    args.actualPersona === args.requirement.persona &&
    args.actualRoutePath === args.requirement.routePath &&
    matchingControlCount >= 1;
  return {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE",
    proofRequirementId: args.requirement.requirementId,
    obligationId: args.requirement.obligationId,
    executionCaseId: args.requirement.executionCaseId,
    sourceUnitIds: args.requirement.sourceUnitIds,
    sourceRefs: args.requirement.sourceRefs,
    persona: args.requirement.persona,
    routePath: args.requirement.routePath,
    freshObservation: args.freshObservation,
    control: args.requirement.control,
    matchingControlCount,
    result: confirmed ? "CONFIRMED" : "NOT_CONFIRMED",
  };
}
