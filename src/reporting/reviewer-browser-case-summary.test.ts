import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTestCase,
  PlannerBrowserObligationBinding,
  TestPlan,
} from "../planner/types.js";
import type {
  BrowserGroundedLocalStateTransitionEvidence,
} from "../agents/browser/browser-local-state-transition-proof.js";
import {
  buildReviewerBrowserCaseSummaries,
  renderReviewerBrowserQaSection,
  type ReviewerBrowserResultInput,
} from "./reviewer-browser-case-summary.js";

const obligation = {
  id: "obligation-1",
  sourceUnitIds: ["source-1"],
  sourceRole: "ACCEPTANCE" as const,
  derivation:
    "DIRECT_ACCEPTANCE_FIELD" as const,
  text:
    "Reset restores the source-authorized default value.",
};

function supportedBinding(
  obligationId = obligation.id
): PlannerBrowserObligationBinding {
  return {
    obligationId,
    sourceUnitIds: ["source-1"],
    semanticFamily: "STATE_TRANSITION",
    state: "SUPPORTED_AND_BOUND",
    allocatedCaseIds: ["web-1"],
    reason: "A typed source-backed requirement is bound.",
    emittedRequirementIds: ["requirement-1"],
  };
}

function typedCase(
  overrides: Partial<BrowserTestCase> = {}
): BrowserTestCase {
  return {
    id: "web-1",
    persona: "company_admin",
    goal:
      "Open the editor and verify the reset behavior.",
    startRoute: "/editor",
    successCriteria:
      "The reset behavior is verified.",
    automatedChecks: [],
    manualChecks: [],
    fixtureRequirements: [],
    acceptanceObligationIds: [obligation.id],
    acceptanceScope: {
      requiresBehaviorProof: true,
      behaviorClaims: [obligation.text],
      localControlStateTransitionRequirements: [
        {
          kind:
            "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
          requirementId: "requirement-1",
          obligationId: obligation.id,
          sourceRefs: [
            {
              sourceUnitId: "source-1",
              sourceRef: "jira:acceptance:1",
              sourceRole: "ACCEPTANCE",
            },
          ],
          authority: {
            sourceRole: "ACCEPTANCE",
            proofAuthority: "ACCEPTANCE",
          },
          transition: {
            semantic:
              "RESET_RESTORES_DEFAULT",
            expectedValue: 5,
            expectedValueAuthority:
              "JIRA_AUTHORIZED",
          },
          structuralBinding: {
            sourceEvidenceRefs: [
              "frontend:control-definition",
            ],
            valueBinding: {
              evidenceKind:
                "LABELLED_DEFAULT_PROPERTY",
              sourceLabel: "Default value",
              sourceProperty: "defaultValue",
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

function plan(args: {
  testCase?: BrowserTestCase;
  bindings?: PlannerBrowserObligationBinding[];
  includeAuthority?: boolean;
  extraObligation?: boolean;
} = {}): TestPlan {
  const testCase = args.testCase ?? typedCase();
  const obligations = args.extraObligation
    ? [
        obligation,
        {
          ...obligation,
          id: "obligation-2",
          text: "A second behavior remains verified.",
        },
      ]
    : [obligation];

  return {
    issueKey: "ISSUE",
    summary: "Reviewer reporting fixture",
    acceptanceObligationLedger:
      args.includeAuthority === false
        ? {
            sourceStatus: "RESOLVED",
            derivationStatus:
              "NO_HIGH_CONFIDENCE_OBLIGATIONS",
            obligations: [],
            unresolvedSourceUnitIds: [],
          }
        : {
            sourceStatus: "RESOLVED",
            derivationStatus: "RESOLVED",
            obligations,
            unresolvedSourceUnitIds: [],
          },
    browserObligationBindings:
      args.bindings ?? [supportedBinding()],
    apiCases: [],
    browserCases: [testCase],
  };
}

function summary(
  testPlan: TestPlan,
  result?: ReviewerBrowserResultInput
) {
  return buildReviewerBrowserCaseSummaries({
    plan: testPlan,
    browserResults: result ? [result] : [],
  })[0]!;
}

test(
  "keeps positive screenshot review supplementary and not proved",
  () => {
    const testPlan = plan();
    const output = summary(testPlan, {
      id: "web-1",
      status: "MANUAL_REQUIRED",
      reasonCategory: "AUTOMATION_LIMITATION",
      evidenceReview: {
        verdict: "PASS_CONFIRMED",
        confidence: "high",
        rationale: "The expected visual state is visible.",
        visibleEvidence: ["The editor is visible."],
        recommendedStatus: "PASS",
      },
    });

    assert.equal(
      output.authoritativeObligations[0]?.proofState,
      "SUPPORTED_NOT_PROVED"
    );
    assert.equal(output.verified.length, 0);
    assert.match(
      output.observedButNotProved.join(" "),
      /supplementary/i
    );
    assert.match(
      output.observedButNotProved.join(" "),
      /editor is visible/i
    );
    assert.equal(output.finalStatus, "MANUAL_REQUIRED");
  }
);

test(
  "renders unsupported authority without relabeling it manual by nature",
  () => {
    const binding: PlannerBrowserObligationBinding = {
      ...supportedBinding(),
      state: "UNSUPPORTED_AUTOMATION_SEMANTIC",
      emittedRequirementIds: [],
    };
    const output = summary(
      plan({ bindings: [binding] })
    );

    assert.equal(
      output.authoritativeObligations[0]
        ?.automationSupport,
      "UNSUPPORTED"
    );
    assert.equal(
      output.authoritativeObligations[0]?.proofState,
      "UNSUPPORTED_AUTOMATION"
    );
    assert.notEqual(
      output.authoritativeObligations[0]
        ?.bindingState,
      "MANUAL_BY_NATURE"
    );
  }
);

test(
  "does not invent authority from goal or manual-check prose",
  () => {
    const testCase = typedCase({
      acceptanceObligationIds: [],
      manualChecks: [obligation.text],
      goal: obligation.text,
    });
    delete testCase.acceptanceScope;
    const output = summary(
      plan({
        testCase,
        bindings: [],
        includeAuthority: false,
      })
    );

    assert.equal(output.authorityEstablished, false);
    assert.equal(
      output.authoritativeObligations.length,
      0
    );
    assert.ok(
      output.blockers.some(
        (item) => item.family === "AUTHORITY"
      )
    );
  }
);

test(
  "V2 stable runtime allocation outranks stale legacy case IDs without creating proof",
  () => {
    const testCase = typedCase({
      id: "web-runtime-fixture-1",
      deterministicProofBindings: [{
        schemaVersion: 1,
        bindingId: "proof-binding-1",
        evidenceContractId: "evidence-contract-1",
        obligationId: obligation.id,
        executionCaseId: "web-1",
        capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE",
        authority: "SOURCE_AUTHORIZED",
        assertion: {
          action: "assertTextVisible",
          oracleId: "oracle-1",
          expectedText: obligation.text,
          sourceUnitId: "source-1",
          sourceRef: "jira:acceptance:1",
        },
        surface: {
          kind: "EXPANDED_DETAIL_SURFACE",
          sourceUnitId: "source-1",
          sourceRef: "jira:acceptance:1",
        },
        runtimePreconditions: {
          persona: "company_admin",
          route: "/editor",
          requiresRuntimeFixtureBinding: true,
        },
        acceptanceCoverage: {
          policy: "ALL_REQUIRED",
          requiredMemberIds: ["member-1"],
          plannedMemberIds: ["member-1"],
          memberId: "member-1",
        },
      }],
    });
    const staleBinding: PlannerBrowserObligationBinding = {
      ...supportedBinding(),
      state: "UNALLOCATED_AUTHORITATIVE_OBLIGATION",
      allocatedCaseIds: [],
      emittedRequirementIds: [],
    };
    const testPlan = plan({
      testCase,
      bindings: [staleBinding],
    });
    testPlan.browserSemanticPlanningAudit = {
      version: "V2",
      status: "APPLIED",
      authoritativeObligationCount: 1,
      accountedObligationIds: [obligation.id],
      unaccountedObligationIds: [],
      verdictGroupCount: 1,
      authoritativeGroupCount: 0,
      unknownGroupCount: 1,
      allocatedCaseCount: 1,
      ticketManualObligationIds: [],
      policyBlockedObligationIds: [],
      unsupportedObligationIds: [],
      targetUnresolvedObligationIds: [],
      fixtureUnavailableObligationIds: [],
      unallocatedBudgetObligationIds: [],
      manualCouplingViolationCount: 0,
      duplicateObligationCoverageCount: 0,
      hallucinatedAuthorityCount: 0,
      contracts: [],
    };
    testPlan.obligationCaseAllocationAudit = {
      obligationCount: 1,
      stableIdCaseRepresentationCount: 1,
      exactCaseRepresentationCount: 0,
      exactRepresentationRemovedCount: 0,
      notesOnlyCount: 0,
      notExactlyRepresentedCount: 0,
      allocations: [{
        obligationId: obligation.id,
        status: "STABLE_ID_CASE_REPRESENTATION",
        matchedCaseIds: [testCase.id],
        removedCaseIds: [],
      }],
    };

    const output = summary(testPlan, {
      id: testCase.id,
      status: "BLOCKED",
      reasonCategory: "TEST_DATA_ISSUE",
    });

    assert.equal(
      output.authoritativeObligations[0]?.bindingState,
      "V2_RUNTIME_CASE_REPRESENTED"
    );
    assert.equal(
      output.authoritativeObligations[0]?.automationSupport,
      "SUPPORTED"
    );
    assert.equal(
      output.authoritativeObligations[0]?.proofState,
      "BLOCKED_BY_TEST_DATA"
    );
    assert.equal(
      output.blockers.some(
        (item) => item.family === "CASE_REPRESENTATION"
      ),
      false
    );
    assert.equal(
      output.blockers.some(
        (item) => item.family === "TYPED_AUTOMATION_SUPPORT"
      ),
      false
    );
    assert.equal(output.finalStatus, "BLOCKED");
  }
);

test(
  "separates fixture unavailability as a test-data blocker",
  () => {
    const output = summary(plan(), {
      id: "web-1",
      status: "BLOCKED",
      reasonCategory: "TEST_DATA_ISSUE",
    });

    assert.equal(output.fixture.state, "UNAVAILABLE");
    assert.ok(
      output.blockers.some(
        (item) => item.family === "FIXTURE_DATA"
      )
    );
  }
);

test(
  "reports an unresolved route without inventing a target blocker",
  () => {
    const output = summary(plan(), {
      id: "web-1",
      status: "BLOCKED",
      reasonCategory: "MISSING_BROWSER_ROUTE",
      terminationReason: "MISSING_ROUTE",
    });

    assert.equal(output.route.state, "UNRESOLVED");
    assert.equal(output.target.state, "UNKNOWN");
    assert.ok(
      output.blockers.some(
        (item) => item.family === "ROUTE"
      )
    );
    assert.equal(
      output.blockers.some(
        (item) => item.family === "TARGET"
      ),
      false
    );
  }
);

test(
  "preserves target ambiguity as a runtime-grounding blocker",
  () => {
    const output = summary(plan(), {
      id: "web-1",
      status: "MANUAL_REQUIRED",
      reasonCategory: "AUTOMATION_LIMITATION",
      terminationReason: "GROUNDING_AMBIGUITY",
    });

    assert.equal(output.target.state, "AMBIGUOUS");
    assert.ok(
      output.blockers.some(
        (item) =>
          item.family === "RUNTIME_GROUNDING"
      )
    );
    assert.equal(
      output.blockers.some(
        (item) => item.family === "ROUTE"
      ),
      false
    );
  }
);

test(
  "renders typed proof abstention as grounding, not proof",
  () => {
    const abstention = {
      kind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      proofRequirementId: "requirement-1",
      obligationId: obligation.id,
      result: "ABSTAINED",
      reason: "CONTROL_NOT_GROUNDED",
    } satisfies Pick<
      BrowserGroundedLocalStateTransitionEvidence,
      | "kind"
      | "proofRequirementId"
      | "obligationId"
      | "result"
      | "reason"
    >;
    const output = summary(plan(), {
      id: "web-1",
      status: "MANUAL_REQUIRED",
      localStateTransitionEvidence: [
        abstention as
          BrowserGroundedLocalStateTransitionEvidence,
      ],
    });

    assert.equal(
      output.authoritativeObligations[0]?.proofState,
      "BLOCKED_BY_GROUNDING"
    );
    assert.ok(
      output.blockers.some(
        (item) =>
          item.family === "RUNTIME_GROUNDING" &&
          item.typedReason === "CONTROL_NOT_GROUNDED"
      )
    );
    assert.equal(output.verified.length, 0);
  }
);

test(
  "renders only an exact deterministic discharge as obligation PROVED",
  () => {
    const output = summary(plan(), {
      id: "web-1",
      status: "MANUAL_REQUIRED",
      reasonCategory: "AUTOMATION_LIMITATION",
      deterministicObligationDischarges: [
        {
          kind:
            "DETERMINISTIC_OBLIGATION_PROVED",
          obligationId: obligation.id,
          sourceId: "source-1",
          proofRequirementId: "requirement-1",
          proofKind:
            "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
          evidenceResult: "CONFIRMED",
          note: "Exact proof was independently revalidated.",
        },
      ],
      caseProofReadiness: {
        status: "CASE_PROOF_READY",
        allocatedObligationIds: [obligation.id],
        provedObligationIds: [obligation.id],
        remainingObligationIds: [],
        blockingBindingStates: [],
        note: "All exact obligations are discharged.",
      },
    });

    assert.equal(
      output.authoritativeObligations[0]?.proofState,
      "PROVED"
    );
    assert.equal(
      output.caseProofReadiness,
      "CASE_PROOF_READY"
    );
    assert.equal(output.finalStatus, "MANUAL_REQUIRED");
    assert.match(output.verified[0] ?? "", /discharged/);
  }
);

test(
  "keeps other allocated obligations visible when only one is proved",
  () => {
    const testCase = typedCase({
      acceptanceObligationIds: [
        "obligation-1",
        "obligation-2",
      ],
    });
    const output = summary(
      plan({
        testCase,
        extraObligation: true,
        bindings: [
          supportedBinding("obligation-1"),
          {
            ...supportedBinding("obligation-2"),
            emittedRequirementIds: [],
          },
        ],
      }),
      {
        id: "web-1",
        status: "MANUAL_REQUIRED",
        deterministicObligationDischarges: [
          {
            kind:
              "DETERMINISTIC_OBLIGATION_PROVED",
            obligationId: "obligation-1",
            sourceId: "source-1",
            proofRequirementId: "requirement-1",
            proofKind:
              "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
            evidenceResult: "CONFIRMED",
            note: "Exact proof.",
          },
        ],
      }
    );

    assert.deepEqual(
      output.authoritativeObligations.map(
        (item) => item.proofState
      ),
      ["PROVED", "SUPPORTED_NOT_PROVED"]
    );
    assert.match(
      output.unverified.join(" "),
      /obligation-2/
    );
  }
);

test(
  "does not reconstruct typed support from an emitted requirement ID",
  () => {
    const testCase = typedCase({
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [obligation.text],
      },
    });
    const output = summary(plan({ testCase }));

    assert.equal(
      output.authoritativeObligations[0]
        ?.automationSupport,
      "NOT_ESTABLISHED"
    );
    assert.ok(
      output.blockers.some(
        (item) =>
          item.family ===
            "TYPED_AUTOMATION_SUPPORT" &&
          /does not reconstruct/i.test(
            item.explanation
          )
      )
    );
  }
);

test(
  "projection and rendering never mutate verdict or proof inputs",
  () => {
    const testPlan = plan();
    const results: ReviewerBrowserResultInput[] = [
      {
        id: "web-1",
        status: "BLOCKED",
        reasonCategory: "TEST_DATA_ISSUE",
        deterministicObligationDischarges: [],
      },
    ];
    const before = JSON.stringify({ testPlan, results });

    buildReviewerBrowserCaseSummaries({
      plan: testPlan,
      browserResults: results,
    });
    const markdown = renderReviewerBrowserQaSection({
      plan: testPlan,
      browserResults: results,
    });

    assert.equal(JSON.stringify({ testPlan, results }), before);
    assert.equal(results[0]?.status, "BLOCKED");
    assert.deepEqual(
      results[0]?.deterministicObligationDischarges,
      []
    );
    assert.match(markdown, /Final:\*\* BLOCKED/);
    assert.doesNotMatch(markdown, /Final:\*\* PASS/);
  }
);

test(
  "renders deterministic and supplementary evidence in visibly separate groups",
  () => {
    const markdown = renderReviewerBrowserQaSection({
      plan: plan(),
      browserResults: [
        {
          id: "web-1",
          status: "MANUAL_REQUIRED",
          deterministicEvidence: [
            {
              stepIndex: 1,
              action: "assertTextVisible",
              expected: "Editor",
              passed: true,
              note: "Visible text matched.",
            },
          ],
          checkpointEvidence: [
            {
              stepIndex: 1,
              action: "assertTextVisible",
              label: "Editor visible",
              note: "Captured after observation.",
              screenshotPath: "evidence/editor.png",
              url: "https://example.test/editor",
            },
          ],
        },
      ],
    });

    assert.match(markdown, /Deterministically verified/);
    assert.match(markdown, /narrow deterministic check; not an obligation discharge/);
    assert.match(markdown, /Observed but not proved — supplementary/);
    assert.match(markdown, /SUPPLEMENTARY \/ SCREENSHOT_CHECKPOINT/);
  }
);
