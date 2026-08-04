import type { Page } from "playwright";

export type BrowserObservationControlKind =
  | "button"
  | "link"
  | "tab"
  | "menuitem"
  | "option"
  | "control";

export type BrowserObservationSurfaceKind =
  | "dialog"
  | "menu"
  | "listbox"
  | "region"
  | "surface";

export type BrowserObservationControl = {
  kind: BrowserObservationControlKind;
  label: string;
  role: string;
  disabled: boolean;
  selected: boolean | null;
  expanded: boolean | null;
  checked: boolean | null;
  href?: string;
  controls?: string;
};

export type BrowserObservationInput = {
  label: string;
  role: string;
  type: string;
  placeholder?: string;
  disabled: boolean;
  required: boolean;
  hasValue: boolean;
};

export type BrowserObservationSurface = {
  kind: BrowserObservationSurfaceKind;
  label: string;
  role: string;
  modal: boolean;
  textPreview: string;
};

export type BrowserObservation = {
  url: string;
  title: string;
  headings: string[];
  controls: BrowserObservationControl[];
  inputs: BrowserObservationInput[];
  surfaces: BrowserObservationSurface[];
  visibleText: string[];
  counts: {
    headings: number;
    controls: number;
    inputs: number;
    surfaces: number;
    visibleText: number;
  };
};

export type BrowserObservationOptions = {
  maxHeadings?: number;
  maxControls?: number;
  maxInputs?: number;
  maxSurfaces?: number;
  maxVisibleText?: number;
  maxTextLength?: number;
};

type BrowserObservationSnapshot = Pick<
  BrowserObservation,
  | "headings"
  | "controls"
  | "inputs"
  | "surfaces"
  | "visibleText"
>;

const DEFAULT_LIMITS = {
  maxHeadings: 30,
  maxControls: 120,
  maxInputs: 60,
  maxSurfaces: 30,
  maxVisibleText: 120,
  maxTextLength: 180,
} as const;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.floor(value)
    )
  );
}

