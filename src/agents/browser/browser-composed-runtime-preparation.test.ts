import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectRuntimeNavigationCapability } from "../../discovery/runtime-navigation-capability-registry.js";
import { linkComposedRuntimeCapabilities } from "../../planner/planner-composed-runtime-resolution.js";
import type { BrowserTestCase, PlannerRuntimeFixtureResolutionContract, PlannerTalentContractFixturePredicateKey } from "../../planner/types.js";
import type { VerifiedContractFixtureCandidate } from "./fixtures/verified-contract-fixture-state.js";
import { evaluateComposedRuntimePreparation, composedPreparationAllowsInteraction, prepareComposedRuntimeCase } from "./browser-composed-runtime-preparation.js";

const caseId = "case-1";
const ownerId = "owner-1";
const preparedAt = "2026-09-03T10:00:00.000Z";
const evidenceRef = "evidence:fixture-readonly";

function contract(
  keys: PlannerTalentContractFixturePredicateKey[] = [
    "contract.accessibleToOwner",
  ],
  identity: "exact" | "compatible-state" = "compatible-state",
  exactEntityId?: string
): PlannerRuntimeFixtureResolutionContract {
  const predicates = keys.map((key) => ({
    key,
    expected: true as const,
    obligationIds: ["obligation-1"],
    sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira:ac" }],
    authority: "SOURCE_AUTHORIZED" as const,
  }));
  return {
    fixtureContractId: "fixture-contract-1",
    status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
    policy: "ALL_REQUIRED",
    members: [{
      executionCaseId: caseId,
      required: true,
      acceptanceFixtureConstraint: {
        constraintId: "constraint-1",
        executionCaseId: caseId,
        sourceCaseId: caseId,
        partition: { mode: "ALL_REQUIRED", memberId: caseId, memberCount: 1 },
        fixtureKind: "talent-contract",
        semantic: { kind: "PREDICATES", predicates },
        obligationIds: ["obligation-1"],
        sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira:ac" }],
        identityPolicy: identity,
        ...(exactEntityId ? { exactEntityId } : {}),
        authority: "SOURCE_AUTHORIZED",
      },
      fixtureResolutionCapability: {
        capabilityId: "capability-1",
        executionCaseId: caseId,
        fixtureKind: "talent-contract",
        resolverRef: "talent-contract-detail-readonly-v1",
        classification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
        persona: "talent",
        supportedPredicates: keys,
        identityPolicy: identity,
        selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
        ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
        identityVerification: "REQUIRED",
        ownershipVerification: "REQUIRED",
        provenance: {
          module: "src/agents/browser/fixtures/verified-contract-fixture-state.ts",
          exportName: "selectVerifiedContractFixtureCandidate",
        },
      },
      runtimeFixtureBinding: "NOT_YET_RESOLVED",
    }],
    acceptanceCoverage: {
      kind: "TALENT_CONTRACT_PREDICATES",
      policy: "ALL_REQUIRED",
      requiredPredicateKeys: keys,
      plannedPredicateKeys: keys,
    },
    fixtureReadyForInteraction: false,
  };
}

function candidate(
  id: string,
  facts: Array<[PlannerTalentContractFixturePredicateKey, boolean]>,
  overrides: Partial<VerifiedContractFixtureCandidate["identity"]> = {}
): VerifiedContractFixtureCandidate {
  return {
    identity: {
      entityKind: "contract",
      entityId: id,
      source: "AUTHENTICATED_GET",
      persona: "talent",
      identityVerified: true,
      ownershipVerified: true,
      ownerId,
      ...overrides,
    },
    facts: facts.map(([key, value]) => ({
      key,
      value,
      verification: "EXACT_API_FIELD",
      sourceRef: "authenticated-get",
    })),
  };
}

