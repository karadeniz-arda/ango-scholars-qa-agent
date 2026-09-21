import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import {
  getBrowserAcceptanceCoverageGapReason,
  getRemainingBrowserManualAcceptanceChecks,
  reconcileBrowserResultFromEvidence,
} from "./browser-result-reconciliation.js";
import {
  evaluateBrowserLocalStateTransition,
  type BrowserGroundedLocalStateTransitionEvidence,
  type BrowserLocalStateTransitionProofRequirement,
} from "./browser-local-state-transition-proof.js";
import {
  applyBrowserLocalStateObligationDischarge,
  auditBrowserCaseProofReadiness,
  evaluateBrowserLocalStateObligationDischarge,
  type BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import type {
  BrowserSourceBoundControlBinding,
} from "./browser-source-bound-control.js";

const obligationId = "obligation-1";
const sourceId = "source-1";
const requirementId = "requirement-1";

function control(
  bindingId: string,
  controlRole:
    BrowserSourceBoundControlBinding["controlRole"],
  state:
    BrowserSourceBoundControlBinding["state"],
  overrides:
    Partial<BrowserSourceBoundControlBinding> = {}
): BrowserSourceBoundControlBinding {
  return {
    status: "BOUND",
    bindingId,
    bindingIdentity: `${bindingId}|stable`,
    sourceRef: sourceId,
    componentRef: "src/Feature.tsx",
    surfaceKind: "dialog",
    surfaceLabel: "Settings",
    visibleLabel: bindingId,
    controlRole,
    runtimeCorrespondence:
      "UNIQUE_SOURCE_STRUCTURED_UNIT",
    visible: true,
    disabled: false,
    interactionPossible: true,
    state,
    ...overrides,
  };
}

function proofRequirement(
  overrides:
    Partial<BrowserLocalStateTransitionProofRequirement> = {}
): BrowserLocalStateTransitionProofRequirement {
  return {
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
    ...overrides,
  };
}

function confirmedEvidence():
  BrowserGroundedLocalStateTransitionEvidence {
  const activation = control(
    "activation",
    "switch",
    { checked: true }
  );
  const initial = control(
    "value",
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
    "reset",
    "button",
    {}
  );

  return evaluateBrowserLocalStateTransition({
    schemaVersion: 1,
    kind:
      "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    proofRequirementId: requirementId,
    proofAuthority: "ACCEPTANCE",
    obligationId,
    sourceId,
    sourceText:
      "Authoritative local reset behavior.",
    expectedValue: -1,
    expectedValueAuthority:
      "JIRA_AUTHORIZED",
    surface: {
      kind: "dialog",
      label: "Settings",
      routePath: "/create",
    },
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
          "cancel|stable",
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
}

function browserCase(
  overrides:
    Partial<BrowserTestCase> = {}
): BrowserTestCase {
  return {
    id: "web-1",
    persona: "company_admin",
    goal: "Prove the local reset behavior.",
    startRoute: "/create",
    successCriteria:
      "The authoritative default is restored.",
    acceptanceObligationIds: [
      obligationId,
    ],
    manualChecks: [],
    ...overrides,
  };
}

function ledger():
  PlannerAcceptanceObligationLedger {
  return {
    sourceStatus: "RESOLVED",
    derivationStatus: "RESOLVED",
    obligations: [{
      id: obligationId,
      sourceUnitIds: [sourceId],
      sourceRole: "ACCEPTANCE",
      derivation:
        "DIRECT_DESCRIPTION_SECTION",
      text:
        "Authoritative local reset behavior.",
    }],
    unresolvedSourceUnitIds: [],
  };
}

function allocation(
  overrides:
    Partial<PlannerBrowserObligationBinding> = {}
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
      "The frozen planner predates the runtime proof adapter.",
    ...overrides,
  };
}

function dischargeArgs() {
  return {
    testCase: browserCase(),
    obligationLedger: ledger(),
    browserObligationBindings: [
      allocation(),
    ],
    requirement: proofRequirement(),
    evidence: confirmedEvidence(),
  };
}

test("confirmed exact evidence discharges exactly one obligation", () => {
  const decision =
    evaluateBrowserLocalStateObligationDischarge(
      dischargeArgs()
    );
  assert.equal(
    decision.status,
    "DETERMINISTIC_OBLIGATION_PROVED"
  );
  assert.equal(
    decision.status ===
      "DETERMINISTIC_OBLIGATION_PROVED" &&
      decision.discharge.obligationId,
    obligationId
  );
});

test("TEST_SETUP_ONLY value cannot substitute for expected value", () => {
  const args = dischargeArgs();
  args.requirement = proofRequirement({
    expectedValue: -2,
  });
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("setup-only proof authority cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    proofAuthority:
      "TEST_SETUP_ONLY",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).reason,
    "PROOF_AUTHORITY_MISMATCH"
  );
});

test("setup-only value cannot satisfy the final expected state", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    bindings: {
      ...args.evidence.bindings,
      valueReset: {
        ...args.evidence.bindings
          .valueReset,
        state: {
          ...args.evidence.bindings
            .valueReset.state,
          value: -2,
          displayedValue: -2,
        },
      },
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("changing setup value does not change authoritative expected value", () => {
  const input = confirmedEvidence();
  const changed = evaluateBrowserLocalStateTransition({
    ...input,
    alternateValue: -3,
    bindings: {
      ...input.bindings,
      valueAlternate: {
        ...input.bindings.valueAlternate,
        state: {
          ...input.bindings.valueAlternate.state,
          value: -3,
          displayedValue: -3,
        },
      },
    },
    actions: {
      ...input.actions,
      alternateSetup: {
        ...input.actions.alternateSetup,
        testSetupValue: -3,
        afterState: {
          ...input.actions.alternateSetup.afterState,
          value: -3,
          displayedValue: -3,
        },
      },
    },
  });
  assert.equal(changed.result, "CONFIRMED");
  assert.equal(changed.expectedValue, -1);
});

test("setup value equal to expected cannot prove reset", () => {
  const input = confirmedEvidence();
  const result = evaluateBrowserLocalStateTransition({
    ...input,
    alternateValue: -1,
  });
  assert.equal(result.result, "ABSTAINED");
});

test("duplicate control identity cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    bindings: {
      ...args.evidence.bindings,
      reset: {
        ...args.evidence.bindings.reset,
        bindingIdentity:
          args.evidence.bindings
            .valueInitial
            .bindingIdentity,
      },
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).reason,
    "CONTROL_BINDING_IDENTITY_MISMATCH"
  );
});

