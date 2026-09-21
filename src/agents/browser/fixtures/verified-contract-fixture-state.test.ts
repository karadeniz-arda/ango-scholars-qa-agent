import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptVerifiedContractFixtureCandidates,
  buildContractFixtureRequirementContext,
  discoverVerifiedContractFixtureCandidates,
  evaluateContractFixtureCandidate,
  normalizeVerifiedFixtureStateFact,
  selectVerifiedContractFixtureCandidate,
  type ContractFixtureRequirementContext,
  type VerifiedContractFixtureCandidate,
  type VerifiedFixtureStateFact,
} from "./verified-contract-fixture-state.js";
import {
  selectTalentContractFixture,
} from "../browser-route-talent-contract.js";

const ownerId = "talent-owner";

function fact(
  key: string,
  value: string | boolean | number
): VerifiedFixtureStateFact {
  return {
    key,
    value,
    verification: "EXACT_API_FIELD",
    sourceRef:
      "/talents/{talentId}/contracts",
  };
}

function candidate(
  entityId: string,
  facts: VerifiedFixtureStateFact[] = [],
  identity: Partial<
    VerifiedContractFixtureCandidate["identity"]
  > = {}
): VerifiedContractFixtureCandidate {
  return {
    identity: {
      entityKind: "contract",
      entityId,
      source: "AUTHENTICATED_GET",
      persona: "talent",
      identityVerified: true,
      ownershipVerified: true,
      ownerId,
      ...identity,
    },
    facts,
  };
}

function context(
  requirements:
    ContractFixtureRequirementContext["requirements"],
  policy:
    ContractFixtureRequirementContext["policy"] =
      "compatible-state",
  exactEntityId?: string
): ContractFixtureRequirementContext {
  return {
    policy,
    requirements,
    ...(exactEntityId
      ? { exactEntityId }
      : {}),
  };
}

function required(
  key: string,
  expected: string | boolean | number,
  mandatory = true
) {
  return {
    key,
    expected,
    mandatory,
    source:
      "PLAN_FIXTURE_REQUIREMENT" as const,
    sourceRef: "fixtureRequirements[0]",
  };
}

function related(
  complianceRequirements: unknown,
  contractId = "contract-1",
  offerId = "offer-1"
) {
  return new Map([
    [
      contractId,
      {
        parentContractId: contractId,
        parentOfferId: offerId,
        complianceVerified: true,
        complianceRequirements,
      },
    ],
  ]);
}

function adapted(
  complianceRequirements: unknown
) {
  return adaptVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        offer: { id: "offer-1" },
        status: "active",
        paymentProvider: "trolley",
      },
    ],
    talentId: ownerId,
    relatedStateByContractId: related(
      complianceRequirements
    ),
  })[0]!;
}

test("1 exact API boolean fact is captured", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.ready",
      value: true,
      valueKind: "boolean",
      verification: "EXACT_API_FIELD",
    })?.value,
    true
  );
});

test("2 exact enum fact is normalized", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.status",
      value: "in progress",
      valueKind: "enum",
      verification: "EXACT_API_FIELD",
    })?.value,
    "IN_PROGRESS"
  );
});

test("3 exact timestamp fact is normalized", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.at",
      value: "2026-08-25T10:00:00Z",
      valueKind: "timestamp",
      verification: "EXACT_API_FIELD",
    })?.value,
    "2026-08-25T10:00:00.000Z"
  );
});

test("4 missing field stays unknown instead of false", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.ready",
      value: undefined,
      valueKind: "boolean",
      verification: "EXACT_API_FIELD",
    }),
    undefined
  );
});

test("5 malformed value stays unknown", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.at",
      value: "not-a-date",
      valueKind: "timestamp",
      verification: "EXACT_API_FIELD",
    }),
    undefined
  );
});

test("6 unsupported nested structure stays unknown", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.value",
      value: { secret: "not retained" },
      verification: "EXACT_API_FIELD",
    }),
    undefined
  );
});

