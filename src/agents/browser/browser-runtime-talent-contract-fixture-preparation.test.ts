import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlannerRuntimeFixtureResolutionContract,
  PlannerTalentContractFixturePredicateKey,
} from "../../planner/types.js";
import {
  evaluateRuntimeTalentContractFixturePreparation,
} from "./browser-runtime-talent-contract-fixture-preparation.js";
import type {
  VerifiedContractFixtureCandidate,
} from "./fixtures/verified-contract-fixture-state.js";

const caseId = "case-1";
const ownerId = "owner-1";
const preparedAt = "2026-09-03T10:00:00.000Z";
const evidenceRef = "evidence:fixture-readonly";

function contract(
  keys: PlannerTalentContractFixturePredicateKey[] = [
    "contract.accessibleToOwner",
  ],
  identity: "exact" | "compatible-state" = "compatible-state",
  exactEntityId?: string,
  expected = true
): PlannerRuntimeFixtureResolutionContract {
  const predicates = keys.map((key) => ({
    key,
    expected,
    obligationIds: ["obligation-1"],
    sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira:ac" }],
    authority: "SOURCE_AUTHORIZED" as const,
  }));
  return {
    fixtureContractId: "fixture-contract-1",
    status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
    policy: "ALL_REQUIRED",
    members: [{
      executionCaseId: caseId,
      required: true,
      acceptanceFixtureConstraint: {
        constraintId: "constraint-1",
        executionCaseId: caseId,
        sourceCaseId: caseId,
        partition: { mode: "ALL_REQUIRED", memberId: caseId, memberCount: 1 },
        fixtureKind: "talent-contract",
        semantic: { kind: "PREDICATES", predicates },
        obligationIds: ["obligation-1"],
        sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira:ac" }],
        identityPolicy: identity,
        ...(exactEntityId ? { exactEntityId } : {}),
        authority: "SOURCE_AUTHORIZED",
      },
      fixtureResolutionCapability: {
        capabilityId: "capability-1",
        executionCaseId: caseId,
        fixtureKind: "talent-contract",
        resolverRef: "talent-contract-detail-readonly-v1",
        classification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
        persona: "talent",
        supportedPredicates: keys,
        identityPolicy: identity,
        selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
        ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
        identityVerification: "REQUIRED",
        ownershipVerification: "REQUIRED",
        provenance: {
          module: "src/agents/browser/fixtures/verified-contract-fixture-state.ts",
          exportName: "selectVerifiedContractFixtureCandidate",
        },
      },
      runtimeFixtureBinding: "NOT_YET_RESOLVED",
    }],
    acceptanceCoverage: {
      kind: "TALENT_CONTRACT_PREDICATES",
      policy: "ALL_REQUIRED",
      requiredPredicateKeys: keys,
      plannedPredicateKeys: keys,
    },
    fixtureReadyForInteraction: false,
  };
}

function candidate(
  id: string,
  facts: Array<[PlannerTalentContractFixturePredicateKey, boolean]>,
  overrides: Partial<VerifiedContractFixtureCandidate["identity"]> = {}
): VerifiedContractFixtureCandidate {
  return {
    identity: {
      entityKind: "contract",
      entityId: id,
      source: "AUTHENTICATED_GET",
      persona: "talent",
      identityVerified: true,
      ownershipVerified: true,
      ownerId,
      ...overrides,
    },
    facts: facts.map(([key, value]) => ({
      key,
      value,
      verification: "EXACT_API_FIELD",
      sourceRef: "authenticated-get",
    })),
  };
}

function evaluate(
  fixtureContract: PlannerRuntimeFixtureResolutionContract,
  candidates: VerifiedContractFixtureCandidate[],
  actualPersona = "talent",
  expectedOwnerId: string | null = ownerId
) {
  return evaluateRuntimeTalentContractFixturePreparation({
    executionCaseId: caseId,
    contract: fixtureContract,
    actualPersona,
    expectedOwnerId,
    candidates,
    preparedAt,
    evidenceRef,
  });
}

