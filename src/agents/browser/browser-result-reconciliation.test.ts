import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserAcceptanceCoverageGapReason,
  reconcileBrowserResultFromEvidence,
} from "./browser-result-reconciliation.js";

test("review cannot override a completed canonical case verdict", () => {
  const currentResult: any = {
    status: "PASS",
    reasonCategory: "ALL_REQUIRED_CHECKS_CONFIRMED",
    caseVerdict: {
      verdict: "PASS",
      reason: "ALL_REQUIRED_CHECKS_CONFIRMED",
      requiredCheckIds: ["check-a"],
      passedCheckIds: ["check-a"],
      failedCheckIds: [],
      missingCheckIds: [],
    },
    trace: [],
  };
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase: {},
    review: { verdict: "INCONCLUSIVE", confidence: "low" },
    source: "screenshot",
  });
  assert.equal(currentResult.status, "PASS");
  assert.equal(currentResult.reasonCategory, "ALL_REQUIRED_CHECKS_CONFIRMED");
  assert.equal(currentResult.evidenceReconciliationAudit[0].decision, "CASE_VERDICT_CANONICAL");
});

test(
  "link visibility alone cannot confirm navigation behavior",
  () => {
    const reason =
      getBrowserAcceptanceCoverageGapReason({
        testCase: {
          goal:
            "Verify that a native link in the Compliance Document PDF is clickable and navigates to its target.",
          automatedChecks: [
            'Verify "Compliance Document" is visible.',
          ],
          steps: [
            {
              action: "assertTextVisible",
              text: "Compliance Document",
            },
          ],
        },
        currentResult: {
          deterministicEvidence: [
            {
              action: "assertTextVisible",
              passed: true,
            },
          ],
          trace: [],
        },
      });

    assert.match(
      String(reason),
      /link interaction/
    );
  }
);

test(
  "inflected link navigation requirement survives optimistic review when only its label is proven",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: true,
        },
      ],
      trace: [
        {
          action: "browser-step",
          status: "PASS",
          note:
            'assert visible "Compliance Document": PASS',
        },
      ],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        goal:
          "Verify that native links in a document are clickable while the document remains read-only.",
        successCriteria:
          "Clicking native links activates their intended destinations.",
        automatedChecks: [
          'Verify "Compliance Document" is visible.',
        ],
        steps: [
          {
            action: "assertTextVisible",
            text: "Compliance Document",
          },
        ],
        acceptanceScope: {
          requiresBehaviorProof: true,
          behaviorClaims: [
            "Clicking native links activates their intended destinations.",
          ],
        },
      },
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
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );
    assert.equal(
      currentResult.successSignalReached,
      false
    );
  }
);

test(
  "sort option visibility alone cannot confirm record ordering",
  () => {
    const reason =
      getBrowserAcceptanceCoverageGapReason({
        testCase: {
          goal:
            "Verify that the Jobs List exposes sorting modes and applies the correct date-based ordering.",
          automatedChecks: [
            'Verify "newest" is visible.',
            'Verify "latest" is visible.',
            'Verify "oldest" is visible.',
          ],
          steps: [
            {
              action: "openMenu",
              text: "Sort",
            },
          ],
        },
        currentResult: {
          deterministicEvidence: [],
          trace: [],
        },
      });

    assert.match(
      String(reason),
      /record order/
    );
  }
);

test(
  "wizard label visibility alone cannot confirm optional empty-state flow continuity",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: true,
        },
      ],
      trace: [],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        id: "web-empty-flow",
        goal: "Verify the optional wizard step.",
        successCriteria:
          "The wizard supports zero optional items without preventing the remaining flow from continuing normally.",
        automatedChecks: [
          'Verify "Optional items" is visible.',
        ],
        steps: [
          {
            action: "assertTextVisible",
            text: "Optional items",
          },
        ],
      },
      review: {
        verdict: "PASS_CONFIRMED",
        confidence: "high",
        rationale: "The wizard label is visible.",
        visibleEvidence: [
          "Optional items is visible.",
        ],
      },
      source: "screenshot",
    });

    assert.equal(
      currentResult.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );
  }
);

