import type {
  PlannerRuntimeFixtureResolutionContract,
  PlannerTalentContractAcceptanceFixtureConstraint,
  PlannerTalentContractFixtureResolutionCapability,
  RuntimeTalentContractFixtureBinding,
} from "../../planner/types.js";
import {
  selectVerifiedContractFixtureCandidate,
  type ContractFixtureRequirementContext,
  type VerifiedContractFixtureSelection,
  type VerifiedContractFixtureCandidate,
} from "./fixtures/verified-contract-fixture-state.js";

export type RuntimeTalentContractFixturePreparationFailureReason =
  | "MALFORMED_CONTRACT"
  | "PERSONA_MISMATCH"
  | "NO_COMPATIBLE_CANDIDATE"
  | "AMBIGUOUS_COMPATIBLE_CANDIDATES"
  | "ENTITY_STATE_UNVERIFIED";

export type RuntimeCandidatePredicateCensus = {
  schema: "RUNTIME_CANDIDATE_PREDICATE_CENSUS_V1";
  candidates: Array<{
    entityId: string;
    identityVerified: boolean;
    ownershipVerified: boolean;
    predicates: Array<{
      key: string;
      expected: string | boolean | number;
      observed: "TRUE" | "FALSE" | "UNKNOWN";
      reason: string;
    }>;
    compatibility: "COMPATIBLE" | "INCOMPATIBLE" | "UNVERIFIED";
  }>;
};

export type RuntimeEquivalentCandidateSetResolution = {
  kind: "EQUIVALENT_COMPATIBLE_CANDIDATE_SET";
  candidateCount: number;
  candidateIdentityRefs: string[];
  representativeIdentity: string;
  canonicalization:
    "LEXICOGRAPHIC_VERIFIED_ENTITY_ID";
  scope: "FIXTURE_READINESS_ONLY";
};

export type RuntimeTalentContractFixturePreparationResult = {
  schemaVersion: 1;
  caseId: string;
  status: "RESOLVED" | "TEST_DATA_BLOCKED";
  candidateCount: number;
  selectedIdentity: string | null;
  persona: "talent" | null;
  resolver: "talent-contract-detail-readonly-v1";
  binding: RuntimeTalentContractFixtureBinding | null;
  fixtureReadyForInteraction: boolean;
  failureClassification: "TEST_DATA_ISSUE" | null;
  failureReason:
    | RuntimeTalentContractFixturePreparationFailureReason
    | null;
  preparedAt: string;
  evidenceRef: string | null;
  candidatePredicateCensus?: RuntimeCandidatePredicateCensus;
  equivalentCandidateSetResolution?:
    RuntimeEquivalentCandidateSetResolution;
  note: string;
};

type TalentContractMember = {
  constraint: PlannerTalentContractAcceptanceFixtureConstraint;
  capability: PlannerTalentContractFixtureResolutionCapability;
};

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return left.length === right.length &&
    [...left].sort().every(
      (value, index) => value === [...right].sort()[index]
    );
}

function validMember(
  contract: PlannerRuntimeFixtureResolutionContract,
  executionCaseId: string
): TalentContractMember | undefined {
  if (
    !contract.fixtureContractId ||
    contract.status !== "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" ||
    contract.policy !== "ALL_REQUIRED" ||
    contract.fixtureReadyForInteraction !== false ||
    contract.acceptanceCoverage?.kind !== "TALENT_CONTRACT_PREDICATES"
  ) {
    return undefined;
  }
  const members = contract.members.filter(
    (member) => member.executionCaseId === executionCaseId
  );
  if (members.length !== 1) return undefined;
  const member = members[0]!;
  const constraint = member.acceptanceFixtureConstraint;
  const capability = member.fixtureResolutionCapability;
  if (
    member.required !== true ||
    member.runtimeFixtureBinding !== "NOT_YET_RESOLVED" ||
    constraint?.fixtureKind !== "talent-contract" ||
    constraint.semantic.kind !== "PREDICATES" ||
    constraint.authority !== "SOURCE_AUTHORIZED" ||
    capability?.fixtureKind !== "talent-contract" ||
    constraint.executionCaseId !== executionCaseId ||
    capability.executionCaseId !== executionCaseId ||
    !constraint.constraintId ||
    !capability.capabilityId ||
    capability.resolverRef !== "talent-contract-detail-readonly-v1" ||
    capability.classification !== "AUTHENTICATED_READ_ONLY_DISCOVERY" ||
    capability.persona !== "talent" ||
    capability.identityPolicy !== constraint.identityPolicy ||
    capability.selectionPolicy !== "UNIQUE_COMPATIBLE_ONLY" ||
    capability.ambiguityPolicy !== "BLOCK_TEST_DATA_ISSUE" ||
    capability.identityVerification !== "REQUIRED" ||
    capability.ownershipVerification !== "REQUIRED" ||
    capability.provenance.module !==
      "src/agents/browser/fixtures/verified-contract-fixture-state.ts" ||
    capability.provenance.exportName !==
      "selectVerifiedContractFixtureCandidate"
  ) {
    return undefined;
  }
  const predicateKeys = constraint.semantic.predicates.map(
    (predicate) => predicate.key
  );
  if (
    predicateKeys.length === 0 ||
    new Set(predicateKeys).size !== predicateKeys.length ||
    constraint.semantic.predicates.some(
      (predicate) =>
        typeof predicate.expected !== "boolean" ||
        predicate.authority !== "SOURCE_AUTHORIZED" ||
        predicate.obligationIds.length === 0 ||
        predicate.sourceUnitRefs.length === 0
    ) ||
    !sameStrings(predicateKeys, capability.supportedPredicates) ||
    !sameStrings(
      predicateKeys,
      contract.acceptanceCoverage.requiredPredicateKeys
    ) ||
    !sameStrings(
      predicateKeys,
      contract.acceptanceCoverage.plannedPredicateKeys
    ) ||
    (
      constraint.identityPolicy === "exact" &&
      !constraint.exactEntityId
    ) ||
    (
      constraint.identityPolicy === "compatible-state" &&
      constraint.exactEntityId !== undefined
    )
  ) {
    return undefined;
  }
  return { constraint, capability };
}

