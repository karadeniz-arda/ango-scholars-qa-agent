import type {
  Locator,
  Page,
} from "playwright";
import type {
  RuntimeFilterInteractionResult,
} from "./runtime-filter-query-transition.js";
import {
  clickVisible,
  isUnsafeFilterOptionLabel,
  normalize,
} from "./runtime-filter-shared.js";

export async function visibleRuntimeFilterSurfaceSignatures(
  page: Page
): Promise<string[]> {
  return page
    .evaluate(() => {
      const selectors = [
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

      const elements =
        Array.from(
          document.querySelectorAll<
            HTMLElement
          >(
            selectors.join(",")
          )
        );

      return elements
        .filter((element) => {
          const style =
            window.getComputedStyle(
              element
            );

          const rect =
            element
              .getBoundingClientRect();

          return (
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(style.opacity) !==
              0 &&
            rect.width >= 10 &&
            rect.height >= 10 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top <
              window.innerHeight &&
            rect.left <
              window.innerWidth
          );
        })
        .map((element) => {
          const rect =
            element
              .getBoundingClientRect();

          const text =
            String(
              element.innerText ||
              element.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300);

          return [
            element.getAttribute(
              "role"
            ) || "no-role",
            element.getAttribute(
              "data-state"
            ) || "no-state",
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

async function scoreRuntimeFilterDimension(
  locator: Locator,
  tokens: string[]
): Promise<{
  score: number;
  label: string;
  descriptor: string;
} | null> {
  return locator
    .evaluate(
      (
        element,
        rawTokens
      ) => {
        if (
          !(
            element instanceof
            HTMLElement
          )
        ) {
          return null;
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
          Number(style.opacity) !==
            0 &&
          rect.width >= 20 &&
          rect.height >= 14 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top <
            window.innerHeight &&
          rect.left <
            window.innerWidth;

        if (!visible) {
          return null;
        }

        const openSurface =
          element.closest(
            [
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
            ].join(",")
          );

        if (!openSurface) {
          return null;
        }

        const label =
          String(
            element.getAttribute(
              "aria-label"
            ) ||
            element.innerText ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        if (!label) {
          return null;
        }

        const normalizedLabel =
          String(label ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const disabled =
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          element.hasAttribute(
            "disabled"
          );

        if (disabled) {
          return null;
        }

        const role =
          element.getAttribute(
            "role"
          ) || "";

        /*
         * Actual selectable values are handled by
         * findSafeRuntimeOption. This pass resolves
         * only a filter category/dimension trigger.
         */
        if (
          role === "option" ||
          role ===
            "menuitemradio" ||
          role ===
            "menuitemcheckbox"
        ) {
          return null;
        }

        const tokens =
          Array.isArray(rawTokens)
            ? rawTokens.map(
                (value) =>
                  String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLowerCase()
              )
            : [];

        let score = 0;

        for (const token of tokens) {
          if (!token) {
            continue;
          }

          if (
            normalizedLabel === token
          ) {
            score += 180;
          } else if (
            normalizedLabel.includes(
              token
            )
          ) {
            score += 85;
          }
        }

        if (
          role === "menuitem"
        ) {
          score += 35;
        }

        if (
          element.hasAttribute(
            "aria-haspopup"
          )
        ) {
          score += 50;
        }

        if (
          element.querySelector("svg")
        ) {
          score += 8;
        }

        const descriptor =
          [
            normalizedLabel,
            role,
            element.getAttribute(
              "aria-haspopup"
            ),
            element.getAttribute(
              "aria-expanded"
            ),
            element.getAttribute(
              "data-state"
            ),
          ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 300);

        return {
          score,
          label,
          descriptor,
        };
      },
      tokens
    )
    .catch(() => null);
}

async function findRuntimeFilterDimension(
  page: Page,
  tokens: string[]
): Promise<{
  locator: Locator;
  score: number;
  label: string;
  descriptor: string;
} | null> {
  const selector = [
    '[role="menu"] [role="menuitem"]',
    '[role="menu"] button',
    '[role="menu"] [role="button"]',
    '[role="menu"] li',
    '[role="menu"] [class*="menu-item"]',
    '[role="menu"] [class*="submenu-title"]',
    '[data-state="open"] [role="menuitem"]',
    '[data-state="open"] button',
    '[data-state="open"] li',
    '[data-state="open"] [class*="menu-item"]',
    '[data-state="open"] [class*="submenu-title"]',
    '[data-radix-menu-content] [role="menuitem"]',
    '[data-radix-menu-content] button',
    '[data-radix-menu-content] li',
    '[data-radix-popper-content-wrapper] [role="menuitem"]',
    '[data-radix-popper-content-wrapper] button',
    '[data-radix-popper-content-wrapper] li',
    '[class*="popover"] [role="menuitem"]',
    '[class*="popover"] button',
    '[class*="popover"] li',
    '[class*="Popover"] [role="menuitem"]',
    '[class*="Popover"] button',
    '[class*="Popover"] li',
    '[class*="dropdown"] [role="menuitem"]',
    '[class*="dropdown"] li',
    '[class*="dropdown"] [class*="menu-item"]',
    '[class*="dropdown"] [class*="submenu-title"]',
    '[class*="Dropdown"] [role="menuitem"]',
    '[class*="Dropdown"] li',
    '[class*="Dropdown"] [class*="menu-item"]',
    '[class*="Dropdown"] [class*="submenu-title"]',
  ].join(", ");

  const entries =
    page.locator(selector);

  const count = Math.min(
    await entries
      .count()
      .catch(() => 0),
    100
  );

  const candidates: Array<{
    locator: Locator;
    score: number;
    label: string;
    descriptor: string;
  }> = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      entries.nth(index);

    const metadata =
      await scoreRuntimeFilterDimension(
        locator,
        tokens
      );

    if (
      !metadata ||
      metadata.score < 100 ||
      isUnsafeFilterOptionLabel(
        metadata.label
      )
    ) {
      continue;
    }

    candidates.push({
      locator,
      ...metadata,
    });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      normalize(
        left.label
      ).localeCompare(
        normalize(right.label)
      ) ||
      left.descriptor.localeCompare(
        right.descriptor
      )
  );

  const best = candidates[0];
  const second = candidates[1];

  if (!best) {
    return null;
  }

  if (
    second &&
    best.score -
      second.score < 12
  ) {
    return null;
  }

  return best;
}


async function findRuntimeFilterDimensionByExactText(
  page: Page,
  tokens: string[]
): Promise<{
  locator: Locator;
  score: number;
  label: string;
  descriptor: string;
} | null> {
  const normalizedTokens = [
    ...new Set(
      tokens
        .map(normalize)
        .filter(Boolean)
    ),
  ];

  const candidates: Array<{
    locator: Locator;
    score: number;
    label: string;
    descriptor: string;
    key: string;
  }> = [];

  const seenKeys =
    new Set<string>();

  for (
    const token
    of normalizedTokens
  ) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const matches =
      page.getByText(
        new RegExp(
          `^\\s*${escaped}\\s*$`,
          "i"
        )
      );

    const count = Math.min(
      await matches
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const textLocator =
        matches.nth(index);

      const visible =
        await textLocator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (!visible) {
        continue;
      }

      const insideNavigation =
        await textLocator
          .locator(
            "xpath=ancestor::aside[1] | " +
            "ancestor::nav[1]"
          )
          .count()
          .catch(() => 0);

      if (insideNavigation > 0) {
        continue;
      }

      const insideOpenSurface =
        await textLocator
          .locator(
            [
              "xpath=ancestor::*[",
              '@role="menu" or ',
              '@role="listbox" or ',
              '@data-state="open" or ',
              "@data-radix-menu-content or ",
              "@data-radix-popper-content-wrapper or ",
              'contains(@class,"popover") or ',
              'contains(@class,"Popover") or ',
              'contains(@class,"dropdown") or ',
              'contains(@class,"Dropdown") or ',
              'contains(@class,"drawer") or ',
              'contains(@class,"Drawer") or ',
              'contains(@class,"sheet") or ',
              'contains(@class,"Sheet")',
              "][1]",
            ].join("")
          )
          .count()
          .catch(() => 0);

      if (insideOpenSurface === 0) {
        continue;
      }

      const label =
        String(
          await textLocator
            .innerText()
            .catch(
              async () =>
                await textLocator
                  .textContent()
                  .catch(() => "")
            )
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !label ||
        normalize(label) !== token ||
        isUnsafeFilterOptionLabel(
          label
        )
      ) {
        continue;
      }

      const semanticAncestor =
        textLocator.locator(
          [
            "xpath=",
            "ancestor-or-self::*[",
            "self::button or ",
            "self::a or ",
            "self::li or ",
            '@role="menuitem" or ',
            '@role="button" or ',
            "@aria-haspopup or ",
            "@tabindex or ",
            'contains(@class,"menu-item") or ',
            'contains(@class,"submenu-title")',
            "][1]",
          ].join("")
        );

      const semanticCount =
        await semanticAncestor
          .count()
          .catch(() => 0);

      let clickTarget =
        textLocator;

      let score = 120;

      let descriptor =
        `exact visible text "${label}"`;

      if (semanticCount > 0) {
        const promoted =
          semanticAncestor.first();

        const promotedVisible =
          await promoted
            .isVisible({
              timeout: 400,
            })
            .catch(() => false);

        if (promotedVisible) {
          clickTarget = promoted;
          score += 55;

          const role =
            await promoted
              .getAttribute("role")
              .catch(() => null);

          const hasPopup =
            await promoted
              .getAttribute(
                "aria-haspopup"
              )
              .catch(() => null);

          const tag =
            await promoted
              .getAttribute(
                "data-slot"
              )
              .catch(() => null);

          descriptor =
            [
              descriptor,
              `promoted role=${
                role ?? "none"
              }`,
              `aria-haspopup=${
                hasPopup ?? "none"
              }`,
              `data-slot=${
                tag ?? "none"
              }`,
            ].join(" | ");
        }
      }

      const box =
        await clickTarget
          .boundingBox()
          .catch(() => null);

      if (!box) {
        continue;
      }

      const key = [
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
        normalize(label),
      ].join(":");

      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);

      candidates.push({
        locator: clickTarget,
        score,
        label,
        descriptor,
        key,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  if (!best) {
    return null;
  }

  if (
    second &&
    best.score -
      second.score < 15 &&
    best.key !== second.key
  ) {
    return null;
  }

  return {
    locator: best.locator,
    score: best.score,
    label: best.label,
    descriptor:
      best.descriptor,
  };
}

export async function openRuntimeFilterDimension(
  page: Page,
  tokens: string[],
  queryKey: string
): Promise<RuntimeFilterInteractionResult> {
  let candidate =
    await findRuntimeFilterDimension(
      page,
      tokens
    );

  let usedExactTextFallback =
    false;

  if (!candidate) {
    candidate =
      await findRuntimeFilterDimensionByExactText(
        page,
        tokens
      );

    usedExactTextFallback =
      Boolean(candidate);
  }

  if (!candidate) {
    return {
      ok: false,
      note:
        `runtime filter discovery could not ` +
        `resolve a unique category entry for ` +
        `query key "${queryKey}" using either ` +
        `semantic controls or one unique exact ` +
        `visible text candidate`,
    };
  }

  const before =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const clicked =
    await clickVisible(
      candidate.locator
    );

  if (!clicked) {
    return {
      ok: false,
      note:
        `runtime filter category ` +
        `"${candidate.label}" for query key ` +
        `"${queryKey}" was not safely clickable`,
    };
  }

  await page.waitForTimeout(600);

  const expanded =
    await candidate.locator
      .getAttribute(
        "aria-expanded"
      )
      .catch(() => null);

  const state =
    await candidate.locator
      .getAttribute(
        "data-state"
      )
      .catch(() => null);

  const after =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const surfaceChanged =
    after.some(
      (signature) =>
        !before.includes(signature)
    ) ||
    before.some(
      (signature) =>
        !after.includes(signature)
    );

  const opened =
    expanded === "true" ||
    state === "open" ||
    surfaceChanged;

  if (
    !opened &&
    usedExactTextFallback
  ) {
    return {
      ok: true,
      note:
        `clicked unique exact visible runtime ` +
        `filter category "${candidate.label}" for ` +
        `query key "${queryKey}"; the category did ` +
        `not expose semantic open-state metadata, ` +
        `so downstream safe-option discovery and ` +
        `the exact URL query transition remain ` +
        `required`,
    };
  }

  if (!opened) {
    return {
      ok: false,
      note:
        `clicked runtime filter category ` +
        `"${candidate.label}", but no submenu, ` +
        `listbox or replacement surface could ` +
        `be verified`,
    };
  }

  return {
    ok: true,
    note:
      `opened and verified runtime filter ` +
      `category "${candidate.label}" for ` +
      `query key "${queryKey}"`,
  };
}
