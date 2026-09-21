import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssessmentRouteFromRuntimeResourceContext } from "./browser-runtime-resource-route-binding.js";

test("assessment handoff binds company route", () => {
  assert.equal(resolveAssessmentRouteFromRuntimeResourceContext({ persona: "company_admin", runtimeResourceContext: { assessmentId: "500" } }), "/company/assessments/500");
});

test("assessment handoff binds talent prepare route", () => {
  assert.equal(resolveAssessmentRouteFromRuntimeResourceContext({ persona: "talent", runtimeResourceContext: { assessmentId: "500" } }), "/talent/assessments/500/prepare");
});

test("blank IDs and unsupported personas fail closed without mutation", () => {
  const context = { assessmentId: "  " };
  assert.equal(resolveAssessmentRouteFromRuntimeResourceContext({ persona: "talent", runtimeResourceContext: context }), undefined);
  assert.equal(resolveAssessmentRouteFromRuntimeResourceContext({ persona: "unknown", runtimeResourceContext: { assessmentId: "500" } }), undefined);
  assert.deepEqual(context, { assessmentId: "  " });
});