function planned(fixture = contract()): BrowserTestCase {
  const discovery = selectRuntimeNavigationCapability({
    candidatePersona: "talent",
    templates: [{ template: "/talent/contracts/:contractId", persona: "talent",
      sourceOrigin: "UI_ROUTE_MANIFEST", sourceRef: "source/routes.tsx",
      authoritative: true, requiredBindings: [{ param: "contractId", entityKind: "contract" }] }],
  });
  assert.equal(discovery.status, "AVAILABLE");
  if (discovery.status !== "AVAILABLE") throw new Error("test setup");
  fixture.interactionExecutionCaseId = caseId;
  const link = linkComposedRuntimeCapabilities({ executionContainerId: "container-1",
    executionCaseId: caseId, navigation: discovery.capability, fixture });
  assert.ok(link);
  return { id: "serialized-case", persona: "talent", goal: "Inspect existing contract",
    startRoute: "UNKNOWN", steps: [], successCriteria: "Inspect the required state",
    runtimeNavigationResolutionContract: discovery.capability,
    runtimeFixtureResolutionContract: fixture, composedRuntimeResolution: link };
}
const good = () => candidate("contract-a", [["contract.accessibleToOwner", true]]);
function evaluate(c = planned(), candidates = [good()], actualPersona = "talent") {
  return evaluateComposedRuntimePreparation({ testCase: c, candidates, actualPersona,
    ownerId, preparedAt, evidenceRef });
}
function assertBlocked(result: ReturnType<typeof evaluate>) {
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.runtimeReadyForInteraction, false);
  assert.equal(result.navigationBinding, null);
  assert.equal(result.fixtureBinding, null);
}

test("one selected identity constructs both bindings and unlocks interaction only", () => {
  const c = planned();
  const before = JSON.stringify(c);
  const result = evaluate(c);
  assert.equal(result.status, "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED");
  assert.equal(result.navigationBinding?.concreteRoute, "/talent/contracts/contract-a");
  assert.equal(result.navigationBinding?.selectedIdentityReferences[0]?.identityRef, result.fixtureBinding?.fixtureIdentityRef);
  assert.equal(result.candidatePredicateCensus?.candidates[0]?.compatibility, "COMPATIBLE");
  assert.equal(composedPreparationAllowsInteraction(c, result, "talent"), true);
  assert.equal(JSON.stringify(c), before);
  for (const forbidden of ["deterministicEvidence", "CASE_PROOF_READY", '"PASS"', '"PROVED"'])
    assert.equal(JSON.stringify(result).includes(forbidden), false);
});

test("planning and reload retain unresolved linkage with no runtime bindings", () => {
  const c = planned();
  const reloaded = JSON.parse(JSON.stringify(c)) as BrowserTestCase;
  assert.deepEqual(reloaded, c);
  assert.equal(reloaded.startRoute, "UNKNOWN");
  assert.equal(reloaded.composedRuntimeResolution?.runtimeReadyForInteraction, false);
  assert.equal(reloaded.runtimeNavigationResolutionContract?.navigationReadyForExecution, false);
  assert.equal(reloaded.runtimeFixtureResolutionContract?.fixtureReadyForInteraction, false);
  assert.equal(JSON.stringify(reloaded).includes("contract-a"), false);
  assert.equal(composedPreparationAllowsInteraction(reloaded, undefined, "talent"), false);
});