test(
  "shared visible copy cannot prove Jira-grounded separate UI entities even when the reviewer reports a product bug",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          expected: "Text is visible: Listening",
          passed: true,
        },
        {
          action: "assertTextVisible",
          expected: "Text is visible: Speaking",
          passed: true,
        },
      ],
      trace: [],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        id: "web-structural-text",
        goal:
          "Verify four separate proficiency controls.",
        successCriteria:
          "Listening and Speaking are visible.",
        acceptanceScope: {
          requiresBehaviorProof: true,
          behaviorClaims: [
            "Verify four separate proficiency controls.",
          ],
        },
        steps: [
          {
            action: "assertTextVisible",
            text: "Listening",
          },
          {
            action: "assertTextVisible",
            text: "Speaking",
          },
        ],
      },
      review: {
        verdict: "PRODUCT_BUG",
        confidence: "high",
        rationale:
          "Only one explanatory paragraph is visible.",
        visibleEvidence: [],
      },
      source: "screenshot",
    });

    assert.equal(
      currentResult.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );
    assert.equal(
      currentResult.successSignalReached,
      false
    );
  }
);

test(
  "remaining manual acceptance coverage prevents whole-case PASS",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: true,
        },
      ],
      trace: [],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        id: "web-manual-coverage",
        goal:
          "Verify that the Jobs list exposes its sorting choices.",
        successCriteria:
          "The Jobs list presents newest, latest, and oldest.",
        automatedChecks: [
          'Verify "newest" is visible.',
          'Verify "latest" is visible.',
          'Verify "oldest" is visible.',
        ],
        manualChecks: [
          "Verify the resulting record ordering separately.",
        ],
        steps: [
          {
            action: "assertTextVisible",
            text: "newest",
          },
        ],
      },
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
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );
    assert.equal(
      currentResult.successSignalReached,
      false
    );
  }
);

test(
  "ordinary text acceptance remains eligible for PASS",
  () => {
    const reason =
      getBrowserAcceptanceCoverageGapReason({
        testCase: {
          goal:
            "Verify the updated Work Setups helper text.",
          automatedChecks: [
            'Verify "Complete the following work setups to get started." is visible.',
          ],
        },
        currentResult: {
          deterministicEvidence: [
            {
              action: "assertTextVisible",
              passed: true,
            },
          ],
          trace: [],
        },
      });

    assert.equal(reason, null);
  }
);

test(
  "high-confidence PASS is downgraded when acceptance coverage is missing",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: true,
        },
      ],
      trace: [
        {
          action: "final-status",
          status: "PASS",
          note:
            "Final browser case status: PASS",
        },
      ],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        goal:
          "Verify that a native link in the Compliance Document PDF is clickable and navigates to its target.",
        automatedChecks: [
          'Verify "Compliance Document" is visible.',
        ],
      },
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
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );

    assert.equal(
      currentResult.successSignalReached,
      false
    );
  }
);


test(
  "reviewer label variance does not change a retainable deterministic FAIL",
  () => {
    const buildCurrentResult = () => ({
      status: "FAIL",
      successSignalReached: false,
      reasonCategory:
        "DETERMINISTIC_URL_ASSERTION_FAILED",
      deterministicEvidence: [
        {
          action: "assertTextNotVisible",
          passed: false,
        },
      ],
      trace: [
        {
          action: "evidence-checkpoint",
          status: "PASS",
        },
      ],
    });

    const productBugResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult: productBugResult,
      testCase: {
        goal:
          'Verify legacy language label "Receptive" is not visible.',
        automatedChecks: [
          'Verify "Receptive" is not visible.',
        ],
      },
      review: {
        verdict: "PRODUCT_BUG",
        confidence: "medium",
      },
      source: "screenshot",
    });

    assert.equal(
      productBugResult.status,
      "FAIL"
    );

    const automationLimitationResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult:
        automationLimitationResult,
      testCase: {
        goal:
          'Verify legacy language label "Receptive" is not visible.',
        automatedChecks: [
          'Verify "Receptive" is not visible.',
        ],
      },
      review: {
        verdict: "AUTOMATION_LIMITATION",
        confidence: "high",
      },
      source: "screenshot",
    });

    assert.equal(
      automationLimitationResult.status,
      "FAIL"
    );

    assert.equal(
      productBugResult.status,
      automationLimitationResult.status
    );
  }
);
test(
  "medium-confidence PRODUCT_BUG cannot downgrade a retainable deterministic FAIL without an unverified oracle dependency",
  () => {
    const currentResult: any = {
      status: "FAIL",
      successSignalReached: false,
      reasonCategory:
        "DETERMINISTIC_URL_ASSERTION_FAILED",
      deterministicEvidence: [
        {
          action: "assertTextNotVisible",
          passed: false,
        },
      ],
      trace: [
        {
          action: "evidence-checkpoint",
          status: "PASS",
        },
      ],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        goal:
          'Verify legacy language label "Receptive" is not visible.',
        automatedChecks: [
          'Verify "Receptive" is not visible.',
        ],
      },
      review: {
        verdict: "PRODUCT_BUG",
        confidence: "medium",
      },
      source: "screenshot",
    });

    assert.equal(
      currentResult.status,
      "FAIL"
    );
  }
);

