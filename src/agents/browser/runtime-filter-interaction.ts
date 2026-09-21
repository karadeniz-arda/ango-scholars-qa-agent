import type {
  Locator,
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
  RuntimeFilterVerificationMode,
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

function buildRuntimeFilterFailure(
  verification:
    RuntimeFilterVerificationMode,
  note: string,
  selectedLabel?: string
): RuntimeFilterInteractionResult {
  return {
    ok: false,
    note,
    ...(verification ===
    "visible-state"
      ? {
          ...(selectedLabel
            ? { selectedLabel }
            : {}),
          interactionSucceeded: false,
          observedSelectedLabel: null,
          visibleStateVerified: false,
        }
      : {}),
  };
}

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


export type RuntimeVisibleFilterSelectionSnapshot = {
  controlLabels: string[];
  selectedLabels: string[];
};

async function readVisibleRuntimeFilterSelection(
  page: Page,
  control?: Locator
): Promise<RuntimeVisibleFilterSelectionSnapshot> {
  const controlLabels: string[] = [];

  if (control) {
    const visible =
      await control
        .isVisible()
        .catch(() => false);

    if (visible) {
      const innerText =
        await control
          .innerText()
          .catch(() => "");

      const inputValue =
        await control
          .inputValue()
          .catch(() => "");

      controlLabels.push(
        innerText,
        inputValue
      );
    }
  }

  const selectedNodes =
    page.locator(
      [
        '[role="option"][aria-selected="true"]',
        '[role="menuitemradio"][aria-checked="true"]',
        '[role="menuitemcheckbox"][aria-checked="true"]',
        '[data-state="selected"]',
        '[data-state="checked"]',
        ".ant-select-selection-item",
        ".ant-select-item-option-selected",
        ".ant-dropdown-menu-item-selected",
        ".ant-checkbox-wrapper-checked",
        ".ant-radio-wrapper-checked",
        '[class*="select__option--is-selected"]',
        '[class*="is-selected"]',
      ].join(", ")
    );

  const count =
    Math.min(
      await selectedNodes
        .count()
        .catch(() => 0),
      100
    );

  const selectedLabels: string[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const node =
      selectedNodes.nth(index);

    const visible =
      await node
        .isVisible()
        .catch(() => false);

    if (!visible) {
      continue;
    }

    const text = String(
      await node
        .innerText()
        .catch(async () =>
          await node
            .getAttribute("aria-label")
            .catch(() => "")
        )
    )
      .replace(/\s+/g, " ")
      .trim();

    if (text) {
      selectedLabels.push(text);
    }
  }

  return {
    controlLabels:
      controlLabels
        .map((label) =>
          String(label || "")
            .replace(/\s+/g, " ")
            .trim()
        )
        .filter(Boolean),
    selectedLabels,
  };
}

function findExactObservedSelectedLabel(
  snapshot:
    RuntimeVisibleFilterSelectionSnapshot,
  selectedLabel: string
): string | null {
  const expected =
    normalize(selectedLabel);

  if (!expected) {
    return null;
  }

  return (
    [
      ...snapshot.controlLabels,
      ...snapshot.selectedLabels,
    ].find(
      (label) =>
        normalize(label) === expected
    ) ?? null
  );
}

export async function verifyVisibleRuntimeFilterSelection(
  page: Page,
  selectedLabel: string,
  before:
    RuntimeVisibleFilterSelectionSnapshot,
  control?: Locator
): Promise<RuntimeFilterInteractionResult> {
  await page.waitForTimeout(500);

  let after =
    await readVisibleRuntimeFilterSelection(
      page,
      control
    );

  const beforeObservedLabel =
    findExactObservedSelectedLabel(
      before,
      selectedLabel
    );

  let observedSelectedLabel =
    findExactObservedSelectedLabel(
      after,
      selectedLabel
    );

  if (
    beforeObservedLabel !== null ||
    observedSelectedLabel === null
  ) {
    await page.waitForTimeout(700);

    after =
      await readVisibleRuntimeFilterSelection(
        page,
        control
      );

    observedSelectedLabel =
      findExactObservedSelectedLabel(
        after,
        selectedLabel
      );
  }

  if (
    beforeObservedLabel === null &&
    observedSelectedLabel !== null
  ) {
    return {
      ok: true,
      selectedLabel,
      interactionSucceeded: true,
      observedSelectedLabel,
      visibleStateVerified: true,
      note:
        `selected runtime filter option ` +
        `"${selectedLabel}" and verified exact ` +
        `visible selected label ` +
        `"${observedSelectedLabel}"`,
    };
  }

  return {
    ok: false,
    selectedLabel,
    interactionSucceeded: true,
    observedSelectedLabel,
    visibleStateVerified: false,
    note:
      `selected runtime filter option ` +
      `"${selectedLabel}", but the post-action ` +
      `selected label was ` +
      `${observedSelectedLabel === null
        ? "not exactly observable"
        : `"${observedSelectedLabel}"`} ` +
      `or was already present before selection`,
  };
}


export async function selectRuntimeFilterOption(
  page: Page,
  queryKeyValue: string,
  hint?: string,
  verification:
    RuntimeFilterVerificationMode = "url"
): Promise<RuntimeFilterInteractionResult> {
  const queryKey =
    normalizeQueryKey(
      queryKeyValue
    );

  if (
    !/^[A-Za-z][A-Za-z0-9_.-]*$/
      .test(queryKey)
  ) {
    return buildRuntimeFilterFailure(
      verification,
        `runtime filter query key ` +
        `"${queryKey || "(empty)"}" ` +
        `is invalid`
    );
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
      return buildRuntimeFilterFailure(
        verification,
          `runtime filter discovery could not ` +
          `resolve a unique control for query ` +
          `key "${queryKey}": ${ambiguity}; ` +
          `${dimensionResult.note}`
      );
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
        return buildRuntimeFilterFailure(
          verification,
            `runtime filter category for query ` +
            `key "${queryKey}" opened, but no ` +
            `safe unselected option or related ` +
            `control could be resolved: ` +
            `${ambiguity}`
        );
      }

      const beforeUrl =
        page.url();

      const beforeVisibleState =
        verification === "visible-state"
          ? await readVisibleRuntimeFilterSelection(
              page
            )
          : null;

      const selected =
        await clickVisible(
          directOption.locator
        );

      if (!selected) {
        return buildRuntimeFilterFailure(
          verification,
            `runtime filter option ` +
            `"${directOption.label}" for query ` +
            `key "${queryKey}" was not safely ` +
            `clickable`,
          directOption.label
        );
      }

      if (
        verification === "visible-state" &&
        beforeVisibleState
      ) {
        return verifyVisibleRuntimeFilterSelection(
          page,
          directOption.label,
          beforeVisibleState
        );
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
      queryKey,
      verification
    );
  }

  const opened =
    await clickVisible(
      candidate.locator
    );

  if (!opened) {
    return buildRuntimeFilterFailure(
      verification,
        `runtime filter control for query ` +
        `key "${queryKey}" was discovered ` +
        `but was not safely clickable`
    );
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

    return buildRuntimeFilterFailure(
      verification,
        `runtime filter control for query ` +
        `key "${queryKey}" opened, but no ` +
        `safe unselected option could be ` +
        `resolved`
    );
  }

  const beforeUrl = page.url();

  const beforeVisibleState =
    verification === "visible-state"
      ? await readVisibleRuntimeFilterSelection(
          page,
          candidate.locator
        )
      : null;

  const selected =
    await clickVisible(
      option.locator
    );

  if (!selected) {
    return buildRuntimeFilterFailure(
      verification,
        `runtime filter option ` +
        `"${option.label}" for query key ` +
        `"${queryKey}" was not safely ` +
        `clickable`,
      option.label
    );
  }

  if (
    verification === "visible-state" &&
    beforeVisibleState
  ) {
    return verifyVisibleRuntimeFilterSelection(
      page,
      option.label,
      beforeVisibleState,
      candidate.locator
    );
  }

  return verifyQueryTransition(
    page,
    beforeUrl,
    queryKey,
    option.label
  );
}
