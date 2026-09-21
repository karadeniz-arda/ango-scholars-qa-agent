import { createHash } from "node:crypto";

import type {
  PlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import type {
  PlannerAcceptanceSourceLedger,
} from "./planner-acceptance-source-ledger.js";
import type {
  PlannerSourceDerivedObligationMemberLedger,
} from "./types.js";

type MemberKind = "TARGET" | "SURFACE" | "STATE" | "FIELD";
type MemberSet = PlannerSourceDerivedObligationMemberLedger["memberSets"][number];
type Audit = PlannerSourceDerivedObligationMemberLedger["obligationAudits"][number];
type UndecomposedReason = Exclude<Audit["reason"], undefined>;

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value: unknown): string {
  return normalized(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${digest}`;
}

function explicitConjunction(value: string): string[] | undefined {
  if (!/\s(?:and|&)\s/i.test(value)) return undefined;
  const members = value
    .split(/\s*(?:and|&)\s*/i)
    .map(normalized)
    .filter(Boolean);
  return members.length >= 2 ? members : undefined;
}

function boundedMember(value: string): string | undefined {
  const text = normalized(value).replace(/[.,;:]+$/g, "");
  if (!text || text.length > 80 || !/^[a-z0-9][a-z0-9 _-]*$/i.test(text)) {
    return undefined;
  }
  return text;
}

function candidateMemberSets(text: string): Array<{
  dimension: MemberKind;
  members: string[];
}> {
  const candidates: Array<{ dimension: MemberKind; members: string[] }> = [];

  // A bounded page/table noun phrase with an explicit conjunction is a
  // source-defined surface list, not a route or target inference.
  const surface = text.match(
    /\b(?:on|in|for|to)\s+(?:the\s+)?([a-z0-9][a-z0-9 /&-]{0,80}?)\s+(?:pages?|tables?)\b/i
  );
  const surfaceMembers = surface?.[1] ? explicitConjunction(surface[1]) : undefined;
  if (surfaceMembers) candidates.push({ dimension: "SURFACE", members: surfaceMembers });

  // Quoted labels immediately governing tabs are an explicit state dimension.
  const state = text.match(/["“]([^"”]{1,80})["”]\s+and\s+["“]([^"”]{1,80})["”]\s+tabs?\b/i);
  if (state?.[1] && state[2]) {
    candidates.push({ dimension: "STATE", members: [state[1], state[2]] });
  }

  // A named requirement-type conjunction is a closed, source-authored target
  // list. The suffix is intentionally accepted only when it is the sentence end.
  const requirementTypes = text.match(
    /\brequirements?\s+of\s+type\s+(.+?)[.!?]?$/i
  );
  const requirementMembers = requirementTypes?.[1]
    ? explicitConjunction(requirementTypes[1])
    : undefined;
  if (requirementMembers) {
    candidates.push({ dimension: "TARGET", members: requirementMembers });
  }

  // A quoted type at the beginning of a bounded requirement clause is already
  // structured source identity; it is not inferred from surrounding prose.
  const quotedType = text.match(/^For\s+['"]([a-z0-9_-]{1,80})['"]/i);
  if (quotedType?.[1]) candidates.push({ dimension: "TARGET", members: [quotedType[1]] });

  // Two title-cased labels may be retained only in the exact bounded setup-model
  // shape. Ordinary actor and role conjunctions deliberately abstain.
  const namedTargets = text.match(
    /^([A-Z][A-Za-z0-9_-]{1,80})\s+(?:and|&)\s+([A-Z][A-Za-z0-9_-]{1,80})\s+can\s+open\s+up\s+their\s+[a-z]+\s+models\s+freely\.?$/
  );
  if (namedTargets?.[1] && namedTargets[2]) {
    candidates.push({ dimension: "TARGET", members: [namedTargets[1], namedTargets[2]] });
  }

  return candidates;
}

function buildMemberSet(args: {
  parentObligationId: string;
  sourceUnitId: string;
  sourceRef: string;
  dimension: MemberKind;
  members: string[];
}): { memberSet?: MemberSet; reason?: UndecomposedReason } {
  const bounded = args.members.map(boundedMember);
  if (bounded.some((member) => !member)) {
    return { reason: "UNSUPPORTED_MEMBER_SHAPE" };
  }
  const values = bounded as string[];
  const canonicalMembers = values.map(canonical);
  if (new Set(canonicalMembers).size !== canonicalMembers.length) {
    return { reason: "DUPLICATE_MEMBER_IDENTITY" };
  }
  const memberSetId = stableId("source-member-set", [
    args.parentObligationId,
    args.sourceUnitId,
    args.sourceRef,
    args.dimension,
  ]);
  return {
    memberSet: {
      memberSetId,
      parentObligationId: args.parentObligationId,
      sourceUnitRef: { sourceUnitId: args.sourceUnitId, sourceRef: args.sourceRef },
      dimension: args.dimension,
      policy: "ALL_REQUIRED",
      members: values.map((exactSourceText, ordinal) => {
        const canonicalMemberText = canonical(exactSourceText);
        return {
          memberId: stableId("source-member", [
            args.parentObligationId,
            args.sourceUnitId,
            args.sourceRef,
            args.dimension,
            canonicalMemberText,
          ]),
          exactSourceText,
          canonicalMemberText,
          kind: args.dimension,
          ordinal,
          required: true,
        };
      }),
    },
  };
}

/**
 * SOURCE_DERIVED_OBLIGATION_MEMBERS_V1
 *
 * Preserves only closed, explicit Jira member structure before model planning.
 * It is deliberately not consumed by semantic allocation or execution in V1.
 */
export function buildPlannerSourceDerivedObligationMemberLedger(args: {
  sourceLedger: PlannerAcceptanceSourceLedger;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): PlannerSourceDerivedObligationMemberLedger {
  if (args.sourceLedger.sourceStatus !== "RESOLVED" ||
    args.obligationLedger.sourceStatus !== "RESOLVED") {
    return {
      version: "V1",
      sourceStatus: "UNAVAILABLE",
      memberSets: [],
      obligationAudits: args.obligationLedger.obligations.map((obligation) => ({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: "SOURCE_UNAVAILABLE",
      })),
    };
  }

  const sourceById = new Map(args.sourceLedger.sourceUnits.map((source) => [source.id, source]));
  const memberSets: MemberSet[] = [];
  const obligationAudits: Audit[] = [];

  for (const obligation of args.obligationLedger.obligations) {
    if (obligation.sourceUnitIds.length !== 1) {
      obligationAudits.push({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: "AMBIGUOUS_MEMBER_STRUCTURE",
      });
      continue;
    }
    const source = sourceById.get(obligation.sourceUnitIds[0]!);
    if (!source || normalized(source.text) !== normalized(obligation.text)) {
      obligationAudits.push({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: "AMBIGUOUS_MEMBER_STRUCTURE",
      });
      continue;
    }
    const candidates = candidateMemberSets(source.text);
    if (candidates.length === 0) {
      obligationAudits.push({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: "NO_EXPLICIT_MEMBER_STRUCTURE",
      });
      continue;
    }
    const dimensions = candidates.map((candidate) => candidate.dimension);
    if (new Set(dimensions).size !== dimensions.length) {
      obligationAudits.push({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: "AMBIGUOUS_MEMBER_STRUCTURE",
      });
      continue;
    }
    const derived = candidates.map((candidate) => buildMemberSet({
      parentObligationId: obligation.id,
      sourceUnitId: source.id,
      sourceRef: source.sourceRef,
      dimension: candidate.dimension,
      members: candidate.members,
    }));
    const failure = derived.find((item) => item.reason)?.reason;
    if (failure) {
      obligationAudits.push({
        parentObligationId: obligation.id,
        status: "UNDECOMPOSED",
        reason: failure,
      });
      continue;
    }
    memberSets.push(...derived.map((item) => item.memberSet!));
    obligationAudits.push({ parentObligationId: obligation.id, status: "DECOMPOSED" });
  }

  return {
    version: "V1",
    sourceStatus: "RESOLVED",
    memberSets: memberSets.sort((left, right) => left.memberSetId.localeCompare(right.memberSetId)),
    obligationAudits: obligationAudits.sort((left, right) =>
      left.parentObligationId.localeCompare(right.parentObligationId)
    ),
  };
}
