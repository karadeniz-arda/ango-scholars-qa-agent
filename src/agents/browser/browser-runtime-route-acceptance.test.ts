import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrowserDeterministicPassRuntimeContext,
  materializeBrowserDeterministicPassRuntimePrerequisites,
} from "./browser-deterministic-pass-runtime-context.js";

import {
  acceptedRuntimeRouteAuthority,
  acceptedRuntimeRouteFromNavigationBinding,
  acceptedRuntimeRouteFromProbe,
  rebindAcceptedRuntimeRoute,
} from "./browser-runtime-route-acceptance.js";
import type { RuntimeNavigationBinding } from "../../planner/types.js";

function composedBinding(overrides: Partial<RuntimeNavigationBinding> = {}): RuntimeNavigationBinding {
  return {
    status: "RESOLVED",
    navigationReadyForExecution: true,
    executionCaseId: "source-case-a",
    template: "/talent/contracts/:contractId",
    concreteRoute: "/talent/contracts/386",
    selectedIdentityReferences: [{
      param: "contractId",
      entityKind: "contract",
      identityRef: "386",
      source: "AUTHENTICATED_GET",
    }],
    persona: "talent",
    resolverRef: "talent-contract-detail-readonly-v1",
    ownershipVerification: "VERIFIED",
    stateVerification: "VERIFIED",
    resolvedAt: "2026-09-23T00:00:00.000Z",
    evidenceReference: "composed-fixture-binding",
    ...overrides,
  };
}

const accepted = () => acceptedRuntimeRouteFromProbe({
  caseId: "case-a",
  persona: "company_admin",
  probeResult: {
    acceptedRoute: "/company/assessments/13",
    attempts: [{ route: "/company/assessments", finalUrl: "https://runtime/company/assessments", accepted: false, reason: "list only", matchedLandmarks: [] }, { route: "/company/assessments/13", finalUrl: "https://runtime/company/assessments/13", accepted: true, reason: "matched", matchedLandmarks: [] }],
  },
});

test("accepted bounded runtime route transports only to the same case and persona", () => {
  const acceptance = accepted();
  assert.deepEqual(acceptedRuntimeRouteAuthority({ acceptance: acceptance!, caseId: "case-a", actualPersona: "company_admin" }), {
    status: "AVAILABLE",
    value: "/company/assessments/13",
    source: "Bounded runtime route probe accepted this route for the same case and persona.",
  });
  assert.equal(acceptedRuntimeRouteAuthority({ acceptance: acceptance!, caseId: "case-a", actualPersona: "talent" }).status, "UNAVAILABLE");
});

test("an accepted runtime-surface probe transports its route before later execution gates", () => {
  const acceptance = acceptedRuntimeRouteFromProbe({
    caseId: "web-runtime-surface-example",
    persona: "company_admin",
    probeResult: {
      acceptedRoute: "/company/all-payments",
      attempts: [{
        route: "/company/all-payments",
        finalUrl: "https://runtime/company/all-payments",
        accepted: true,
        reason: "matched surface",
        matchedLandmarks: ["payment"],
      }],
    },
  });
  assert.equal(acceptedRuntimeRouteAuthority({
    acceptance: acceptance!,
    caseId: "web-runtime-surface-example",
    actualPersona: "company_admin",
  }).status, "AVAILABLE");
});

test("visited or rejected routes are not transported", () => {
  assert.equal(acceptedRuntimeRouteFromProbe({ caseId: "case-a", persona: "company_admin", probeResult: { acceptedRoute: "/company/assessments/13", attempts: [{ route: "/company/assessments/13", finalUrl: "https://runtime/company/assessments/13", accepted: false, reason: "rejected", matchedLandmarks: [] }] } }), null);
  assert.equal(acceptedRuntimeRouteAuthority({ caseId: "case-a", actualPersona: "company_admin" }).status, "UNAVAILABLE");
});

test("finalized composed fixture navigation transports its exact accepted route", () => {
  const acceptance = acceptedRuntimeRouteFromNavigationBinding({
    caseId: "case-a",
    persona: "talent",
    composedExecutionCaseId: "source-case-a",
    binding: composedBinding(),
  });
  assert.deepEqual(acceptedRuntimeRouteAuthority({
    acceptance: acceptance!,
    caseId: "case-a",
    actualPersona: "talent",
  }), {
    status: "AVAILABLE",
    value: "/talent/contracts/386",
    source: "Finalized composed runtime navigation binding accepted this route for the same case and persona.",
  });
});

test("missing or persona-mismatched composed binding cannot transport a route", () => {
  assert.equal(acceptedRuntimeRouteFromNavigationBinding({
    caseId: "case-a",
    persona: "talent",
    composedExecutionCaseId: "source-case-a",
    binding: null,
  }), null);
  assert.equal(acceptedRuntimeRouteFromNavigationBinding({
    caseId: "case-a",
    persona: "company_admin",
    composedExecutionCaseId: "source-case-a",
    binding: composedBinding(),
  }), null);
  assert.equal(acceptedRuntimeRouteFromNavigationBinding({
    caseId: "case-a",
    persona: "talent",
    composedExecutionCaseId: "other-source-case",
    binding: composedBinding(),
  }), null);
});

test("cached acceptance can be rebound only within its persona", () => {
  const acceptance = accepted()!;
  assert.equal(rebindAcceptedRuntimeRoute({ acceptance, caseId: "case-b", persona: "company_admin" })?.caseId, "case-b");
  assert.equal(rebindAcceptedRuntimeRoute({ acceptance, caseId: "case-b", persona: "talent" }), null);
});

test("accepted route alone does not imply target or fixture readiness and cannot materialize PASS prerequisites", () => {
  const route = acceptedRuntimeRouteAuthority({ acceptance: accepted()!, caseId: "case-a", actualPersona: "company_admin" });
  const context = buildBrowserDeterministicPassRuntimeContext({
    acceptedRoutePath: route,
    targetVerified: { status: "UNAVAILABLE", reason: "No target grounding." },
    fixtureStatus: { status: "UNAVAILABLE", reason: "No fixture lifecycle." },
  });
  assert.equal(context.acceptedRoutePath.status, "AVAILABLE");
  assert.equal(context.targetVerified.status, "UNAVAILABLE");
  assert.equal(context.fixtureStatus.status, "UNAVAILABLE");
  assert.equal(materializeBrowserDeterministicPassRuntimePrerequisites(context), null);
});

test("talent route acceptance retains the same transport behavior", () => {
  const acceptance = acceptedRuntimeRouteFromProbe({
    caseId: "talent-case",
    persona: "talent",
    probeResult: { acceptedRoute: "/talent/profile", attempts: [{ route: "/talent/profile", finalUrl: "https://runtime/talent/profile", accepted: true, reason: "matched", matchedLandmarks: [] }] },
  });
  assert.equal(acceptedRuntimeRouteAuthority({ acceptance: acceptance!, caseId: "talent-case", actualPersona: "talent" }).status, "AVAILABLE");
});
