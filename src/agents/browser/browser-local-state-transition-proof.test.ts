import assert from "node:assert/strict";
import {
  after,
  before,
  test,
} from "node:test";
import {
  chromium,
  type Browser,
  type Page,
} from "playwright";

import {
  observeSourceBoundControl,
  type BrowserSourceBoundControlBinding,
  type BrowserSourceBoundControlRequirement,
} from "./browser-source-bound-control.js";
import {
  adjacentNumericTestSetupValue,
  authorizeBrowserLocalControlAction,
  evaluateBrowserLocalStateTransition,
  executeBrowserLocalControlAction,
  installProductNonGetGuard,
  type BrowserLocalControlActionEvidence,
  type BrowserLocalControlProofContext,
  type EvaluateBrowserLocalTransitionArgs,
} from "./browser-local-state-transition-proof.js";

let browser: Browser;
let page: Page;
const originalLocalActionFlag =
  process.env
    .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS;

before(async () => {
  process.env
    .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS =
    "true";
  browser = await chromium.launch({
    headless: true,
  });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
  if (
    originalLocalActionFlag === undefined
  ) {
    delete process.env
      .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS;
  } else {
    process.env
      .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS =
      originalLocalActionFlag;
  }
});

function requirement(
  overrides:
    Partial<BrowserSourceBoundControlRequirement> = {}
): BrowserSourceBoundControlRequirement {
  return {
    bindingId: "binding:feature",
    sourceRef: "source:req-1",
    componentRef: "src/Feature.tsx",
    sourceStructureVerified: true,
    renderedUnitEvidence:
      "ONE_LABEL_ONE_CONTROL",
    surface: {
      kind: "dialog",
      label: "Settings",
    },
    visibleLabel: "Feature",
    controlRole: "switch",
    relation:
      "LABELLED_RENDERED_UNIT",
    unitAncestorDepth: 1,
    sourceTraceLocalOnly: true,
    ...overrides,
  };
}

function bound(
  overrides:
    Partial<BrowserSourceBoundControlBinding> = {}
): BrowserSourceBoundControlBinding {
  return {
    status: "BOUND",
    bindingId: "binding:feature",
    bindingIdentity:
      "binding:feature|stable",
    sourceRef: "source:req-1",
    componentRef: "src/Feature.tsx",
    surfaceKind: "dialog",
    surfaceLabel: "Settings",
    visibleLabel: "Feature",
    controlRole: "switch",
    runtimeCorrespondence:
      "UNIQUE_SOURCE_STRUCTURED_UNIT",
    visible: true,
    disabled: false,
    interactionPossible: true,
    state: { checked: false },
    ...overrides,
  };
}

function context(
  overrides:
    Partial<BrowserLocalControlProofContext> = {}
): BrowserLocalControlProofContext {
  return {
    proofRequested: true,
    obligationId: "obligation-1",
    sourceId: "source-1",
    routePath: "/create",
    activeSurfaceLabel: "Settings",
    transportGuardActive: true,
    featureEnabled: true,
    ...overrides,
  };
}

function actionEvidence(
  id: string,
  overrides:
    Partial<BrowserLocalControlActionEvidence> = {}
): BrowserLocalControlActionEvidence {
  return {
    actionId: id,
    kind: "TOGGLE_SWITCH",
    targetBindingIdentity:
      "binding:feature|stable",
    executed: true,
    stateChanged: true,
    settled: true,
    beforeState: {},
    afterState: {},
    note: "settled",
    ...overrides,
  };
}

function transitionInput(
  overrides:
    Partial<EvaluateBrowserLocalTransitionArgs> = {}
): EvaluateBrowserLocalTransitionArgs {
  const activation = bound({
    state: { checked: true },
  });
  const initial = bound({
    bindingId: "binding:value",
    bindingIdentity:
      "binding:value|stable",
    visibleLabel: "Penalty",
    controlRole: "slider",
    state: {
      value: -1,
      displayedValue: -1,
      min: -100,
      max: 0,
      step: 1,
    },
  });
  const alternate = {
    ...initial,
    state: {
      ...initial.state,
      value: -2,
      displayedValue: -2,
    },
  };
  const resetButton = bound({
    bindingId: "binding:reset",
    bindingIdentity:
      "binding:reset|stable",
    visibleLabel: "Reset",
    controlRole: "button",
    state: {},
  });

  return {
    schemaVersion: 1,
    kind:
      "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    proofRequirementId:
      "requirement-1",
    proofAuthority: "ACCEPTANCE",
    obligationId: "obligation-1",
    sourceId: "source-1",
    sourceText:
      "Enabled shows -1; reset restores -1.",
    expectedValue: -1,
    expectedValueAuthority:
      "JIRA_AUTHORIZED",
    surface: {
      kind: "dialog",
      label: "Settings",
      routePath: "/create",
    },
    bindings: {
      activation,
      valueInitial: initial,
      valueAlternate: alternate,
      reset: resetButton,
      valueReset: initial,
    },
    actions: {
      activation:
        actionEvidence("activate"),
      alternateSetup:
        actionEvidence("alternate", {
          kind:
            "SET_NUMERIC_TEST_VALUE",
          testSetupValue: -2,
          testSetupAuthority:
            "TEST_SETUP_ONLY",
        }),
      reset: actionEvidence("reset", {
        kind: "ACTIVATE_CONTROL",
      }),
      restore:
        actionEvidence("restore", {
          kind: "CANCEL_SURFACE",
        }),
    },
    alternateValue: -2,
    alternateValueAuthority:
      "TEST_SETUP_ONLY",
    settlement: {
      activation: true,
      initialValue: true,
      alternateValue: true,
      resetValue: true,
    },
    transportGuard: {
      activeDuringProof: true,
      productNonGetCount: 0,
      attempts: [],
    },
    restore: {
      modalClosed: true,
      draftDiscardVerified: true,
      routePreserved: true,
    },
    ...overrides,
  };
}

