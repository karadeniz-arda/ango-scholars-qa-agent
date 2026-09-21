import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import type {
  BrowserSourceBoundControlBinding,
} from "./browser-source-bound-control.js";
import {
  evaluateBrowserLocalStateTransition,
  type BrowserGroundedLocalStateTransitionEvidence,
  type BrowserLocalStateTransitionProofRequirement,
} from "./browser-local-state-transition-proof.js";
import {
  evaluateBrowserLocalStateObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import {
  evaluateBrowserDeterministicPassEligibility,
  generateTrustedDeterministicRawPass,
  type BrowserDeterministicPassRuntimePrerequisites,
  type BrowserLocalStatePassProof,
} from "./browser-deterministic-pass-policy.js";
import {
  reconcileBrowserResultFromEvidence,
} from "./browser-result-reconciliation.js";
import {
  allocateBrowserRuntimeSourceAssertions,
  buildBrowserSourceBoundAssertionSetRequirements,
  evaluateBrowserSourceBoundAssertionSet,
  evaluateBrowserSourceBoundAssertionSetDischarge,
} from "./browser-source-bound-assertion-set-proof.js";

function control(
  sourceId: string,
  bindingId: string,
  role:
    BrowserSourceBoundControlBinding["controlRole"],
  state:
    BrowserSourceBoundControlBinding["state"]
): BrowserSourceBoundControlBinding {
  return {
    status: "BOUND",
    bindingId,
    bindingIdentity:
      `${bindingId}|${sourceId}|stable`,
    sourceRef: sourceId,
    componentRef: "src/Feature.tsx",
    surfaceKind: "dialog",
    surfaceLabel: "Settings",
    visibleLabel: bindingId,
    controlRole: role,
    runtimeCorrespondence:
      "UNIQUE_SOURCE_STRUCTURED_UNIT",
    visible: true,
    disabled: false,
    interactionPossible: true,
    state,
  };
}

function proof(
  obligationId = "obligation-1",
  sourceId = "source-1",
  requirementId = "requirement-1"
): BrowserLocalStatePassProof {
  const requirement:
    BrowserLocalStateTransitionProofRequirement = {
      schemaVersion: 1,
      kind:
        "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
      requirementId,
      obligationId,
      sourceId,
      sourceRole: "ACCEPTANCE",
      proofAuthority: "ACCEPTANCE",
      expectedValue: -1,
      expectedValueAuthority:
        "JIRA_AUTHORIZED",
      surface: {
        kind: "dialog",
        label: "Settings",
        routePath: "/create",
      },
    };
  const activation = control(
    sourceId,
    `activation-${obligationId}`,
    "switch",
    { checked: true }
  );
  const initial = control(
    sourceId,
    `value-${obligationId}`,
    "slider",
    {
      value: -1,
      displayedValue: -1,
      min: -100,
      max: 0,
      step: 1,
    }
  );
  const alternate = {
    ...initial,
    state: {
      ...initial.state,
      value: -2,
      displayedValue: -2,
    },
  };
  const reset = control(
    sourceId,
    `reset-${obligationId}`,
    "button",
    {}
  );
  const evidence =
    evaluateBrowserLocalStateTransition({
      schemaVersion: 1,
      kind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      proofRequirementId: requirementId,
      proofAuthority: "ACCEPTANCE",
      obligationId,
      sourceId,
      sourceText:
        "Authoritative reset behavior.",
      expectedValue: -1,
      expectedValueAuthority:
        "JIRA_AUTHORIZED",
      surface: requirement.surface,
      bindings: {
        activation,
        valueInitial: initial,
        valueAlternate: alternate,
        reset,
        valueReset: initial,
      },
      actions: {
        activation: {
          actionId: "activate",
          kind: "TOGGLE_SWITCH",
          targetBindingIdentity:
            activation.bindingIdentity,
          executed: true,
          stateChanged: true,
          settled: true,
          beforeState: { checked: false },
          afterState: { checked: true },
          note: "settled",
        },
        alternateSetup: {
          actionId: "alternate",
          kind:
            "SET_NUMERIC_TEST_VALUE",
          targetBindingIdentity:
            initial.bindingIdentity,
          executed: true,
          stateChanged: true,
          settled: true,
          beforeState: initial.state,
          afterState: alternate.state,
          testSetupValue: -2,
          testSetupAuthority:
            "TEST_SETUP_ONLY",
          note: "settled",
        },
        reset: {
          actionId: "reset",
          kind: "ACTIVATE_CONTROL",
          targetBindingIdentity:
            reset.bindingIdentity,
          executed: true,
          stateChanged: true,
          settled: true,
          beforeState: {},
          afterState: initial.state,
          note: "settled",
        },
        restore: {
          actionId: "restore",
          kind: "CANCEL_SURFACE",
          targetBindingIdentity:
            `cancel-${obligationId}|stable`,
          executed: true,
          stateChanged: true,
          settled: true,
          beforeState: {},
          note: "settled",
        },
      },
      alternateValue: -2,
      alternateValueAuthority:
        "TEST_SETUP_ONLY",
      settlement: {
        activation: true,
        initialValue: true,
        alternateValue: true,
        resetValue: true,
      },
      transportGuard: {
        activeDuringProof: true,
        productNonGetCount: 0,
        attempts: [],
      },
      restore: {
        modalClosed: true,
        draftDiscardVerified: true,
        routePreserved: true,
      },
    });
  return {
    kind:
      "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    requirement,
    evidence,
  };
}

function browserCase(): BrowserTestCase {
  return {
    id: "web-1",
    persona: "company_admin",
    goal: "Prove reset behavior.",
    startRoute: "UNKNOWN",
    successCriteria:
      "The authoritative value is restored.",
    acceptanceObligationIds: [
      "obligation-1",
    ],
    manualChecks: [],
    fixtureRequirements: [
      "A compatible local draft is required.",
    ],
  };
}

function ledger():
  PlannerAcceptanceObligationLedger {
  return {
    sourceStatus: "RESOLVED",
    derivationStatus: "RESOLVED",
    obligations: [{
      id: "obligation-1",
      sourceUnitIds: ["source-1"],
      sourceRole: "ACCEPTANCE",
      derivation:
        "DIRECT_DESCRIPTION_SECTION",
      text:
        "Authoritative reset behavior.",
    }],
    unresolvedSourceUnitIds: [],
  };
}

function binding(
  obligationId = "obligation-1",
  sourceId = "source-1"
): PlannerBrowserObligationBinding {
  return {
    obligationId,
    sourceUnitIds: [sourceId],
    semanticFamily:
      "GROUPED_CONTROLS",
    state:
      "UNSUPPORTED_AUTOMATION_SEMANTIC",
    allocatedCaseIds: ["web-1"],
    reason:
      "The frozen planner predates the approved runtime proof.",
  };
}

function validArgs() {
  const testCase = browserCase();
  const obligationLedger = ledger();
  const browserObligationBindings = [
    binding(),
  ];
  const localStateProofs = [proof()];
  const discharge =
    evaluateBrowserLocalStateObligationDischarge({
      testCase,
      obligationLedger,
      browserObligationBindings,
      requirement:
        localStateProofs[0]!.requirement,
      evidence:
        localStateProofs[0]!.evidence,
    });
  assert.equal(
    discharge.status,
    "DETERMINISTIC_OBLIGATION_PROVED"
  );
  if (
    discharge.status !==
    "DETERMINISTIC_OBLIGATION_PROVED"
  ) {
    throw new Error("invalid test fixture");
  }
  return {
    testCase,
    obligationLedger,
    browserObligationBindings,
    currentResult: {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "DETERMINISTIC_PROOF_HAS_NO_PASS_GENERATOR",
      deterministicObligationDischarges: [
        discharge.discharge,
      ],
      caseProofReadiness: {
        status: "CASE_PROOF_READY",
      },
    } as any,
    localStateProofs,
    runtime: {
      fixtureStatus:
        "READY" as BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"],
      acceptedRoutePath: "/create",
      targetVerified: true,
      requiredExecutionCompleted: true,
      safetyViolation: false,
      testDataIssue: false,
      productNonGetCount: 0,
      persistenceViolation: false,
    },
  };
}

/** Exact direct-Task button-label proof assembled only from typed proof objects. */
function directTaskExactButtonArgs() {
  const args = validArgs();

  args.testCase.persona = "talent";
  args.testCase.steps = [];
  args.localStateProofs = [];
  args.browserObligationBindings = [];

  const sourceText = 'Display a "Download as PDF" button.';

  args.obligationLedger.obligations[0] = {
    id: "obligation-1",
    sourceUnitIds: ["task-1"],
    sourceRole: "TASK",
    derivation: "DIRECT_TASK_SECTION",
    text: sourceText,
  };

  const sourceLedger = {
    sourceStatus: "RESOLVED" as const,
    basis: "SUMMARY_DESCRIPTION_FALLBACK" as const,
    sourceUnits: [{
      id: "task-1",
      sourceKind: "DESCRIPTION" as const,
      sourceRef: "jira.description",
      text: sourceText,
    }],
  };

  const requirement =
    buildBrowserSourceBoundAssertionSetRequirements({
      testCase: args.testCase,
      obligationLedger: args.obligationLedger,
      sourceLedger,
      acceptedRoutePath: "/create",
    })[0];

  assert.ok(requirement);
  assert.equal(
    requirement.sourceSupportedUiRelation,
    "BUTTON_LABEL"
  );
  assert.equal(
    requirement.members[0]!.action,
    "assertExactVisibleButton"
  );

  const allocation =
    allocateBrowserRuntimeSourceAssertions({
      currentCase: args.testCase,
      allCases: [args.testCase],
      obligationLedger: args.obligationLedger,
      requirements: [requirement],
    })[0]!;

  const evidence =
    evaluateBrowserSourceBoundAssertionSet({
      requirement,
      deterministicEvidence: [],
      buttonCarrierObservations: [{
        requirementId: requirement.requirementId,
        oracleId: requirement.members[0]!.oracleId,
        member: requirement.members[0]!.expectedText,
        targetContextGrounded: true,
        matchingButtonCount: 1,
        result: "CONFIRMED",
      }],
      actualPersona: "talent",
      actualRoutePath: "/create",
      freshObservation: true,
    });

  const discharge =
    evaluateBrowserSourceBoundAssertionSetDischarge({
      testCase: args.testCase,
      obligationLedger: args.obligationLedger,
      allocation,
      requirement,
      evidence,
    });

  assert.equal(
    discharge.status,
    "DETERMINISTIC_OBLIGATION_PROVED"
  );

  if (
    discharge.status !==
    "DETERMINISTIC_OBLIGATION_PROVED"
  ) {
    throw new Error(
      "invalid direct Task exact-button proof fixture"
    );
  }

  args.currentResult.deterministicObligationDischarges = [
    discharge.discharge,
  ];

  return {
    ...args,
    sourceBoundAssertionSetProofs: [{
      kind: "SOURCE_BOUND_ASSERTION_SET" as const,
      requirement,
      allocation,
      evidence,
    }],
  };
}

function expectNotEligible(
  mutate: (args: ReturnType<
    typeof validArgs
  >) => void,
  reason?: string
): void {
  const args = validArgs();
  mutate(args);
  const result =
    evaluateBrowserDeterministicPassEligibility(
      args
    );
  assert.equal(
    result.status,
    "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE"
  );
  if (reason) {
    assert.equal(result.reason, reason);
  }
}

test("INDEPENDENT scope records raw eligibility without changing the case transport", () => {
  const args = validArgs();
  args.testCase.executionVerdictScope = {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: ["obligation-1"],
    verdictAuthority: "INDEPENDENT",
  };
  const result = generateTrustedDeterministicRawPass(args);
  assert.equal(result.status, "DETERMINISTIC_CASE_PASS_ELIGIBLE");
  assert.equal(args.currentResult.status, "MANUAL_REQUIRED");
});

test("GROUP_ONLY scope blocks raw PASS despite complete local proof", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory = "ALL_REQUIRED_CHECKS_CONFIRMED";
  args.currentResult.caseVerdict = {
    verdict: "PASS",
    reason: "ALL_REQUIRED_CHECKS_CONFIRMED",
    requiredCheckIds: ["case-check-a"],
    passedCheckIds: ["case-check-a"],
    failedCheckIds: [],
    missingCheckIds: [],
  };
  args.testCase.executionVerdictScope = {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: [
      "obligation-1", "obligation-2", "obligation-3", "obligation-4",
    ],
    verdictAuthority: "GROUP_ONLY",
  };
  const result = generateTrustedDeterministicRawPass(args);
  assert.equal(result.status, "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE");
  assert.equal(result.reason, "MANUAL_ACCEPTANCE_GAP");
  assert.deepEqual(
    args.testCase.executionVerdictScope.verdictScopeObligationIds,
    ["obligation-1", "obligation-2", "obligation-3", "obligation-4"]
  );
  assert.equal(args.currentResult.status, "PASS");
  assert.equal(args.currentResult.caseVerdict.verdict, "PASS");
});

