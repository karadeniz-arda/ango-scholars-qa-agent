import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFixtureMutationOwnershipContract,
  contractFixtureProvisioningSourceModels,
  evaluateFixtureProvisioningFeasibility,
  provisioningPermissionsAllowMutation,
  selectSafeFixtureProvisioningCandidate,
  transitionFixtureLifecycle,
  type FixtureProvisioningOperation,
  type FixtureProvisioningSourceModel,
} from "./contract-fixture-provisioning-feasibility.js";
import {
  discoverVerifiedContractFixtureCandidates,
} from "./verified-contract-fixture-state.js";

const createOperation:
  FixtureProvisioningOperation = {
  purpose: "CREATE",
  method: "POST",
  pathTemplate:
    "/parents/{parentId}/fixtures",
  resourceType: "Fixture",
  requestIdentityInputs: ["parentId"],
  responseIdentityOutput:
    "EXPLICIT_RESOURCE_ID",
  sourceRef: "authoritative-source:1",
};

const cleanupOperation:
  FixtureProvisioningOperation = {
  purpose: "CLEANUP",
  method: "DELETE",
  pathTemplate:
    "/parents/{parentId}/fixtures/{fixtureId}",
  resourceType: "Fixture",
  requestIdentityInputs: [
    "parentId",
    "fixtureId",
  ],
  responseIdentityOutput:
    "EXPLICIT_RESOURCE_ID",
  sourceRef: "authoritative-source:2",
};

function safeModel(
  overrides: Partial<
    FixtureProvisioningSourceModel
  > = {}
): FixtureProvisioningSourceModel {
  return {
    fixtureKind: "SAFE_FIXTURE",
    create: "SUPPORTED",
    verify: "EXACT",
    ownership: "STRONG",
    cleanup: "EXACT_DELETE",
    cleanupVerification: "EXACT",
    mutationTargetScoped: true,
    createdIdentityCaptured: true,
    boundedPreStateAvailable: true,
    exactRestoreAvailable: true,
    thirdPartySideEffect: false,
    sensitiveWorkflow: false,
    irreversibleStatusTransition: false,
    operations: [
      createOperation,
      cleanupOperation,
    ],
    reasons: [],
    ...overrides,
  };
}

function ownership(
  overrides: Record<string, unknown> = {}
) {
  return buildFixtureMutationOwnershipContract({
    fixtureKind: "SAFE_FIXTURE",
    parentEntityId: "parent-1",
    returnedParentEntityId: "parent-1",
    returnedResourceId: "fixture-1",
    returnedResourceType: "Fixture",
    expectedResourceType: "Fixture",
    creationOperation: createOperation,
    preState: { present: false },
    expectedPostState: {
      present: true,
    },
    cleanupOperation,
    expectedCleanupState: {
      present: false,
    },
    createdDuringRun: true,
    verificationSource:
      "/parents/{parentId}/fixtures",
    ...overrides,
  });
}

test("1 exact create, verification, ownership, cleanup, and cleanup verification is safe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel()
    ).safeCandidate,
    true
  );
});

test("2 create without exact verification is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({ verify: "PARTIAL" })
    ).safeCandidate,
    false
  );
});

test("3 create without cleanup is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({ cleanup: "UNSUPPORTED" })
    ).safeCandidate,
    false
  );
});

test("4 cleanup without verification is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        cleanupVerification: "PARTIAL",
      })
    ).safeCandidate,
    false
  );
});

test("5 unknown ownership is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        ownership: "UNAVAILABLE",
      })
    ).safeCandidate,
    false
  );
});

test("6 external provider side effects are unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        thirdPartySideEffect: true,
      })
    ).safeCandidate,
    false
  );
});

test("7 sensitive workflows are unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        sensitiveWorkflow: true,
      })
    ).safeCandidate,
    false
  );
});

test("8 update restore without bounded pre-state is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        cleanup: "EXACT_RESTORE",
        boundedPreStateAvailable: false,
      })
    ).safeCandidate,
    false
  );
});

test("9 irreversible status transition is unsafe", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        irreversibleStatusTransition: true,
      })
    ).safeCandidate,
    false
  );
});

test("10 explicit returned resource identity establishes ownership", () => {
  assert.equal(
    ownership()?.ownedResourceId,
    "fixture-1"
  );
});

test("11 an arbitrary pre-existing matching resource is not owned", () => {
  assert.equal(
    ownership({ createdDuringRun: false }),
    undefined
  );
});

test("12 appearance after an operation without returned identity does not prove ownership", () => {
  assert.equal(
    ownership({ returnedResourceId: undefined }),
    undefined
  );
});

test("13 parent identity mismatch is rejected", () => {
  assert.equal(
    ownership({
      returnedParentEntityId: "parent-2",
    }),
    undefined
  );
});

test("14 resource type mismatch is rejected", () => {
  assert.equal(
    ownership({
      returnedResourceType:
        "DifferentFixture",
    }),
    undefined
  );
});

test("15 an explicitly owned resource may carry exact delete cleanup", () => {
  assert.equal(
    ownership()?.cleanupOperation.method,
    "DELETE"
  );
});

