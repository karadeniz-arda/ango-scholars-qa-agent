import assert from "node:assert/strict";
import test from "node:test";

import { beginBrowserCaseRuntimeAudit } from "./browser-case-runtime-audit.js";
import { deriveBrowserCaseRuntimeSafetySignals, buildBrowserDeterministicPassRuntimeContext, materializeBrowserDeterministicPassRuntimePrerequisites } from "./browser-deterministic-pass-runtime-context.js";

function page() {
  let listener: ((request: any) => void) | undefined;
  return {
    on: (_event: string, next: (request: any) => void) => { listener = next; },
    off: () => { listener = undefined; },
    request: (url: string, method: string) => listener?.({ url: () => url, method: () => method }),
  };
}

test("missing audit facts remain unavailable and cannot materialize PASS prerequisites", () => {
  const signals = deriveBrowserCaseRuntimeSafetySignals(undefined);
  assert.equal(signals.safetyViolation.status, "UNAVAILABLE");
  assert.equal(signals.productNonGetCount.status, "UNAVAILABLE");
  assert.equal(signals.persistenceViolation.status, "UNAVAILABLE");
  assert.equal(signals.testDataIssue.status, "UNAVAILABLE");
  assert.equal(materializeBrowserDeterministicPassRuntimePrerequisites(buildBrowserDeterministicPassRuntimeContext(signals)), null);
});

test("page-scoped audit observes exact product mutations and excludes outside-origin and after-finish traffic", () => {
  const fake = page();
  const audit = beginBrowserCaseRuntimeAudit({ caseId: "case-1", page: fake as any, productOrigin: "https://product.test" });
  fake.request("https://auth.test/session", "POST");
  fake.request("https://product.test/api/a", "GET");
  fake.request("https://product.test/api/b", "POST");
  fake.request("https://product.test/api/c", "PATCH");
  fake.request("https://product.test/api/d", "PUT");
  fake.request("https://product.test/api/e", "DELETE");
  audit.recordSafetyEvaluation({ safeToExecute: true, executed: true });
  audit.completeSafetyAccounting();
  audit.recordPersistence("CLEAN");
  audit.recordTestData("CLEAR");
  const facts = audit.finish();
  fake.request("https://product.test/api/next-case", "POST");
  const signals = deriveBrowserCaseRuntimeSafetySignals(facts);
  assert.equal(facts.productRequests.status, "COMPLETE");
  if (facts.productRequests.status !== "COMPLETE") throw new Error("request audit did not complete");
  assert.deepEqual(facts.productRequests.nonGetAttempts, [
    { method: "POST", path: "/api/b" }, { method: "PATCH", path: "/api/c" },
    { method: "PUT", path: "/api/d" }, { method: "DELETE", path: "/api/e" },
  ]);
  assert.deepEqual(signals.safetyViolation, { status: "AVAILABLE", value: false, source: "Completed case-scoped deterministic action-safety audit." });
  assert.deepEqual(signals.productNonGetCount, { status: "AVAILABLE", value: 4, source: "Completed case-scoped product-origin request observer." });
  assert.equal(signals.persistenceViolation.status, "AVAILABLE");
  assert.equal(signals.testDataIssue.status, "AVAILABLE");
});

test("unsafe execution, persistence failure, and exact test-data classification remain authoritative negatives", () => {
  const fake = page();
  const audit = beginBrowserCaseRuntimeAudit({ caseId: "case-1", page: fake as any, productOrigin: "https://product.test" });
  audit.recordSafetyEvaluation({ safeToExecute: false, executed: true });
  audit.completeSafetyAccounting();
  audit.recordPersistence("VIOLATION");
  audit.recordTestData("TEST_DATA_ISSUE");
  const signals = deriveBrowserCaseRuntimeSafetySignals(audit.finish());
  assert.deepEqual(signals.safetyViolation, { status: "AVAILABLE", value: true, source: "Completed case-scoped deterministic action-safety audit." });
  assert.deepEqual(signals.productNonGetCount, { status: "AVAILABLE", value: 0, source: "Completed case-scoped product-origin request observer." });
  assert.deepEqual(signals.persistenceViolation, { status: "AVAILABLE", value: true, source: "Completed case-scoped persistence lifecycle audit." });
  assert.deepEqual(signals.testDataIssue, { status: "AVAILABLE", value: true, source: "Completed case-scoped deterministic test-data classification." });
});

test("completed safety and request coverage explicitly proves clean no-persistence activity", () => {
  const fake = page();
  const audit = beginBrowserCaseRuntimeAudit({ caseId: "case-1", page: fake as any, productOrigin: "https://product.test" });
  audit.recordSafetyEvaluation({ safeToExecute: true, executed: true });
  audit.completeSafetyAccounting();
  const signals = deriveBrowserCaseRuntimeSafetySignals(audit.finish());
  assert.deepEqual(signals.productNonGetCount, { status: "AVAILABLE", value: 0, source: "Completed case-scoped product-origin request observer." });
  assert.deepEqual(signals.persistenceViolation, { status: "AVAILABLE", value: false, source: "Completed case-scoped persistence lifecycle audit." });
  assert.equal(signals.testDataIssue.status, "UNAVAILABLE");
});

test("zero product mutations without explicit safety completion cannot prove clean persistence", () => {
  const fake = page();
  const audit = beginBrowserCaseRuntimeAudit({ caseId: "case-1", page: fake as any, productOrigin: "https://product.test" });
  audit.recordSafetyEvaluation({ safeToExecute: true, executed: true });
  const signals = deriveBrowserCaseRuntimeSafetySignals(audit.finish());
  assert.equal(signals.safetyViolation.status, "UNAVAILABLE");
  assert.equal(signals.persistenceViolation.status, "UNAVAILABLE");
});

test("planner lane is absent from runtime audit inputs", () => {
  const fake = page();
  const audit = beginBrowserCaseRuntimeAudit({ caseId: "case-1", page: fake as any, productOrigin: "https://product.test" });
  audit.recordSafetyEvaluation({ safeToExecute: true, executed: false });
  audit.completeSafetyAccounting();
  assert.equal(deriveBrowserCaseRuntimeSafetySignals(audit.finish()).safetyViolation.status, "AVAILABLE");
});