test("INDEPENDENT scope fails closed when execution and verdict scopes differ", () => {
  const args = validArgs();
  args.testCase.executionVerdictScope = {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: ["obligation-1", "obligation-2"],
    verdictAuthority: "INDEPENDENT",
  };
  const result = evaluateBrowserDeterministicPassEligibility(args);
  assert.equal(result.status, "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE");
  assert.equal(result.reason, "OBLIGATION_ALLOCATION_INVALID");
});

test("CASE_PROOF_READY marker alone cannot PASS", () => {
  expectNotEligible((args) => {
    args.localStateProofs = [];
    args.currentResult
      .deterministicObligationDischarges = [];
  });
});

test("zero authoritative obligations cannot PASS", () => {
  expectNotEligible((args) => {
    args.testCase.acceptanceObligationIds = [];
  }, "NO_AUTHORITATIVE_ACCEPTANCE_OBLIGATION");
});

test("one allocated obligation without discharge cannot PASS", () => {
  expectNotEligible((args) => {
    args.currentResult
      .deterministicObligationDischarges = [];
  }, "OBLIGATION_DISCHARGE_MISSING");
});

test("one of two allocated obligations proved cannot PASS", () => {
  expectNotEligible((args) => {
    args.testCase.acceptanceObligationIds = [
      "obligation-1",
      "obligation-2",
    ];
    args.obligationLedger.obligations.push({
      id: "obligation-2",
      sourceUnitIds: ["source-2"],
      sourceRole: "ACCEPTANCE",
      derivation:
        "DIRECT_DESCRIPTION_SECTION",
      text: "Second obligation.",
    });
    args.browserObligationBindings.push(
      binding("obligation-2", "source-2")
    );
  }, "OBLIGATION_PROOF_MISSING");
});

