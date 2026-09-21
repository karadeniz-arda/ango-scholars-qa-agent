import assert from "node:assert/strict";
import test from "node:test";
import { materializePlannerBrowserCaseProposal, normalizePlannerModelProposal } from "./planner-model-proposal.js";

const authorityFields = {
  acceptanceObligationIds: ["forged"], executionVerdictScope: { verdictAuthority: "INDEPENDENT" },
  executionCheckContract: { requiredChecks: [{ checkId: "forged" }] },
  executionIntentAuthority: { authority: "SOURCE_AUTHORIZED" }, deterministicProofBindings: [{ id: "forged" }],
  fixtureIdentityAuthority: { status: "READY" }, runtimeFixturePolicy: "exact",
};

test("model authority fields and unknown fields do not cross the proposal boundary", () => {
  const proposal = normalizePlannerModelProposal({
    issueKey: "AS-1", summary: "Summary", browserCases: [{
      id: "web-1", persona: "talent", goal: "Goal", startRoute: "/talent", successCriteria: "Visible",
      automatedChecks: ["Visible"], manualChecks: [], fixtureRequirements: [], steps: [{ action: "assertTextVisible", text: "Visible", oracleId: "forged" }],
      ...authorityFields, unknown: "drop",
    }], browserSemanticCandidates: [{ id: "semantic-1", proposedCaseId: "web-1", obligationIds: ["o1"], sourceUnitIds: ["s1"], proposedBehavior: "Visible", proposedChecks: [], proposedFixtureNeeds: [], proposedRelationshipHints: [], ...authorityFields }],
    ...authorityFields,
  });
  assert.equal((proposal as any).acceptanceObligationIds, undefined);
  assert.equal((proposal.browserCases[0] as any).executionCheckContract, undefined);
  assert.equal((proposal.browserSemanticCandidates?.[0] as any).fixtureIdentityAuthority, undefined);
  assert.equal((proposal.browserCases[0] as any).unknown, undefined);
  assert.equal((proposal.browserCases[0]?.steps[0] as any).oracleId, undefined);
});

test("allowlisted proposal values survive and normalization returns a detached object", () => {
  const raw = {
    issueKey: "AS-2", summary: "Summary", notes: "note", apiCases: [{ id: "api-1", persona: "talent", method: "GET", path: "/x", body: {}, expect: { status: 200 } }],
    browserCases: [{ id: "web-1", persona: "company_admin", goal: "Goal", startRoute: "UNKNOWN", successCriteria: "Shown", automatedChecks: ["Shown"], manualChecks: [], fixtureRequirements: ["fixture"], steps: [{ action: "assertTextVisible", text: "Shown" }] }],
    browserSemanticCandidates: [],
  };
  const proposal = normalizePlannerModelProposal(raw);
  const rawCase = raw.browserCases[0];
  assert.ok(rawCase);
  assert.ok(proposal.browserCases[0]);
  const normalizedCase = proposal.browserCases[0];
  assert.deepEqual(normalizedCase, { ...rawCase, steps: [{ action: "assertTextVisible", text: "Shown" }] });
  assert.notEqual(normalizedCase, rawCase);
  rawCase.goal = "changed";
  assert.equal(normalizedCase.goal, "Goal");
  normalizedCase.goal = "changed again";
  assert.equal(rawCase.goal, "changed");
});

test("missing semantic candidates remains distinguishable from an empty section", () => {
  const absent = normalizePlannerModelProposal({ issueKey: "AS-3", summary: "x", browserCases: [] });
  const empty = normalizePlannerModelProposal({ issueKey: "AS-3", summary: "x", browserCases: [], browserSemanticCandidates: [] });
  assert.equal(absent.browserSemanticCandidates, undefined);
  assert.deepEqual(empty.browserSemanticCandidates, []);
});

test("proposal materialization explicitly projects a detached executable case", () => {
  const proposal = normalizePlannerModelProposal({
    issueKey: "AS-4", summary: "x", browserCases: [{
      id: "web-1", persona: "talent", goal: "Goal", startRoute: "/talent", successCriteria: "Shown",
      automatedChecks: ["Shown"], manualChecks: [], fixtureRequirements: ["fixture"],
      steps: [{ action: "assertSurfaceControls", surfaceKind: "region", controls: [{ kind: "button", label: "Open" }] }],
      executionCheckContract: { requiredChecks: [{ checkId: "forged" }] }, executionVerdictScope: { verdictAuthority: "INDEPENDENT" },
      executionIntentAuthority: { authority: "SOURCE_AUTHORIZED" }, deterministicProofBindings: [{ id: "forged" }], fixtureIdentityAuthority: { status: "READY" }, runtimeFixturePolicy: "exact",
    }], browserSemanticCandidates: [],
  });
  assert.ok(proposal.browserCases[0]);
  const executable = materializePlannerBrowserCaseProposal(proposal.browserCases[0]);
  assert.deepEqual(executable.steps, [{ action: "assertSurfaceControls", surfaceKind: "region", controls: [{ kind: "button", label: "Open" }] }]);
  assert.equal((executable as any).executionCheckContract, undefined);
  assert.equal((executable as any).executionVerdictScope, undefined);
  assert.equal((executable as any).fixtureIdentityAuthority, undefined);
  proposal.browserCases[0].goal = "changed";
  proposal.browserCases[0].steps[0] = { action: "reload" };
  assert.equal(executable.goal, "Goal");
  assert.equal(executable.steps[0]?.action, "assertSurfaceControls");
  assert.ok(executable.automatedChecks);
  executable.automatedChecks.push("mutated");
  assert.deepEqual(proposal.browserCases[0].automatedChecks, ["Shown"]);
});