async function setPage(body: string) {
  await page.setContent(
    `<div role="dialog" aria-label="Settings">${body}</div>`
  );
}

test("1 unique source-backed label plus one switch binds", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="false"></button></div>');
  assert.equal((await observeSourceBoundControl(page, requirement())).status, "BOUND");
});

test("2 one label plus two switches abstains", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="false"></button><button role="switch" aria-checked="true"></button></div>');
  assert.equal((await observeSourceBoundControl(page, requirement())).status, "ABSTAINED");
});

test("3 duplicate matching rendered units abstain", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="false"></button></div><div><span>Feature</span><button role="switch" aria-checked="false"></button></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "ABSTAINED" && result.reason, "CONTROL_BINDING_AMBIGUOUS");
});

test("4 hidden matching switch cannot bind", async () => {
  await setPage('<div><span>Feature</span><button hidden role="switch" aria-checked="false"></button></div>');
  assert.equal((await observeSourceBoundControl(page, requirement())).status, "ABSTAINED");
});

test("5 wrong active dialog cannot bind", async () => {
  await page.setContent('<div role="dialog" aria-label="Other"><div><span>Feature</span><button role="switch" aria-checked="false"></button></div></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "ABSTAINED" && result.reason, "TARGET_SURFACE_NOT_GROUNDED");
});

test("6 unrelated same label without expected control cannot bind", async () => {
  await setPage('<div><span>Feature</span><a href="#">Feature</a></div>');
  assert.equal((await observeSourceBoundControl(page, requirement())).status, "ABSTAINED");
});

test("7 duplicate controls never use nth or first fallback", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="false"></button><button role="switch" aria-checked="false"></button></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "ABSTAINED" && result.reason, "CONTROL_BINDING_AMBIGUOUS");
});

test("8 framework class alone supplies no authority", async () => {
  await setPage('<div class="Feature"><button class="ant-switch" role="switch" aria-checked="false"></button></div>');
  assert.equal((await observeSourceBoundControl(page, requirement())).status, "ABSTAINED");
});

test("9 aria-checked true is captured", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="true"></button></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "BOUND" && result.state.checked, true);
});

test("10 aria-checked false is captured", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="false"></button></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "BOUND" && result.state.checked, false);
});

test("11 invalid checked state abstains", async () => {
  await setPage('<div><span>Feature</span><button role="switch" aria-checked="mixed"></button></div>');
  const result = await observeSourceBoundControl(page, requirement());
  assert.equal(result.status === "ABSTAINED" && result.reason, "ACTUAL_STATE_UNAVAILABLE");
});

const sliderRequirement = requirement({
  bindingId: "binding:value",
  visibleLabel: "Penalty",
  controlRole: "slider",
  unitAncestorDepth: 2,
});

test("12 actual underlying slider value -1 is captured", async () => {
  await setPage('<div><div><span>Penalty</span></div><div><div role="slider" style="width: 100px; height: 10px" aria-valuenow="-1" aria-valuemin="-100" aria-valuemax="0"></div><output>-1</output></div></div>');
  const result = await observeSourceBoundControl(page, sliderRequirement);
  assert.equal(result.status === "BOUND" && result.state.value, -1);
});

test("13 placeholder numeric value is rejected", async () => {
  await setPage('<div><span>Penalty</span><input type="number" placeholder="-1"></div>');
  const result = await observeSourceBoundControl(page, requirement({ visibleLabel: "Penalty", controlRole: "numeric-input" }));
  assert.equal(result.status === "ABSTAINED" && result.reason, "ACTUAL_VALUE_UNAVAILABLE");
});

