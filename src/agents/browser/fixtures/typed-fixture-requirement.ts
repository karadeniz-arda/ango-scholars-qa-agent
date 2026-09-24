import type {
  PlannerAcceptanceFixtureConstraint,
  PlannerTalentContractAcceptanceFixtureConstraint,
  PlannerTalentContractFixturePredicateKey,
} from "../../../planner/types.js";

export type FixtureRequirementAuthority =
  | "SOURCE_EXPLICIT"
  | "SOURCE_DERIVED_DETERMINISTIC"
  | "MODEL_SUGGESTED_UNTRUSTED"
  | "UNKNOWN";

export type TypedFixtureFamily =
  | "TALENT_CONTRACT"
  | "INVOICE"
  | "PROJECT"
  | "WORK_SETUP"
  | "DRAFT_JOB"
  | "ASSESSMENT";

export type TypedFixturePredicate = {
  path: string;
  operator: "EQ";
  value: string | number | boolean;
  authority: FixtureRequirementAuthority;
  obligationIds: string[];
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
};

export type TypedFixtureRelationship = {
  from: string;
  relation: string;
  to: string;
  authority: FixtureRequirementAuthority;
  obligationIds: string[];
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
};

export type TypedFixtureRequirement = {
  family: TypedFixtureFamily;
  persona?: "company_admin" | "talent";
  sourceCaseId: string;
  executionCaseId: string;
  predicates: TypedFixturePredicate[];
  relationships: TypedFixtureRelationship[];
  reuseEligibility: {
    sufficient: boolean;
    missingAuthority: string[];
  };
  creationEligibility: {
    sufficient: boolean;
    missingAuthority: string[];
  };
};

export type FixtureProvisionerConstructionContract = {
  family: TypedFixtureFamily;
  requiredConstructionPaths: string[];
  allowsRetention: boolean;
};

export type FixtureProvisioningEligibility = {
  eligible: boolean;
  missing: string[];
  reason:
    | "ELIGIBLE"
    | "SOURCE_REQUIREMENT_UNAVAILABLE"
    | "CONSTRUCTION_AUTHORITY_INCOMPLETE"
    | "PROVISIONER_FAMILY_MISMATCH";
};

const supportedPredicateKeys = new Set<PlannerTalentContractFixturePredicateKey>([
  "contract.accessibleToOwner",
  "contract.hasWorkSetups",
  "contract.documentMetadataPresent",
  "contract.workAuthorizationSnapshotPresent",
  "compliance.COMPLIANCE_DOCUMENT.present",
  "compliance.COMPLIANCE_DOCUMENT.signed",
  "compliance.COMPLIANCE_DOCUMENT.signedAtPresent",
  "compliance.COMPLIANCE_DOCUMENT.agreementVersionPresent",
  "compliance.COMPLIANCE_DOCUMENT.signatureValuePresent",
  "compliance.MASTER_SERVICE_AGREEMENT.present",
  "compliance.MASTER_SERVICE_AGREEMENT.signed",
  "compliance.MASTER_SERVICE_AGREEMENT.signedAtPresent",
  "compliance.MASTER_SERVICE_AGREEMENT.agreementVersionPresent",
  "compliance.MASTER_SERVICE_AGREEMENT.signatureValuePresent",
  "compliance.BACKGROUND_CHECK.present",
  "compliance.BACKGROUND_CHECK.statusPresent",
  "compliance.BACKGROUND_CHECK.issueDatePresent",
  "compliance.WORK_AUTHORIZATION.present",
  "compliance.TROLLEY_ONBOARDING_SETUP.present",
  "compliance.TROLLEY_ONBOARDING_SETUP.statusPresent",
  "compliance.DEEL_ONBOARDING_SETUP.present",
  "compliance.DEEL_ONBOARDING_SETUP.statusPresent",
  "compliance.setup.anyCompleted",
]);

function validRefs(
  refs: Array<{ sourceUnitId: string; sourceRef: string }> | undefined
): refs is Array<{ sourceUnitId: string; sourceRef: string }> {
  return Boolean(
    refs?.length &&
      refs.every((ref) => Boolean(ref.sourceUnitId && ref.sourceRef && ref.sourceRef !== "UNAVAILABLE"))
  );
}