function blocked(args: {
  caseId: string;
  candidateCount: number;
  persona: "talent" | null;
  preparedAt: string;
  reason: RuntimeTalentContractFixturePreparationFailureReason;
  census?: RuntimeCandidatePredicateCensus;
  note: string;
}): RuntimeTalentContractFixturePreparationResult {
  return {
    schemaVersion: 1,
    caseId: args.caseId,
    status: "TEST_DATA_BLOCKED",
    candidateCount: args.candidateCount,
    selectedIdentity: null,
    persona: args.persona,
    resolver: "talent-contract-detail-readonly-v1",
    binding: null,
    fixtureReadyForInteraction: false,
    failureClassification: "TEST_DATA_ISSUE",
    failureReason: args.reason,
    preparedAt: args.preparedAt,
    evidenceRef: null,
    ...(args.census ? { candidatePredicateCensus: args.census } : {}),
    note: args.note,
  };
}

export function buildRuntimeCandidatePredicateCensus(args: {
  candidates: VerifiedContractFixtureCandidate[];
  context: ContractFixtureRequirementContext;
  expectedOwnerId: string;
  selection: VerifiedContractFixtureSelection;
}): RuntimeCandidatePredicateCensus {
  const candidates = [...args.candidates].sort((left, right) =>
    left.identity.entityId.localeCompare(right.identity.entityId)
  );
  return {
    schema: "RUNTIME_CANDIDATE_PREDICATE_CENSUS_V1",
    candidates: candidates.map((candidate, index) => {
      const facts = new Map(candidate.facts.map((fact) => [fact.key, fact.value]));
      const evaluation = args.selection.evaluations[index];
      return {
        entityId: candidate.identity.entityId,
        identityVerified: candidate.identity.identityVerified === true,
        ownershipVerified:
          candidate.identity.ownershipVerified === true &&
          candidate.identity.ownerId === args.expectedOwnerId,
        predicates: [...args.context.requirements]
          .sort((left, right) => left.key.localeCompare(right.key))
          .map((requirement) => {
            const observed = !facts.has(requirement.key)
              ? "UNKNOWN" as const
              : facts.get(requirement.key) === requirement.expected
                ? "TRUE" as const
                : "FALSE" as const;
            return {
              key: requirement.key,
              expected: requirement.expected,
              observed,
              reason: observed === "UNKNOWN"
                ? "The authorized discovery returned no verified fact for this predicate."
                : observed === "TRUE"
                  ? "The verified fact exactly matches the required value."
                  : "The verified fact deterministically contradicts the required value.",
            };
          }),
        compatibility: evaluation?.status === "COMPATIBLE"
          ? "COMPATIBLE" as const
          : evaluation?.status === "STATE_UNKNOWN"
            ? "UNVERIFIED" as const
            : "INCOMPATIBLE" as const,
      };
    }),
  };
}

/**
 * Resolves one already-authored talent-contract fixture member against
 * authenticated, ownership-verified candidates. It neither discovers data nor
 * mutates/materializes the planning artifact.
 */