test("14 adjacent numeric text cannot replace an underlying value", async () => {
  await setPage('<div><div><span>Penalty</span></div><div><div role="slider" style="width: 100px; height: 10px"></div><output>-1</output></div></div>');
  const result = await observeSourceBoundControl(page, sliderRequirement);
  assert.equal(result.status === "ABSTAINED" && result.reason, "ACTUAL_VALUE_UNAVAILABLE");
});

test("15 displayed and underlying mismatch abstains", async () => {
  await setPage('<div><div><span>Penalty</span></div><div><div role="slider" style="width: 100px; height: 10px" aria-valuenow="-1"></div><output>-2</output></div></div>');
  const result = await observeSourceBoundControl(page, sliderRequirement);
  assert.equal(result.status === "ABSTAINED" && result.reason, "VALUE_DISPLAY_MISMATCH");
});

test("16 duplicate numeric controls abstain", async () => {
  await setPage('<div><div><span>Penalty</span></div><div><div role="slider" style="width: 100px; height: 10px" aria-valuenow="-1"></div><div role="slider" style="width: 100px; height: 10px" aria-valuenow="-1"></div></div></div>');
  assert.equal((await observeSourceBoundControl(page, sliderRequirement)).status, "ABSTAINED");
});

function authorize(label = "Feature", overrides: Record<string, unknown> = {}) {
  return authorizeBrowserLocalControlAction({
    action: {
      actionId: "action-1",
      kind: "TOGGLE_SWITCH",
      requirement: requirement(),
      ...(overrides.action as object ?? {}),
    },
    binding: bound({ visibleLabel: label, ...(overrides.binding as object ?? {}) }),
    context: context(overrides.context as object ?? {}),
    currentRoutePath: String(overrides.route ?? "/create"),
  });
}

test("17 grounded local switch toggle is authorized in proof context", () => assert.equal(authorize().authorized, true));
test("18 same toggle is rejected outside enabled proof context", () => assert.equal(authorize("Feature", { context: { featureEnabled: false } }).authorized, false));
test("19 Save is rejected", () => assert.equal(authorize("Save").authorized, false));
test("20 Create is rejected", () => assert.equal(authorize("Create Assessment").authorized, false));
test("21 Submit is rejected", () => assert.equal(authorize("Submit").authorized, false));
test("22 mismatched source-bound control is rejected", () => assert.equal(authorize("Feature", { binding: { bindingId: "other" } }).authorized, false));
test("23 wrong active surface is rejected", () => assert.equal(authorize("Feature", { context: { activeSurfaceLabel: "Other" } }).authorized, false));
test("24 inactive transport guard rejects local actions", () => assert.equal(authorize("Feature", { context: { transportGuardActive: false } }).authorized, false));
test("25 unsupported direct-state action vocabulary is unavailable", () => assert.equal(authorize("Feature", { action: { kind: "DIRECT_JS_STATE" } }).authorized, false));
test("26 wrong route cannot fall back to the first control", () => assert.equal(authorize("Feature", { route: "/other" }).authorized, false));

test("27 initial -1 without a distinct setup value cannot prove reset", () => {
  const result = evaluateBrowserLocalStateTransition(transitionInput({ alternateValue: -1 }));
  assert.equal(result.result, "ABSTAINED");
});

test("28 full -1 to alternate to reset to -1 confirms", () => {
  assert.equal(evaluateBrowserLocalStateTransition(transitionInput()).result, "CONFIRMED");
});

test("29 unobserved alternate state abstains", () => {
  const input = transitionInput();
  input.bindings.valueAlternate = { ...input.bindings.valueAlternate, state: { ...input.bindings.valueAlternate.state, value: -1 } };
  assert.equal(evaluateBrowserLocalStateTransition(input).result, "ABSTAINED");
});

test("30 wrong control identity for reset abstains", () => {
  const input = transitionInput();
  input.bindings.valueReset = { ...input.bindings.valueReset, bindingIdentity: "other" };
  assert.equal(evaluateBrowserLocalStateTransition(input).reason, "CONTROL_IDENTITY_CHANGED");
});

test("31 identity changing during alternate observation abstains", () => {
  const input = transitionInput();
  input.bindings.valueAlternate = { ...input.bindings.valueAlternate, bindingIdentity: "changed" };
  assert.equal(evaluateBrowserLocalStateTransition(input).reason, "CONTROL_IDENTITY_CHANGED");
});

test("32 reset leaving alternate value is contradicted", () => {
  const input = transitionInput();
  input.bindings.valueReset = { ...input.bindings.valueReset, state: { ...input.bindings.valueReset.state, value: -2, displayedValue: -2 } };
  const result = evaluateBrowserLocalStateTransition(input);
  assert.equal(result.result, "CONTRADICTED");
  assert.equal(result.reason, "RESET_VALUE_CONTRADICTED");
});