test("all exact allocated obligations may become eligible", () => {
  const args = validArgs();
  const second = proof(
    "obligation-2",
    "source-2",
    "requirement-2"
  );
  args.testCase.acceptanceObligationIds = [
    "obligation-1",
    "obligation-2",
  ];
  args.obligationLedger.obligations.push({
    id: "obligation-2",
    sourceUnitIds: ["source-2"],
    sourceRole: "ACCEPTANCE",
    derivation:
      "DIRECT_DESCRIPTION_SECTION",
    text: "Second obligation.",
  });
  args.browserObligationBindings.push(
    binding("obligation-2", "source-2")
  );
  args.localStateProofs.push(second);
  const secondDischarge =
    evaluateBrowserLocalStateObligationDischarge({
      testCase: args.testCase,
      obligationLedger:
        args.obligationLedger,
      browserObligationBindings:
        args.browserObligationBindings,
      requirement: second.requirement,
      evidence: second.evidence,
    });
  assert.equal(
    secondDischarge.status,
    "DETERMINISTIC_OBLIGATION_PROVED"
  );
  if (
    secondDischarge.status ===
    "DETERMINISTIC_OBLIGATION_PROVED"
  ) {
    args.currentResult
      .deterministicObligationDischarges.push(
        secondDischarge.discharge
      );
  }
  assert.equal(
    evaluateBrowserDeterministicPassEligibility(
      args
    ).status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
});

test("a uniquely allocated source assertion set can generate PASS without a planner binding", () => {
  const args = validArgs();
  args.localStateProofs = [];
  args.browserObligationBindings = [];
  args.testCase.steps = ["Alpha", "Beta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `assertion-${text}` }));
  args.obligationLedger.obligations[0]!.text = "The control uses Alpha and Beta.";
  const sourceLedger = {
    sourceStatus: "RESOLVED" as const,
    basis: "ACCEPTANCE_CRITERIA" as const,
    sourceUnits: [{ id: "source-1", sourceKind: "ACCEPTANCE_CRITERIA" as const, sourceRef: "jira:AC-1", text: "The control uses Alpha and Beta." }],
  };
  const requirement = buildBrowserSourceBoundAssertionSetRequirements({ testCase: args.testCase, obligationLedger: args.obligationLedger, sourceLedger, acceptedRoutePath: "/create" })[0]!;
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: args.testCase, allCases: [args.testCase], obligationLedger: args.obligationLedger, requirements: [requirement] })[0]!;
  const evidence = evaluateBrowserSourceBoundAssertionSet({ requirement, deterministicEvidence: requirement.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "visible" })), actualPersona: "company_admin", actualRoutePath: "/create", freshObservation: true });
  const discharge = evaluateBrowserSourceBoundAssertionSetDischarge({ testCase: args.testCase, obligationLedger: args.obligationLedger, allocation, requirement, evidence });
  assert.equal(discharge.status, "DETERMINISTIC_OBLIGATION_PROVED");
  if (discharge.status !== "DETERMINISTIC_OBLIGATION_PROVED") throw new Error("invalid source proof fixture");
  args.currentResult.deterministicObligationDischarges = [discharge.discharge];
  assert.equal(evaluateBrowserDeterministicPassEligibility({ ...args, sourceBoundAssertionSetProofs: [{ kind: "SOURCE_BOUND_ASSERTION_SET", requirement, allocation, evidence }] }).status, "DETERMINISTIC_CASE_PASS_ELIGIBLE");
});

