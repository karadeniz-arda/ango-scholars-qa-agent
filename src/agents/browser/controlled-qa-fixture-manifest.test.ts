import assert from "node:assert/strict";
import test from "node:test";
import {
  controlledQaFixtureForCase,
  controlledQaFixtureMatchesCandidate,
} from "./controlled-qa-fixture-manifest.js";

const manifest = JSON.stringify({ mode: "CONTROLLED_QA_VALIDATION", cases: { "case-1": { entityType: "talent-contract", entityId: "387", relationships: { talentId: "659" }, preconditions: { workSetup: "ABSENT" }, persona: "talent", provenance: "CONTROLLED_QA_FIXTURE" } } });
const read = () => manifest;
const fixture = () => controlledQaFixtureForCase({ caseId: "case-1", manifestPath: "x", readFile: read })!;
const validCandidate = { entityId: "387", ownerId: "659", ownershipVerified: true, hasWorkSetups: false, status: "ACTIVE" };

test("manifest is opt-in when unset", () => assert.equal(controlledQaFixtureForCase({ caseId: "case-1" }), undefined));
test("manifest lookup is exact-case only", () => assert.equal(controlledQaFixtureForCase({ caseId: "other", manifestPath: "x", readFile: read }), undefined));
test("exact case/entity binding is available", () => assert.equal(fixture().entityId, "387"));
test("wrong entity type is blocked", () => {
  const wrongType = () => JSON.stringify({ mode: "CONTROLLED_QA_VALIDATION", cases: { "case-1": { entityType: "invoice", entityId: "387", persona: "talent", provenance: "CONTROLLED_QA_FIXTURE" } } });
  assert.equal(controlledQaFixtureForCase({ caseId: "case-1", manifestPath: "x", readFile: wrongType }), undefined);
});
test("proof or verdict fields are rejected", () => {
  const authorityShaped = () => JSON.stringify({ mode: "CONTROLLED_QA_VALIDATION", cases: { "case-1": { entityType: "talent-contract", entityId: "387", persona: "talent", provenance: "CONTROLLED_QA_FIXTURE", verdict: "PASS" } } });
  assert.equal(controlledQaFixtureForCase({ caseId: "case-1", manifestPath: "x", readFile: authorityShaped }), undefined);
});
test("nonexistent exact entity is blocked", () => assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: { ...validCandidate, entityId: "missing" }, talentId: "659" }), false));
test("precondition mismatch is blocked", () => assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: { ...validCandidate, hasWorkSetups: true }, talentId: "659" }), false));
test("exact entity wins without natural-candidate substitution", () => {
  assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: { ...validCandidate, entityId: "386" }, talentId: "659" }), false);
  assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: validCandidate, talentId: "659" }), true);
});
test("ownership and relationship facts remain required", () => {
  assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: { ...validCandidate, ownershipVerified: false }, talentId: "659" }), false);
  assert.equal(controlledQaFixtureMatchesCandidate({ fixture: fixture(), candidate: validCandidate, talentId: "other" }), false);
});
test("fixture provenance is retained without proof authority", () => {
  const result = fixture();
  assert.equal(result.provenance, "CONTROLLED_QA_FIXTURE");
  assert.equal("verdict" in result, false);
  assert.equal("proof" in result, false);
});