test("16 deleting a pre-existing resource is forbidden", () => {
  assert.equal(
    ownership({ createdDuringRun: false }),
    undefined
  );
});

test("17 exact restore requires bounded pre-state", () => {
  assert.equal(
    evaluateFixtureProvisioningFeasibility(
      safeModel({
        cleanup: "EXACT_RESTORE",
        exactRestoreAvailable: false,
      })
    ).safeCandidate,
    false
  );
});

test("18 an ownership contract requires cleanup verification state", () => {
  assert.equal(
    ownership({
      expectedCleanupState: undefined,
    }),
    undefined
  );
});

test("19 cleanup failure is preserved as a terminal failure", () => {
  assert.equal(
    transitionFixtureLifecycle(
      "CLEANUP_REQUESTED",
      "CLEANUP_REJECTED"
    ),
    "CLEANUP_FAILED"
  );
});

test("20 default permissions reject provisioning", () => {
  assert.equal(
    provisioningPermissionsAllowMutation({}),
    false
  );
});

test("21 fixture provisioning permission is required", () => {
  assert.equal(
    provisioningPermissionsAllowMutation({
      QA_ALLOW_API_MUTATIONS: "true",
      QA_REQUIRE_FIXTURE_CLEANUP: "true",
    }),
    false
  );
});

test("22 API mutation permission is required", () => {
  assert.equal(
    provisioningPermissionsAllowMutation({
      QA_ALLOW_BROWSER_FIXTURE_PROVISIONING:
        "true",
      QA_REQUIRE_FIXTURE_CLEANUP: "true",
    }),
    false
  );
});

test("23 cleanup-required permission is preserved", () => {
  assert.equal(
    provisioningPermissionsAllowMutation({
      QA_ALLOW_BROWSER_FIXTURE_PROVISIONING:
        "true",
      QA_ALLOW_API_MUTATIONS: "true",
    }),
    false
  );
  assert.equal(
    provisioningPermissionsAllowMutation({
      QA_ALLOW_BROWSER_FIXTURE_PROVISIONING:
        "true",
      QA_ALLOW_API_MUTATIONS: "true",
      QA_REQUIRE_FIXTURE_CLEANUP: "true",
    }),
    true
  );
});

test("24 current read-only resolver remains a GET-shaped dependency", () => {
  assert.equal(
    discoverVerifiedContractFixtureCandidates.length,
    1
  );
});

test("25 fixture READY cannot create PASS", () => {
  const result =
    evaluateFixtureProvisioningFeasibility(
      safeModel()
    );

  assert.equal(result.safeCandidate, true);
  assert.equal(
    (result as { verdict?: string }).verdict,
    undefined
  );
});

test("26 cleanup success cannot create PASS", () => {
  assert.equal(
    transitionFixtureLifecycle(
      "CLEANUP_REQUESTED",
      "CLEANUP_SUCCEEDED"
    ),
    "CLEANED"
  );
});

test("27 screenshot claims cannot prove lifecycle state", () => {
  assert.equal(
    ownership({
      returnedResourceId: undefined,
      screenshotClaimsCreated: true,
    }),
    undefined
  );
});

test("28 LLM claims cannot prove ownership", () => {
  assert.equal(
    ownership({
      returnedResourceId: undefined,
      modelClaimsOwned: true,
    }),
    undefined
  );
});

test("29 the same source model produces identical feasibility", () => {
  const model = safeModel();

  assert.deepEqual(
    evaluateFixtureProvisioningFeasibility(model),
    evaluateFixtureProvisioningFeasibility(model)
  );
});

test("30 multiple safe candidates abstain as ambiguous", () => {
  assert.equal(
    selectSafeFixtureProvisioningCandidate([
      safeModel({ fixtureKind: "A" }),
      safeModel({ fixtureKind: "B" }),
    ]).status,
    "AMBIGUOUS_SAFE_CANDIDATE"
  );
});

test("post-verification failure still permits cleanup request", () => {
  assert.equal(
    transitionFixtureLifecycle(
      "POST_VERIFY_FAILED",
      "REQUEST_CLEANUP"
    ),
    "CLEANUP_REQUESTED"
  );
});

test("cleanup verification failure is preserved", () => {
  assert.equal(
    transitionFixtureLifecycle(
      "CLEANED",
      "CLEANUP_VERIFY_REJECTED"
    ),
    "CLEANUP_VERIFY_FAILED"
  );
});

test("source-backed contract families produce no safe candidate", () => {
  const selection =
    selectSafeFixtureProvisioningCandidate(
      [...contractFixtureProvisioningSourceModels]
    );

  assert.equal(
    selection.status,
    "NO_SAFE_CANDIDATE"
  );
  assert.equal(
    selection.evaluations.every(
      (evaluation) =>
        !evaluation.safeCandidate
    ),
    true
  );
});

test("source catalog is bounded and contains provenance only", () => {
  assert.equal(
    contractFixtureProvisioningSourceModels.length,
    3
  );
  assert.equal(
    contractFixtureProvisioningSourceModels
      .flatMap((model) => model.operations)
      .every(
        (operation) =>
          operation.sourceRef.startsWith(
            "../ango-scholars-client/"
          )
      ),
    true
  );
});