test("AS-1373-shaped direct Task member-presence proof records coverage eligibility without setting PASS", () => {
  const args = directTaskExactButtonArgs();
  assert.equal(
    evaluateBrowserDeterministicPassEligibility(args).status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
  assert.equal(
    generateTrustedDeterministicRawPass(args).status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
  assert.equal(args.currentResult.status, "MANUAL_REQUIRED");
});

test("Task authority fails closed outside the approved direct source-member proof shape", () => {
  for (const mutate of [
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.obligationLedger.obligations[0]!.derivation = "DIRECT_DESCRIPTION_SECTION";
    },
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.sourceBoundAssertionSetProofs[0]!.requirement.semanticFamily = "EXPLICIT_ENUMERATED_PRESENCE";
    },
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.sourceBoundAssertionSetProofs[0]!.requirement.proofAuthority = "ACCEPTANCE";
    },
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.sourceBoundAssertionSetProofs[0]!.evidence.freshObservation = false;
    },
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.sourceBoundAssertionSetProofs[0]!.allocation.allocatedCaseIds = ["other-case"];
    },
    (args: ReturnType<typeof directTaskExactButtonArgs>) => {
      args.sourceBoundAssertionSetProofs = [];
    },
  ]) {
    const args = directTaskExactButtonArgs();
    mutate(args);
    const result = evaluateBrowserDeterministicPassEligibility(args);
    assert.equal(result.status, "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE");
    assert.equal(result.reason, "OBLIGATION_NOT_AUTHORITATIVE");
  }
});

