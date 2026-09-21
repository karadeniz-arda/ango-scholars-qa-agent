import {
  browserMutationsAllowed,
} from "./browser-mutation-policy.js";

import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";
import type {
  Locator,
  Page,
} from "playwright";

import {
  BROWSER_ACTIVE_MODAL_SELECTOR,
  BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS,
  BROWSER_SEMANTIC_DESCENDANT_LABEL_ATTRIBUTES,
  observeBrowserPage,
  type BrowserObservation,
  type BrowserObservationInput,
} from "./browser-observation.js";
import {
  resolveReadOnlyContextualControl,
} from "./browser-expanded-surface-interaction.js";
import {
  visibleRuntimeFilterSurfaceSignatures,
} from "./runtime-filter-dimension.js";
import {
  fingerprintPaginationCollection,
  groundPaginationSurface,
} from "./browser-pagination-capability.js";

import type {
  BrowserShadowProposal,
} from "./browser-agent-shadow.js";

import type {
  BrowserShadowProposalEvaluation,
} from "./browser-agent-shadow-evaluator.js";

export type BrowserReadOnlyExecutionStatus =
  | "SKIPPED"
  | "BLOCKED"
  | "EXECUTED"
  | "VERIFICATION_FAILED"
  | "ERROR";

export type BrowserReadOnlyExecutionResult = {
  status: BrowserReadOnlyExecutionStatus;
  note: string;
  executed: boolean;
  stateChanged: boolean;
  beforeObservation?: BrowserObservation;
  afterObservation?: BrowserObservation;
};

export type ExecuteBrowserReadOnlyProposalArgs = {
  page: Page;
  proposal: BrowserShadowProposal;
  evaluation: BrowserShadowProposalEvaluation;
};

function readOnlyExecutionEnabled():
  boolean {
  return (
    process.env
      .QA_GENERIC_BROWSER_READONLY_EXECUTION ===
    "true"
  );
}

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function exactLabelPattern(
  value: string
): RegExp {
  return new RegExp(
    `^\\s*${escapeRegExp(
      value.trim()
    )}\\s*$`,
    "i"
  );
}

function observationFingerprint(
  observation: BrowserObservation
): string {
  return JSON.stringify({
    url: observation.url,
    title: observation.title,
    headings:
      observation.headings,
    controls:
      observation.controls.map(
        (control) => ({
          kind: control.kind,
          label: control.label,
          disabled:
            control.disabled,
          selected:
            control.selected,
          expanded:
            control.expanded,
          checked:
            control.checked,
          href:
            control.href || "",
        })
      ),
    surfaces:
      observation.surfaces.map(
        (surface) => ({
          kind: surface.kind,
          label: surface.label,
          modal: surface.modal,
          textPreview:
            surface.textPreview,
        })
      ),
    visibleText:
      observation.visibleText,
  });
}

function observationsDiffer(
  before: BrowserObservation,
  after: BrowserObservation
): boolean {
  return (
    observationFingerprint(before) !==
    observationFingerprint(after)
  );
}

/*
 * GENERIC_BROWSER_COLLECTION_REFRESH_VERIFICATION_V1
 *
 * A collection control may expose its new page state before its live rows or
 * cards finish refreshing. Keep observing only when both snapshots ground the
 * same collection and prove that explicit page state changed while the
 * collection fingerprint is still the pre-action value.
 *
 * This does not make page text sufficient for success. If content never
 * changes, the latest unchanged collection is returned and downstream
 * capability recognition continues to abstain.
 */
function collectionRefreshPending(
  before: BrowserObservation,
  after: BrowserObservation
): boolean {
  const beforeSurface =
    groundPaginationSurface(
      before,
      { requireEnabledNext: false }
    );
  const afterSurface =
    groundPaginationSurface(
      after,
      { requireEnabledNext: false }
    );

  if (
    "reason" in beforeSurface ||
    "reason" in afterSurface ||
    beforeSurface.collection.collectionId !==
      afterSurface.collection.collectionId ||
    beforeSurface.page.currentPage ===
      afterSurface.page.currentPage
  ) {
    return false;
  }

  return (
    fingerprintPaginationCollection(
      beforeSurface.collection
    ) ===
    fingerprintPaginationCollection(
      afterSurface.collection
    )
  );
}

function runtimeSurfaceVerificationKey(
  signature: string
): string {
  const parts =
    String(signature || "")
      .split("|");

  if (parts.length < 7) {
    return signature;
  }

  return [
    parts[0],
    parts[1],
    ...parts.slice(6),
  ].join("|");
}

function surfaceDebugEnabled(): boolean {
  return (
    process.env
      .QA_GENERIC_BROWSER_SURFACE_DEBUG ===
    "true"
  );
}

