import type {
  Locator,
  Page,
} from "playwright";

import type {
  BrowserSourceBoundControlAbstentionReason,
  BrowserSourceBoundControlState,
  BrowserSourceBoundControlRole,
} from "./browser-source-bound-control.js";

export type BrowserLocalStateHybridControlBinding = {
  status: "BOUND";
  bindingId: string;
  bindingIdentity: string;
  sourceRef: string;
  surfaceKind: "dialog";
  surfaceLabel: string;
  visibleLabel: string;
  controlRole: BrowserSourceBoundControlRole;
  runtimeCorrespondence:
    "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL";
  semanticUnitIdentity: string;
  visible: true;
  disabled: boolean;
  interactionPossible: boolean;
  state: BrowserSourceBoundControlState;
};

export type BrowserLocalStateHybridControlObservation =
  | BrowserLocalStateHybridControlBinding
  | {
      status: "ABSTAINED";
      reason:
        BrowserSourceBoundControlAbstentionReason;
      note: string;
    };

export type BrowserLocalStateHybridControlPurpose =
  | "ACTIVATION"
  | "VALUE"
  | "RESET"
  | "RESTORE";

export type BrowserLocalStateHybridControlRequirement = {
  groundingMode:
    "HYBRID_RUNTIME_SEMANTIC";
  bindingId: string;
  sourceRef: string;
  sourceCorroboration: {
    requirementId: string;
    obligationId: string;
    evidenceRefs: string[];
    relevantControlFamilyCorroborated: true;
  };
  surface: {
    kind: "dialog";
    accessibleName?: string;
  };
  purpose:
    BrowserLocalStateHybridControlPurpose;
  controlRole:
    BrowserSourceBoundControlRole;
  accessibleName?: string;
  semanticContainment:
    | {
        kind: "ACTIVE_SURFACE";
      }
    | {
        kind: "NAMED_GROUP";
        accessibleName: string;
      };
};

export type BrowserLocalStateHybridControlResolution = {
  observation:
    BrowserLocalStateHybridControlObservation;
  locator?: Locator;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nonEmpty(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

export function isBrowserLocalStateHybridControlRequirement(
  value: unknown
): value is BrowserLocalStateHybridControlRequirement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const requirement = value as Partial<
    BrowserLocalStateHybridControlRequirement
  >;

  return (
    requirement.groundingMode ===
      "HYBRID_RUNTIME_SEMANTIC" &&
    nonEmpty(requirement.bindingId) &&
    nonEmpty(requirement.sourceRef) &&
    nonEmpty(
      requirement.sourceCorroboration
        ?.requirementId
    ) &&
    nonEmpty(
      requirement.sourceCorroboration
        ?.obligationId
    ) &&
    requirement.sourceCorroboration
      ?.relevantControlFamilyCorroborated ===
      true &&
    Array.isArray(
      requirement.sourceCorroboration
        .evidenceRefs
    ) &&
    requirement.sourceCorroboration
      .evidenceRefs.length > 0 &&
    requirement.sourceCorroboration
      .evidenceRefs.every(nonEmpty) &&
    requirement.surface?.kind === "dialog" &&
    [
      "ACTIVATION",
      "VALUE",
      "RESET",
      "RESTORE",
    ].includes(String(requirement.purpose)) &&
    [
      "switch",
      "slider",
      "spinbutton",
      "numeric-input",
      "button",
    ].includes(String(requirement.controlRole)) &&
    (
      requirement.semanticContainment?.kind ===
        "ACTIVE_SURFACE" ||
      (
        requirement.semanticContainment?.kind ===
          "NAMED_GROUP" &&
        nonEmpty(
          requirement.semanticContainment
            .accessibleName
        )
      )
    ) &&
    (
      requirement.purpose !== "RESET" ||
      requirement.semanticContainment?.kind ===
        "NAMED_GROUP"
    ) &&
    (
      requirement.controlRole !== "button" ||
      nonEmpty(requirement.accessibleName)
    )
  );
}

function controlLocator(
  surface: Locator,
  requirement:
    BrowserLocalStateHybridControlRequirement
): Locator {
  const name = requirement.accessibleName;

  if (requirement.controlRole === "numeric-input") {
    return name
      ? surface.getByRole("spinbutton", {
          name,
          exact: true,
        })
      : surface.getByRole("spinbutton");
  }

  return surface.getByRole(
    requirement.controlRole,
    name
      ? { name, exact: true }
      : undefined
  );
}

async function surfaceLabel(
  surface: Locator
): Promise<string> {
  return surface.evaluate((element) => {
    if (
      typeof (globalThis as any).__name !==
      "function"
    ) {
      (globalThis as any).__name = Function(
        "target",
        "return target;"
      );
    }

    const text = (target: Element | null) =>
      String(target?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const labelledBy = element.getAttribute(
      "aria-labelledby"
    );
    const labelled = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) =>
            text(document.getElementById(id))
          )
          .filter(Boolean)
          .join(" ")
      : "";

    return (
      element.getAttribute("aria-label") ||
      labelled ||
      text(
        element.querySelector(
          "h1,h2,h3,h4,[role=heading]"
        )
      )
    );
  });
}