test(
  "unverified oracle dependency may still downgrade a deterministic UI failure",
  () => {
    const currentResult: any = {
      status: "FAIL",
      successSignalReached: false,
      reasonCategory:
        "DETERMINISTIC_URL_ASSERTION_FAILED",
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: false,
        },
      ],
      trace: [
        {
          action: "evidence-checkpoint",
          status: "PASS",
        },
      ],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        goal:
          "Verify a seeded fixture-specific record is visible.",
        automatedChecks: [
          "Verify the seeded record is visible.",
        ],
      },
      review: {
        verdict: "PRODUCT_BUG",
        confidence: "medium",
      },
      source: "screenshot",
    });

    assert.equal(
      currentResult.status,
      "MANUAL_REQUIRED"
    );

    assert.equal(
      currentResult.reasonCategory,
      "UNVERIFIED_TEST_ORACLE"
    );
  }
);

test(
  "behavior-proof requirement is audited without changing the existing verdict",
  () => {
    const currentResult: any = {
      status: "PASS",
      successSignalReached: true,
      deterministicEvidence: [
        {
          action: "assertTextVisible",
          passed: true,
        },
      ],
      trace: [
        {
          action: "final-status",
          status: "PASS",
          note:
            "Final browser case status: PASS",
        },
      ],
    };

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase: {
        goal:
          "Verify a control exposes its selected state.",
        automatedChecks: [
          'Verify "Alpha" is visible.',
        ],
        acceptanceScope: {
          requiresBehaviorProof: true,
          behaviorClaims: [
            "After an option is selected, the visible selected value is correct.",
          ],
        },
      },
      review: {
        verdict: "PASS_CONFIRMED",
        confidence: "high",
      },
      source: "screenshot",
    });

    /*
     * Phase 2 acceptance scope is requirement
     * metadata only. It must not alter the verdict
     * before a structured satisfaction mechanism
     * exists.
     */
    assert.equal(
      currentResult.status,
      "PASS"
    );

    assert.equal(
      currentResult.reasonCategory,
      "PASS_EVIDENCE_CONFIRMED"
    );

    const scopeAudit =
      currentResult
        .reconciliationAudit
        ?.find(
          (entry: any) =>
            entry.decision ===
            "BEHAVIOR_PROOF_REQUIREMENT_PRESENT"
        );

    assert.ok(scopeAudit);

    assert.deepEqual(
      scopeAudit.behaviorClaims,
      [
        "After an option is selected, the visible selected value is correct.",
      ]
    );

    /*
     * The existing prose guard does not know about
     * selected-state coverage. Recording that
     * disagreement is the purpose of Phase 2C.
     */
    assert.equal(
      scopeAudit
        .legacyAcceptanceCoverageGapDetected,
      false
    );

    /*
     * Requirement data stays owned by testCase;
     * reconciliation must not create a second
     * acceptanceScope source of truth on result.
     */
    assert.equal(
      currentResult.acceptanceScope,
      undefined
    );
  }
);

