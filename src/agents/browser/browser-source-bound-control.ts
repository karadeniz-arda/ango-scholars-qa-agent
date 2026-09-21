import type {
  Locator,
  Page,
} from "playwright";

import {
  BROWSER_ACTIVE_MODAL_SELECTOR,
} from "./browser-observation.js";

export type BrowserSourceBoundControlRole =
  | "switch"
  | "slider"
  | "spinbutton"
  | "numeric-input"
  | "button";

export type BrowserSourceBoundControlRelation =
  | "LABELLED_RENDERED_UNIT"
  | "CONTROL_ACCESSIBLE_NAME";

export type BrowserSourceBoundControlRequirement = {
  bindingId: string;
  sourceRef: string;
  componentRef: string;
  sourceStructureVerified: true;
  renderedUnitEvidence:
    "ONE_LABEL_ONE_CONTROL";
  surface: {
    kind: "dialog";
    label: string;
  };
  visibleLabel: string;
  controlRole:
    BrowserSourceBoundControlRole;
  relation:
    BrowserSourceBoundControlRelation;
  /** Exact source-derived ascent from the visible label to its rendered unit. */
  unitAncestorDepth?: number;
  sourceTraceLocalOnly: true;
};

export type BrowserSourceBoundControlState = {
  checked?: boolean;
  value?: number;
  displayedValue?: number;
  min?: number;
  max?: number;
  step?: number;
};

export type BrowserSourceBoundControlBinding = {
  status: "BOUND";
  bindingId: string;
  bindingIdentity: string;
  sourceRef: string;
  componentRef: string;
  surfaceKind: "dialog";
  surfaceLabel: string;
  visibleLabel: string;
  controlRole:
    BrowserSourceBoundControlRole;
  runtimeCorrespondence:
    "UNIQUE_SOURCE_STRUCTURED_UNIT";
  visible: true;
  disabled: boolean;
  interactionPossible: boolean;
  state: BrowserSourceBoundControlState;
};

export type BrowserSourceBoundControlAbstentionReason =
  | "SOURCE_STRUCTURE_UNVERIFIED"
  | "TARGET_SURFACE_NOT_GROUNDED"
  | "TARGET_SURFACE_AMBIGUOUS"
  | "CONTROL_NOT_GROUNDED"
  | "CONTROL_BINDING_AMBIGUOUS"
  | "ACTUAL_STATE_UNAVAILABLE"
  | "ACTUAL_VALUE_UNAVAILABLE"
  | "VALUE_DISPLAY_MISMATCH";

export type BrowserSourceBoundControlObservation =
  | BrowserSourceBoundControlBinding
  | {
      status: "ABSTAINED";
      reason:
        BrowserSourceBoundControlAbstentionReason;
      note: string;
    };

type RuntimeControlDescriptor = {
  surfaceCount: number;
  matchingUnitCount: number;
  matchingControlCount: number;
  disabled?: boolean;
  checkedRaw?: string | null;
  actualValueRaw?: string | null;
  placeholderRaw?: string | null;
  displayedValueRaws?: string[];
  minRaw?: string | null;
  maxRaw?: string | null;
  stepRaw?: string | null;
};