async function controlState(
  locator: Locator,
  role: BrowserSourceBoundControlRole
): Promise<BrowserSourceBoundControlState> {
  return locator.evaluate((element, controlRole) => {
    if (
      typeof (globalThis as any).__name !==
      "function"
    ) {
      (globalThis as any).__name = Function(
        "target",
        "return target;"
      );
    }

    const state: {
      checked?: boolean;
      value?: number;
      min?: number;
      max?: number;
      step?: number;
    } = {};

    if (controlRole === "switch") {
      const checked = element.getAttribute(
        "aria-checked"
      );
      if (checked === "true" || checked === "false") {
        state.checked = checked === "true";
      }
    }

    if (
      controlRole === "slider" ||
      controlRole === "spinbutton" ||
      controlRole === "numeric-input"
    ) {
      const input = element instanceof HTMLInputElement
        ? element
        : null;
      const number = (value: string | null) => {
        if (!value?.trim()) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed)
          ? parsed
          : undefined;
      };
      const value = number(
        input?.value ||
          element.getAttribute("aria-valuenow")
      );
      const min = number(
        input?.min ||
          element.getAttribute("aria-valuemin")
      );
      const max = number(
        input?.max ||
          element.getAttribute("aria-valuemax")
      );
      const step = number(
        input?.step ||
          element.getAttribute("aria-valuestep")
      );

      if (value !== undefined) state.value = value;
      if (min !== undefined) state.min = min;
      if (max !== undefined) state.max = max;
      if (step !== undefined && step > 0) {
        state.step = step;
      }
    }

    return state;
  }, role);
}

function abstained(
  reason:
    | "SOURCE_STRUCTURE_UNVERIFIED"
    | "TARGET_SURFACE_NOT_GROUNDED"
    | "TARGET_SURFACE_AMBIGUOUS"
    | "CONTROL_NOT_GROUNDED"
    | "CONTROL_BINDING_AMBIGUOUS"
    | "ACTUAL_STATE_UNAVAILABLE"
    | "ACTUAL_VALUE_UNAVAILABLE",
  note: string
): BrowserLocalStateHybridControlObservation {
  return {
    status: "ABSTAINED",
    reason,
    note,
  };
}