test(
  "URL_TRANSITION structured proof is audited without changing the existing reconciliation verdict",
  () => {
    const buildCurrentResult = () => ({
      status: "PASS",
      successSignalReached: true,

      interactionExecutionEvidence: [
        {
          stepIndex: 1,
          interactionId:
            "web-nav:interaction-1",
          action: "clickText",
          succeeded: true,
          note:
            'clicked text "Details"',
        },
      ],

      deterministicEvidence: [
        {
          stepIndex: 2,
          oracleId:
            "web-nav:assertion-1",
          action:
            "assertUrlContains",
          expected:
            'URL contains "/details"',
          actualUrl:
            "https://example.test/details",
          passed: true,
          note:
            'assert URL contains "/details": PASS',
        },
      ],

      trace: [
        {
          action: "final-status",
          status: "PASS",
          note:
            "Final browser case status: PASS",
        },
      ],
    });

    const baseTestCase = {
      id: "web-nav",
      goal:
        "Open the Details link and navigate to the details page.",
      successCriteria:
        "Opening the Details link navigates to the details page.",
      automatedChecks: [
        'Verify the URL contains "/details".',
      ],
      steps: [
        {
          action: "clickText",
          text: "Details",
          interactionId:
            "web-nav:interaction-1",
        },
        {
          action:
            "assertUrlContains",
          text: "/details",
          oracleId:
            "web-nav:assertion-1",
        },
      ],
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "Opening the Details link navigates to the details page.",
        ],
      },
    };

    const baselineResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult:
        baselineResult,
      testCase:
        baseTestCase,
      review: {
        verdict:
          "PASS_CONFIRMED",
        confidence: "high",
      },
      source: "screenshot",
    });

    const structuredResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult:
        structuredResult,
      testCase: {
        ...baseTestCase,
        acceptanceScope: {
          ...baseTestCase
            .acceptanceScope,

          urlTransitionRequirements: [
            {
              kind:
                "URL_TRANSITION",
              sourceClaim:
                "Opening the Details link navigates to the details page.",
              interactionId:
                "web-nav:interaction-1",
              urlAssertionOracleId:
                "web-nav:assertion-1",
            },
          ],
        },
      },
      review: {
        verdict:
          "PASS_CONFIRMED",
        confidence: "high",
      },
      source: "screenshot",
    });

    /*
     * Phase 3B is instrumentation only.
     * Adding structured requirements must not
     * change the existing reconciliation result.
     */
    assert.equal(
      structuredResult.status,
      baselineResult.status
    );

    assert.equal(
      structuredResult.reasonCategory,
      baselineResult.reasonCategory
    );

    const parityAudit =
      structuredResult
        .reconciliationAudit
        ?.find(
          (entry: any) =>
            entry.decision ===
            "URL_TRANSITION_PROOF_PARITY"
        );

    assert.ok(parityAudit);

    assert.equal(
      parityAudit
        .urlTransitionRequirementCount,
      1
    );

    assert.equal(
      parityAudit
        .urlTransitionSatisfiedCount,
      1
    );

    assert.equal(
      parityAudit
        .urlTransitionUnsatisfiedCount,
      0
    );

    assert.equal(
      parityAudit
        .urlTransitionAllSatisfied,
      true
    );

    assert.equal(
      typeof parityAudit
        .legacyAcceptanceCoverageGapDetected,
      "boolean"
    );
  }
);