test("wrong active surface cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    surface: {
      ...args.evidence.surface,
      label: "Other",
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("wrong obligation ID cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    obligationId: "wrong",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("matching source text with wrong obligation ID cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    obligationId: "wrong",
    sourceText:
      ledger().obligations[0]!.text,
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("obligation allocated to another case cannot discharge current case", () => {
  const args = dischargeArgs();
  args.browserObligationBindings = [
    allocation({
      allocatedCaseIds: ["web-2"],
    }),
  ];
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).reason,
    "OBLIGATION_NOT_ALLOCATED_TO_CASE"
  );
});

test("displayed and underlying value mismatch cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    bindings: {
      ...args.evidence.bindings,
      valueInitial: {
        ...args.evidence.bindings
          .valueInitial,
        state: {
          ...args.evidence.bindings
            .valueInitial.state,
          displayedValue: -2,
        },
      },
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("reset of a different value control cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    bindings: {
      ...args.evidence.bindings,
      valueReset: {
        ...args.evidence.bindings
          .valueReset,
        bindingIdentity: "other-value",
      },
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("initial expected value alone cannot discharge reset behavior", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    alternateValue: -1,
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("product non-GET attempt invalidates discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    transportGuard: {
      activeDuringProof: true,
      productNonGetCount: 1,
      attempts: [{
        method: "POST",
        path: "/create",
      }],
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("restore failure prevents discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    restore: {
      ...args.evidence.restore,
      draftDiscardVerified: false,
    },
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("ABSTAINED evidence cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    result: "ABSTAINED",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("CONTRADICTED evidence cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    result: "CONTRADICTED",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("screenshot metadata cannot manufacture discharge", () => {
  const args = dischargeArgs() as ReturnType<typeof dischargeArgs> & {
    screenshot?: string;
  };
  args.screenshot = "supplementary.png";
  assert.equal(
    "screenshot" in
      evaluateBrowserLocalStateObligationDischarge(args),
    false
  );
});

test("implementation-only expected value cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    expectedValueAuthority:
      "IMPLEMENTATION_ONLY",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

test("planner-only expected value cannot discharge", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    expectedValueAuthority:
      "PLANNER_ONLY",
  };
  assert.equal(
    evaluateBrowserLocalStateObligationDischarge(args).status,
    "NOT_PROVED"
  );
});

function exactDischarge(
  id = obligationId
): BrowserDeterministicObligationDischarge {
  return {
    kind:
      "DETERMINISTIC_OBLIGATION_PROVED",
    obligationId: id,
    sourceId,
    proofRequirementId: requirementId,
    proofKind:
      "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    evidenceResult: "CONFIRMED",
    note: "proved",
  };
}

test("one proved obligation cannot erase an unrelated required obligation", () => {
  const readiness =
    auditBrowserCaseProofReadiness({
      testCase: browserCase({
        acceptanceObligationIds: [
          obligationId,
          "obligation-2",
        ],
      }),
      discharges: [exactDischarge()],
      browserObligationBindings: [
        allocation(),
        allocation({
          obligationId: "obligation-2",
          sourceUnitIds: ["source-2"],
        }),
      ],
    });
  assert.equal(
    readiness.status,
    "CASE_PROOF_NOT_READY"
  );
  assert.deepEqual(
    readiness.remainingObligationIds,
    ["obligation-2"]
  );
});

test("unsupported authoritative obligation remains visible in completeness", () => {
  const readiness =
    auditBrowserCaseProofReadiness({
      testCase: browserCase(),
      discharges: [],
      browserObligationBindings: [
        allocation(),
      ],
    });
  assert.deepEqual(
    readiness.blockingBindingStates,
    [{
      obligationId,
      state:
        "UNSUPPORTED_AUTOMATION_SEMANTIC",
    }]
  );
});

test("ambiguous authoritative obligation remains visible in completeness", () => {
  const readiness =
    auditBrowserCaseProofReadiness({
      testCase: browserCase(),
      discharges: [],
      browserObligationBindings: [
        allocation({
          state:
            "AMBIGUOUS_CASE_ALLOCATION",
        }),
      ],
    });
  assert.equal(
    readiness.status,
    "CASE_PROOF_NOT_READY"
  );
  assert.equal(
    readiness.blockingBindingStates[0]?.state,
    "AMBIGUOUS_CASE_ALLOCATION"
  );
});

test("raw manual prose cannot substitute for stable obligation identity", () => {
  const currentResult = {
    caseProofReadiness:
      auditBrowserCaseProofReadiness({
        testCase: browserCase(),
        discharges: [],
        browserObligationBindings: [
          allocation(),
        ],
      }),
  };
  assert.match(
    getBrowserAcceptanceCoverageGapReason({
      testCase: browserCase({
        manualChecks: [
          ledger().obligations[0]!.text,
        ],
      }),
      currentResult,
    })!,
    /acceptance check remains/
  );
});

test("exact complete stable discharge removes redundant raw manual prose", () => {
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
  };
  applyBrowserLocalStateObligationDischarge({
    ...dischargeArgs(),
    currentResult,
  });
  assert.deepEqual(
    getRemainingBrowserManualAcceptanceChecks(
      browserCase({
        manualChecks: [
          "Planner paraphrase of the same allocated requirement.",
        ],
      }),
      currentResult
    ),
    []
  );
});

test("a fabricated readiness marker without exact discharges cannot erase manual prose", () => {
  const testCase = browserCase({
    manualChecks: ["Required acceptance check."],
  });
  assert.deepEqual(
    getRemainingBrowserManualAcceptanceChecks(
      testCase,
      {
        caseProofReadiness: {
          status: "CASE_PROOF_READY",
          allocatedObligationIds: [
            obligationId,
          ],
          provedObligationIds: [
            obligationId,
          ],
          remainingObligationIds: [],
        },
      }
    ),
    ["Required acceptance check."]
  );
});

test("CONTRADICTED evidence does not drive FAIL", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    result: "CONTRADICTED",
  };
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "PROOF_GAP",
  };
  applyBrowserLocalStateObligationDischarge({
    ...args,
    currentResult,
  });
  assert.equal(
    currentResult.status,
    "MANUAL_REQUIRED"
  );
  assert.equal(
    currentResult
      .deterministicObligationDischarges,
    undefined
  );
});

