export type FixtureProvisioningSupport =
  | "SUPPORTED"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type FixtureProvisioningVerification =
  | "EXACT"
  | "PARTIAL"
  | "UNAVAILABLE";

export type FixtureProvisioningOwnership =
  | "STRONG"
  | "WEAK"
  | "UNAVAILABLE";

export type FixtureProvisioningCleanup =
  | "EXACT_DELETE"
  | "EXACT_RESTORE"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type FixtureProvisioningOperation = {
  purpose:
    | "CREATE"
    | "VERIFY"
    | "CLEANUP"
    | "PROVIDER_HANDOFF"
    | "UNSAFE_TRANSITION";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  pathTemplate: string;
  resourceType: string;
  requestIdentityInputs: string[];
  responseIdentityOutput:
    | "EXPLICIT_RESOURCE_ID"
    | "NO_RESOURCE_ID"
    | "UNSPECIFIED";
  sourceRef: string;
};

export type FixtureProvisioningSourceModel = {
  fixtureKind: string;
  create: FixtureProvisioningSupport;
  verify: FixtureProvisioningVerification;
  ownership: FixtureProvisioningOwnership;
  cleanup: FixtureProvisioningCleanup;
  cleanupVerification:
    FixtureProvisioningVerification;
  mutationTargetScoped: boolean;
  createdIdentityCaptured: boolean;
  boundedPreStateAvailable: boolean;
  exactRestoreAvailable: boolean;
  thirdPartySideEffect: boolean;
  sensitiveWorkflow: boolean;
  irreversibleStatusTransition: boolean;
  operations:
    FixtureProvisioningOperation[];
  reasons: string[];
};

export type FixtureProvisioningFeasibility =
  FixtureProvisioningSourceModel & {
    safeCandidate: boolean;
    blockingReasons: string[];
  };

export type FixtureMutationOwnershipContract = {
  fixtureKind: string;
  parentEntityId: string;
  ownedResourceId: string;
  ownedResourceType: string;
  creationOperation:
    FixtureProvisioningOperation;
  preState: Record<
    string,
    string | number | boolean | null
  >;
  expectedPostState: Record<
    string,
    string | number | boolean | null
  >;
  cleanupOperation:
    FixtureProvisioningOperation;
  expectedCleanupState: Record<
    string,
    string | number | boolean | null
  >;
  createdDuringRun: true;
  verificationSource: string;
};

export type FixtureLifecycleState =
  | "PRECHECK"
  | "CREATE_REQUESTED"
  | "CREATED"
  | "POST_STATE_VERIFIED"
  | "IN_USE"
  | "CLEANUP_REQUESTED"
  | "CLEANED"
  | "ABSENCE_VERIFIED"
  | "CREATE_FAILED"
  | "POST_VERIFY_FAILED"
  | "CLEANUP_FAILED"
  | "CLEANUP_VERIFY_FAILED";

export type FixtureLifecycleEvent =
  | "REQUEST_CREATE"
  | "CREATE_SUCCEEDED"
  | "CREATE_REJECTED"
  | "POST_VERIFY_SUCCEEDED"
  | "POST_VERIFY_REJECTED"
  | "BEGIN_USE"
  | "REQUEST_CLEANUP"
  | "CLEANUP_SUCCEEDED"
  | "CLEANUP_REJECTED"
  | "CLEANUP_VERIFY_SUCCEEDED"
  | "CLEANUP_VERIFY_REJECTED";

const SOURCE_ROOT =
  "../ango-scholars-client/src/api/data/scholars-server.ts";

