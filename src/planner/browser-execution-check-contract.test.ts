import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTestCase,
  BrowserExecutionCheckContract,
  PlannerBrowserDeterministicProofBinding,
} from "./types.js";
import {
  deriveBrowserExecutionCheckContract,
  hasValidBrowserExecutionCheckContract,
} from "./browser-execution-check-contract.js";
import type {
  BrowserSourceBoundAssertionSetRequirement,
} from "../agents/browser/browser-source-bound-assertion-set-proof.js";

function browserCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  return {
    id: "case-a",
    persona: "company_admin",
    goal: "Verify source-backed behavior.",
    startRoute: "/company/items",
    successCriteria: "The exact member is visible.",
    acceptanceObligationIds: ["obligation-a"],
    executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a"],
      verdictAuthority: "INDEPENDENT",
    },
    steps: [{
      action: "assertTextVisible",
      text: "Exact member",
      oracleId: "case-a:assertion-1",
    }],
    ...overrides,
  };
}

function sourceRequirement(overrides: Partial<BrowserSourceBoundAssertionSetRequirement> = {}): BrowserSourceBoundAssertionSetRequirement {
  return {
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
    semanticFamily: "EXPLICIT_ENUMERATED_PRESENCE",
    memberPolicy: "ALL_REQUIRED",
    members: [{
      action: "assertTextVisible",
      expectedText: "Exact member",
      oracleId: "case-a:assertion-1",
    }],
    ...overrides,
  };
}

function evidenceBinding(): PlannerBrowserDeterministicProofBinding {
  return {
    schemaVersion: 1,
    bindingId: "binding-a",
    evidenceContractId: "contract-a",
    obligationId: "obligation-a",
    executionCaseId: "case-a",
    authority: "SOURCE_AUTHORIZED",
    runtimePreconditions: {
      persona: "company_admin",
      route: "/company/items",
      requiresRuntimeFixtureBinding: false,
    },
    acceptanceCoverage: {
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["member-a"],
      plannedMemberIds: ["member-a"],
      memberId: "member-a",
    },
    capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE",
    assertion: {
      action: "assertTextVisible",
      oracleId: "case-a:assertion-1",
      expectedText: "Exact member",
      sourceUnitId: "source-a",
      sourceRef: "jira:AS-1#acceptance",
    },
    surface: {
      kind: "EXPANDED_DETAIL_SURFACE",
      sourceUnitId: "source-a",
      sourceRef: "jira:AS-1#acceptance",
    },
  };
}

test("source-bound assertion member becomes one stable required check", () => {
  const contract = deriveBrowserExecutionCheckContract({
    testCase: browserCase(),
    sourceBoundAssertionSetRequirements: [sourceRequirement()],
  });
  assert.deepEqual(contract?.requiredChecks, [{
    checkId: "browser-execution-check:29:SOURCE_BOUND_ASSERTION_MEMBER|20:source-requirement-a|18:case-a:assertion-1",
    kind: "SOURCE_BOUND_ASSERTION_MEMBER",
    authority: "SOURCE_AUTHORIZED",
    requirementId: "source-requirement-a",
    oracle: {
      oracleId: "case-a:assertion-1",
      action: "assertTextVisible",
      expectedText: "Exact member",
    },
    sourceUnitIds: ["source-a"],
    sourceRefs: ["jira:AS-1#acceptance"],
  }]);
});

test("MODEL_STEP_ABSENCE_CANNOT_ERASE_SOURCE_SUPPORTED_CONTRACT_V1", () => {
  const requirement = sourceRequirement({
    members: [{
      action: "assertTextVisible",
      expectedText: "Source member",
      oracleId: "source-member-authoritative",
    }],
  });
  const absent = deriveBrowserExecutionCheckContract({
    testCase: browserCase({ steps: [], successCriteria: "planner prose only" }),
    sourceBoundAssertionSetRequirements: [requirement],
  });
  const wrong = deriveBrowserExecutionCheckContract({
    testCase: browserCase({
      steps: [{
        action: "assertTextVisible",
        text: "planner-only member",
        oracleId: "planner-only-oracle",
      }],
      automatedChecks: ["planner-only member"],
    }),
    sourceBoundAssertionSetRequirements: [requirement],
  });
  assert.deepEqual(absent?.requiredChecks, wrong?.requiredChecks);
  const check = absent?.requiredChecks[0];
  assert.ok(check && check.kind === "SOURCE_BOUND_ASSERTION_MEMBER");
  if (check?.kind === "SOURCE_BOUND_ASSERTION_MEMBER") {
    assert.equal(check.oracle.oracleId, "source-member-authoritative");
  }
});

test("multiple source-bound members are stable and uniquely identified", () => {
  const testCase = browserCase({ steps: [
    { action: "assertTextVisible", text: "Alpha", oracleId: "case-a:assertion-1" },
    { action: "assertTextVisible", text: "Beta", oracleId: "case-a:assertion-2" },
  ] });
  const requirement = sourceRequirement({ members: [
    { action: "assertTextVisible", expectedText: "Beta", oracleId: "case-a:assertion-2" },
    { action: "assertTextVisible", expectedText: "Alpha", oracleId: "case-a:assertion-1" },
  ] });
  const first = deriveBrowserExecutionCheckContract({ testCase, sourceBoundAssertionSetRequirements: [requirement] });
  const second = deriveBrowserExecutionCheckContract({ testCase, sourceBoundAssertionSetRequirements: [requirement] });
  assert.deepEqual(first, second);
  assert.equal(first?.requiredChecks.length, 2);
  assert.equal(new Set(first?.requiredChecks.map((check) => check.checkId)).size, 2);
});

