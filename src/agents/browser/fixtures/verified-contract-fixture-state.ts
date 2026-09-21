import type {
  RuntimeEntityIdentity,
} from "../browser-deep-route-binding.js";

export type VerifiedFixtureStateValue =
  string | boolean | number;

export type VerifiedFixtureStateFact = {
  key: string;
  value: VerifiedFixtureStateValue;
  verification:
    | "EXACT_API_FIELD"
    | "EXACT_RELATED_RESOURCE";
  sourceRef?: string;
};

export type VerifiedContractFixtureCandidate = {
  identity: RuntimeEntityIdentity;
  facts: VerifiedFixtureStateFact[];
};

export type ContractFixtureStateRequirement = {
  key: string;
  expected: VerifiedFixtureStateValue;
  mandatory: boolean;
  source:
    | "PLAN_FIXTURE_REQUIREMENT"
    | "AUTHORITATIVE_SOURCE";
  sourceRef?: string;
};

export type ContractFixtureRequirementContext = {
  policy: "exact" | "compatible-state";
  exactEntityId?: string;
  requirements:
    ContractFixtureStateRequirement[];
};

export type ContractFixtureCandidateEvaluation = {
  entityId: string;
  status:
    | "COMPATIBLE"
    | "INCOMPATIBLE"
    | "STATE_UNKNOWN";
  reasons: string[];
};

export type VerifiedContractFixtureSelection = {
  status:
    | "SELECTED"
    | "NO_COMPATIBLE_ENTITY"
    | "AMBIGUOUS_ENTITY"
    | "ENTITY_STATE_UNVERIFIED";
  reason: string;
  selected?: VerifiedContractFixtureCandidate;
  selectionBasis?:
    | "UNIQUE_COMPATIBLE_CANDIDATE"
    | "EQUIVALENT_COMPATIBLE_CANDIDATE_SET";
  equivalentCandidateIds?: string[];
  evaluations:
    ContractFixtureCandidateEvaluation[];
};

export type VerifiedContractFixtureSelectionOptions = {
  allowEquivalentCompatibleCandidateSet?: boolean;
};

export type ContractRelatedState = {
  parentContractId?: string;
  parentOfferId?: string;
  contractDetail?: unknown;
  complianceRequirements?: unknown;
  complianceVerified?: boolean;
  hasWorkSetups?: boolean;
};

const MAX_FACTS = 64;
const MAX_KEY_LENGTH = 120;
const MAX_STRING_LENGTH = 160;
const CONTRACT_LIST_SOURCE =
  "/talents/{talentId}/contracts";
const CONTRACT_DETAIL_SOURCE =
  "/talents/{talentId}/contracts/{contractId}";
const COMPLIANCE_SOURCE =
  "/talents/{talentId}/offers/{offerId}/compliance/requirements";

function scalarId(
  value: unknown
): string | undefined {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (
    !normalized ||
    normalized.length > 200 ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(
      normalized
    )
  ) {
    return undefined;
  }

  return normalized;
}

