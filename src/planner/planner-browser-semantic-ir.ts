import { createHash } from "node:crypto";

import type {
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceVerdictRelationship,
  PlannerBrowserSemanticCandidate,
  PlannerBrowserSemanticIr,
  PlannerSourceDerivedObligationMemberLedger,
  TestPlan,
} from "./types.js";
import type {
  PlannerAcceptanceVerdictGroupProposal,
} from "./planner-acceptance-verdict-grouping.js";

function text(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(text).filter(Boolean))].sort()
    : [];
}

function claimedMemberIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(text).filter(Boolean))].sort()
    : [];
}

function stableCandidateId(
  proposedCaseId: string,
  obligationIds: string[]
): string {
  const digest = createHash("sha256")
    .update([proposedCaseId, ...obligationIds].join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  return `browser-semantic-${digest}`;
}

function relation(value: unknown):
  PlannerAcceptanceVerdictRelationship | undefined {
  return ["ATOMIC", "INDEPENDENT", "DEPENDS_ON", "UNKNOWN"]
    .includes(String(value))
    ? value as PlannerAcceptanceVerdictRelationship
    : undefined;
}

function normalizeChecks(
  value: unknown,
  obligationIds: Set<string>
): PlannerBrowserSemanticCandidate["proposedChecks"] {
  if (!Array.isArray(value)) return [];
  const roles = new Set([
    "ACCEPTANCE_PROOF",
    "SUPPLEMENTAL_SANITY",
    "PRECONDITION",
    "STRUCTURAL_SUPPORT",
  ]);
  return value.flatMap((item: any) => {
    const checkText = text(item?.text);
    const ids = strings(item?.obligationIds)
      .filter((id) => obligationIds.has(id));
    const proposedRole = String(item?.proposedRole);
    return checkText && ids.length > 0 && roles.has(proposedRole)
      ? [{
          text: checkText,
          obligationIds: ids,
          proposedRole: proposedRole as
            PlannerBrowserSemanticCandidate["proposedChecks"][number]["proposedRole"],
        }]
      : [];
  });
}

function normalizeFixtureNeeds(
  value: unknown,
  obligationIds: Set<string>
): PlannerBrowserSemanticCandidate["proposedFixtureNeeds"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (typeof item === "string") {
      const fixtureText = text(item);
      return fixtureText
        ? [{
            text: fixtureText,
            obligationIds: [...obligationIds].sort(),
          }]
        : [];
    }
    const fixtureText = text(item?.text);
    const ids = strings(item?.obligationIds)
      .filter((id) => obligationIds.has(id));
    return fixtureText && ids.length > 0
      ? [{ text: fixtureText, obligationIds: ids }]
      : [];
  });
}

function normalizeHints(
  value: unknown,
  obligationIds: Set<string>
): PlannerBrowserSemanticCandidate["proposedRelationshipHints"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (typeof item === "string") {
      const relationship = relation(item);
      if (!relationship || relationship === "DEPENDS_ON") {
        return [];
      }
      return [{
        relationship,
        obligationIds: [...obligationIds].sort(),
        dependsOnObligationIds: [],
        reason:
          "Exact model-supplied relationship label retained as a candidate-only hint.",
      }];
    }
    const relationship = relation(item?.relationship);
    const ids = strings(item?.obligationIds)
      .filter((id) => obligationIds.has(id));
    const dependsOn = strings(item?.dependsOnObligationIds)
      .filter((id) => obligationIds.has(id));
    const reason = text(item?.reason);
    return relationship && ids.length > 0 && reason
      ? [{
          relationship,
          obligationIds: ids,
          dependsOnObligationIds: dependsOn,
          reason,
        }]
      : [];
  });
}