function validIds(ids: string[] | undefined): ids is string[] {
  return Boolean(ids?.length && ids.every((id) => typeof id === "string" && id.trim().length > 0));
}

function talentContractConstraint(
  constraint: PlannerAcceptanceFixtureConstraint
): PlannerTalentContractAcceptanceFixtureConstraint | null {
  return constraint.fixtureKind === "talent-contract" && constraint.semantic.kind === "PREDICATES"
    ? constraint
    : null;
}

/**
 * Converts the already source-authorized planner constraint into a typed
 * prerequisite. It never parses free-form fixture prose and never grants
 * creation authority by itself.
 */
export function deriveTypedFixtureRequirement(args: {
  constraint: PlannerAcceptanceFixtureConstraint;
  persona?: "company_admin" | "talent";
}): TypedFixtureRequirement | null {
  const constraint = talentContractConstraint(args.constraint);
  if (
    !constraint ||
    constraint.authority !== "SOURCE_AUTHORIZED" ||
    !validIds(constraint.obligationIds) ||
    !validRefs(constraint.sourceUnitRefs) ||
    !constraint.sourceCaseId ||
    !constraint.executionCaseId ||
    !constraint.semantic.predicates.length
  ) {
    return null;
  }

  const predicates = constraint.semantic.predicates.map((predicate) => ({
    path: predicate.key,
    operator: "EQ" as const,
    value: predicate.expected,
    authority: "SOURCE_DERIVED_DETERMINISTIC" as const,
    obligationIds: [...predicate.obligationIds],
    sourceUnitRefs: predicate.sourceUnitRefs.map((ref) => ({ ...ref })),
  }));

  const invalid = predicates.some(
    (predicate) =>
      !supportedPredicateKeys.has(predicate.path as PlannerTalentContractFixturePredicateKey) ||
      !validIds(predicate.obligationIds) ||
      !validRefs(predicate.sourceUnitRefs)
  );
  if (invalid) return null;

  const sourceMissing = [
    ...(args.persona ? [] : ["persona"]),
  ];

  return {
    family: "TALENT_CONTRACT",
    ...(args.persona ? { persona: args.persona } : {}),
    sourceCaseId: constraint.sourceCaseId,
    executionCaseId: constraint.executionCaseId,
    predicates,
    relationships: [],
    reuseEligibility: {
      sufficient: sourceMissing.length === 0,
      missingAuthority: sourceMissing,
    },
    creationEligibility: {
      sufficient: false,
      missingAuthority: [
        ...sourceMissing,
        "relationship.contract.job",
        "relationship.contract.talent",
        "contract.creationOperation",
      ],
    },
  };
}

export function evaluateFixtureProvisioningEligibility(
  requirement: TypedFixtureRequirement | null,
  provisioner: FixtureProvisionerConstructionContract
): FixtureProvisioningEligibility {
  if (!requirement) {
    return {
      eligible: false,
      missing: ["source-authorized typed fixture requirement"],
      reason: "SOURCE_REQUIREMENT_UNAVAILABLE",
    };
  }
  if (requirement.family !== provisioner.family) {
    return {
      eligible: false,
      missing: [`provisioner.family=${requirement.family}`],
      reason: "PROVISIONER_FAMILY_MISMATCH",
    };
  }

  const knownPaths = new Set([
    ...requirement.predicates.map((predicate) => predicate.path),
    ...requirement.relationships.map((relationship) => relationship.from),
    ...requirement.relationships.map((relationship) => relationship.to),
  ]);
  const missing = provisioner.requiredConstructionPaths.filter(
    (path) => !knownPaths.has(path)
  );
  if (missing.length || !requirement.creationEligibility.sufficient || !provisioner.allowsRetention) {
    return {
      eligible: false,
      missing: [
        ...new Set([
          ...missing,
          ...requirement.creationEligibility.missingAuthority,
          ...(!provisioner.allowsRetention ? ["safe retention or exact cleanup"] : []),
        ]),
      ],
      reason: "CONSTRUCTION_AUTHORITY_INCOMPLETE",
    };
  }
  return { eligible: true, missing: [], reason: "ELIGIBLE" };
}
