import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserExecutionIntentAuthority, BrowserRuntimeExecutionBinding } from "./browser-runtime-execution-binding.js";
import { validateBrowserRuntimeExecutionBinding } from "./browser-runtime-execution-binding.js";
import { createValidatedBrowserRuntimeExecutionBinding } from "./browser-runtime-execution-binding.js";

const sourceRefs = [{ sourceUnitId: "acceptance-1", sourceRef: "jira:AS-test#acceptance" }];

function intent(overrides: Partial<BrowserExecutionIntentAuthority> = {}): BrowserExecutionIntentAuthority {
  return {
    schemaVersion: 1,
    caseId: "web-1",
    executionObligationIds: ["obligation-a"],
    executionVerdictScope: {
      executionObligationIds: ["obligation-a"],
      verdictScopeObligationIds: ["obligation-a", "obligation-b"],
      verdictAuthority: "GROUP_ONLY",
    },
    sourceUnitRefs: sourceRefs,
    personaPolicy: { kind: "EXACT_PERSONA", persona: "talent", authority: "SOURCE_ACTOR" },
    executionSafety: {
      allowedMutationClasses: ["READ_ONLY", "TRANSIENT_REVERSIBLE"],
      allowedInteractionClasses: ["OBSERVE", "ASSERT_VISIBLE"],
    },
    fixtureRequirementRefs: [],
    sourceTargetEnvelope: {
      semanticIdentity: "source-backed-offer-surface",
      sourceSurface: "Offer surface",
      sourceUnitRefs: sourceRefs,
      compatibleTargetSources: ["surface", "heading"],
      routePolicy: {
        kind: "PREBOUND_EXACT",
        route: "/talent/offers",
        authority: "SOURCE_ROUTE",
        sourceRefs: ["jira:AS-test#acceptance"],
      },
    },
    ...overrides,
  };
}

function binding(overrides: Partial<BrowserRuntimeExecutionBinding> = {}): BrowserRuntimeExecutionBinding {
  return {
    schemaVersion: 1,
    caseId: "web-1",
    executionObligationIds: ["obligation-a"],
    actualPersona: "talent",
    resolvedRoute: "/talent/offers",
    resolvedTarget: {
      semanticIdentity: "source-backed-offer-surface",
      source: "surface",
      label: "Offers",
    },
    routeBindingEvidence: {
      kind: "ROUTE_MANIFEST_CONFIRMED",
      routeCandidateCount: 1,
      evidenceReference: "route-evidence-1",
      compatibleSourceUnitRefs: sourceRefs,
    },
    targetBindingEvidence: {
      kind: "FRESH_BROWSER_OBSERVATION",
      observationId: "observation-1",
      candidateCount: 1,
      selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY",
      authority: "DETERMINISTIC_BROWSER_OBSERVATION",
      heuristic: "NONE",
      compatibleSourceUnitRefs: sourceRefs,
    },
    freshness: {
      executionId: "execution-1",
      stateIdentity: "state-1",
      observedAt: "2026-09-09T00:00:00.000Z",
      fresh: true,
    },
    observedMutationClass: "READ_ONLY",
    ...overrides,
  };
}

function validate(
  intentValue = intent(),
  bindingValue = binding()
) {
  return validateBrowserRuntimeExecutionBinding({
    intent: intentValue,
    binding: bindingValue,
    currentExecutionId: "execution-1",
    currentStateIdentity: "state-1",
  });
}

test("validates a prebound-compatible intent and binding without producing a verdict", () => {
  const result = validate();
  assert.equal(result.status, "VALID");
  if (result.status === "VALID") assert.equal(result.binding.resolvedRoute, "/talent/offers");
});

test("validates a runtime-discoverable intent only after a unique runtime route and target bind", () => {
  const runtimeIntent = intent({
    sourceTargetEnvelope: {
      ...intent().sourceTargetEnvelope,
      routePolicy: { kind: "RUNTIME_DISCOVERABLE", sourceUnitRefs: sourceRefs },
    },
  });
  const runtimeBinding = binding({
    resolvedRoute: "/talent/offers/runtime-entity",
    routeBindingEvidence: {
      kind: "FRESH_BROWSER_OBSERVATION",
      routeCandidateCount: 1,
      evidenceReference: "fresh-route-observation",
      compatibleSourceUnitRefs: sourceRefs,
    },
  });
  assert.equal(validate(runtimeIntent, runtimeBinding).status, "VALID");
});

