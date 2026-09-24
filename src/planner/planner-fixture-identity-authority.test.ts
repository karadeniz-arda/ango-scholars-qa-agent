import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeFixturePolicy,
  resolveFixtureIdentityAuthority,
} from "./planner-fixture-identity-authority.js";
import {
  applyPlannerRuntimeFixturePolicies,
} from "./planner-runtime-fixture-policy.js";
import {
  adaptVerifiedContractFixtureCandidates,
  buildContractFixtureRequirementContext,
  selectVerifiedContractFixtureCandidate,
  type VerifiedContractFixtureCandidate,
} from "../agents/browser/fixtures/verified-contract-fixture-state.js";
import {
  selectTalentContractFixture,
} from "../agents/browser/browser-route-talent-contract.js";

const source = (
  jira: string,
  github = "implementation detail"
) =>
  `--- JIRA TICKET ---\n${jira}\n` +
  `--- GITHUB CHANGE CONTEXT ---\n${github}`;

const authority = (
  jira: string,
  rest: Record<string, unknown> = {}
) => resolveFixtureIdentityAuthority({
  entityKind: "contract",
  sourceContext: source(jira),
  ...rest,
});

const stateCase = (): any => ({
  id: "web-contract",
  persona: "talent",
  goal:
    "Verify signed compliance behavior on contract details.",
  successCriteria:
    "A signed compliance document opens.",
  runtimeFixturePolicy: "exact" as const,
  fixtureRequirements: [
    "A talent-owned contract details view with a signed compliance document.",
  ],
  steps: [],
});

function runtimeCandidate(
  id: string,
  signed: boolean
): VerifiedContractFixtureCandidate {
  return {
    identity: {
      entityKind: "contract",
      entityId: id,
      source: "AUTHENTICATED_GET",
      persona: "talent",
      identityVerified: true,
      ownershipVerified: true,
      ownerId: "talent-1",
    },
    facts: [
      {
        key:
          "compliance.COMPLIANCE_DOCUMENT.present",
        value: true,
        verification:
          "EXACT_RELATED_RESOURCE",
      },
      {
        key:
          "compliance.COMPLIANCE_DOCUMENT.signed",
        value: signed,
        verification:
          "EXACT_RELATED_RESOURCE",
      },
    ],
  };
}

function complianceCandidate(
  item: Record<string, unknown>
) {
  return adaptVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        offer: { id: "offer-1" },
      },
    ],
    talentId: "talent-1",
    relatedStateByContractId: new Map([
      [
        "contract-1",
        {
          parentContractId: "contract-1",
          parentOfferId: "offer-1",
          complianceVerified: true,
          complianceRequirements: [item],
        },
      ],
    ]),
  })[0]!;
}

test("1 exact state does not imply exact identity", () => {
  assert.equal(
    authority(
      "Use any signed contract in the required state."
    ).authority,
    "NONE"
  );
});

test("2 explicit Jira identity authorizes an exact ID", () => {
  const result = authority(
    "Use contractId: contract-42."
  );

  assert.equal(
    result.authority,
    "EXPLICIT_SOURCE_IDENTITY"
  );
  assert.equal(result.entityId, "contract-42");
});

test("3 planner-proposed ID is candidate only", () => {
  assert.equal(
    authority("Use a signed contract.", {
      plannerProposedId: "proposal-1",
    }).authority,
    "CANDIDATE_ONLY"
  );
});

test("4 runtime-discovered ID is candidate only", () => {
  assert.equal(
    authority("Use a signed contract.", {
      runtimeCandidateId: "runtime-1",
    }).authority,
    "CANDIDATE_ONLY"
  );
});

test("5 one candidate does not become authoritative", () => {
  const result = authority(
    "Use a signed contract.",
    { runtimeCandidateId: "only-one" }
  );

  assert.equal(
    result.authority,
    "CANDIDATE_ONLY"
  );
  assert.equal(result.entityId, undefined);
});

test("6 route parameter does not grant identity authority", () => {
  assert.equal(
    authority("Open contract details.", {
      routeParamId: "route-42",
    }).authority,
    "CANDIDATE_ONLY"
  );
});