test("unique owned compatible candidate produces the typed runtime binding", () => {
  const result = evaluate(
    contract(),
    [candidate("contract-a", [["contract.accessibleToOwner", true]])]
  );
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.fixtureReadyForInteraction, true);
  assert.deepEqual(result.binding, {
    status: "RESOLVED",
    executionCaseId: caseId,
    fixtureKind: "talent-contract",
    fixtureContractId: "fixture-contract-1",
    fixtureIdentityRef: "contract-a",
    ownerPersonaRef: "talent",
    ownerIdentityRef: ownerId,
    identityPolicy: "compatible-state",
    ownershipVerification: "VERIFIED",
    predicateVerification: "VERIFIED",
    verifiedPredicates: [{ key: "contract.accessibleToOwner", expected: true }],
    selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
    resolverProvenance: {
      resolverRef: "talent-contract-detail-readonly-v1",
      evidenceRef,
    },
    verifiedAt: preparedAt,
  });
});

test("zero compatible candidates blocks without binding", () => {
  const result = evaluate(contract(), []);
  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(result.binding, null);
});

test("source-authorized negative boolean state resolves when the verified fact is false", () => {
  const fixtureContract = contract(["contract.hasWorkSetups"]);
  const semantic = fixtureContract.members[0]!.acceptanceFixtureConstraint!
    .semantic;
  assert.equal(semantic.kind, "PREDICATES");
  if (semantic.kind !== "PREDICATES") return;
  const predicate = semantic.predicates[0]!;
  predicate.expected = false;
  const result = evaluate(
    fixtureContract,
    [candidate("contract-empty", [["contract.hasWorkSetups", false]])]
  );
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.binding?.verifiedPredicates[0]?.expected, false);
});

test("multiple equivalent compatible candidates use the canonical verified identity", () => {
  const fixtureContract = contract();
  const candidates = [
    candidate("contract-b", [["contract.accessibleToOwner", true]]),
    candidate("contract-a", [["contract.accessibleToOwner", true]]),
  ];
  const result = evaluate(fixtureContract, candidates);
  const reversed = evaluate(
    contract(),
    [...candidates].reverse()
  );
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.selectedIdentity, "contract-a");
  assert.equal(
    result.binding?.selectionPolicy,
    "CANONICAL_EQUIVALENT_COMPATIBLE_REPRESENTATIVE"
  );
  assert.deepEqual(
    result.equivalentCandidateSetResolution,
    {
      kind:
        "EQUIVALENT_COMPATIBLE_CANDIDATE_SET",
      candidateCount: 2,
      candidateIdentityRefs: [
        "contract-a",
        "contract-b",
      ],
      representativeIdentity: "contract-a",
      canonicalization:
        "LEXICOGRAPHIC_VERIFIED_ENTITY_ID",
      scope: "FIXTURE_READINESS_ONLY",
    }
  );
  assert.equal(
    reversed.selectedIdentity,
    result.selectedIdentity
  );
  assert.deepEqual(
    reversed.equivalentCandidateSetResolution,
    result.equivalentCandidateSetResolution
  );
  assert.equal(fixtureContract.members[0]!.runtimeFixtureBinding, "NOT_YET_RESOLVED");
});

test("three fully equivalent candidates resolve but mixed states never use equivalence", () => {
  const trueFact = [[
    "contract.accessibleToOwner",
    true,
  ]] as Array<[
    PlannerTalentContractFixturePredicateKey,
    boolean,
  ]>;
  const equivalent = evaluate(contract(), [
    candidate("c", trueFact),
    candidate("a", trueFact),
    candidate("b", trueFact),
  ]);
  assert.equal(equivalent.selectedIdentity, "a");
  assert.equal(
    equivalent.equivalentCandidateSetResolution
      ?.candidateCount,
    3
  );

  for (const candidates of [
    [
      candidate("a", trueFact),
      candidate("b", trueFact),
      candidate("c", []),
    ],
    [
      candidate("a", trueFact),
      candidate("b", trueFact),
      candidate("c", [["contract.accessibleToOwner", false]]),
    ],
    [
      candidate("a", trueFact),
      candidate("b", trueFact),
      candidate("c", trueFact, { identityVerified: false }),
    ],
    [
      candidate("a", trueFact),
      candidate("b", trueFact),
      candidate("c", trueFact, { ownershipVerified: false }),
    ],
  ]) {
    const result = evaluate(contract(), candidates);
    assert.equal(
      result.equivalentCandidateSetResolution,
      undefined
    );
    assert.equal(result.binding, null);
  }
});

