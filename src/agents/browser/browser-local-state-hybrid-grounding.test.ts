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
  authorizeBrowserLocalControlAction,
  evaluateBrowserLocalStateTransition,
  type BrowserLocalControlActionEvidence,
} from "./browser-local-state-transition-proof.js";
import {
  resolveBrowserLocalStateHybridControl,
  type BrowserLocalStateHybridControlRequirement,
} from "./browser-local-state-hybrid-grounding.js";
import type {
  BrowserLocalStateHybridControlBinding,
} from "./browser-local-state-hybrid-grounding.js";

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch({
    headless: true,
  });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

function requirement(args: Partial<
  BrowserLocalStateHybridControlRequirement
> = {}): BrowserLocalStateHybridControlRequirement {
  return {
    groundingMode:
      "HYBRID_RUNTIME_SEMANTIC",
    bindingId: "binding-1",
    sourceRef: "jira-source-1",
    sourceCorroboration: {
      requirementId: "requirement-1",
      obligationId: "obligation-1",
      evidenceRefs: [
        "src/settings/defaults.ts",
      ],
      relevantControlFamilyCorroborated:
        true,
    },
    surface: {
      kind: "dialog",
      accessibleName: "Local settings",
    },
    purpose: "ACTIVATION",
    controlRole: "switch",
    accessibleName: "Enable custom values",
    semanticContainment: {
      kind: "ACTIVE_SURFACE",
    },
    ...args,
  };
}

async function setBody(body: string): Promise<void> {
  await page.setContent(`<!doctype html><body>${body}</body>`);
}

test("unique active-surface activation grounds without component provenance", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <button role="switch" aria-label="Enable custom values" aria-checked="false"></button>
    </div>
  `);

  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement()
    );

  assert.equal(result.observation.status, "BOUND");
  if (result.observation.status !== "BOUND") return;
  assert.equal("componentRef" in result.observation, false);
  assert.equal(
    result.observation.runtimeCorrespondence,
    "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL"
  );
  assert.equal(result.observation.state.checked, false);
});

test("unique named-unit value and reset ground without ancestor depth", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <fieldset aria-label="Penalty configuration">
        <input role="slider" aria-label="Penalty value" aria-valuenow="-3" aria-valuemin="-10" aria-valuemax="0" />
        <button>Reset values</button>
      </fieldset>
    </div>
  `);
  const containment = {
    kind: "NAMED_GROUP" as const,
    accessibleName: "Penalty configuration",
  };
  const value =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        purpose: "VALUE",
        controlRole: "slider",
        accessibleName: "Penalty value",
        semanticContainment: containment,
      })
    );
  const reset =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        bindingId: "reset-1",
        purpose: "RESET",
        controlRole: "button",
        accessibleName: "Reset values",
        semanticContainment: containment,
      })
    );

  assert.equal(value.observation.status, "BOUND");
  assert.equal(reset.observation.status, "BOUND");
  if (
    value.observation.status !== "BOUND" ||
    reset.observation.status !== "BOUND"
  ) return;
  assert.equal(value.observation.state.value, -3);
  assert.equal(
    value.observation.semanticUnitIdentity,
    reset.observation.semanticUnitIdentity
  );
});

test("unique active-surface Cancel grounds as restoration candidate", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <button>Cancel</button>
    </div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        purpose: "RESTORE",
        controlRole: "button",
        accessibleName: "Cancel",
      })
    );

  assert.equal(result.observation.status, "BOUND");
});

