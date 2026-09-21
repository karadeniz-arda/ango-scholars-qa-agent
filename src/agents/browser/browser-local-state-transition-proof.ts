import type {
  Locator,
  Page,
  Request,
  Route,
} from "playwright";

import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";
import {
  chooseAdjacentNumericTestValue,
  observeSourceBoundControl,
  resolveSourceBoundControl,
  type BrowserSourceBoundControlBinding,
  type BrowserSourceBoundControlRequirement,
} from "./browser-source-bound-control.js";
import {
  isBrowserLocalStateHybridControlRequirement,
  observeBrowserLocalStateHybridControl,
  resolveBrowserLocalStateHybridControl,
  type BrowserLocalStateHybridControlRequirement,
  type BrowserLocalStateHybridControlBinding,
} from "./browser-local-state-hybrid-grounding.js";

export type BrowserLocalControlGroundingRequirement =
  | BrowserSourceBoundControlRequirement
  | BrowserLocalStateHybridControlRequirement;

export type BrowserLocalControlBinding =
  | BrowserSourceBoundControlBinding
  | BrowserLocalStateHybridControlBinding;

export type BrowserLocalControlActionKind =
  | "TOGGLE_SWITCH"
  | "SET_NUMERIC_TEST_VALUE"
  | "ACTIVATE_CONTROL"
  | "CANCEL_SURFACE";

export type BrowserLocalControlAction = {
  actionId: string;
  kind: BrowserLocalControlActionKind;
  requirement:
    BrowserLocalControlGroundingRequirement;
  testSetupValue?: number;
};

export type BrowserLocalControlProofContext = {
  proofRequested: true;
  obligationId: string;
  sourceId: string;
  routePath: string;
  activeSurfaceLabel: string;
  transportGuardActive: boolean;
  featureEnabled: boolean;
};

export type BrowserLocalControlActionAuthorization =
  | {
      authorized: true;
      reason: "LOCAL_STATE_ONLY_CONTROL_ACTION";
    }
  | {
      authorized: false;
      reason:
        | "LOCAL_ACTION_NOT_ENABLED"
        | "PROOF_CONTEXT_REQUIRED"
        | "TRANSPORT_GUARD_REQUIRED"
        | "ROUTE_MISMATCH"
        | "SURFACE_MISMATCH"
        | "CONTROL_NOT_GROUNDED"
        | "CONTROL_NOT_INTERACTABLE"
        | "ACTION_KIND_NOT_SUPPORTED"
        | "CONSEQUENTIAL_CONTROL_REJECTED"
        | "TEST_SETUP_VALUE_INVALID";
      note: string;
    };

export type BrowserLocalControlActionEvidence = {
  actionId: string;
  kind: BrowserLocalControlActionKind;
  targetBindingIdentity: string;
  executed: boolean;
  stateChanged: boolean;
  settled: boolean;
  beforeState:
    BrowserLocalControlBinding["state"];
  afterState?:
    BrowserLocalControlBinding["state"];
  testSetupValue?: number;
  testSetupAuthority?:
    "TEST_SETUP_ONLY";
  note: string;
};

export type BrowserProductNonGetAttempt = {
  method: string;
  path: string;
};

export type BrowserProductNonGetGuard = {
  origin: string;
  active: boolean;
  attempts:
    BrowserProductNonGetAttempt[];
  stop: () => Promise<void>;
};

export type BrowserLocalTransitionProofResult =
  | "CONFIRMED"
  | "CONTRADICTED"
  | "ABSTAINED";

export type BrowserLocalTransitionProofReason =
  | "CONFIRMED"
  | "AUTHORITY_NOT_ACCEPTABLE"
  | "CONTROL_NOT_GROUNDED"
  | "LOCAL_ACTION_NOT_AUTHORIZED"
  | "NON_GET_REQUEST_ATTEMPTED"
  | "STATE_CHANGE_NOT_OBSERVED"
  | "CONTROL_IDENTITY_CHANGED"
  | "VALUE_DISPLAY_MISMATCH"
  | "RESET_NOT_PROVABLE"
  | "RESET_VALUE_CONTRADICTED"
  | "STATE_UNSETTLED"
  | "RESTORE_NOT_VERIFIED"
  | "TARGET_SURFACE_LOST";