test("7 missing explicit source identity cannot authorize exact ID", () => {
  assert.equal(
    authority("Open my contract.").entityId,
    undefined
  );
});

test("8 unavailable source fails safe", () => {
  assert.equal(
    resolveFixtureIdentityAuthority({
      entityKind: "contract",
      sourceContext: "unbounded text",
    }).authority,
    "SOURCE_UNAVAILABLE"
  );
});

test("9 authoritative exact ID retains exact policy", () => {
  const result = normalizeRuntimeFixturePolicy({
    identityAuthority: authority(
      "contract ID: exact-1"
    ),
    compatibleStateSupported: true,
    substitutionSemanticallyAllowed: true,
  });

  assert.equal(result.policy, "exact");
  assert.equal(result.exactEntityId, "exact-1");
});

test("10 exact state without exact identity can normalize to compatible-state", () => {
  assert.equal(
    normalizeRuntimeFixturePolicy({
      identityAuthority: authority(
        "Use a contract with exact signed state."
      ),
      compatibleStateSupported: true,
      substitutionSemanticallyAllowed: true,
    }).policy,
    "compatible-state"
  );
});

test("11 compatible substitution requires explicit semantic permission", () => {
  assert.equal(
    normalizeRuntimeFixturePolicy({
      identityAuthority: authority(
        "Use a contract."
      ),
      compatibleStateSupported: true,
      substitutionSemanticallyAllowed: false,
    }).status,
    "BLOCKED"
  );
});

test("12 ambiguous policy fails safe", () => {
  assert.equal(
    normalizeRuntimeFixturePolicy({
      identityAuthority:
        resolveFixtureIdentityAuthority({
          entityKind: "contract",
          sourceContext: "missing markers",
        }),
      compatibleStateSupported: true,
      substitutionSemanticallyAllowed: true,
    }).status,
    "BLOCKED"
  );
});

test("13 policy normalization is deterministic", () => {
  const input = {
    identityAuthority: authority(
      "Use any matching contract."
    ),
    compatibleStateSupported: true,
    substitutionSemanticallyAllowed: true,
  };

  assert.deepEqual(
    normalizeRuntimeFixturePolicy(input),
    normalizeRuntimeFixturePolicy(input)
  );
});

test("15 explicit signed boolean is accepted", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: true,
  });

  assert.equal(
    result.facts.find(
      (fact) => fact.key.endsWith(".signed")
    )?.value,
    true
  );
});

test("16 explicit signature status is accepted", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signatureStatus: "signed",
  });

  assert.equal(
    result.facts.find(
      (fact) => fact.key.endsWith(".signed")
    )?.value,
    true
  );
});

test("17 signedAt is accepted only with explicit signed state", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: true,
    signature: {
      signedAt: "2026-08-25T10:00:00Z",
    },
  });

  assert.equal(
    result.facts.find(
      (fact) =>
        fact.key.endsWith(
          ".signedAtPresent"
        )
    )?.value,
    true
  );
});

test("18 document existence alone cannot prove signed", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    document: { id: "document-1" },
  });

  assert.equal(
    result.facts.some(
      (fact) => fact.key.endsWith(".signed")
    ),
    false
  );
});

test("19 URL existence cannot prove signed", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    uploadedDocumentUrl:
      "https://example.invalid/signed",
  });

  assert.equal(
    result.facts.some(
      (fact) => fact.key.endsWith(".signed")
    ),
    false
  );
});

test("20 unsupported metadata stays unknown", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    unknownSignatureShape: {
      complete: true,
    },
  });

  assert.equal(
    result.facts.some(
      (fact) => fact.key.endsWith(".signed")
    ),
    false
  );
});

test("21 malformed signature metadata stays unknown", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: "yes",
    signatureStatus: { value: "signed" },
  });

  assert.equal(
    result.facts.some(
      (fact) => fact.key.endsWith(".signed")
    ),
    false
  );
});

