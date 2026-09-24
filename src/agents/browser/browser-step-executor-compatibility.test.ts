import assert from "node:assert/strict";
import test from "node:test";

import { isAdvisoryCompatibilityNavigationStep } from "./browser-step-executor.js";

test("compatibility navigation is advisory only when explicitly marked", () => {
  assert.equal(isAdvisoryCompatibilityNavigationStep({ action: "clickButton", text: "Open auxiliary surface", compatibilityNavigation: "ADVISORY" }), true);
  assert.equal(isAdvisoryCompatibilityNavigationStep({ action: "clickButton", text: "Source-authorized control" }), false);
  assert.equal(isAdvisoryCompatibilityNavigationStep({ action: "assertTextVisible", text: "Listening" }), false);
});