test("eleven indistinguishable switches abstain without positional selection", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      ${Array.from(
        { length: 11 },
        () => '<button role="switch" aria-checked="false"></button>'
      ).join("")}
    </div>
  `);
  const unnamedRequirement = requirement();
  delete unnamedRequirement.accessibleName;
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      unnamedRequirement
    );

  assert.deepEqual(result.observation, {
    status: "ABSTAINED",
    reason: "CONTROL_BINDING_AMBIGUOUS",
    note:
      "Multiple active-surface controls matched; hybrid grounding abstained without positional selection.",
  });
});

test("two exact-name controls abstain", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <button role="switch" aria-label="Enable custom values" aria-checked="false"></button>
      <button role="switch" aria-label="Enable custom values" aria-checked="false"></button>
    </div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement()
    );

  assert.equal(
    result.observation.status === "ABSTAINED"
      ? result.observation.reason
      : "BOUND",
    "CONTROL_BINDING_AMBIGUOUS"
  );
});

test("two candidate active dialogs abstain", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings"><button role="switch" aria-label="Enable custom values" aria-checked="false"></button></div>
    <div role="dialog" aria-label="Local settings"><button role="switch" aria-label="Enable custom values" aria-checked="false"></button></div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement()
    );

  assert.equal(
    result.observation.status === "ABSTAINED"
      ? result.observation.reason
      : "BOUND",
    "TARGET_SURFACE_AMBIGUOUS"
  );
});

test("globally unique background control is not eligible", async () => {
  await setBody(`
    <input role="slider" aria-label="Penalty value" aria-valuenow="-3" />
    <div role="dialog" aria-label="Local settings"><p>No value control here</p></div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        purpose: "VALUE",
        controlRole: "slider",
        accessibleName: "Penalty value",
      })
    );

  assert.equal(
    result.observation.status === "ABSTAINED"
      ? result.observation.reason
      : "BOUND",
    "CONTROL_NOT_GROUNDED"
  );
});

test("two Reset controls in the same named unit abstain", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <fieldset aria-label="Penalty configuration">
        <button>Reset values</button><button>Reset values</button>
      </fieldset>
    </div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        purpose: "RESET",
        controlRole: "button",
        accessibleName: "Reset values",
        semanticContainment: {
          kind: "NAMED_GROUP",
          accessibleName: "Penalty configuration",
        },
      })
    );

  assert.equal(
    result.observation.status === "ABSTAINED"
      ? result.observation.reason
      : "BOUND",
    "CONTROL_BINDING_AMBIGUOUS"
  );
});

test("Reset in an unrelated semantic unit is rejected", async () => {
  await setBody(`
    <div role="dialog" aria-label="Local settings">
      <fieldset aria-label="Penalty configuration"><input role="slider" aria-label="Penalty value" aria-valuenow="-3" /></fieldset>
      <fieldset aria-label="Unrelated settings"><button>Reset values</button></fieldset>
    </div>
  `);
  const result =
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement({
        purpose: "RESET",
        controlRole: "button",
        accessibleName: "Reset values",
        semanticContainment: {
          kind: "NAMED_GROUP",
          accessibleName: "Penalty configuration",
        },
      })
    );

  assert.equal(result.observation.status, "ABSTAINED");
});

function binding(args: {
  id: string;
  role: "switch" | "slider" | "button";
  value?: number;
  checked?: boolean;
  unit?: string;
}): BrowserLocalStateHybridControlBinding {
  return {
    status: "BOUND",
    bindingId: args.id,
    bindingIdentity: `identity:${args.id}`,
    sourceRef: "jira-source-1",
    surfaceKind: "dialog",
    surfaceLabel: "Local settings",
    visibleLabel: args.id,
    controlRole: args.role,
    runtimeCorrespondence:
      "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL",
    semanticUnitIdentity:
      args.unit ?? "group:penalty",
    visible: true,
    disabled: false,
    interactionPossible: true,
    state: {
      ...(args.value !== undefined
        ? { value: args.value }
        : {}),
      ...(args.checked !== undefined
        ? { checked: args.checked }
        : {}),
    },
  };
}

function action(
  id: string
): BrowserLocalControlActionEvidence {
  return {
    actionId: id,
    kind: "ACTIVATE_CONTROL",
    targetBindingIdentity: `identity:${id}`,
    executed: true,
    stateChanged: true,
    settled: true,
    beforeState: {},
    afterState: {},
    note: "verified",
  };
}