test("33 transient state cannot confirm", () => {
  const input = transitionInput({ settlement: { activation: true, initialValue: true, alternateValue: false, resetValue: true } });
  assert.equal(evaluateBrowserLocalStateTransition(input).reason, "STATE_UNSETTLED");
});

test("34 restore failure prevents confirmation", () => {
  const input = transitionInput({ restore: { modalClosed: true, draftDiscardVerified: false, routePreserved: true } });
  assert.equal(evaluateBrowserLocalStateTransition(input).reason, "RESTORE_NOT_VERIFIED");
});

test("35 any product non-GET attempt prevents confirmation", () => {
  const input = transitionInput({ transportGuard: { activeDuringProof: true, productNonGetCount: 1, attempts: [{ method: "POST", path: "/create" }] } });
  assert.equal(evaluateBrowserLocalStateTransition(input).reason, "NON_GET_REQUEST_ATTEMPTED");
});

test("36 alternate setup value must remain TEST_SETUP_ONLY", () => {
  const input = transitionInput();
  input.alternateValueAuthority = "JIRA_AUTHORIZED" as "TEST_SETUP_ONLY";
  assert.equal(evaluateBrowserLocalStateTransition(input).result, "ABSTAINED");
});

test("37 implementation default cannot authorize expected value", () => {
  assert.equal(evaluateBrowserLocalStateTransition(transitionInput({ expectedValueAuthority: "IMPLEMENTATION_ONLY" })).reason, "AUTHORITY_NOT_ACCEPTABLE");
});

test("38 planner-only expected value cannot authorize proof", () => {
  assert.equal(evaluateBrowserLocalStateTransition(transitionInput({ expectedValueAuthority: "PLANNER_ONLY" })).reason, "AUTHORITY_NOT_ACCEPTABLE");
});

test("39 screenshots cannot replace missing deterministic execution", () => {
  const input = transitionInput();
  input.actions.reset = actionEvidence("reset", { kind: "ACTIVATE_CONTROL", executed: false, stateChanged: false, settled: false, note: "screenshot only" });
  assert.notEqual(evaluateBrowserLocalStateTransition(input).result, "CONFIRMED");
});

test("40 label visibility cannot replace an actual value", () => {
  const input = transitionInput();
  input.bindings.valueInitial = { ...input.bindings.valueInitial, state: {} };
  assert.notEqual(evaluateBrowserLocalStateTransition(input).result, "CONFIRMED");
});

test("41 adjacent numeric setup is bounded and tagged", () => {
  const result = adjacentNumericTestSetupValue(bound({ controlRole: "slider", state: { value: -1, min: -100, max: 0, step: 1 } }));
  assert.deepEqual(result, { value: -2, authority: "TEST_SETUP_ONLY" });
});

test("42 no adjacent numeric setup exists outside fixed bounds", () => {
  assert.equal(adjacentNumericTestSetupValue(bound({ controlRole: "slider", state: { value: 0, min: 0, max: 0, step: 1 } })), undefined);
});

test("43 Update is rejected by the reused consequence policy", () => assert.equal(authorize("Update").authorized, false));
test("44 Accept is rejected by the reused consequence policy", () => assert.equal(authorize("Accept").authorized, false));
test("45 malformed non-local source provenance is rejected", () => assert.equal(authorize("Feature", { action: { requirement: requirement({ sourceTraceLocalOnly: false as true }) } }).authorized, false));

test("46 the process-level capability flag cannot be bypassed by context", () => {
  delete process.env.QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS;
  try {
    assert.equal(authorize().authorized, false);
  } finally {
    process.env.QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS = "true";
  }
});

test("47 a prior product non-GET attempt aborts before local execution", async () => {
  const result = await executeBrowserLocalControlAction({
    page,
    action: {
      actionId: "blocked-after-attempt",
      kind: "TOGGLE_SWITCH",
      requirement: requirement(),
    },
    binding: bound(),
    context: context(),
    guard: {
      origin: "https://product.example",
      active: true,
      attempts: [{ method: "POST", path: "/assessment" }],
      stop: async () => {},
    },
  });
  assert.equal(result.executed, false);
  assert.match(result.note, /already aborted/);
});

test("48 background GET navigation does not trip the non-GET guard", async () => {
  const guard =
    await installProductNonGetGuard(
      page,
      "data:text/html,product"
    );
  try {
    await page.goto(
      "data:text/html,poll",
      { waitUntil: "domcontentloaded" }
    );
    assert.deepEqual(guard.attempts, []);
  } finally {
    await guard.stop();
  }
});