test("unknown predicate state blocks without binding", () => {
  const result = evaluate(
    contract(["contract.documentMetadataPresent"]),
    [candidate("contract-a", [])]
  );
  assert.equal(result.failureReason, "ENTITY_STATE_UNVERIFIED");
  assert.equal(result.binding, null);
});

test("verified false predicate is incompatible rather than unknown", () => {
  const result = evaluate(
    contract(["contract.hasWorkSetups"]),
    [candidate("contract-a", [["contract.hasWorkSetups", false]])]
  );
  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
});

test("one compatible candidate still wins over one definitively incompatible candidate", () => {
  const result = evaluate(contract(), [
    candidate("contract-compatible", [["contract.accessibleToOwner", true]]),
    candidate("contract-incompatible", [["contract.accessibleToOwner", false]]),
  ]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(
    result.selectedIdentity,
    "contract-compatible"
  );
  assert.equal(
    result.binding?.selectionPolicy,
    "UNIQUE_COMPATIBLE_ONLY"
  );
  assert.equal(
    result.equivalentCandidateSetResolution,
    undefined
  );
});

test("known false compound compliance prerequisites remain blocked", () => {
  const trolleyAndDeel = evaluate(
    contract([
      "compliance.TROLLEY_ONBOARDING_SETUP.present",
      "compliance.DEEL_ONBOARDING_SETUP.present",
    ]),
    [
      candidate("contract-a", [
        ["compliance.TROLLEY_ONBOARDING_SETUP.present", true],
        ["compliance.DEEL_ONBOARDING_SETUP.present", false],
      ]),
      candidate("contract-b", [
        ["compliance.TROLLEY_ONBOARDING_SETUP.present", true],
        ["compliance.DEEL_ONBOARDING_SETUP.present", false],
      ]),
    ]
  );
  const backgroundCheck = evaluate(
    contract([
      "compliance.BACKGROUND_CHECK.present",
    ]),
    [
      candidate("contract-a", [["compliance.BACKGROUND_CHECK.present", false]]),
      candidate("contract-b", [["compliance.BACKGROUND_CHECK.present", false]]),
    ]
  );

  for (const result of [
    trolleyAndDeel,
    backgroundCheck,
  ]) {
    assert.equal(
      result.failureReason,
      "NO_COMPATIBLE_CANDIDATE"
    );
    assert.equal(result.binding, null);
    assert.equal(
      result.equivalentCandidateSetResolution,
      undefined
    );
  }
});

test("ownership and persona mismatch fail closed", () => {
  const fixtureContract = contract();
  assert.equal(
    evaluate(fixtureContract, [candidate("contract-a", [["contract.accessibleToOwner", true]], { ownerId: "other" })]).failureReason,
    "NO_COMPATIBLE_CANDIDATE"
  );
  assert.equal(
    evaluate(fixtureContract, [], "company_admin").failureReason,
    "PERSONA_MISMATCH"
  );
  assert.equal(
    evaluate(fixtureContract, [], "talent", null).failureReason,
    "PERSONA_MISMATCH"
  );
});

test("exact policy selects only the authoritative exact identity", () => {
  const result = evaluate(
    contract(["contract.accessibleToOwner"], "exact", "contract-b"),
    [
      candidate("contract-a", [["contract.accessibleToOwner", true]]),
      candidate("contract-b", [["contract.accessibleToOwner", true]]),
    ]
  );
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.selectedIdentity, "contract-b");
  assert.equal(result.binding?.identityPolicy, "exact");
  assert.equal(
    result.equivalentCandidateSetResolution,
    undefined
  );
});

