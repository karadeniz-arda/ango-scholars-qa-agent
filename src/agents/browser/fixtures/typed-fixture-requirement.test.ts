import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveTypedFixtureRequirement,
  evaluateFixtureProvisioningEligibility,
} from "./typed-fixture-requirement.js";

function constraint(overrides: Record<string, unknown> = {}): any {
  return {
    constraintId: "fixture-contract-1",
    executionCaseId: "case-1",
    sourceCaseId: "source-case-1",
    partition: { mode: "ALL_REQUIRED", memberId: "member-1", memberCount: 1 },
    fixtureKind: "talent-contract",
    semantic: {
      kind: "PREDICATES",
      predicates: [{
        key: "contract.hasWorkSetups",
        expected: false,
        obligationIds: ["obligation-1"],
        sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira.acceptance.1" }],
        authority: "SOURCE_AUTHORIZED",
      }],
    },
    obligationIds: ["obligation-1"],
    sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira.acceptance.1" }],
    identityPolicy: "compatible-state",
    authority: "SOURCE_AUTHORIZED",
    ...overrides,
  };
}

test("source-backed empty Work Setup predicate is typed and traceable", () => {
  const result = deriveTypedFixtureRequirement({ constraint: constraint(), persona: "talent" });
  assert.ok(result);
  assert.deepEqual(result.predicates[0], {
    path: "contract.hasWorkSetups",
    operator: "EQ",
    value: false,
    authority: "SOURCE_DERIVED_DETERMINISTIC",
    obligationIds: ["obligation-1"],
    sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira.acceptance.1" }],
  });
  assert.equal(result.reuseEligibility.sufficient, true);
  assert.equal(result.creationEligibility.sufficient, false);
});
test("source-backed populated predicate remains exact", () => {
  const value = constraint();
  value.semantic.predicates[0].expected = true;
  const result = deriveTypedFixtureRequirement({ constraint: value, persona: "talent" });
  assert.equal(result?.predicates[0]?.value, true);
});

test("vague planner prose is not a typed requirement", () => {
  assert.equal(deriveTypedFixtureRequirement({
    constraint: constraint({ fixtureKind: "unknown", semantic: { kind: "OTHER", text: "empty state" } }),
    persona: "talent",
  } as any), null);
});

test("model-only or unknown authority cannot create a requirement", () => {
  const value = constraint();
  value.authority = "MODEL_SUGGESTED_UNTRUSTED";
  assert.equal(deriveTypedFixtureRequirement({ constraint: value, persona: "talent" }), null);
});

test("missing source refs fail closed", () => {
  const value = constraint();
  value.sourceUnitRefs = [];
  assert.equal(deriveTypedFixtureRequirement({ constraint: value, persona: "talent" }), null);
});

test("reuse can be sufficient while create remains ineligible", () => {
  const requirement = deriveTypedFixtureRequirement({ constraint: constraint(), persona: "talent" });
  assert.ok(requirement);
  const result = evaluateFixtureProvisioningEligibility(requirement, {
    family: "TALENT_CONTRACT",
    requiredConstructionPaths: ["contract.hasWorkSetups", "relationship.contract.job", "relationship.contract.talent"],
    allowsRetention: false,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "CONSTRUCTION_AUTHORITY_INCOMPLETE");
  assert.ok(result.missing.includes("relationship.contract.job"));
});

test("a provisioner family mismatch cannot be eligible", () => {
  const requirement = deriveTypedFixtureRequirement({ constraint: constraint(), persona: "talent" });
  assert.ok(requirement);
  const result = evaluateFixtureProvisioningEligibility(requirement, {
    family: "PROJECT",
    requiredConstructionPaths: [],
    allowsRetention: true,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "PROVISIONER_FAMILY_MISMATCH");
});

test("fixture requirements carry no proof or verdict authority", () => {
  const requirement = deriveTypedFixtureRequirement({ constraint: constraint(), persona: "talent" });
  assert.ok(requirement);
  assert.equal("verdict" in requirement, false);
  assert.equal("proof" in requirement, false);
});