export function buildPlannerBrowserSemanticIr(args: {
  rawCandidates: unknown;
  browserCases: TestPlan["browserCases"];
  obligationLedger: PlannerAcceptanceObligationLedger;
  memberLedger?: PlannerSourceDerivedObligationMemberLedger;
}): PlannerBrowserSemanticIr {
  if (!Array.isArray(args.rawCandidates)) {
    return {
      version: "V1",
      status: "LEGACY_INPUT",
      candidates: [],
      rejectedCandidates: [],
    };
  }

  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const caseIds = new Set(args.browserCases.map((item) => item.id));
  const candidates: PlannerBrowserSemanticCandidate[] = [];
  const rejectedCandidates: PlannerBrowserSemanticIr["rejectedCandidates"] = [];
  const signatures = new Set<string>();

  for (const [index, raw] of args.rawCandidates.entries()) {
    const item = raw as any;
    const proposedCaseId = text(item?.proposedCaseId);
    const obligationIds = strings(item?.obligationIds);
    const fallbackId = text(item?.id) || `candidate-${index + 1}`;
    if (!proposedCaseId || obligationIds.length === 0 || !text(item?.proposedBehavior)) {
      rejectedCandidates.push({ candidateId: fallbackId, reason: "MALFORMED" });
      continue;
    }
    if (obligationIds.some((id) => !obligationById.has(id))) {
      rejectedCandidates.push({ candidateId: fallbackId, reason: "UNKNOWN_OBLIGATION" });
      continue;
    }
    const requiredSourceUnitIds = [...new Set(obligationIds.flatMap(
      (id) => obligationById.get(id)!.sourceUnitIds
    ))].sort();
    if (strings(item?.sourceUnitIds).join("\u0000") !==
        requiredSourceUnitIds.join("\u0000")) {
      rejectedCandidates.push({ candidateId: fallbackId, reason: "SOURCE_ANCHOR_MISMATCH" });
      continue;
    }
    if (!caseIds.has(proposedCaseId)) {
      rejectedCandidates.push({ candidateId: fallbackId, reason: "MISSING_CASE_CANDIDATE" });
      continue;
    }
    const signature = [proposedCaseId, ...obligationIds].join("\u0000");
    if (signatures.has(signature)) {
      rejectedCandidates.push({ candidateId: fallbackId, reason: "DUPLICATE_CANDIDATE" });
      continue;
    }
    signatures.add(signature);
    const obligationSet = new Set(obligationIds);
    const proposedPersona = ["company_admin", "talent", "unknown"]
      .includes(String(item?.proposedPersona))
      ? item.proposedPersona as PlannerBrowserSemanticCandidate["proposedPersona"]
      : undefined;
    const mutation = [
      "READ_ONLY", "TRANSIENT_REVERSIBLE", "PERSISTENT_BROWSER",
      "API_MUTATION", "EXTERNAL_LIFECYCLE", "MANUAL", "UNKNOWN",
    ].includes(String(item?.proposedMutationClass))
      ? item.proposedMutationClass as PlannerBrowserSemanticCandidate["proposedMutationClass"]
      : undefined;
    const claimIds = claimedMemberIds(item?.sourceMemberCoverageClaims);
    const authoritativeMembers = args.memberLedger?.sourceStatus === "RESOLVED"
      ? args.memberLedger.memberSets.flatMap((memberSet) => memberSet.members.map((member) => ({
        member,
        memberSet,
      })))
      : [];
    const validClaimIds = claimIds.filter((memberId) => authoritativeMembers.some(({ member, memberSet }) =>
      member.memberId === memberId &&
      member.required &&
      obligationIds.length === 1 &&
      obligationIds[0] === memberSet.parentObligationId &&
      requiredSourceUnitIds.length === 1 &&
      requiredSourceUnitIds[0] === memberSet.sourceUnitRef.sourceUnitId
    ));
    const invalidClaimIds = claimIds.filter((memberId) => !validClaimIds.includes(memberId));
    candidates.push({
      candidateId: stableCandidateId(proposedCaseId, obligationIds),
      proposedCaseId,
      obligationIds,
      sourceUnitIds: requiredSourceUnitIds,
      proposedBehavior: text(item.proposedBehavior),
      ...(proposedPersona ? { proposedPersona } : {}),
      ...(text(item?.proposedTargetSurface)
        ? { proposedTargetSurface: text(item.proposedTargetSurface) }
        : {}),
      ...(mutation ? { proposedMutationClass: mutation } : {}),
      proposedChecks: normalizeChecks(item?.proposedChecks, obligationSet),
      proposedFixtureNeeds: normalizeFixtureNeeds(
        item?.proposedFixtureNeeds,
        obligationSet
      ),
      proposedRelationshipHints: normalizeHints(
        item?.proposedRelationshipHints,
        obligationSet
      ),
      ...(validClaimIds.length > 0 ? {
        validatedSourceMemberCoverageClaims: validClaimIds.map((memberId) => ({
          memberId,
          provenance: "VALIDATED_MODEL_MEMBER_CLAIM" as const,
        })),
      } : {}),
      ...(invalidClaimIds.length > 0 ? {
        invalidSourceMemberCoverageClaimIds: invalidClaimIds,
      } : {}),
      authority: "CANDIDATE",
    });
  }

  return {
    version: "V1",
    status: candidates.length > 0 ? "ACTIVE" : "NO_GROUNDED_CANDIDATES",
    candidates,
    rejectedCandidates,
  };
}

export function verdictGroupCandidatesFromSemanticIr(args: {
  semanticIr: PlannerBrowserSemanticIr;
  sourceLedger: PlannerAcceptanceSourceLedger;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): PlannerAcceptanceVerdictGroupProposal[] {
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const sourceById = new Map(
    args.sourceLedger.sourceUnits.map((item) => [item.id, item])
  );

  return args.semanticIr.candidates.flatMap((candidate) =>
    candidate.proposedRelationshipHints.flatMap((hint) => {
      if (hint.relationship === "UNKNOWN") return [];
      const sourceUnitIds = [...new Set(hint.obligationIds.flatMap(
        (id) => obligationById.get(id)?.sourceUnitIds ?? []
      ))].sort();
      const sourceRefs = sourceUnitIds.flatMap((id) => {
        const unit = sourceById.get(id);
        return unit ? [{ sourceUnitId: id, sourceRef: unit.sourceRef }] : [];
      });
      return [{
        obligationIds: hint.obligationIds,
        relationship: hint.relationship,
        dependsOnObligationIds: hint.dependsOnObligationIds,
        sourceRefs,
        reason: hint.reason,
      }];
    })
  );
}