export function evaluateRuntimeTalentContractFixturePreparation(args: {
  executionCaseId: string;
  contract: PlannerRuntimeFixtureResolutionContract | null | undefined;
  actualPersona: string | null | undefined;
  expectedOwnerId: string | null | undefined;
  candidates: VerifiedContractFixtureCandidate[];
  preparedAt: string;
  evidenceRef: string;
}): RuntimeTalentContractFixturePreparationResult {
  const persona = args.actualPersona === "talent" ? "talent" : null;
  if (persona !== "talent" || !args.expectedOwnerId) {
    return blocked({
      caseId: args.executionCaseId,
      candidateCount: args.candidates.length,
      persona,
      preparedAt: args.preparedAt,
      reason: "PERSONA_MISMATCH",
      note: "A verified talent session and owner identity are required.",
    });
  }
  const member = args.contract
    ? validMember(args.contract, args.executionCaseId)
    : undefined;
  if (!member || !args.contract?.fixtureContractId) {
    return blocked({
      caseId: args.executionCaseId,
      candidateCount: args.candidates.length,
      persona,
      preparedAt: args.preparedAt,
      reason: "MALFORMED_CONTRACT",
      note: "The closed planner fixture contract is absent or inconsistent.",
    });
  }
  const context: ContractFixtureRequirementContext = {
    policy: member.constraint.identityPolicy,
    ...(member.constraint.exactEntityId
      ? { exactEntityId: member.constraint.exactEntityId }
      : {}),
    requirements: member.constraint.semantic.predicates.map((predicate) => ({
      key: predicate.key,
      expected: predicate.expected,
      mandatory: true,
      source: "AUTHORITATIVE_SOURCE" as const,
      sourceRef: predicate.sourceUnitRefs[0]!.sourceRef,
    })),
  };
  const selection = selectVerifiedContractFixtureCandidate(
    args.candidates,
    context,
    args.expectedOwnerId,
    {
      allowEquivalentCompatibleCandidateSet:
        member.constraint.identityPolicy ===
        "compatible-state",
    }
  );
  const census = buildRuntimeCandidatePredicateCensus({
    candidates: args.candidates,
    context,
    expectedOwnerId: args.expectedOwnerId,
    selection,
  });
  if (selection.status !== "SELECTED" || !selection.selected) {
    const reason = selection.status === "AMBIGUOUS_ENTITY"
      ? "AMBIGUOUS_COMPATIBLE_CANDIDATES" as const
      : selection.status === "ENTITY_STATE_UNVERIFIED"
        ? "ENTITY_STATE_UNVERIFIED" as const
        : "NO_COMPATIBLE_CANDIDATE" as const;
    return blocked({
      caseId: args.executionCaseId,
      candidateCount: args.candidates.length,
      persona,
      preparedAt: args.preparedAt,
      reason,
      census,
      note: selection.reason,
    });
  }
  const binding: RuntimeTalentContractFixtureBinding = {
    status: "RESOLVED",
    executionCaseId: args.executionCaseId,
    fixtureKind: "talent-contract",
    fixtureContractId: args.contract.fixtureContractId,
    fixtureIdentityRef: selection.selected.identity.entityId,
    ownerPersonaRef: "talent",
    ownerIdentityRef: args.expectedOwnerId,
    identityPolicy: member.constraint.identityPolicy,
    ownershipVerification: "VERIFIED",
    predicateVerification: "VERIFIED",
    verifiedPredicates: member.constraint.semantic.predicates.map(
      (predicate) => ({ key: predicate.key, expected: predicate.expected })
    ),
    selectionPolicy:
      selection.selectionBasis ===
      "EQUIVALENT_COMPATIBLE_CANDIDATE_SET"
        ? "CANONICAL_EQUIVALENT_COMPATIBLE_REPRESENTATIVE"
        : "UNIQUE_COMPATIBLE_ONLY",
    resolverProvenance: {
      resolverRef: "talent-contract-detail-readonly-v1",
      evidenceRef: args.evidenceRef,
    },
    verifiedAt: args.preparedAt,
  };
  return {
    schemaVersion: 1,
    caseId: args.executionCaseId,
    status: "RESOLVED",
    candidateCount: args.candidates.length,
    selectedIdentity: selection.selected.identity.entityId,
    persona,
    resolver: "talent-contract-detail-readonly-v1",
    binding,
    fixtureReadyForInteraction: true,
    failureClassification: null,
    failureReason: null,
    preparedAt: args.preparedAt,
    evidenceRef: args.evidenceRef,
    candidatePredicateCensus: census,
    ...(selection.selectionBasis ===
      "EQUIVALENT_COMPATIBLE_CANDIDATE_SET"
      ? {
          equivalentCandidateSetResolution: {
            kind:
              "EQUIVALENT_COMPATIBLE_CANDIDATE_SET" as const,
            candidateCount:
              selection.equivalentCandidateIds!
                .length,
            candidateIdentityRefs:
              selection.equivalentCandidateIds!,
            representativeIdentity:
              selection.selected.identity.entityId,
            canonicalization:
              "LEXICOGRAPHIC_VERIFIED_ENTITY_ID" as const,
            scope:
              "FIXTURE_READINESS_ONLY" as const,
          },
        }
      : {}),
    note: selection.reason,
  };
}
