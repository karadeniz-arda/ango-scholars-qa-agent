import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserExecutionCheckContract,
  BrowserTestCase,
} from "../../planner/types.js";
import type { BrowserCaseRuntimeAudit } from "./browser-case-runtime-audit.js";
import {
  applyBrowserCaseVerdict,
  deriveBrowserCaseVerdict,
  isOperationalDiscoverySupportUnit,
  materializeBrowserRuntimeExecutionContract,
  type BrowserCaseExecutionAuthority,
} from "./browser-case-verdict.js";
import type {
  BrowserSourceBoundAssertionSetEvidence,
  BrowserSourceBoundAssertionSetRequirement,
} from "./browser-source-bound-assertion-set-proof.js";
import type {
  BrowserSourceBoundStructuralControlPresenceEvidence,
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "./browser-source-bound-structural-control-presence-proof.js";

const sourceRequirement: BrowserSourceBoundAssertionSetRequirement = {
  schemaVersion: 1,
  kind: "SOURCE_BOUND_ASSERTION_SET_REQUIREMENT",
  requirementId: "source-requirement-a",
  obligationId: "obligation-a",
  sourceUnitIds: ["source-a"],
  sourceRefs: ["jira:AS-1#acceptance"],
  sourceRole: "ACCEPTANCE",
  proofAuthority: "ACCEPTANCE",
  derivation: "DIRECT_ACCEPTANCE_FIELD",
  executionCaseId: "case-a",
  persona: "company_admin",
  routePath: "/company/items",
  semanticFamily: "EXPLICIT_ENUMERATED_ABSENCE",
  memberPolicy: "ALL_REQUIRED",
  members: [{
    action: "assertTextNotVisible",
    expectedText: "Legacy member",
    oracleId: "case-a:assertion-1",
  }],
};

function browserCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  return {
    id: "case-a",
    persona: "company_admin",
    goal: "Verify source-backed behavior.",
    startRoute: "/company/items",
    successCriteria: "Legacy member is absent.",
    acceptanceObligationIds: ["obligation-a"],
    executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a"],
      verdictAuthority: "INDEPENDENT",
    },
    steps: [{
      action: "assertTextNotVisible",
      text: "Legacy member",
      oracleId: "case-a:assertion-1",
    }],
    ...overrides,
  };
}

function contract(overrides: Partial<BrowserExecutionCheckContract> = {}): BrowserExecutionCheckContract {
  return {
    schemaVersion: 1,
    caseId: "case-a",
    executionObligationIds: ["obligation-a"],
    requiredChecks: [{
      checkId: "source-check-a",
      kind: "SOURCE_BOUND_ASSERTION_MEMBER",
      authority: "SOURCE_AUTHORIZED",
      requirementId: "source-requirement-a",
      oracle: {
        oracleId: "case-a:assertion-1",
        action: "assertTextNotVisible",
        expectedText: "Legacy member",
      },
      sourceUnitIds: ["source-a"],
      sourceRefs: ["jira:AS-1#acceptance"],
    }],
    requiredManualCheckIds: [],
    ...overrides,
  };
}

function authority(overrides: Partial<BrowserCaseExecutionAuthority> = {}): BrowserCaseExecutionAuthority {
  return {
    actualPersona: { status: "AVAILABLE", value: "company_admin", source: "test" },
    acceptedRoutePath: { status: "AVAILABLE", value: "/company/items", source: "test" },
    targetVerified: { status: "AVAILABLE", value: true, source: "test" },
    fixtureStatus: { status: "AVAILABLE", value: "NOT_REQUIRED", source: "test" },
    ...overrides,
  };
}

test("authority-free discovery support is not a canonical verdict unit", () => {
  const support = browserCase({
    acceptanceObligationIds: [],
    executionPolicy: { lane: "DISCOVERY_ONLY" },
  });
  assert.equal(isOperationalDiscoverySupportUnit(support), true);
  assert.equal(isOperationalDiscoverySupportUnit(browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } })), false);
  assert.equal(deriveBrowserCaseVerdict({ testCase: browserCase(), executionAuthority: authority() }).reason, "EXECUTION_CONTRACT_UNAVAILABLE");
});