test("a source-authorized local-state requirement becomes a required check", () => {
  const testCase = browserCase({ acceptanceScope: {
    requiresBehaviorProof: true,
    behaviorClaims: [],
    localControlStateTransitionRequirements: [{
      kind: "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
      requirementId: "local-transition-a",
      obligationId: "obligation-a",
      sourceRefs: [{ sourceUnitId: "source-a", sourceRef: "jira:AS-1#acceptance", sourceRole: "ACCEPTANCE" }],
      authority: { sourceRole: "ACCEPTANCE", proofAuthority: "ACCEPTANCE" },
      transition: { semantic: "RESET_RESTORES_DEFAULT", expectedValue: 10, expectedValueAuthority: "JIRA_AUTHORIZED" },
      structuralBinding: {
        sourceEvidenceRefs: ["src/component.ts"],
        valueBinding: { evidenceKind: "LABELLED_DEFAULT_PROPERTY", sourceLabel: "Count", sourceProperty: "DEFAULT_COUNT" },
      },
    }],
  } });
  const contract = deriveBrowserExecutionCheckContract({ testCase });
  assert.deepEqual(contract?.requiredChecks, [{
    checkId: "local-transition-a",
    kind: "LOCAL_STATE_TRANSITION",
    authority: "SOURCE_AUTHORIZED",
    requirementId: "local-transition-a",
  }]);
});

test("a source-authorized evidence-contract binding becomes a required check", () => {
  const contract = deriveBrowserExecutionCheckContract({
    testCase: browserCase({ deterministicProofBindings: [evidenceBinding()] }),
  });
  assert.equal(contract?.requiredChecks.length, 1);
  assert.deepEqual(contract?.requiredChecks[0], {
    checkId: "browser-execution-check:25:EVIDENCE_CONTRACT_BINDING|9:binding-a|10:contract-a",
    kind: "EVIDENCE_CONTRACT_BINDING",
    authority: "SOURCE_AUTHORIZED",
    bindingId: "binding-a",
    evidenceContractId: "contract-a",
  });
});

test("planner canonical assertions without typed source authority do not become checks", () => {
  const contract = deriveBrowserExecutionCheckContract({ testCase: browserCase() });
  assert.deepEqual(contract?.requiredChecks, []);
  assert.deepEqual(contract?.requiredManualCheckIds, []);
});

test("runtime screenshot or evidence-review shaped data cannot create checks", () => {
  const testCase = Object.assign(browserCase(), {
    screenshotPath: "/private/tmp/claimed-pass.png",
    deterministicEvidence: [{ oracleId: "case-a:assertion-1", passed: true }],
  });
  const contract = deriveBrowserExecutionCheckContract({ testCase });
  assert.deepEqual(contract?.requiredChecks, []);
});

test("GROUP_ONLY contracts include only execution-scope requirements", () => {
  const testCase = browserCase({
    acceptanceObligationIds: ["obligation-a", "obligation-b"],
    executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a", "obligation-b"],
      verdictAuthority: "GROUP_ONLY",
    },
  });
  const sibling = sourceRequirement({
    requirementId: "source-requirement-b",
    obligationId: "obligation-b",
  });
  const contract = deriveBrowserExecutionCheckContract({
    testCase,
    sourceBoundAssertionSetRequirements: [sourceRequirement(), sibling],
  });
  assert.deepEqual(contract?.executionObligationIds, ["obligation-a"]);
  assert.equal(contract?.requiredChecks.length, 1);
  assert.equal(contract?.requiredChecks[0]?.kind, "SOURCE_BOUND_ASSERTION_MEMBER");
});

test("duplicate stable check IDs fail closed", () => {
  assert.equal(deriveBrowserExecutionCheckContract({
    testCase: browserCase(),
    sourceBoundAssertionSetRequirements: [sourceRequirement(), sourceRequirement()],
  }), null);
});

test("unsupported structural-control assertions remain ineligible", () => {
  const contract = deriveBrowserExecutionCheckContract({ testCase: browserCase({
    steps: [{
      action: "assertSurfaceControls",
      surfaceKind: "menu",
      controls: [{ kind: "menuitem", label: "Exact member" }],
      oracleId: "surface-a",
    }],
  }) });
  assert.deepEqual(contract?.requiredChecks, []);
});

test("an empty supported requirement set is transported explicitly and deterministically", () => {
  const first = deriveBrowserExecutionCheckContract({ testCase: browserCase() });
  const second = deriveBrowserExecutionCheckContract({ testCase: browserCase() });
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    schemaVersion: 1,
    caseId: "case-a",
    executionObligationIds: ["obligation-a"],
    requiredChecks: [],
    requiredManualCheckIds: [],
  });
});

test("only a non-empty typed source-authorized contract is valid at the runtime boundary", () => {
  const contract = deriveBrowserExecutionCheckContract({
    testCase: browserCase(),
    sourceBoundAssertionSetRequirements: [sourceRequirement()],
  });
  const validContract = contract!;
  const sourceCheck = validContract.requiredChecks.find(
    (check) => check.kind === "SOURCE_BOUND_ASSERTION_MEMBER"
  );
  assert.ok(sourceCheck);
  assert.equal(hasValidBrowserExecutionCheckContract({
    caseId: "case-a",
    contract: validContract,
  }), true);
  assert.equal(hasValidBrowserExecutionCheckContract({
    caseId: "case-a",
    contract: {
      ...validContract,
      requiredChecks: [{
        ...sourceCheck,
        sourceRefs: [],
      }],
    } satisfies BrowserExecutionCheckContract,
  }), false);
  assert.equal(hasValidBrowserExecutionCheckContract({
    caseId: "case-a",
    contract: {
      ...validContract,
      requiredChecks: [],
    } satisfies BrowserExecutionCheckContract,
  }), false);
});