export type BrowserLocalStateTransitionProofRequirement = {
  schemaVersion: 1;
  kind:
    "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT";
  requirementId: string;
  obligationId: string;
  sourceId: string;
  sourceRole: "ACCEPTANCE";
  proofAuthority: "ACCEPTANCE";
  expectedValue: number;
  expectedValueAuthority:
    "JIRA_AUTHORIZED";
  surface: {
    kind: "dialog";
    label: string;
    routePath: string;
  };
};

export type BrowserGroundedLocalStateTransitionEvidence = {
  schemaVersion: 1;
  kind:
    "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION";
  proofRequirementId: string;
  proofAuthority:
    | "ACCEPTANCE"
    | "TEST_SETUP_ONLY";
  obligationId: string;
  sourceId: string;
  sourceText: string;
  expectedValue: number;
  expectedValueAuthority:
    | "JIRA_AUTHORIZED"
    | "IMPLEMENTATION_ONLY"
    | "PLANNER_ONLY"
    | "UNKNOWN";
  surface: {
    kind: "dialog";
    label: string;
    routePath: string;
  };
  bindings: {
    activation:
      BrowserLocalControlBinding;
    valueInitial:
      BrowserLocalControlBinding;
    valueAlternate:
      BrowserLocalControlBinding;
    reset:
      BrowserLocalControlBinding;
    valueReset:
      BrowserLocalControlBinding;
  };
  actions: {
    activation:
      BrowserLocalControlActionEvidence;
    alternateSetup:
      BrowserLocalControlActionEvidence;
    reset:
      BrowserLocalControlActionEvidence;
    restore:
      BrowserLocalControlActionEvidence;
  };
  alternateValue: number;
  alternateValueAuthority:
    "TEST_SETUP_ONLY";
  settlement: {
    activation: boolean;
    initialValue: boolean;
    alternateValue: boolean;
    resetValue: boolean;
  };
  transportGuard: {
    activeDuringProof: boolean;
    productNonGetCount: number;
    attempts:
      BrowserProductNonGetAttempt[];
  };
  restore: {
    modalClosed: boolean;
    draftDiscardVerified: boolean;
    routePreserved: boolean;
  };
  result:
    BrowserLocalTransitionProofResult;
  reason:
    BrowserLocalTransitionProofReason;
  note: string;
};

export type EvaluateBrowserLocalTransitionArgs =
  Omit<
    BrowserGroundedLocalStateTransitionEvidence,
    "result" | "reason" | "note"
  >;

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function localStateControlActionsAllowed(): boolean {
  return String(
    process.env
      .QA_ALLOW_LOCAL_STATE_CONTROL_ACTIONS ||
      ""
  ).toLowerCase() === "true";
}