type RuntimeControlResolution = {
  observation:
    BrowserSourceBoundControlObservation;
  locator?: Locator;
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function finiteNumber(
  value: unknown
): number | undefined {
  const normalized =
    String(value ?? "").trim();

  if (!normalized) return undefined;

  const parsed = Number(normalized);
  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function bindingIdentity(
  requirement:
    BrowserSourceBoundControlRequirement
): string {
  return [
    requirement.bindingId,
    requirement.sourceRef,
    requirement.surface.kind,
    normalize(requirement.surface.label),
    normalize(requirement.visibleLabel),
    requirement.controlRole,
    requirement.relation,
    requirement.unitAncestorDepth ?? 0,
  ].join("|");
}

function validateRequirement(
  requirement:
    BrowserSourceBoundControlRequirement
): BrowserSourceBoundControlObservation | null {
  if (
    requirement.sourceStructureVerified !== true ||
    requirement.sourceTraceLocalOnly !== true ||
    requirement.renderedUnitEvidence !==
      "ONE_LABEL_ONE_CONTROL" ||
    !requirement.bindingId.trim() ||
    !requirement.sourceRef.trim() ||
    !requirement.componentRef.trim() ||
    !requirement.surface.label.trim() ||
    !requirement.visibleLabel.trim()
  ) {
    return {
      status: "ABSTAINED",
      reason:
        "SOURCE_STRUCTURE_UNVERIFIED",
      note:
        "Source-backed rendered-unit evidence is incomplete.",
    };
  }

  if (
    requirement.relation ===
      "LABELLED_RENDERED_UNIT" &&
    (
      !Number.isInteger(
        requirement.unitAncestorDepth
      ) ||
      Number(
        requirement.unitAncestorDepth
      ) < 1 ||
      Number(
        requirement.unitAncestorDepth
      ) > 4
    )
  ) {
    return {
      status: "ABSTAINED",
      reason:
        "SOURCE_STRUCTURE_UNVERIFIED",
      note:
        "A labelled rendered unit requires a source-derived ancestor depth from 1 through 4.",
    };
  }

  return null;
}

function observationFromDescriptor(
  requirement:
    BrowserSourceBoundControlRequirement,
  descriptor:
    RuntimeControlDescriptor
): BrowserSourceBoundControlObservation {
  if (descriptor.surfaceCount === 0) {
    return {
      status: "ABSTAINED",
      reason:
        "TARGET_SURFACE_NOT_GROUNDED",
      note:
        "No visible active surface matched the required source-backed surface identity.",
    };
  }

  if (descriptor.surfaceCount !== 1) {
    return {
      status: "ABSTAINED",
      reason:
        "TARGET_SURFACE_AMBIGUOUS",
      note:
        "Multiple visible active surfaces matched the required source-backed surface identity.",
    };
  }

  if (
    descriptor.matchingUnitCount === 0 ||
    descriptor.matchingControlCount === 0
  ) {
    return {
      status: "ABSTAINED",
      reason:
        "CONTROL_NOT_GROUNDED",
      note:
        "The source-structured label/control unit was not visible in the active surface.",
    };
  }

  if (
    descriptor.matchingUnitCount !== 1 ||
    descriptor.matchingControlCount !== 1
  ) {
    return {
      status: "ABSTAINED",
      reason:
        "CONTROL_BINDING_AMBIGUOUS",
      note:
        "The active surface did not contain exactly one source-structured unit with exactly one expected control.",
    };
  }

  const state:
    BrowserSourceBoundControlState = {};

  if (
    requirement.controlRole ===
    "switch"
  ) {
    if (
      descriptor.checkedRaw !== "true" &&
      descriptor.checkedRaw !== "false"
    ) {
      return {
        status: "ABSTAINED",
        reason:
          "ACTUAL_STATE_UNAVAILABLE",
        note:
          "The grounded switch did not expose a valid aria-checked state.",
      };
    }

    state.checked =
      descriptor.checkedRaw === "true";
  }

  if (
    [
      "slider",
      "spinbutton",
      "numeric-input",
    ].includes(
      requirement.controlRole
    )
  ) {
    const actualValue = finiteNumber(
      descriptor.actualValueRaw
    );

    if (actualValue === undefined) {
      return {
        status: "ABSTAINED",
        reason:
          "ACTUAL_VALUE_UNAVAILABLE",
        note:
          descriptor.placeholderRaw
            ? "The grounded numeric control exposed only a placeholder, not an actual value."
            : "The grounded numeric control did not expose input.value or aria-valuenow.",
      };
    }

    const displayedValues = [
      ...new Set(
        (descriptor.displayedValueRaws ?? [])
          .map(finiteNumber)
          .filter(
            (value): value is number =>
              value !== undefined
          )
      ),
    ];

    if (
      displayedValues.length > 1 ||
      (
        displayedValues.length === 1 &&
        displayedValues[0] !== actualValue
      )
    ) {
      return {
        status: "ABSTAINED",
        reason:
          "VALUE_DISPLAY_MISMATCH",
        note:
          "Visible numeric corroboration was ambiguous or disagreed with the actual control value.",
      };
    }

    state.value = actualValue;

    if (displayedValues.length === 1) {
      state.displayedValue =
        displayedValues[0]!;
    }

    const min = finiteNumber(
      descriptor.minRaw
    );
    const max = finiteNumber(
      descriptor.maxRaw
    );
    const step = finiteNumber(
      descriptor.stepRaw
    );

    if (min !== undefined) state.min = min;
    if (max !== undefined) state.max = max;
    if (
      step !== undefined &&
      step > 0
    ) {
      state.step = step;
    }
  }

  const disabled =
    descriptor.disabled === true;

  return {
    status: "BOUND",
    bindingId:
      requirement.bindingId,
    bindingIdentity:
      bindingIdentity(requirement),
    sourceRef:
      requirement.sourceRef,
    componentRef:
      requirement.componentRef,
    surfaceKind:
      requirement.surface.kind,
    surfaceLabel:
      requirement.surface.label,
    visibleLabel:
      requirement.visibleLabel,
    controlRole:
      requirement.controlRole,
    runtimeCorrespondence:
      "UNIQUE_SOURCE_STRUCTURED_UNIT",
    visible: true,
    disabled,
    interactionPossible: !disabled,
    state,
  };
}

function roleSelector(
  role: BrowserSourceBoundControlRole
): string {
  if (role === "switch") {
    return '[role="switch"]';
  }

  if (role === "slider") {
    return '[role="slider"]';
  }

  if (role === "spinbutton") {
    return (
      '[role="spinbutton"], ' +
      'input[type="number"]'
    );
  }

  if (role === "numeric-input") {
    return 'input[type="number"]';
  }

  return (
    'button, [role="button"], ' +
    'input[type="button"], ' +
    'input[type="reset"], ' +
    'input[type="submit"]'
  );
}

async function runtimeDescriptor(
  page: Page,
  requirement:
    BrowserSourceBoundControlRequirement
): Promise<RuntimeControlDescriptor> {
  return page.evaluate(
    ({
      modalSelector,
      requiredSurfaceLabel,
      visibleLabel,
      relation,
      ancestorDepth,
      selector,
      controlRole,
    }) => {
      /*
       * tsx/esbuild may inject __name(...) around nested helpers.
       * Playwright serializes only this callback, so provide the
       * same browser-context compatibility helper used elsewhere
       * in the browser runtime.
       */
      if (
        typeof (globalThis as any).__name !==
        "function"
      ) {
        (globalThis as any).__name =
          Function(
            "target",
            "return target;"
          );
      }

      const normalized = (
        value: unknown
      ) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      const isVisible = (
        element: Element
      ) => {
        if (
          !(element instanceof HTMLElement)
        ) return false;

        const style =
          window.getComputedStyle(element);
        const rect =
          element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const elementText = (
        element: Element | null
      ) => String(
        element instanceof HTMLElement
          ? element.innerText
          : element?.textContent ?? ""
      )
        .replace(/\s+/g, " ")
        .trim();

      const accessibleName = (
        element: Element
      ) => {
        const ariaLabel =
          element.getAttribute("aria-label");

        if (ariaLabel?.trim()) {
          return ariaLabel.trim();
        }

        const labelledBy =
          element.getAttribute(
            "aria-labelledby"
          );

        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) =>
              elementText(
                document.getElementById(id)
              )
            )
            .filter(Boolean)
            .join(" ")
            .trim();

          if (text) return text;
        }

        return elementText(element);
      };

      const surfaceLabel = (
        surface: Element
      ) => {
        const named =
          accessibleName(surface);

        if (named) return named;

        const heading = surface.querySelector(
          "h1,h2,h3,h4,[role=heading]"
        );
        return elementText(heading);
      };

      const surfaces = Array.from(
        document.querySelectorAll(
          modalSelector
        )
      ).filter(
        (surface) =>
          isVisible(surface) &&
          normalized(surfaceLabel(surface)) ===
            normalized(requiredSurfaceLabel)
      );

      if (surfaces.length !== 1) {
        return {
          surfaceCount: surfaces.length,
          matchingUnitCount: 0,
          matchingControlCount: 0,
        };
      }

      const surface = surfaces[0]!;
      const controls = Array.from(
        surface.querySelectorAll(selector)
      ).filter(isVisible);

      let units: Element[] = [];
      let matchingControls: Element[] = [];

      if (
        relation ===
        "CONTROL_ACCESSIBLE_NAME"
      ) {
        matchingControls = controls.filter(
          (control) =>
            normalized(
              accessibleName(control)
            ) === normalized(visibleLabel)
        );
        units = matchingControls;
      } else {
        const labelElements = Array.from(
          surface.querySelectorAll("*")
        ).filter((element) => {
          if (!isVisible(element)) {
            return false;
          }

          if (
            normalized(elementText(element)) !==
            normalized(visibleLabel)
          ) {
            return false;
          }

          return !Array.from(
            element.children
          ).some(
            (child) =>
              isVisible(child) &&
              normalized(elementText(child)) ===
                normalized(visibleLabel)
          );
        });

        units = labelElements
          .map((labelElement) => {
            let unit: Element | null =
              labelElement;

            for (
              let depth = 0;
              depth < ancestorDepth;
              depth += 1
            ) {
              unit = unit?.parentElement ?? null;
            }

            return unit;
          })
          .filter(
            (unit): unit is Element =>
              unit !== null &&
              surface.contains(unit) &&
              isVisible(unit)
          );

        const uniqueUnits = [
          ...new Set(units),
        ];
        units = uniqueUnits;

        for (const unit of units) {
          matchingControls.push(
            ...Array.from(
              unit.querySelectorAll(selector)
            ).filter(isVisible)
          );
        }
      }

      const uniqueControls = [
        ...new Set(matchingControls),
      ];

      if (
        units.length !== 1 ||
        uniqueControls.length !== 1
      ) {
        return {
          surfaceCount: 1,
          matchingUnitCount: units.length,
          matchingControlCount:
            uniqueControls.length,
        };
      }

      const control =
        uniqueControls[0]!;
      const unit = units[0]!;
      const nativeControl =
        control instanceof HTMLInputElement
          ? control
          : null;

      const numericLeafTexts =
        Array.from(
          unit.querySelectorAll("*")
        )
          .filter((element) => {
            if (
              element === control ||
              control.contains(element) ||
              !isVisible(element) ||
              element.children.length > 0
            ) {
              return false;
            }

            return /^[-+]?\d+(?:\.\d+)?$/.test(
              elementText(element)
            );
          })
          .map(elementText);

      const actualValueRaw =
        controlRole === "slider"
          ? control.getAttribute(
              "aria-valuenow"
            )
          : (
              nativeControl?.value ||
              control.getAttribute(
                "aria-valuenow"
              )
            );

      return {
        surfaceCount: 1,
        matchingUnitCount: 1,
        matchingControlCount: 1,
        disabled:
          nativeControl?.disabled === true ||
          control.getAttribute(
            "aria-disabled"
          ) === "true",
        checkedRaw:
          control.getAttribute(
            "aria-checked"
          ),
        actualValueRaw,
        placeholderRaw:
          nativeControl?.placeholder ?? null,
        displayedValueRaws:
          numericLeafTexts,
        minRaw:
          nativeControl?.min ||
          control.getAttribute(
            "aria-valuemin"
          ),
        maxRaw:
          nativeControl?.max ||
          control.getAttribute(
            "aria-valuemax"
          ),
        stepRaw:
          nativeControl?.step ||
          control.getAttribute(
            "aria-valuestep"
          ),
      };
    },
    {
      modalSelector:
        BROWSER_ACTIVE_MODAL_SELECTOR,
      requiredSurfaceLabel:
        requirement.surface.label,
      visibleLabel:
        requirement.visibleLabel,
      relation:
        requirement.relation,
      ancestorDepth:
        requirement.unitAncestorDepth ?? 0,
      selector:
        roleSelector(
          requirement.controlRole
        ),
      controlRole:
        requirement.controlRole,
    }
  );
}

