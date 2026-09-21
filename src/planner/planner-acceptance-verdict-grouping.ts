import { createHash } from "node:crypto";

import type {
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceVerdictGroup,
  PlannerAcceptanceVerdictGrouping,
  PlannerAcceptanceVerdictRelationship,
  TestPlan,
} from "./types.js";

export type PlannerAcceptanceVerdictGroupProposal = {
  obligationIds: string[];
  relationship:
    Exclude<
      PlannerAcceptanceVerdictRelationship,
      "UNKNOWN"
    >;
  dependsOnObligationIds?: string[];
  sourceRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  reason: string;
};

type BuildArgs = {
  obligationLedger:
    PlannerAcceptanceObligationLedger;
  sourceLedger:
    PlannerAcceptanceSourceLedger;
  authoritativeGroups?:
    PlannerAcceptanceVerdictGroupProposal[];
  candidateGroups?:
    PlannerAcceptanceVerdictGroupProposal[];
};

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(
    values.map(String).map((value) => value.trim())
      .filter(Boolean)
  )].sort();
}

function verdictGroupId(
  obligationIds: string[]
): string {
  const digest = createHash("sha256")
    .update(uniqueSorted(obligationIds).join("\u0000"))
    .digest("hex")
    .slice(0, 12);

  return `verdict-group-${digest}`;
}

function hasDependencyCycle(
  dependencies: Map<string, string>
): boolean {
  for (const start of dependencies.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = start;
    while (current && dependencies.has(current)) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = dependencies.get(current);
    }
  }
  return false;
}

/**
 * Derives only relationships that the source states affirmatively. This is
 * deliberately a tiny grammar rather than a general language classifier:
 *
 * - every independent obligation must begin with an explicit
 *   "Independently verdictable:" contract;
 * - a dependency must quote the complete, exact prerequisite obligation after
 *   After/Once/When;
 * - all obligations must participate in the resulting dependency graph.
 *
 * Bullets, sentences, headings, model hints, routes, and candidate count never
 * enter this authority path.
 */
export function derivePlannerSourceBackedVerdictGroups(args: {
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: PlannerAcceptanceSourceLedger;
}): PlannerAcceptanceVerdictGroupProposal[] {
  const obligations = args.obligationLedger.obligations;
  if (
    args.obligationLedger.sourceStatus !== "RESOLVED" ||
    args.obligationLedger.derivationStatus !== "RESOLVED" ||
    obligations.length < 2
  ) {
    return [];
  }

  const sourceById = new Map(
    args.sourceLedger.sourceUnits.map((unit) => [unit.id, unit])
  );
  const entries = obligations.map((obligation) => {
    const sourceRefs = obligation.sourceUnitIds.flatMap((sourceUnitId) => {
      const source = sourceById.get(sourceUnitId);
      return source &&
        normalizedText(source.text) === normalizedText(obligation.text)
        ? [{ sourceUnitId, sourceRef: source.sourceRef }]
        : [];
    });
    return { obligation, sourceRefs };
  });
  if (entries.some((entry) =>
    entry.sourceRefs.length !== entry.obligation.sourceUnitIds.length ||
    entry.sourceRefs.length === 0
  )) {
    return [];
  }

  const explicitIndependence = entries.every((entry) =>
    /^(?:this requirement is )?independently verdictable\s*:\s*\S/i
      .test(entry.obligation.text.trim())
  );
  if (explicitIndependence) {
    return entries.map((entry) => ({
      obligationIds: [entry.obligation.id],
      relationship: "INDEPENDENT",
      sourceRefs: entry.sourceRefs,
      reason:
        "The exact source text affirmatively marks this obligation as independently verdictable.",
    }));
  }

  const dependencyPattern =
    /^(?:after|once|when)\s+["“]([^"”]+)["”]\s*(?:,|:)\s*\S/i;
  const dependencyByObligation = new Map<string, string>();
  let dependencyDirectiveCount = 0;
  for (const entry of entries) {
    const match = entry.obligation.text.trim().match(dependencyPattern);
    if (!match) continue;
    dependencyDirectiveCount += 1;
    const prerequisiteText = normalizedText(match[1]);
    const matches = entries.filter((candidate) =>
      candidate.obligation.id !== entry.obligation.id &&
      normalizedText(candidate.obligation.text) === prerequisiteText
    );
    if (matches.length !== 1) return [];
    dependencyByObligation.set(
      entry.obligation.id,
      matches[0]!.obligation.id
    );
  }
  if (dependencyDirectiveCount === 0 || hasDependencyCycle(dependencyByObligation)) {
    return [];
  }

  const participatingIds = new Set([
    ...dependencyByObligation.keys(),
    ...dependencyByObligation.values(),
  ]);
  if (participatingIds.size !== obligations.length) return [];

  const entryById = new Map(
    entries.map((entry) => [entry.obligation.id, entry])
  );
  return entries.map((entry) => {
    const prerequisiteId = dependencyByObligation.get(entry.obligation.id);
    if (!prerequisiteId) {
      return {
        obligationIds: [entry.obligation.id],
        relationship: "ATOMIC" as const,
        sourceRefs: entry.sourceRefs,
        reason:
          "The exact source obligation is the explicitly named prerequisite root of a complete dependency graph.",
      };
    }
    const prerequisite = entryById.get(prerequisiteId)!;
    return {
      obligationIds: [entry.obligation.id],
      relationship: "DEPENDS_ON" as const,
      dependsOnObligationIds: [prerequisiteId],
      sourceRefs: [...entry.sourceRefs, ...prerequisite.sourceRefs]
        .sort((left, right) =>
          left.sourceUnitId.localeCompare(right.sourceUnitId)
        ),
      reason:
        `The exact source text names prerequisite obligation ${prerequisiteId} verbatim.`,
    };
  });
}