test("GROUP_ONLY remains stronger than approved direct Task member-presence authority", () => {
  const args = directTaskExactButtonArgs();
  args.testCase.executionVerdictScope = {
    executionObligationIds: ["obligation-1"],
    verdictScopeObligationIds: ["obligation-1", "sibling-obligation"],
    verdictAuthority: "GROUP_ONLY",
  };
  const result = generateTrustedDeterministicRawPass(args);
  assert.equal(result.status, "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE");
  assert.equal(result.reason, "MANUAL_ACCEPTANCE_GAP");
  assert.equal(args.currentResult.status, "MANUAL_REQUIRED");
});

test("an ambiguous source assertion allocation cannot generate PASS", () => {
  const args = validArgs();
  args.localStateProofs = [];
  args.browserObligationBindings = [];
  args.testCase.steps = ["Alpha", "Beta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `assertion-${text}` }));
  args.obligationLedger.obligations[0]!.text = "The control uses Alpha and Beta.";
  const sourceLedger = { sourceStatus: "RESOLVED" as const, basis: "ACCEPTANCE_CRITERIA" as const, sourceUnits: [{ id: "source-1", sourceKind: "ACCEPTANCE_CRITERIA" as const, sourceRef: "jira:AC-1", text: "The control uses Alpha and Beta." }] };
  const requirement = buildBrowserSourceBoundAssertionSetRequirements({ testCase: args.testCase, obligationLedger: args.obligationLedger, sourceLedger, acceptedRoutePath: "/create" })[0]!;
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: args.testCase, allCases: [args.testCase, { ...args.testCase, id: "other-case" }], obligationLedger: args.obligationLedger, requirements: [requirement] })[0]!;
  const evidence = evaluateBrowserSourceBoundAssertionSet({ requirement, deterministicEvidence: requirement.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "visible" })), actualPersona: "company_admin", actualRoutePath: "/create", freshObservation: true });
  assert.equal(evaluateBrowserDeterministicPassEligibility({ ...args, sourceBoundAssertionSetProofs: [{ kind: "SOURCE_BOUND_ASSERTION_SET", requirement, allocation, evidence }] }).reason, "OBLIGATION_ALLOCATION_AMBIGUOUS");
});

test("wrong obligation ID cannot count", () => {
  expectNotEligible((args) => {
    args.currentResult
      .deterministicObligationDischarges[0]
      .obligationId = "wrong";
  }, "OBLIGATION_DISCHARGE_MISSING");
});

test("wrong case allocation cannot count", () => {
  expectNotEligible((args) => {
    args.browserObligationBindings[0]!
      .allocatedCaseIds = ["web-2"];
  }, "OBLIGATION_ALLOCATION_INVALID");
});