test("zero candidates publishes neither half and preserves the empty census", () => {
  const result = evaluate(planned(), []);
  assertBlocked(result);
  assert.deepEqual(result.candidatePredicateCensus?.candidates, []);
});
test("two equivalent candidates publish one canonical same-entity binding in either order", () => {
  const second = candidate("contract-b", [["contract.accessibleToOwner", true]]);
  const first = evaluate(planned(), [good(), second]);
  const reversed = evaluate(planned(), [second, good()]);
  assert.equal(first.status, "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED");
  assert.equal(reversed.status, "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED");
  assert.equal(first.fixtureBinding?.fixtureIdentityRef, "contract-a");
  assert.equal(
    first.navigationBinding?.selectedIdentityReferences[0]?.identityRef,
    first.fixtureBinding?.fixtureIdentityRef
  );
  assert.equal(
    reversed.fixtureBinding?.fixtureIdentityRef,
    first.fixtureBinding?.fixtureIdentityRef
  );
  assert.equal(
    first.equivalentCandidateSetResolution?.scope,
    "FIXTURE_READINESS_ONLY"
  );
  assert.deepEqual(first.candidatePredicateCensus, reversed.candidatePredicateCensus);
  assert.ok(first.candidatePredicateCensus?.candidates.every(
    item => item.compatibility === "COMPATIBLE"
  ));
  for (const forbidden of [
    "deterministicEvidence",
    "CASE_PROOF_READY",
    '"PASS"',
    '"PROVED"',
  ]) {
    assert.equal(
      JSON.stringify(first).includes(forbidden),
      false
    );
  }
});
test("duplicate observations cannot turn ambiguity into first-match selection", () => {
  assertBlocked(evaluate(planned(), [good(), good()]));
  assertBlocked(evaluate(planned(), [candidate("contract-a", []), good()]));
  assertBlocked(evaluate(planned(), [good(), candidate("contract-a", [])]));
});
test("unknown and false required state remain blocked", () => {
  const unknown = evaluate(planned(), [candidate("contract-a", [])]);
  const mismatch = evaluate(planned(), [candidate("contract-a", [["contract.accessibleToOwner", false]])]);
  assertBlocked(unknown);
  assertBlocked(mismatch);
  assert.equal(unknown.failureReason, "ENTITY_STATE_UNVERIFIED");
  assert.equal(mismatch.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(unknown.candidatePredicateCensus?.candidates[0]?.predicates[0]?.observed, "UNKNOWN");
  assert.equal(mismatch.candidatePredicateCensus?.candidates[0]?.predicates[0]?.observed, "FALSE");
});
test("wrong persona and ownership block both bindings", () => {
  assertBlocked(evaluate(planned(), [good()], "company_admin"));
  assertBlocked(evaluate(planned(), [{ ...good(), identity: { ...good().identity, ownerId: "other" } }]));
  assertBlocked(evaluate(planned(), [{ ...good(), identity: { ...good().identity, ownershipVerified: false } }]));
});
test("exact identity cannot fall back to a compatible different contract", () => {
  const c = planned(contract(["contract.accessibleToOwner"], "exact", "contract-b"));
  assertBlocked(evaluate(c));
  const result = evaluate(c, [good(), candidate("contract-b", [["contract.accessibleToOwner", true]])]);
  assert.equal(result.fixtureBinding?.fixtureIdentityRef, "contract-b");
  assert.equal(composedPreparationAllowsInteraction(c, result, "talent"), true);
});
test("unsafe selected ID cannot publish fixture-only readiness", () => {
  assertBlocked(evaluate(planned(), [candidate("../other", [["contract.accessibleToOwner", true]])]));
});
test("route resolver, entity, case, policy and source authority conflicts block linkage", () => {
  const c = planned();
  for (const mutate of [
    (x: BrowserTestCase) => { x.runtimeNavigationResolutionContract!.template = "/company/contracts/:contractId"; },
    (x: BrowserTestCase) => { x.runtimeNavigationResolutionContract!.parameters[0]!.entityKind = "invoice"; },
    (x: BrowserTestCase) => { x.runtimeNavigationResolutionContract!.resolverRef = "other-resolver" as never; },
    (x: BrowserTestCase) => { delete x.runtimeNavigationResolutionContract; },
    (x: BrowserTestCase) => { delete x.runtimeFixtureResolutionContract; },
    (x: BrowserTestCase) => { x.runtimeFixtureResolutionContract!.members[0]!.executionCaseId = "other"; },
    (x: BrowserTestCase) => { x.runtimeFixtureResolutionContract!.members[0]!.acceptanceFixtureConstraint!.authority = "UNKNOWN" as never; },
    (x: BrowserTestCase) => { x.composedRuntimeResolution!.identityPolicy = "exact"; },
    (x: BrowserTestCase) => { x.runtimeFixtureResolutionContract!.members.push(structuredClone(x.runtimeFixtureResolutionContract!.members[0]!)); },
  ]) {
    const changed = structuredClone(c); mutate(changed);
    assertBlocked(evaluate(changed));
  }
});
test("conflicting exact linkage identities cannot reach preparation", () => {
  const c = planned(contract(["contract.accessibleToOwner"], "exact", "contract-a"));
  c.composedRuntimeResolution!.exactEntityId = "contract-b";
  assertBlocked(evaluate(c));
});
test("tampered route, identity or half-ready outcome never enables interaction", () => {
  const c = planned();
  const result = evaluate(c);
  assert.equal(composedPreparationAllowsInteraction(c, { ...result, fixtureBinding: null }, "talent"), false);
  assert.equal(composedPreparationAllowsInteraction(c, { ...result, navigationBinding: null }, "talent"), false);
  const wrongRoute = structuredClone(result); wrongRoute.navigationBinding!.concreteRoute = "/talent/contracts/other";
  assert.equal(composedPreparationAllowsInteraction(c, wrongRoute, "talent"), false);
  const wrongId = structuredClone(result); wrongId.fixtureBinding!.fixtureIdentityRef = "other";
  assert.equal(composedPreparationAllowsInteraction(c, wrongId, "talent"), false);
  const missingState = structuredClone(result); missingState.fixtureBinding!.verifiedPredicates = [];
  assert.equal(composedPreparationAllowsInteraction(c, missingState, "talent"), false);
  assert.equal(composedPreparationAllowsInteraction(c, result, "company_admin"), false);
});
test("shared preparation calls authenticated discovery once, never a second selector", async () => {
  let calls = 0;
  const result = await prepareComposedRuntimeCase({ testCase: planned(), actualPersona: "talent",
    discover: async () => { calls++; return { talentId: ownerId, verifiedCandidates: [good()] }; } });
  assert.equal(calls, 1); assert.equal(result.status, "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED");
});
test("invalid contract stops before discovery; discovery errors are sanitized", async () => {
  const c = planned(); delete c.composedRuntimeResolution;
  let calls = 0;
  assertBlocked(await prepareComposedRuntimeCase({ testCase: c, actualPersona: "talent",
    discover: async () => { calls++; throw new Error("must not execute"); } }));
  assert.equal(calls, 0);
  const failed = await prepareComposedRuntimeCase({ testCase: planned(), actualPersona: "talent",
    discover: async () => { throw new Error("synthetic private provider error"); } });
  assertBlocked(failed);
  assert.equal(failed.failureReason, "AUTHENTICATED_DISCOVERY_FAILED");
  assert.equal(JSON.stringify(failed).includes("private provider"), false);
});
test("normal runner has an atomic preparation gate before legacy selection or interaction", () => {
  const source = readFileSync(new URL("./run-browser-cases.ts", import.meta.url), "utf8");
  const branch = source.slice(source.indexOf("if (testCase.composedRuntimeResolution)"), source.indexOf("const runtimeResourceContext =", source.indexOf("if (testCase.composedRuntimeResolution)")));
  assert.ok(branch.includes("prepareComposedRuntimeCase"));
  assert.ok(branch.includes("continue;"));
  assert.ok(source.includes("!testCase.composedRuntimeResolution && shouldPrepareBrowserFixture"));
  assert.ok(source.indexOf("composedPreparationAllowsInteraction(testCase, prepared") < source.indexOf("const executionRouteReady"));
  assert.ok(source.includes("result.composedRuntimePreparation = prepared"));
  assert.ok(source.includes('testCase.composedRuntimeResolution\n        ? { status: "NOT_APPLICABLE"'));
  assert.ok(source.includes("COMPOSED_PREPARATION_SESSION_MISMATCH"));
  assert.ok(source.includes("Runtime candidate census:"));
  assert.ok(source.includes("COMPOSED_RUNTIME_STRUCTURAL_TARGET_PROOF_V1"));
  assert.ok(source.includes("sourceBoundComposedPlannerStepsObservationOnly"));
  assert.ok(source.includes("genericBrowserExecutedSteps === 0"));
  assert.ok(source.includes('path: "COMPOSED"'));
  assert.ok(source.includes('"SOURCE_DERIVED_EXACT_VISIBLE_BUTTON"'));
});