function normalizeProposals(args: {
  proposals:
    PlannerAcceptanceVerdictGroupProposal[];
  obligationIds: Set<string>;
  sourceRefs: Map<string, string>;
  authorityStatus:
    "AUTHORITATIVE" | "CANDIDATE";
}): {
  groups: PlannerAcceptanceVerdictGroup[];
  invalidCount: number;
} {
  const normalized = args.proposals.map((proposal) => ({
    proposal,
    obligationIds: uniqueSorted(proposal.obligationIds),
    dependencyObligationIds: uniqueSorted(
      proposal.dependsOnObligationIds ?? []
    ),
    sourceRefs: proposal.sourceRefs.filter(
      (sourceRef) =>
        args.sourceRefs.get(sourceRef.sourceUnitId) ===
        sourceRef.sourceRef
    ),
  }));
  const proposalGroupByObligation = new Map<string, string[]>();

  for (const item of normalized) {
    const groupId = verdictGroupId(item.obligationIds);
    for (const obligationId of item.obligationIds) {
      proposalGroupByObligation.set(obligationId, [
        ...(proposalGroupByObligation.get(obligationId) ?? []),
        groupId,
      ]);
    }
  }

  let invalidCount = 0;
  const groups: PlannerAcceptanceVerdictGroup[] = [];

  for (const item of normalized) {
    const groupId = verdictGroupId(item.obligationIds);
    const dependencyGroupIds = uniqueSorted(
      item.dependencyObligationIds.flatMap(
        (obligationId) =>
          proposalGroupByObligation.get(obligationId) ?? []
      )
    );
    const valid =
      item.obligationIds.length > 0 &&
      item.obligationIds.every((obligationId) =>
        args.obligationIds.has(obligationId)
      ) &&
      item.sourceRefs.length === item.proposal.sourceRefs.length &&
      item.sourceRefs.length > 0 &&
      (item.proposal.relationship === "DEPENDS_ON"
        ? item.dependencyObligationIds.length > 0 &&
          dependencyGroupIds.length > 0 &&
          !dependencyGroupIds.includes(groupId)
        : item.dependencyObligationIds.length === 0);

    if (!valid) {
      invalidCount += 1;
      continue;
    }

    groups.push({
      verdictGroupId: groupId,
      obligationIds: item.obligationIds,
      relationship: item.proposal.relationship,
      dependencyVerdictGroupIds: dependencyGroupIds,
      authority: {
        status: args.authorityStatus,
        source: args.authorityStatus === "AUTHORITATIVE"
          ? "EXPLICIT_SOURCE"
          : "PLANNER_CANDIDATE",
        sourceRefs: item.sourceRefs,
      },
      reason: item.proposal.reason,
      accountingDisposition:
        args.authorityStatus === "AUTHORITATIVE"
          ? "ACCOUNTED"
          : "CANDIDATE_ONLY",
    });
  }

  return { groups, invalidCount };
}

function completePartition(
  groups: PlannerAcceptanceVerdictGroup[],
  obligationIds: string[]
): boolean {
  const allocated = groups.flatMap(
    (group) => group.obligationIds
  );
  const groupIds = new Set(
    groups.map((group) => group.verdictGroupId)
  );
  const dependenciesResolve = groups.every(
    (group) =>
      group.dependencyVerdictGroupIds.every(
        (dependencyGroupId) =>
          groupIds.has(dependencyGroupId)
      )
  );

  return (
    dependenciesResolve &&
    allocated.length === obligationIds.length &&
    uniqueSorted(allocated).join("\u0000") ===
      obligationIds.join("\u0000")
  );
}