test("22 related metadata must belong to the same contract", () => {
  const candidates =
    adaptVerifiedContractFixtureCandidates({
      contractsData: [
        {
          id: "contract-1",
          offer: { id: "offer-1" },
        },
      ],
      talentId: "talent-1",
      relatedStateByContractId: new Map([
        [
          "contract-1",
          {
            parentContractId:
              "different-contract",
            parentOfferId: "offer-2",
            complianceVerified: true,
            complianceRequirements: [
              {
                requirement: {
                  type: "compliance_document",
                },
                signed: true,
              },
            ],
          },
        ],
      ]),
    });

  assert.deepEqual(
    candidates[0]!.facts.map((fact) => fact.key),
    ["contract.accessibleToOwner"]
  );
  assert.equal(
    candidates[0]!.facts.some(
      (fact) => fact.key.endsWith(".signed")
    ),
    false
  );
});

test("23 endpoint provenance is retained without concrete IDs", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: true,
  });
  const signed = result.facts.find(
    (fact) => fact.key.endsWith(".signed")
  );

  assert.equal(
    signed?.sourceRef,
    "/talents/{talentId}/offers/{offerId}/compliance/requirements"
  );
});

test("24 metadata adapter exposes no mutation transport", () => {
  assert.equal(
    adaptVerifiedContractFixtureCandidates.length,
    1
  );
});

test("25 newly observed signed facts flow through the V2 evaluator", () => {
  const runtime = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: true,
  });
  const requirementContext =
    buildContractFixtureRequirementContext({
      runtimeFixturePolicy:
        "compatible-state",
      fixtureRequirements: [
        "A signed compliance document.",
      ],
    });

  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [runtime],
      requirementContext,
      "talent-1"
    ).status,
    "SELECTED"
  );
});

test("26 policy package reuses the existing V2 selector", () => {
  assert.equal(
    typeof selectVerifiedContractFixtureCandidate,
    "function"
  );
});

test("27 one compatible contract is selected", () => {
  const selection =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("one", true)],
      {
        policy: "compatible-state",
        requirements: [
          {
            key:
              "compliance.COMPLIANCE_DOCUMENT.signed",
            expected: true,
            mandatory: true,
            source:
              "PLAN_FIXTURE_REQUIREMENT",
          },
        ],
      },
      "talent-1"
    );

  assert.equal(selection.status, "SELECTED");
});

test("28 zero compatible contracts remain unresolved", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("one", false)],
      {
        policy: "compatible-state",
        requirements: [
          {
            key:
              "compliance.COMPLIANCE_DOCUMENT.signed",
            expected: true,
            mandatory: true,
            source:
              "PLAN_FIXTURE_REQUIREMENT",
          },
        ],
      },
      "talent-1"
    ).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("29 multiple compatible contracts remain ambiguous", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [
        runtimeCandidate("one", true),
        runtimeCandidate("two", true),
      ],
      {
        policy: "compatible-state",
        requirements: [],
      },
      "talent-1"
    ).status,
    "AMBIGUOUS_ENTITY"
  );
});

test("30 unknown mandatory metadata cannot become compatible", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [
        {
          ...runtimeCandidate("one", true),
          facts: [],
        },
      ],
      {
        policy: "compatible-state",
        requirements: [
          {
            key: "missing.fact",
            expected: true,
            mandatory: true,
            source:
              "PLAN_FIXTURE_REQUIREMENT",
          },
        ],
      },
      "talent-1"
    ).status,
    "ENTITY_STATE_UNVERIFIED"
  );
});

test("31 exact authority prevents another compatible identity substituting", () => {
  const testCase = stateCase();
  const requirementContext =
    buildContractFixtureRequirementContext({
      ...testCase,
      fixtureIdentityAuthority: {
        authority:
          "EXPLICIT_SOURCE_IDENTITY",
        entityKind: "contract",
        entityId: "exact",
        sourceRef:
          "jira.explicitFixtureIdentity",
      },
    });
  const selection =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("other", true)],
      requirementContext,
      "talent-1"
    );

  assert.equal(selection.selected, undefined);
});

test("32 eligible unique candidate may feed Deep-Route V0", () => {
  const selected =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("contract-1", true)],
      {
        policy: "compatible-state",
        requirements: [],
      },
      "talent-1"
    );
  const route = selectTalentContractFixture(
    [{ id: "contract-1" }],
    [],
    "any",
    "talent-1",
    {
      runtimeFixturePolicy:
        "compatible-state",
    },
    selected
  );

  assert.equal(
    route.deepRouteBinding.boundRoute?.route,
    "/talent/contracts/contract-1"
  );
});

