import type { Locator, Page } from "playwright";

export type ControlInteractionResult = {
  ok: boolean;
  note: string;
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
        '[data-state="open"]',
        '[data-radix-menu-content]',
        '[data-radix-popper-content-wrapper]',
        '[class*="popover"]',
        '[class*="Popover"]',
        '[class*="dropdown"]',
        '[class*="Dropdown"]',
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

      if (hint.includes("filter") || hint.includes("funnel")) {
        ["filter", "filters", "funnel", "sliders", "tune"].forEach(
          (token) => tokens.add(token)
        );
      }

      if (
        hint.includes("sort") ||
        ["newest", "latest", "oldest"].includes(hint)
      ) {
        ["sort", "sorting", "newest", "latest", "oldest", "select"].forEach(
          (token) => tokens.add(token)
        );
      }

      let score = descriptor === hint ? 150 : descriptor.includes(hint) ? 90 : 0;

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

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 60) return null;

  if (
    second &&
    best.score - second.score < 10 &&
    best.descriptor !== second.descriptor
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

  const activePosition =
    group.findIndex(
      (item) => item.active
    );

  const orderedCandidates = [
    ...group.slice(
      activePosition + 1
    ),
    ...group.slice(
      0,
      activePosition
    ),
  ].filter(
    (item) =>
      !item.active &&
      !item.disabled
  );

  const target =
    orderedCandidates[0];

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
    return {
      ok: false,
      note:
        `runtime top tab ` +
        `"${target.text}" was discovered ` +
        `but was not safely clickable`,
    };
  }

  await page.waitForTimeout(750);

  const verified = await page
    .locator(selector)
    .evaluateAll(
      (
        elements,
        expectedNormalizedText
      ) => {
        const normalizeText = (
          value: unknown
        ) =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        return elements.some(
          (element) => {
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
              Number(style.opacity) !==
                0 &&
              rect.width >= 20 &&
              rect.height >= 16 &&
              rect.bottom > 0 &&
              rect.right > 0;

            if (!visible) {
              return false;
            }

            const text = normalizeText(
              element.getAttribute(
                "aria-label"
              ) ||
              element.innerText ||
              element.textContent
            );

            if (
              text !==
              expectedNormalizedText
            ) {
              return false;
            }

            const className =
              typeof element.className ===
              "string"
                ? element.className
                : "";

            return (
              element.getAttribute(
                "aria-selected"
              ) === "true" ||
              element.getAttribute(
                "data-state"
              ) === "active" ||
              element.getAttribute(
                "aria-current"
              ) === "page" ||
              element.getAttribute(
                "aria-current"
              ) === "true" ||
              /(^|\s)(active|selected)(\s|$)/i
                .test(className)
            );
          }
        );
      },
      target.normalizedText
    )
    .catch(() => false);

  let afterUrl = page.url();

  if (
    !verified &&
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

  if (verified) {
    return {
      ok: true,
      note:
        `selected and verified runtime top tab ` +
        `"${target.text}" from visible tabs ` +
        `[${visibleLabels}]`,
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
    return {
      ok: true,
      note:
        `selected runtime top tab ` +
        `"${target.text}" and observed URL ` +
        `transition: ${beforeUrl} -> ${afterUrl}; ` +
        `semantic selected-state attributes were ` +
        `not exposed, so screenshot evidence and ` +
        `the following URL assertions remain required`,
    };
  }

  return {
    ok: false,
    note:
      `clicked runtime top tab ` +
      `"${target.text}", but neither semantic ` +
      `selected state nor a URL transition could ` +
      `be verified`,
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

    for (let index = 0; index < count; index += 1) {
      const result = await tryOpenTrigger(
        page,
        locator.nth(index),
        `direct control "${normalized}"`
      );

      if (result.ok) return result;
    }
  }

  const semantic = await findSemanticTrigger(page, normalized);

  if (!semantic) {
    return {
      ok: false,
      note: `no unique relevant menu trigger was found for "${normalized}"`,
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
  text: string
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

  for (const locator of candidates) {
    const count = Math.min(await locator.count().catch(() => 0), 12);

    for (let index = 0; index < count; index += 1) {
      if (await clickVisible(locator.nth(index))) {
        await page.waitForTimeout(500);
        return { ok: true, note: `selected menu option "${normalized}"` };
      }
    }
  }

  return {
    ok: false,
    note: `menu option "${normalized}" was not visible or safely clickable`,
  };
}
