import type {
  Locator,
  Page,
} from "playwright";
import {
  isUnsafeFilterOptionLabel,
  normalize,
} from "./runtime-filter-shared.js";
import type {
  FilterControlCandidate,
} from "./runtime-filter-shared.js";

async function promoteRuntimeFilterPlaceholderTarget(
  rawLocator: Locator
): Promise<{
  locator: Locator;
  scoreBonus: number;
  strategy: string;
} | null> {
  const semanticAncestor =
    rawLocator.locator(
      [
        "xpath=",
        "ancestor-or-self::*[",
        "self::select or ",
        "self::input or ",
        "self::button or ",
        "self::a or ",
        '@role="combobox" or ',
        '@role="button" or ',
        '@role="menuitem" or ',
        "@aria-haspopup or ",
        "@tabindex",
        "][1]",
      ].join("")
    );

  const semanticCount =
    await semanticAncestor
      .count()
      .catch(() => 0);

  if (semanticCount > 0) {
    const candidate =
      semanticAncestor.first();

    const visible =
      await candidate
        .isVisible({
          timeout: 400,
        })
        .catch(() => false);

    const box =
      visible
        ? await candidate
            .boundingBox()
            .catch(() => null)
        : null;

    if (
      visible &&
      box &&
      box.width >= 20 &&
      box.height >= 16
    ) {
      return {
        locator: candidate,
        scoreBonus: 45,
        strategy:
          "semantic ancestor",
      };
    }
  }

  /*
   * Some React select components render the visible
   * placeholder as a span inside an unlabelled div.
   * The parent is still a safe control when it:
   * - is a close ancestor of the exact placeholder;
   * - is visible and bounded like an input/control;
   * - exposes pointer/trigger styling or metadata;
   * - is outside navigation.
   */
  let ancestor =
    rawLocator;

  for (
    let depth = 1;
    depth <= 6;
    depth += 1
  ) {
    ancestor =
      ancestor.locator(
        "xpath=.."
      );

    const exists =
      await ancestor
        .count()
        .catch(() => 0);

    if (exists === 0) {
      break;
    }

    const metadata =
      await ancestor
        .evaluate(
          (element) => {
            if (
              !(
                element instanceof
                HTMLElement
              )
            ) {
              return null;
            }

            if (
              element.matches(
                "html, body"
              ) ||
              element.closest(
                "aside, nav"
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
              style.display !== "none" &&
              style.visibility !==
                "hidden" &&
              Number(style.opacity) !==
                0 &&
              style.pointerEvents !==
                "none" &&
              rect.width >= 40 &&
              rect.height >= 20 &&
              rect.width <= 900 &&
              rect.height <= 180 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top <
                window.innerHeight &&
              rect.left <
                window.innerWidth;

            if (!visible) {
              return null;
            }

            const tag =
              element.tagName
                .toLowerCase();

            const role =
              element.getAttribute(
                "role"
              ) || "";

            const className =
              typeof element.className ===
              "string"
                ? element.className
                    .toLowerCase()
                : "";

            const tabIndexValue =
              element.getAttribute(
                "tabindex"
              );

            const semantic =
              [
                "button",
                "a",
                "input",
                "select",
              ].includes(tag) ||
              [
                "button",
                "combobox",
                "menuitem",
              ].includes(role) ||
              element.hasAttribute(
                "aria-haspopup"
              ) ||
              (
                tabIndexValue !== null &&
                Number(tabIndexValue) >= 0
              );

            const explicitTriggerMetadata =
              element.hasAttribute(
                "data-state"
              ) ||
              element.hasAttribute(
                "data-slot"
              ) ||
              element.hasAttribute(
                "data-radix-collection-item"
              ) ||
              element.hasAttribute(
                "onclick"
              );

            const placeholderLikeClass =
              /placeholder|selection-item|selected-value|value-container|label|display-text/
                .test(className);

            const controlLikeClass =
              !placeholderLikeClass &&
              /(^|[\\s_-])(select|selector|combobox|dropdown|trigger|input|control)([\\s_-]|$)/
                .test(className);

            const pointerTrigger =
              style.cursor ===
                "pointer";

            const visualTrigger =
              pointerTrigger ||
              explicitTriggerMetadata ||
              controlLikeClass;

            /*
             * Visible placeholder/value spans may include
             * "select" in their class name while still being
             * only text nodes inside the real control.
             */
            if (
              !semantic &&
              style.cursor ===
                "text"
            ) {
              return null;
            }

            if (
              !semantic &&
              tag === "span" &&
              !pointerTrigger &&
              !explicitTriggerMetadata
            ) {
              return null;
            }

            if (
              !semantic &&
              !visualTrigger
            ) {
              return null;
            }

            const text =
              String(
                element.innerText ||
                element.textContent ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 240);

            return {
              tag,
              role,
              cursor:
                style.cursor,
              text,
              className:
                className.slice(
                  0,
                  300
                ),
            };
          }
        )
        .catch(() => null);

    if (!metadata) {
      continue;
    }

    const visible =
      await ancestor
        .isVisible({
          timeout: 400,
        })
        .catch(() => false);

    if (!visible) {
      continue;
    }

    return {
      locator: ancestor,
      scoreBonus:
        Math.max(
          15,
          42 - depth * 4
        ),
      strategy:
        `visual ancestor depth=${depth} ` +
        `tag=${metadata.tag} ` +
        `role=${
          metadata.role || "none"
        } ` +
        `cursor=${metadata.cursor}`,
    };
  }

  return null;
}

export async function findRuntimeFilterControlByPlaceholder(
  root: Page | Locator,
  tokens: string[],
  options: {
    exactCurrentText?: string;
  } = {}
): Promise<FilterControlCandidate | null> {
  const normalizedTokens = [
    ...new Set(
      tokens
        .map(normalize)
        .filter(Boolean)
    ),
  ];

  const sources: Array<{
    locator: Locator;
    baseScore: number;
    source: string;
  }> = [];

  for (
    const token
    of normalizedTokens
  ) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const tokenRegex =
      new RegExp(
        escaped,
        "i"
      );

    const placeholderRegex =
      new RegExp(
        `^\\s*(?:select|choose|search)` +
        `\\s+(?:a\\s+|an\\s+|the\\s+)?` +
        `${escaped}\\s*$`,
        "i"
      );

    sources.push(
      {
        /*
         * Stable semantic label association is intentionally
         * checked before placeholder/current-value signals.
         *
         * Playwright getByLabel resolves accessible labelling
         * relationships such as:
         * - <label for>
         * - wrapping <label>
         * - aria-label
         * - aria-labelledby
         *
         * This remains stable when a selected value replaces
         * the control's placeholder.
         */
        locator:
          root.getByLabel(
            tokenRegex
          ),
        baseScore: 240,
        source:
          `label association contains "${token}"`,
      },
      {
        locator:
          root.getByPlaceholder(
            tokenRegex
          ),
        baseScore: 230,
        source:
          `placeholder contains "${token}"`,
      },
      {
        locator:
          root.getByRole(
            "combobox",
            {
              name: tokenRegex,
            }
          ),
        baseScore: 220,
        source:
          `combobox name contains "${token}"`,
      },
      {
        locator:
          root.getByText(
            placeholderRegex
          ),
        baseScore: 180,
        source:
          `visible placeholder text for "${token}"`,
      }
    );
  }

  const candidates:
    Array<
      FilterControlCandidate & {
        key: string;
      }
    > = [];

  const seen =
    new Set<string>();

  for (const source of sources) {
    const count = Math.min(
      await source.locator
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const rawLocator =
        source.locator.nth(index);

      const visible =
        await rawLocator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (!visible) {
        continue;
      }

      const navigationAncestorCount =
        await rawLocator
          .locator(
            "xpath=ancestor::aside[1] | " +
            "ancestor::nav[1]"
          )
          .count()
          .catch(() => 0);

      if (
        navigationAncestorCount > 0
      ) {
        continue;
      }

      let clickTarget =
        rawLocator;

      let score =
        source.baseScore;

      let promotionStrategy =
        "raw placeholder element";

      const promotedTarget =
        await promoteRuntimeFilterPlaceholderTarget(
          rawLocator
        );

      if (promotedTarget) {
        clickTarget =
          promotedTarget.locator;

        score +=
          promotedTarget.scoreBonus;

        promotionStrategy =
          promotedTarget.strategy;
      }

      const box =
        await clickTarget
          .boundingBox()
          .catch(() => null);

      if (!box) {
        continue;
      }

      const currentText =
        String(
          await clickTarget
            .getAttribute(
              "placeholder"
            )
            .catch(() => null) ||
          await clickTarget
            .getAttribute(
              "aria-label"
            )
            .catch(() => null) ||
          await clickTarget
            .innerText()
            .catch(() => "") ||
          await clickTarget
            .textContent()
            .catch(() => "") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !currentText ||
        isUnsafeFilterOptionLabel(
          currentText
        ) &&
        !/^(select|choose|search)\b/i
          .test(currentText)
      ) {
        continue;
      }

      const key = [
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
      ].join(":");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const nativeSelect =
        await clickTarget
          .evaluate(
            (element) =>
              element.tagName
                .toLowerCase() ===
              "select"
          )
          .catch(() => false);

      const role =
        await clickTarget
          .getAttribute("role")
          .catch(() => null);

      const tagName =
        await clickTarget
          .evaluate(
            (element) =>
              element.tagName
                .toLowerCase()
          )
          .catch(() => "unknown");

      candidates.push({
        locator:
          clickTarget,

        score,

        descriptor:
          [
            source.source,
            `tag=${tagName}`,
            `role=${
              role ?? "none"
            }`,
            `text=${currentText}`,
            `promotion=${promotionStrategy}`,
          ].join(" | "),

        currentText,

        nativeSelect,

        key,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score
  );

  const requiredExactText =
    normalize(
      options.exactCurrentText
    );

  if (requiredExactText) {
    const exactCandidates =
      candidates.filter(
        (candidate) =>
          normalize(
            candidate.currentText
          ) === requiredExactText
      );

    if (exactCandidates.length === 1) {
      const exact =
        exactCandidates[0]!;

      return {
        locator:
          exact.locator,

        score:
          exact.score,

        descriptor:
          `${exact.descriptor} | exact current-text match`,

        currentText:
          exact.currentText,

        nativeSelect:
          exact.nativeSelect,
      };
    }

    /*
     * Exact resolution was explicitly requested.
     * Do not fall back to a fuzzy candidate.
     */
    return null;
  }

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
      second.score < 12 &&
    best.key !== second.key
  ) {
    return null;
  }

  return {
    locator:
      best.locator,

    score:
      best.score,

    descriptor:
      best.descriptor,

    currentText:
      best.currentText,

    nativeSelect:
      best.nativeSelect,
  };
}