export function authorizeBrowserLocalControlAction(
  args: {
    action: BrowserLocalControlAction;
    binding:
      BrowserLocalControlBinding;
    context:
      BrowserLocalControlProofContext;
    currentRoutePath: string;
  }
): BrowserLocalControlActionAuthorization {
  const {
    action,
    binding,
    context,
    currentRoutePath,
  } = args;

  if (
    !context.featureEnabled ||
    !localStateControlActionsAllowed()
  ) {
    return {
      authorized: false,
      reason:
        "LOCAL_ACTION_NOT_ENABLED",
      note:
        "The dedicated local-state control capability is default-off.",
    };
  }

  if (
    context.proofRequested !== true ||
    !context.obligationId.trim() ||
    !context.sourceId.trim()
  ) {
    return {
      authorized: false,
      reason:
        "PROOF_CONTEXT_REQUIRED",
      note:
        "A concrete obligation-backed local transition proof context is required.",
    };
  }

  if (!context.transportGuardActive) {
    return {
      authorized: false,
      reason:
        "TRANSPORT_GUARD_REQUIRED",
      note:
        "The same-origin product non-GET transport guard must be active.",
    };
  }

  if (
    currentRoutePath !==
    context.routePath
  ) {
    return {
      authorized: false,
      reason: "ROUTE_MISMATCH",
      note:
        "The local action is outside the exact unsaved proof route.",
    };
  }

  if (
    normalize(binding.surfaceLabel) !==
    normalize(context.activeSurfaceLabel)
  ) {
    return {
      authorized: false,
      reason: "SURFACE_MISMATCH",
      note:
        "The control is not bound to the exact active proof surface.",
    };
  }

  const requirement = action.requirement;
  const requirementIdentityMatches =
    isBrowserLocalStateHybridControlRequirement(
      requirement
    )
      ? (
          binding.runtimeCorrespondence ===
            "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL" &&
          normalize(binding.surfaceLabel) ===
            normalize(
              requirement.surface
                .accessibleName ??
                binding.surfaceLabel
            ) &&
          (
            requirement.accessibleName ===
              undefined ||
            normalize(binding.visibleLabel) ===
              normalize(
                requirement.accessibleName
              )
          ) &&
          requirement.sourceCorroboration
            .relevantControlFamilyCorroborated ===
            true
        )
      : (
          binding.runtimeCorrespondence ===
            "UNIQUE_SOURCE_STRUCTURED_UNIT" &&
          binding.componentRef ===
            requirement.componentRef &&
          normalize(binding.surfaceLabel) ===
            normalize(
              requirement.surface.label
            ) &&
          normalize(binding.visibleLabel) ===
            normalize(
              requirement.visibleLabel
            ) &&
          requirement.sourceTraceLocalOnly ===
            true
        );

  if (
    binding.status !== "BOUND" ||
    binding.bindingId !==
      action.requirement.bindingId ||
    binding.sourceRef !==
      action.requirement.sourceRef ||
    !requirementIdentityMatches ||
    binding.controlRole !==
      action.requirement.controlRole
  ) {
    return {
      authorized: false,
      reason:
        "CONTROL_NOT_GROUNDED",
      note:
        "The action does not target its exact source-bound control.",
    };
  }

  if (
    binding.disabled ||
    !binding.interactionPossible
  ) {
    return {
      authorized: false,
      reason:
        "CONTROL_NOT_INTERACTABLE",
      note:
        "The exact source-bound control is disabled or not interactable.",
    };
  }

  if (
    ![
      "TOGGLE_SWITCH",
      "SET_NUMERIC_TEST_VALUE",
      "ACTIVATE_CONTROL",
      "CANCEL_SURFACE",
    ].includes(action.kind)
  ) {
    return {
      authorized: false,
      reason:
        "ACTION_KIND_NOT_SUPPORTED",
      note:
        "The requested local control action is outside the dedicated action vocabulary.",
    };
  }

  const safety =
    classifyGenericBrowserActionSafety({
      actionKind: "click",
      targetSource: "control",
      targetKind:
        binding.controlRole === "button"
          ? "button"
          : "control",
      label: binding.visibleLabel,
    });

  if (
    safety ===
    "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
  ) {
    return {
      authorized: false,
      reason:
        "CONSEQUENTIAL_CONTROL_REJECTED",
      note:
        "The existing deterministic consequence policy rejected the control label.",
    };
  }

  const role = binding.controlRole;

  if (
    action.kind === "TOGGLE_SWITCH" &&
    role !== "switch"
  ) {
    return {
      authorized: false,
      reason:
        "ACTION_KIND_NOT_SUPPORTED",
      note:
        "TOGGLE_SWITCH requires one source-bound switch.",
    };
  }

  if (
    action.kind ===
      "SET_NUMERIC_TEST_VALUE" &&
    ![
      "slider",
      "spinbutton",
      "numeric-input",
    ].includes(role)
  ) {
    return {
      authorized: false,
      reason:
        "ACTION_KIND_NOT_SUPPORTED",
      note:
        "SET_NUMERIC_TEST_VALUE requires one source-bound numeric control.",
    };
  }

  if (
    (
      action.kind ===
        "ACTIVATE_CONTROL" ||
      action.kind ===
        "CANCEL_SURFACE"
    ) &&
    role !== "button"
  ) {
    return {
      authorized: false,
      reason:
        "ACTION_KIND_NOT_SUPPORTED",
      note:
        "The requested local activation requires one source-bound button.",
    };
  }

  if (
    action.kind ===
      "SET_NUMERIC_TEST_VALUE"
  ) {
    const value = action.testSetupValue;
    const current = binding.state.value;
    const minimum =
      binding.state.min ??
      Number.NEGATIVE_INFINITY;
    const maximum =
      binding.state.max ??
      Number.POSITIVE_INFINITY;

    if (
      value === undefined ||
      !Number.isFinite(value) ||
      current === undefined ||
      value === current ||
      value < minimum ||
      value > maximum
    ) {
      return {
        authorized: false,
        reason:
          "TEST_SETUP_VALUE_INVALID",
        note:
          "The numeric test-setup value must be finite, different, and within actual control bounds.",
      };
    }
  }

  return {
    authorized: true,
    reason:
      "LOCAL_STATE_ONLY_CONTROL_ACTION",
  };
}