async function runtimeLocator(
  page: Page,
  requirement:
    BrowserSourceBoundControlRequirement
): Promise<Locator | undefined> {
  const candidates = page.locator(
    BROWSER_ACTIVE_MODAL_SELECTOR
  );
  const matchingSurfaces: Locator[] = [];

  for (
    let index = 0;
    index < await candidates.count();
    index += 1
  ) {
    const surface = candidates.nth(index);

    if (
      !(await surface.isVisible().catch(() => false))
    ) continue;

    const name = await surface
      .evaluate((element) => {
        if (
          typeof (globalThis as any).__name !==
          "function"
        ) {
          (globalThis as any).__name =
            Function(
              "target",
              "return target;"
            );
        }

        const text = (target: Element | null) =>
          String(
            target instanceof HTMLElement
              ? target.innerText
              : target?.textContent ?? ""
          )
            .replace(/\s+/g, " ")
            .trim();
        const labelledBy =
          element.getAttribute("aria-labelledby");
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
      })
      .catch(() => "");

    if (
      normalize(name) ===
      normalize(requirement.surface.label)
    ) {
      matchingSurfaces.push(surface);
    }
  }

  if (matchingSurfaces.length !== 1) {
    return undefined;
  }

  const surface = matchingSurfaces[0]!;
  const selector = roleSelector(
    requirement.controlRole
  );

  if (
    requirement.relation ===
    "CONTROL_ACCESSIBLE_NAME"
  ) {
    const controls = surface.locator(selector);
    const matching: Locator[] = [];

    for (
      let index = 0;
      index < await controls.count();
      index += 1
    ) {
      const control = controls.nth(index);
      if (
        !(await control.isVisible().catch(() => false))
      ) continue;

      const name = await control
        .evaluate((element) => {
          const labelledBy =
            element.getAttribute("aria-labelledby");
          const labelled = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) =>
                  String(
                    document.getElementById(id)?.textContent ?? ""
                  )
                )
                .join(" ")
            : "";
          return String(
            element.getAttribute("aria-label") ||
            labelled ||
            (
              element instanceof HTMLElement
                ? element.innerText
                : element.textContent
            ) ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();
        })
        .catch(() => "");

      if (
        normalize(name) ===
        normalize(requirement.visibleLabel)
      ) {
        matching.push(control);
      }
    }

    return matching.length === 1
      ? matching[0]
      : undefined;
  }

  const labels = surface.locator("*");
  const matchingLabels: Locator[] = [];

  for (
    let index = 0;
    index < await labels.count();
    index += 1
  ) {
    const label = labels.nth(index);
    const descriptor = await label
      .evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          return { visible: false, text: "", duplicateChild: false };
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const text = element.innerText.replace(/\s+/g, " ").trim();
        return {
          visible:
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || "1") > 0 &&
            rect.width > 0 &&
            rect.height > 0,
          text,
          duplicateChild:
            Array.from(element.children).some((child) =>
              String(
                child instanceof HTMLElement
                  ? child.innerText
                  : child.textContent ?? ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase() === text.toLowerCase()
            ),
        };
      })
      .catch(() => null);

    if (
      descriptor?.visible &&
      !descriptor.duplicateChild &&
      normalize(descriptor.text) ===
        normalize(requirement.visibleLabel)
    ) {
      matchingLabels.push(label);
    }
  }

  const matchingControls: Locator[] = [];

  for (const label of matchingLabels) {
    let unit = label;

    for (
      let depth = 0;
      depth < Number(
        requirement.unitAncestorDepth
      );
      depth += 1
    ) {
      unit = unit.locator("..");
    }

    const controls = unit.locator(selector);

    for (
      let index = 0;
      index < await controls.count();
      index += 1
    ) {
      const control = controls.nth(index);
      if (
        await control.isVisible().catch(() => false)
      ) {
        matchingControls.push(control);
      }
    }
  }

  return matchingLabels.length === 1 &&
    matchingControls.length === 1
    ? matchingControls[0]
    : undefined;
}