export function buildPlannerAcceptanceVerdictGrouping(
  args: BuildArgs
): PlannerAcceptanceVerdictGrouping {
  const obligationIds = uniqueSorted(
    args.obligationLedger.sourceStatus === "RESOLVED" &&
    args.obligationLedger.derivationStatus === "RESOLVED"
      ? args.obligationLedger.obligations.map(
          (obligation) => obligation.id
        )
      : []
  );
  const knownObligationIds = new Set(obligationIds);
  const knownSourceRefs = new Map(
    args.sourceLedger.sourceUnits.map((sourceUnit) => [
      sourceUnit.id,
      sourceUnit.sourceRef,
    ])
  );

  if (obligationIds.length === 0) {
    return {
      version: "V0",
      status: "EMPTY",
      groups: [],
      candidateGroups: [],
      accounting: {
        status: "COMPLETE",
        authoritativeObligationCount: 0,
        accountedObligationIds: [],
        unaccountedObligationIds: [],
        invalidProposalCount: 0,
      },
    };
  }

  const singleObligationAuthority:
    PlannerAcceptanceVerdictGroupProposal[] =
    obligationIds.length === 1 &&
    (args.authoritativeGroups?.length ?? 0) === 0
      ? [{
          obligationIds,
          relationship: "ATOMIC",
          sourceRefs:
            args.obligationLedger.obligations[0]!.sourceUnitIds
              .flatMap((sourceUnitId) => {
                const sourceRef = knownSourceRefs.get(sourceUnitId);
                return sourceRef
                  ? [{ sourceUnitId, sourceRef }]
                  : [];
              }),
          reason:
            "A single authoritative obligation is one indivisible verdict unit; no cross-obligation independence is inferred.",
        }]
      : [];
  const derivedSourceAuthority =
    (args.authoritativeGroups?.length ?? 0) === 0
      ? derivePlannerSourceBackedVerdictGroups({
          obligationLedger: args.obligationLedger,
          sourceLedger: args.sourceLedger,
        })
      : [];
  const authoritative = normalizeProposals({
    proposals:
      (args.authoritativeGroups?.length ?? 0) > 0
        ? args.authoritativeGroups!
        : derivedSourceAuthority.length > 0
          ? derivedSourceAuthority
          : singleObligationAuthority,
    obligationIds: knownObligationIds,
    sourceRefs: knownSourceRefs,
    authorityStatus: "AUTHORITATIVE",
  });
  const candidates = normalizeProposals({
    proposals: args.candidateGroups ?? [],
    obligationIds: knownObligationIds,
    sourceRefs: knownSourceRefs,
    authorityStatus: "CANDIDATE",
  });
  const authoritativeComplete =
    authoritative.invalidCount === 0 &&
    authoritative.groups.length > 0 &&
    completePartition(authoritative.groups, obligationIds);
  const incompleteAuthoritativeProposalCount =
    (args.authoritativeGroups?.length ?? 0) > 0 &&
    !authoritativeComplete &&
    authoritative.invalidCount === 0
      ? 1
      : 0;
  const groups = authoritativeComplete
    ? authoritative.groups
    : [{
        verdictGroupId: verdictGroupId(obligationIds),
        obligationIds,
        relationship: "UNKNOWN" as const,
        dependencyVerdictGroupIds: [],
        authority: {
          status: "UNRESOLVED" as const,
          source: "UNAVAILABLE" as const,
          sourceRefs: [],
        },
        reason:
          "No complete explicit authority establishes atomicity, independence, or dependency; all obligations remain fail-closed together.",
        accountingDisposition:
          "ACCOUNTED_FAIL_CLOSED" as const,
      }];

  return {
    version: "V0",
    status: authoritativeComplete
      ? "AUTHORITATIVE"
      : candidates.groups.length > 0
        ? "CANDIDATE_ONLY"
        : "UNKNOWN",
    groups,
    candidateGroups: candidates.groups,
    accounting: {
      status: "COMPLETE",
      authoritativeObligationCount: obligationIds.length,
      accountedObligationIds: obligationIds,
      unaccountedObligationIds: [],
      invalidProposalCount:
        authoritative.invalidCount +
        candidates.invalidCount +
        incompleteAuthoritativeProposalCount,
    },
  };
}

export function attachPlannerAcceptanceVerdictGrouping(
  plan: TestPlan,
  args: BuildArgs
): TestPlan {
  plan.acceptanceVerdictGrouping =
    buildPlannerAcceptanceVerdictGrouping(args);
  return plan;
}
