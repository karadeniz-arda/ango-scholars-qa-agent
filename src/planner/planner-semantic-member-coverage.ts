import type {
  PlannerBrowserSemanticIr,
  PlannerSemanticMemberCoverageAudit,
  PlannerSourceDerivedObligationMemberLedger,
} from "./types.js";

type MemberRef = PlannerSemanticMemberCoverageAudit[
  "candidateCoverage"][number]["coveredMemberRefs"][number];

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasExactStructuredMember(value: string, member: string): boolean {
  const haystack = ` ${normalized(value)} `;
  const needle = normalized(member);
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

function maximalExactStructuredMembers(args: {
  targetSurface: string;
  memberSet: PlannerSourceDerivedObligationMemberLedger["memberSets"][number];
}) {
  const matches = args.memberSet.members.filter((member) =>
    hasExactStructuredMember(args.targetSurface, member.canonicalMemberText)
  );
  return matches.filter((member) => !matches.some((other) =>
    other.memberId !== member.memberId &&
    other.canonicalMemberText.endsWith(` ${member.canonicalMemberText}`)
  ));
}

function candidateCanBindSet(args: {
  candidate: PlannerBrowserSemanticIr["candidates"][number];
  memberSet: PlannerSourceDerivedObligationMemberLedger["memberSets"][number];
}): boolean {
  const { candidate, memberSet } = args;
  return candidate.obligationIds.length === 1 &&
    candidate.obligationIds[0] === memberSet.parentObligationId &&
    candidate.sourceUnitIds.length === 1 &&
    candidate.sourceUnitIds[0] === memberSet.sourceUnitRef.sourceUnitId;
}

/**
 * SOURCE_DERIVED_OBLIGATION_MEMBER_COVERAGE_V1
 *
 * Recomputes coverage solely from the candidate's structured target-surface
 * field. Model-supplied member IDs, behavior prose, goals, checks, clicks,
 * fixtures, and explanations are intentionally not inputs.
 */
export function buildPlannerSemanticMemberCoverageAudit(args: {
  semanticIr: PlannerBrowserSemanticIr;
  memberLedger: PlannerSourceDerivedObligationMemberLedger;
}): PlannerSemanticMemberCoverageAudit {
  if (args.memberLedger.sourceStatus !== "RESOLVED") {
    return { version: "V1", invalidClaimRefs: [], candidateCoverage: [], memberSetCensus: [] };
  }

  const candidateCoverage = args.semanticIr.candidates.flatMap((candidate) => {
    const eligibleSets = args.memberLedger.memberSets.filter((memberSet) =>
      candidateCanBindSet({ candidate, memberSet })
    );
    if (eligibleSets.length === 0) return [];
    const targetSurface = candidate.proposedTargetSurface;
    const coveredMemberRefs = targetSurface
      ? eligibleSets.flatMap((memberSet) => maximalExactStructuredMembers({
        targetSurface,
        memberSet,
      }).map((member) => ({
        memberSetId: memberSet.memberSetId,
        memberId: member.memberId,
      })))
      : [];
    const validlyClaimedMemberRefs = candidate.validatedSourceMemberCoverageClaims
      ?.flatMap((claim) => eligibleSets.flatMap((memberSet) =>
        memberSet.members
          .filter((member) => member.memberId === claim.memberId)
          .map((member) => ({ memberSetId: memberSet.memberSetId, memberId: member.memberId }))
      )) ?? [];
    return [{
      candidateId: candidate.candidateId,
      parentObligationId: eligibleSets[0]!.parentObligationId,
      sourceUnitRef: eligibleSets[0]!.sourceUnitRef,
      coveredMemberRefs,
      validlyClaimedMemberRefs,
      invalidClaimRefs: candidate.invalidSourceMemberCoverageClaimIds ?? [],
      disposition: coveredMemberRefs.length === 0
        ? "PARENT_ONLY" as const
        : coveredMemberRefs.length === 1
          ? "EXACT_MEMBER_COVERAGE" as const
          : "MULTI_MEMBER_COVERAGE" as const,
    }];
  }).sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId) ||
    left.sourceUnitRef.sourceUnitId.localeCompare(right.sourceUnitRef.sourceUnitId)
  );

  const coverageByMemberId = new Map<string, MemberRef[]>();
  const claimsByMemberId = new Map<string, MemberRef[]>();
  for (const coverage of candidateCoverage) {
    for (const memberRef of coverage.coveredMemberRefs) {
      coverageByMemberId.set(memberRef.memberId, [
        ...(coverageByMemberId.get(memberRef.memberId) ?? []),
        memberRef,
      ]);
    }
  }
  for (const coverage of candidateCoverage) {
    for (const memberRef of coverage.validlyClaimedMemberRefs) {
      claimsByMemberId.set(memberRef.memberId, [
        ...(claimsByMemberId.get(memberRef.memberId) ?? []),
        memberRef,
      ]);
    }
  }
  const memberSetCensus = args.memberLedger.memberSets.map((memberSet) => {
    const refs = memberSet.members.map((member) => ({
      memberSetId: memberSet.memberSetId,
      memberId: member.memberId,
    }));
    const uncoveredMemberRefs = refs.filter((memberRef) =>
      (coverageByMemberId.get(memberRef.memberId) ?? []).length === 0
    );
    const multiplyCoveredMemberRefs = refs.filter((memberRef) =>
      (coverageByMemberId.get(memberRef.memberId) ?? []).length > 1
    );
    const claimedButNotDeterministicallyCoveredMemberRefs = refs.filter((memberRef) =>
      (claimsByMemberId.get(memberRef.memberId) ?? []).length > 0 &&
      (coverageByMemberId.get(memberRef.memberId) ?? []).length === 0
    );
    const multiplyClaimedMemberRefs = refs.filter((memberRef) =>
      (claimsByMemberId.get(memberRef.memberId) ?? []).length > 1
    );
    return {
      memberSetId: memberSet.memberSetId,
      parentObligationId: memberSet.parentObligationId,
      requiredMemberCount: refs.length,
      coveredMemberCount: refs.length - uncoveredMemberRefs.length,
      deterministicallyCoveredMemberCount: refs.length - uncoveredMemberRefs.length,
      validlyClaimedMemberCount: refs.filter((memberRef) =>
        (claimsByMemberId.get(memberRef.memberId) ?? []).length > 0
      ).length,
      uncoveredMemberRefs,
      multiplyCoveredMemberRefs,
      claimedButNotDeterministicallyCoveredMemberRefs,
      multiplyClaimedMemberRefs,
      // Exact structured matching either binds a member or leaves the candidate
      // parent-only; this V1 has no guessed ambiguous member binding.
      ambiguousMemberRefs: [],
    };
  }).sort((left, right) => left.memberSetId.localeCompare(right.memberSetId));

  const invalidClaimRefs = args.semanticIr.candidates.flatMap((candidate) =>
    (candidate.invalidSourceMemberCoverageClaimIds ?? []).map((memberId) => ({
      candidateId: candidate.candidateId,
      memberId,
    }))
  ).sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId) || left.memberId.localeCompare(right.memberId)
  );
  return { version: "V1", invalidClaimRefs, candidateCoverage, memberSetCensus };
}