function executionIntent(
  routePolicy:
    NonNullable<
      BrowserTestCase["executionIntentAuthority"]
    >["sourceTargetEnvelope"]["routePolicy"]
): NonNullable<BrowserTestCase["executionIntentAuthority"]> {
  const sourceUnitRefs = [{
    sourceUnitId: "source-a",
    sourceRef: "jira:AS-1#acceptance",
  }];

  return {
    schemaVersion: 1,
    caseId: "case-a",
    executionObligationIds: ["obligation-a"],
    executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a"],
      verdictAuthority: "INDEPENDENT",
    },
    sourceUnitRefs,
    personaPolicy: {
      kind: "EXACT_PERSONA",
      persona: "company_admin",
      authority: "SOURCE_ACTOR",
    },
    executionSafety: {
      allowedMutationClasses: ["READ_ONLY"],
      allowedInteractionClasses: [
        "OBSERVE",
        "ASSERT_VISIBLE",
      ],
    },
    fixtureRequirementRefs: [],
    sourceTargetEnvelope: {
      semanticIdentity: "Verify source-backed behavior.",
      sourceSurface: "Verify source-backed behavior.",
      sourceUnitRefs,
      compatibleTargetSources: ["visibleText"],
      routePolicy,
    },
  };
}

function audit(overrides: Partial<BrowserCaseRuntimeAudit> = {}): BrowserCaseRuntimeAudit {
  return {
    caseId: "case-a",
    safety: { status: "COMPLETE", attemptedActionCount: 0, unsafeExecutionCount: 0 },
    productRequests: { status: "COMPLETE", nonGetAttempts: [] },
    persistence: { status: "CLEAN" },
    testData: { status: "CLEAR" },
    ...overrides,
  };
}

function sourceEvidence(result: "CONFIRMED" | "CONTRADICTED" | "NOT_EXECUTED" = "CONFIRMED", freshObservation = true): BrowserSourceBoundAssertionSetEvidence {
  return {
    schemaVersion: 1,
    kind: "SOURCE_BOUND_ASSERTION_SET",
    proofRequirementId: sourceRequirement.requirementId,
    obligationId: sourceRequirement.obligationId,
    executionCaseId: sourceRequirement.executionCaseId,
    sourceUnitIds: sourceRequirement.sourceUnitIds,
    sourceRefs: sourceRequirement.sourceRefs,
    persona: "company_admin",
    routePath: "/company/items",
    freshObservation,
    members: [{ ...sourceRequirement.members[0]!, result }],
    result: result === "CONFIRMED" ? "CONFIRMED" : "NOT_CONFIRMED",
    note: "test",
  };
}

type VerdictArgs = Parameters<typeof deriveBrowserCaseVerdict>[0];

function args(overrides: Partial<VerdictArgs> = {}): VerdictArgs {
  const base: VerdictArgs = {
    testCase: browserCase(),
    executionCheckContract: contract(),
    executionAuthority: authority(),
    runtimeAudit: audit(),
    sourceBoundAssertionSetRequirements: [sourceRequirement],
    sourceBoundAssertionSetEvidence: [sourceEvidence()],
    deterministicEvidence: [{
      stepIndex: 0,
      oracleId: "case-a:assertion-1",
      action: "assertTextNotVisible" as const,
      expected: "Text is not visible: Legacy member",
      passed: true,
      note: "test",
    }],
  };
  return { ...base, ...overrides };
}

test("runtime source-authorized requirement reconstructs a missing legacy execution contract", () => {
  const legacyCase = browserCase({
    startRoute: "UNKNOWN",
    executionIntentAuthority:
      executionIntent({
        kind: "RUNTIME_DISCOVERABLE",
        sourceUnitRefs: [{
          sourceUnitId: "source-a",
          sourceRef:
            "jira:AS-1#acceptance",
        }],
      }),
  });

  delete legacyCase.executionVerdictScope;

  const runtimeRequirement = {
    ...sourceRequirement,
    routePath: "/company/items",
  };

  const reconstructed =
    materializeBrowserRuntimeExecutionContract({
      testCase: legacyCase,
      acceptedRoutePath:
        "/company/items",
      sourceBoundAssertionSetRequirements: [
        runtimeRequirement,
      ],
    });

  assert.equal(
    reconstructed.testCase.startRoute,
    "/company/items"
  );

  assert.equal(
    reconstructed.testCase
      .executionVerdictScope
      ?.verdictAuthority,
    "GROUP_ONLY"
  );

  assert.equal(
    reconstructed.executionCheckContract
      ?.requiredChecks.length,
    1
  );

  const result =
    deriveBrowserCaseVerdict({
      ...args(),
      testCase: reconstructed.testCase,
      executionCheckContract:
        reconstructed
          .executionCheckContract,
      sourceBoundAssertionSetRequirements: [
        runtimeRequirement,
      ],
    });

  assert.equal(result.verdict, "PASS");
  assert.equal(
    result.reason,
    "ALL_REQUIRED_CHECKS_CONFIRMED"
  );
});