test("text-equivalent different obligation ID cannot count", () => {
  expectNotEligible((args) => {
    args.testCase.acceptanceObligationIds = [
      "text-equivalent-id",
    ];
  }, "OBLIGATION_NOT_AUTHORITATIVE");
});

for (const state of [
  "SUPPORTED_BUT_UNBOUND",
  "UNSUPPORTED_AUTOMATION_SEMANTIC",
] as const) {
  test(`${state} without approved proof blocks PASS`, () => {
    expectNotEligible((args) => {
      args.browserObligationBindings[0]!
        .state = state;
      args.localStateProofs = [];
    }, "OBLIGATION_PROOF_MISSING");
  });
}

test("ambiguous allocation blocks PASS", () => {
  expectNotEligible((args) => {
    args.browserObligationBindings[0]!
      .state =
        "AMBIGUOUS_CASE_ALLOCATION";
  }, "OBLIGATION_ALLOCATION_AMBIGUOUS");
});

test("manual-by-nature acceptance blocks PASS", () => {
  expectNotEligible((args) => {
    args.browserObligationBindings[0]!
      .state = "MANUAL_BY_NATURE";
  }, "MANUAL_ACCEPTANCE_GAP");
});

test("remaining manual acceptance check blocks PASS", () => {
  expectNotEligible((args) => {
    args.testCase.acceptanceObligationIds!.push(
      "manual-obligation"
    );
    args.testCase.manualChecks = [
      "Verify an independent manual obligation.",
    ];
    args.obligationLedger.obligations.push({
      id: "manual-obligation",
      sourceUnitIds: ["manual-source"],
      sourceRole: "ACCEPTANCE",
      derivation:
        "DIRECT_DESCRIPTION_SECTION",
      text: "Independent manual obligation.",
    });
    args.browserObligationBindings.push({
      ...binding(
        "manual-obligation",
        "manual-source"
      ),
      state: "MANUAL_BY_NATURE",
    });
  }, "MANUAL_ACCEPTANCE_GAP");
});

for (const fixtureStatus of [
  "UNAVAILABLE",
  "UNKNOWN",
] as const) {
  test(`fixture ${fixtureStatus} blocks PASS`, () => {
    expectNotEligible((args) => {
      args.runtime.fixtureStatus =
        fixtureStatus;
    }, "FIXTURE_NOT_READY");
  });
}

test("unverified target blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.targetVerified = false;
  }, "TARGET_NOT_VERIFIED");
});

test("invalid route blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.acceptedRoutePath =
      "/wrong";
  }, "ROUTE_NOT_ACCEPTED");
});

test("safety violation blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.safetyViolation = true;
  }, "SAFETY_VIOLATION");
});

test("product non-GET violation blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.productNonGetCount = 1;
  }, "TRANSPORT_VIOLATION");
});

test("restore failure blocks local-state PASS", () => {
  expectNotEligible((args) => {
    args.localStateProofs[0]!
      .evidence.restore
      .draftDiscardVerified = false;
  }, "OBLIGATION_DISCHARGE_INVALID");
});

for (const result of [
  "ABSTAINED",
  "CONTRADICTED",
] as const) {
  test(`${result} proof blocks PASS without creating FAIL`, () => {
    const args = validArgs();
    args.localStateProofs[0]!
      .evidence.result = result;
    const decision =
      generateTrustedDeterministicRawPass(
        args
      );
    assert.equal(
      decision.status,
      "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE"
    );
    assert.equal(
      args.currentResult.status,
      "MANUAL_REQUIRED"
    );
  });
}

test("screenshot PASS cannot substitute for deterministic proof", () => {
  expectNotEligible((args) => {
    args.localStateProofs = [];
    args.currentResult.evidenceReview = {
      verdict: "PASS_CONFIRMED",
      confidence: "high",
    };
  }, "OBLIGATION_PROOF_MISSING");
});