test(
  "SELECTED_STATE structured proof is audited without changing the existing reconciliation verdict",
  () => {
    const buildCurrentResult = () => ({
      status: "PASS",
      successSignalReached: true,
      interactionExecutionEvidence: [
        {
          stepIndex: 1,
          interactionId:
            "web-filter:interaction-1",
          action:
            "selectRuntimeFilterOption",
          succeeded: true,
          note:
            'selected filter option "Active"',
        },
      ],
      deterministicEvidence: [
        {
          stepIndex: 1,
          oracleId:
            "web-filter:assertion-1",
          action:
            "selectRuntimeFilterOption",
          verificationMode:
            "visible-state",
          targetSelectedLabel:
            "Active",
          observedSelectedLabel:
            "Active",
          expected:
            "Select Active and observe Active",
          passed: true,
          note:
            "exact selected label observed",
        },
      ],
      trace: [
        {
          action: "final-status",
          status: "PASS",
          note:
            "Final browser case status: PASS",
        },
      ],
    });

    const baseTestCase = {
      id: "web-filter",
      goal:
        "Verify the visible selected filter state.",
      successCriteria:
        "After an option is selected, the visible selected filter value is correct.",
      automatedChecks: [
        "After an option is selected, the visible selected filter value is correct.",
      ],
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [
          "After an option is selected, the visible selected filter value is correct.",
        ],
      },
    };

    const baselineResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult: baselineResult,
      testCase: baseTestCase,
      review: {
        verdict: "PASS_CONFIRMED",
        confidence: "high",
      },
      source: "screenshot",
    });

    const structuredResult: any =
      buildCurrentResult();

    reconcileBrowserResultFromEvidence({
      currentResult:
        structuredResult,
      testCase: {
        ...baseTestCase,
        acceptanceScope: {
          ...baseTestCase
            .acceptanceScope,
          selectedStateRequirements: [
            {
              kind:
                "SELECTED_STATE",
              sourceClaim:
                "After an option is selected, the visible selected filter value is correct.",
              interactionId:
                "web-filter:interaction-1",
              selectionOracleId:
                "web-filter:assertion-1",
            },
          ],
        },
      },
      review: {
        verdict: "PASS_CONFIRMED",
        confidence: "high",
      },
      source: "screenshot",
    });

    assert.equal(
      structuredResult.status,
      baselineResult.status
    );
    assert.equal(
      structuredResult.reasonCategory,
      baselineResult.reasonCategory
    );

    const parityAudit =
      structuredResult
        .reconciliationAudit
        ?.find(
          (entry: any) =>
            entry.decision ===
            "SELECTED_STATE_PROOF_PARITY"
        );

    assert.ok(parityAudit);
    assert.equal(
      parityAudit
        .selectedStateRequirementCount,
      1
    );
    assert.equal(
      parityAudit
        .selectedStateSatisfiedCount,
      1
    );
    assert.equal(
      parityAudit
        .selectedStateUnsatisfiedCount,
      0
    );
    assert.equal(
      parityAudit
        .selectedStateAllSatisfied,
      true
    );
    assert.equal(
      Object.hasOwn(
        parityAudit,
        "legacyAcceptanceCoverageGapDetected"
      ),
      false
    );
  }
);

function selectedStateGateCase(): any {
  return {
    id: "web-selected-gate",
    goal: "Verify the visibly selected Status filter value.",
    successCriteria:
      "Selecting a Status option visibly reflects that exact selected value.",
    automatedChecks: [
      "Verify the selected Status filter value is visibly applied.",
    ],
    steps: [
      {
        action: "selectRuntimeFilterOption",
        filterKey: "status",
        hint: "Status",
        verification: "visible-state",
        interactionId: "web-selected-gate:interaction-1",
        oracleId: "web-selected-gate:assertion-1",
      },
    ],
    acceptanceScope: {
      requiresBehaviorProof: true,
      behaviorClaims: [
        "Verify the selected Status filter value is visibly applied.",
      ],
      selectedStateRequirements: [
        {
          kind: "SELECTED_STATE",
          sourceClaim:
            "Verify the selected Status filter value is visibly applied.",
          interactionId: "web-selected-gate:interaction-1",
          selectionOracleId: "web-selected-gate:assertion-1",
        },
      ],
    },
  };
}

function selectedStateGateResult(
  status = "PASS"
): any {
  return {
    status,
    successSignalReached:
      status === "PASS",
    interactionExecutionEvidence: [
      {
        stepIndex: 1,
        interactionId:
          "web-selected-gate:interaction-1",
        action: "selectRuntimeFilterOption",
        succeeded: true,
        note: "selected Active",
      },
    ],
    deterministicEvidence: [
      {
        stepIndex: 1,
        oracleId:
          "web-selected-gate:assertion-1",
        action: "selectRuntimeFilterOption",
        verificationMode: "visible-state",
        targetSelectedLabel: "Active",
        observedSelectedLabel: "Active",
        passed: true,
        note: "exact selected label observed",
      },
    ],
    trace: [
      {
        action: "final-status",
        status,
        note: `Final browser case status: ${status}`,
      },
    ],
  };
}