export async function observeBrowserPage(
  page: Page,
  options: BrowserObservationOptions = {}
): Promise<BrowserObservation> {
  const limits = {
    maxHeadings: boundedInteger(
      options.maxHeadings,
      DEFAULT_LIMITS.maxHeadings,
      1,
      100
    ),
    maxControls: boundedInteger(
      options.maxControls,
      DEFAULT_LIMITS.maxControls,
      1,
      300
    ),
    maxInputs: boundedInteger(
      options.maxInputs,
      DEFAULT_LIMITS.maxInputs,
      1,
      150
    ),
    maxSurfaces: boundedInteger(
      options.maxSurfaces,
      DEFAULT_LIMITS.maxSurfaces,
      1,
      100
    ),
    maxVisibleText: boundedInteger(
      options.maxVisibleText,
      DEFAULT_LIMITS.maxVisibleText,
      1,
      300
    ),
    maxTextLength: boundedInteger(
      options.maxTextLength,
      DEFAULT_LIMITS.maxTextLength,
      40,
      500
    ),
  };

  /*
   * The browser-side program is intentionally a raw string.
   * tsx/esbuild cannot rewrite nested functions inside it,
   * which prevents Node-only helper references from leaking
   * into Playwright's browser execution context.
   */
  const browserProgram = `
    (() => {
      const runtimeLimits =
        ${JSON.stringify(limits)};

      const normalize = (
        value,
        maxLength =
          runtimeLimits.maxTextLength
      ) =>
        String(value ?? "")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, maxLength);

      const isVisible = (element) => {
        if (
          !(element instanceof HTMLElement)
        ) {
          return false;
        }

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

      const labelledByText = (element) => {
        const labelledBy = normalize(
          element.getAttribute(
            "aria-labelledby"
          )
        );

        if (!labelledBy) {
          return "";
        }

        return normalize(
          labelledBy
            .split(/\\s+/)
            .map((id) =>
              document.getElementById(id)
            )
            .filter(Boolean)
            .map((item) =>
              item.innerText ||
              item.textContent ||
              ""
            )
            .join(" ")
        );
      };

      const associatedLabelText = (
        element
      ) => {
        if (
          element instanceof
            HTMLInputElement ||
          element instanceof
            HTMLTextAreaElement ||
          element instanceof
            HTMLSelectElement
        ) {
          const direct = normalize(
            Array.from(
              element.labels || []
            )
              .map((label) =>
                label.innerText ||
                label.textContent ||
                ""
              )
              .join(" ")
          );

          if (direct) {
            return direct;
          }
        }

        const closestLabel =
          element.closest("label");

        return normalize(
          closestLabel?.innerText ||
          closestLabel?.textContent ||
          ""
        );
      };

      const elementLabel = (element) => {
        const candidates = [
          element.getAttribute("aria-label"),
          labelledByText(element),
          associatedLabelText(element),
          element.getAttribute("title"),
          element.getAttribute(
            "data-placeholder"
          ),
          element.getAttribute(
            "placeholder"
          ),
          element instanceof HTMLElement
            ? element.innerText
            : "",
          element.textContent,
          element.getAttribute("name"),
          element.getAttribute("id"),
        ];

        return normalize(
          candidates.find(
            (candidate) =>
              normalize(candidate).length > 0
          ) || ""
        );
      };

      const booleanAttribute = (
        element,
        attribute
      ) => {
        const value =
          element.getAttribute(attribute);

        if (value === null) {
          return null;
        }

        return value === "true";
      };

      const inferControlKind = (
        element,
        role
      ) => {
        if (role === "tab") {
          return "tab";
        }

        if (role === "menuitem") {
          return "menuitem";
        }

        if (role === "option") {
          return "option";
        }

        if (
          role === "link" ||
          element instanceof
            HTMLAnchorElement
        ) {
          return "link";
        }

        if (
          role === "button" ||
          element instanceof
            HTMLButtonElement
        ) {
          return "button";
        }

        return "control";
      };

      const inferSurfaceKind = (role) => {
        if (
          role === "dialog" ||
          role === "alertdialog"
        ) {
          return "dialog";
        }

        if (role === "menu") {
          return "menu";
        }

        if (role === "listbox") {
          return "listbox";
        }

        if (role === "region") {
          return "region";
        }

        return "surface";
      };

      const uniqueStrings = (
        values,
        limit
      ) => {
        const seen = new Set();
        const result = [];

        for (const value of values) {
          const normalized =
            normalize(value);

          if (
            !normalized ||
            seen.has(normalized)
          ) {
            continue;
          }

          seen.add(normalized);
          result.push(normalized);

          if (result.length >= limit) {
            break;
          }
        }

        return result;
      };

      const headings = uniqueStrings(
        Array.from(
          document.querySelectorAll(
            "h1, h2, h3, h4, " +
            '[role="heading"]'
          )
        )
          .filter(isVisible)
          .map(elementLabel),
        runtimeLimits.maxHeadings
      );

      const controlSelector = [
        "button",
        "a[href]",
        "summary",
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[aria-controls]',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
      ].join(", ");

      const controls = [];
      const controlKeys = new Set();

      for (
        const element of
        Array.from(
          document.querySelectorAll(
            controlSelector
          )
        ).filter(isVisible)
      ) {
        const role = normalize(
          element.getAttribute("role") ||
          (
            element instanceof
              HTMLAnchorElement
              ? "link"
              : (
                  element instanceof
                    HTMLButtonElement ||
                  (
                    element instanceof
                      HTMLInputElement &&
                    [
                      "button",
                      "submit",
                      "reset",
                    ].includes(
                      element.type
                    )
                  )
                )
                ? "button"
                : ""
          )
        );

        const label =
          elementLabel(element);

        if (!label) {
          continue;
        }

        const href =
          element instanceof
            HTMLAnchorElement
            ? normalize(
                element.getAttribute("href")
              )
            : "";

        const controlsId = normalize(
          element.getAttribute(
            "aria-controls"
          )
        );

        const kind =
          inferControlKind(
            element,
            role
          );

        const key = [
          kind,
          role,
          label,
          href,
          controlsId,
        ].join("|");

        if (controlKeys.has(key)) {
          continue;
        }

        controlKeys.add(key);

        const nativeDisabled =
          (
            element instanceof
              HTMLButtonElement ||
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLSelectElement ||
            element instanceof
              HTMLTextAreaElement
          )
            ? element.disabled
            : false;

        const observation = {
          kind,
          label,
          role,
          disabled:
            nativeDisabled ||
            element.getAttribute(
              "aria-disabled"
            ) === "true",
          selected:
            booleanAttribute(
              element,
              "aria-selected"
            ),
          expanded:
            booleanAttribute(
              element,
              "aria-expanded"
            ),
          checked:
            booleanAttribute(
              element,
              "aria-checked"
            ),
        };

        if (href) {
          observation.href = href;
        }

        if (controlsId) {
          observation.controls =
            controlsId;
        }

        controls.push(observation);

        if (
          controls.length >=
          runtimeLimits.maxControls
        ) {
          break;
        }
      }

      const inputSelector = [
        "input:not([type='hidden'])",
        "textarea",
        "select",
        '[role="combobox"]',
        '[contenteditable="true"]',
      ].join(", ");

      const inputs = [];
      const inputKeys = new Set();

      for (
        const element of
        Array.from(
          document.querySelectorAll(
            inputSelector
          )
        ).filter(isVisible)
      ) {
        const role = normalize(
          element.getAttribute("role") ||
          (
            element instanceof
              HTMLSelectElement
              ? "combobox"
              : element instanceof
                    HTMLTextAreaElement
                ? "textbox"
                : element instanceof
                      HTMLInputElement
                  ? (
                      element.type ===
                        "checkbox"
                        ? "checkbox"
                        : element.type ===
                            "radio"
                          ? "radio"
                          : "textbox"
                    )
                  : "textbox"
          )
        );

        const type =
          element instanceof
            HTMLInputElement
            ? normalize(
                element.type || "text"
              )
            : element instanceof
                  HTMLTextAreaElement
              ? "textarea"
              : element instanceof
                    HTMLSelectElement
                ? "select"
                : "contenteditable";

        const label =
          elementLabel(element);

        const placeholder = normalize(
          element.getAttribute(
            "placeholder"
          )
        );

        const supportsNativeState =
          element instanceof
            HTMLInputElement ||
          element instanceof
            HTMLSelectElement ||
          element instanceof
            HTMLTextAreaElement;

        const disabled =
          (
            supportsNativeState
              ? element.disabled
              : false
          ) ||
          element.getAttribute(
            "aria-disabled"
          ) === "true";

        const required =
          (
            supportsNativeState
              ? element.required
              : false
          ) ||
          element.getAttribute(
            "aria-required"
          ) === "true";

        const hasValue =
          supportsNativeState
            ? normalize(
                element.value
              ).length > 0
            : normalize(
                element.textContent
              ).length > 0;

        const key = [
          role,
          type,
          label,
          placeholder,
        ].join("|");

        if (inputKeys.has(key)) {
          continue;
        }

        inputKeys.add(key);

        const observation = {
          label,
          role,
          type,
          disabled,
          required,
          hasValue,
        };

        if (placeholder) {
          observation.placeholder =
            placeholder;
        }

        inputs.push(observation);

        if (
          inputs.length >=
          runtimeLimits.maxInputs
        ) {
          break;
        }
      }

      const surfaceSelector = [
        "dialog",
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[role="menu"]',
        '[role="listbox"]',
        '[role="region"]',
        '[aria-modal="true"]',
        '[data-state="open"]',
      ].join(", ");

      const surfaces = [];
      const surfaceKeys = new Set();

      for (
        const element of
        Array.from(
          document.querySelectorAll(
            surfaceSelector
          )
        ).filter(isVisible)
      ) {
        const role = normalize(
          element.getAttribute("role") ||
          (
            element instanceof
              HTMLDialogElement
              ? "dialog"
              : ""
          )
        );

        const label =
          elementLabel(element);

        const textPreview = normalize(
          element instanceof HTMLElement
            ? element.innerText
            : element.textContent
        );

        const kind =
          inferSurfaceKind(role);

        const key = [
          kind,
          role,
          label,
          textPreview,
        ].join("|");

        if (surfaceKeys.has(key)) {
          continue;
        }

        surfaceKeys.add(key);

        surfaces.push({
          kind,
          label,
          role,
          modal:
            element.getAttribute(
              "aria-modal"
            ) === "true" ||
            (
              element instanceof
                HTMLDialogElement &&
              element.open
            ),
          textPreview,
        });

        if (
          surfaces.length >=
          runtimeLimits.maxSurfaces
        ) {
          break;
        }
      }

      const primarySurface =
        document.querySelector("main") ||
        document.body;

      const visibleText =
        uniqueStrings(
          Array.from(
            primarySurface.querySelectorAll(
              "h1, h2, h3, h4, p, li, " +
              "label, legend, td, th, " +
              '[role="status"], ' +
              '[role="alert"]'
            )
          )
            .filter(isVisible)
            .map((element) =>
              normalize(
                element instanceof
                  HTMLElement
                  ? element.innerText
                  : element.textContent
              )
            ),
          runtimeLimits.maxVisibleText
        );

      return {
        headings,
        controls,
        inputs,
        surfaces,
        visibleText,
      };
    })()
  `;

  const snapshot =
    await page.evaluate(
      browserProgram
    ) as BrowserObservationSnapshot;

  const title = await page
    .title()
    .catch(() => "");

  return {
    url: page.url(),
    title,
    ...snapshot,
    counts: {
      headings: snapshot.headings.length,
      controls: snapshot.controls.length,
      inputs: snapshot.inputs.length,
      surfaces: snapshot.surfaces.length,
      visibleText:
        snapshot.visibleText.length,
    },
  };
}
