import type {
  Page,
} from "playwright";
import {
  verifyQueryTransition,
} from "./runtime-filter-query-transition.js";
import {
  openRuntimeFilterDimension,
  visibleRuntimeFilterSurfaceSignatures,
} from "./runtime-filter-dimension.js";
import {
  findRuntimeFilterControlByPlaceholder,
} from "./runtime-filter-placeholder-control.js";
import {
  findRelevantFilterControl,
} from "./runtime-filter-control-discovery.js";
import {
  findSafeRuntimeOption,
  selectNativeOption,
} from "./runtime-filter-option-selection.js";
import type {
  RuntimeFilterInteractionResult,
} from "./runtime-filter-query-transition.js";
import {
  clickVisible,
  normalize,
  normalizeQueryKey,
  queryKeyTokens,
} from "./runtime-filter-shared.js";

export type {
  RuntimeFilterInteractionResult,
} from "./runtime-filter-query-transition.js";

export async function openRuntimeControl(
  page: Page,
  targetValue: string
): Promise<RuntimeFilterInteractionResult> {
  const normalizedTarget =
    normalize(targetValue);

  if (!normalizedTarget) {
    return {
      ok: false,
      note: "runtime control target is empty",
    };
  }

  const semanticTarget =
    normalizedTarget
      .replace(
        /^(?:select|choose|search)\s+(?:a\s+|an\s+|the\s+)?/i,
        ""
      )
      .trim() ||
    normalizedTarget;

  const candidate =
    await findRuntimeFilterControlByPlaceholder(
      page,
      queryKeyTokens(
        semanticTarget,
        normalizedTarget
      )
    );

  if (!candidate) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" could not ` +
        `be uniquely resolved by placeholder, ` +
        `accessible name or visible control text`,
    };
  }

  if (candidate.nativeSelect) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" resolved ` +
        `to a native select whose open state cannot ` +
        `be deterministically verified without ` +
        `selecting a value`,
    };
  }

  const before =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const clicked =
    await clickVisible(candidate.locator);

  if (!clicked) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" was ` +
        `resolved but was not safely clickable`,
    };
  }

  await page.waitForTimeout(500);

  const expanded =
    await candidate.locator
      .getAttribute("aria-expanded")
      .catch(() => null);

  const state =
    await candidate.locator
      .getAttribute("data-state")
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

  if (!opened) {
    return {
      ok: false,
      note:
        `clicked runtime control "${targetValue}", ` +
        `but no expanded state, listbox, dropdown ` +
        `or replacement surface was verified`,
    };
  }

  return {
    ok: true,
    note:
      `opened and verified runtime control ` +
      `"${targetValue}" using ` +
      `${candidate.descriptor}`,
  };
}


export async function selectRuntimeFilterOption(
  page: Page,
  queryKeyValue: string,
  hint?: string
): Promise<RuntimeFilterInteractionResult> {
  const queryKey =
    normalizeQueryKey(
      queryKeyValue
    );

  if (
    !/^[A-Za-z][A-Za-z0-9_.-]*$/
      .test(queryKey)
  ) {
    return {
      ok: false,
      note:
        `runtime filter query key ` +
        `"${queryKey || "(empty)"}" ` +
        `is invalid`,
    };
  }

  const tokens =
    queryKeyTokens(
      queryKey,
      hint
    );

  let controlDiscovery =
    await findRelevantFilterControl(
      page,
      tokens
    );

  let candidate =
    controlDiscovery.candidate;

  let ambiguity =
    controlDiscovery.ambiguity;

  /*
   * Some filter UIs expose a first-level menu with
   * category entries such as Project, Status or Type.
   * The actual combobox/listbox/options appear only
   * after that dimension entry is opened.
   */
  if (!candidate) {
    const dimensionResult =
      await openRuntimeFilterDimension(
        page,
        tokens,
        queryKey
      );

    if (!dimensionResult.ok) {
      return {
        ok: false,
        note:
          `runtime filter discovery could not ` +
          `resolve a unique control for query ` +
          `key "${queryKey}": ${ambiguity}; ` +
          `${dimensionResult.note}`,
      };
    }

    console.log(
      ` Runtime filter interaction: ` +
        `${dimensionResult.note}`
    );

    await page.waitForTimeout(400);

    controlDiscovery =
      await findRelevantFilterControl(
        page,
        tokens
      );

    candidate =
      controlDiscovery.candidate;

    ambiguity =
      controlDiscovery.ambiguity;

    if (!candidate) {
      candidate =
        await findRuntimeFilterControlByPlaceholder(
          page,
          tokens
        );

      if (candidate) {
        ambiguity = "";

        console.log(
          ` Runtime filter interaction: ` +
            `resolved related filter control ` +
            `from placeholder semantics: ` +
            `${candidate.descriptor}`
        );
      }
    }

    /*
     * A submenu may expose the real selectable
     * values directly rather than adding another
     * combobox control.
     */
    if (!candidate) {
      const directOption =
        await findSafeRuntimeOption(
          page,
          "",
          tokens
        );

      if (!directOption) {
        return {
          ok: false,
          note:
            `runtime filter category for query ` +
            `key "${queryKey}" opened, but no ` +
            `safe unselected option or related ` +
            `control could be resolved: ` +
            `${ambiguity}`,
        };
      }

      const beforeUrl =
        page.url();

      const selected =
        await clickVisible(
          directOption.locator
        );

      if (!selected) {
        return {
          ok: false,
          note:
            `runtime filter option ` +
            `"${directOption.label}" for query ` +
            `key "${queryKey}" was not safely ` +
            `clickable`,
        };
      }

      return verifyQueryTransition(
        page,
        beforeUrl,
        queryKey,
        directOption.label
      );
    }
  }

  if (candidate.nativeSelect) {
    return selectNativeOption(
      page,
      candidate.locator,
      queryKey
    );
  }

  const opened =
    await clickVisible(
      candidate.locator
    );

  if (!opened) {
    return {
      ok: false,
      note:
        `runtime filter control for query ` +
        `key "${queryKey}" was discovered ` +
        `but was not safely clickable`,
    };
  }

  await page.waitForTimeout(500);

  const option =
    await findSafeRuntimeOption(
      page,
      candidate.currentText,
      tokens
    );

  if (!option) {
    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    return {
      ok: false,
      note:
        `runtime filter control for query ` +
        `key "${queryKey}" opened, but no ` +
        `safe unselected option could be ` +
        `resolved`,
    };
  }

  const beforeUrl = page.url();

  const selected =
    await clickVisible(
      option.locator
    );

  if (!selected) {
    return {
      ok: false,
      note:
        `runtime filter option ` +
        `"${option.label}" for query key ` +
        `"${queryKey}" was not safely ` +
        `clickable`,
    };
  }

  return verifyQueryTransition(
    page,
    beforeUrl,
    queryKey,
    option.label
  );
}