function reconcileSelectedStateGate(
  currentResult: any,
  testCase: any = selectedStateGateCase()
): void {
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase,
    review: {
      verdict: "PASS_CONFIRMED",
      confidence: "high",
    },
    source: "screenshot",
  });
}

test(
  "satisfied explicit SELECTED_STATE requirement preserves otherwise-valid PASS eligibility",
  () => {
    const currentResult =
      selectedStateGateResult();

    reconcileSelectedStateGate(
      currentResult
    );

    assert.equal(
      currentResult.status,
      "PASS"
    );
    assert.equal(
      currentResult.reasonCategory,
      "PASS_EVIDENCE_CONFIRMED"
    );
  }
);

for (const scenario of [
  {
    name: "missing interaction",
    mutate(result: any) {
      result.interactionExecutionEvidence = [];
    },
  },
  {
    name: "missing oracle",
    mutate(result: any) {
      result.deterministicEvidence = [];
    },
  },
  {
    name: "failed oracle",
    mutate(result: any) {
      result.deterministicEvidence[0].passed = false;
    },
  },
  {
    name: "wrong interaction ID",
    mutate(result: any) {
      result.interactionExecutionEvidence[0].interactionId =
        "web-selected-gate:interaction-2";
    },
  },
  {
    name: "wrong oracle ID",
    mutate(result: any) {
      result.deterministicEvidence[0].oracleId =
        "web-selected-gate:assertion-2";
    },
  },
  {
    name: "URL-mode evidence",
    mutate(result: any) {
      result.deterministicEvidence[0].verificationMode =
        "url";
    },
  },
]) {
  test(
    `${scenario.name} prevents explicit SELECTED_STATE PASS eligibility`,
    () => {
      const currentResult =
        selectedStateGateResult();
      scenario.mutate(currentResult);

      reconcileSelectedStateGate(
        currentResult
      );

      assert.equal(
        currentResult.status,
        "MANUAL_REQUIRED"
      );
      assert.equal(
        currentResult.reasonCategory,
        "ACCEPTANCE_COVERAGE_GAP"
      );
      assert.equal(
        currentResult.successSignalReached,
        false
      );
    }
  );
}

test(
  "no SELECTED_STATE requirement leaves legacy PASS behavior unchanged",
  () => {
    const currentResult =
      selectedStateGateResult();
    const testCase =
      selectedStateGateCase();
    delete testCase.acceptanceScope
      .selectedStateRequirements;

    reconcileSelectedStateGate(
      currentResult,
      testCase
    );

    assert.equal(
      currentResult.status,
      "PASS"
    );
  }
);

test(
  "explicit SELECTED_STATE requirement remains load-bearing if the enclosing flag is malformed",
  () => {
    const currentResult =
      selectedStateGateResult();
    const testCase =
      selectedStateGateCase();
    testCase.acceptanceScope
      .requiresBehaviorProof = false;
    currentResult
      .interactionExecutionEvidence = [];

    reconcileSelectedStateGate(
      currentResult,
      testCase
    );

    assert.equal(
      currentResult.status,
      "MANUAL_REQUIRED"
    );
  }
);

for (const status of [
  "FAIL",
  "BLOCKED",
  "ERROR",
  "MANUAL_REQUIRED",
]) {
  test(
    `satisfied SELECTED_STATE proof does not upgrade ${status}`,
    () => {
      const currentResult =
        selectedStateGateResult(
          status
        );

      reconcileSelectedStateGate(
        currentResult
      );

      assert.equal(
        currentResult.status,
        status
      );
    }
  );
}

test(
  "selected-state satisfaction does not satisfy an unrelated ordering claim",
  () => {
    const currentResult =
      selectedStateGateResult();
    const testCase =
      selectedStateGateCase();
    testCase.goal =
      "Verify selecting Status also orders records correctly.";
    testCase.successCriteria =
      "The resulting records have the correct ordering.";

    reconcileSelectedStateGate(
      currentResult,
      testCase
    );

    assert.equal(
      currentResult.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      currentResult.reasonCategory,
      "ACCEPTANCE_COVERAGE_GAP"
    );
  }
);