test("malformed or authority-incomplete contracts cannot reach the selector", () => {
  const missingAuthority = structuredClone(contract());
  missingAuthority.members[0]!.acceptanceFixtureConstraint!.authority =
    "CANDIDATE_ONLY" as never;
  assert.equal(evaluate(missingAuthority, []).failureReason, "MALFORMED_CONTRACT");

  const forgedCapability = structuredClone(contract());
  const capability =
    forgedCapability.members[0]!.fixtureResolutionCapability!;
  assert.equal(capability.fixtureKind, "talent-contract");
  if (capability.fixtureKind === "talent-contract") {
    capability.supportedPredicates = [];
  }
  assert.equal(evaluate(forgedCapability, []).failureReason, "MALFORMED_CONTRACT");
});

test("planning contract remains unresolved and serializes no runtime identity", () => {
  const original = contract([
    "contract.hasWorkSetups",
    "contract.documentMetadataPresent",
  ]);
  const reloaded = JSON.parse(JSON.stringify(original)) as
    PlannerRuntimeFixtureResolutionContract;
  assert.deepEqual(reloaded, original);
  assert.equal(reloaded.fixtureReadyForInteraction, false);
  assert.equal(reloaded.members[0]!.runtimeFixtureBinding, "NOT_YET_RESOLVED");
  assert.equal(JSON.stringify(reloaded).includes("fixtureIdentityRef"), false);
});

test("candidate census preserves FALSE and UNKNOWN without changing failure selection", () => {
  const result = evaluate(
    contract(["contract.hasWorkSetups"]),
    [
      candidate("contract-false", [["contract.hasWorkSetups", false]]),
      candidate("contract-unknown", []),
    ]
  );
  assert.equal(result.failureReason, "ENTITY_STATE_UNVERIFIED");
  assert.equal(result.binding, null);
  assert.deepEqual(
    result.candidatePredicateCensus?.candidates.map((item) => ({
      id: item.entityId,
      observed: item.predicates[0]?.observed,
      compatibility: item.compatibility,
    })),
    [
      {
        id: "contract-false",
        observed: "FALSE",
        compatibility: "INCOMPATIBLE",
      },
      {
        id: "contract-unknown",
        observed: "UNKNOWN",
        compatibility: "UNVERIFIED",
      },
    ]
  );
});

test("census is deterministic for unique stable identities and remains diagnostic-only", () => {
  const fixtureContract = contract(["contract.accessibleToOwner"]);
  const first = evaluate(fixtureContract, [
    candidate("contract-b", [["contract.accessibleToOwner", true]]),
    candidate("contract-a", [["contract.accessibleToOwner", false]]),
  ]);
  const reversed = evaluate(fixtureContract, [
    candidate("contract-a", [["contract.accessibleToOwner", false]]),
    candidate("contract-b", [["contract.accessibleToOwner", true]]),
  ]);
  assert.equal(first.status, "RESOLVED");
  assert.equal(first.selectedIdentity, "contract-b");
  assert.deepEqual(
    reversed.candidatePredicateCensus,
    first.candidatePredicateCensus
  );
  assert.equal(first.candidatePredicateCensus?.schema,
    "RUNTIME_CANDIDATE_PREDICATE_CENSUS_V1");
  for (const forbidden of [
    "navigationBinding", "deterministicEvidence", "verdict", '"PASS"',
  ]) {
    assert.equal(
      JSON.stringify(first.candidatePredicateCensus).includes(forbidden),
      false
    );
  }
});

test("zero candidates retain the existing outcome with an empty census", () => {
  const result = evaluate(contract(), []);
  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(result.binding, null);
  assert.deepEqual(result.candidatePredicateCensus, {
    schema: "RUNTIME_CANDIDATE_PREDICATE_CENSUS_V1",
    candidates: [],
  });
});