async function captureBrowserSurfaceDebug(
  page: Page
): Promise<unknown> {
  /*
   * Keep the browser-side diagnostic program as a raw string.
   * tsx/esbuild may otherwise inject Node-side helpers such as
   * __name into a serialized page.evaluate callback.
   */
  const browserProgram = `
    (() => {
      const activeModalSelector =
        ${JSON.stringify(
          BROWSER_ACTIVE_MODAL_SELECTOR
        )};

      const verifierSelectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[data-state="open"]',
        '[data-radix-menu-content]',
        '[data-radix-popper-content-wrapper]',
        '[class*="popover"]',
        '[class*="Popover"]',
        '[class*="dropdown"]',
        '[class*="Dropdown"]',
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
      ];

      const observerExternalSelectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[data-state="open"]',
        '[data-radix-menu-content]',
        '[data-radix-popper-content-wrapper]',
        '[class*="popover"]',
        '[class*="Popover"]',
        '[class*="dropdown"]',
        '[class*="Dropdown"]',
      ];

      const basicVisible = (element) => {
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

      const runtimeVisible = (element) => {
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
          Number(style.opacity) !== 0 &&
          rect.width >= 10 &&
          rect.height >= 10 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth
        );
      };

      const normalizeText = (
        value,
        limit = 300
      ) =>
        String(value ?? "")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, limit);

      const activeModals =
        Array.from(
          document.querySelectorAll(
            activeModalSelector
          )
        ).filter(basicVisible);

      const activeModal =
        activeModals.length === 1
          ? activeModals[0]
          : null;

      const owners =
        activeModal
          ? Array.from(
              activeModal.querySelectorAll(
                '[aria-controls], [aria-owns]'
              )
            ).filter(basicVisible)
          : [];

      const eligibleOwners =
        owners.filter((owner) => {
          const expanded =
            owner.getAttribute(
              "aria-expanded"
            );

          const hasPopup =
            normalizeText(
              owner.getAttribute(
                "aria-haspopup"
              )
            ).toLowerCase();

          if (expanded === "false") {
            return false;
          }

          return (
            expanded === "true" ||
            [
              "dialog",
              "grid",
              "listbox",
              "menu",
              "tree",
            ].includes(hasPopup)
          );
        });

      const referencedIds =
        new Set();

      for (const owner of eligibleOwners) {
        for (const attribute of [
          "aria-controls",
          "aria-owns",
        ]) {
          const value =
            owner.getAttribute(attribute);

          for (
            const id of String(value || "")
              .split(/\\s+/)
              .filter(Boolean)
          ) {
            referencedIds.add(id);
          }
        }
      }

      const ownerRecords =
        owners.map((owner) => ({
          tag:
            owner.tagName.toLowerCase(),
          role:
            owner.getAttribute("role"),
          ariaExpanded:
            owner.getAttribute(
              "aria-expanded"
            ),
          ariaHasPopup:
            owner.getAttribute(
              "aria-haspopup"
            ),
          ariaControls:
            owner.getAttribute(
              "aria-controls"
            ),
          ariaOwns:
            owner.getAttribute(
              "aria-owns"
            ),
          eligibleForAssociation:
            eligibleOwners.includes(owner),
          text:
            normalizeText(
              owner instanceof HTMLElement
                ? owner.innerText
                : owner.textContent,
              180
            ),
        }));

      const describeElement = (
        element,
        index,
        candidateElements
      ) => {
        const rect =
          element.getBoundingClientRect();

        const matchedByVerifier =
          verifierSelectors.filter(
            (selector) =>
              element.matches(selector)
          );

        const matchedByObserverExternal =
          observerExternalSelectors.filter(
            (selector) =>
              element.matches(selector)
          );

        const optionLike =
          Array.from(
            element.querySelectorAll(
              [
                '[role="option"]',
                '[role="menuitem"]',
                '[role="menuitemradio"]',
                '[role="menuitemcheckbox"]',
                "li",
                "button",
              ].join(", ")
            )
          )
            .filter(basicVisible)
            .slice(0, 20)
            .map((child) => ({
              tag:
                child.tagName.toLowerCase(),
              role:
                child.getAttribute("role"),
              text:
                normalizeText(
                  child instanceof HTMLElement
                    ? child.innerText
                    : child.textContent,
                  120
                ),
            }))
            .filter(
              (child) => Boolean(child.text)
            );

        const ancestorCandidateIndexes =
          candidateElements
            .map((candidate, candidateIndex) =>
              candidate !== element &&
              candidate.contains(element)
                ? candidateIndex
                : -1
            )
            .filter(
              (candidateIndex) =>
                candidateIndex >= 0
            );

        const descendantCandidateIndexes =
          candidateElements
            .map((candidate, candidateIndex) =>
              candidate !== element &&
              element.contains(candidate)
                ? candidateIndex
                : -1
            )
            .filter(
              (candidateIndex) =>
                candidateIndex >= 0
            );

        return {
          index,
          tag:
            element.tagName.toLowerCase(),
          id:
            element.getAttribute("id"),
          className:
            normalizeText(
              element.getAttribute(
                "class"
              ),
              260
            ),
          role:
            element.getAttribute("role"),
          dataState:
            element.getAttribute(
              "data-state"
            ),
          ariaExpanded:
            element.getAttribute(
              "aria-expanded"
            ),
          ariaHasPopup:
            element.getAttribute(
              "aria-haspopup"
            ),
          ariaControls:
            element.getAttribute(
              "aria-controls"
            ),
          ariaOwns:
            element.getAttribute(
              "aria-owns"
            ),
          basicVisible:
            basicVisible(element),
          runtimeVisible:
            runtimeVisible(element),
          insideActiveModal:
            activeModal
              ? activeModal.contains(element)
              : null,
          referencedByModalOwner:
            Boolean(
              element.id &&
              referencedIds.has(
                element.id
              )
            ),
          matchedByVerifier,
          matchedByObserverExternal,
          ancestorCandidateIndexes,
          descendantCandidateIndexes,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width:
              Math.round(rect.width),
            height:
              Math.round(rect.height),
          },
          text:
            normalizeText(
              element instanceof HTMLElement
                ? element.innerText
                : element.textContent
            ),
          optionLike,
          outerHTML:
            normalizeText(
              element.outerHTML,
              600
            ),
        };
      };

      const verifierElements =
        Array.from(
          document.querySelectorAll(
            verifierSelectors.join(", ")
          )
        ).filter(runtimeVisible);

      const verifierCandidates =
        verifierElements
          .slice(0, 30)
          .map(
            (element, index) =>
              describeElement(
                element,
                index,
                verifierElements
              )
          );

      /*
       * Mirror the observer's unassociated-popup fallback directly,
       * rather than deriving it from the broader verifier set.
       */
      const externalElements =
        activeModal
          ? Array.from(
              document.querySelectorAll(
                observerExternalSelectors
                  .join(", ")
              )
            ).filter(
              (element) =>
                basicVisible(element) &&
                !activeModal.contains(
                  element
                )
            )
          : [];

      const externalCandidates =
        externalElements
          .slice(0, 30)
          .map(
            (element, index) =>
              describeElement(
                element,
                index,
                externalElements
              )
          );

      const explicitAssociatedElements =
        activeModal
          ? Array.from(referencedIds)
              .map((id) =>
                document.getElementById(id)
              )
              .filter(
                (element) =>
                  element &&
                  basicVisible(element) &&
                  !activeModal.contains(
                    element
                  )
              )
          : [];

      const explicitAssociated =
        explicitAssociatedElements.map(
          (element, index) =>
            describeElement(
              element,
              index,
              explicitAssociatedElements
            )
        );

      const topLevelExternalIndexes =
        externalCandidates
          .filter(
            (candidate) =>
              candidate
                .ancestorCandidateIndexes
                .length === 0
          )
          .map(
            (candidate) =>
              candidate.index
          );

      const leafExternalIndexes =
        externalCandidates
          .filter(
            (candidate) =>
              candidate
                .descendantCandidateIndexes
                .length === 0
          )
          .map(
            (candidate) =>
              candidate.index
          );

      const inferredAdmission =
        explicitAssociated.length > 0
          ? {
              mode:
                "explicit-associated",
              candidateIndexes:
                explicitAssociated.map(
                  (candidate) =>
                    candidate.index
                ),
            }
          : externalCandidates.length === 1
            ? {
                mode:
                  "sole-external",
                candidateIndexes: [0],
              }
            : externalCandidates.length > 1
              ? {
                  mode:
                    "ambiguous-external",
                candidateIndexes: [],
              }
              : {
                  mode:
                    "no-external-candidate",
                  candidateIndexes: [],
                };

      /*
       * GENERIC_BROWSER_SURFACE_ITEM_DEBUG_V1
       *
       * Diagnostic-only inspection of short semantic text nodes
       * inside accessible tooltip surfaces. This does not promote,
       * rank, or authorize any element for interaction.
       */
      const tooltipSemanticItems = [];

      for (
        const tooltip
        of Array.from(
          document.querySelectorAll(
            '[role="tooltip"]'
          )
        )
          .filter(basicVisible)
          .slice(0, 5)
      ) {
        const descendants = [
          tooltip,
          ...Array.from(
            tooltip.querySelectorAll("*")
          ),
        ].slice(0, 120);

        for (const element of descendants) {
          if (
            !(element instanceof HTMLElement) ||
            !basicVisible(element)
          ) {
            continue;
          }

          const ownText =
            normalizeText(
              Array.from(
                element.childNodes
              )
                .filter(
                  (node) =>
                    node.nodeType ===
                    Node.TEXT_NODE
                )
                .map(
                  (node) =>
                    node.textContent || ""
                )
                .join(" "),
              120
            );

          if (!ownText) {
            continue;
          }

          const ancestors = [];
          let current = element;

          for (
            let depth = 0;
            current &&
            depth <= 5 &&
            tooltip.contains(current);
            depth += 1
          ) {
            const style =
              window.getComputedStyle(
                current
              );

            ancestors.push({
              depth,
              tag:
                current.tagName
                  .toLowerCase(),
              role:
                current.getAttribute(
                  "role"
                ),
              tabIndex:
                current.getAttribute(
                  "tabindex"
                ),
              ariaHasPopup:
                current.getAttribute(
                  "aria-haspopup"
                ),
              ariaControls:
                current.getAttribute(
                  "aria-controls"
                ),
              ariaExpanded:
                current.getAttribute(
                  "aria-expanded"
                ),
              ariaDisabled:
                current.getAttribute(
                  "aria-disabled"
                ),
              dataState:
                current.getAttribute(
                  "data-state"
                ),
              dataSlot:
                current.getAttribute(
                  "data-slot"
                ),
              cursor:
                style.cursor,
              pointerEvents:
                style.pointerEvents,
              hasInlineOnClick:
                current.hasAttribute(
                  "onclick"
                ),
              className:
                normalizeText(
                  current.getAttribute(
                    "class"
                  ),
                  180
                ),
            });

            if (current === tooltip) {
              break;
            }

            current =
              current.parentElement;
          }

          tooltipSemanticItems.push({
            text: ownText,
            tag:
              element.tagName
                .toLowerCase(),
            role:
              element.getAttribute(
                "role"
              ),
            ancestors,
          });

          if (
            tooltipSemanticItems.length >=
            40
          ) {
            break;
          }
        }

        if (
          tooltipSemanticItems.length >=
          40
        ) {
          break;
        }
      }

      return {
        tooltipSemanticItems,
        activeModalCount:
          activeModals.length,
        activeModalPreview:
          activeModal
            ? normalizeText(
                activeModal instanceof
                  HTMLElement
                  ? activeModal.innerText
                  : activeModal.textContent
              )
            : "",
        ownerRecords,
        referencedIds:
          Array.from(referencedIds),
        verifierCandidateCount:
          verifierCandidates.length,
        verifierCandidates,
        externalObserverCandidateCount:
          externalCandidates.length,
        externalCandidates,
        topLevelExternalIndexes,
        leafExternalIndexes,
        explicitAssociatedCount:
          explicitAssociated.length,
        explicitAssociated,
        inferredAdmission,
      };
    })()
  `;

  return page
    .evaluate(browserProgram)
    .catch((error: unknown) => ({
      debugError:
        error instanceof Error
          ? error.message
          : String(error),
    }));
}