test("transient unsettled evidence remains non-failing", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    settlement: {
      ...args.evidence.settlement,
      alternateValue: false,
    },
    result: "ABSTAINED",
  };
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
  };
  applyBrowserLocalStateObligationDischarge({
    ...args,
    currentResult,
  });
  assert.notEqual(currentResult.status, "FAIL");
});

test("temporary control disappearance remains non-failing", () => {
  const args = dischargeArgs();
  args.evidence = {
    ...args.evidence,
    result: "ABSTAINED",
    reason: "TARGET_SURFACE_LOST",
  };
  const currentResult: any = {
    status: "BLOCKED",
  };
  applyBrowserLocalStateObligationDischarge({
    ...args,
    currentResult,
  });
  assert.notEqual(currentResult.status, "FAIL");
});

test("matching underlying value without displayed corroboration does not false-fail", () => {
  const input = confirmedEvidence();
  const {
    displayedValue:
      _initialDisplay,
    ...initialState
  } = input.bindings
    .valueInitial.state;
  const {
    displayedValue:
      _alternateDisplay,
    ...alternateState
  } = input.bindings
    .valueAlternate.state;
  const {
    displayedValue:
      _resetDisplay,
    ...resetState
  } = input.bindings
    .valueReset.state;
  const result = evaluateBrowserLocalStateTransition({
    ...input,
    bindings: {
      ...input.bindings,
      valueInitial: {
        ...input.bindings.valueInitial,
        state: initialState,
      },
      valueAlternate: {
        ...input.bindings.valueAlternate,
        state: alternateState,
      },
      valueReset: {
        ...input.bindings.valueReset,
        state: resetState,
      },
    },
  });
  assert.equal(result.result, "CONFIRMED");
});

