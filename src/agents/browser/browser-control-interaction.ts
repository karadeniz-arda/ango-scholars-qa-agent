import type { Locator, Page } from "playwright";
import type {
  BrowserRuntimeTopTabObservation,
} from "./browser-execution-types.js";
import {
  observeBrowserPage,
} from "./browser-observation.js";
import {
  findRelevantFilterControl,
} from "./runtime-filter-control-discovery.js";

export type ControlInteractionResult = {
  ok: boolean;
  note: string;
  runtimeTopTabObservation?: Omit<
    BrowserRuntimeTopTabObservation,
    "stepIndex" | "note"
  >;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textRegex(text: string): RegExp {
  return new RegExp(
    escapeRegExp(text.trim()).replace(/\\\s+/g, "\\s+"),
    "i"
  );
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isFilterMenuHint(
  value: string
): boolean {
  return /(?:^|\b)(?:filter|filters|funnel)(?:\b|$)/i.test(
    value
  );
}

async function clickVisible(locator: Locator): Promise<boolean> {
  const visible = await locator
    .isVisible({ timeout: 700 })
    .catch(() => false);

  if (!visible) return false;

  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 1000 });
    await locator.click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function visibleMenuSurfaces(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const selectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="dialog"]',
        '[aria-modal="true"]',
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

      return Array.from(
        document.querySelectorAll<HTMLElement>(selectors.join(","))
      )
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();

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
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const text = String(
            element.innerText || element.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 250);

          return [
            element.getAttribute("role") || "no-role",
            element.getAttribute("data-state") || "no-state",
            Math.round(rect.left),
            Math.round(rect.top),
            Math.round(rect.width),
            Math.round(rect.height),
            text,
          ].join("|");
        });
    })
    .catch(() => []);
}

async function controlledSurfaceVisible(trigger: Locator): Promise<boolean> {
  return trigger
    .evaluate((element) => {
      if (!(element instanceof HTMLElement)) return false;

      const id =
        element.getAttribute("aria-controls") ||
        element.getAttribute("aria-owns");

      if (!id) return false;

      const controlled = document.getElementById(id);
      if (!(controlled instanceof HTMLElement)) return false;

      const style = window.getComputedStyle(controlled);
      const rect = controlled.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width >= 10 &&
        rect.height >= 10
      );
    })
    .catch(() => false);
}

async function tryOpenTrigger(
  page: Page,
  trigger: Locator,
  label: string
): Promise<ControlInteractionResult> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);

  const before = await visibleMenuSurfaces(page);
  const clicked = await clickVisible(trigger);

  if (!clicked) {
    return { ok: false, note: `${label} was not safely clickable` };
  }

  await page.waitForTimeout(500);

  const expanded = await trigger
    .getAttribute("aria-expanded")
    .catch(() => null);

  const state = await trigger
    .getAttribute("data-state")
    .catch(() => null);

  const after = await visibleMenuSurfaces(page);
  const newSurface = after.some((surface) => !before.includes(surface));

  const opened =
    expanded === "true" ||
    state === "open" ||
    (await controlledSurfaceVisible(trigger)) ||
    newSurface;

  return opened
    ? { ok: true, note: `opened and verified menu using ${label}` }
    : {
        ok: false,
        note: `clicked ${label}, but no opened menu/listbox was verified`,
      };
}