export const contractFixtureProvisioningSourceModels:
  readonly FixtureProvisioningSourceModel[] = [
  {
    fixtureKind:
      "CONTRACT_WORK_AUTHORIZATION_SNAPSHOT",
    create: "UNSUPPORTED",
    verify: "PARTIAL",
    ownership: "UNAVAILABLE",
    cleanup: "UNSUPPORTED",
    cleanupVerification:
      "UNAVAILABLE",
    mutationTargetScoped: true,
    createdIdentityCaptured: false,
    boundedPreStateAvailable: true,
    exactRestoreAvailable: false,
    thirdPartySideEffect: false,
    sensitiveWorkflow: true,
    irreversibleStatusTransition: true,
    operations: [
      {
        purpose: "CREATE",
        method: "POST",
        pathTemplate:
          "/talents/{talentId}/work-authorization",
        resourceType:
          "TalentWorkAuthorization",
        requestIdentityInputs: [
          "talentId",
        ],
        responseIdentityOutput:
          "UNSPECIFIED",
        sourceRef:
          `${SOURCE_ROOT}:1080`,
      },
      {
        purpose: "VERIFY",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/work-authorization/latest",
        resourceType:
          "TalentWorkAuthorization",
        requestIdentityInputs: [
          "talentId",
        ],
        responseIdentityOutput:
          "EXPLICIT_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1096`,
      },
      {
        purpose: "VERIFY",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/contracts/{contractId}",
        resourceType: "Contract",
        requestIdentityInputs: [
          "talentId",
          "contractId",
        ],
        responseIdentityOutput:
          "EXPLICIT_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:5120`,
      },
      {
        purpose:
          "UNSAFE_TRANSITION",
        method: "POST",
        pathTemplate:
          "/talents/{talentId}/offers/{id}/respond",
        resourceType: "Offer",
        requestIdentityInputs: [
          "talentId",
          "id",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:799`,
      },
    ],
    reasons: [
      "The documented POST creates a current talent work-authorization record, not a snapshot on an existing contract.",
      "The generated operation documents no successful response identity for the create call.",
      "No delete or exact restore operation exists for a created work-authorization record or contract snapshot.",
      "Populating a snapshot on a new contract would require accepting an offer, an irreversible business transition that does not return an exact created contract identity in the documented response.",
      "The payload contains legal confirmations and a digital signature.",
    ],
  },
  {
    fixtureKind:
      "CONTRACT_PROVIDER_SETUP_COMPLETION",
    create: "UNSUPPORTED",
    verify: "EXACT",
    ownership: "UNAVAILABLE",
    cleanup: "UNSUPPORTED",
    cleanupVerification:
      "UNAVAILABLE",
    mutationTargetScoped: false,
    createdIdentityCaptured: false,
    boundedPreStateAvailable: true,
    exactRestoreAvailable: false,
    thirdPartySideEffect: true,
    sensitiveWorkflow: true,
    irreversibleStatusTransition: true,
    operations: [
      {
        purpose:
          "PROVIDER_HANDOFF",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/trolley/widget-url",
        resourceType:
          "TrolleyWidgetUrl",
        requestIdentityInputs: [
          "talentId",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1303`,
      },
      {
        purpose:
          "PROVIDER_HANDOFF",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/deel/invite-url",
        resourceType:
          "DeelInviteUrl",
        requestIdentityInputs: [
          "talentId",
          "offerId",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1263`,
      },
      {
        purpose: "VERIFY",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/offers/{offerId}/compliance/requirements",
        resourceType:
          "ComplianceRequirementWithStatusDto",
        requestIdentityInputs: [
          "talentId",
          "offerId",
        ],
        responseIdentityOutput:
          "EXPLICIT_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1719`,
      },
      {
        purpose: "VERIFY",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/trolley/status",
        resourceType:
          "TrolleyStatusDto",
        requestIdentityInputs: [
          "talentId",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1323`,
      },
      {
        purpose:
          "UNSAFE_TRANSITION",
        method: "POST",
        pathTemplate:
          "/companies/{companyId}/trolley/expire-verifications",
        resourceType:
          "TrolleyVerification",
        requestIdentityInputs: [
          "companyId",
          "talentId",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1363`,
      },
    ],
    reasons: [
      "No product API creates or locally completes Trolley or Deel setup state.",
      "Completion is driven through signed provider widgets, invite URLs, and external webhooks.",
      "The only company Trolley mutation expires verification and cannot create or restore completed setup.",
      "No exact cleanup operation exists for provider onboarding state.",
    ],
  },
  {
    fixtureKind:
      "CONTRACT_BACKGROUND_CHECK",
    create: "SUPPORTED",
    verify: "PARTIAL",
    ownership: "WEAK",
    cleanup: "UNSUPPORTED",
    cleanupVerification:
      "UNAVAILABLE",
    mutationTargetScoped: true,
    createdIdentityCaptured: true,
    boundedPreStateAvailable: true,
    exactRestoreAvailable: false,
    thirdPartySideEffect: true,
    sensitiveWorkflow: true,
    irreversibleStatusTransition: true,
    operations: [
      {
        purpose: "CREATE",
        method: "POST",
        pathTemplate:
          "/talents/{talentId}/offers/{offerId}/compliance/requirements/{requirementId}/background-check/start",
        resourceType:
          "ComplianceBackgroundCheck",
        requestIdentityInputs: [
          "talentId",
          "offerId",
          "requirementId",
        ],
        responseIdentityOutput:
          "EXPLICIT_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1753`,
      },
      {
        purpose: "VERIFY",
        method: "GET",
        pathTemplate:
          "/talents/{talentId}/offers/{offerId}/compliance/requirements",
        resourceType:
          "ComplianceRequirementWithStatusDto",
        requestIdentityInputs: [
          "talentId",
          "offerId",
        ],
        responseIdentityOutput:
          "NO_RESOURCE_ID",
        sourceRef:
          `${SOURCE_ROOT}:1719`,
      },
    ],
    reasons: [
      "The start operation explicitly creates a Certn background-check workflow and returns a screening identity.",
      "The returned screening object does not expose the originating offer or compliance-requirement identity for exact parent verification.",
      "The read endpoint exposes aggregate compliance state, not exact screening identity and issue-date verification.",
      "No delete, cancel, or exact restore endpoint is documented.",
      "The workflow has sensitive third-party screening side effects.",
    ],
  },
] as const;

export function evaluateFixtureProvisioningFeasibility(
  model:
    FixtureProvisioningSourceModel
): FixtureProvisioningFeasibility {
  const blockingReasons: string[] = [];

  if (model.create !== "SUPPORTED") {
    blockingReasons.push(
      "A source-backed create operation for the required fixture state is unavailable."
    );
  }
  if (model.verify !== "EXACT") {
    blockingReasons.push(
      "Exact post-create state verification is unavailable."
    );
  }
  if (!model.mutationTargetScoped) {
    blockingReasons.push(
      "The mutation cannot be scoped to one verified parent entity."
    );
  }
  if (
    model.ownership !== "STRONG" ||
    !model.createdIdentityCaptured
  ) {
    blockingReasons.push(
      "The created mutation cannot establish explicit run ownership from a returned resource identity."
    );
  }
  if (
    ![
      "EXACT_DELETE",
      "EXACT_RESTORE",
    ].includes(model.cleanup)
  ) {
    blockingReasons.push(
      "No exact owned cleanup operation is available."
    );
  }
  if (
    model.cleanupVerification !==
    "EXACT"
  ) {
    blockingReasons.push(
      "Exact cleanup verification is unavailable."
    );
  }
  if (
    model.cleanup === "EXACT_RESTORE" &&
    (
      !model.boundedPreStateAvailable ||
      !model.exactRestoreAvailable
    )
  ) {
    blockingReasons.push(
      "An update lifecycle lacks bounded pre-state and exact restoration semantics."
    );
  }
  if (model.thirdPartySideEffect) {
    blockingReasons.push(
      "The lifecycle triggers an external provider side effect."
    );
  }
  if (model.sensitiveWorkflow) {
    blockingReasons.push(
      "The lifecycle processes sensitive legal, financial, or screening state."
    );
  }
  if (model.irreversibleStatusTransition) {
    blockingReasons.push(
      "The lifecycle includes an irreversible or externally controlled status transition."
    );
  }

  return {
    ...model,
    safeCandidate:
      blockingReasons.length === 0,
    blockingReasons,
  };
}

export function selectSafeFixtureProvisioningCandidate(
  models:
    FixtureProvisioningSourceModel[]
): {
  status:
    | "SELECTED"
    | "NO_SAFE_CANDIDATE"
    | "AMBIGUOUS_SAFE_CANDIDATE";
  selected?:
    FixtureProvisioningFeasibility;
  evaluations:
    FixtureProvisioningFeasibility[];
} {
  const evaluations = [...models]
    .map(
      evaluateFixtureProvisioningFeasibility
    )
    .sort(
      (left, right) =>
        left.fixtureKind.localeCompare(
          right.fixtureKind
        )
    );
  const safe = evaluations.filter(
    (evaluation) =>
      evaluation.safeCandidate
  );

  if (safe.length === 1) {
    return {
      status: "SELECTED",
      selected: safe[0]!,
      evaluations,
    };
  }

  return {
    status:
      safe.length === 0
        ? "NO_SAFE_CANDIDATE"
        : "AMBIGUOUS_SAFE_CANDIDATE",
    evaluations,
  };
}

function boundedIdentifier(
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

export function buildFixtureMutationOwnershipContract(
  input: {
    fixtureKind: string;
    parentEntityId: unknown;
    returnedResourceId: unknown;
    returnedResourceType: string;
    expectedResourceType: string;
    returnedParentEntityId: unknown;
    creationOperation:
      FixtureProvisioningOperation;
    preState?: Record<
      string,
      string | number | boolean | null
    >;
    expectedPostState: Record<
      string,
      string | number | boolean | null
    >;
    cleanupOperation?:
      FixtureProvisioningOperation;
    expectedCleanupState?: Record<
      string,
      string | number | boolean | null
    >;
    createdDuringRun: boolean;
    verificationSource?: string;
  }
): FixtureMutationOwnershipContract | undefined {
  const parentEntityId =
    boundedIdentifier(
      input.parentEntityId
    );
  const returnedParentEntityId =
    boundedIdentifier(
      input.returnedParentEntityId
    );
  const ownedResourceId =
    boundedIdentifier(
      input.returnedResourceId
    );

  if (
    !input.createdDuringRun ||
    !parentEntityId ||
    returnedParentEntityId !==
      parentEntityId ||
    !ownedResourceId ||
    input.returnedResourceType !==
      input.expectedResourceType ||
    input.creationOperation
      .responseIdentityOutput !==
      "EXPLICIT_RESOURCE_ID" ||
    !input.cleanupOperation ||
    !input.expectedCleanupState ||
    !input.verificationSource
  ) {
    return undefined;
  }

  if (
    input.cleanupOperation.purpose !==
      "CLEANUP" ||
    ![
      "DELETE",
      "POST",
      "PATCH",
      "PUT",
    ].includes(
      input.cleanupOperation.method
    )
  ) {
    return undefined;
  }

  return {
    fixtureKind: input.fixtureKind,
    parentEntityId,
    ownedResourceId,
    ownedResourceType:
      input.expectedResourceType,
    creationOperation:
      input.creationOperation,
    preState: input.preState ?? {},
    expectedPostState:
      input.expectedPostState,
    cleanupOperation:
      input.cleanupOperation,
    expectedCleanupState:
      input.expectedCleanupState,
    createdDuringRun: true,
    verificationSource:
      input.verificationSource,
  };
}

export function provisioningPermissionsAllowMutation(
  env: Record<string, string | undefined>
): boolean {
  const enabled = (key: string) =>
    String(env[key] ?? "")
      .toLowerCase() === "true";

  return (
    enabled(
      "QA_ALLOW_BROWSER_FIXTURE_PROVISIONING"
    ) &&
    enabled("QA_ALLOW_API_MUTATIONS") &&
    enabled("QA_REQUIRE_FIXTURE_CLEANUP")
  );
}

const transitions: Readonly<
  Partial<
    Record<
      FixtureLifecycleState,
      Partial<
        Record<
          FixtureLifecycleEvent,
          FixtureLifecycleState
        >
      >
    >
  >
> = {
  PRECHECK: {
    REQUEST_CREATE: "CREATE_REQUESTED",
  },
  CREATE_REQUESTED: {
    CREATE_SUCCEEDED: "CREATED",
    CREATE_REJECTED: "CREATE_FAILED",
  },
  CREATED: {
    POST_VERIFY_SUCCEEDED:
      "POST_STATE_VERIFIED",
    POST_VERIFY_REJECTED:
      "POST_VERIFY_FAILED",
    REQUEST_CLEANUP:
      "CLEANUP_REQUESTED",
  },
  POST_STATE_VERIFIED: {
    BEGIN_USE: "IN_USE",
    REQUEST_CLEANUP:
      "CLEANUP_REQUESTED",
  },
  IN_USE: {
    REQUEST_CLEANUP:
      "CLEANUP_REQUESTED",
  },
  POST_VERIFY_FAILED: {
    REQUEST_CLEANUP:
      "CLEANUP_REQUESTED",
  },
  CLEANUP_REQUESTED: {
    CLEANUP_SUCCEEDED: "CLEANED",
    CLEANUP_REJECTED: "CLEANUP_FAILED",
  },
  CLEANED: {
    CLEANUP_VERIFY_SUCCEEDED:
      "ABSENCE_VERIFIED",
    CLEANUP_VERIFY_REJECTED:
      "CLEANUP_VERIFY_FAILED",
  },
};

export function transitionFixtureLifecycle(
  state: FixtureLifecycleState,
  event: FixtureLifecycleEvent
): FixtureLifecycleState | undefined {
  return transitions[state]?.[event];
}