test("runtime reconstruction fails closed when any execution obligation lacks a source-authorized requirement", () => {
  const legacyCase = browserCase({
    acceptanceObligationIds: [
      "obligation-a",
      "obligation-b",
    ],
  });

  delete legacyCase.executionVerdictScope;

  const reconstructed =
    materializeBrowserRuntimeExecutionContract({
      testCase: legacyCase,
      acceptedRoutePath:
        "/company/items",
      sourceBoundAssertionSetRequirements: [
        sourceRequirement,
      ],
    });

  assert.equal(
    reconstructed.executionCheckContract,
    undefined
  );

  assert.equal(
    reconstructed.testCase,
    legacyCase
  );
});

test("planner-only case data cannot reconstruct runtime execution authority", () => {
  const legacyCase = browserCase();
  delete legacyCase.executionVerdictScope;

  const reconstructed =
    materializeBrowserRuntimeExecutionContract({
      testCase: legacyCase,
      acceptedRoutePath:
        "/company/items",
      sourceBoundAssertionSetRequirements:
        [],
    });

  assert.equal(
    reconstructed.executionCheckContract,
    undefined
  );
});

test("an existing execution contract is never silently replaced by runtime reconstruction", () => {
  const existing = contract({
    caseId: "wrong-case",
  });

  const reconstructed =
    materializeBrowserRuntimeExecutionContract({
      testCase: browserCase(),
      executionCheckContract: existing,
      acceptedRoutePath:
        "/company/items",
      sourceBoundAssertionSetRequirements: [
        sourceRequirement,
      ],
    });

  assert.equal(
    reconstructed.executionCheckContract,
    existing
  );

  const result =
    deriveBrowserCaseVerdict({
      ...args(),
      executionCheckContract:
        reconstructed
          .executionCheckContract,
    });

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(
    result.reason,
    "EXECUTION_CONTRACT_UNAVAILABLE"
  );
});

test("one exact source-bound required check passes locally", () => {
  const result = deriveBrowserCaseVerdict(args());
  assert.equal(result.verdict, "PASS");
  assert.equal(result.reason, "ALL_REQUIRED_CHECKS_CONFIRMED");
  assert.deepEqual(result.passedCheckIds, ["source-check-a"]);
});

test("a bound structural presence check can pass only with exact fresh evidence", () => {
  const requirement: BrowserSourceBoundStructuralControlPresenceRequirement = {
    schemaVersion: 1, kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT", requirementId: "structural-a", obligationId: "obligation-a",
    sourceUnitIds: ["source-a"], sourceRefs: ["jira:AS-1#acceptance"], sourceRole: "ACCEPTANCE", proofAuthority: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", executionCaseId: "case-a", persona: "company_admin", routePath: "/company/items",
    control: { semanticKind: "SEARCH_INPUT", cardinality: "AT_LEAST_ONE" },
  };
  const evidence: BrowserSourceBoundStructuralControlPresenceEvidence = {
    schemaVersion: 1, kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE", proofRequirementId: "structural-a", obligationId: "obligation-a",
    executionCaseId: "case-a", sourceUnitIds: ["source-a"], sourceRefs: ["jira:AS-1#acceptance"], persona: "company_admin", routePath: "/company/items",
    freshObservation: true, control: requirement.control, matchingControlCount: 1, result: "CONFIRMED",
  };
  const structuralContract: BrowserExecutionCheckContract = {
    schemaVersion: 1, caseId: "case-a", executionObligationIds: ["obligation-a"], requiredManualCheckIds: [],
    requiredChecks: [{ checkId: "structural-check", kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE", authority: "SOURCE_AUTHORIZED", requirementId: "structural-a", control: requirement.control, sourceUnitIds: ["source-a"], sourceRefs: ["jira:AS-1#acceptance"] }],
  };
  const passed = deriveBrowserCaseVerdict(args({ executionCheckContract: structuralContract, sourceBoundAssertionSetRequirements: [], sourceBoundAssertionSetEvidence: [], deterministicEvidence: [], structuralControlPresenceRequirements: [requirement], structuralControlPresenceEvidence: [evidence] }));
  assert.equal(passed.verdict, "PASS");
  const missing = deriveBrowserCaseVerdict(args({ executionCheckContract: structuralContract, sourceBoundAssertionSetRequirements: [], sourceBoundAssertionSetEvidence: [], deterministicEvidence: [], structuralControlPresenceRequirements: [requirement], structuralControlPresenceEvidence: [] }));
  assert.equal(missing.verdict, "MANUAL_REQUIRED");
});

test("runtime materialization preserves an existing contract and adds discovery structural checks", () => {
  const requirement: BrowserSourceBoundStructuralControlPresenceRequirement = {
    schemaVersion: 1, kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE_REQUIREMENT", requirementId: "structural-merge", obligationId: "obligation-a",
    sourceUnitIds: ["source-a"], sourceRefs: ["jira:AS-1#acceptance"], sourceRole: "ACCEPTANCE", proofAuthority: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", executionCaseId: "case-a", persona: "company_admin", routePath: "/company/items",
    control: { semanticKind: "SEARCH_INPUT", cardinality: "AT_LEAST_ONE" },
  };
  const merged = materializeBrowserRuntimeExecutionContract({
    testCase: browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } }),
    executionCheckContract: contract(),
    acceptedRoutePath: "/company/items",
    structuralControlPresenceRequirements: [requirement],
  });
  assert.ok(merged.executionCheckContract);
  assert.equal(
    merged.executionCheckContract!.requiredChecks.some((check) =>
      check.kind === "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE" &&
      check.requirementId === "structural-merge"
    ),
    true,
  );
});