function requestAttempt(
  request: Request
): BrowserProductNonGetAttempt {
  const url = new URL(request.url());
  return {
    method:
      request.method().toUpperCase(),
    path: url.pathname,
  };
}

export async function installProductNonGetGuard(
  page: Page,
  productOrigin: string
): Promise<BrowserProductNonGetGuard> {
  const origin =
    new URL(productOrigin).origin;
  const attempts:
    BrowserProductNonGetAttempt[] = [];
  let active = true;

  const handler = async (
    route: Route
  ) => {
    const request = route.request();
    const requestUrl =
      new URL(request.url());
    const method =
      request.method().toUpperCase();

    if (
      active &&
      requestUrl.origin === origin &&
      ![
        "GET",
        "HEAD",
        "OPTIONS",
      ].includes(method)
    ) {
      attempts.push(
        requestAttempt(request)
      );
      await route.abort(
        "blockedbyclient"
      );
      return;
    }

    await route.continue();
  };

  await page.route("**/*", handler);

  return {
    origin,
    get active() {
      return active;
    },
    attempts,
    stop: async () => {
      active = false;
      await page.unroute(
        "**/*",
        handler
      );
    },
  };
}

async function interactWithNumericControl(
  locator: Locator,
  binding:
    BrowserLocalControlBinding,
  targetValue: number
): Promise<void> {
  if (
    binding.controlRole === "slider"
  ) {
    const current =
      binding.state.value!;
    const step =
      binding.state.step &&
      binding.state.step > 0
        ? binding.state.step
        : 1;
    const delta =
      targetValue - current;
    const presses =
      Math.round(
        Math.abs(delta / step)
      );

    if (
      presses < 1 ||
      presses > 10 ||
      Math.abs(
        presses * step -
        Math.abs(delta)
      ) > Number.EPSILON
    ) {
      throw new Error(
        "The requested slider transition is not a bounded adjacent keyboard action."
      );
    }

    await locator.focus();
    const key =
      delta > 0
        ? "ArrowRight"
        : "ArrowLeft";

    for (
      let index = 0;
      index < presses;
      index += 1
    ) {
      await locator.press(key);
    }
    return;
  }

  await locator.fill(
    String(targetValue)
  );
}

export async function waitForSettledSourceBoundControl(
  args: {
    page: Page;
    requirement:
      BrowserLocalControlGroundingRequirement;
    expected:
      | { checked: boolean }
      | { value: number };
    expectedBindingIdentity: string;
    timeoutMs?: number;
  }
): Promise<
  | {
      settled: true;
      binding:
        BrowserLocalControlBinding;
    }
  | {
      settled: false;
      reason:
        | "CONTROL_NOT_GROUNDED"
        | "CONTROL_IDENTITY_CHANGED"
        | "STATE_UNSETTLED";
      note: string;
    }