test("7 fact source provenance is retained", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.ready",
      value: true,
      verification:
        "EXACT_RELATED_RESOURCE",
      sourceRef: "/bounded/{resource}",
    })?.sourceRef,
    "/bounded/{resource}"
  );
});

test("8 oversized fact output is rejected", () => {
  assert.equal(
    normalizeVerifiedFixtureStateFact({
      key: "state.value",
      value: "x".repeat(161),
      verification: "EXACT_API_FIELD",
    }),
    undefined
  );
});

test("9 candidates do not retain complete API objects", () => {
  const result = adaptVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        email: "private@example.invalid",
        address: { line: "private" },
      },
    ],
    talentId: ownerId,
  })[0]!;
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /private/);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["facts", "identity"]
  );
});

test("10 exact matching boolean is compatible", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [fact("ready", true)]),
      context([required("ready", true)]),
      ownerId
    ).status,
    "COMPATIBLE"
  );
});

test("11 exact enum match is compatible", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [fact("status", "SATISFIED")]),
      context([
        required("status", "SATISFIED"),
      ]),
      ownerId
    ).status,
    "COMPATIBLE"
  );
});

test("12 definitive mismatch is incompatible", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [fact("ready", false)]),
      context([required("ready", true)]),
      ownerId
    ).status,
    "INCOMPATIBLE"
  );
});

test("13 missing mandatory fact is state unknown", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a"),
      context([required("ready", true)]),
      ownerId
    ).status,
    "STATE_UNKNOWN"
  );
});

test("14 partial match is not compatible", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [fact("one", true)]),
      context([
        required("one", true),
        required("two", true),
      ]),
      ownerId
    ).status,
    "STATE_UNKNOWN"
  );
});

test("15 genuinely optional missing fact does not block", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a"),
      context([
        required("optional", true, false),
      ]),
      ownerId
    ).status,
    "COMPATIBLE"
  );
});

test("16 every mandatory fact must match", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [
        fact("one", true),
        fact("two", false),
      ]),
      context([
        required("one", true),
        required("two", true),
      ]),
      ownerId
    ).status,
    "INCOMPATIBLE"
  );
});

test("17 one compatible candidate is selected", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a", [fact("ready", true)])],
      context([required("ready", true)]),
      ownerId
    ).selected?.identity.entityId,
    "a"
  );
});

test("18 zero compatible candidates returns no compatible entity", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a", [fact("ready", false)])],
      context([required("ready", true)]),
      ownerId
    ).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("19 two compatible candidates remain ambiguous", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a"), candidate("b")],
      context([]),
      ownerId
    ).status,
    "AMBIGUOUS_ENTITY"
  );
});

test("20 first record never wins among compatible records", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("first"), candidate("second")],
      context([]),
      ownerId
    ).selected,
    undefined
  );
});

test("21 candidate order does not change selection output", () => {
  const a = candidate("a", [fact("ready", true)]);
  const b = candidate("b", [fact("ready", false)]);
  const requiredContext = context([
    required("ready", true),
  ]);

  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [a, b],
      requiredContext,
      ownerId
    ).selected?.identity.entityId,
    selectVerifiedContractFixtureCandidate(
      [b, a],
      requiredContext,
      ownerId
    ).selected?.identity.entityId
  );
});

test("22 model identity cannot enter selection", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a", [], { source: "MODEL_PROPOSAL" })],
      context([]),
      ownerId
    ).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("23 ownership mismatch is rejected", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [], { ownerId: "other" }),
      context([]),
      ownerId
    ).status,
    "INCOMPATIBLE"
  );
});

test("24 persona mismatch is rejected", () => {
  assert.equal(
    evaluateContractFixtureCandidate(
      candidate("a", [], { persona: "company_admin" }),
      context([]),
      ownerId
    ).status,
    "INCOMPATIBLE"
  );
});