function objectId(
  value: unknown
): string | undefined {
  if (
    value &&
    typeof value === "object"
  ) {
    const record = value as
      Record<string, unknown>;

    return scalarId(
      record.id ??
      record.contractId ??
      record._id
    );
  }

  return scalarId(value);
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return [];
  }

  const record = value as
    Record<string, unknown>;

  for (const key of [
    "data",
    "items",
    "results",
    "requirements",
  ]) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }

    if (
      record[key] &&
      typeof record[key] === "object"
    ) {
      const nested = items(record[key]);

      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

export function normalizeVerifiedFixtureStateFact(
  input: {
    key: unknown;
    value: unknown;
    verification: unknown;
    sourceRef?: unknown;
    valueKind?:
      | "boolean"
      | "enum"
      | "timestamp"
      | "number";
  }
): VerifiedFixtureStateFact | undefined {
  const key =
    typeof input.key === "string"
      ? input.key.trim()
      : "";
  const verification =
    input.verification ===
      "EXACT_API_FIELD" ||
    input.verification ===
      "EXACT_RELATED_RESOURCE"
      ? input.verification
      : undefined;

  if (
    !key ||
    key.length > MAX_KEY_LENGTH ||
    !/^[a-z][a-zA-Z0-9._]*$/.test(key) ||
    !verification ||
    input.value === null ||
    input.value === undefined ||
    typeof input.value === "object"
  ) {
    return undefined;
  }

  let value:
    VerifiedFixtureStateValue | undefined;

  if (input.valueKind === "boolean") {
    value =
      typeof input.value === "boolean"
        ? input.value
        : undefined;
  } else if (input.valueKind === "number") {
    value =
      typeof input.value === "number" &&
      Number.isFinite(input.value)
        ? input.value
        : undefined;
  } else if (
    input.valueKind === "timestamp"
  ) {
    if (
      typeof input.value === "string" &&
      input.value.length <=
        MAX_STRING_LENGTH &&
      Number.isFinite(
        Date.parse(input.value)
      )
    ) {
      value = new Date(
        input.value
      ).toISOString();
    }
  } else if (
    typeof input.value === "string"
  ) {
    const normalized =
      input.value.trim();

    if (
      normalized &&
      normalized.length <=
        MAX_STRING_LENGTH
    ) {
      value =
        input.valueKind === "enum"
          ? normalized
              .toUpperCase()
              .replace(/[-\s]+/g, "_")
          : normalized;
    }
  } else if (
    typeof input.value === "boolean" ||
    (
      typeof input.value === "number" &&
      Number.isFinite(input.value)
    )
  ) {
    value = input.value;
  }

  if (value === undefined) {
    return undefined;
  }

  const sourceRef =
    typeof input.sourceRef === "string" &&
    input.sourceRef.length <=
      MAX_STRING_LENGTH
      ? input.sourceRef
      : undefined;

  return {
    key,
    value,
    verification,
    ...(sourceRef ? { sourceRef } : {}),
  };
}

function addFact(
  facts: VerifiedFixtureStateFact[],
  input: Parameters<
    typeof normalizeVerifiedFixtureStateFact
  >[0]
): void {
  const fact =
    normalizeVerifiedFixtureStateFact(
      input
    );

  if (
    fact &&
    facts.length < MAX_FACTS &&
    !facts.some(
      (existing) =>
        existing.key === fact.key
    )
  ) {
    facts.push(fact);
  }
}

function normalizedEnum(
  value: unknown
): string | undefined {
  const fact =
    normalizeVerifiedFixtureStateFact({
      key: "value",
      value,
      verification: "EXACT_API_FIELD",
      valueKind: "enum",
    });

  return typeof fact?.value === "string"
    ? fact.value
    : undefined;
}

function requirementType(
  value: unknown
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as
    Record<string, unknown>;
  const requirement =
    record.requirement &&
    typeof record.requirement === "object"
      ? record.requirement as
          Record<string, unknown>
      : undefined;

  return normalizedEnum(
    requirement?.type ??
    record.type ??
    record.requirementType
  );
}

function explicitSignatureFacts(
  facts: VerifiedFixtureStateFact[],
  item: Record<string, unknown>,
  prefix: string
): void {
  const signature =
    item.signature &&
    typeof item.signature === "object"
      ? item.signature as
          Record<string, unknown>
      : undefined;
  const snapshot =
    signature?.signature &&
    typeof signature.signature ===
      "object"
      ? signature.signature as
          Record<string, unknown>
      : undefined;
  const accepted =
    snapshot?.accepted;
  const explicitSigned =
    typeof item.signed === "boolean"
      ? item.signed
      : typeof signature?.signed ===
          "boolean"
        ? signature.signed
        : typeof accepted === "boolean"
          ? accepted
          : [
                normalizedEnum(
                  item.signatureStatus
                ),
                normalizedEnum(
                  signature?.status
                ),
              ].some(
                (status) =>
                  status === "SIGNED" ||
                  status === "ACCEPTED"
              )
            ? true
            : undefined;

  if (
    typeof explicitSigned ===
    "boolean"
  ) {
    addFact(facts, {
      key: `${prefix}.signed`,
      value: explicitSigned,
      valueKind: "boolean",
      verification:
        "EXACT_RELATED_RESOURCE",
      sourceRef: COMPLIANCE_SOURCE,
    });
  }

  const signedAt =
    snapshot?.acceptedAt ??
    signature?.signedAt;

  for (
    const [key, value]
    of [
      ["signedAt", signedAt],
      [
        "agreementVersion",
        snapshot?.agreementVersion,
      ],
      [
        "signatureValue",
        snapshot?.signature,
      ],
    ] as const
  ) {
    if (explicitSigned !== true) {
      continue;
    }

    const present =
      typeof value === "string" &&
      value.trim().length > 0;

    if (
      key === "signedAt" &&
      present &&
      !Number.isFinite(
        Date.parse(value as string)
      )
    ) {
      continue;
    }

    if (value !== undefined) {
      addFact(facts, {
        key: `${prefix}.${key}Present`,
        value: present,
        valueKind: "boolean",
        verification:
          "EXACT_RELATED_RESOURCE",
        sourceRef: COMPLIANCE_SOURCE,
      });
    }
  }
}

function buildCandidateFacts(
  contract: Record<string, unknown>,
  related: ContractRelatedState
): VerifiedFixtureStateFact[] {
  const facts: VerifiedFixtureStateFact[] = [];

  addFact(facts, {
    key: "contract.accessibleToOwner",
    value: true,
    valueKind: "boolean",
    verification: "EXACT_API_FIELD",
    sourceRef: CONTRACT_LIST_SOURCE,
  });

  if (typeof related.hasWorkSetups === "boolean") {
    addFact(facts, {
      key: "contract.hasWorkSetups",
      value: related.hasWorkSetups,
      valueKind: "boolean",
      verification: "EXACT_RELATED_RESOURCE",
      sourceRef: "/talents/{talentId}/work-setups",
    });
  }

  addFact(facts, {
    key: "contract.status",
    value: contract.status,
    valueKind: "enum",
    verification: "EXACT_API_FIELD",
    sourceRef: CONTRACT_LIST_SOURCE,
  });
  addFact(facts, {
    key: "contract.providerType",
    value:
      contract.paymentProvider ??
      contract.providerType,
    valueKind: "enum",
    verification: "EXACT_API_FIELD",
    sourceRef: CONTRACT_LIST_SOURCE,
  });

  const detail =
    related.contractDetail &&
    typeof related.contractDetail ===
      "object"
      ? related.contractDetail as
          Record<string, unknown>
      : undefined;

  if (
    detail &&
    "workAuthorizationSnapshot" in detail
  ) {
    addFact(facts, {
      key:
        "contract.workAuthorizationSnapshotPresent",
      value:
        detail.workAuthorizationSnapshot !==
          null &&
        detail.workAuthorizationSnapshot !==
          undefined,
      valueKind: "boolean",
      verification: "EXACT_API_FIELD",
      sourceRef: CONTRACT_DETAIL_SOURCE,
    });
  }

  if (
    detail &&
    (
      "document" in detail ||
      "documentMetadata" in detail ||
      "signedDocument" in detail
    )
  ) {
    addFact(facts, {
      key: "contract.documentMetadataPresent",
      value: Boolean(
        detail.document ??
        detail.documentMetadata ??
        detail.signedDocument
      ),
      valueKind: "boolean",
      verification: "EXACT_API_FIELD",
      sourceRef: CONTRACT_DETAIL_SOURCE,
    });
  }

  if (!related.complianceVerified) {
    return facts.sort(
      (a, b) =>
        a.key.localeCompare(b.key)
    );
  }

  const complianceItems = items(
    related.complianceRequirements
  );
  const byType = new Map<
    string,
    Record<string, unknown>[]
  >();

  for (const rawItem of complianceItems) {
    if (
      !rawItem ||
      typeof rawItem !== "object"
    ) {
      continue;
    }

    const item = rawItem as
      Record<string, unknown>;
    const type = requirementType(item);

    if (!type) continue;

    const existing = byType.get(type) ?? [];
    existing.push(item);
    byType.set(type, existing);
  }

  const supportedTypes = [
    "COMPLIANCE_DOCUMENT",
    "MASTER_SERVICE_AGREEMENT",
    "BACKGROUND_CHECK",
    "WORK_AUTHORIZATION",
    "TROLLEY_ONBOARDING_SETUP",
    "DEEL_ONBOARDING_SETUP",
  ];

  for (const type of supportedTypes) {
    const typedItems = byType.get(type) ?? [];
    const prefix =
      `compliance.${type}`;

    addFact(facts, {
      key: `${prefix}.present`,
      value: typedItems.length > 0,
      valueKind: "boolean",
      verification:
        "EXACT_RELATED_RESOURCE",
      sourceRef: COMPLIANCE_SOURCE,
    });

    if (typedItems.length === 1) {
      const item = typedItems[0]!;

      addFact(facts, {
        key: `${prefix}.status`,
        value: item.status,
        valueKind: "enum",
        verification:
          "EXACT_RELATED_RESOURCE",
        sourceRef: COMPLIANCE_SOURCE,
      });
      if (normalizedEnum(item.status)) {
        addFact(facts, {
          key: `${prefix}.statusPresent`,
          value: true,
          valueKind: "boolean",
          verification:
            "EXACT_RELATED_RESOURCE",
          sourceRef: COMPLIANCE_SOURCE,
        });
      }
      if (
        type === "BACKGROUND_CHECK" &&
        (
          "issueDate" in item ||
          "issuedAt" in item ||
          "completedAt" in item
        )
      ) {
        const dateValue =
          item.issueDate ??
          item.issuedAt ??
          item.completedAt;

        addFact(facts, {
          key:
            `${prefix}.issueDatePresent`,
          value:
            typeof dateValue === "string" &&
            Number.isFinite(
              Date.parse(dateValue)
            ),
          valueKind: "boolean",
          verification:
            "EXACT_RELATED_RESOURCE",
          sourceRef: COMPLIANCE_SOURCE,
        });
      }
      explicitSignatureFacts(
        facts,
        item,
        prefix
      );

      const description =
        item.description &&
        typeof item.description ===
          "object"
          ? item.description as
              Record<string, unknown>
          : undefined;

      for (const component of [
        "idv",
        "paymentDetails",
        "taxDetails",
        "signup",
        "compliance",
        "contractSignature",
      ]) {
        addFact(facts, {
          key:
            `${prefix}.component.` +
            `${component}`,
          value: description?.[component],
          valueKind: "enum",
          verification:
            "EXACT_RELATED_RESOURCE",
          sourceRef: COMPLIANCE_SOURCE,
        });
      }
    }
  }

  const setupItems = [
    ...(byType.get(
      "TROLLEY_ONBOARDING_SETUP"
    ) ?? []),
    ...(byType.get(
      "DEEL_ONBOARDING_SETUP"
    ) ?? []),
  ];

  if (setupItems.length > 0) {
    const statuses = setupItems.map(
      (item) => normalizedEnum(item.status)
    );

    if (
      statuses.every(
        (status): status is string =>
          Boolean(status)
      )
    ) {
      addFact(facts, {
        key:
          "compliance.setup.anyCompleted",
        value: statuses.some(
          (status) =>
            status === "SATISFIED" ||
            status === "COMPLETED"
        ),
        valueKind: "boolean",
        verification:
          "EXACT_RELATED_RESOURCE",
        sourceRef: COMPLIANCE_SOURCE,
      });
    }
  }

  return facts.sort(
    (a, b) => a.key.localeCompare(b.key)
  );
}

export function adaptVerifiedContractFixtureCandidates(
  input: {
    contractsData: unknown;
    talentId: string;
    relatedStateByContractId?:
      ReadonlyMap<
        string,
        ContractRelatedState
      >;
    workSetupContractIds?: ReadonlySet<string>;
    workSetupJobIds?: ReadonlySet<string>;
  }
): VerifiedContractFixtureCandidate[] {
  const candidates:
    VerifiedContractFixtureCandidate[] = [];

  for (const rawContract of items(
    input.contractsData
  )) {
    if (
      !rawContract ||
      typeof rawContract !== "object"
    ) {
      continue;
    }

    const contract = rawContract as
      Record<string, unknown>;
    const entityId = objectId(contract);

    if (!entityId) continue;

    const suppliedRelated =
      input.relatedStateByContractId?.get(
        entityId
      ) ?? {};
    const contractOfferId = objectId(
      contract.offer ?? contract.offerId
    );
    const relationVerified =
      suppliedRelated.parentContractId ===
        entityId &&
      (
        suppliedRelated.parentOfferId ===
          undefined ||
        suppliedRelated.parentOfferId ===
          contractOfferId
      );
    const jobId = objectId(
      contract.job ?? contract.jobId
    );
    const hasVerifiedWorkSetupState =
      input.workSetupContractIds !== undefined &&
      input.workSetupJobIds !== undefined;
    const related = {
      ...(relationVerified
        ? suppliedRelated
        : {}),
      ...(hasVerifiedWorkSetupState
        ? {
            hasWorkSetups:
              input.workSetupContractIds!.has(entityId) ||
              Boolean(
                jobId && input.workSetupJobIds!.has(jobId)
              ),
          }
        : {}),
    };
    const facts = buildCandidateFacts(
      contract,
      related
    );

    candidates.push({
      identity: {
        entityKind: "contract",
        entityId,
        source: "AUTHENTICATED_GET",
        persona: "talent",
        identityVerified: true,
        ownershipVerified: true,
        ownerId: input.talentId,
        verifiedState: Object.fromEntries(
          facts.map((fact) => [
            fact.key,
            fact.value,
          ])
        ),
        verifiedStateKeys:
          facts.map((fact) => fact.key),
      },
      facts,
    });
  }

  return candidates.sort(
    (a, b) =>
      a.identity.entityId.localeCompare(
        b.identity.entityId
      )
  );
}

export async function discoverVerifiedContractFixtureCandidates(
  input: {
    contractsData: unknown;
    talentId: string;
    getJson: (
      path: string
    ) => Promise<unknown>;
    maxCandidates?: number;
    workSetupContractIds?: ReadonlySet<string>;
    workSetupJobIds?: ReadonlySet<string>;
  }
): Promise<VerifiedContractFixtureCandidate[]> {
  const contracts = items(
    input.contractsData
  ).filter(
    (value): value is
      Record<string, unknown> =>
      Boolean(
        value &&
        typeof value === "object" &&
        objectId(value)
      )
  );
  const limit = Math.min(
    Math.max(
      input.maxCandidates ?? 20,
      0
    ),
    20
  );
  const relatedStateByContractId =
    new Map<
      string,
      ContractRelatedState
    >();

  for (const contract of contracts
    .slice(0, limit)) {
    const contractId = objectId(contract)!;
    const offerId = objectId(
      contract.offer ??
      contract.offerId
    );
    const encodedTalentId =
      encodeURIComponent(input.talentId);
    const encodedContractId =
      encodeURIComponent(contractId);
    const related: ContractRelatedState = {
      parentContractId: contractId,
      ...(offerId
        ? { parentOfferId: offerId }
        : {}),
    };

    try {
      const contractDetail =
        await input.getJson(
          `/talents/${encodedTalentId}` +
          `/contracts/${encodedContractId}`
        );

      if (contractDetail !== undefined) {
        related.contractDetail =
          contractDetail;
      }
    } catch {
      // An unavailable related resource leaves its facts unknown.
    }

    if (offerId) {
      try {
        const complianceRequirements =
          await input.getJson(
            `/talents/${encodedTalentId}` +
            `/offers/${
              encodeURIComponent(offerId)
            }/compliance/requirements`
          );

        if (
          complianceRequirements !==
          undefined
        ) {
          related.complianceRequirements =
            complianceRequirements;
          related.complianceVerified =
            true;
        }
      } catch {
        // A failed GET must not be normalized as an empty resource.
      }
    }

    relatedStateByContractId.set(
      contractId,
      related
    );
  }

  return adaptVerifiedContractFixtureCandidates({
    contractsData: contracts.slice(
      0,
      limit
    ),
    talentId: input.talentId,
    relatedStateByContractId,
    ...(input.workSetupContractIds && input.workSetupJobIds
      ? {
          workSetupContractIds: input.workSetupContractIds,
          workSetupJobIds: input.workSetupJobIds,
        }
      : {}),
  });
}

function addRequirement(
  requirements:
    ContractFixtureStateRequirement[],
  requirement:
    ContractFixtureStateRequirement
): void {
  if (
    !requirements.some(
      (existing) =>
        existing.key === requirement.key &&
        existing.expected ===
          requirement.expected
    )
  ) {
    requirements.push(requirement);
  }
}

export function buildContractFixtureRequirementContext(
  testCase: {
    runtimeFixturePolicy?:
      | "exact"
      | "compatible-state";
    fixtureRequirements?: string[];
    fixtureIdentityAuthority?: {
      authority?: string;
      entityKind?: string;
      entityId?: string;
      sourceRef?: string;
    };
  },
  exactEntityId?: string
): ContractFixtureRequirementContext {
  const requirements:
    ContractFixtureStateRequirement[] = [];

  for (
    const [index, rawRequirement]
    of (
      testCase.fixtureRequirements ?? []
    ).entries()
  ) {
    const text = rawRequirement
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const sourceRef =
      `fixtureRequirements[${index}]`;
    const addBoolean = (
      key: string,
      expected = true
    ) => addRequirement(
      requirements,
      {
        key,
        expected,
        mandatory: true,
        source:
          "PLAN_FIXTURE_REQUIREMENT",
        sourceRef,
      }
    );

    if (text.includes("trolley")) {
      addBoolean(
        "compliance.TROLLEY_ONBOARDING_SETUP.present"
      );
    }
    if (text.includes("deel")) {
      addBoolean(
        "compliance.DEEL_ONBOARDING_SETUP.present"
      );
    }
    if (
      text.includes("setup") &&
      text.includes("completed")
    ) {
      addBoolean(
        "compliance.setup.anyCompleted"
      );
    }
    if (
      /\b(no|without|empty)\b/.test(text) &&
      /\bwork setups?\b/.test(text)
    ) {
      addBoolean(
        "contract.hasWorkSetups",
        false
      );
    }
    if (
      text.includes("signed") &&
      text.includes(
        "compliance document"
      )
    ) {
      addBoolean(
        "compliance.COMPLIANCE_DOCUMENT.present"
      );
      addBoolean(
        "compliance.COMPLIANCE_DOCUMENT.signed"
      );
    }
    if (
      text.includes("signed") &&
      (
        text.includes(
          "master service agreement"
        ) ||
        /\bmsa\b/.test(text)
      )
    ) {
      addBoolean(
        "compliance.MASTER_SERVICE_AGREEMENT.present"
      );
      addBoolean(
        "compliance.MASTER_SERVICE_AGREEMENT.signed"
      );
    }
    if (text.includes("background")) {
      addBoolean(
        "compliance.BACKGROUND_CHECK.present"
      );
    }
    if (
      text.includes("background") &&
      text.includes("status")
    ) {
      addBoolean(
        "compliance.BACKGROUND_CHECK.statusPresent"
      );
    }
    if (
      text.includes("background") &&
      (
        text.includes("date") ||
        text.includes("timestamp")
      )
    ) {
      addBoolean(
        "compliance.BACKGROUND_CHECK.issueDatePresent"
      );
    }
    if (
      text.includes("work authorization") ||
      text.includes("work_authorization")
    ) {
      addBoolean(
        "compliance.WORK_AUTHORIZATION.present"
      );
    }
    if (
      text.includes("work authorization") &&
      text.includes("snapshot")
    ) {
      addBoolean(
        "contract.workAuthorizationSnapshotPresent"
      );
    }
    if (
      text.includes("pdf") ||
      text.includes("document metadata") ||
      text.includes("signed download")
    ) {
      addBoolean(
        "contract.documentMetadataPresent"
      );
    }
  }

  const deterministicExactEntityId =
    exactEntityId ??
    (
      testCase.fixtureIdentityAuthority
        ?.authority ===
        "EXPLICIT_SOURCE_IDENTITY" &&
      testCase.fixtureIdentityAuthority
        ?.entityKind === "contract" &&
      testCase.fixtureIdentityAuthority
        ?.sourceRef ===
        "jira.explicitFixtureIdentity"
        ? testCase.fixtureIdentityAuthority
            .entityId
        : undefined
    );

  return {
    policy:
      testCase.runtimeFixturePolicy ===
      "compatible-state"
        ? "compatible-state"
        : "exact",
    ...(deterministicExactEntityId
      ? {
          exactEntityId:
            deterministicExactEntityId,
        }
      : {}),
    requirements,
  };
}

export function evaluateContractFixtureCandidate(
  candidate:
    VerifiedContractFixtureCandidate,
  context:
    ContractFixtureRequirementContext,
  expectedOwnerId?: string
): ContractFixtureCandidateEvaluation {
  const reasons: string[] = [];

  if (
    !candidate.identity.identityVerified ||
    candidate.identity.source ===
      "MODEL_PROPOSAL" ||
    candidate.identity.entityKind !==
      "contract" ||
    candidate.identity.persona !== "talent" ||
    !candidate.identity.ownershipVerified ||
    (
      expectedOwnerId !== undefined &&
      candidate.identity.ownerId !==
        expectedOwnerId
    )
  ) {
    return {
      entityId:
        candidate.identity.entityId,
      status: "INCOMPATIBLE",
      reasons: [
        "Candidate identity, persona, or ownership was not deterministically verified.",
      ],
    };
  }

  if (
    context.policy === "exact" &&
    candidate.identity.entityId !==
      context.exactEntityId
  ) {
    return {
      entityId:
        candidate.identity.entityId,
      status: "INCOMPATIBLE",
      reasons: [
        "Candidate does not match the explicitly required exact identity.",
      ],
    };
  }

  const facts = new Map(
    candidate.facts.map((fact) => [
      fact.key,
      fact.value,
    ])
  );
  let mismatch = false;
  let unknown = false;

  for (const requirement of
    context.requirements) {
    if (!requirement.mandatory) {
      continue;
    }

    if (!facts.has(requirement.key)) {
      unknown = true;
      reasons.push(
        `Required fact ${requirement.key} is unverified.`
      );
    } else if (
      facts.get(requirement.key) !==
      requirement.expected
    ) {
      mismatch = true;
      reasons.push(
        `Required fact ${requirement.key} definitively mismatched.`
      );
    }
  }

  if (mismatch) {
    return {
      entityId:
        candidate.identity.entityId,
      status: "INCOMPATIBLE",
      reasons,
    };
  }

  if (unknown) {
    return {
      entityId:
        candidate.identity.entityId,
      status: "STATE_UNKNOWN",
      reasons,
    };
  }

  return {
    entityId:
      candidate.identity.entityId,
    status: "COMPATIBLE",
    reasons: [
      "All mandatory fixture-state requirements were exactly verified.",
    ],
  };
}

export function selectVerifiedContractFixtureCandidate(
  candidates:
    VerifiedContractFixtureCandidate[],
  context:
    ContractFixtureRequirementContext,
  expectedOwnerId?: string,
  options: VerifiedContractFixtureSelectionOptions = {}
): VerifiedContractFixtureSelection {
  const sorted = [...candidates].sort(
    (a, b) => a.identity.entityId < b.identity.entityId
      ? -1
      : a.identity.entityId > b.identity.entityId
        ? 1
        : 0
  );

  if (
    context.policy === "exact" &&
    !context.exactEntityId
  ) {
    return {
      status: "NO_COMPATIBLE_ENTITY",
      reason:
        "Exact fixture policy supplied no authoritative exact contract identity; substitution is forbidden.",
      evaluations: sorted.map(
        (candidate) => ({
          entityId:
            candidate.identity.entityId,
          status: "INCOMPATIBLE",
          reasons: [
            "No exact identity was supplied.",
          ],
        })
      ),
    };
  }

  const evaluations = sorted.map(
    (candidate) =>
      evaluateContractFixtureCandidate(
        candidate,
        context,
        expectedOwnerId
      )
  );
  const compatible = evaluations.filter(
    (evaluation) =>
      evaluation.status === "COMPATIBLE"
  );

  if (compatible.length > 1) {
    const equivalentSetAuthorized =
      options.allowEquivalentCompatibleCandidateSet === true &&
      context.policy === "compatible-state" &&
      context.exactEntityId === undefined &&
      context.requirements.length > 0 &&
      context.requirements.every(
        (requirement) =>
          requirement.mandatory &&
          requirement.source ===
            "AUTHORITATIVE_SOURCE"
      ) &&
      evaluations.every(
        (evaluation) =>
          evaluation.status === "COMPATIBLE"
      ) &&
      new Set(
        sorted.map(
          (candidate) =>
            candidate.identity.entityId
        )
      ).size === sorted.length;

    if (equivalentSetAuthorized) {
      return {
        status: "SELECTED",
        reason:
          "Every discovered candidate exactly satisfies the complete source-authorized fixture constraint; the canonical verified entity ID is used only as a reproducible fixture representative and creates no acceptance proof.",
        selected: sorted[0]!,
        selectionBasis:
          "EQUIVALENT_COMPATIBLE_CANDIDATE_SET",
        equivalentCandidateIds: sorted.map(
          (candidate) =>
            candidate.identity.entityId
        ),
        evaluations,
      };
    }

    return {
      status: "AMBIGUOUS_ENTITY",
      reason:
        "Multiple verified contracts satisfy every mandatory fixture-state requirement.",
      evaluations,
    };
  }

  if (compatible.length === 1) {
    const selected = sorted.find(
      (candidate) =>
        candidate.identity.entityId ===
        compatible[0]!.entityId
    );

    return {
      status: "SELECTED",
      reason:
        "Exactly one verified contract satisfies every mandatory fixture-state requirement.",
      selected: selected!,
      selectionBasis:
        "UNIQUE_COMPATIBLE_CANDIDATE",
      evaluations,
    };
  }

  if (
    evaluations.some(
      (evaluation) =>
        evaluation.status ===
        "STATE_UNKNOWN"
    )
  ) {
    return {
      status:
        "ENTITY_STATE_UNVERIFIED",
      reason:
        "No contract is proven compatible because mandatory fixture-state facts remain unverified.",
      evaluations,
    };
  }

  return {
    status: "NO_COMPATIBLE_ENTITY",
    reason:
      "No verified contract satisfies every mandatory fixture-state requirement.",
    evaluations,
  };
}