async function logSurfaceDebugSnapshot(
  args: {
    page: Page;
    interactionId: string;
    phase: string;
    runtimeSignatures: string[];
    beforeRuntimeSurfaceKeys?: string[];
    observation: BrowserObservation;
  }
): Promise<void> {
  if (!surfaceDebugEnabled()) {
    return;
  }

  const runtimeKeys =
    args.runtimeSignatures.map(
      runtimeSurfaceVerificationKey
    );

  const beforeKeys =
    args.beforeRuntimeSurfaceKeys || [];

  const addedRuntimeKeys =
    beforeKeys.length > 0
      ? runtimeKeys.filter(
          (key) =>
            !beforeKeys.includes(key)
        )
      : [];

  const removedRuntimeKeys =
    beforeKeys.length > 0
      ? beforeKeys.filter(
          (key) =>
            !runtimeKeys.includes(key)
        )
      : [];

  const dom =
    await captureBrowserSurfaceDebug(
      args.page
    );

  console.log(
    ` [SURFACE_DEBUG ${args.interactionId}] ` +
      `${args.phase} ` +
      JSON.stringify({
        runtimeSignatures:
          args.runtimeSignatures,
        runtimeKeys,
        addedRuntimeKeys,
        removedRuntimeKeys,
        observation: {
          counts:
            args.observation.counts,
          surfaces:
            args.observation.surfaces,
          inputs:
            args.observation.inputs,
        },
        dom,
      })
  );
}