test("25 exact identity and matching state is selected", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("exact", [fact("ready", true)])],
      context(
        [required("ready", true)],
        "exact",
        "exact"
      ),
      ownerId
    ).status,
    "SELECTED"
  );
});

test("26 exact policy without identity forbids substitution", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("compatible")],
      context([], "exact"),
      ownerId
    ).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("27 exact identity state mismatch is blocked", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("exact", [fact("ready", false)])],
      context(
        [required("ready", true)],
        "exact",
        "exact"
      ),
      ownerId
    ).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("28 compatible other identity cannot replace exact identity", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [
        candidate("exact", [fact("ready", false)]),
        candidate("other", [fact("ready", true)]),
      ],
      context(
        [required("ready", true)],
        "exact",
        "exact"
      ),
      ownerId
    ).selected,
    undefined
  );
});

test("29 compatible-state can reuse one fully verified contract", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("reuse", [fact("ready", true)])],
      context([required("ready", true)]),
      ownerId
    ).selected?.identity.entityId,
    "reuse"
  );
});

test("30 partially verified compatible-state contract cannot be reused", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("partial")],
      context([required("ready", true)]),
      ownerId
    ).status,
    "ENTITY_STATE_UNVERIFIED"
  );
});

test("31 multiple compatible-state contracts remain ambiguous", () => {
  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a"), candidate("b")],
      context([]),
      ownerId
    ).status,
    "AMBIGUOUS_ENTITY"
  );
});

test("source-authorized compatible-state equivalence selects a canonical verified identity", () => {
  const authoritativeContext = context([
    {
      ...required("ready", true),
      source: "AUTHORITATIVE_SOURCE",
    },
  ]);
  const forward =
    selectVerifiedContractFixtureCandidate(
      [
        candidate("contract-20", [fact("ready", true)]),
        candidate("contract-10", [fact("ready", true)]),
      ],
      authoritativeContext,
      ownerId,
      {
        allowEquivalentCompatibleCandidateSet:
          true,
      }
    );
  const reversed =
    selectVerifiedContractFixtureCandidate(
      [
        candidate("contract-10", [fact("ready", true)]),
        candidate("contract-20", [fact("ready", true)]),
      ],
      authoritativeContext,
      ownerId,
      {
        allowEquivalentCompatibleCandidateSet:
          true,
      }
    );

  assert.equal(forward.status, "SELECTED");
  assert.equal(
    forward.selectionBasis,
    "EQUIVALENT_COMPATIBLE_CANDIDATE_SET"
  );
  assert.equal(
    forward.selected?.identity.entityId,
    "contract-10"
  );
  assert.deepEqual(forward, reversed);
});

test("equivalence opt-in rejects incomplete authority and mixed candidate states", () => {
  const authoritativeContext = context([
    {
      ...required("ready", true),
      source: "AUTHORITATIVE_SOURCE",
    },
  ]);
  const options = {
    allowEquivalentCompatibleCandidateSet:
      true,
  };

  for (const candidates of [
    [
      candidate("a", [fact("ready", true)]),
      candidate("b"),
    ],
    [
      candidate("a", [fact("ready", true)]),
      candidate("b", [fact("ready", false)]),
    ],
    [
      candidate("a", [fact("ready", true)]),
      candidate("b", [fact("ready", true)], {
        identityVerified: false,
      }),
    ],
    [
      candidate("a", [fact("ready", true)]),
      candidate("b", [fact("ready", true)], {
        ownershipVerified: false,
      }),
    ],
  ]) {
    assert.notEqual(
      selectVerifiedContractFixtureCandidate(
        candidates,
        authoritativeContext,
        ownerId,
        options
      ).selectionBasis,
      "EQUIVALENT_COMPATIBLE_CANDIDATE_SET"
    );
  }

  assert.equal(
    selectVerifiedContractFixtureCandidate(
      [candidate("a"), candidate("b")],
      context([]),
      ownerId,
      options
    ).status,
    "AMBIGUOUS_ENTITY"
  );
});