test("expected Cancel and reopen restoration remains confirmed", () => {
  const result = confirmedEvidence();
  assert.equal(result.result, "CONFIRMED");
  assert.equal(
    result.restore.draftDiscardVerified,
    true
  );
});

test("missing proof stays a coverage gap and never creates FAIL", () => {
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
    caseProofReadiness:
      auditBrowserCaseProofReadiness({
        testCase: browserCase(),
        discharges: [],
        browserObligationBindings: [
          allocation(),
        ],
      }),
  };
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase: browserCase(),
    review: {
      verdict: "INCONCLUSIVE",
      confidence: "high",
    },
    source: "screenshot",
  });
  assert.equal(
    currentResult.status,
    "MANUAL_REQUIRED"
  );
});

test("confirmed discharge cannot promote a raw manual result to PASS", () => {
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "PROOF_GAP",
  };
  applyBrowserLocalStateObligationDischarge({
    ...dischargeArgs(),
    currentResult,
  });
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase: browserCase(),
    review: {
      verdict: "PASS_CONFIRMED",
      confidence: "high",
    },
    source: "screenshot",
  });
  assert.equal(
    currentResult.status,
    "MANUAL_REQUIRED"
  );
  assert.equal(
    currentResult.caseProofReadiness.status,
    "CASE_PROOF_READY"
  );
});

test("confirmed complete discharge only retains an independently raw PASS", () => {
  const currentResult: any = {
    status: "PASS",
    reasonCategory:
      "ACCEPTANCE_ASSERTIONS_PASSED",
  };
  applyBrowserLocalStateObligationDischarge({
    ...dischargeArgs(),
    currentResult,
  });
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase: browserCase(),
    review: {
      verdict: "PASS_CONFIRMED",
      confidence: "high",
    },
    source: "screenshot",
  });
  assert.equal(currentResult.status, "PASS");
});