test("screenshot INCONCLUSIVE cannot manufacture a result", () => {
  const args = validArgs();
  args.localStateProofs = [];
  args.currentResult.evidenceReview = {
    verdict: "INCONCLUSIVE",
    confidence: "low",
  };
  generateTrustedDeterministicRawPass(args);
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("TEST_SETUP_ONLY value cannot become expected acceptance state", () => {
  expectNotEligible((args) => {
    args.localStateProofs[0]!
      .requirement.expectedValue = -2;
  }, "OBLIGATION_DISCHARGE_INVALID");
});

test("duplicate or mismatched control identity cannot PASS", () => {
  expectNotEligible((args) => {
    args.localStateProofs[0]!
      .evidence.bindings.valueAlternate
      .bindingIdentity = "duplicate|other";
  }, "OBLIGATION_DISCHARGE_INVALID");
});

test("initial authoritative value without reset proof cannot PASS", () => {
  expectNotEligible((args) => {
    args.localStateProofs[0]!
      .evidence.actions.reset.executed =
        false;
  }, "OBLIGATION_DISCHARGE_INVALID");
});

test("reconciliation never upgrades raw MANUAL_REQUIRED to PASS", () => {
  const args = validArgs();
  reconcileBrowserResultFromEvidence({
    currentResult: args.currentResult,
    testCase: args.testCase,
    review: {
      verdict: "PASS_CONFIRMED",
      confidence: "high",
    },
    source: "screenshot",
  });
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("fake readiness plus incomplete typed evidence cannot PASS", () => {
  expectNotEligible((args) => {
    args.currentResult.caseProofReadiness = {
      status: "CASE_PROOF_READY",
      allocatedObligationIds: [
        "obligation-1",
      ],
      provedObligationIds: [
        "obligation-1",
      ],
      remainingObligationIds: [],
      blockingBindingStates: [],
      note: "fake",
    };
    args.localStateProofs = [];
  }, "OBLIGATION_PROOF_MISSING");
});

test("planner text alone cannot establish PASS eligibility", () => {
  expectNotEligible((args) => {
    args.localStateProofs = [];
    args.testCase.successCriteria =
      "The exact authoritative behavior passed.";
  }, "OBLIGATION_PROOF_MISSING");
});

test("valid complete proof records raw coverage eligibility without setting a case status", () => {
  const args = validArgs();
  const result =
    generateTrustedDeterministicRawPass(
      args
    );
  assert.equal(
    result.status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
  assert.equal(
    args.currentResult.reasonCategory,
    "DETERMINISTIC_PROOF_HAS_NO_PASS_GENERATOR"
  );
  assert.equal(
    args.currentResult.deterministicPassEligibility.status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
});

test("background GET-compatible polling does not block eligibility", () => {
  const args = validArgs();
  args.runtime.productNonGetCount = 0;
  assert.equal(
    evaluateBrowserDeterministicPassEligibility(
      args
    ).status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
});

test("missing proof remains non-PASS rather than FAIL", () => {
  const args = validArgs();
  args.localStateProofs = [];
  generateTrustedDeterministicRawPass(args);
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("incomplete execution blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime
      .requiredExecutionCompleted = false;
  }, "REQUIRED_EXECUTION_INCOMPLETE");
});

test("test-data issue blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.testDataIssue = true;
  }, "TEST_DATA_ISSUE");
});

test("persistent mutation violation blocks PASS", () => {
  expectNotEligible((args) => {
    args.runtime.persistenceViolation = true;
  }, "PERSISTENCE_VIOLATION");
});

function generatedRawPassArgs() {
  const args = validArgs();
  const decision =
    generateTrustedDeterministicRawPass(
      args
    );
  assert.equal(
    decision.status,
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  );
  // Legacy reconciliation coverage: Phase 1 no longer permits this policy
  // helper to create the raw PASS itself.
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory =
    "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE";
  return args;
}

function reconcileWith(
  args: ReturnType<
    typeof validArgs
  >,
  verdict: string,
  confidence = "low"
): void {
  reconcileBrowserResultFromEvidence({
    currentResult: args.currentResult,
    testCase: args.testCase,
    review: { verdict, confidence },
    source: "screenshot",
  });
}

for (const rawStatus of [
  "MANUAL_REQUIRED",
  "BLOCKED",
  "FAIL",
  "ERROR",
] as const) {
  test(`raw ${rawStatus} cannot be upgraded by trusted retention`, () => {
    const args = generatedRawPassArgs();
    args.currentResult.status = rawStatus;
    reconcileWith(args, "INCONCLUSIVE");
    assert.notEqual(
      args.currentResult.status,
      "PASS"
    );
  });
}

test("ordinary raw PASS without eligibility follows existing INCONCLUSIVE behavior", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory =
    "ACCEPTANCE_ASSERTIONS_PASSED";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("fake eligibility marker cannot retain PASS", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory =
    "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE";
  args.currentResult
    .deterministicPassEligibility = {
      status:
        "DETERMINISTIC_CASE_PASS_ELIGIBLE",
      reason:
        "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE",
      caseId: "web-1",
      allocatedObligationIds: [
        "obligation-1",
      ],
      provedObligationIds: [
        "obligation-1",
      ],
      proofKinds: [
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      ],
      note: "fake",
    };
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("incomplete discharge cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.currentResult
    .deterministicObligationDischarges = [];
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("zero authoritative obligations cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.testCase.acceptanceObligationIds = [];
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("one unproved allocated obligation cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.testCase.acceptanceObligationIds!.push(
    "obligation-2"
  );
  args.obligationLedger.obligations.push({
    id: "obligation-2",
    sourceUnitIds: ["source-2"],
    sourceRole: "ACCEPTANCE",
    derivation:
      "DIRECT_DESCRIPTION_SECTION",
    text: "Second obligation.",
  });
  args.browserObligationBindings.push(
    binding("obligation-2", "source-2")
  );
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

for (const state of [
  "SUPPORTED_BUT_UNBOUND",
  "UNSUPPORTED_AUTOMATION_SEMANTIC",
] as const) {
  test(`${state} without its proof cannot use retention`, () => {
    const args = generatedRawPassArgs();
    args.currentResult
      .deterministicPassValidationContext
      .localStateProofs = [];
    args.browserObligationBindings[0]!
      .state = state;
    reconcileWith(args, "INCONCLUSIVE");
    assert.equal(
      args.currentResult.status,
      "MANUAL_REQUIRED"
    );
  });
}

test("ambiguous allocation cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.browserObligationBindings[0]!
    .state =
      "AMBIGUOUS_CASE_ALLOCATION";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("remaining manual-by-nature acceptance cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.browserObligationBindings[0]!
    .state = "MANUAL_BY_NATURE";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

for (const fixtureStatus of [
  "UNAVAILABLE",
  "UNKNOWN",
] as const) {
  test(`fixture ${fixtureStatus} cannot use retention`, () => {
    const args = generatedRawPassArgs();
    args.runtime.fixtureStatus =
      fixtureStatus;
    reconcileWith(args, "INCONCLUSIVE");
    assert.equal(
      args.currentResult.status,
      "MANUAL_REQUIRED"
    );
  });
}

test("unverified target cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.runtime.targetVerified = false;
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("invalid route cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.runtime.acceptedRoutePath =
    "/wrong";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("safety failure cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.runtime.safetyViolation = true;
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("product non-GET violation cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.runtime.productNonGetCount = 1;
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("restore failure cannot use retention", () => {
  const args = generatedRawPassArgs();
  args.localStateProofs[0]!
    .evidence.restore.modalClosed = false;
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("screenshot PASS alone cannot create deterministic eligibility", () => {
  const args = validArgs();
  reconcileWith(
    args,
    "PASS_CONFIRMED",
    "high"
  );
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("INCONCLUSIVE alone cannot preserve an untrusted PASS", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("planner prose cannot create retention authority", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory =
    "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE";
  args.testCase.successCriteria =
    "The planner says deterministic proof is complete.";
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("CASE_PROOF_READY marker alone cannot create retention authority", () => {
  const args = validArgs();
  args.currentResult.status = "PASS";
  args.currentResult.reasonCategory =
    "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE";
  args.currentResult.caseProofReadiness = {
    status: "CASE_PROOF_READY",
  };
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("trusted deterministic raw PASS survives visual INCONCLUSIVE", () => {
  const args = generatedRawPassArgs();
  reconcileWith(args, "INCONCLUSIVE");
  assert.equal(
    args.currentResult.status,
    "PASS"
  );
  assert.equal(
    args.currentResult.reasonCategory,
    "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE"
  );
  assert.equal(
    args.currentResult.reconciliationAudit
      .at(-1).decision,
    "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE"
  );
});

test("trusted raw PASS remains PASS when no visual verdict is supplied", () => {
  const args = generatedRawPassArgs();
  reconcileWith(args, "");
  assert.equal(
    args.currentResult.status,
    "PASS"
  );
});

test("explicit PRODUCT_BUG handling is unchanged by the INCONCLUSIVE exception", () => {
  const args = generatedRawPassArgs();
  reconcileWith(
    args,
    "PRODUCT_BUG",
    "high"
  );
  assert.equal(
    args.currentResult.status,
    "PASS"
  );
  assert.notEqual(
    args.currentResult.reasonCategory,
    "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE"
  );
});

for (const evidenceResult of [
  "ABSTAINED",
  "CONTRADICTED",
] as const) {
  test(`${evidenceResult} evidence cannot retain PASS or create FAIL`, () => {
    const args = generatedRawPassArgs();
    args.localStateProofs[0]!
      .evidence.result = evidenceResult;
    reconcileWith(args, "INCONCLUSIVE");
    assert.equal(
      args.currentResult.status,
      "MANUAL_REQUIRED"
    );
  });
}