test("32 compliance resource attaches to its parent contract", () => {
  assert.equal(
    adapted([
      {
        requirement: {
          type: "trolley_onboarding_setup",
        },
        status: "satisfied",
      },
    ]).facts.find(
      (entry) =>
        entry.key ===
        "compliance.TROLLEY_ONBOARDING_SETUP.present"
    )?.value,
    true
  );
});

test("33 resource from a different contract cannot satisfy a requirement", () => {
  const result = adaptVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        offer: { id: "offer-1" },
      },
    ],
    talentId: ownerId,
    relatedStateByContractId: new Map([
      [
        "contract-1",
        {
          parentContractId: "contract-2",
          parentOfferId: "offer-2",
          complianceVerified: true,
          complianceRequirements: [
            {
              requirement: {
                type: "trolley_onboarding_setup",
              },
            },
          ],
        },
      ],
    ]),
  })[0]!;

  assert.equal(
    result.facts.some(
      (entry) =>
        entry.key.includes("TROLLEY")
    ),
    false
  );
});

test("34 signed flag must be explicit", () => {
  const result = adapted([
    {
      requirement: {
        type: "compliance_document",
      },
      status: "satisfied",
      signature: {},
    },
  ]);

  assert.equal(
    result.facts.some(
      (entry) => entry.key.endsWith(".signed")
    ),
    false
  );
});

test("35 document existence alone does not imply signed", () => {
  const result = adapted([
    {
      requirement: {
        type: "compliance_document",
      },
      document: { exists: true },
    },
  ]);

  assert.equal(
    result.facts.some(
      (entry) => entry.key.endsWith(".signed")
    ),
    false
  );
});

test("36 completed timestamp alone does not imply unrelated status", () => {
  const result = adapted([
    {
      requirement: {
        type: "trolley_onboarding_setup",
      },
      completedAt: "2026-08-25T10:00:00Z",
    },
  ]);

  assert.equal(
    result.facts.some(
      (entry) =>
        entry.key ===
        "compliance.setup.anyCompleted"
    ),
    false
  );
});

test("37 same-contract multi-resource requirement is enforced", () => {
  const result = adapted([
    {
      requirement: {
        type: "trolley_onboarding_setup",
      },
      status: "satisfied",
    },
  ]);
  const evaluation =
    evaluateContractFixtureCandidate(
      result,
      context([
        required(
          "compliance.TROLLEY_ONBOARDING_SETUP.present",
          true
        ),
        required(
          "compliance.DEEL_ONBOARDING_SETUP.present",
          true
        ),
      ]),
      ownerId
    );

  assert.equal(
    evaluation.status,
    "INCOMPATIBLE"
  );
});

test("38 selected verified contract feeds the existing deep-route binder", () => {
  const verified =
    selectVerifiedContractFixtureCandidate(
      [candidate("contract-1")],
      context([]),
      ownerId
    );
  const result = selectTalentContractFixture(
    [
      {
        id: "contract-1",
        job: { title: "Verified job" },
      },
    ],
    [],
    "any",
    ownerId,
    {
      runtimeFixturePolicy:
        "compatible-state",
    },
    verified
  );

  assert.equal(
    result.deepRouteBinding.boundRoute?.route,
    "/talent/contracts/contract-1"
  );
});

test("39 unverified state does not produce a route", () => {
  const verified =
    selectVerifiedContractFixtureCandidate(
      [candidate("contract-1")],
      context([required("ready", true)]),
      ownerId
    );
  const result = selectTalentContractFixture(
    [{ id: "contract-1" }],
    [],
    "any",
    ownerId,
    {},
    verified
  );

  assert.equal(
    result.deepRouteBinding.boundRoute,
    undefined
  );
});

test("40 ambiguous fixture does not produce a route", () => {
  const verified =
    selectVerifiedContractFixtureCandidate(
      [candidate("a"), candidate("b")],
      context([]),
      ownerId
    );
  const result = selectTalentContractFixture(
    [{ id: "a" }, { id: "b" }],
    [],
    "any",
    ownerId,
    {},
    verified
  );

  assert.equal(
    result.deepRouteBinding.boundRoute,
    undefined
  );
});