test("multiple required checks all pass", () => {
  const secondRequirement: BrowserSourceBoundAssertionSetRequirement = {
    ...sourceRequirement,
    requirementId: "source-requirement-b",
    members: [{
      action: "assertTextNotVisible",
      expectedText: "Other legacy member",
      oracleId: "case-a:assertion-2",
    }],
  };
  const secondCheck = {
    ...contract().requiredChecks[0]!,
    checkId: "source-check-b",
    requirementId: secondRequirement.requirementId,
    oracle: {
      oracleId: "case-a:assertion-2",
      action: "assertTextNotVisible" as const,
      expectedText: "Other legacy member",
    },
  };
  const secondEvidence: BrowserSourceBoundAssertionSetEvidence = {
    ...sourceEvidence(),
    proofRequirementId: secondRequirement.requirementId,
    members: [{ ...secondRequirement.members[0]!, result: "CONFIRMED" }],
  };
  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({ steps: [
      browserCase().steps![0]!,
      { action: "assertTextNotVisible", text: "Other legacy member", oracleId: "case-a:assertion-2" },
    ] }),
    executionCheckContract: contract({ requiredChecks: [contract().requiredChecks[0]!, secondCheck] }),
    sourceBoundAssertionSetRequirements: [sourceRequirement, secondRequirement],
    sourceBoundAssertionSetEvidence: [sourceEvidence(), secondEvidence],
    deterministicEvidence: [
      ...(args().deterministicEvidence ?? []),
      {
        stepIndex: 1, oracleId: "case-a:assertion-2", action: "assertTextNotVisible",
        expected: "Text is not visible: Other legacy member", passed: true, note: "test",
      },
    ],
  }));
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(result.passedCheckIds, ["source-check-a", "source-check-b"]);
});

test("a conclusively contradicted required check fails", () => {
  const result = deriveBrowserCaseVerdict(args({
    sourceBoundAssertionSetEvidence: [sourceEvidence("CONTRADICTED")],
    deterministicEvidence: [{
      stepIndex: 0, oracleId: "case-a:assertion-1", action: "assertTextNotVisible",
      expected: "Text is not visible: Legacy member", passed: false, note: "test",
    }],
  }));
  assert.equal(result.verdict, "FAIL");
});

test("a missing required check is manual required", () => {
  const result = deriveBrowserCaseVerdict(args({ sourceBoundAssertionSetEvidence: [] }));
  assert.equal(result.verdict, "MANUAL_REQUIRED");
  assert.equal(result.reason, "REQUIRED_CHECK_EVIDENCE_MISSING");
});

test("an empty contract never vacuously passes", () => {
  const result = deriveBrowserCaseVerdict(args({ executionCheckContract: contract({ requiredChecks: [] }) }));
  assert.equal(result.verdict, "MANUAL_REQUIRED");
  assert.equal(result.reason, "NO_SOURCE_AUTHORIZED_EXECUTION_CHECKS");
});