test("33 state-only candidate cannot bypass authoritative exact ID", () => {
  const result =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("other", true)],
      {
        policy: "exact",
        exactEntityId: "required",
        requirements: [],
      },
      "talent-1"
    );

  assert.equal(
    result.status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("34 route binding remains acceptance-neutral", () => {
  const result =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("one", true)],
      {
        policy: "compatible-state",
        requirements: [],
      },
      "talent-1"
    );

  assert.equal(
    "deterministicEvidence" in result,
    false
  );
});

test("35 target verification remains acceptance-neutral", () => {
  const result =
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("one", true)],
      {
        policy: "compatible-state",
        requirements: [],
      },
      "talent-1"
    );

  assert.equal(
    (result as { verdict?: string }).verdict,
    undefined
  );
});

test("36 fixture readiness cannot create PASS", () => {
  assert.notEqual(
    selectVerifiedContractFixtureCandidate(
      [runtimeCandidate("one", true)],
      {
        policy: "compatible-state",
        requirements: [],
      },
      "talent-1"
    ).status,
    "PASS"
  );
});

test("37 metadata cannot create acceptance proof", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signed: true,
  });

  assert.equal(
    "acceptanceScope" in result,
    false
  );
});

test("38 identity authority module introduces no mutation path", () => {
  const sourceText = [
    resolveFixtureIdentityAuthority,
    normalizeRuntimeFixturePolicy,
  ].map((value) => value.toString()).join(" ");

  assert.doesNotMatch(
    sourceText,
    /fetch\s*\(|apiPost|apiPatch|apiPut|apiDelete/
  );
});

test("39 screenshot or model claims cannot grant authority", () => {
  const result = resolveFixtureIdentityAuthority({
    entityKind: "contract",
    sourceContext: source(
      "Use a matching contract."
    ),
    plannerProposedId:
      "model-or-screenshot-id",
  });

  assert.equal(
    result.authority,
    "CANDIDATE_ONLY"
  );
});

test("40 authority and normalized policy output is deterministic", () => {
  const first = authority(
    "Use contractId: stable-1."
  );
  const second = authority(
    "Use contractId: stable-1."
  );

  assert.deepEqual(first, second);
  assert.deepEqual(
    normalizeRuntimeFixturePolicy({
      identityAuthority: first,
      compatibleStateSupported: true,
      substitutionSemanticallyAllowed: true,
    }),
    normalizeRuntimeFixturePolicy({
      identityAuthority: second,
      compatibleStateSupported: true,
      substitutionSemanticallyAllowed: true,
    })
  );
});

test("raw talent-contract candidate prose cannot admit compatible-state fixture resolution", () => {
  const plan = {
    notes: "",
    browserCases: [stateCase()],
  };

  applyPlannerRuntimeFixturePolicies(
    plan,
    source(
      "Signed compliance behavior applies to any matching contract."
    )
  );

  assert.equal(
    plan.browserCases[0]!
      .runtimeFixturePolicy,
    "exact"
  );

  assert.equal(
    plan.browserCases[0]!
      .fixtureIdentityAuthority,
    undefined
  );
});

test("early raw fixture normalization cannot create contract identity authority", () => {
  const plan = {
    notes: "",
    browserCases: [stateCase()],
  };

  applyPlannerRuntimeFixturePolicies(
    plan,
    source(
      "Use contract ID: exact-contract."
    )
  );

  assert.equal(
    plan.browserCases[0]!
      .runtimeFixturePolicy,
    "exact"
  );

  assert.equal(
    plan.browserCases[0]!
      .fixtureIdentityAuthority,
    undefined
  );
});

test("signedAt without explicit signed state is ignored", () => {
  const result = complianceCandidate({
    requirement: {
      type: "compliance_document",
    },
    signature: {
      signedAt: "2026-08-25T10:00:00Z",
    },
  });

  assert.equal(
    result.facts.some(
      (fact) =>
        fact.key.endsWith(
          ".signedAtPresent"
        )
    ),
    false
  );
});
