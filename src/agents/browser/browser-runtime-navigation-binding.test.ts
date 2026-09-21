import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDeepRouteBinding,
  type DeepRouteEntityRequirement,
  type DeepRouteTemplate,
  type RuntimeEntityIdentity,
} from "./browser-deep-route-binding.js";
import {
  createRuntimeNavigationBinding,
} from "./browser-runtime-navigation-binding.js";
import type {
  PlannerRuntimeNavigationResolutionContract,
} from "../../planner/types.js";

const template: DeepRouteTemplate = {
  template: "/talent/contracts/:contractId",
  sourceOrigin: "UI_ROUTE_MANIFEST",
  sourceRef: "src/routes/talent-contract.tsx",
  authoritative: true,
  persona: "talent",
  requiredBindings: [{ param: "contractId", entityKind: "contract" }],
};

const capability: PlannerRuntimeNavigationResolutionContract = {
  capabilityId: "runtime-navigation-capability-test",
  status: "RUNTIME_NAVIGATION_RESOLUTION_REQUIRED",
  template: template.template,
  templateSourceOrigin: "UI_ROUTE_MANIFEST",
  templateSourceRef: "src/routes/talent-contract.tsx",
  persona: "talent",
  parameters: [{ param: "contractId", entityKind: "contract" }],
  resolverRef: "talent-contract-detail-readonly-v1",
  resolverClassification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
  resolverProvenance: {
    module: "src/agents/browser/browser-route-talent-contract.ts",
    exportName: "resolveTalentContractDetailRoute",
  },
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
  identityVerification: "REQUIRED",
  ownershipVerification: "REQUIRED",
  stateVerification: "WHEN_REQUIRED",
  runtimeIdentity: "NOT_YET_RESOLVED",
  navigationReadyForExecution: false,
};

const requirement: DeepRouteEntityRequirement = {
  param: "contractId",
  entityKind: "contract",
  persona: "talent",
  ownerId: "talent-owner",
  requiresOwnershipVerification: true,
  requiredState: { hasWorkSetups: true },
};

function candidate(overrides: Partial<RuntimeEntityIdentity> = {}): RuntimeEntityIdentity {
  return {
    entityKind: "contract",
    entityId: "contract-runtime-id",
    source: "AUTHENTICATED_GET",
    persona: "talent",
    identityVerified: true,
    ownershipVerified: true,
    ownerId: "talent-owner",
    verifiedState: { hasWorkSetups: true },
    verifiedStateKeys: ["hasWorkSetups"],
    ...overrides,
  };
}

function bind(candidates: RuntimeEntityIdentity[]) {
  return resolveDeepRouteBinding({
    template,
    persona: "talent",
    requirements: [requirement],
    candidates,
  });
}

test("one unique owned state-compatible identity creates a concrete runtime binding", () => {
  const binding = createRuntimeNavigationBinding({
    executionCaseId: "web-1",
    capability,
    resolution: bind([candidate()]),
    requirements: [requirement],
    resolvedAt: "2026-09-03T00:00:00.000Z",
    evidenceReference: "runtime-navigation-evidence-1",
  });
  assert.deepEqual(binding, {
    status: "RESOLVED",
    navigationReadyForExecution: true,
    executionCaseId: "web-1",
    template: "/talent/contracts/:contractId",
    concreteRoute: "/talent/contracts/contract-runtime-id",
    selectedIdentityReferences: [{
      param: "contractId",
      entityKind: "contract",
      identityRef: "contract-runtime-id",
      source: "AUTHENTICATED_GET",
    }],
    persona: "talent",
    resolverRef: "talent-contract-detail-readonly-v1",
    ownershipVerification: "VERIFIED",
    stateVerification: "VERIFIED",
    resolvedAt: "2026-09-03T00:00:00.000Z",
    evidenceReference: "runtime-navigation-evidence-1",
  });
});

test("zero or multiple compatible identities cannot create a runtime binding", () => {
  for (const candidates of [
    [] as RuntimeEntityIdentity[],
    [candidate(), candidate({ entityId: "contract-runtime-id-2" })],
  ]) {
    assert.equal(createRuntimeNavigationBinding({
      executionCaseId: "web-1",
      capability,
      resolution: bind(candidates),
      requirements: [requirement],
      resolvedAt: "2026-09-03T00:00:00.000Z",
      evidenceReference: "runtime-navigation-evidence-1",
    }), undefined);
  }
});

test("ownership or required-state mismatch cannot create a runtime binding", () => {
  for (const incompatible of [
    candidate({ ownershipVerified: false }),
    candidate({ ownerId: "another-owner" }),
    candidate({ verifiedState: { hasWorkSetups: false } }),
    candidate({ verifiedStateKeys: [] }),
  ]) {
    assert.equal(createRuntimeNavigationBinding({
      executionCaseId: "web-1",
      capability,
      resolution: bind([incompatible]),
      requirements: [requirement],
      resolvedAt: "2026-09-03T00:00:00.000Z",
      evidenceReference: "runtime-navigation-evidence-1",
    }), undefined);
  }
});

test("model-proposed identity cannot become a runtime navigation binding", () => {
  assert.equal(createRuntimeNavigationBinding({
    executionCaseId: "web-1",
    capability,
    resolution: bind([candidate({ source: "MODEL_PROPOSAL" })]),
    requirements: [requirement],
    resolvedAt: "2026-09-03T00:00:00.000Z",
    evidenceReference: "runtime-navigation-evidence-1",
  }), undefined);
});
