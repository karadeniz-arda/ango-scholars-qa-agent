import type { Page } from "playwright";

import {
  discoverFrontendCardCollectionDeclarations,
  type SourceCardCollectionDeclaration,
} from "../../discovery/frontend-card-collection-provenance.js";
import {
  BROWSER_SEMANTIC_CONTEXT_MAX_DEPTH,
  deriveBrowserObservationContextCandidates,
} from "./browser-semantic-context.js";

export const BROWSER_ACTIVE_MODAL_SELECTOR =
  [
    "dialog[open]",
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
  ].join(", ");

export const BROWSER_OBSERVATION_INPUT_SELECTOR =
  [
    "input:not([type='hidden'])",
    "textarea",
    "select",
    '[role="combobox"]',
    '[contenteditable="true"]',
  ].join(", ");

/*
 * GENERIC_BROWSER_SHARED_SEMANTIC_LABEL_CONTRACT_V1
 *
 * Descendant metadata may supplement an otherwise unlabeled
 * interactive control only through bounded semantic attributes.
 *
 * Raw CSS class names are intentionally excluded. Styling or
 * implementation classes are not stable semantic identities and
 * must never become autonomous interaction targets.
 */
export const BROWSER_SEMANTIC_DESCENDANT_LABEL_ATTRIBUTES =
  [
    "aria-label",
    "title",
    "data-testid",
    "data-icon",
    "data-lucide",
  ] as const;

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
  contextText?: string;

  /*
   * GENERIC_BROWSER_CONTROL_SURFACE_OWNERSHIP_V1
   *
   * Nearest visible semantic surface that owns this control.
   *
   * This is observer-derived structural provenance. It is not
   * inferred from label text, DOM order, coordinates or proximity.
   */
  surfaceKind?: BrowserObservationSurfaceKind;

  disabled: boolean;
  selected: boolean | null;
  expanded: boolean | null;
  checked: boolean | null;
  href?: string;
  controls?: string;
  controlledSurface?: {
    id: string;
    role: string;
    visible: boolean;
    contentFingerprint: string;
    textLength: number;
  };
  externalPopup?: boolean;

  /*
   * Marks an option whose semantic identity/state comes from
   * a non-visible role=option node while its executable visual
   * counterpart was bound independently by exact identity.
   */
  semanticOptionBinding?: boolean;
};