export async function resolveBrowserLocalStateHybridControl(
  page: Page,
  requirement:
    BrowserLocalStateHybridControlRequirement
): Promise<BrowserLocalStateHybridControlResolution> {
  if (
    !isBrowserLocalStateHybridControlRequirement(
      requirement
    )
  ) {
    return {
      observation: abstained(
        "SOURCE_STRUCTURE_UNVERIFIED",
        "Minimum bounded source corroboration for the local-state control family is missing."
      ),
    };
  }

  const surfaces = requirement.surface
    .accessibleName
    ? page.getByRole("dialog", {
        name:
          requirement.surface.accessibleName,
        exact: true,
      }).filter({ visible: true })
    : page.getByRole("dialog")
        .filter({ visible: true });
  const surfaceCount = await surfaces.count();

  if (surfaceCount === 0) {
    return {
      observation: abstained(
        "TARGET_SURFACE_NOT_GROUNDED",
        "No uniquely relevant active dialog was visible."
      ),
    };
  }

  if (surfaceCount !== 1) {
    return {
      observation: abstained(
        "TARGET_SURFACE_AMBIGUOUS",
        "Multiple active dialogs satisfy the hybrid surface requirement."
      ),
    };
  }

  const surface = surfaces;
  const semanticUnit =
    requirement.semanticContainment.kind ===
      "NAMED_GROUP"
      ? surface.getByRole("group", {
          name:
            requirement.semanticContainment
              .accessibleName,
          exact: true,
        }).filter({ visible: true })
      : surface;
  const semanticUnitCount =
    await semanticUnit.count();

  if (semanticUnitCount !== 1) {
    return {
      observation: abstained(
        semanticUnitCount === 0
          ? "CONTROL_NOT_GROUNDED"
          : "CONTROL_BINDING_AMBIGUOUS",
        "The exact accessible semantic containment unit was missing or ambiguous."
      ),
    };
  }

  const controls = controlLocator(
    semanticUnit,
    requirement
  ).filter({ visible: true });
  const controlCount = await controls.count();

  if (controlCount === 0) {
    return {
      observation: abstained(
        "CONTROL_NOT_GROUNDED",
        "No active-surface control matched the exact accessible semantic requirement."
      ),
    };
  }

  if (controlCount !== 1) {
    return {
      observation: abstained(
        "CONTROL_BINDING_AMBIGUOUS",
        "Multiple active-surface controls matched; hybrid grounding abstained without positional selection."
      ),
    };
  }

  const state = await controlState(
    controls,
    requirement.controlRole
  );

  if (
    requirement.controlRole === "switch" &&
    state.checked === undefined
  ) {
    return {
      observation: abstained(
        "ACTUAL_STATE_UNAVAILABLE",
        "The unique switch did not expose an exact checked state."
      ),
    };
  }

  if (
    ["slider", "spinbutton", "numeric-input"]
      .includes(requirement.controlRole) &&
    state.value === undefined
  ) {
    return {
      observation: abstained(
        "ACTUAL_VALUE_UNAVAILABLE",
        "The unique numeric control did not expose an actual value."
      ),
    };
  }

  const observedSurfaceLabel =
    await surfaceLabel(surface);

  if (!observedSurfaceLabel.trim()) {
    return {
      observation: abstained(
        "TARGET_SURFACE_NOT_GROUNDED",
        "The unique active dialog had no deterministic accessible identity."
      ),
    };
  }

  const observedControlName =
    requirement.accessibleName ??
    await controls.getAttribute("aria-label") ??
    requirement.controlRole;
  const bindingIdentity = [
    requirement.bindingId,
    requirement.sourceRef,
    normalize(observedSurfaceLabel),
    requirement.purpose,
    requirement.controlRole,
    normalize(observedControlName),
    requirement.semanticContainment.kind ===
      "NAMED_GROUP"
      ? normalize(
          requirement.semanticContainment
            .accessibleName
        )
      : normalize(observedSurfaceLabel),
  ].join("|");
  const disabled = await controls
    .isDisabled()
    .catch(() => false);

  return {
    observation: {
      status: "BOUND",
      bindingId: requirement.bindingId,
      bindingIdentity,
      sourceRef: requirement.sourceRef,
      surfaceKind: "dialog",
      surfaceLabel: observedSurfaceLabel,
      visibleLabel: observedControlName,
      controlRole: requirement.controlRole,
      runtimeCorrespondence:
        "UNIQUE_ACCESSIBLE_SEMANTIC_CONTROL",
      semanticUnitIdentity:
        requirement.semanticContainment.kind ===
          "NAMED_GROUP"
          ? `group:${normalize(
              requirement.semanticContainment
                .accessibleName
            )}`
          : `dialog:${normalize(
              observedSurfaceLabel
            )}`,
      visible: true,
      disabled,
      interactionPossible: !disabled,
      state,
    },
    locator: controls,
  };
}

export async function observeBrowserLocalStateHybridControl(
  page: Page,
  requirement:
    BrowserLocalStateHybridControlRequirement
): Promise<BrowserLocalStateHybridControlObservation> {
  return (
    await resolveBrowserLocalStateHybridControl(
      page,
      requirement
    )
  ).observation;
}