async function semanticControlScore(
  locator: Locator,
  hint: string
): Promise<{ score: number; descriptor: string }> {
  return locator
    .evaluate((element, rawHint) => {
      if (!(element instanceof HTMLElement)) {
        return { score: -1000, descriptor: "non-html" };
      }

      const normalizeValue = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const hint = normalizeValue(rawHint);
      const descendantMeta = Array.from(
        element.querySelectorAll<HTMLElement>(
          "svg,[aria-label],[title],[data-testid],[data-icon],[class]"
        )
      )
        .slice(0, 20)
        .map((child) =>
          [
            child.getAttribute("aria-label"),
            child.getAttribute("title"),
            child.getAttribute("data-testid"),
            child.getAttribute("data-icon"),
            child.getAttribute("class"),
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ");

      const descriptor = normalizeValue(
        [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("name"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-slot"),
          element.getAttribute("data-state"),
          element.getAttribute("role"),
          element.getAttribute("class"),
          descendantMeta,
        ]
          .filter(Boolean)
          .join(" ")
      );

      const tokens = new Set(
        hint.split(/[^a-z0-9]+/i).filter((token) => token.length >= 3)
      );
      let semanticFamilyBonus = 0;

      if (hint.includes("filter") || hint.includes("funnel")) {
        ["filter", "filters", "funnel", "sliders", "tune"].forEach(
          (token) => tokens.add(token)
        );

        if (
          descriptor.includes("filter") ||
          descriptor.includes("funnel")
        ) {
          semanticFamilyBonus += 55;
        }
      }

      if (
        hint.includes("sort") ||
        ["newest", "latest", "oldest"].includes(hint)
      ) {
        ["sort", "sorting", "newest", "latest", "oldest", "select"].forEach(
          (token) => tokens.add(token)
        );
      }

      let score =
        (descriptor === hint
          ? 150
          : descriptor.includes(hint)
            ? 90
            : 0) +
        semanticFamilyBonus;

      for (const token of tokens) {
        if (descriptor.includes(token)) score += 24;
      }

      if (element.hasAttribute("aria-haspopup")) score += 35;
      if (element.getAttribute("role") === "combobox") score += 40;
      if (element.getAttribute("data-state") === "closed") score += 20;
      if (element.querySelector("svg")) score += 8;
      if (element.closest("main")) score += 10;

      return { score, descriptor: descriptor.slice(0, 350) };
    }, hint)
    .catch(() => ({ score: -1000, descriptor: "evaluation-failed" }));
}

async function findSemanticTrigger(
  page: Page,
  hint: string
): Promise<{ locator: Locator; score: number; descriptor: string } | null> {
  const controls = page.locator(
    'main button,main [role="button"],main [role="combobox"],main [aria-haspopup]'
  );

  const count = Math.min(await controls.count().catch(() => 0), 100);
  const scored: Array<{ locator: Locator; score: number; descriptor: string }> = [];

  for (let index = 0; index < count; index += 1) {
    const locator = controls.nth(index);
    const result = await semanticControlScore(locator, hint);

    if (result.score > 0) {
      scored.push({ locator, ...result });
    }
  }

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.descriptor.localeCompare(
        right.descriptor
      )
  );

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 60) return null;

  if (
    second &&
    best.score - second.score < 10
  ) {
    return null;
  }

  return best;
}


export async function selectRuntimeTopTab(
  page: Page
): Promise<ControlInteractionResult> {
  const selector = [
    'main [role="tab"]',
    'main [role="tablist"] button',
  ].join(", ");

  const tabs = page.locator(selector);

  const count = Math.min(
    await tabs.count().catch(() => 0),
    40
  );

  type RuntimeTabMetadata = {
    index: number;
    text: string;
    normalizedText: string;
    active: boolean;
    disabled: boolean;
    groupKey: string;
    top: number;
  };

  type StableCandidateSelection = {
    target?: RuntimeTabMetadata;
    ambiguity?: string;
  };

  function chooseStableCandidate(
    candidates: RuntimeTabMetadata[]
  ): StableCandidateSelection {
    const labelCounts = new Map<
      string,
      number
    >();

    for (const candidate of candidates) {
      labelCounts.set(
        candidate.normalizedText,
        (labelCounts.get(
          candidate.normalizedText
        ) ?? 0) + 1
      );
    }

    const duplicateLabels = [
      ...labelCounts.entries(),
    ]
      .filter(([, count]) => count > 1)
      .map(([label]) => label);

    if (duplicateLabels.length > 0) {
      return {
        ambiguity:
          `duplicate accessible tab labels: ` +
          duplicateLabels.join(", "),
      };
    }

    const target = [...candidates].sort(
      (left, right) => {
        if (
          left.normalizedText <
          right.normalizedText
        ) {
          return -1;
        }

        if (
          left.normalizedText >
          right.normalizedText
        ) {
          return 1;
        }

        return 0;
      }
    )[0];

    return target
      ? { target }
      : {};
  }

  const metadata: RuntimeTabMetadata[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const item = tabs.nth(index);

    const candidate = await item
      .evaluate((element, itemIndex) => {
        if (
          !(element instanceof HTMLElement)
        ) {
          return null;
        }

        const style =
          window.getComputedStyle(element);

        const rect =
          element.getBoundingClientRect();

        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width >= 20 &&
          rect.height >= 16 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth &&
          !element.closest("aside,nav");

        if (!visible) {
          return null;
        }

        const text = String(
          element.getAttribute(
            "aria-label"
          ) ||
          element.innerText ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

        if (
          !text ||
          text.length > 80
        ) {
          return null;
        }

        const group =
          element.closest(
            '[role="tablist"]'
          ) ||
          element.parentElement;

        if (
          !(group instanceof HTMLElement)
        ) {
          return null;
        }

        const groupRect =
          group.getBoundingClientRect();

        const groupKey = [
          Math.round(groupRect.left),
          Math.round(groupRect.top),
          Math.round(groupRect.width),
          Math.round(groupRect.height),
        ].join(":");

        const className =
          typeof element.className ===
          "string"
            ? element.className
            : "";

        const ariaSelected =
          element.getAttribute(
            "aria-selected"
          );

        const dataState =
          element.getAttribute(
            "data-state"
          );

        const ariaCurrent =
          element.getAttribute(
            "aria-current"
          );

        const active =
          ariaSelected === "true" ||
          dataState === "active" ||
          ariaCurrent === "page" ||
          ariaCurrent === "true" ||
          /(^|\s)(active|selected)(\s|$)/i
            .test(className);

        const disabled =
          element.hasAttribute(
            "disabled"
          ) ||
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          (
            element instanceof
            HTMLButtonElement &&
            element.disabled
          );

        return {
          index: Number(itemIndex),
          text,
          normalizedText:
            text.toLowerCase(),
          active,
          disabled,
          groupKey,
          top: groupRect.top,
        };
      }, index)
      .catch(() => null);

    if (candidate) {
      metadata.push(candidate);
    }
  }

  const groups = new Map<
    string,
    RuntimeTabMetadata[]
  >();

  for (const item of metadata) {
    const existing =
      groups.get(item.groupKey) ?? [];

    existing.push(item);
    groups.set(item.groupKey, existing);
  }

  const viableGroups = [
    ...groups.values(),
  ]
    .filter((group) => {
      const activeCount =
        group.filter(
          (item) => item.active
        ).length;

      const selectableCount =
        group.filter(
          (item) =>
            !item.active &&
            !item.disabled
        ).length;

      return (
        group.length >= 2 &&
        activeCount === 1 &&
        selectableCount >= 1
      );
    })
    .sort((left, right) => {
      if (
        right.length !== left.length
      ) {
        return (
          right.length -
          left.length
        );
      }

      const leftTop =
        Math.min(
          ...left.map(
            (item) => item.top
          )
        );

      const rightTop =
        Math.min(
          ...right.map(
            (item) => item.top
          )
        );

      return leftTop - rightTop;
    });

  const group = viableGroups[0];

  if (!group) {
    const visibleLabels =
      metadata
        .map((item) => item.text)
        .join(", ");

    return {
      ok: false,
      note:
        "runtime top-tab discovery could not " +
        "find one visible main-content tab " +
        "group with exactly one active tab and " +
        "at least one safe inactive tab" +
        (
          visibleLabels
            ? `; visible candidates: ` +
              `[${visibleLabels}]`
            : ""
        ),
    };
  }

  const candidates = group.filter(
    (item) =>
      !item.active &&
      !item.disabled
  );

  const candidateLabels = candidates.map(
    (item) => item.text
  );
  const stableSelection =
    chooseStableCandidate(candidates);

  if (stableSelection.ambiguity) {
    return {
      ok: false,
      note:
        `runtime top-tab discovery could not ` +
        `choose a safe label-agnostic target: ` +
        stableSelection.ambiguity,
    };
  }

  const target =
    stableSelection.target;

  if (!target) {
    return {
      ok: false,
      note:
        "runtime top-tab discovery found " +
        "the active tab but no safe inactive " +
        "tab was available",
    };
  }

  const beforeUrl = page.url();

  const clicked = await clickVisible(
    tabs.nth(target.index)
  );

  if (!clicked) {
    const note =
      `runtime top tab ` +
      `"${target.text}" was discovered ` +
      `but was not safely clickable`;

    return {
      ok: false,
      note,
      runtimeTopTabObservation: {
        action: "selectRuntimeTopTab",
        candidateLabels,
        selectionStrategy:
          "stable-accessible-label",
        targetTabLabel: target.text,
        interactionSucceeded: false,
        observedActiveTabLabel: null,
        activeStateVerified: false,
        activeStateSource: null,
        urlChanged: false,
      },
    };
  }

  await page.waitForTimeout(750);

  const activeState = await page
    .locator(selector)
    .evaluateAll(
      (
        elements,
        expectedNormalizedText
      ) => {
        for (const element of elements) {
            if (
              !(
                element instanceof
                HTMLElement
              )
            ) {
              continue;
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
              Number(style.opacity) !==
                0 &&
              rect.width >= 20 &&
              rect.height >= 16 &&
              rect.bottom > 0 &&
              rect.right > 0;

            if (!visible) {
              continue;
            }

            const text = String(
              element.getAttribute(
                "aria-label"
              ) ||
              element.innerText ||
              element.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            if (
              text !==
              expectedNormalizedText
            ) {
              continue;
            }

            const className =
              typeof element.className ===
              "string"
                ? element.className
                : "";

            if (
              element.getAttribute(
                "aria-selected"
              ) === "true"
            ) {
              return {
                observedActiveTabLabel:
                  text,
                activeStateSource:
                  "aria-selected" as const,
              };
            }

            if (
              element.getAttribute(
                "data-state"
              ) === "active"
            ) {
              return {
                observedActiveTabLabel:
                  text,
                activeStateSource:
                  "data-state" as const,
              };
            }

            const ariaCurrent =
              element.getAttribute(
                "aria-current"
              );

            if (
              ariaCurrent === "page" ||
              ariaCurrent === "true"
            ) {
              return {
                observedActiveTabLabel:
                  text,
                activeStateSource:
                  "aria-current" as const,
              };
            }

            if (
              /(^|\s)(active|selected)(\s|$)/i
                .test(className)
            ) {
              return {
                observedActiveTabLabel:
                  text,
                activeStateSource:
                  "semantic-class" as const,
              };
            }
          }

        return null;
      },
      target.normalizedText
    )
    .catch(() => null);

  let afterUrl = page.url();

  if (
    !activeState &&
    afterUrl === beforeUrl
  ) {
    await page.waitForTimeout(750);
    afterUrl = page.url();
  }

  const urlChanged =
    afterUrl !== beforeUrl;

  const visibleLabels =
    group
      .map((item) => item.text)
      .join(", ");

  if (activeState) {
    const note =
      `selected and verified runtime top tab ` +
      `"${target.text}" via ` +
      `${activeState.activeStateSource} from ` +
      `visible tabs [${visibleLabels}] using ` +
      `stable accessible-label selection`;

    return {
      ok: true,
      note,
      runtimeTopTabObservation: {
        action: "selectRuntimeTopTab",
        candidateLabels,
        selectionStrategy:
          "stable-accessible-label",
        targetTabLabel: target.text,
        interactionSucceeded: true,
        observedActiveTabLabel:
          target.text,
        activeStateVerified: true,
        activeStateSource:
          activeState.activeStateSource,
        urlChanged,
      },
    };
  }

  /*
   * Some tab implementations expose their selected
   * state only through styling and do not provide
   * aria-selected, data-state, aria-current or a
   * semantic active class.
   *
   * A real URL transition after clicking a visible
   * role=tab is sufficient to continue to the
   * dedicated deterministic URL assertions. It is
   * not, by itself, treated as proof that the visual
   * selected state or exact query mapping is correct.
   */
  if (urlChanged) {
    const note =
      `selected runtime top tab ` +
      `"${target.text}" and observed URL ` +
      `transition: ${beforeUrl} -> ${afterUrl}; ` +
      `semantic selected-state attributes were ` +
      `not exposed, so screenshot evidence and ` +
      `the following URL assertions remain required`;

    return {
      ok: true,
      note,
      runtimeTopTabObservation: {
        action: "selectRuntimeTopTab",
        candidateLabels,
        selectionStrategy:
          "stable-accessible-label",
        targetTabLabel: target.text,
        interactionSucceeded: true,
        observedActiveTabLabel: null,
        activeStateVerified: false,
        activeStateSource: null,
        urlChanged: true,
      },
    };
  }

  const note =
    `clicked runtime top tab ` +
    `"${target.text}", but neither semantic ` +
    `selected state nor a URL transition could ` +
    `be verified`;

  return {
    ok: false,
    note,
    runtimeTopTabObservation: {
      action: "selectRuntimeTopTab",
      candidateLabels,
      selectionStrategy:
        "stable-accessible-label",
      targetTabLabel: target.text,
      interactionSucceeded: true,
      observedActiveTabLabel: null,
      activeStateVerified: false,
      activeStateSource: null,
      urlChanged: false,
    },
  };
}

export async function openSmartMenu(
  page: Page,
  hint: string
): Promise<ControlInteractionResult> {
  const normalized = hint.trim();
  if (!normalized) return { ok: false, note: "menu hint is empty" };

  const regex = textRegex(normalized);
  const direct = [
    page.getByRole("button", { name: regex }),
    page.getByRole("combobox", { name: regex }),
    page.getByText(regex, { exact: true }),
  ];

  for (const locator of direct) {
    const count = Math.min(await locator.count().catch(() => 0), 5);

    const visibleEnabled:
      Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const candidate =
        locator.nth(index);
      const visible = await candidate
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const enabled = await candidate
        .isEnabled({ timeout: 500 })
        .catch(() => false);

      if (visible && enabled) {
        visibleEnabled.push(candidate);
      }
    }

    if (visibleEnabled.length !== 1) {
      continue;
    }

    const directCandidate =
      visibleEnabled[0];

    if (directCandidate) {
      const result = await tryOpenTrigger(
        page,
        directCandidate,
        `unique direct control "${normalized}"`
      );

      if (result.ok) return result;
    }
  }

  let filterDiscoveryNote = "";

  if (isFilterMenuHint(normalized)) {
    const filterDiscovery =
      await findRelevantFilterControl(
        page,
        [
          "filter",
          "filters",
          "funnel",
          "sliders",
          "tune",
        ]
      );

    filterDiscoveryNote =
      filterDiscovery.ambiguity;

    if (filterDiscovery.candidate) {
      const result = await tryOpenTrigger(
        page,
        filterDiscovery.candidate.locator,
        `observed filter-family control ` +
          `score=${filterDiscovery.candidate.score} ` +
          `descriptor=${filterDiscovery.candidate.descriptor}`
      );

      if (result.ok) {
        return result;
      }

      filterDiscoveryNote = result.note;
    }
  }

  const semantic =
    await findSemanticTrigger(
      page,
      normalized
    );

  if (!semantic) {
    return {
      ok: false,
      note:
        `no unique relevant menu trigger was found for "${normalized}"` +
        (
          filterDiscoveryNote
            ? `; filter discovery: ${filterDiscoveryNote}`
            : ""
        ),
    };
  }

  return tryOpenTrigger(
    page,
    semantic.locator,
    `semantic control score=${semantic.score} descriptor=${semantic.descriptor}`
  );
}

function isUnsafeExactOption(text: string): boolean {
  return [
    "delete",
    "reject",
    "approve",
    "submit",
    "publish",
    "create",
    "save",
    "send",
    "invite",
    "archive",
    "remove",
    "request publish",
    "invite external people",
    "apply",
    "complete",
  ].includes(normalize(text));
}

export async function selectSmartOption(
  page: Page,
  text: string,
  options?: {
    menuHint?: string;
  }
): Promise<ControlInteractionResult> {
  const normalized = text.trim();

  if (!normalized) return { ok: false, note: "option text is empty" };

  if (isUnsafeExactOption(normalized)) {
    return {
      ok: false,
      note: `option "${normalized}" is blocked as a state-changing action`,
    };
  }

  const regex = textRegex(normalized);
  const candidates = [
    page.getByRole("option", { name: regex }),
    page.getByRole("menuitem", { name: regex }),
    page.getByRole("menuitemradio", { name: regex }),
    page.getByRole("menuitemcheckbox", { name: regex }),
    page
      .locator(
        '[role="menu"],[role="listbox"],[data-state="open"],[data-radix-menu-content]'
      )
      .getByText(regex, { exact: true }),
  ];

  let selectedCandidate:
    Locator | undefined;

  for (const locator of candidates) {
    const count = Math.min(await locator.count().catch(() => 0), 12);

    const visibleEnabled:
      Locator[] = [];

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate
        .isVisible({ timeout: 500 })
        .catch(() => false);
      const enabled = await candidate
        .isEnabled({ timeout: 500 })
        .catch(() => false);

      if (visible && enabled) {
        visibleEnabled.push(candidate);
      }
    }

    if (visibleEnabled.length > 1) {
      return {
        ok: false,
        note:
          `menu option "${normalized}" was ambiguous: ` +
          `${visibleEnabled.length} visible enabled exact ` +
          `candidates were observed; no DOM-order fallback was used`,
      };
    }

    if (visibleEnabled.length === 1) {
      selectedCandidate =
        visibleEnabled[0];
      break;
    }
  }

  if (!selectedCandidate) {
    return {
      ok: false,
      note: `menu option "${normalized}" was not visible or safely clickable`,
    };
  }

  const beforeSelectionSignal =
    await visibleSelectionSignal(
      page,
      normalized
    );

  if (!(await clickVisible(selectedCandidate))) {
    return {
      ok: false,
      note: `menu option "${normalized}" was not safely clickable`,
    };
  }

  await page.waitForTimeout(500);

  let afterSelectionSignal =
    await visibleSelectionSignal(
      page,
      normalized
    );

  let verificationSource =
    afterSelectionSignal;

  if (
    !verificationSource &&
    beforeSelectionSignal
  ) {
    verificationSource =
      `pre-existing visible selected state ` +
      `(${beforeSelectionSignal})`;
  }

  if (
    !verificationSource &&
    options?.menuHint
  ) {
    const reopened = await openSmartMenu(
      page,
      options.menuHint
    );

    if (reopened.ok) {
      afterSelectionSignal =
        await visibleSelectionSignal(
          page,
          normalized
        );

      if (afterSelectionSignal) {
        verificationSource =
          `reopened menu ` +
          `(${afterSelectionSignal})`;
      }
    }
  }

  if (!verificationSource) {
    return {
      ok: false,
      note:
        `clicked unique menu option ` +
        `"${normalized}", but no visible selected ` +
        `value or semantic selected state was verified`,
    };
  }

  return {
    ok: true,
    note:
      `selected unique observed menu option ` +
      `"${normalized}" and verified visible selected ` +
      `state via ${verificationSource}`,
  };
}

async function visibleSelectionSignal(
  page: Page,
  targetText: string
): Promise<string | null> {
  const observation =
    await observeBrowserPage(page, {
      maxControls: 200,
    });
  const target = normalize(targetText);
  const containsTarget = (
    value: string
  ) =>
    value === target ||
    value.startsWith(`${target} `) ||
    value.endsWith(` ${target}`) ||
    value.includes(` ${target} `);

  const matchingControls =
    observation.controls.filter(
      (control) =>
        containsTarget(
          normalize(control.label)
        )
    );

  if (
    matchingControls.some(
      (control) =>
        control.selected === true ||
        control.checked === true
    )
  ) {
    return "semantic option state";
  }

  return matchingControls.some(
    (control) =>
      control.kind === "button" ||
      control.role === "combobox"
  )
    ? "visible control value"
    : null;
}