> {
  const deadline = Date.now() +
    Math.max(
      250,
      Math.min(
        args.timeoutMs ?? 2500,
        5000
      )
    );
  let consecutive = 0;
  let lastBinding:
    BrowserLocalControlBinding | undefined;

  while (Date.now() <= deadline) {
    const observation =
      isBrowserLocalStateHybridControlRequirement(
        args.requirement
      )
        ? await observeBrowserLocalStateHybridControl(
            args.page,
            args.requirement
          )
        : await observeSourceBoundControl(
            args.page,
            args.requirement
          );

    if (observation.status !== "BOUND") {
      consecutive = 0;
      await args.page.waitForTimeout(50);
      continue;
    }

    if (
      observation.bindingIdentity !==
      args.expectedBindingIdentity
    ) {
      return {
        settled: false,
        reason:
          "CONTROL_IDENTITY_CHANGED",
        note:
          "The source-bound control identity changed during settlement.",
      };
    }

    const matches =
      "checked" in args.expected
        ? observation.state.checked ===
          args.expected.checked
        : observation.state.value ===
          args.expected.value;

    if (matches) {
      consecutive += 1;
      lastBinding = observation;

      if (consecutive >= 2) {
        return {
          settled: true,
          binding: lastBinding,
        };
      }
    } else {
      consecutive = 0;
    }

    await args.page.waitForTimeout(50);
  }

  return {
    settled: false,
    reason:
      lastBinding
        ? "STATE_UNSETTLED"
        : "CONTROL_NOT_GROUNDED",
    note:
      "The expected actual control state did not remain stable across two bounded observations.",
  };
}

export async function executeBrowserLocalControlAction(
  args: {
    page: Page;
    action: BrowserLocalControlAction;
    binding:
      BrowserLocalControlBinding;
    context:
      BrowserLocalControlProofContext;
    guard: BrowserProductNonGetGuard;
  }
): Promise<BrowserLocalControlActionEvidence> {
  if (args.guard.attempts.length > 0) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: false,
      stateChanged: false,
      settled: false,
      beforeState:
        args.binding.state,
      note:
        "A prior product non-GET attempt already aborted the local proof window.",
    };
  }

  const currentRoutePath =
    new URL(args.page.url()).pathname;
  const authorization =
    authorizeBrowserLocalControlAction({
      action: args.action,
      binding: args.binding,
      context: {
        ...args.context,
        transportGuardActive:
          args.guard.active,
      },
      currentRoutePath,
    });

  if (!authorization.authorized) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: false,
      stateChanged: false,
      settled: false,
      beforeState:
        args.binding.state,
      note:
        `${authorization.reason}: ${authorization.note}`,
    };
  }

  const resolved =
    isBrowserLocalStateHybridControlRequirement(
      args.action.requirement
    )
      ? await resolveBrowserLocalStateHybridControl(
          args.page,
          args.action.requirement
        )
      : await resolveSourceBoundControl(
          args.page,
          args.action.requirement
        );

  if (
    resolved.observation.status !==
      "BOUND" ||
    !resolved.locator ||
    resolved.observation
      .bindingIdentity !==
      args.binding.bindingIdentity
  ) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: false,
      stateChanged: false,
      settled: false,
      beforeState:
        args.binding.state,
      note:
        "The exact source-bound control could not be re-resolved before interaction.",
    };
  }

  const beforeState =
    resolved.observation.state;

  try {
    if (
      args.action.kind ===
      "TOGGLE_SWITCH"
    ) {
      await resolved.locator.click();
    } else if (
      args.action.kind ===
      "SET_NUMERIC_TEST_VALUE"
    ) {
      await interactWithNumericControl(
        resolved.locator,
        resolved.observation,
        args.action.testSetupValue!
      );
    } else {
      await resolved.locator.click();
    }
  } catch (error) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: false,
      stateChanged: false,
      settled: false,
      beforeState,
      note:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }

  if (args.guard.attempts.length > 0) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: true,
      stateChanged: false,
      settled: false,
      beforeState,
      note:
        "A product non-GET request was attempted; the guard aborted the proof window.",
    };
  }

  if (
    args.action.kind ===
      "ACTIVATE_CONTROL" ||
    args.action.kind ===
      "CANCEL_SURFACE"
  ) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: true,
      stateChanged: false,
      settled: false,
      beforeState,
      note:
        "The control was activated; its required affected-state transition must be settled separately.",
    };
  }

  const expected =
    args.action.kind ===
      "TOGGLE_SWITCH"
      ? {
          checked:
            !beforeState.checked,
        }
      : {
          value:
            args.action.testSetupValue!,
        };
  const settled =
    await waitForSettledSourceBoundControl({
      page: args.page,
      requirement:
        args.action.requirement,
      expected,
      expectedBindingIdentity:
        args.binding.bindingIdentity,
    });

  if (!settled.settled) {
    return {
      actionId: args.action.actionId,
      kind: args.action.kind,
      targetBindingIdentity:
        args.binding.bindingIdentity,
      executed: true,
      stateChanged: false,
      settled: false,
      beforeState,
      ...(
        args.action.kind ===
          "SET_NUMERIC_TEST_VALUE"
          ? {
              testSetupValue:
                args.action.testSetupValue,
              testSetupAuthority:
                "TEST_SETUP_ONLY" as const,
            }
          : {}
      ),
      note: settled.note,
    };
  }

  return {
    actionId: args.action.actionId,
    kind: args.action.kind,
    targetBindingIdentity:
      args.binding.bindingIdentity,
    executed: true,
    stateChanged:
      JSON.stringify(beforeState) !==
      JSON.stringify(
        settled.binding.state
      ),
    settled: true,
    beforeState,
    afterState:
      settled.binding.state,
    ...(
      args.action.kind ===
        "SET_NUMERIC_TEST_VALUE"
        ? {
            testSetupValue:
              args.action.testSetupValue,
            testSetupAuthority:
              "TEST_SETUP_ONLY" as const,
          }
        : {}
    ),
    note:
      "The exact source-bound local control reached a stable actual post-action state.",
  };
}