test("runtime safety and restoration can confirm without sourceTraceLocalOnly", () => {
  const activation = binding({
    id: "activation",
    role: "switch",
    checked: true,
    unit: "dialog:local settings",
  });
  const initial = binding({
    id: "value",
    role: "slider",
    value: -3,
  });
  const alternate = {
    ...initial,
    state: { value: -4 },
  };
  const resetValue = {
    ...initial,
    state: { value: -3 },
  };
  const reset = binding({
    id: "reset",
    role: "button",
  });
  const alternateAction = {
    ...action("value"),
    kind:
      "SET_NUMERIC_TEST_VALUE" as const,
    testSetupValue: -4,
    testSetupAuthority:
      "TEST_SETUP_ONLY" as const,
  };
  const evidence =
    evaluateBrowserLocalStateTransition({
      schemaVersion: 1,
      kind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      proofRequirementId: "requirement-1",
      proofAuthority: "ACCEPTANCE",
      obligationId: "obligation-1",
      sourceId: "jira-source-1",
      sourceText:
        "Reset restores the authoritative default.",
      expectedValue: -3,
      expectedValueAuthority:
        "JIRA_AUTHORIZED",
      surface: {
        kind: "dialog",
        label: "Local settings",
        routePath: "/settings/new",
      },
      bindings: {
        activation,
        valueInitial: initial,
        valueAlternate: alternate,
        reset,
        valueReset: resetValue,
      },
      actions: {
        activation: action("activation"),
        alternateSetup: alternateAction,
        reset: action("reset"),
        restore: action("restore"),
      },
      alternateValue: -4,
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
    });

  assert.equal(evidence.result, "CONFIRMED");

  const changedPersistentState =
    evaluateBrowserLocalStateTransition({
      ...evidence,
      restore: {
        ...evidence.restore,
        draftDiscardVerified: false,
      },
    });
  assert.equal(
    changedPersistentState.result,
    "ABSTAINED"
  );
});

test("hybrid action authorization keeps route, guard, feature and consequence safety", () => {
  const previous =
    process.env.QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS;
  process.env.QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS =
    "true";

  try {
    const restoreRequirement = requirement({
      purpose: "RESTORE",
      controlRole: "button",
      accessibleName: "Save",
    });
    const decision =
      authorizeBrowserLocalControlAction({
        action: {
          actionId: "restore",
          kind: "CANCEL_SURFACE",
          requirement: restoreRequirement,
        },
        binding: {
          ...binding({
            id: "binding-1",
            role: "button",
            unit: "dialog:local settings",
          }),
          visibleLabel: "Save",
        },
        context: {
          proofRequested: true,
          obligationId: "obligation-1",
          sourceId: "jira-source-1",
          routePath: "/settings/new",
          activeSurfaceLabel:
            "Local settings",
          transportGuardActive: true,
          featureEnabled: true,
        },
        currentRoutePath: "/settings/new",
      });

    assert.deepEqual(decision, {
      authorized: false,
      reason:
        "CONSEQUENTIAL_CONTROL_REJECTED",
      note:
        "The existing deterministic consequence policy rejected the control label.",
    });
  } finally {
    if (previous === undefined) {
      delete process.env
        .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS;
    } else {
      process.env.QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS =
        previous;
    }
  }
});

test("runtime values cannot rewrite Jira acceptance truth", () => {
  const initial = binding({
    id: "value",
    role: "slider",
    value: -9,
  });
  const result =
    evaluateBrowserLocalStateTransition({
      schemaVersion: 1,
      kind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      proofRequirementId: "requirement-1",
      proofAuthority: "ACCEPTANCE",
      obligationId: "obligation-1",
      sourceId: "jira-source-1",
      sourceText: "authoritative",
      expectedValue: -3,
      expectedValueAuthority:
        "JIRA_AUTHORIZED",
      surface: {
        kind: "dialog",
        label: "Local settings",
        routePath: "/settings/new",
      },
      bindings: {
        activation: binding({
          id: "activation",
          role: "switch",
          checked: true,
          unit: "dialog:local settings",
        }),
        valueInitial: initial,
        valueAlternate: initial,
        reset: binding({
          id: "reset",
          role: "button",
        }),
        valueReset: initial,
      },
      actions: {
        activation: action("activation"),
        alternateSetup: action("value"),
        reset: action("reset"),
        restore: action("restore"),
      },
      alternateValue: -4,
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
    });

  assert.equal(result.result, "CONTRADICTED");
});