test("41 deep-route navigation evidence is not created by fixture selection", () => {
  const result =
    selectVerifiedContractFixtureCandidate(
      [candidate("a")],
      context([]),
      ownerId
    );

  assert.equal(
    "deterministicEvidence" in result,
    false
  );
});

test("42 target verification cannot create PASS in fixture selection", () => {
  const result =
    selectVerifiedContractFixtureCandidate(
      [candidate("a")],
      context([]),
      ownerId
    );

  assert.equal("status" in result, true);
  assert.notEqual(
    (result as { verdict?: string }).verdict,
    "PASS"
  );
});

test("43 candidate metadata excludes sensitive compliance payload", () => {
  const result = adapted([
    {
      requirement: {
        type: "compliance_document",
      },
      email: "private@example.invalid",
      signedUrl: "https://signed.invalid/private",
      report: "sensitive findings",
    },
  ]);
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(
    serialized,
    /private|signed\.invalid|findings/
  );
});

test("44 discovery dependency exposes only a GET-shaped path callback", async () => {
  const paths: string[] = [];

  await discoverVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        offer: { id: "offer-1" },
      },
    ],
    talentId: ownerId,
    getJson: async (path) => {
      paths.push(path);
      return [];
    },
  });

  assert.equal(paths.length, 2);
  assert.equal(
    paths.every((path) => path.startsWith("/talents/")),
    true
  );
});

test("45 read-only resolver introduces no method parameter", () => {
  assert.equal(
    discoverVerifiedContractFixtureCandidates.length,
    1
  );
});

test("46 credential data is not part of candidate schema", () => {
  const result = candidate("a");

  assert.equal("token" in result, false);
  assert.equal("headers" in result, false);
  assert.equal("cookies" in result, false);
});

test("47 normalized selection output is deterministic", () => {
  const candidates = [
    candidate("z", [fact("ready", false)]),
    candidate("a", [fact("ready", true)]),
  ];
  const requiredContext = context([
    required("ready", true),
  ]);

  assert.deepEqual(
    selectVerifiedContractFixtureCandidate(
      candidates,
      requiredContext,
      ownerId
    ),
    selectVerifiedContractFixtureCandidate(
      [...candidates].reverse(),
      requiredContext,
      ownerId
    )
  );
});

test("requirement adapter derives Trolley, Deel, and completed predicates from canonical fixture requirements", () => {
  const result =
    buildContractFixtureRequirementContext({
      runtimeFixturePolicy:
        "compatible-state",
      fixtureRequirements: [
        "A contract containing a Trolley setup model.",
        "A contract containing a Deel setup model.",
        "At least one setup model is completed.",
      ],
    });

  assert.deepEqual(
    result.requirements.map(
      (requirement) => requirement.key
    ),
    [
      "compliance.TROLLEY_ONBOARDING_SETUP.present",
      "compliance.DEEL_ONBOARDING_SETUP.present",
      "compliance.setup.anyCompleted",
    ]
  );
});

test("missing detail fields stay unknown", () => {
  const result = adaptVerifiedContractFixtureCandidates({
    contractsData: [
      {
        id: "contract-1",
        offer: { id: "offer-1" },
      },
    ],
    talentId: ownerId,
    relatedStateByContractId: new Map([
      [
        "contract-1",
        {
          parentContractId: "contract-1",
          parentOfferId: "offer-1",
          contractDetail: {},
        },
      ],
    ]),
  })[0]!;

  assert.equal(
    result.facts.some(
      (entry) =>
        entry.key ===
        "contract.workAuthorizationSnapshotPresent"
    ),
    false
  );
});