export function evaluateBrowserLocalStateTransition(
  args: EvaluateBrowserLocalTransitionArgs
): BrowserGroundedLocalStateTransitionEvidence {
  const fail = (
    result:
      BrowserLocalTransitionProofResult,
    reason:
      BrowserLocalTransitionProofReason,
    note: string
  ): BrowserGroundedLocalStateTransitionEvidence => ({
    ...args,
    result,
    reason,
    note,
  });

  if (
    args.proofAuthority !==
      "ACCEPTANCE" ||
    !args.proofRequirementId.trim() ||
    args.expectedValueAuthority !==
    "JIRA_AUTHORIZED"
  ) {
    return fail(
      "ABSTAINED",
      "AUTHORITY_NOT_ACCEPTABLE",
      "Only Jira-authorized expected values may define acceptance proof."
    );
  }

  if (
    args.transportGuard
      .activeDuringProof !== true ||
    args.transportGuard
      .productNonGetCount > 0 ||
    args.transportGuard
      .attempts.length > 0
  ) {
    return fail(
      "ABSTAINED",
      "NON_GET_REQUEST_ATTEMPTED",
      "A missing transport guard or any product non-GET attempt prevents confirmation."
    );
  }

  const valueBindings = [
    args.bindings.valueInitial,
    args.bindings.valueAlternate,
    args.bindings.valueReset,
  ];
  const valueIdentity =
    args.bindings.valueInitial
      .bindingIdentity;

  const allBindings = [
    args.bindings.activation,
    args.bindings.valueInitial,
    args.bindings.valueAlternate,
    args.bindings.reset,
    args.bindings.valueReset,
  ];
  const hybridBindingCount =
    allBindings.filter(
      (binding) =>
        binding.runtimeCorrespondence ===
          "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL"
    ).length;
  const hybridSemanticUnitIdentity = (
    binding: BrowserLocalControlBinding
  ): string | undefined =>
    binding.runtimeCorrespondence ===
    "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL"
      ? binding.semanticUnitIdentity
      : undefined;
  const valueSemanticUnitIdentity =
    hybridSemanticUnitIdentity(
      args.bindings.valueInitial
    );

  if (
    hybridBindingCount > 0 &&
    (
      hybridBindingCount !==
        allBindings.length ||
      !valueSemanticUnitIdentity ||
      valueSemanticUnitIdentity !==
        hybridSemanticUnitIdentity(
          args.bindings.valueAlternate
        ) ||
      valueSemanticUnitIdentity !==
        hybridSemanticUnitIdentity(
          args.bindings.valueReset
        ) ||
      valueSemanticUnitIdentity !==
        hybridSemanticUnitIdentity(
          args.bindings.reset
        )
    )
  ) {
    return fail(
      "ABSTAINED",
      "CONTROL_NOT_GROUNDED",
      "Hybrid value and reset controls were not uniquely grounded in the same exact accessible semantic unit."
    );
  }

  if (
    valueBindings.some(
      (binding) =>
        binding.bindingIdentity !==
        valueIdentity
    )
  ) {
    return fail(
      "ABSTAINED",
      "CONTROL_IDENTITY_CHANGED",
      "Initial, alternate, and reset values were not observed on the same source-bound control."
    );
  }

  if (
    valueBindings.some(
      (binding) =>
        binding.state.displayedValue !==
          undefined &&
        binding.state.displayedValue !==
          binding.state.value
    )
  ) {
    return fail(
      "ABSTAINED",
      "VALUE_DISPLAY_MISMATCH",
      "Displayed and underlying numeric control values disagree."
    );
  }

  if (
    args.bindings.valueInitial
      .state.value !==
      args.expectedValue
  ) {
    return fail(
      "CONTRADICTED",
      "STATE_CHANGE_NOT_OBSERVED",
      "The Jira-authorized initial default was contradicted by the actual control value."
    );
  }

  if (
    args.alternateValueAuthority !==
      "TEST_SETUP_ONLY" ||
    args.alternateValue ===
      args.expectedValue
  ) {
    return fail(
      "ABSTAINED",
      "RESET_NOT_PROVABLE",
      "Reset requires a different bounded value recorded only as test setup."
    );
  }

  if (
    args.bindings.valueAlternate
      .state.value !==
      args.alternateValue ||
    args.actions.alternateSetup
      .testSetupAuthority !==
      "TEST_SETUP_ONLY"
  ) {
    return fail(
      "ABSTAINED",
      "STATE_CHANGE_NOT_OBSERVED",
      "The same control was not proven at the bounded alternate setup value."
    );
  }

  const stateActions = [
    args.actions.activation,
    args.actions.alternateSetup,
    args.actions.reset,
  ];

  if (
    stateActions.some(
      (action) =>
        !action.executed ||
        !action.stateChanged
    )
  ) {
    return fail(
      "ABSTAINED",
      "STATE_CHANGE_NOT_OBSERVED",
      "Every required local transition must execute and change its exact affected state."
    );
  }

  if (
    !args.settlement.activation ||
    !args.settlement.initialValue ||
    !args.settlement.alternateValue ||
    !args.settlement.resetValue ||
    stateActions.some(
      (action) => !action.settled
    )
  ) {
    return fail(
      "ABSTAINED",
      "STATE_UNSETTLED",
      "Every required state must remain stable across bounded repeated observations."
    );
  }

  if (
    args.bindings.valueReset
      .state.value !==
      args.expectedValue
  ) {
    return fail(
      "CONTRADICTED",
      "RESET_VALUE_CONTRADICTED",
      "Reset settled on a value different from the Jira-authorized default."
    );
  }

  if (
    !args.actions.restore.executed ||
    !args.actions.restore.stateChanged ||
    !args.actions.restore.settled ||
    !args.restore.modalClosed ||
    !args.restore.draftDiscardVerified ||
    !args.restore.routePreserved
  ) {
    return fail(
      "ABSTAINED",
      "RESTORE_NOT_VERIFIED",
      "Local draft restoration was not fully verified."
    );
  }

  return fail(
    "CONFIRMED",
    "CONFIRMED",
    "The Jira-authorized default and reset transition were confirmed on one source-bound control with zero product non-GET requests and verified local restoration."
  );
}

export function adjacentNumericTestSetupValue(
  binding:
    BrowserLocalControlBinding
): {
  value: number;
  authority: "TEST_SETUP_ONLY";
} | undefined {
  const value =
    chooseAdjacentNumericTestValue(
      binding
    );

  return value === undefined
    ? undefined
    : {
        value,
        authority:
          "TEST_SETUP_ONLY",
      };
}