test("typed manual requirements prevent case pass", () => {
  const result = deriveBrowserCaseVerdict(args({
    executionCheckContract: contract({ requiredManualCheckIds: ["manual-a"] }),
  }));
  assert.equal(result.verdict, "MANUAL_REQUIRED");
  assert.equal(result.reason, "TYPED_MANUAL_CHECK_REQUIRED");
});

test("an exact fresh evidence-contract binding passes only by both stable IDs", () => {
  const result = deriveBrowserCaseVerdict(args({
    executionCheckContract: contract({ requiredChecks: [{
      checkId: "binding-check-a",
      kind: "EVIDENCE_CONTRACT_BINDING",
      authority: "SOURCE_AUTHORIZED",
      bindingId: "binding-a",
      evidenceContractId: "contract-a",
    }] }),
    sourceBoundAssertionSetRequirements: [],
    sourceBoundAssertionSetEvidence: [],
    deterministicEvidence: [],
    evidenceContractProofResults: [{
      schemaVersion: 1,
      bindingId: "binding-a",
      evidenceContractId: "contract-a",
      obligationId: "obligation-a",
      executionCaseId: "case-a",
      memberId: "member-a",
      capabilityKind: "SEARCH_INPUT_PRESENT",
      status: "CONFIRMED",
      freshObservation: true,
      surfaceCount: 1,
      note: "test",
    }],
  }));
  assert.equal(result.verdict, "PASS");
});

test("duplicate evidence fails closed", () => {
  const result = deriveBrowserCaseVerdict(args({
    sourceBoundAssertionSetEvidence: [sourceEvidence(), sourceEvidence()],
  }));
  assert.equal(result.verdict, "MANUAL_REQUIRED");
});

test("wrong oracle, requirement, and stale evidence do not satisfy a check", () => {
  const wrongOracle = sourceEvidence();
  wrongOracle.members[0]!.oracleId = "wrong-oracle";
  const wrongRequirement = { ...sourceEvidence(), proofRequirementId: "wrong-requirement" };
  for (const evidence of [[wrongOracle], [wrongRequirement], [sourceEvidence("CONFIRMED", false)]]) {
    const result = deriveBrowserCaseVerdict(args({ sourceBoundAssertionSetEvidence: evidence }));
    assert.equal(result.verdict, "MANUAL_REQUIRED");
  }
});

test("persona, target, and fixture authority gaps block", () => {
  const contexts: BrowserCaseExecutionAuthority[] = [
    authority({ actualPersona: { status: "AVAILABLE", value: "talent", source: "test" } }),
    authority({ targetVerified: { status: "UNAVAILABLE", reason: "missing" } }),
    authority({ targetVerified: { status: "AVAILABLE", value: false, source: "test" } }),
    authority({ fixtureStatus: { status: "UNAVAILABLE", reason: "missing" } }),
  ];
  for (const executionAuthority of contexts) {
    assert.equal(deriveBrowserCaseVerdict(args({ executionAuthority })).verdict, "BLOCKED");
  }
});

test("runtime-discovered route may differ from planner startRoute", () => {
  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({
      startRoute: "UNKNOWN",
      executionIntentAuthority: executionIntent({
        kind: "RUNTIME_DISCOVERABLE",
        sourceUnitRefs: [{
          sourceUnitId: "source-a",
          sourceRef: "jira:AS-1#acceptance",
        }],
      }),
    }),
  }));

  assert.equal(result.verdict, "PASS");
  assert.equal(result.reason, "ALL_REQUIRED_CHECKS_CONFIRMED");
});

test("runtime-discovered route may rebind only the route-bound source requirement id", () => {
  const runtimeRequirement: BrowserSourceBoundAssertionSetRequirement = {
    ...sourceRequirement,
    requirementId: "source-requirement-runtime-route",
  };

  const runtimeEvidence: BrowserSourceBoundAssertionSetEvidence = {
    ...sourceEvidence(),
    proofRequirementId: runtimeRequirement.requirementId,
  };

  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({
      startRoute: "UNKNOWN",
      executionIntentAuthority: executionIntent({
        kind: "RUNTIME_DISCOVERABLE",
        sourceUnitRefs: [{
          sourceUnitId: "source-a",
          sourceRef: "jira:AS-1#acceptance",
        }],
      }),
    }),
    sourceBoundAssertionSetRequirements: [
      runtimeRequirement,
    ],
    sourceBoundAssertionSetEvidence: [
      runtimeEvidence,
    ],
  }));

  assert.equal(result.verdict, "PASS");
  assert.equal(
    result.reason,
    "ALL_REQUIRED_CHECKS_CONFIRMED"
  );
});

