import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserBlockReason,
} from "./browser-case-blocking-policy.js";

function sourceCheckContract(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    caseId: "as-1373-case",
    executionObligationIds: ["obligation-skills"],
    requiredChecks: [{
      checkId: "source-member-check",
      kind: "SOURCE_BOUND_ASSERTION_MEMBER",
      authority: "SOURCE_AUTHORIZED",
      requirementId: "source-requirement-skills",
      oracle: {
        oracleId: "source-member-skills",
        action: "assertTextVisible",
        expectedText: "add up to 10 skills",
      },
      sourceUnitIds: ["jira-description"],
      sourceRefs: ["jira.description"],
    }],
    requiredManualCheckIds: [],
    ...overrides,
  };
}

function sourceBackedIntent(route = "/talent/onboarding") {
  return {
    schemaVersion: 1,
    caseId: "as-1373-case",
    sourceUnitRefs: [{
      sourceUnitId: "jira-description",
      sourceRef: "jira.description",
    }],
    sourceTargetEnvelope: {
      semanticIdentity: "Update the Skills step description to mention that users can add up to 10 skills.",
      sourceSurface: "Update the Skills step description to mention that users can add up to 10 skills.",
      sourceUnitRefs: [{
        sourceUnitId: "jira-description",
        sourceRef: "jira.description",
      }],
      routePolicy: {
        kind: "PREBOUND_EXACT",
        route,
        authority: "UI_ROUTE_MANIFEST",
        sourceRefs: ["src/modules/talent/TalentRoutes.tsx"],
      },
    },
  };
}

test("a valid source-authorized contract supersedes stale planner-text provenance failure", () => {
  const reason = getBrowserBlockReason({
    id: "as-1373-case",
    persona: "talent",
    startRoute: "/talent/jobs",
    steps: [{
      action: "assertTextVisible",
      text: "Add up to 10 skills to get better job matches. You can edit them later.",
      oracleId: "planner-long-copy",
    }],
    executionCheckContract: sourceCheckContract(),
    runtimeTextAssertionProvenanceFailure:
      "Browser text assertion provenance gate blocked as-1373-case: planner suffix is not source text.",
  });
  assert.equal(reason, null);
});

test("a planner-derived jobs label cannot veto a compatible source-backed execution intent", () => {
  const reason = getBrowserBlockReason({
    id: "as-1373-case",
    persona: "talent",
    startRoute: "/talent/onboarding",
    goal: "Verify that the Skills step explains the 10-skill limit.",
    steps: [{
      action: "assertTextVisible",
      text: "Add up to 10 skills to get better job matches. You can edit them later.",
      oracleId: "planner-long-copy",
    }],
    executionCheckContract: sourceCheckContract(),
    executionIntentAuthority: sourceBackedIntent(),
  });
  assert.equal(reason, null);
});

test("a source-prebound route mismatch remains blocked despite a source-backed contract", () => {
  const reason = getBrowserBlockReason({
    id: "as-1373-case",
    persona: "talent",
    startRoute: "/talent/onboarding",
    goal: "Verify that the Skills step explains the 10-skill limit.",
    steps: [{
      action: "assertTextVisible",
      text: "Add up to 10 skills to get better job matches. You can edit them later.",
      oracleId: "planner-long-copy",
    }],
    executionCheckContract: sourceCheckContract(),
    executionIntentAuthority: sourceBackedIntent("/talent/jobs"),
  });
  assert.match(reason ?? "", /Browser relevance gate rejected/);
});

test("absent, empty, and invalid contracts do not suppress provenance failure", () => {
  const base = {
    id: "as-1373-case",
    persona: "talent",
    startRoute: "/talent/onboarding",
    runtimeTextAssertionProvenanceFailure:
      "Browser text assertion provenance gate blocked as-1373-case: planner-only assertion.",
  };
  assert.match(getBrowserBlockReason(base) ?? "", /planner-only assertion/);
  assert.match(getBrowserBlockReason({
    ...base,
    executionCheckContract: sourceCheckContract({ requiredChecks: [] }),
  }) ?? "", /planner-only assertion/);
  assert.match(getBrowserBlockReason({
    ...base,
    executionCheckContract: sourceCheckContract({
      requiredChecks: [{
        ...sourceCheckContract().requiredChecks[0],
        sourceRefs: [],
      }],
    }),
  }) ?? "", /execution-check contract provenance gate blocked/);
});