test("configured source-silent persona is runtime configuration, not source authority", () => {
  const configuredIntent = intent({
    personaPolicy: { kind: "CONFIGURED_EXECUTION_PERSONA", persona: "talent" },
  });
  assert.equal(validate(configuredIntent).status, "VALID");
  assert.equal(
    validate(configuredIntent, binding({ actualPersona: "company_admin" })).status,
    "INVALID"
  );
});

test("fails closed for immutable scope, persona, route, target, freshness, and safety violations", () => {
  const cases: Array<[string, BrowserExecutionIntentAuthority, BrowserRuntimeExecutionBinding]> = [
    ["case", intent(), binding({ caseId: "web-other" })],
    ["scope", intent(), binding({ executionObligationIds: ["obligation-b"] })],
    ["sibling widening", intent(), binding({ executionObligationIds: ["obligation-a", "obligation-b"] })],
    ["persona", intent(), binding({ actualPersona: "company_admin" })],
    ["unknown route", intent(), binding({ resolvedRoute: "UNKNOWN" })],
    ["zero route", intent(), binding({ routeBindingEvidence: { ...binding().routeBindingEvidence, routeCandidateCount: 0 } })],
    ["planner route", intent(), binding({ routeBindingEvidence: { ...binding().routeBindingEvidence, kind: "PLANNER_ROUTE_PROSE" } })],
    ["route mismatch", intent(), binding({ resolvedRoute: "/other" })],
    ["zero target", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, candidateCount: 0 } })],
    ["ambiguous target", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, candidateCount: 2 } })],
    ["planner target", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, kind: "PLANNER_TARGET_PROSE", authority: "PLANNER_ONLY" } })],
    ["review target", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, kind: "SCREENSHOT_REVIEW", authority: "REVIEW_ONLY" } })],
    ["dom order", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, heuristic: "DOM_ORDER" } })],
    ["nth", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, heuristic: "NTH_SELECTOR" } })],
    ["pixel", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, heuristic: "PIXEL" } })],
    ["proximity", intent(), binding({ targetBindingEvidence: { ...binding().targetBindingEvidence, heuristic: "PROXIMITY" } })],
    ["unrelated target", intent(), binding({ resolvedTarget: { ...binding().resolvedTarget, semanticIdentity: "different-source-surface" } })],
    ["stale execution", intent(), binding({ freshness: { ...binding().freshness, executionId: "old-execution" } })],
    ["stale state", intent(), binding({ freshness: { ...binding().freshness, stateIdentity: "old-state" } })],
    ["persistent mutation", intent(), binding({ observedMutationClass: "PERSISTENT_BROWSER" })],
  ];
  for (const [name, intentValue, bindingValue] of cases) {
    assert.equal(validate(intentValue, bindingValue).status, "INVALID", name);
  }
});

test("rejects a binding that does not preserve the intent check scope", () => {
  const checkScopeMismatch = intent({
    executionCheckContract: {
      schemaVersion: 1,
      caseId: "web-1",
      executionObligationIds: ["obligation-b"],
      requiredChecks: [],
      requiredManualCheckIds: [],
    },
  });
  assert.deepEqual(validate(checkScopeMismatch), {
    status: "INVALID",
    reason: "INTENT_CHECK_SCOPE_MISMATCH",
  });
});

test("a fresh unique generic observation creates a transport-only valid binding", () => {
  const value = intent({
    sourceTargetEnvelope: {
      ...intent().sourceTargetEnvelope,
      semanticIdentity: "Offer surface",
      sourceSurface: "Offer surface",
      routePolicy: { kind: "RUNTIME_DISCOVERABLE", sourceUnitRefs: sourceRefs },
    },
  });
  const result = createValidatedBrowserRuntimeExecutionBinding({
    intent: value,
    actualPersona: "talent",
    resolvedRoute: "/talent/offers/runtime-entity",
    observation: {
      url: "https://qa.example.invalid/talent/offers/runtime-entity",
      title: "Offers",
      headings: [],
      controls: [],
      inputs: [],
      surfaces: [{ kind: "region", label: "Offer surface", role: "region", modal: false, textPreview: "" }],
      visibleText: [],
      counts: { headings: 0, controls: 0, inputs: 0, surfaces: 1, visibleText: 0 },
    },
    matchedTarget: { source: "surface", label: "Offer surface" },
    executionId: "execution-1",
    stateIdentity: "state-1",
    observedMutationClass: "READ_ONLY",
    observationId: "observation-1",
  });
  assert.equal(result.status, "VALID");
});