test("explicit source route keeps exact route-bound source requirement id", () => {
  const runtimeRequirement: BrowserSourceBoundAssertionSetRequirement = {
    ...sourceRequirement,
    requirementId: "source-requirement-runtime-route",
  };

  const runtimeEvidence: BrowserSourceBoundAssertionSetEvidence = {
    ...sourceEvidence(),
    proofRequirementId: runtimeRequirement.requirementId,
  };

  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({
      executionIntentAuthority: executionIntent({
        kind: "PREBOUND_EXACT",
        route: "/company/items",
        authority: "SOURCE_ROUTE",
        sourceRefs: ["jira:AS-1#acceptance"],
      }),
    }),
    sourceBoundAssertionSetRequirements: [
      runtimeRequirement,
    ],
    sourceBoundAssertionSetEvidence: [
      runtimeEvidence,
    ],
  }));

  assert.equal(result.verdict, "MANUAL_REQUIRED");
  assert.equal(
    result.reason,
    "REQUIRED_CHECK_EVIDENCE_MISSING"
  );
});

test("explicit source-authored route remains a hard constraint", () => {
  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({
      executionIntentAuthority: executionIntent({
        kind: "PREBOUND_EXACT",
        route: "/company/items",
        authority: "SOURCE_ROUTE",
        sourceRefs: ["jira:AS-1#acceptance"],
      }),
    }),
    executionAuthority: authority({
      acceptedRoutePath: {
        status: "AVAILABLE",
        value: "/company/other",
        source: "test",
      },
    }),
  }));

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.reason, "EXECUTION_CONTEXT_UNAVAILABLE");
});

test("unsafe, product-mutating, persistence, and test-data audit outcomes block", () => {
  const audits: BrowserCaseRuntimeAudit[] = [
    audit({ safety: { status: "COMPLETE", attemptedActionCount: 1, unsafeExecutionCount: 1 } }),
    audit({ productRequests: { status: "COMPLETE", nonGetAttempts: [{ method: "POST", path: "/api/items" }] } }),
    audit({ persistence: { status: "VIOLATION" } }),
    audit({ testData: { status: "TEST_DATA_ISSUE" } }),
  ];
  for (const runtimeAudit of audits) {
    assert.equal(deriveBrowserCaseVerdict(args({ runtimeAudit })).verdict, "BLOCKED");
  }
});

test("an explicit runner error takes precedence", () => {
  const result = deriveBrowserCaseVerdict(args({ runnerStatus: "ERROR" }));
  assert.equal(result.verdict, "ERROR");
});

test("GROUP_ONLY local success becomes the canonical case result without ticket authority", () => {
  const result = deriveBrowserCaseVerdict(args({
    testCase: browserCase({ executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a", "obligation-b", "obligation-c"],
      verdictAuthority: "GROUP_ONLY",
    } }),
  }));
  assert.equal(result.verdict, "PASS");
  const legacyTransport: any = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
  };
  applyBrowserCaseVerdict(legacyTransport, result);
  assert.equal(legacyTransport.status, "PASS");
  assert.equal(legacyTransport.caseVerdict, result);
  assert.deepEqual(result.requiredCheckIds, ["source-check-a"]);
});

test("canonical case verdict cannot be promoted by raw PASS metadata", () => {
  const blocked = deriveBrowserCaseVerdict(args({
    executionAuthority: authority({
      fixtureStatus: { status: "UNAVAILABLE", reason: "fixture unresolved" },
    }),
  }));
  const legacyTransport: any = {
    status: "PASS",
    reasonCategory: "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE",
  };
  applyBrowserCaseVerdict(legacyTransport, blocked);
  assert.equal(legacyTransport.status, "BLOCKED");
  assert.equal(legacyTransport.caseVerdict.reason, "FIXTURE_UNAVAILABLE");
});

test("INDEPENDENT local pass does not use runner status as PASS authority", () => {
  const result = deriveBrowserCaseVerdict(args({ runnerStatus: "BLOCKED" }));
  assert.equal(result.verdict, "PASS");
});

test("screenshots, review-shaped data, and canonical evidence without contract membership cannot satisfy checks", () => {
  const input = {
    ...args({ sourceBoundAssertionSetEvidence: [] }),
    screenshotPath: "/private/tmp/not-authority.png",
    evidenceReview: { verdict: "PASS" },
  };
  const result = deriveBrowserCaseVerdict(input);
  assert.equal(result.verdict, "MANUAL_REQUIRED");
});