function buildRoleCandidates(
  page: Page,
  kind: string,
  target: string
): Locator[] {
  const name =
    exactLabelPattern(target);

  if (kind === "button") {
    return [
      page.getByRole(
        "button",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "link") {
    return [
      page.getByRole(
        "link",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "tab") {
    return [
      page.getByRole(
        "tab",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "menuitem") {
    return [
      page.getByRole(
        "menuitem",
        {
          name,
        }
      ),
    ];
  }

  if (
    kind === "option"
  ) {
    return [];
  }

  return [
    page.getByRole(
      "button",
      {
        name,
      }
    ),
    page.getByRole(
      "link",
      {
        name,
      }
    ),
    page.getByRole(
      "tab",
      {
        name,
      }
    ),
    page.getByRole(
      "menuitem",
      {
        name,
      }
    ),
  ];
}

async function collectVisibleCandidates(
  candidates: Locator[]
): Promise<Locator[]> {
  const visible: Locator[] = [];

  for (const candidate of candidates) {
    const count =
      Math.min(
        await candidate
          .count()
          .catch(() => 0),
        10
      );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const locator =
        candidate.nth(index);

      const isVisible =
        await locator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (isVisible) {
        visible.push(locator);
      }
    }
  }

  return visible;
}

/*
 * GENERIC_BROWSER_SEMANTIC_OPTION_EXECUTION_V1
 *
 * Re-resolve a previously grounded semantic option binding against
 * the live DOM immediately before execution.
 *
 * A geometrically hidden role=option node is identity/state only.
 * Its direct structural host may expose a separate visible pointer
 * row carrying the same exact semantic identity.
 *
 * Execution is eligible only when:
 * - exactly one hidden semantic identity matches the target inside
 *   a hidden role=listbox;
 * - exactly one visible pointer-eligible exact visual row exists in
 *   that listbox's direct structural host;
 * - nested same-identity pointer wrappers canonicalize to the most
 *   specific eligible item;
 * - no ordinary interactive control is being reclassified.
 *
 * nth() is used only to enumerate bounded candidates. No candidate
 * is selected because of DOM order. Zero or multiple exact live
 * bindings fail safe.
 */
async function collectSemanticOptionBindingCandidates(
  page: Page,
  target: string
): Promise<Locator[]> {
  const normalizedTarget =
    normalize(target);

  const listboxes =
    page.locator(
      '[role="listbox"]'
    );

  const listboxCount =
    Math.min(
      await listboxes
        .count()
        .catch(() => 0),
      20
    );

  const matches: Locator[] = [];

  for (
    let listboxIndex = 0;
    listboxIndex <
    listboxCount;
    listboxIndex += 1
  ) {
    const listbox =
      listboxes.nth(
        listboxIndex
      );

    const hiddenSemanticListbox =
      await listbox
        .evaluate((element) => {
          if (
            !(
              element instanceof
              HTMLElement
            )
          ) {
            return false;
          }

          const style =
            window.getComputedStyle(
              element
            );

          const rect =
            element
              .getBoundingClientRect();

          const visible =
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(
              style.opacity || "1"
            ) > 0 &&
            rect.width > 0 &&
            rect.height > 0;

          return !visible;
        })
        .catch(() => false);

    if (
      !hiddenSemanticListbox
    ) {
      continue;
    }

    const identities =
      listbox.getByRole(
        "option",
        {
          name:
            exactLabelPattern(
              target
            ),
        }
      );

    const identityCount =
      Math.min(
        await identities
          .count()
          .catch(() => 0),
        3
      );

    /*
     * Identity ambiguity fails before
     * visual binding is attempted.
     */
    if (
      identityCount !== 1
    ) {
      continue;
    }

    const identityDisabled =
      await identities
        .nth(0)
        .getAttribute(
          "aria-disabled"
        )
        .catch(() => null);

    if (
      identityDisabled ===
      "true"
    ) {
      continue;
    }

    /*
     * The hidden semantic listbox and
     * its visualized rows are siblings
     * inside one structural host.
     *
     * This is an ownership boundary,
     * not a DOM-order selection rule.
     */
    const optionHost =
      listbox.locator("..");

    const descendants =
      optionHost.locator("*");

    const descendantCount =
      Math.min(
        await descendants
          .count()
          .catch(() => 0),
        160
      );

    const hostMatches:
      Locator[] = [];

    for (
      let candidateIndex = 0;
      candidateIndex <
      descendantCount;
      candidateIndex += 1
    ) {
      const candidate =
        descendants.nth(
          candidateIndex
        );

      const eligible =
        await candidate
          .evaluate(
            (
              element,
              expectedTarget
            ) => {
              if (
                !(
                  element instanceof
                  HTMLElement
                )
              ) {
                return false;
              }

              /*
               * Anything inside a
               * role=listbox belongs to
               * the semantic identity
               * tree, not the visual
               * execution tree.
               */
              if (
                element.closest(
                  '[role="listbox"]'
                )
              ) {
                return false;
              }

              const style =
                window.getComputedStyle(
                  element
                );

              const rect =
                element
                  .getBoundingClientRect();

              const visible =
                style.display !==
                  "none" &&
                style.visibility !==
                  "hidden" &&
                Number(
                  style.opacity || "1"
                ) > 0 &&
                rect.width > 0 &&
                rect.height > 0;

              if (
                !visible ||
                style.cursor !==
                  "pointer" ||
                style.pointerEvents ===
                  "none" ||
                element.getAttribute(
                  "aria-disabled"
                ) === "true"
              ) {
                return false;
              }

              const ordinaryInteractive =
                [
                  "button",
                  "a[href]",
                  "summary",
                  "input:not([type='hidden'])",
                  "textarea",
                  "select",
                  '[role="button"]',
                  '[role="link"]',
                  '[role="tab"]',
                  '[role="menuitem"]',
                  '[role="option"]',
                  '[role="combobox"]',
                  '[contenteditable="true"]',
                  '[aria-controls]',
                ].join(", ");

              if (
                element.matches(
                  ordinaryInteractive
                ) ||
                element.closest(
                  ordinaryInteractive
                )
              ) {
                return false;
              }

              let labelledByText = "";

              const labelledBy =
                String(
                  element.getAttribute(
                    "aria-labelledby"
                  ) || ""
                )
                  .replace(/\s+/g, " ")
                  .trim();

              if (labelledBy) {
                const pieces = [];

                for (
                  const id of
                  labelledBy.split(
                    /\s+/
                  )
                ) {
                  const item =
                    document
                      .getElementById(
                        id
                      );

                  const value =
                    String(
                      item?.innerText ||
                      item
                        ?.textContent ||
                      ""
                    )
                      .replace(
                        /\s+/g,
                        " "
                      )
                      .trim();

                  if (value) {
                    pieces.push(
                      value
                    );
                  }
                }

                labelledByText =
                  pieces
                    .join(" ")
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim();
              }

              const metadataValues = [];

              for (
                const child of
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
                ).slice(0, 20)
              ) {
                for (
                  const attribute of [
                    "aria-label",
                    "title",
                    "data-testid",
                    "data-icon",
                    "data-lucide",
                  ]
                ) {
                  const value =
                    String(
                      child.getAttribute(
                        attribute
                      ) || ""
                    )
                      .replace(
                        /\s+/g,
                        " "
                      )
                      .trim();

                  if (value) {
                    metadataValues.push(
                      value
                    );
                  }
                }
              }

              const uniqueMetadata =
                new Map();

              for (
                const value of
                metadataValues
              ) {
                const key =
                  value.toLowerCase();

                if (
                  !uniqueMetadata.has(
                    key
                  )
                ) {
                  uniqueMetadata.set(
                    key,
                    value
                  );
                }
              }

              const descendantMetadata =
                uniqueMetadata.size === 1
                  ? Array.from(
                      uniqueMetadata
                        .values()
                    )[0] || ""
                  : "";

              const labelCandidates = [
                element.getAttribute(
                  "aria-label"
                ),
                labelledByText,
                element.getAttribute(
                  "title"
                ),
                element.getAttribute(
                  "data-placeholder"
                ),
                element.getAttribute(
                  "placeholder"
                ),
                element.innerText,
                element.textContent,
                descendantMetadata,
                element.getAttribute(
                  "name"
                ),
                element.getAttribute(
                  "id"
                ),
              ];

              let exactLabel = "";

              for (
                const value of
                labelCandidates
              ) {
                const normalized =
                  String(value || "")
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim()
                    .toLowerCase();

                if (normalized) {
                  exactLabel =
                    normalized;
                  break;
                }
              }

              if (
                exactLabel !==
                expectedTarget
              ) {
                return false;
              }

              /*
               * Reject a wrapper when
               * a more-specific visible
               * pointer descendant has
               * the same exact semantic
               * identity.
               */
              for (
                const descendant of
                Array.from(
                  element.querySelectorAll(
                    "*"
                  )
                )
              ) {
                if (
                  !(
                    descendant instanceof
                    HTMLElement
                  ) ||
                  descendant.closest(
                    '[role="listbox"]'
                  )
                ) {
                  continue;
                }

                const descendantStyle =
                  window.getComputedStyle(
                    descendant
                  );

                const descendantRect =
                  descendant
                    .getBoundingClientRect();

                const descendantVisible =
                  descendantStyle
                    .display !==
                    "none" &&
                  descendantStyle
                    .visibility !==
                    "hidden" &&
                  Number(
                    descendantStyle
                      .opacity ||
                    "1"
                  ) > 0 &&
                  descendantRect
                    .width > 0 &&
                  descendantRect
                    .height > 0;

                if (
                  !descendantVisible ||
                  descendantStyle
                    .cursor !==
                    "pointer" ||
                  descendantStyle
                    .pointerEvents ===
                    "none" ||
                  descendant.getAttribute(
                    "aria-disabled"
                  ) === "true" ||
                  descendant.matches(
                    ordinaryInteractive
                  ) ||
                  descendant.closest(
                    ordinaryInteractive
                  )
                ) {
                  continue;
                }

                const descendantLabel =
                  String(
                    descendant.getAttribute(
                      "aria-label"
                    ) ||
                    descendant
                      .innerText ||
                    descendant
                      .textContent ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim()
                    .toLowerCase();

                if (
                  descendantLabel ===
                  expectedTarget
                ) {
                  return false;
                }
              }

              return true;
            },
            normalizedTarget
          )
          .catch(() => false);

      if (eligible) {
        hostMatches.push(
          candidate
        );
      }
    }

    if (
      hostMatches.length === 1
    ) {
      matches.push(
        hostMatches[0]!
      );
    }
  }

  return matches;
}

function observationAlignedSelector(
  kind: string
): string | null {
  if (kind === "button") {
    return [
      "button",
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="reset"]',
      '[role="button"]',
    ].join(", ");
  }

  if (kind === "link") {
    return 'a[href], [role="link"]';
  }

  if (kind === "tab") {
    return '[role="tab"]';
  }

  if (kind === "menuitem") {
    return '[role="menuitem"]';
  }

  /*
   * GENERIC_BROWSER_ROLELESS_SURFACE_EXECUTION_V1
   *
   * A generic "control" may represent an exact-text leaf
   * interaction item admitted from an observed tooltip
   * surface. Candidate eligibility is re-verified against
   * the live DOM below before execution.
   */
  if (kind === "control") {
    return '[role="tooltip"] *';
  }

  return null;
}

async function collectObservationAlignedCandidates(
  page: Page,
  kind: string,
  target: string
): Promise<Locator[]> {
  const selector =
    observationAlignedSelector(
      kind
    );

  if (!selector) {
    return [];
  }

  const controls =
    page.locator(selector);

  /*
   * GENERIC_BROWSER_OBSERVER_EXECUTOR_CANDIDATE_PARITY_V1
   *
   * The observer bounds admitted semantic controls only after
   * visibility filtering. Do not truncate ordinary raw DOM
   * candidates before applying the same visibility/label gate.
   *
   * Roleless tooltip execution retains its dedicated bounded
   * resolver below; this change applies only to ordinary
   * observation-aligned semantic controls.
   */
  const rawCandidateCount =
    await controls
      .count()
      .catch(() => 0);

  const count =
    kind === "control"
      ? Math.min(
          rawCandidateCount,
          80
        )
      : rawCandidateCount;

  const normalizedTarget =
    normalize(target);

  const matches: Locator[] = [];

  let admittedVisibleSemanticControls =
    0;

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      controls.nth(index);

    if (kind === "control") {
      const eligibleRolelessSurfaceItem =
        await locator
          .evaluate(
            (
              element,
              expectedTarget
            ) => {
              if (
                !(
                  element instanceof
                  HTMLElement
                )
              ) {
                return false;
              }

              /*
               * GENERIC_BROWSER_ROLELESS_SURFACE_EXECUTION_SERIALIZATION_V1
               *
               * Keep browser-side normalization inline here.
               * A nested helper inside a serialized Playwright
               * evaluate callback may be rewritten by tsx/esbuild
               * with Node-side __name references that do not exist
               * in the browser context.
               */
              const tooltip =
                element.closest(
                  '[role="tooltip"]'
                );

              if (!tooltip) {
                return false;
              }

              const style =
                window.getComputedStyle(
                  element
                );

              const rect =
                element
                  .getBoundingClientRect();

              const visible =
                style.display !== "none" &&
                style.visibility !==
                  "hidden" &&
                Number(
                  style.opacity || "1"
                ) > 0 &&
                rect.width > 0 &&
                rect.height > 0;

              if (
                !visible ||
                style.cursor !==
                  "pointer" ||
                style.pointerEvents ===
                  "none" ||
                element.getAttribute(
                  "aria-disabled"
                ) === "true"
              ) {
                return false;
              }

              const ordinaryInteractive =
                [
                  "button",
                  "a[href]",
                  "summary",
                  "input:not([type='hidden'])",
                  "textarea",
                  "select",
                  '[role="button"]',
                  '[role="link"]',
                  '[role="tab"]',
                  '[role="menuitem"]',
                  '[role="option"]',
                  '[role="combobox"]',
                  '[contenteditable="true"]',
                  '[aria-controls]',
                ].join(", ");

              if (
                element.matches(
                  ordinaryInteractive
                ) ||
                element.closest(
                  ordinaryInteractive
                )
              ) {
                return false;
              }

              const exactText =
                String(
                  element.innerText ||
                  element.textContent ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();

              if (
                !exactText ||
                exactText !==
                  expectedTarget
              ) {
                return false;
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
                    )
                  ) {
                    return false;
                  }

                  if (
                    descendant.matches(
                      ordinaryInteractive
                    ) ||
                    descendant.closest(
                      ordinaryInteractive
                    )
                  ) {
                    return false;
                  }

                  const descendantStyle =
                    window.getComputedStyle(
                      descendant
                    );

                  const descendantRect =
                    descendant
                      .getBoundingClientRect();

                  const descendantVisible =
                    descendantStyle
                      .display !==
                      "none" &&
                    descendantStyle
                      .visibility !==
                      "hidden" &&
                    Number(
                      descendantStyle
                        .opacity ||
                      "1"
                    ) > 0 &&
                    descendantRect.width >
                      0 &&
                    descendantRect.height >
                      0;

                  if (
                    !descendantVisible ||
                    descendantStyle
                      .cursor !==
                      "pointer" ||
                    descendantStyle
                      .pointerEvents ===
                      "none" ||
                    descendant.getAttribute(
                      "aria-disabled"
                    ) === "true"
                  ) {
                    return false;
                  }

                  const descendantText =
                    String(
                      descendant.innerText ||
                      descendant.textContent ||
                      ""
                    )
                      .replace(/\s+/g, " ")
                      .trim()
                      .toLowerCase();

                  return (
                    descendantText ===
                    exactText
                  );
                });

              return (
                !hasMoreSpecificExactItem
              );
            },
            normalizedTarget
          )
          .catch(() => false);

      if (
        !eligibleRolelessSurfaceItem
      ) {
        continue;
      }

      /*
       * The dedicated roleless-surface resolver has already
       * re-established exact target identity and live-DOM
       * eligibility. Preserve that resolved locator directly
       * instead of passing it through the ordinary semantic
       * descriptor pipeline a second time.
       *
       * Independent duplicates remain separate matches and
       * therefore still fail safe below.
       */
      matches.push(locator);
      continue;
    }

    const descriptor =
      await locator
        .evaluate((
          element,
          semanticDescendantLabelAttributes
        ) => {
          /*
           * GENERIC_BROWSER_OBSERVATION_ALIGNED_EXECUTION_SERIALIZATION_V1
           *
           * Keep browser-side normalization inline. A nested named
           * helper inside a serialized Playwright evaluate callback
           * may be rewritten by tsx/esbuild with Node-side __name
           * references that do not exist in the browser context.
           */
          const labelledBy =
            String(
              element.getAttribute(
                "aria-labelledby"
              ) || ""
            )
              .replace(/\s+/g, " ")
              .trim();

          const labelledByText =
            labelledBy
              ? labelledBy
                  .split(/\s+/)
                  .map((id) =>
                    document
                      .getElementById(id)
                      ?.textContent ||
                    ""
                  )
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim()
              : "";

          let associatedLabelText = "";

          if (
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLTextAreaElement ||
            element instanceof
              HTMLSelectElement
          ) {
            associatedLabelText =
              Array.from(
                element.labels || []
              )
                .map((label) =>
                  label.textContent ||
                  ""
                )
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
          }

          if (!associatedLabelText) {
            associatedLabelText =
              String(
                element
                  .closest("label")
                  ?.textContent ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim();
          }

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
                    String(
                      child.getAttribute(
                        attribute
                      ) ?? ""
                    )
                      .replace(/\s+/g, " ")
                      .trim()
                  )
                  .filter(Boolean)
              );

          const uniqueDescendantMetadata =
            new Map<string, string>();

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

          const descendantMetadata =
            uniqueDescendantMetadata.size ===
            1
              ? Array.from(
                  uniqueDescendantMetadata.values()
                )[0]
              : "";

          const candidates = [
            element.getAttribute(
              "aria-label"
            ),
            labelledByText,
            associatedLabelText,
            element.getAttribute(
              "title"
            ),
            element.getAttribute(
              "data-placeholder"
            ),
            element.getAttribute(
              "placeholder"
            ),
            element instanceof
              HTMLElement
              ? element.innerText
              : "",
            element.textContent,
            descendantMetadata,
            element.getAttribute(
              "name"
            ),
            element.getAttribute(
              "id"
            ),
          ];

          const firstCandidate =
            candidates.find(
              (candidate) =>
                String(
                  candidate || ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .length > 0
            ) || "";

          const label =
            String(firstCandidate)
              .replace(/\s+/g, " ")
              .trim();

          const style =
            window.getComputedStyle(
              element
            );

          const rect =
            element
              .getBoundingClientRect();

          const visible =
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(
              style.opacity || "1"
            ) > 0 &&
            rect.width > 0 &&
            rect.height > 0;

          return {
            label,
            visible,
          };
        }, [
          ...BROWSER_SEMANTIC_DESCENDANT_LABEL_ATTRIBUTES,
        ])
        .catch(() => null);

    if (
      !descriptor?.visible ||
      !normalize(
        descriptor.label
      )
    ) {
      continue;
    }

    admittedVisibleSemanticControls +=
      1;

    if (
      normalize(
        descriptor.label
      ) === normalizedTarget
    ) {
      matches.push(locator);
    }

    /*
     * Mirror the observer's bounded admitted-control behavior.
     *
     * The bound is applied after visibility + semantic-label
     * admission, never to the raw DOM candidate prefix.
     */
    if (
      admittedVisibleSemanticControls >=
      BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS
    ) {
      break;
    }
  }

  return matches;
}

type ActivationInputSemanticIdentity = {
  role: string;
  type: string;
  placeholder: string;
  expanded: boolean | null;
  hasPopup: string;
  hasControls: boolean;
};

function activationInputSemanticIdentity(
  input: BrowserObservationInput
): ActivationInputSemanticIdentity {
  return {
    role: normalize(input.role),
    type: normalize(input.type),
    placeholder: String(
      input.placeholder ?? ""
    )
      .replace(/\s+/g, " ")
      .trim(),
    expanded: input.expanded,
    hasPopup: normalize(
      input.hasPopup
    ),
    hasControls:
      normalize(input.controls).length > 0,
  };
}

function supportsCollapsedListboxKeyboardActivation(
  identity:
    ActivationInputSemanticIdentity |
    undefined
): boolean {
  return (
    identity?.role === "combobox" &&
    identity.expanded === false &&
    identity.hasPopup === "listbox" &&
    identity.hasControls
  );
}

async function resolveLiveActivationInputsBySemanticIdentity(
  scope: Page | Locator,
  expected:
    ActivationInputSemanticIdentity
): Promise<{
  count: number;
  locator?: Locator;
}> {
  const typeSelector =
    expected.type === "select"
      ? "select"
      : expected.type === "textarea"
        ? "textarea"
        : expected.type ===
            "contenteditable"
          ? '[contenteditable="true"]'
          : expected.type === "text"
            ? ':is(input:not([type]), input[type="text"])'
            : `input[type=${JSON.stringify(expected.type)}]`;
  const placeholderSelector =
    expected.placeholder
      ? `[placeholder=${JSON.stringify(expected.placeholder)}]`
      : ':is(:not([placeholder]), [placeholder=""])';
  const expandedSelector =
    expected.expanded === null
      ? ":not([aria-expanded])"
      : `[aria-expanded="${expected.expanded}"]`;
  const popupSelector =
    expected.hasPopup
      ? `[aria-haspopup=${JSON.stringify(expected.hasPopup)}]`
      : ":not([aria-haspopup])";
  const controlsSelector =
    expected.hasControls
      ? "[aria-controls]"
      : ":not([aria-controls])";
  const semanticAttributes =
    scope.locator(
      `${typeSelector}` +
        `${placeholderSelector}` +
        `${expandedSelector}` +
        `${popupSelector}` +
        `${controlsSelector}` +
        ':not([disabled])' +
        ':not([aria-disabled="true"])'
    );
  const role = expected.role as
    Parameters<Page["getByRole"]>[0];
  const candidates =
    scope
      .getByRole(role)
      .and(semanticAttributes);
  const count =
    await candidates
      .count()
      .catch(() => 0);

  return count === 1
    ? {
        count,
        locator: candidates,
      }
    : { count };
}

async function resolveExactActivationInput(
  page: Page,
  target: string,
  expectedRole?: string
): Promise<{
  locator?: Locator;
  identity?:
    ActivationInputSemanticIdentity;
  note: string;
}> {
  const observation =
    await observeBrowserPage(page);
  const observedInputs =
    observation.inputs.filter(
      (input) =>
        normalize(input.label) ===
        normalize(target)
    );

  if (observedInputs.length !== 1) {
    return {
      note:
        `${observedInputs.length} exact inputs were visible in the active observation scope`,
    };
  }

  const observedInput =
    observedInputs[0]!;

  if (
    observedInput.disabled ||
    (
      expectedRole &&
      normalize(observedInput.role) !==
        normalize(expectedRole)
    )
  ) {
    return {
      note:
        "the exact observed input was disabled or not activation-safe",
    };
  }

  const liveInputSafetyClass =
    classifyGenericBrowserActionSafety({
      actionKind: "click",
      targetSource: "input",
      targetKind:
        observedInput.role,
      label: target,
      activationSafe:
        observedInput.activationSafe,
    });

  if (
    liveInputSafetyClass !==
    "TRANSIENT_REVEAL"
  ) {
    return {
      note:
        "the exact observed input was disabled or not activation-safe",
    };
  }

  const modalLocators =
    await page
      .locator(
        BROWSER_ACTIVE_MODAL_SELECTOR
      )
      .all();
  const visibleModals: Locator[] = [];

  for (const modal of modalLocators) {
    if (
      await modal
        .isVisible()
        .catch(() => false)
    ) {
      visibleModals.push(modal);
    }
  }

  if (visibleModals.length > 1) {
    return {
      note:
        "multiple active modal-like surfaces made input scope ambiguous",
    };
  }

  const scope: Page | Locator =
    visibleModals[0] ?? page;

  const identity =
    activationInputSemanticIdentity(
      observedInput
    );
  const liveResolution =
    await resolveLiveActivationInputsBySemanticIdentity(
      scope,
      identity
    );

  if (!liveResolution.locator) {
    return {
      note:
        `${liveResolution.count} live inputs matched the exact activation-safe semantic identity in the active observation scope`,
    };
  }

  return {
    locator: liveResolution.locator,
    identity,
    note:
      "resolved one exact enabled activation-safe input by observation-aligned semantic identity",
  };
}

async function executeExactControlClick(
  page: Page,
  proposal: BrowserShadowProposal,
  evaluation: BrowserShadowProposalEvaluation
): Promise<BrowserReadOnlyExecutionResult> {
  const action =
    proposal.action;

  const matchedTarget =
    evaluation.matchedTarget;

  if (
    !action ||
    action.kind !== "click" ||
    !matchedTarget ||
    (
      matchedTarget.source !==
        "control" &&
      matchedTarget.source !== "input"
    )
  ) {
    return {
      status: "BLOCKED",
      note:
        "Read-only click requires a grounded control evaluation.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    normalize(
      matchedTarget.label
    ) !==
    normalize(action.target)
  ) {
    return {
      status: "BLOCKED",
      note:
        "Proposal target and evaluated control label do not match exactly.",
      executed: false,
      stateChanged: false,
    };
  }

  /*
   * GENERIC_BROWSER_DETERMINISTIC_SAFETY_EXECUTOR_V1
   *
   * Re-classify the grounded target independently from evaluator
   * authorization.
   *
   * The evaluator may recommend execution, but the executor remains
   * an independent deterministic safety boundary.
   *
   * Inputs are classified from a fresh live observation inside
   * resolveExactActivationInput().
   */
  const controlSafetyClass =
    matchedTarget.source === "control"
      ? classifyGenericBrowserActionSafety({
          actionKind: action.kind,
          targetSource: "control",
          label: action.target,
          ...(
            matchedTarget.kind !==
            undefined
              ? {
                  targetKind:
                    matchedTarget.kind,
                }
              : {}
          ),
          ...(
            matchedTarget.externalPopup !==
            undefined
              ? {
                  externalPopup:
                    matchedTarget.externalPopup,
                }
              : {}
          ),
          ...(
            matchedTarget.semanticOptionBinding !==
            undefined
              ? {
                  semanticOptionBinding:
                    matchedTarget
                      .semanticOptionBinding,
                }
              : {}
          ),
        })
      : null;

  const browserMutationPermission =
    browserMutationsAllowed();

  const authorizedSemanticOptionClick =
    matchedTarget.source === "control" &&
    matchedTarget.kind === "option" &&
    matchedTarget.semanticOptionBinding ===
      true &&
    browserMutationPermission;

  if (
    controlSafetyClass ===
    "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
  ) {
    return {
      status: "BLOCKED",
      note:
        "The executor independently blocked a potentially consequential control label.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    controlSafetyClass ===
      "TRANSIENT_VALUE_CHANGE" &&
    matchedTarget.source === "control" &&
    matchedTarget.externalPopup === true &&
    !browserMutationPermission
  ) {
    return {
      status: "BLOCKED",
      note:
        "The executor independently blocked a transient popup selection because browser mutation permission is disabled.",
      executed: false,
      stateChanged: false,
    };
  }

  /*
   * Executor-side B4C authorization parity.
   *
   * Even a fabricated SAFE_TO_EXECUTE evaluation cannot make an
   * ordinary observed option executable. Only an exact proven
   * semantic option binding with mutation permission may proceed.
   */
  if (
    matchedTarget.source === "control" &&
    matchedTarget.kind === "option" &&
    !authorizedSemanticOptionClick
  ) {
    return {
      status: "BLOCKED",
      note:
        matchedTarget
          .semanticOptionBinding === true
          ? "The executor independently blocked a bound transient option because browser mutation permission is disabled."
          : "The executor independently blocked an ordinary option activation.",
      executed: false,
      stateChanged: false,
    };
  }

  const transientPopupMutation =
    matchedTarget.source === "control" &&
    matchedTarget.externalPopup === true;

  const contextText =
    action.contextText?.trim();
  let visible: Locator[];
  let usedObservationAlignedFallback =
    false;
  let activationInputIdentity:
    ActivationInputSemanticIdentity |
    undefined;
  let resolutionNote = "";

  if (matchedTarget.source === "input") {
    const inputResolution =
      await resolveExactActivationInput(
        page,
        action.target,
        matchedTarget.kind
      );

    if (!inputResolution.locator) {
      return {
        status: "BLOCKED",
        note:
          `The input could not be re-resolved safely: ${inputResolution.note}.`,
        executed: false,
        stateChanged: false,
      };
    }

    visible = [inputResolution.locator];
    activationInputIdentity =
      inputResolution.identity;
    resolutionNote =
      " via exact activation-safe input grounding";
  } else if (contextText) {
    if (
      normalize(
        matchedTarget.contextText
      ) !== normalize(contextText)
    ) {
      return {
        status: "BLOCKED",
        note:
          "Proposal context and evaluated semantic context do not match exactly.",
        executed: false,
        stateChanged: false,
      };
    }

    const contextualResolution =
      await resolveReadOnlyContextualControl(
        page,
        {
          targetText: action.target,
          contextText,
        }
      );

    if (!contextualResolution.locator) {
      return {
        status: "BLOCKED",
        note:
          `The contextual control could not be re-resolved safely: ${contextualResolution.note}.`,
        executed: false,
        stateChanged: false,
      };
    }

    visible = [
      contextualResolution.locator,
    ];
    resolutionNote =
      ` via semantic context "${contextText}"`;
  } else if (
    matchedTarget.kind === "option" &&
    matchedTarget
      .semanticOptionBinding === true
  ) {
    /*
     * Re-derive the two-tree binding
     * from the live DOM rather than
     * trusting observer-time identity.
     */
    visible =
      await collectSemanticOptionBindingCandidates(
        page,
        action.target
      );

    usedObservationAlignedFallback =
      visible.length > 0;
  } else {
    const candidates =
      buildRoleCandidates(
        page,
        matchedTarget.kind || "",
        action.target
      );

    if (candidates.length === 0) {
      return {
        status: "BLOCKED",
        note:
          "The evaluated control kind is not eligible for read-only click execution.",
        executed: false,
        stateChanged: false,
      };
    }

    visible =
      await collectVisibleCandidates(
        candidates
      );

    if (visible.length === 0) {
      visible =
        await collectObservationAlignedCandidates(
          page,
          matchedTarget.kind || "",
          action.target
        );

      usedObservationAlignedFallback =
        visible.length > 0;
    }
  }

  if (visible.length !== 1) {
    return {
      status: "BLOCKED",
      note:
        visible.length === 0
          ? "No exact visible semantic or observation-aligned control matched the proposal."
          : "Multiple exact visible controls matched the proposal; execution is ambiguous.",
      executed: false,
      stateChanged: false,
    };
  }

  const target =
    visible[0]!;

  const disabled =
    await target
      .isDisabled({
        timeout: 500,
      })
      .catch(() => false);

  if (disabled) {
    return {
      status: "BLOCKED",
      note:
        "The exact semantic control became disabled before execution.",
      executed: false,
      stateChanged: false,
    };
  }

  const beforeObservation =
    await observeBrowserPage(page);
  /*
   * GENERIC_BROWSER_CONTROL_SURFACE_TRANSITION_V1
   *
   * A grounded semantic control may open a portaled menu,
   * listbox, dropdown, popover, drawer, or similar runtime
   * surface without changing the bounded BrowserObservation.
   *
   * Verify newly visible runtime surfaces for both activation-
   * safe inputs and already-approved semantic controls.
   *
   * This does not grant execution permission or acceptance
   * proof; it only verifies that an executed click produced
   * an observable runtime state transition.
   */
  const verifyRuntimeSurfaceOpening =
    matchedTarget.source === "input" ||
    matchedTarget.source === "control";

  const beforeRuntimeSurfaceSignatures =
    verifyRuntimeSurfaceOpening
      ? await visibleRuntimeFilterSurfaceSignatures(
          page
        )
      : [];
  const beforeRuntimeSurfaceKeys =
    beforeRuntimeSurfaceSignatures.map(
      runtimeSurfaceVerificationKey
    );
  const surfaceDebugInteractionId =
    surfaceDebugEnabled() &&
    verifyRuntimeSurfaceOpening
      ? `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`
      : "";

  if (surfaceDebugInteractionId) {
    await logSurfaceDebugSnapshot({
      page,
      interactionId:
        surfaceDebugInteractionId,
      phase: "BEFORE",
      runtimeSignatures:
        beforeRuntimeSurfaceSignatures,
      observation: beforeObservation,
    });
  }

  let usedCollapsedListboxKeyboardActivation =
    false;

  try {
    await target
      .scrollIntoViewIfNeeded({
        timeout: 1500,
      });

    try {
      await target.click({
        trial: true,
        timeout: 2000,
      });
    } catch (pointerPreflightError) {
      if (
        !supportsCollapsedListboxKeyboardActivation(
          activationInputIdentity
        )
      ) {
        throw pointerPreflightError;
      }

      /*
       * GENERIC_SELECTED_VALUE_COMBOBOX_ACTIVATION_PARITY_V0
       *
       * A selected-value presentation may legitimately occupy the
       * pointer surface above an exact semantic combobox input. When
       * the side-effect-free pointer trial cannot act on that input,
       * use the standard collapsed-listbox keyboard contract instead.
       *
       * This is intentionally limited to one evaluator-approved,
       * enabled, activation-safe role=combobox input with explicit
       * collapsed state, listbox popup semantics and a controlled
       * surface. It neither forces a click nor retries another DOM
       * target.
       */
      await target.press(
        "ArrowDown",
        { timeout: 2500 }
      );
      usedCollapsedListboxKeyboardActivation =
        true;
    }

    if (
      !usedCollapsedListboxKeyboardActivation
    ) {
      await target.click({
        timeout: 2500,
      });
    }

    await page.waitForTimeout(350);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      status: "ERROR",
      note:
        `Exact semantic control activation failed: ${message}`,
      executed: false,
      stateChanged: false,
      beforeObservation,
    };
  }

  /*
   * GENERIC_READONLY_DELAYED_VERIFICATION_V1
   *
   * A click may first trigger a loading state and only later
   * expose the destination UI. Poll fresh bounded observations
   * before classifying the action as VERIFICATION_FAILED.
   */
  const verificationDeadline =
    Date.now() + 4_000;

  let afterObservation =
    await observeBrowserPage(
      page
    );
  let afterRuntimeSurfaceSignatures =
    verifyRuntimeSurfaceOpening
      ? await visibleRuntimeFilterSurfaceSignatures(
          page
        )
      : [];
  let afterRuntimeSurfaceKeys =
    afterRuntimeSurfaceSignatures.map(
      runtimeSurfaceVerificationKey
    );

  if (surfaceDebugInteractionId) {
    await logSurfaceDebugSnapshot({
      page,
      interactionId:
        surfaceDebugInteractionId,
      phase: "AFTER_INITIAL",
      runtimeSignatures:
        afterRuntimeSurfaceSignatures,
      beforeRuntimeSurfaceKeys,
      observation: afterObservation,
    });
  }

  const runtimePopupOpened = () =>
    afterRuntimeSurfaceKeys.some(
      (signature) =>
        !beforeRuntimeSurfaceKeys.includes(
          signature
        )
    );

  const collapsedListboxExpanded = () => {
    if (
      !usedCollapsedListboxKeyboardActivation
    ) {
      return false;
    }

    const exactInputs =
      afterObservation.inputs.filter(
        (input) =>
          normalize(input.label) ===
            normalize(action.target) &&
          normalize(input.role) ===
            "combobox"
      );

    return (
      exactInputs.length === 1 &&
      exactInputs[0]!.expanded === true
    );
  };

  let stateChanged =
    usedCollapsedListboxKeyboardActivation
      ? (
          collapsedListboxExpanded() ||
          runtimePopupOpened()
        )
      : (
          observationsDiffer(
            beforeObservation,
            afterObservation
          ) || runtimePopupOpened()
        );

  let awaitingFreshCollection =
    stateChanged &&
    collectionRefreshPending(
      beforeObservation,
      afterObservation
    );

  while (
    (
      !stateChanged ||
      awaitingFreshCollection
    ) &&
    Date.now() < verificationDeadline
  ) {
    await page.waitForTimeout(250);

    afterObservation =
      await observeBrowserPage(
        page
      );
    afterRuntimeSurfaceSignatures =
      verifyRuntimeSurfaceOpening
        ? await visibleRuntimeFilterSurfaceSignatures(
            page
          )
        : [];
    afterRuntimeSurfaceKeys =
      afterRuntimeSurfaceSignatures.map(
        runtimeSurfaceVerificationKey
      );

    if (surfaceDebugInteractionId) {
      await logSurfaceDebugSnapshot({
        page,
        interactionId:
          surfaceDebugInteractionId,
        phase: "AFTER_POLL",
        runtimeSignatures:
          afterRuntimeSurfaceSignatures,
        beforeRuntimeSurfaceKeys,
        observation: afterObservation,
      });
    }

    stateChanged =
      usedCollapsedListboxKeyboardActivation
        ? (
            collapsedListboxExpanded() ||
            runtimePopupOpened()
          )
        : (
            observationsDiffer(
              beforeObservation,
              afterObservation
            ) || runtimePopupOpened()
          );

    awaitingFreshCollection =
      stateChanged &&
      collectionRefreshPending(
        beforeObservation,
        afterObservation
      );
  }

  if (usedObservationAlignedFallback) {
    resolutionNote =
      " via observation-aligned DOM fallback";
  }

  if (
    usedCollapsedListboxKeyboardActivation
  ) {
    resolutionNote +=
      " using role-semantic collapsed-listbox keyboard activation";
  }

  return {
    status:
      stateChanged
        ? "EXECUTED"
        : "VERIFICATION_FAILED",
    note:
      stateChanged
        ? transientPopupMutation
          ? `Executed exact transient popup selection "${action.target}"${resolutionNote} and observed a visible state change.`
          : `Executed exact read-only ${
              usedCollapsedListboxKeyboardActivation
                ? "combobox activation"
                : "click"
            } "${action.target}"${resolutionNote} and observed a visible state change.`
        : transientPopupMutation
          ? `Executed exact transient popup selection "${action.target}"${resolutionNote} but no observable state change was detected.`
          : `Executed exact read-only ${
              usedCollapsedListboxKeyboardActivation
                ? "combobox activation"
                : "click"
            } "${action.target}"${resolutionNote} but no observable state change was detected.`,
    executed: true,
    stateChanged,
    beforeObservation,
    afterObservation,
  };
}

async function executeInternalNavigation(
  page: Page,
  target: string
): Promise<BrowserReadOnlyExecutionResult> {
  if (
    !target.startsWith("/") ||
    target.startsWith("//")
  ) {
    return {
      status: "BLOCKED",
      note:
        "Read-only navigation requires a concrete internal route beginning with a single slash.",
      executed: false,
      stateChanged: false,
    };
  }

  let current: URL;
  let destination: URL;

  try {
    current =
      new URL(page.url());

    destination =
      new URL(
        target,
        current.origin
      );
  } catch {
    return {
      status: "BLOCKED",
      note:
        "The current page URL or proposed route could not be parsed safely.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    !["http:", "https:"]
      .includes(current.protocol) ||
    destination.origin !==
      current.origin
  ) {
    return {
      status: "BLOCKED",
      note:
        "The proposed navigation is not a same-origin HTTP(S) route.",
      executed: false,
      stateChanged: false,
    };
  }

  const beforeObservation =
    await observeBrowserPage(page);

  try {
    await page.goto(
      destination.toString(),
      {
        waitUntil:
          "domcontentloaded",
        timeout: 15000,
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      status: "ERROR",
      note:
        `Internal navigation failed: ${message}`,
      executed: false,
      stateChanged: false,
      beforeObservation,
    };
  }

  const afterObservation =
    await observeBrowserPage(page);

  const reached =
    new URL(
      afterObservation.url
    ).pathname ===
      destination.pathname &&
    new URL(
      afterObservation.url
    ).search ===
      destination.search;

  return {
    status:
      reached
        ? "EXECUTED"
        : "VERIFICATION_FAILED",
    note:
      reached
        ? `Navigated to internal route "${target}".`
        : `Navigation executed but the expected internal route "${target}" was not reached.`,
    executed: true,
    stateChanged:
      observationsDiffer(
        beforeObservation,
        afterObservation
      ),
    beforeObservation,
    afterObservation,
  };
}

export async function executeBrowserReadOnlyProposal(
  args: ExecuteBrowserReadOnlyProposalArgs
): Promise<BrowserReadOnlyExecutionResult> {
  if (!readOnlyExecutionEnabled()) {
    return {
      status: "SKIPPED",
      note:
        "Generic browser read-only execution is disabled.",
      executed: false,
      stateChanged: false,
    };
  }

  const {
    page,
    proposal,
    evaluation,
  } = args;

  if (
    evaluation.status !==
      "SAFE_TO_EXECUTE" ||
    evaluation.safeToExecute !==
      true ||
    evaluation.grounded !== true
  ) {
    return {
      status: "BLOCKED",
      note:
        `Proposal evaluation is not eligible for execution: ${evaluation.status}.`,
      executed: false,
      stateChanged: false,
    };
  }

  const action =
    proposal.action;

  if (!action) {
    return {
      status: "BLOCKED",
      note:
        "The proposal does not contain an executable action.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    action.kind === "fill" ||
    action.kind === "select"
  ) {
    return {
      status: "BLOCKED",
      note:
        `Action kind "${action.kind}" is excluded from the first read-only execution phase.`,
      executed: false,
      stateChanged: false,
    };
  }

  if (
    action.kind === "click"
  ) {
    return executeExactControlClick(
      page,
      proposal,
      evaluation
    );
  }

  if (
    action.kind === "navigate"
  ) {
    return executeInternalNavigation(
      page,
      action.target
    );
  }

  if (
    action.kind === "assert"
  ) {
    const observation =
      await observeBrowserPage(page);

    return {
      status: "EXECUTED",
      note:
        `Read-only assertion proposal retained its grounded evaluation for "${action.target}".`,
      executed: true,
      stateChanged: false,
      beforeObservation:
        observation,
      afterObservation:
        observation,
    };
  }

  if (
    action.kind === "observe"
  ) {
    const observation =
      await observeBrowserPage(page);

    return {
      status: "EXECUTED",
      note:
        "Captured a fresh read-only browser observation.",
      executed: true,
      stateChanged: false,
      beforeObservation:
        observation,
      afterObservation:
        observation,
    };
  }

  return {
    status: "BLOCKED",
    note:
      `Action kind "${action.kind}" is not supported by the read-only executor.`,
    executed: false,
    stateChanged: false,
  };
}