test("authenticated contract discovery records owner accessibility without retaining payload", () => {
  const result = adaptVerifiedContractFixtureCandidates({
    contractsData: [{ id: "contract-1", privatePayload: "discarded" }],
    talentId: ownerId,
  })[0]!;
  assert.equal(
    result.facts.find((entry) => entry.key === "contract.accessibleToOwner")?.value,
    true
  );
  assert.equal(JSON.stringify(result).includes("privatePayload"), false);
});

test("Work Setup membership preserves verified true false and unknown states", () => {
  const contractsData = [
    { id: "contract-1", job: { id: "job-1" } },
    { id: "contract-2", job: { id: "job-2" } },
  ];
  const verified = adaptVerifiedContractFixtureCandidates({
    contractsData,
    talentId: ownerId,
    workSetupContractIds: new Set(["contract-1"]),
    workSetupJobIds: new Set<string>(),
  });
  assert.deepEqual(
    verified.map((item) => item.facts.find(
      (entry) => entry.key === "contract.hasWorkSetups"
    )?.value),
    [true, false]
  );
  const unknown = adaptVerifiedContractFixtureCandidates({
    contractsData: [contractsData[0]!],
    talentId: ownerId,
  })[0]!;
  assert.equal(
    unknown.facts.some((entry) => entry.key === "contract.hasWorkSetups"),
    false
  );
});

test("contract detail exposes only verified document and work-authorization presence", () => {
  const result = adaptVerifiedContractFixtureCandidates({
    contractsData: [{ id: "contract-1" }],
    talentId: ownerId,
    relatedStateByContractId: new Map([["contract-1", {
      parentContractId: "contract-1",
      contractDetail: {
        documentMetadata: { opaque: true },
        workAuthorizationSnapshot: { opaque: true },
      },
    }]]),
  })[0]!;
  assert.equal(
    result.facts.find((entry) => entry.key === "contract.documentMetadataPresent")?.value,
    true
  );
  assert.equal(
    result.facts.find((entry) => entry.key === "contract.workAuthorizationSnapshotPresent")?.value,
    true
  );
  assert.equal(JSON.stringify(result).includes("opaque"), false);
});

test("verified compliance resources expose signature background and provider presence facts", () => {
  const result = adapted([
    {
      requirement: { type: "master_service_agreement" },
      signed: true,
      signature: {
        signature: {
          acceptedAt: "2026-09-03T08:00:00Z",
          agreementVersion: "v1",
          signature: "present",
        },
      },
    },
    {
      requirement: { type: "background_check" },
      status: "completed",
      issueDate: "2026-09-01T08:00:00Z",
    },
    { requirement: { type: "work_authorization" } },
    { requirement: { type: "trolley_onboarding_setup" }, status: "pending" },
    { requirement: { type: "deel_onboarding_setup" }, status: "satisfied" },
  ]);
  const values = Object.fromEntries(result.facts.map((entry) => [entry.key, entry.value]));
  assert.equal(values["compliance.MASTER_SERVICE_AGREEMENT.signed"], true);
  assert.equal(values["compliance.MASTER_SERVICE_AGREEMENT.signedAtPresent"], true);
  assert.equal(values["compliance.MASTER_SERVICE_AGREEMENT.agreementVersionPresent"], true);
  assert.equal(values["compliance.MASTER_SERVICE_AGREEMENT.signatureValuePresent"], true);
  assert.equal(values["compliance.BACKGROUND_CHECK.statusPresent"], true);
  assert.equal(values["compliance.BACKGROUND_CHECK.issueDatePresent"], true);
  assert.equal(values["compliance.WORK_AUTHORIZATION.present"], true);
  assert.equal(values["compliance.TROLLEY_ONBOARDING_SETUP.present"], true);
  assert.equal(values["compliance.TROLLEY_ONBOARDING_SETUP.statusPresent"], true);
  assert.equal(values["compliance.DEEL_ONBOARDING_SETUP.present"], true);
  assert.equal(values["compliance.DEEL_ONBOARDING_SETUP.statusPresent"], true);
});
