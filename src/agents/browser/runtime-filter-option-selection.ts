import type {
  Locator,
  Page,
} from "playwright";
import {
  verifyQueryTransition,
} from "./runtime-filter-query-transition.js";
import type {
  RuntimeFilterInteractionResult,
  RuntimeFilterVerificationMode,
} from "./runtime-filter-query-transition.js";
import {
  isUnsafeFilterOptionLabel,
  normalize,
} from "./runtime-filter-shared.js";
import type {
  RuntimeOptionCandidate,
} from "./runtime-filter-shared.js";

export async function selectNativeOption(
  page: Page,
  control: Locator,
  queryKey: string,
  verification:
    RuntimeFilterVerificationMode = "url"
): Promise<RuntimeFilterInteractionResult> {
  const options = await control
    .locator("option")
    .evaluateAll(
      (elements) =>
        elements.map(
          (element) => {
            const option =
              element as
                HTMLOptionElement;

            return {
              label:
                String(
                  option.label ||
                  option.textContent ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim(),
              value:
                String(
                  option.value || ""
                ),
              selected:
                option.selected,
              disabled:
                option.disabled,
            };
          }
        )
    )
    .catch(() => []);

  const safeOptions = options
    .filter(
      (option) =>
      !option.selected &&
      !option.disabled &&
      option.value.length > 0 &&
      !isUnsafeFilterOptionLabel(
        option.label
      )
    )
    .sort(
      (left, right) =>
        normalize(
          left.label
        ).localeCompare(
          normalize(right.label)
        ) ||
        left.value.localeCompare(
          right.value
        )
    );

  const target = safeOptions[0];

  if (!target) {
    return {
      ok: false,
      ...(verification ===
      "visible-state"
        ? {
            interactionSucceeded:
              false,
            observedSelectedLabel:
              null,
            visibleStateVerified:
              false,
          }
        : {}),
      note:
        `runtime filter control for ` +
        `"${queryKey}" exposed no safe ` +
        `unselected native option`,
    };
  }

  const beforeUrl = page.url();

  try {
    await control.selectOption({
      value: target.value,
    });
  } catch {
    return {
      ok: false,
      ...(verification ===
      "visible-state"
        ? {
            selectedLabel:
              target.label,
            interactionSucceeded:
              false,
            observedSelectedLabel:
              null,
            visibleStateVerified:
              false,
          }
        : {}),
      note:
        `runtime native filter option ` +
        `"${target.label}" for ` +
        `"${queryKey}" was not safely ` +
        `selectable`,
    };
  }

  if (verification === "visible-state") {
    await page.waitForTimeout(400);

    const selectedValue =
      await control
        .inputValue()
        .catch(() => "");

    const selectedLabel =
      String(
        await control
          .locator("option:checked")
          .textContent()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();

    if (
      selectedValue === target.value &&
      normalize(selectedLabel) ===
        normalize(target.label)
    ) {
      return {
        ok: true,
        selectedLabel:
          target.label,
        interactionSucceeded: true,
        observedSelectedLabel:
          selectedLabel,
        visibleStateVerified: true,
        note:
          `selected runtime filter option ` +
          `"${target.label}" and verified ` +
          `the native control visible selected state`,
      };
    }

    return {
      ok: false,
      selectedLabel:
        target.label,
      interactionSucceeded: true,
      observedSelectedLabel:
        selectedLabel || null,
      visibleStateVerified: false,
      note:
        `selected runtime filter option ` +
        `"${target.label}", but the native ` +
        `control selected state was observed as ` +
        `${selectedLabel
          ? `"${selectedLabel}"`
          : "unavailable"} instead of an exact ` +
        `target match`,
    };
  }

  return verifyQueryTransition(
    page,
    beforeUrl,
    queryKey,
    target.label
  );
}

async function readRuntimeOption(
  locator: Locator,
  currentText: string
): Promise<{
  label: string;
  score: number;
} | null> {
  return locator
    .evaluate(
      (
        element,
        rawCurrentText
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

        const disabled =
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          element.hasAttribute(
            "disabled"
          );

        const selected =
          element.getAttribute(
            "aria-selected"
          ) === "true" ||
          element.getAttribute(
            "aria-checked"
          ) === "true" ||
          element.getAttribute(
            "data-state"
          ) === "checked" ||
          element.getAttribute(
            "data-state"
          ) === "selected";

        if (
          disabled ||
          selected
        ) {
          return null;
        }

        const normalizedLabel =
          String(label ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const normalizedCurrentText =
          String(rawCurrentText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        if (
          normalizedLabel ===
          normalizedCurrentText
        ) {
          return null;
        }

        const role =
          element.getAttribute(
            "role"
          );

        const insideOpenSurface =
          Boolean(
            element.closest(
              [
                '[role="listbox"]',
                '[role="menu"]',
                '[data-state="open"]',
                '[data-radix-menu-content]',
                '[data-radix-popper-content-wrapper]',
                '[class*="popover"]',
                '[class*="Popover"]',
                '[class*="dropdown"]',
                '[class*="Dropdown"]',
              ].join(",")
            )
          );

        if (!insideOpenSurface) {
          return null;
        }

        let score = 20;

        if (role === "option") {
          score += 80;
        }

        if (
          role ===
            "menuitemradio" ||
          role ===
            "menuitemcheckbox"
        ) {
          score += 55;
        }

        if (
          element.hasAttribute(
            "data-radix-collection-item"
          )
        ) {
          score += 20;
        }

        if (
          element.hasAttribute(
            "data-combobox-option"
          )
        ) {
          score += 75;
        }

        if (
          element.hasAttribute(
            "data-option"
          ) ||
          element.hasAttribute(
            "data-select-option"
          )
        ) {
          score += 60;
        }

        const className =
          typeof element.className ===
          "string"
            ? element.className
                .toLowerCase()
            : "";

        if (
          /select-item-option-selected|select__option--is-selected|(^|\s)is-selected(\s|$)/
            .test(className) ||
          /select-item-option-disabled|select__option--is-disabled|(^|\s)is-disabled(\s|$)/
            .test(className)
        ) {
          return null;
        }

        if (
          /combobox-option|select-option|select-item-option|select__option|dropdown-item/
            .test(className)
        ) {
          score += 70;
        }

        return {
          label,
          score,
        };
      },
      currentText
    )
    .catch(() => null);
}

export async function findSafeRuntimeOption(
  page: Page,
  currentText: string,
  forbiddenExactLabels: string[] = []
): Promise<RuntimeOptionCandidate | null> {
  const options = page.locator(
    [
      '[role="option"]',
      '[role="menuitemradio"]',
      '[role="menuitemcheckbox"]',
      '[data-radix-collection-item]',
      '[data-combobox-option]',
      '[data-option]',
      '[data-select-option]',
      '[class*="Combobox-option"]',
      '[class*="combobox-option"]',
      '[class*="Select-option"]',
      '[class*="select-option"]',
      '[class*="select-item-option"]:not([class*="content"])',
      '[class*="Select-item-option"]:not([class*="content"])',
      '[class*="select__option"]',
      '[class*="Select__option"]',
      '[class*="dropdown-item"]',
      '[class*="Dropdown-item"]',
    ].join(", ")
  );

  const count = Math.min(
    await options
      .count()
      .catch(() => 0),
    100
  );

  const candidates:
    RuntimeOptionCandidate[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      options.nth(index);

    const hasPopup =
      await locator
        .getAttribute(
          "aria-haspopup"
        )
        .catch(() => null);

    if (hasPopup) {
      continue;
    }

    const metadata =
      await readRuntimeOption(
        locator,
        currentText
      );

    const normalizedLabel =
      normalize(
        metadata?.label
      );

    const isForbiddenDimensionLabel =
      forbiddenExactLabels.some(
        (label) =>
          normalize(label) ===
          normalizedLabel
      );

    if (
      !metadata ||
      isForbiddenDimensionLabel ||
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
      )
  );

  const best =
    candidates[0];

  if (best) {
    const duplicateBest =
      candidates.slice(1).some(
        (candidate) =>
          candidate.score ===
            best.score &&
          normalize(
            candidate.label
          ) ===
            normalize(best.label)
      );

    if (duplicateBest) {
      return null;
    }

    return best;
  }

  /*
   * Ant Design and similarly structured selects may
   * expose clickable option rows without ARIA roles.
   * Restrict this fallback to visible option rows
   * inside an open select dropdown.
   */
  const structuredOptions =
    page.locator(
      [
        ".ant-select-dropdown:not(" +
          ".ant-select-dropdown-hidden) " +
          ".ant-select-item-option",
        '[class*="select-dropdown"]' +
          ':not([class*="hidden"]) ' +
          '[class*="select-item-option"]' +
          ':not([class*="option-content"])',
      ].join(", ")
    );

  const structuredCount =
    Math.min(
      await structuredOptions
        .count()
        .catch(() => 0),
      100
    );

  const structuredCandidates:
    RuntimeOptionCandidate[] = [];

  for (
    let index = 0;
    index < structuredCount;
    index += 1
  ) {
    const locator =
      structuredOptions.nth(index);

    const metadata =
      await locator
        .evaluate((element) => {
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
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(style.opacity) !==
              0 &&
            style.pointerEvents !==
              "none" &&
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

          const className =
            typeof element.className ===
              "string"
              ? element.className
                  .toLowerCase()
              : "";

          const disabled =
            element.getAttribute(
              "aria-disabled"
            ) === "true" ||
            element.hasAttribute(
              "disabled"
            ) ||
            /option-disabled|is-disabled/
              .test(className);

          const selected =
            element.getAttribute(
              "aria-selected"
            ) === "true" ||
            element.getAttribute(
              "aria-checked"
            ) === "true" ||
            /option-selected|is-selected/
              .test(className);

          if (
            disabled ||
            selected
          ) {
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

          return {
            label,
            score: 115,
          };
        })
        .catch(() => null);

    if (!metadata) {
      continue;
    }

    const normalizedLabel =
      normalize(metadata.label);

    const forbidden =
      forbiddenExactLabels.some(
        (label) =>
          normalize(label) ===
          normalizedLabel
      );

    if (
      forbidden ||
      normalize(currentText) ===
        normalizedLabel ||
      isUnsafeFilterOptionLabel(
        metadata.label
      )
    ) {
      continue;
    }

    structuredCandidates.push({
      locator,
      label: metadata.label,
      score: metadata.score,
    });
  }

  structuredCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      normalize(
        left.label
      ).localeCompare(
        normalize(right.label)
      )
  );

  const structuredBest =
    structuredCandidates[0];

  if (structuredBest) {
    const duplicateBest =
      structuredCandidates
        .slice(1)
        .some(
          (candidate) =>
            candidate.score ===
              structuredBest.score &&
            normalize(
              candidate.label
            ) ===
              normalize(
                structuredBest.label
              )
        );

    if (duplicateBest) {
      return null;
    }

    console.log(
      ` Runtime filter option discovery ` +
        `resolved structured option ` +
        `"${structuredBest.label}"`
    );

    return structuredBest;
  }

  /*
   * Diagnostic fallback: report the live DOM shape
   * of visible option-like descendants when the
   * semantic resolver finds no candidate.
   */
  const diagnostics =
    await page
      .locator(
        [
          '[role="listbox"]',
          '[role="menu"]',
          '[data-state="open"]',
          '[data-radix-menu-content]',
          '[data-radix-popper-content-wrapper]',
          '[class*="dropdown"]',
          '[class*="Dropdown"]',
          '[class*="popover"]',
          '[class*="Popover"]',
        ].join(", ")
      )
      .evaluateAll(
        (surfaces) => {
          const rows: string[] = [];
          const seen =
            new Set<string>();

          for (const surface of surfaces) {
            if (
              !(
                surface instanceof
                HTMLElement
              )
            ) {
              continue;
            }

            const elements =
              surface.querySelectorAll<
                HTMLElement
              >(
                "div,li,span,button"
              );

            for (const element of elements) {
              const style =
                window.getComputedStyle(
                  element
                );

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
                  .trim();

              const className =
                typeof element.className ===
                "string"
                  ? element.className
                  : "";

              const role =
                element.getAttribute(
                  "role"
                ) || "none";

              const visible =
                style.display !== "none" &&
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

              const candidateLike =
                style.cursor ===
                  "pointer" ||
                role !== "none" ||
                /option|item|select|menu|virtual|dropdown/i
                  .test(className);

              if (
                !visible ||
                !candidateLike ||
                !text ||
                text.length > 120
              ) {
                continue;
              }

              const key = [
                Math.round(rect.x),
                Math.round(rect.y),
                Math.round(rect.width),
                Math.round(rect.height),
                text,
              ].join(":");

              if (seen.has(key)) {
                continue;
              }

              seen.add(key);

              rows.push(
                [
                  `tag=${
                    element.tagName
                      .toLowerCase()
                  }`,
                  `role=${role}`,
                  `cursor=${style.cursor}`,
                  `class=${
                    className
                      .replace(/\s+/g, ".")
                      .slice(0, 180)
                  }`,
                  `text=${
                    text.slice(0, 100)
                  }`,
                ].join("|")
              );

              if (rows.length >= 40) {
                return rows;
              }
            }
          }

          return rows;
        }
      )
      .catch(() => []);

  console.log(
    ` Runtime filter option discovery ` +
      `diagnostics: ${
        diagnostics.length > 0
          ? diagnostics.join(" || ")
          : "no visible option-like nodes found"
      }`
  );

  return null;
}