export type BrowserObservationInput = {
  label: string;
  role: string;
  type: string;
  placeholder?: string;
  disabled: boolean;
  activationSafe: boolean;
  expanded: boolean | null;
  controls?: string;
  hasPopup?: string;
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

export type BrowserCollectionIdentityMethod =
  | "ARIA_NAME"
  | "TABLE_CAPTION"
  | "ARIA_LABELLEDBY"
  | "STRUCTURAL_HEADING_RELATION"
  | "SOURCE_COMPONENT_COLLECTION";

export type BrowserCollectionAbstentionReason =
  | "COLLECTION_NOT_GROUNDED"
  | "COLLECTION_AMBIGUOUS"
  | "COLLECTION_EMPTY"
  | "COLLECTION_LOADING"
  | "SCHEMA_NOT_GROUNDED"
  | "FIELD_SCHEMA_AMBIGUOUS"
  | "ROW_STRUCTURE_NOT_GROUNDED"
  | "ROW_IDENTITY_UNAVAILABLE"
  | "CARD_RUNTIME_CONTAINER_NOT_GROUNDED"
  | "CARD_COLLECTION_AMBIGUOUS"
  | "CARD_ITEM_STRUCTURE_UNVERIFIED"
  | "CARD_COLLECTION_EMPTY";

export type BrowserGroundedCollectionIdentity = {
  method: BrowserCollectionIdentityMethod;
  sourceText: string;
  sourceRef?: string;
  surfaceRoute?: string;
  collectionComponentRef?: string;
  itemComponentRef?: string;
  sourceCommitRef?: string;
};

export type BrowserGroundedCollectionField = {
  visibleLabel: string;
  visibleFieldId: string;
  provenance: {
    method:
      | "NATIVE_TH"
      | "ARIA_COLUMNHEADER";
    sourceText: string;
  };
};

export type BrowserGroundedCollectionCell = {
  visibleFieldId: string;
  rawValue: string;
  provenance: {
    method:
      | "NATIVE_TD"
      | "ARIA_CELL"
      | "ARIA_GRIDCELL";
  };
};

export type BrowserGroundedCollectionRow = {
  /** Structural sequence inside one grounded table; never a semantic ID. */
  sequencePosition: number;
  rowSequenceObserved: true;
  rowId?: string;
  rowIdentity?: {
    method:
      | "DATA_ROW_KEY"
      | "DATA_ENTITY_ID"
      | "ARIA_NAME"
      | "ARIA_LABELLEDBY"
      | "ROW_HEADER";
    sourceText: string;
  };
  rowIdentityStatus:
    | "GROUNDED"
    | "UNAVAILABLE";
  rowIdentityReason?:
    "ROW_IDENTITY_UNAVAILABLE";
  cells: BrowserGroundedCollectionCell[];
  provenance: {
    method: "NATIVE_TR" | "ARIA_ROW";
  };
};

export type BrowserGroundedCardField = {
  field: string;
  visibleFieldId?: string;
  rawValue: string;
  sourceField?: string;
  sourceFields?: string[];
  mappingKind?:
    | "DIRECT"
    | "FALLBACK"
    | "COMPOSITE"
    | "DERIVED"
    | "UNRESOLVED";
  valueKind?:
    | "TEXT"
    | "ENUM"
    | "DATE_TIME"
    | "NUMERIC";
  provenance: {
    method:
      | "SOURCE_BACKED_H3"
      | "SOURCE_BACKED_CARD_FIELD";
    sourceExpression: string;
    sourceRef:
      | string
      | {
          file: string;
          line?: number;
          symbol?: string;
        };
    sourceCommitRef?: string;
  };
};

export type BrowserGroundedCardFieldSchema = {
  visibleFieldId: string;
  observationField: string;
  sourceField: string;
  sourceFields: string[];
  mappingKind:
    | "DIRECT"
    | "FALLBACK"
    | "COMPOSITE"
    | "DERIVED"
    | "UNRESOLVED";
  valueKind:
    | "TEXT"
    | "ENUM"
    | "DATE_TIME"
    | "NUMERIC";
  sourceExpression: string;
  sourceRef: {
    file: string;
    line?: number;
    symbol?: string;
  };
  sourceCommitRef?: string;
};

export type BrowserGroundedCardControl = {
  kind: "ACTION";
  role: "button";
  label: string;
};

export type BrowserGroundedCardItem = {
  /** Structural sequence inside one grounded card collection; never an ID. */
  sequencePosition: number;
  itemSequenceObserved: true;
  visibleItemName: string;
  durableItemId?: string;
  durableItemIdentity?: {
    method:
      | "DATA_ENTITY_ID"
      | "DATA_ID"
      | "DATA_KEY";
    sourceText: string;
  };
  durableItemIdentityStatus:
    | "GROUNDED"
    | "UNAVAILABLE";
  durableItemIdentityReason?:
    "CARD_ITEM_IDENTITY_UNAVAILABLE";
  fields: BrowserGroundedCardField[];
  controls: BrowserGroundedCardControl[];
  provenance: {
    method: "SOURCE_COMPONENT_ITEM";
    itemComponentRef: string;
  };
};

export type BrowserGroundedCollectionPaginationControl = {
  kind: "PREVIOUS" | "NEXT";
  role: "button";
  label: string;
  sourceRef: string;
};

export type BrowserObservedCollection = {
  collectionId: string;
  shape: "TABLE" | "GRID" | "CARD";
  /** Compatibility/audit label; identity.sourceText is authoritative. */
  label: string;
  identity: BrowserGroundedCollectionIdentity;
  fields: BrowserGroundedCollectionField[];
  rows: BrowserGroundedCollectionRow[];
  items?: BrowserGroundedCardItem[];
  cardFieldSchema?:
    BrowserGroundedCardFieldSchema[];
  paginationControls?:
    BrowserGroundedCollectionPaginationControl[];
  sourceItemKey?: {
    expression: string;
    available: true;
    runtimeCorrespondence: false;
  };
  provenance: {
    method:
      | "NATIVE_TABLE"
      | "ARIA_TABLE"
      | "ARIA_GRID"
      | "SOURCE_COMPONENT_CARD";
    rowSequenceObserved: boolean;
    itemSequenceObserved?: true;
    rowsTruncated?: boolean;
    itemsTruncated?: boolean;
  };
};

export type BrowserCollectionObservationAbstention = {
  shape: "TABLE" | "GRID" | "CARD";
  reason: BrowserCollectionAbstentionReason;
  identity?: BrowserGroundedCollectionIdentity;
  visibleSchemaLabels: string[];
  detectedRowCount: number;
  note: string;
};

export type BrowserObservation = {
  url: string;
  title: string;
  headings: string[];
  controls: BrowserObservationControl[];
  inputs: BrowserObservationInput[];
  surfaces: BrowserObservationSurface[];
  collections?: BrowserObservedCollection[];
  collectionAbstentions?:
    BrowserCollectionObservationAbstention[];
  visibleText: string[];
  counts: {
    headings: number;
    controls: number;
    inputs: number;
    surfaces: number;
    collections?: number;
    collectionAbstentions?: number;
    visibleText: number;
  };
};

export type BrowserObservationOptions = {
  maxHeadings?: number;
  maxControls?: number;
  maxInputs?: number;
  maxSurfaces?: number;
  maxCollections?: number;
  maxCollectionRows?: number;
  maxCollectionFields?: number;
  maxVisibleText?: number;
  maxTextLength?: number;
  sourceCardCollectionDeclarations?:
    SourceCardCollectionDeclaration[];
  minimumCardCollectionItems?: number;
};

type BrowserObservationControlSnapshot =
  BrowserObservationControl & {
    contextAncestors: string[];
  };

type BrowserObservationSnapshot = Omit<Pick<
  BrowserObservation,
  | "headings"
  | "controls"
  | "inputs"
  | "surfaces"
  | "collections"
  | "collectionAbstentions"
  | "visibleText"
>, "controls"> & {
  controls:
    BrowserObservationControlSnapshot[];
};

export const BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS =
  120;

const DEFAULT_LIMITS = {
  maxHeadings: 30,
  maxControls:
    BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS,
  maxInputs: 60,
  maxSurfaces: 30,
  maxCollections: 12,
  maxCollectionRows: 40,
  maxCollectionFields: 20,
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
    maxCollections: boundedInteger(
      options.maxCollections,
      DEFAULT_LIMITS.maxCollections,
      1,
      50
    ),
    maxCollectionRows: boundedInteger(
      options.maxCollectionRows,
      DEFAULT_LIMITS.maxCollectionRows,
      2,
      100
    ),
    maxCollectionFields: boundedInteger(
      options.maxCollectionFields,
      DEFAULT_LIMITS.maxCollectionFields,
      1,
      50
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
    minimumCardCollectionItems:
      boundedInteger(
        options.minimumCardCollectionItems,
        2,
        1,
        100
      ),
  };
  const sourceCardCollectionDeclarations =
    options.sourceCardCollectionDeclarations ??
    discoverFrontendCardCollectionDeclarations();

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

      const sourceCardCollectionDeclarations =
        ${JSON.stringify(
          sourceCardCollectionDeclarations
        )};

      const semanticDescendantLabelAttributes =
        ${JSON.stringify(
          BROWSER_SEMANTIC_DESCENDANT_LABEL_ATTRIBUTES
        )};

      const normalize = (
        value,
        maxLength =
          runtimeLimits.maxTextLength
      ) =>
        String(value ?? "")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, maxLength);

      const fingerprintText = (
        value
      ) => {
        let hash = 2166136261;
        for (
          let index = 0;
          index < value.length;
          index += 1
        ) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(
            hash,
            16777619
          );
        }
        return (hash >>> 0)
          .toString(16)
          .padStart(8, "0");
      };

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
        const descendantMetadataValues =
          Array.from(
            element.querySelectorAll(
              [
                "svg",
                "[aria-label]",
                "[title]",
                "[data-testid]",
                "[data-icon]",
                "[data-lucide]",
              ].join(", ")
            )
          )
            .slice(0, 20)
            .flatMap((child) =>
              semanticDescendantLabelAttributes
                .map((attribute) =>
                  normalize(
                    child.getAttribute(
                      attribute
                    )
                  )
                )
                .filter(Boolean)
            );

        const uniqueDescendantMetadata =
          new Map();

        for (
          const value of
          descendantMetadataValues
        ) {
          const key =
            value.toLowerCase();

          if (
            !uniqueDescendantMetadata.has(
              key
            )
          ) {
            uniqueDescendantMetadata.set(
              key,
              value
            );
          }
        }

        /*
         * Do not pick among multiple different descendant
         * identities by DOM or attribute order.
         */
        const descendantMetadata =
          uniqueDescendantMetadata.size === 1
            ? Array.from(
                uniqueDescendantMetadata.values()
              )[0]
            : "";

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
          descendantMetadata,
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

      const semanticContextAncestors = (
        element
      ) => {
        const ancestorTexts = [];
        let current =
          element.parentElement;

        for (
          let depth = 1;
          current &&
          depth <= ${BROWSER_SEMANTIC_CONTEXT_MAX_DEPTH};
          depth += 1
        ) {
          const ancestorText = normalize(
            current instanceof HTMLElement
              ? current.innerText
              : current.textContent
          );

          ancestorTexts.push(
            ancestorText
          );

          current =
            current.parentElement;
        }

        return ancestorTexts;
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

      /*
       * GENERIC_BROWSER_CONTROL_SURFACE_OWNERSHIP_V1
       *
       * Resolve only a real semantic ancestor surface.
       *
       * The nearest matching semantic ancestor owns the control.
       * Generic data-state wrappers and CSS implementation classes
       * are deliberately excluded.
       */
      const semanticOwnershipSurfaceSelector =
        [
          "dialog[open]",
          '[role="dialog"]',
          '[role="alertdialog"]',
          '[role="menu"]',
          '[role="listbox"]',
          '[role="region"]',
          '[role="tooltip"]',
          '[aria-modal="true"]',
        ].join(", ");

      const semanticSurfaceKindForControl = (
        element
      ) => {
        const surface =
          element.closest(
            semanticOwnershipSurfaceSelector
          );

        if (
          !surface ||
          surface === element ||
          !isVisible(surface)
        ) {
          return "";
        }

        const role = normalize(
          surface.getAttribute("role") ||
          (
            surface instanceof
              HTMLDialogElement
              ? "dialog"
              : ""
          )
        );

        return inferSurfaceKind(
          role
        );
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

      const activeModalSelector =
        ${JSON.stringify(
          BROWSER_ACTIVE_MODAL_SELECTOR
        )};
      const activeModalSurfaces =
        Array.from(
          document.querySelectorAll(
            activeModalSelector
          )
        ).filter(isVisible);
      const activeSurfaceRoot =
        activeModalSurfaces.length === 1
          ? activeModalSurfaces[0]
          : null;
      const activeSurfaceAmbiguous =
        activeModalSurfaces.length > 1;
      const observationRoot =
        activeSurfaceRoot ||
        (
          activeSurfaceAmbiguous
            ? null
            : document
        );

      /*
       * A control inside the active modal may own a popup that is
       * portaled elsewhere in document.body. Keep the modal as the
       * primary scope, but admit only visible popup roots explicitly
       * associated through aria-controls/aria-owns.
       */
      const associatedPopupRoots = [];
      const associatedPopupKeys =
        new Set();

      if (activeSurfaceRoot) {
        const popupOwners =
          Array.from(
            activeSurfaceRoot
              .querySelectorAll(
                '[aria-controls], [aria-owns]'
              )
          ).filter(isVisible);

        for (const owner of popupOwners) {
          const expanded =
            owner.getAttribute(
              'aria-expanded'
            );
          const hasPopup = normalize(
            owner.getAttribute(
              'aria-haspopup'
            )
          );

          if (expanded === 'false') {
            continue;
          }

          if (
            expanded !== 'true' &&
            ![
              'dialog',
              'grid',
              'listbox',
              'menu',
              'tree',
            ].includes(hasPopup)
          ) {
            continue;
          }

          const referencedIds = [
            normalize(
              owner.getAttribute(
                'aria-controls'
              )
            ),
            normalize(
              owner.getAttribute(
                'aria-owns'
              )
            ),
          ]
            .flatMap((value) =>
              value.split(/\\s+/)
            )
            .filter(Boolean);

          for (const id of referencedIds) {
            if (
              associatedPopupKeys.has(id)
            ) {
              continue;
            }

            const popup =
              document.getElementById(id);

            if (
              !popup ||
              !isVisible(popup) ||
              activeSurfaceRoot
                .contains(popup)
            ) {
              continue;
            }

            associatedPopupKeys.add(id);
            associatedPopupRoots.push(
              popup
            );
          }
        }

        /*
         * Some accessible custom controls portal their popup outside
         * the modal without exposing aria-controls/aria-owns on the
         * observed trigger node.
         *
         * Fall back only when there is exactly one visible semantic
         * popup outside the active modal. Multiple candidates remain
         * ambiguous and are intentionally ignored.
         */
        if (associatedPopupRoots.length === 0) {
          const externalPopupSelector = [
            '[role="menu"]',
            '[role="listbox"]',
            '[data-state="open"]',
            '[data-radix-menu-content]',
            '[data-radix-popper-content-wrapper]',
            '[class*="popover"]',
            '[class*="Popover"]',
            '[class*="dropdown"]',
            '[class*="Dropdown"]',
          ].join(', ');

          const interactiveTriggerSelector = [
            "button",
            "a[href]",
            "input",
            "textarea",
            "select",
            '[role="button"]',
            '[role="link"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="option"]',
          ].join(", ");

          const externalPopupMatches =
            Array.from(
              document.querySelectorAll(
                externalPopupSelector
              )
            ).filter(
              (popup) =>
                isVisible(popup) &&
                !activeSurfaceRoot
                  .contains(popup) &&
                !popup.matches(
                  interactiveTriggerSelector
                )
            );

          /*
           * Broad popup selectors may match multiple nested wrappers
           * belonging to one physical popup tree. Canonicalize those
           * matches to their outermost visible roots before applying
           * the ambiguity guard.
           *
           * Independent popup trees remain independent candidates.
           */
          const externalPopupRoots =
            externalPopupMatches.filter(
              (candidate) =>
                !externalPopupMatches.some(
                  (other) =>
                    other !== candidate &&
                    other.contains(
                      candidate
                    )
                )
            );

          if (externalPopupRoots.length === 1) {
            associatedPopupRoots.push(
              externalPopupRoots[0]
            );
          }
        }
      }

      const observationRoots =
        observationRoot
          ? [
              observationRoot,
              ...associatedPopupRoots,
            ]
          : [];

      const scopedElements = (
        selector
      ) => {
        const result = [];
        const seen = new Set();

        for (const root of
          observationRoots) {
          if (
            root instanceof Element &&
            root.matches(selector) &&
            !seen.has(root)
          ) {
            seen.add(root);
            result.push(root);
          }

          for (const element of
            root.querySelectorAll(
              selector
            )) {
            if (seen.has(element)) {
              continue;
            }

            seen.add(element);
            result.push(element);
          }
        }

        return result;
      };
      const inputSelector =
        ${JSON.stringify(
          BROWSER_OBSERVATION_INPUT_SELECTOR
        )};

      const headings = uniqueStrings(
        scopedElements(
          "h1, h2, h3, h4, " +
          '[role="heading"]'
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
      ].join(", ");

      const controls = [];

      for (
        const element of
        scopedElements(
          controlSelector
        ).filter(isVisible)
      ) {
        if (
          element.matches(
            inputSelector
          )
        ) {
          continue;
        }

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

        const surfaceKind =
          semanticSurfaceKindForControl(
            element
          );

        const contextAncestors =
          semanticContextAncestors(
            element
          );

        const externalPopup =
          associatedPopupRoots.some(
            (popupRoot) =>
              popupRoot === element ||
              popupRoot.contains(
                element
              )
          );

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
          contextAncestors,
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

        if (surfaceKind) {
          observation.surfaceKind =
            surfaceKind;
        }

        if (href) {
          observation.href = href;
        }

        if (controlsId) {
          observation.controls =
            controlsId;

          if (kind === "tab") {
            const controlledSurface =
              document.getElementById(
                controlsId
              );
            if (
              controlledSurface instanceof
                HTMLElement
            ) {
              const controlledText =
                normalize(
                  controlledSurface.innerText ||
                    controlledSurface.textContent ||
                    "",
                  100000
                );
              observation.controlledSurface = {
                id: controlsId,
                role: normalize(
                  controlledSurface.getAttribute(
                    "role"
                  )
                ),
                visible:
                  isVisible(controlledSurface),
                contentFingerprint:
                  fingerprintText(
                    controlledText
                  ),
                textLength:
                  controlledText.length,
              };
            }
          }
        }

        if (externalPopup) {
          observation.externalPopup =
            true;
        }

        controls.push(observation);

        if (
          controls.length >=
          runtimeLimits.maxControls
        ) {
          break;
        }
      }

      /*
       * GENERIC_BROWSER_SEMANTIC_OPTION_BINDING_V1
       *
       * Some virtualized selection widgets split semantic identity
       * from the actually visible interaction row:
       *
       * - a geometrically hidden role=option node carries the
       *   accessible label and aria-selected state;
       * - a separate visible descendant in the same structural host
       *   carries the executable pointer interaction.
       *
       * Bridge those two trees only when:
       * - the semantic listbox itself is not geometrically visible;
       * - one exact semantic option identity exists for the label;
       * - exactly one visible pointer-eligible visual descendant in
       *   the listbox's direct structural host has the same exact
       *   semantic label/text;
       * - the visual candidate is not already represented by an
       *   ordinary interactive control/input;
       * - no more-specific exact visual descendant exposes the same
       *   pointer semantics.
       *
       * Hidden semantic nodes remain identity/state sources only.
       * They are never treated as executable DOM targets.
       *
       * No DOM order, nth/first selection, geometry ranking,
       * proximity, CSS class identity, or product literal is used.
       */
      const optionBridgeInteractiveSelector =
        [
          controlSelector,
          inputSelector,
        ].join(", ");

      const semanticOptionListboxes =
        scopedElements(
          '[role="listbox"]'
        ).slice(0, 20);

      const isOptionBridgeVisualCandidate = (
        element,
        semanticListbox,
        expectedIdentity
      ) => {
        if (
          !(element instanceof HTMLElement) ||
          semanticListbox.contains(
            element
          ) ||
          !isVisible(element)
        ) {
          return false;
        }

        if (
          element.matches(
            optionBridgeInteractiveSelector
          ) ||
          element.closest(
            optionBridgeInteractiveSelector
          )
        ) {
          return false;
        }

        if (
          element.getAttribute(
            "aria-disabled"
          ) === "true"
        ) {
          return false;
        }

        const style =
          window.getComputedStyle(
            element
          );

        if (
          style.cursor !== "pointer" ||
          style.pointerEvents === "none"
        ) {
          return false;
        }

        const candidateIdentity =
          elementLabel(
            element
          ).toLowerCase();

        return (
          candidateIdentity.length > 0 &&
          candidateIdentity ===
            expectedIdentity
        );
      };

      for (
        const semanticListbox of
        semanticOptionListboxes
      ) {
        if (
          !(
            semanticListbox instanceof
            HTMLElement
          ) ||
          isVisible(
            semanticListbox
          )
        ) {
          continue;
        }

        const optionHost =
          semanticListbox.parentElement;

        if (
          !(
            optionHost instanceof
            HTMLElement
          )
        ) {
          continue;
        }

        const identitiesByLabel =
          new Map();

        for (
          const optionIdentity of
          Array.from(
            semanticListbox
              .querySelectorAll(
                '[role="option"]'
              )
          ).slice(0, 80)
        ) {
          if (
            !(
              optionIdentity instanceof
              HTMLElement
            )
          ) {
            continue;
          }

          const identityLabel =
            elementLabel(
              optionIdentity
            );

          if (!identityLabel) {
            continue;
          }

          const identityKey =
            identityLabel
              .toLowerCase();

          const existing =
            identitiesByLabel.get(
              identityKey
            ) || [];

          existing.push(
            optionIdentity
          );

          identitiesByLabel.set(
            identityKey,
            existing
          );
        }

        for (
          const [
            identityKey,
            identities,
          ] of identitiesByLabel
        ) {
          /*
           * Ambiguity at the semantic identity layer must fail
           * before any visual binding is attempted.
           */
          if (
            identities.length !== 1
          ) {
            continue;
          }

          const optionIdentity =
            identities[0];

          if (
            !(
              optionIdentity instanceof
              HTMLElement
            ) ||
            optionIdentity.getAttribute(
              "aria-disabled"
            ) === "true"
          ) {
            continue;
          }

          const visualCandidates =
            Array.from(
              optionHost.querySelectorAll(
                "*"
              )
            )
              .slice(0, 160)
              .filter(
                (element) =>
                  isOptionBridgeVisualCandidate(
                    element,
                    semanticListbox,
                    identityKey
                  )
              )
              .filter(
                (candidate) => {
                  /*
                   * Canonicalize nested visual wrappers
                   * structurally: a parent is not canonical when a
                   * more-specific descendant independently satisfies
                   * the exact same binding contract.
                   */
                  return !Array.from(
                    candidate.querySelectorAll(
                      "*"
                    )
                  ).some(
                    (descendant) =>
                      isOptionBridgeVisualCandidate(
                        descendant,
                        semanticListbox,
                        identityKey
                      )
                  );
                }
              );

          /*
           * Zero or multiple visual bindings are intentionally
           * unresolved. Never choose by DOM order or proximity.
           */
          if (
            visualCandidates.length !== 1
          ) {
            continue;
          }

          const visualCandidate =
            visualCandidates[0];

          const identityLabel =
            elementLabel(
              optionIdentity
            );

          const contextAncestors =
            semanticContextAncestors(
              visualCandidate
            );

          const externalPopup =
            associatedPopupRoots.some(
              (popupRoot) =>
                popupRoot ===
                  visualCandidate ||
                popupRoot.contains(
                  visualCandidate
                )
            );

          const observation = {
            kind: "option",
            label: identityLabel,
            role: "option",
            contextAncestors,
            disabled: false,
            selected:
              booleanAttribute(
                optionIdentity,
                "aria-selected"
              ),
            expanded: null,
            checked: null,
            semanticOptionBinding:
              true,
          };

          if (externalPopup) {
            observation.externalPopup =
              true;
          }

          controls.push(
            observation
          );

          if (
            controls.length >=
            runtimeLimits.maxControls
          ) {
            break;
          }
        }

        if (
          controls.length >=
          runtimeLimits.maxControls
        ) {
          break;
        }
      }

      /*
       * GENERIC_BROWSER_ROLELESS_SURFACE_ITEM_V1
       *
       * Some semantic runtime surfaces expose exact visible
       * interaction items without native interactive roles.
       *
       * Admit only visible exact-text leaf items inside an
       * already-observed tooltip surface when:
       * - the item is not already represented by the ordinary
       *   semantic control/input selectors;
       * - computed cursor semantics indicate direct activation;
       * - pointer events are enabled;
       * - the item is not disabled;
       * - no more-specific descendant with the same exact text
       *   exposes the same pointer semantics.
       *
       * This intentionally does not use DOM order, nth-child,
       * coordinates, proximity, CSS class identity, or product
       * literals to choose among candidates. Independent exact
       * duplicates remain separate controls and are rejected by
       * the evaluator's existing uniqueness contract.
       */
      const rolelessSurfaceRoots =
        scopedElements(
          '[role="tooltip"]'
        ).filter(isVisible);

      const ordinaryInteractiveSelector = [
        controlSelector,
        inputSelector,
      ].join(", ");

      const seenRolelessSurfaceItems =
        new Set();

      for (
        const surfaceRoot of
        rolelessSurfaceRoots
      ) {
        const descendants =
          Array.from(
            surfaceRoot.querySelectorAll(
              "*"
            )
          ).slice(0, 160);

        for (const element of descendants) {
          if (
            !(element instanceof HTMLElement) ||
            seenRolelessSurfaceItems.has(
              element
            ) ||
            !isVisible(element)
          ) {
            continue;
          }

          if (
            element.matches(
              ordinaryInteractiveSelector
            ) ||
            element.closest(
              ordinaryInteractiveSelector
            )
          ) {
            continue;
          }

          if (
            element.getAttribute(
              "aria-disabled"
            ) === "true"
          ) {
            continue;
          }

          const style =
            window.getComputedStyle(
              element
            );

          if (
            style.cursor !== "pointer" ||
            style.pointerEvents === "none"
          ) {
            continue;
          }

          const exactText = normalize(
            element.innerText ||
            element.textContent ||
            ""
          );

          if (!exactText) {
            continue;
          }

          const hasMoreSpecificExactItem =
            Array.from(
              element.querySelectorAll(
                "*"
              )
            ).some((descendant) => {
              if (
                !(
                  descendant instanceof
                  HTMLElement
                ) ||
                !isVisible(descendant) ||
                descendant.matches(
                  ordinaryInteractiveSelector
                ) ||
                descendant.closest(
                  ordinaryInteractiveSelector
                )
              ) {
                return false;
              }

              if (
                descendant.getAttribute(
                  "aria-disabled"
                ) === "true"
              ) {
                return false;
              }

              const descendantStyle =
                window.getComputedStyle(
                  descendant
                );

              if (
                descendantStyle.cursor !==
                  "pointer" ||
                descendantStyle
                  .pointerEvents ===
                  "none"
              ) {
                return false;
              }

              return (
                normalize(
                  descendant.innerText ||
                  descendant.textContent ||
                  ""
                ) === exactText
              );
            });

          if (
            hasMoreSpecificExactItem
          ) {
            continue;
          }

          const contextAncestors =
            semanticContextAncestors(
              element
            );

          const externalPopup =
            associatedPopupRoots.some(
              (popupRoot) =>
                popupRoot === element ||
                popupRoot.contains(
                  element
                )
            );

          const observation = {
            kind: "control",
            label: exactText,
            role: "",
            contextAncestors,
            disabled: false,
            selected: null,
            expanded: null,
            checked: null,
          };

          if (externalPopup) {
            observation.externalPopup =
              true;
          }

          seenRolelessSurfaceItems.add(
            element
          );

          controls.push(observation);

          if (
            controls.length >=
            runtimeLimits.maxControls
          ) {
            break;
          }
        }

        if (
          controls.length >=
          runtimeLimits.maxControls
        ) {
          break;
        }
      }

      const inputs = [];

      for (
        const element of
        scopedElements(
          inputSelector
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

        const hasPopup = normalize(
          element.getAttribute(
            "aria-haspopup"
          )
        );
        const controlsId = normalize(
          element.getAttribute(
            "aria-controls"
          )
        );
        const hasControls =
          controlsId.length > 0;
        const expanded =
          booleanAttribute(
            element,
            "aria-expanded"
          );
        const hasExpandedState =
          expanded !== null;
        const ariaAutocomplete =
          normalize(
            element.getAttribute(
              "aria-autocomplete"
            )
          );
        const nativeReadOnly =
          element instanceof
            HTMLInputElement
            ? element.readOnly
            : false;
        const unsafeType = [
          "button",
          "checkbox",
          "file",
          "hidden",
          "image",
          "radio",
          "reset",
          "submit",
        ].includes(type);
        const activationSafe =
          !unsafeType &&
          element.tagName
            .toLowerCase() !== "select" &&
          (
            role === "combobox" ||
            [
              "dialog",
              "grid",
              "listbox",
              "menu",
              "tree",
            ].includes(hasPopup) ||
            hasControls ||
            hasExpandedState ||
            ["both", "list"].includes(
              ariaAutocomplete
            ) ||
            (
              nativeReadOnly &&
              ["search", "text"]
                .includes(type)
            )
          );

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

        const observation = {
          label,
          role,
          type,
          disabled,
          activationSafe,
          expanded,
          required,
          hasValue,
        };

        if (placeholder) {
          observation.placeholder =
            placeholder;
        }

        if (controlsId) {
          observation.controls =
            controlsId;
        }

        if (hasPopup) {
          observation.hasPopup =
            hasPopup;
        }

        inputs.push(observation);

        if (
          inputs.length >=
          runtimeLimits.maxInputs
        ) {
          break;
        }
      }

      /*
       * GENERIC_BROWSER_TOOLTIP_SURFACE_OBSERVATION_V1
       *
       * Accessible tooltip-role popovers are semantic runtime
       * surfaces. They may carry filter/picker state even when the
       * component library does not expose dialog/menu/listbox roles
       * or data-state="open".
       *
       * Observe the semantic role only. Do not promote broad CSS
       * popover/dropdown classes into BrowserObservation surfaces.
       */
      const surfaceSelector = [
        "dialog",
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[role="menu"]',
        '[role="listbox"]',
        '[role="region"]',
        '[role="tooltip"]',
        '[aria-modal="true"]',
        '[data-state="open"]',
      ].join(", ");

      const surfaces = [];
      const surfaceKeys = new Set();
      const surfaceElements =
        activeModalSurfaces.length === 0
          ? Array.from(
              document.querySelectorAll(
                surfaceSelector
              )
            )
          : activeModalSurfaces.length === 1
            ? scopedElements(
                surfaceSelector
              )
            : activeModalSurfaces;

      for (
        const element of
        surfaceElements.filter(isVisible)
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
        activeSurfaceRoot ||
        (
          activeSurfaceAmbiguous
            ? null
            : document.querySelector(
                "main"
              ) || document.body
        );

      /*
       * GROUNDED_COLLECTION_OBSERVATION_V1
       *
       * Observe only explicitly named native/ARIA tables and grids. A
       * labelled semantic container is allowed only through its declared
       * aria-label/aria-labelledby relationship. No nearest-heading,
       * sibling, coordinate, repeated-div or visual-proximity inference.
       */
      const collections = [];
      const collectionAbstentions = [];
      const collectionElements =
        scopedElements(
          'table, [role="table"], [role="grid"]'
        )
          .filter(isVisible)
          .slice(
            0,
            runtimeLimits.maxCollections
          );

      const identityKey = (value) =>
        normalize(value)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') ||
        'unnamed';

      const explicitLabelledBy = (
        element
      ) => {
        const ids = normalize(
          element.getAttribute(
            'aria-labelledby'
          )
        )
          .split(/\\s+/)
          .filter(Boolean);

        if (ids.length === 0) {
          return null;
        }

        const referenced = ids.map((id) =>
          document.getElementById(id)
        );

        if (
          referenced.some((item) => !item)
        ) {
          return null;
        }

        const sourceText = normalize(
          referenced
            .map((item) =>
              item.innerText ||
              item.textContent ||
              ''
            )
            .join(' ')
        );

        return sourceText
          ? {
              sourceText,
              sourceRef:
                'aria-labelledby:' +
                ids.join(' '),
            }
          : null;
      };

      const structuralContainerIdentity = (
        element
      ) => {
        const candidates = [];
        let ancestor =
          element.parentElement;

        while (ancestor) {
          const role = normalize(
            ancestor.getAttribute('role')
          );
          const isSemanticContainer =
            role === 'tabpanel' ||
            role === 'region' ||
            (
              ancestor instanceof
                HTMLElement &&
              ancestor.tagName === 'SECTION'
            );

          if (isSemanticContainer) {
            const labelledBy =
              explicitLabelledBy(ancestor);
            const ariaLabel = normalize(
              ancestor.getAttribute(
                'aria-label'
              )
            );
            const sourceText =
              labelledBy?.sourceText ||
              ariaLabel;

            if (sourceText) {
              candidates.push({
                method:
                  'STRUCTURAL_HEADING_RELATION',
                sourceText,
                sourceRef:
                  labelledBy?.sourceRef ||
                  (
                    'semantic-container:' +
                    role
                  ),
              });
            }
          }

          ancestor =
            ancestor.parentElement;
        }

        return candidates;
      };

      const addCollectionAbstention = (
        shape,
        reason,
        identity,
        visibleSchemaLabels,
        detectedRowCount,
        note
      ) => {
        collectionAbstentions.push({
          shape,
          reason,
          ...(identity ? { identity } : {}),
          visibleSchemaLabels,
          detectedRowCount,
          note,
        });
      };

      for (const collectionElement of
        collectionElements) {
        const containingCollection =
          collectionElement.parentElement
            ?.closest(
              'table, [role="table"], [role="grid"]'
            );

        if (containingCollection) {
          continue;
        }

        const role = normalize(
          collectionElement.getAttribute(
            'role'
          )
        );
        const shape = role === 'grid'
          ? 'GRID'
          : 'TABLE';
        const caption =
          collectionElement instanceof
            HTMLTableElement
            ? normalize(
                collectionElement.caption
                  ?.innerText
              )
            : '';
        const ariaLabel = normalize(
          collectionElement.getAttribute(
            'aria-label'
          )
        );
        const ownLabelledBy =
          explicitLabelledBy(
            collectionElement
          );
        const structuralIdentities =
          structuralContainerIdentity(
            collectionElement
          );
        let identity = null;
        let identityAmbiguous = false;

        if (ariaLabel) {
          identity = {
            method: 'ARIA_NAME',
            sourceText: ariaLabel,
            sourceRef: 'aria-label',
          };
        } else if (caption) {
          identity = {
            method: 'TABLE_CAPTION',
            sourceText: caption,
            sourceRef: 'caption',
          };
        } else if (ownLabelledBy) {
          identity = {
            method: 'ARIA_LABELLEDBY',
            ...ownLabelledBy,
          };
        } else if (
          structuralIdentities.length === 1
        ) {
          identity =
            structuralIdentities[0];
        } else if (
          structuralIdentities.length > 1
        ) {
          identityAmbiguous = true;
        }

        const allRows = Array.from(
          collectionElement.querySelectorAll(
            'tr, [role="row"]'
          )
        ).filter((row) =>
          isVisible(row) &&
          row.closest(
            'table, [role="table"], [role="grid"]'
          ) === collectionElement
        );
        const headerRows =
          allRows.filter((row) => {
            const structuralCells =
              Array.from(row.children)
                .filter((cell) =>
                  cell.matches(
                    'th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'
                  )
                );

            return (
              structuralCells.length > 0 &&
              structuralCells.every(
                (cell) =>
                  cell.matches(
                    'th, [role="columnheader"]'
                  )
              )
            );
          });
        const headerRow =
          headerRows.length === 1
            ? headerRows[0]
            : null;
        const headerCells = headerRow
          ? Array.from(headerRow.children)
              .filter((cell) =>
                cell.matches(
                  'th, [role="columnheader"]'
                )
              )
          : [];
        const headers = headerCells.map(
          (cell) =>
            normalize(
              cell instanceof HTMLElement
                ? cell.innerText
                : cell.textContent
            )
        );
        const detectedDataRows =
          allRows.filter(
            (row) => row !== headerRow
          );

        if (identityAmbiguous) {
          addCollectionAbstention(
            shape,
            'COLLECTION_AMBIGUOUS',
            null,
            headers,
            detectedDataRows.length,
            'Multiple explicitly labelled semantic containers own the table/grid.'
          );
          continue;
        }

        if (!identity) {
          addCollectionAbstention(
            shape,
            'COLLECTION_NOT_GROUNDED',
            null,
            headers,
            detectedDataRows.length,
            'The table/grid has no explicit accessible name, caption, aria-labelledby, or uniquely labelled semantic container.'
          );
          continue;
        }

        const antLoadingContainer =
          collectionElement.closest(
            '.ant-spin-nested-loading'
          );
        const uniquelyOwnedAntLoading =
          antLoadingContainer &&
          antLoadingContainer.querySelectorAll(
            'table, [role="table"], [role="grid"]'
          ).length === 1 &&
          Array.from(
            antLoadingContainer.querySelectorAll(
              '.ant-spin-spinning'
            )
          ).some(isVisible);

        if (
          collectionElement.getAttribute(
            'aria-busy'
          ) === 'true' ||
          Array.from(
            collectionElement.querySelectorAll(
              '[role="progressbar"], .ant-spin-spinning'
            )
          ).some(isVisible) ||
          uniquelyOwnedAntLoading
        ) {
          addCollectionAbstention(
            shape,
            'COLLECTION_LOADING',
            identity,
            headers,
            detectedDataRows.length,
            'The grounded table/grid exposes an explicit loading signal.'
          );
          continue;
        }

        if (
          headerRows.length !== 1 ||
          headers.length === 0 ||
          headers.some((header) => !header) ||
          headers.length >
            runtimeLimits.maxCollectionFields ||
          headerCells.some((cell) =>
            Number(
              cell.getAttribute('colspan') ||
              '1'
            ) !== 1
          )
        ) {
          addCollectionAbstention(
            shape,
            'SCHEMA_NOT_GROUNDED',
            identity,
            headers.slice(
              0,
              runtimeLimits.maxCollectionFields
            ),
            detectedDataRows.length,
            'Exactly one bounded structural column-header row is required.'
          );
          continue;
        }

        const normalizedHeaders =
          headers.map(identityKey);

        if (
          new Set(normalizedHeaders).size !==
          normalizedHeaders.length
        ) {
          addCollectionAbstention(
            shape,
            'FIELD_SCHEMA_AMBIGUOUS',
            identity,
            headers,
            detectedDataRows.length,
            'Visible structural column labels must be unique after deterministic normalization.'
          );
          continue;
        }

        const explicitEmptyResultRow =
          detectedDataRows.length === 1 &&
          (() => {
            const cells = Array.from(
              detectedDataRows[0].children
            ).filter((cell) =>
              cell.matches(
                'td, th[scope="row"], [role="cell"], [role="gridcell"], [role="rowheader"]'
              )
            );
            const emptyText = normalize(
              detectedDataRows[0] instanceof
                HTMLElement
                ? detectedDataRows[0]
                    .innerText
                : detectedDataRows[0]
                    .textContent
            );

            return (
              cells.length === 1 &&
              Number(
                cells[0].getAttribute(
                  'colspan'
                ) || '1'
              ) === headers.length &&
              /^(?:no data|no results|no matching (?:data|records?|results?)|empty)$/i.test(
                emptyText
              )
            );
          })();

        if (
          detectedDataRows.length === 0 ||
          explicitEmptyResultRow
        ) {
          addCollectionAbstention(
            shape,
            'COLLECTION_EMPTY',
            identity,
            headers,
            0,
            explicitEmptyResultRow
              ? 'The grounded table/grid exposes one full-schema-span row with an explicit empty-result label.'
              : 'The grounded table/grid contains no visible structural data rows.'
          );
          continue;
        }

        const collectionId = [
          'collection',
          shape.toLowerCase(),
          identity.method.toLowerCase(),
          identityKey(
            (identity.sourceRef || '') +
            ':' +
            identity.sourceText
          ),
        ].join(':');
        const fields = headers.map(
          (visibleLabel, index) => ({
            visibleLabel,
            visibleFieldId:
              collectionId +
              ':field:' +
              identityKey(visibleLabel),
            provenance: {
              method:
                headerCells[index]
                  ?.getAttribute('role') ===
                  'columnheader'
                  ? 'ARIA_COLUMNHEADER'
                  : 'NATIVE_TH',
              sourceText: visibleLabel,
            },
          })
        );

        const rows = [];
        let rowStructureInvalid = false;

        for (const row of
          detectedDataRows) {
          const cells = Array.from(
            row.children
          ).filter((cell) =>
            cell.matches(
              'td, th[scope="row"], [role="cell"], [role="gridcell"], [role="rowheader"]'
            )
          );

          if (
            cells.length !== headers.length ||
            cells.some((cell) =>
              Number(
                cell.getAttribute('colspan') ||
                '1'
              ) !== 1
            )
          ) {
            rowStructureInvalid = true;
            break;
          }

          const dataRowKey = [
            'data-row-key',
            'data-entity-id',
            'data-id',
            'data-key',
          ]
            .map((attribute) => ({
              attribute,
              value: normalize(
                row.getAttribute(attribute)
              ),
            }))
            .find((item) => item.value);
          const rowLabel = normalize(
            row.getAttribute('aria-label')
          );
          const rowLabelledBy =
            explicitLabelledBy(row);
          const rowHeader = cells.find(
            (cell) =>
              cell.matches(
                'th[scope="row"], [role="rowheader"]'
              )
          );
          const rowHeaderText = normalize(
            rowHeader instanceof HTMLElement
              ? rowHeader.innerText
              : rowHeader?.textContent
          );
          let rowIdentity = null;

          if (dataRowKey) {
            rowIdentity = {
              method:
                dataRowKey.attribute ===
                  'data-row-key'
                  ? 'DATA_ROW_KEY'
                  : 'DATA_ENTITY_ID',
              sourceText:
                dataRowKey.value,
            };
          } else if (rowLabel) {
            rowIdentity = {
              method: 'ARIA_NAME',
              sourceText: rowLabel,
            };
          } else if (rowLabelledBy) {
            rowIdentity = {
              method: 'ARIA_LABELLEDBY',
              sourceText:
                rowLabelledBy.sourceText,
            };
          } else if (rowHeaderText) {
            rowIdentity = {
              method: 'ROW_HEADER',
              sourceText: rowHeaderText,
            };
          }

          rows.push({
            sequencePosition: rows.length,
            rowSequenceObserved: true,
            ...(rowIdentity
              ? {
                  rowId:
                    rowIdentity.method +
                    ':' +
                    identityKey(
                      rowIdentity.sourceText
                    ),
                  rowIdentity,
                  rowIdentityStatus:
                    'GROUNDED',
                }
              : {
                  rowIdentityStatus:
                    'UNAVAILABLE',
                  rowIdentityReason:
                    'ROW_IDENTITY_UNAVAILABLE',
                }),
            cells: cells.map(
              (cell, index) => ({
                visibleFieldId:
                  fields[index]
                    .visibleFieldId,
                rawValue: normalize(
                  cell instanceof HTMLElement
                    ? cell.innerText
                    : cell.textContent
                ),
                provenance: {
                  method:
                    cell.getAttribute('role') ===
                    'gridcell'
                      ? 'ARIA_GRIDCELL'
                      : cell.getAttribute('role') ===
                          'cell'
                        ? 'ARIA_CELL'
                        : 'NATIVE_TD',
                },
              })
            ),
            provenance: {
              method:
                row.getAttribute('role') ===
                'row'
                  ? 'ARIA_ROW'
                  : 'NATIVE_TR',
            },
          });

          if (
            rows.length >=
            runtimeLimits.maxCollectionRows
          ) {
            break;
          }
        }

        if (rowStructureInvalid) {
          addCollectionAbstention(
            shape,
            'ROW_STRUCTURE_NOT_GROUNDED',
            identity,
            headers,
            detectedDataRows.length,
            'Every structural data row must align exactly with the grounded field schema.'
          );
          continue;
        }

        const rowIdentityCounts =
          new Map();

        for (const row of rows) {
          if (!row.rowId) {
            continue;
          }

          rowIdentityCounts.set(
            row.rowId,
            (rowIdentityCounts.get(row.rowId) || 0) + 1
          );
        }

        for (const row of rows) {
          if (
            row.rowId &&
            rowIdentityCounts.get(row.rowId) > 1
          ) {
            delete row.rowId;
            delete row.rowIdentity;
            row.rowIdentityStatus =
              'UNAVAILABLE';
            row.rowIdentityReason =
              'ROW_IDENTITY_UNAVAILABLE';
          }
        }

        collections.push({
          collectionId,
          shape,
          label: identity.sourceText,
          identity,
          fields,
          rows,
          provenance: {
            method:
              collectionElement instanceof
                HTMLTableElement
                ? 'NATIVE_TABLE'
                : role === 'grid'
                  ? 'ARIA_GRID'
                  : 'ARIA_TABLE',
            rowSequenceObserved: true,
            rowsTruncated:
              detectedDataRows.length >
              runtimeLimits.maxCollectionRows,
          },
        });
      }

      /*
       * GROUNDED_COLLECTION_OBSERVATION_V2_SOURCE_BACKED_CARDS
       *
       * Runtime repetition has no collection authority by itself. Card
       * candidates are considered only when authoritative frontend source
       * declares a direct array.map -> imported item-component collection
       * for the current grounded route and supplies its bounded semantic
       * runtime signature.
       *
       * The signature is source-specific. role=button + h3 is not a global
       * card heuristic; only the declared semantic structure participates.
       */
      const currentSurfacePath =
        window.location.pathname.length > 1 &&
        window.location.pathname.endsWith('/')
          ? window.location.pathname.slice(0, -1)
          : window.location.pathname;
      const currentCardDeclarations =
        sourceCardCollectionDeclarations.filter(
          (declaration) =>
            declaration &&
            declaration.authoritative === true &&
            declaration.surface &&
            declaration.surface.route ===
              currentSurfacePath
        );

      const sourceRefText = (ref) =>
        [
          normalize(ref?.file),
          Number(ref?.line || 0),
          normalize(ref?.symbol),
        ].join(':');

      if (
        currentCardDeclarations.length > 1 &&
        collections.length +
          collectionAbstentions.length <
          runtimeLimits.maxCollections
      ) {
        addCollectionAbstention(
          'CARD',
          'CARD_COLLECTION_AMBIGUOUS',
          null,
          [],
          0,
          'Multiple authoritative source card declarations compete for the current surface.'
        );
      }

      if (
        currentCardDeclarations.length === 1 &&
        collections.length +
          collectionAbstentions.length <
          runtimeLimits.maxCollections
      ) {
        const declaration =
          currentCardDeclarations[0];
        const signature =
          declaration.runtimeSignature;
        const sourceField =
          declaration.visibleFields.find(
            (field) =>
              field.kind ===
                'ITEM_HEADING' &&
              field.observationField ===
                'visibleItemName'
          );
        const supportedFieldSelectors =
          new Set([
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'p',
            'time',
            '[role="status"]',
          ]);
        const declaredCardFields =
          Array.isArray(
            declaration.cardFields
          )
            ? declaration.cardFields.filter(
                (field) =>
                  field &&
                  field.authoritative === true &&
                  field.runtimeLocator &&
                  field.runtimeLocator
                    .exactCount === 1 &&
                  supportedFieldSelectors.has(
                    field.runtimeLocator
                      .selector
                  )
              )
            : [];
        const roleSelector =
          '[role="' +
          signature.itemRole +
          '"]';
        const isStructurallyRendered = (
          element
        ) => {
          if (
            !(element instanceof HTMLElement)
          ) {
            return false;
          }

          const style =
            window.getComputedStyle(element);

          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };

        const matchesSourceCardItem = (
          element
        ) => {
          if (
            !isVisible(element) ||
            element.getAttribute('role') !==
              signature.itemRole ||
            (
              signature.focusable === true &&
              element.tabIndex < 0
            ) ||
            (
              signature.markerAttribute &&
              !element.hasAttribute(
                signature.markerAttribute
              )
            )
          ) {
            return false;
          }

          const headings = Array.from(
            element.querySelectorAll(
              signature.headingTag
            )
          ).filter(isVisible);
          const nestedActionButtons =
            Array.from(
              element.querySelectorAll(
                'button, [role="button"]'
              )
            ).filter(
              (button) =>
                button !== element &&
                isStructurallyRendered(
                  button
                )
            );

          return (
            headings.length ===
              signature.exactHeadingCount &&
            nestedActionButtons.length >=
              signature.minimumNestedActionButtons
          );
        };

        const matchingItems = scopedElements(
          roleSelector
        ).filter(matchesSourceCardItem);
        const candidateContainers = [
          ...new Set(
            matchingItems
              .map((item) =>
                item.parentElement
              )
              .filter(Boolean)
          ),
        ].filter((container) => {
          const visibleChildren =
            Array.from(
              container.children
            ).filter(isVisible);
          const matchingChildren =
            visibleChildren.filter(
              matchesSourceCardItem
            );

          return (
            matchingChildren.length >=
              runtimeLimits
                .minimumCardCollectionItems &&
            matchingChildren.length ===
              visibleChildren.length
          );
        });

        const identity = {
          method:
            'SOURCE_COMPONENT_COLLECTION',
          sourceText:
            declaration.surface.route,
          sourceRef:
            declaration.sourceRef,
          surfaceRoute:
            declaration.surface.route,
          collectionComponentRef:
            sourceRefText(
              declaration
                .collectionComponentRef
            ),
          itemComponentRef:
            sourceRefText(
              declaration.itemComponentRef
            ),
          ...(declaration.sourceCommitRef
            ? {
                sourceCommitRef:
                  declaration.sourceCommitRef,
              }
            : {}),
        };

        if (!sourceField) {
          addCollectionAbstention(
            'CARD',
            'CARD_ITEM_STRUCTURE_UNVERIFIED',
            identity,
            [],
            matchingItems.length,
            'The source declaration does not provide exactly one bounded visible item-heading field.'
          );
        } else if (
          matchingItems.length > 0 &&
          matchingItems.length <
            runtimeLimits
              .minimumCardCollectionItems
        ) {
          addCollectionAbstention(
            'CARD',
            'CARD_COLLECTION_EMPTY',
            identity,
            ['visibleItemName'],
            matchingItems.length,
            'The source-backed runtime collection has fewer visible items than the required comparison multiplicity.'
          );
        } else if (
          candidateContainers.length === 0
        ) {
          addCollectionAbstention(
            'CARD',
            matchingItems.length === 0
              ? 'CARD_ITEM_STRUCTURE_UNVERIFIED'
              : 'CARD_RUNTIME_CONTAINER_NOT_GROUNDED',
            identity,
            ['visibleItemName'],
            matchingItems.length,
            matchingItems.length === 0
              ? 'No visible runtime item matches the authoritative source-backed card signature.'
              : 'Matching card items do not share one explicit direct-child runtime container.'
          );
        } else if (
          candidateContainers.length > 1
        ) {
          addCollectionAbstention(
            'CARD',
            'CARD_COLLECTION_AMBIGUOUS',
            identity,
            ['visibleItemName'],
            matchingItems.length,
            'Multiple runtime containers satisfy the same authoritative source-backed card signature.'
          );
        } else {
          const runtimeContainer =
            candidateContainers[0];
          const detectedItems = Array.from(
            runtimeContainer.children
          ).filter(
            matchesSourceCardItem
          );
          const observedElements =
            detectedItems.slice(
              0,
              runtimeLimits.maxCollectionRows
            );
          const items = observedElements.map(
            (item, sequencePosition) => {
              const heading = Array.from(
                item.querySelectorAll(
                  signature.headingTag
                )
              ).filter(isVisible)[0];
              const visibleItemName =
                normalize(
                  heading instanceof
                    HTMLElement
                    ? heading.innerText
                    : heading?.textContent
                );
              const identityAttributes = [
                {
                  attribute:
                    'data-entity-id',
                  method:
                    'DATA_ENTITY_ID',
                },
                {
                  attribute: 'data-id',
                  method: 'DATA_ID',
                },
                {
                  attribute: 'data-key',
                  method: 'DATA_KEY',
                },
              ]
                .map((candidate) => ({
                  ...candidate,
                  sourceText: normalize(
                    item.getAttribute(
                      candidate.attribute
                    )
                  ),
                }))
                .filter(
                  (candidate) =>
                    candidate.sourceText
                );
              const durableItemIdentity =
                identityAttributes.length === 1
                  ? {
                      method:
                        identityAttributes[0]
                          .method,
                      sourceText:
                        identityAttributes[0]
                          .sourceText,
                    }
                  : null;
              const controls = Array.from(
                item.querySelectorAll(
                  'button, [role="button"]'
                )
              )
                .filter(
                  (control) =>
                    control !== item &&
                    isVisible(control)
                )
                .map((control) => ({
                  kind: 'ACTION',
                  role: 'button',
                  label: elementLabel(control),
                }))
                .filter((control) =>
                  control.label
                )
                .slice(
                  0,
                  runtimeLimits
                    .maxCollectionFields
                );
              const groundedFields =
                declaredCardFields
                  .map((field) => {
                    const matches =
                      Array.from(
                        item.querySelectorAll(
                          field.runtimeLocator
                            .selector
                        )
                      ).filter(isVisible);

                    if (matches.length !== 1) {
                      return null;
                    }

                    const match = matches[0];
                    const rawValue = normalize(
                      match instanceof
                        HTMLElement
                        ? match.innerText
                        : match.textContent
                    );

                    if (!rawValue) return null;
                    const sourceFields =
                      Array.isArray(
                        field.sourceFields
                      )
                        ? field.sourceFields
                            .map((value) =>
                              normalize(value)
                            )
                            .filter(Boolean)
                        : [];
                    const sourceFieldName =
                      sourceFields.length === 1
                        ? sourceFields[0]
                            .split('.')
                            .slice(-1)[0]
                        : '';

                    return {
                      field:
                        field.observationField,
                      visibleFieldId:
                        field.fieldId,
                      rawValue,
                      ...(sourceFieldName
                        ? {
                            sourceField:
                              sourceFieldName,
                          }
                        : {}),
                      sourceFields,
                      mappingKind: field.kind,
                      valueKind:
                        field.valueKind,
                      provenance: {
                        method:
                          field.observationField ===
                            'visibleItemName'
                            ? 'SOURCE_BACKED_H3'
                            : 'SOURCE_BACKED_CARD_FIELD',
                        sourceExpression:
                          field.sourceExpression,
                        sourceRef:
                          field.sourceRef,
                        ...(field.sourceCommitRef
                          ? {
                              sourceCommitRef:
                                field.sourceCommitRef,
                            }
                          : {}),
                      },
                    };
                  })
                  .filter(Boolean)
                  .slice(
                    0,
                    runtimeLimits
                      .maxCollectionFields
                  );
              const hasDeclaredTitle =
                groundedFields.some(
                  (field) =>
                    field.field ===
                      'visibleItemName'
                );

              if (!hasDeclaredTitle) {
                groundedFields.unshift({
                  field: 'visibleItemName',
                  rawValue: visibleItemName,
                  provenance: {
                    method:
                      'SOURCE_BACKED_H3',
                    sourceExpression:
                      sourceField
                        .sourceExpression,
                    sourceRef:
                      sourceField.sourceRef,
                  },
                });
              }

              return {
                sequencePosition,
                itemSequenceObserved: true,
                visibleItemName,
                ...(durableItemIdentity
                  ? {
                      durableItemId:
                        durableItemIdentity
                          .method +
                        ':' +
                        durableItemIdentity
                          .sourceText,
                      durableItemIdentity,
                      durableItemIdentityStatus:
                        'GROUNDED',
                    }
                  : {
                      durableItemIdentityStatus:
                        'UNAVAILABLE',
                      durableItemIdentityReason:
                        'CARD_ITEM_IDENTITY_UNAVAILABLE',
                    }),
                fields: groundedFields,
                controls,
                provenance: {
                  method:
                    'SOURCE_COMPONENT_ITEM',
                  itemComponentRef:
                    sourceRefText(
                      declaration
                        .itemComponentRef
                    ),
                },
              };
            }
          );
          const durableIdentityCounts =
            new Map();

          for (const item of items) {
            if (!item.durableItemId) {
              continue;
            }

            durableIdentityCounts.set(
              item.durableItemId,
              (
                durableIdentityCounts.get(
                  item.durableItemId
                ) || 0
              ) + 1
            );
          }

          for (const item of items) {
            if (
              item.durableItemId &&
              durableIdentityCounts.get(
                item.durableItemId
              ) > 1
            ) {
              delete item.durableItemId;
              delete item.durableItemIdentity;
              item.durableItemIdentityStatus =
                'UNAVAILABLE';
              item.durableItemIdentityReason =
                'CARD_ITEM_IDENTITY_UNAVAILABLE';
            }
          }

          const paginationControls = [];

          if (declaration.pagination) {
            const paginationCandidates =
              scopedElements(
                'button, [role="button"]'
              )
                .filter(isVisible)
                .map((control) => ({
                  control,
                  label: elementLabel(control),
                }));

            for (const kind of [
              'PREVIOUS',
              'NEXT',
            ]) {
              const expected =
                kind === 'PREVIOUS'
                  ? 'previous page'
                  : 'next page';
              const matches =
                paginationCandidates.filter(
                  (candidate) =>
                    candidate.label
                      .toLowerCase() ===
                    expected
                );

              if (matches.length === 1) {
                paginationControls.push({
                  kind,
                  role: 'button',
                  label: matches[0].label,
                  sourceRef:
                    declaration.pagination
                      .sourceRef,
                });
              }
            }
          }

          const collectionId = [
            'collection',
            'card',
            'source-component-collection',
            identityKey(
              declaration.surface.route +
              ':' +
              declaration.sourceRef
            ),
          ].join(':');
          const cardFieldSchema =
            declaredCardFields
              .map((field) => {
                const sourceFields =
                  Array.isArray(
                    field.sourceFields
                  )
                    ? field.sourceFields
                        .map((value) =>
                          normalize(value)
                        )
                        .filter(Boolean)
                    : [];

                if (sourceFields.length !== 1) {
                  return null;
                }

                return {
                  visibleFieldId:
                    field.fieldId,
                  observationField:
                    field.observationField,
                  sourceField:
                    sourceFields[0]
                      .split('.')
                      .slice(-1)[0],
                  sourceFields,
                  mappingKind: field.kind,
                  valueKind:
                    field.valueKind,
                  sourceExpression:
                    field.sourceExpression,
                  sourceRef:
                    field.sourceRef,
                  ...(field.sourceCommitRef
                    ? {
                        sourceCommitRef:
                          field.sourceCommitRef,
                      }
                    : {}),
                };
              })
              .filter(Boolean)
              .slice(
                0,
                runtimeLimits
                  .maxCollectionFields
              );

          collections.push({
            collectionId,
            shape: 'CARD',
            label:
              declaration.surface.route,
            identity,
            fields: [],
            rows: [],
            items,
            ...(cardFieldSchema.length > 0
              ? { cardFieldSchema }
              : {}),
            ...(paginationControls.length > 0
              ? { paginationControls }
              : {}),
            ...(declaration.sourceItemKey
              ? {
                  sourceItemKey: {
                    expression:
                      declaration
                        .sourceItemKey
                        .expression,
                    available: true,
                    runtimeCorrespondence:
                      false,
                  },
                }
              : {}),
            provenance: {
              method:
                'SOURCE_COMPONENT_CARD',
              rowSequenceObserved: false,
              itemSequenceObserved: true,
              itemsTruncated:
                detectedItems.length >
                runtimeLimits
                  .maxCollectionRows,
            },
          });
        }
      }

      const visibleTextRoots =
        activeSurfaceRoot
          ? observationRoots
          : primarySurface
            ? [primarySurface]
            : [];

      const visibleText =
        uniqueStrings(
          visibleTextRoots.flatMap(
            (root) =>
              Array.from(
                root.querySelectorAll(
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
                )
          ),
          runtimeLimits.maxVisibleText
        );

      return {
        headings,
        controls,
        inputs,
        surfaces,
        collections,
        collectionAbstentions,
        visibleText,
      };
    })()
  `;

  const snapshot =
    await page.evaluate(
      browserProgram
    ) as BrowserObservationSnapshot;

  const preparedControls =
    snapshot.controls.map(
      (snapshotControl) => {
        const {
          contextAncestors,
          controlledSurface,
          ...serializableControl
        } = snapshotControl;

        const control:
          BrowserObservationControl =
            serializableControl;

        /*
         * Runtime-only capability metadata must not alter the serialized
         * shadow observation/model input or archived artifact shape.
         */
        if (controlledSurface) {
          Object.defineProperty(
            control,
            "controlledSurface",
            {
              value:
                controlledSurface,
              enumerable: false,
              writable: false,
              configurable: false,
            }
          );
        }

        return {
          control,
          labelKey:
            control.label
              .toLowerCase(),
          contextCandidates:
            deriveBrowserObservationContextCandidates(
              contextAncestors,
              control.label
            ),
        };
      }
    );
  const labelCounts = new Map<
    string,
    number
  >();
  const contextCounts = new Map<
    string,
    number
  >();

  for (const item of preparedControls) {
    labelCounts.set(
      item.labelKey,
      (labelCounts.get(item.labelKey) ??
        0) + 1
    );

    /*
     * Context candidates are ordered from nearest to farther
     * semantic ancestors.
     *
     * Compare uniqueness at the same candidate rank. A farther
     * ancestor from one duplicate control must not invalidate a
     * nearer, more specific context belonging to another control.
     */
    for (
      const [
        candidateIndex,
        contextText,
      ] of item.contextCandidates.entries()
    ) {
      const contextKey =
        `${item.labelKey}|` +
        `${candidateIndex}|` +
        contextText.toLowerCase();

      contextCounts.set(
        contextKey,
        (contextCounts.get(contextKey) ??
          0) + 1
      );
    }
  }

  const controls = preparedControls.map(
    (item) => {
      if (
        labelCounts.get(item.labelKey) ===
          1
      ) {
        return item.control;
      }

      /*
       * The nearest candidate may still be shared by several
       * repeated controls, for example a common option-row wrapper.
       *
       * Walk the already bounded semantic ancestor candidates and
       * choose the nearest one that uniquely identifies this exact
       * label. If none is unique, preserve the existing fail-safe
       * ambiguity behavior.
       */
      const contextText =
        item.contextCandidates.find(
          (
            candidate,
            candidateIndex
          ) =>
            contextCounts.get(
              `${item.labelKey}|` +
                `${candidateIndex}|` +
                candidate.toLowerCase()
            ) === 1
        );

      if (!contextText) {
        return item.control;
      }

      return {
        ...item.control,
        contextText,
      };
    }
  );

  const title = await page
    .title()
    .catch(() => "");

  return {
    url: page.url(),
    title,
    ...snapshot,
    controls,
    counts: {
      headings: snapshot.headings.length,
      controls: controls.length,
      inputs: snapshot.inputs.length,
      surfaces: snapshot.surfaces.length,
      collections:
        snapshot.collections?.length ?? 0,
      collectionAbstentions:
        snapshot.collectionAbstentions
          ?.length ?? 0,
      visibleText:
        snapshot.visibleText.length,
    },
  };
}