export async function observeSourceBoundControl(
  page: Page,
  requirement:
    BrowserSourceBoundControlRequirement
): Promise<BrowserSourceBoundControlObservation> {
  const invalid =
    validateRequirement(requirement);

  if (invalid) return invalid;

  const descriptor =
    await runtimeDescriptor(
      page,
      requirement
    );

  return observationFromDescriptor(
    requirement,
    descriptor
  );
}

export async function resolveSourceBoundControl(
  page: Page,
  requirement:
    BrowserSourceBoundControlRequirement
): Promise<RuntimeControlResolution> {
  const observation =
    await observeSourceBoundControl(
      page,
      requirement
    );

  if (observation.status !== "BOUND") {
    return { observation };
  }

  const locator = await runtimeLocator(
    page,
    requirement
  );

  if (!locator) {
    return {
      observation: {
        status: "ABSTAINED",
        reason:
          "CONTROL_BINDING_AMBIGUOUS",
        note:
          "The source-bound control could not be uniquely re-resolved for interaction.",
      },
    };
  }

  return {
    observation,
    locator,
  };
}

export function chooseAdjacentNumericTestValue(
  binding: {
    state: BrowserSourceBoundControlState;
  }
): number | undefined {
  const current = binding.state.value;

  if (current === undefined) {
    return undefined;
  }

  const step =
    binding.state.step &&
    binding.state.step > 0
      ? binding.state.step
      : 1;
  const minimum =
    binding.state.min ??
    Number.NEGATIVE_INFINITY;
  const maximum =
    binding.state.max ??
    Number.POSITIVE_INFINITY;
  const lower = current - step;
  const upper = current + step;

  if (lower >= minimum) return lower;
  if (upper <= maximum) return upper;

  return undefined;
}
