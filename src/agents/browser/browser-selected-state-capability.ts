import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";

import {
  BROWSER_ACTIVE_MODAL_SELECTOR,
  observeBrowserPage,
} from "./browser-observation.js";
import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";
import type {
  BrowserProductNonGetGuard,
} from "./browser-local-state-transition-proof.js";
import {
  summarizeBrowserOperationalCapabilities,
  type BrowserOperationalCapabilityEvaluation,
  type BrowserOperationalCapabilityTelemetry,
} from "./browser-capability-evaluation.js";

export type BrowserSelectedStateCapabilityReason =
  | "EXECUTED_VERIFIED"
  | "TRANSPORT_GUARD_REQUIRED"
  | "NON_GET_REQUEST_ATTEMPTED"
  | "GROUP_NOT_GROUNDED"
  | "GROUP_AMBIGUOUS"
  | "CONTROL_AMBIGUOUS"
  | "CURRENT_STATE_UNKNOWN"
  | "NO_SAFE_ALTERNATE"
  | "UNSAFE_CONSEQUENCE"
  | "ASSOCIATED_STATE_UNAVAILABLE"
  | "ACTION_FAILED"
  | "STATE_DID_NOT_CHANGE"
  | "ASSOCIATED_STATE_DID_NOT_CHANGE"
  | "STATE_DID_NOT_SETTLE"
  | "RESTORATION_FAILED"
  | "SURFACE_CHANGED_UNEXPECTEDLY";

export type BrowserSelectedStateSummary = {
  selectedLabel: string;
  associatedSurfaceId: string;
  associatedContentFingerprint: string;
  associatedTextLength: number;
  url: string;
};

/**
 * Operational selected-state capability evidence only. It is deliberately not
 * deterministic acceptance evidence and is not consumed by browser verdicts.
 */
export type BrowserSelectedStateCapabilityResult = {
  kind: "SELECTED_STATE_OPERATIONAL_CAPABILITY";
  status: "EXECUTED_VERIFIED" | "ABSTAINED";
  reason: BrowserSelectedStateCapabilityReason;
  attempted: true;
  executed: boolean;
  selectedStateChanged: boolean;
  associatedStateChanged: boolean;
  settled: boolean;
  surface?: {
    routePath: string;
    kind: "TABLIST";
    role: "tablist";
    label: string | null;
    identity: string;
    associationMethod: "ARIA_CONTROLS_TABPANEL";
  };
  originalSelection?: {
    label: string;
    associatedSurfaceId: string;
  };
  targetSelection?: {
    label: string;
    associatedSurfaceId: string;
    selectionStrategy: "STABLE_NORMALIZED_IDENTITY";
  };
  beforeState?: BrowserSelectedStateSummary;
  afterState?: BrowserSelectedStateSummary;
  restoration: {
    attempted: boolean;
    settled: boolean;
    restored: boolean;
  };
  transportSafety: {
    guardActive: boolean;
    productNonGetAttemptCount: number;
    safe: boolean;
  };
  acceptanceProof: {
    attempted: false;
    reason: "OPERATIONAL_EVALUATION_ONLY";
  };
  note: string;
};

export type BrowserSelectedStateCapabilityTelemetry =
  BrowserOperationalCapabilityTelemetry<
    "SELECTED_STATE_OPERATIONAL_CAPABILITY",
    BrowserSelectedStateCapabilityReason
  >;

type TabMetadata = {
  label: string;
  normalizedLabel: string;
  selected: boolean | null;
  disabled: boolean;
  controls: string | null;
};

type TabGroupMetadata = {
  label: string | null;
  tabs: TabMetadata[];
};

type GroundedTabGroup = {
  root: Locator | Page;
  label: string | null;
  identity: string;
  tabs: Array<TabMetadata & { controls: string }>;
  original: TabMetadata & { controls: string };
  target: TabMetadata & { controls: string };
};

type RawStateSnapshot = BrowserSelectedStateSummary & {
  normalizedSelectedLabel: string;
  selectedControlCount: number;
  previousSelected: boolean | null;
};

type SettlementOptions = {
  maxPolls?: number;
  pollMs?: number;
};

const DEFAULT_MAX_SETTLEMENT_POLLS = 24;
const DEFAULT_SETTLEMENT_POLL_MS = 150;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFolded(value: unknown): string {
  return normalize(value).toLocaleLowerCase("en-US");
}

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

function stateSignature(state: RawStateSnapshot): string {
  return fingerprint([
    state.normalizedSelectedLabel,
    state.associatedSurfaceId,
    state.associatedContentFingerprint,
    String(state.associatedTextLength),
    state.url,
  ]);
}

async function activeSemanticRoot(
  page: Page
): Promise<
  | { root: Locator | Page }
  | { reason: "GROUP_AMBIGUOUS" }
> {
  const activeModals = page
    .locator(BROWSER_ACTIVE_MODAL_SELECTOR)
    .filter({ visible: true });
  const count = await activeModals.count();

  if (count > 1) {
    return { reason: "GROUP_AMBIGUOUS" };
  }

  return {
    root:
      count === 1
        ? activeModals
        : page.locator("main"),
  };
}

async function observeTabGroups(
  root: Locator | Page
): Promise<TabGroupMetadata[]> {
  return root
    .locator('[role="tablist"]')
    .evaluateAll((elements) => {
      return elements.flatMap((element) => {
        const groupStyle =
          element instanceof HTMLElement
            ? window.getComputedStyle(element)
            : null;
        if (
          !(element instanceof HTMLElement) ||
          groupStyle?.display === "none" ||
          groupStyle?.visibility === "hidden" ||
          Number(groupStyle?.opacity) === 0 ||
          element.getClientRects().length === 0
        ) {
          return [];
        }

        const tabs = Array.from(
          element.querySelectorAll<HTMLElement>('[role="tab"]')
        )
          .filter((tab) => {
            const style = window.getComputedStyle(tab);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) !== 0 &&
              tab.getClientRects().length > 0
            );
          })
          .map((tab) => {
            const label = String(
              tab.getAttribute("aria-label") ||
                tab.innerText ||
                tab.textContent ||
                ""
            )
              .replace(/\s+/g, " ")
              .trim();
            const selected = tab.getAttribute("aria-selected");
            return {
              label,
              normalizedLabel: label.toLocaleLowerCase("en-US"),
              selected:
                selected === "true"
                  ? true
                  : selected === "false"
                    ? false
                    : null,
              disabled:
                tab.hasAttribute("disabled") ||
                tab.getAttribute("aria-disabled") === "true" ||
                (tab instanceof HTMLButtonElement && tab.disabled),
              controls: tab.getAttribute("aria-controls"),
            };
          });

        const labelledBy = element.getAttribute("aria-labelledby");
        const labelledByElement = labelledBy
          ? document.getElementById(labelledBy)
          : null;

        return [{
          label:
            element.getAttribute("aria-label") ||
            (labelledByElement instanceof HTMLElement
              ? String(
                  labelledByElement.getAttribute("aria-label") ||
                    labelledByElement.innerText ||
                    labelledByElement.textContent ||
                    ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
              : null),
          tabs,
        }];
      });
    })
    .catch(() => []);
}

function selectGroundedTabGroup(args: {
  root: Locator | Page;
  groups: TabGroupMetadata[];
}):
  | GroundedTabGroup
  | { reason: BrowserSelectedStateCapabilityReason } {
  if (args.groups.length === 0) {
    return { reason: "GROUP_NOT_GROUNDED" };
  }
  if (args.groups.length !== 1) {
    return { reason: "GROUP_AMBIGUOUS" };
  }

  const group = args.groups[0]!;
  if (group.tabs.length < 2) {
    return { reason: "GROUP_NOT_GROUNDED" };
  }

  const labels = group.tabs.map((tab) => tab.normalizedLabel);
  if (
    group.tabs.some((tab) => !tab.label) ||
    new Set(labels).size !== labels.length
  ) {
    return { reason: "CONTROL_AMBIGUOUS" };
  }
  if (group.tabs.some((tab) => tab.selected === null)) {
    return { reason: "CURRENT_STATE_UNKNOWN" };
  }

  const selected = group.tabs.filter((tab) => tab.selected === true);
  if (selected.length !== 1) {
    return { reason: "CURRENT_STATE_UNKNOWN" };
  }
  if (
    group.tabs.some((tab) => !tab.controls) ||
    new Set(group.tabs.map((tab) => tab.controls)).size !==
      group.tabs.length
  ) {
    return { reason: "ASSOCIATED_STATE_UNAVAILABLE" };
  }

  const original = selected[0]! as TabMetadata & { controls: string };
  const available = group.tabs.filter(
    (tab) => tab.selected === false && !tab.disabled
  ) as Array<TabMetadata & { controls: string }>;
  if (available.length === 0) {
    return { reason: "NO_SAFE_ALTERNATE" };
  }

  const safe = available.filter(
    (tab) =>
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "tab",
        label: tab.label,
      }) !== "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
  );
  if (safe.length === 0) {
    return { reason: "UNSAFE_CONSEQUENCE" };
  }

  const target = [...safe].sort((left, right) =>
    left.normalizedLabel.localeCompare(
      right.normalizedLabel,
      "en-US"
    )
  )[0]!;
  const identity = fingerprint([
    group.label ?? "",
    ...group.tabs
      .map((tab) => `${tab.normalizedLabel}:${tab.controls}`)
      .sort(),
  ]);

  return {
    root: args.root,
    label: group.label,
    identity,
    tabs: group.tabs as Array<TabMetadata & { controls: string }>,
    original,
    target,
  };
}

async function exactTabLocator(
  root: Locator | Page,
  label: string
): Promise<Locator | null> {
  const locator = root
    .getByRole("tab", { name: label, exact: true })
    .filter({ visible: true });
  return (await locator.count()) === 1
    ? locator
    : null;
}

async function captureState(args: {
  page: Page;
  tabs: Array<TabMetadata & { controls: string }>;
  previousLabel: string;
}): Promise<RawStateSnapshot | null> {
  const raw = await args.page
    .evaluate(({ expectedTabs, previousNormalizedLabel }) => {
      const allTabs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="tab"]')
      );
      const states = expectedTabs.map((expected) => {
        const matching = allTabs.filter((tab) => {
          const label = String(
            tab.getAttribute("aria-label") ||
              tab.innerText ||
              tab.textContent ||
              ""
          )
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .trim();
          const style = window.getComputedStyle(tab);
          const isVisible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            tab.getClientRects().length > 0;
          return (
            label.toLocaleLowerCase("en-US") === expected.normalizedLabel &&
            tab.getAttribute("aria-controls") === expected.controls &&
            isVisible
          );
        });
        if (matching.length !== 1) return null;
        const tab = matching[0]!;
        const selected = tab.getAttribute("aria-selected");
        return {
          label: expected.label,
          normalizedLabel: expected.normalizedLabel,
          selected:
            selected === "true"
              ? true
              : selected === "false"
                ? false
                : null,
          controls: expected.controls,
        };
      });
      if (states.some((state) => state === null)) return null;
      const exactStates = states.filter(
        (state): state is NonNullable<typeof state> => state !== null
      );
      if (exactStates.some((state) => state.selected === null)) return null;
      const selected = exactStates.filter((state) => state.selected === true);
      if (selected.length !== 1) return null;
      const selectedState = selected[0]!;
      const panel = document.getElementById(selectedState.controls);
      if (!(panel instanceof HTMLElement)) return null;
      const panelStyle = window.getComputedStyle(panel);
      if (
        panelStyle.display === "none" ||
        panelStyle.visibility === "hidden" ||
        Number(panelStyle.opacity) === 0 ||
        panel.getClientRects().length === 0
      ) {
        return null;
      }
      const visiblePanels = exactStates.filter((state) => {
        const candidate = document.getElementById(state.controls);
        if (!(candidate instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(candidate);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          candidate.getClientRects().length > 0
        );
      });
      if (visiblePanels.length !== 1) return null;
      return {
        selectedLabel: selectedState.label,
        normalizedSelectedLabel: selectedState.normalizedLabel,
        associatedSurfaceId: selectedState.controls,
        associatedText: String(panel.innerText || panel.textContent || "")
          .normalize("NFKC")
          .replace(/\s+/g, " ")
          .trim(),
        selectedControlCount: selected.length,
        previousSelected:
          exactStates.find(
            (state) => state.normalizedLabel === previousNormalizedLabel
          )?.selected ?? null,
      };
    }, {
      expectedTabs: args.tabs,
      previousNormalizedLabel: normalizeFolded(args.previousLabel),
    })
    .catch(() => null);

  if (!raw) return null;
  return {
    selectedLabel: raw.selectedLabel,
    normalizedSelectedLabel: raw.normalizedSelectedLabel,
    associatedSurfaceId: raw.associatedSurfaceId,
    associatedContentFingerprint: fingerprint([raw.associatedText]),
    associatedTextLength: raw.associatedText.length,
    selectedControlCount: raw.selectedControlCount,
    previousSelected: raw.previousSelected,
    url: args.page.url(),
  };
}

async function waitForSettledState(args: {
  page: Page;
  tabs: Array<TabMetadata & { controls: string }>;
  expectedLabel: string;
  expectedPanelId: string;
  previousLabel: string;
  options?: SettlementOptions;
}): Promise<RawStateSnapshot | null> {
  const maxPolls =
    args.options?.maxPolls ?? DEFAULT_MAX_SETTLEMENT_POLLS;
  const pollMs =
    args.options?.pollMs ?? DEFAULT_SETTLEMENT_POLL_MS;
  let priorSignature: string | null = null;

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const state = await captureState(args);
    if (
      state &&
      state.normalizedSelectedLabel === normalizeFolded(args.expectedLabel) &&
      state.associatedSurfaceId === args.expectedPanelId &&
      state.previousSelected === false
    ) {
      const signature = stateSignature(state);
      if (signature === priorSignature) return state;
      priorSignature = signature;
    } else {
      priorSignature = null;
    }
    await args.page.waitForTimeout(pollMs);
  }
  return null;
}

export async function executeGroundedSelectedStateCapability(args: {
  page: Page;
  transportGuard?: BrowserProductNonGetGuard;
  settlement?: SettlementOptions;
}): Promise<BrowserSelectedStateCapabilityResult> {
  const guard = args.transportGuard;
  const transport = () => ({
    guardActive: Boolean(guard?.active),
    productNonGetAttemptCount: guard?.attempts.length ?? 0,
    safe:
      Boolean(guard?.active) &&
      (guard?.attempts.length ?? 0) === 0,
  });
  const acceptanceProof = {
    attempted: false as const,
    reason: "OPERATIONAL_EVALUATION_ONLY" as const,
  };
  let executed = false;
  let selectedStateChanged = false;
  let associatedStateChanged = false;
  let settled = false;
  let surface: BrowserSelectedStateCapabilityResult["surface"];
  let originalSelection: BrowserSelectedStateCapabilityResult["originalSelection"];
  let targetSelection: BrowserSelectedStateCapabilityResult["targetSelection"];
  let beforeState: BrowserSelectedStateCapabilityResult["beforeState"];
  let afterState: BrowserSelectedStateCapabilityResult["afterState"];
  let restoration = {
    attempted: false,
    settled: false,
    restored: false,
  };
  const finish = (
    reason: BrowserSelectedStateCapabilityReason,
    note: string
  ): BrowserSelectedStateCapabilityResult => ({
    kind: "SELECTED_STATE_OPERATIONAL_CAPABILITY",
    status:
      reason === "EXECUTED_VERIFIED"
        ? "EXECUTED_VERIFIED"
        : "ABSTAINED",
    reason,
    attempted: true,
    executed,
    selectedStateChanged,
    associatedStateChanged,
    settled,
    ...(surface ? { surface } : {}),
    ...(originalSelection ? { originalSelection } : {}),
    ...(targetSelection ? { targetSelection } : {}),
    ...(beforeState ? { beforeState } : {}),
    ...(afterState ? { afterState } : {}),
    restoration,
    transportSafety: transport(),
    acceptanceProof,
    note,
  });

  const observation = await observeBrowserPage(args.page);
  const observedTabs = observation.controls.filter(
    (control) => control.kind === "tab" && control.role === "tab"
  );
  if (observedTabs.length < 2) {
    return finish(
      "GROUP_NOT_GROUNDED",
      "Operational Selected-State found no bounded observed tab group."
    );
  }

  const semanticRoot = await activeSemanticRoot(args.page);
  if ("reason" in semanticRoot) {
    return finish(
      semanticRoot.reason,
      "Operational Selected-State abstained because multiple active modal surfaces made scope ambiguous."
    );
  }
  const selectedGroup = selectGroundedTabGroup({
    root: semanticRoot.root,
    groups: await observeTabGroups(semanticRoot.root),
  });
  if ("reason" in selectedGroup) {
    return finish(
      selectedGroup.reason,
      `Operational Selected-State abstained: ${selectedGroup.reason}.`
    );
  }

  let initialUrl: URL;
  try {
    initialUrl = new URL(observation.url);
  } catch {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Selected-State could not establish the active route identity."
    );
  }
  surface = {
    routePath: initialUrl.pathname,
    kind: "TABLIST",
    role: "tablist",
    label: selectedGroup.label,
    identity: selectedGroup.identity,
    associationMethod: "ARIA_CONTROLS_TABPANEL",
  };
  originalSelection = {
    label: selectedGroup.original.label,
    associatedSurfaceId: selectedGroup.original.controls,
  };
  targetSelection = {
    label: selectedGroup.target.label,
    associatedSurfaceId: selectedGroup.target.controls,
    selectionStrategy: "STABLE_NORMALIZED_IDENTITY",
  };

  if (
    !guard?.active ||
    guard.origin !== initialUrl.origin
  ) {
    return finish(
      "TRANSPORT_GUARD_REQUIRED",
      "Operational Selected-State requires an active same-origin product non-GET guard."
    );
  }
  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "Operational Selected-State abstained because the transport guard already recorded a product non-GET attempt."
    );
  }

  const targetLocator = await exactTabLocator(
    selectedGroup.root,
    selectedGroup.target.label
  );
  const originalLocator = await exactTabLocator(
    selectedGroup.root,
    selectedGroup.original.label
  );
  if (!targetLocator || !originalLocator) {
    return finish(
      "CONTROL_AMBIGUOUS",
      "Operational Selected-State could not bind unique exact semantic tab controls."
    );
  }

  const stableBefore = await waitForSettledState({
    page: args.page,
    tabs: selectedGroup.tabs,
    expectedLabel: selectedGroup.original.label,
    expectedPanelId: selectedGroup.original.controls,
    previousLabel: selectedGroup.target.label,
    ...(args.settlement ? { options: args.settlement } : {}),
  });
  if (!stableBefore) {
    return finish(
      "ASSOCIATED_STATE_UNAVAILABLE",
      "Operational Selected-State could not establish one stable visible panel associated with the current tab."
    );
  }
  beforeState = stableBefore;

  const restore = async () => {
    restoration = {
      attempted: true,
      settled: false,
      restored: false,
    };
    await originalLocator.click({ timeout: 2000 }).catch(() => undefined);
    const restoredState = await waitForSettledState({
      page: args.page,
      tabs: selectedGroup.tabs,
      expectedLabel: selectedGroup.original.label,
      expectedPanelId: selectedGroup.original.controls,
      previousLabel: selectedGroup.target.label,
      ...(args.settlement ? { options: args.settlement } : {}),
    });
    let restoredRouteCompatible = false;
    try {
      const restoredUrl = new URL(args.page.url());
      restoredRouteCompatible =
        restoredUrl.origin === initialUrl.origin &&
        restoredUrl.pathname === initialUrl.pathname;
    } catch {
      restoredRouteCompatible = false;
    }
    restoration = {
      attempted: true,
      settled: Boolean(restoredState),
      restored:
        Boolean(restoredState) &&
        restoredRouteCompatible,
    };
  };

  try {
    await targetLocator.click({ timeout: 2000 });
    executed = true;
  } catch {
    await restore();
    return finish(
      "ACTION_FAILED",
      "Operational Selected-State could not activate the exact safe alternate tab."
    );
  }

  const stableAfter = await waitForSettledState({
    page: args.page,
    tabs: selectedGroup.tabs,
    expectedLabel: selectedGroup.target.label,
    expectedPanelId: selectedGroup.target.controls,
    previousLabel: selectedGroup.original.label,
    ...(args.settlement ? { options: args.settlement } : {}),
  });
  if (stableAfter) {
    afterState = stableAfter;
    selectedStateChanged =
      stableAfter.normalizedSelectedLabel !==
        stableBefore.normalizedSelectedLabel &&
      stableAfter.previousSelected === false;
    associatedStateChanged =
      stableAfter.associatedSurfaceId !==
        stableBefore.associatedSurfaceId ||
      stableAfter.associatedContentFingerprint !==
        stableBefore.associatedContentFingerprint;
    settled = true;
  }

  await restore();

  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "The product non-GET guard blocked a request during transient Selected-State evaluation."
    );
  }
  let finalUrl: URL;
  try {
    finalUrl = new URL(args.page.url());
  } catch {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Selected-State lost the active route identity."
    );
  }
  if (
    finalUrl.origin !== initialUrl.origin ||
    finalUrl.pathname !== initialUrl.pathname
  ) {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Selected-State changed the product route surface unexpectedly."
    );
  }
  if (!stableAfter) {
    return finish(
      "STATE_DID_NOT_SETTLE",
      "The intended selected tab and its associated visible panel did not reach a stable state."
    );
  }
  if (!selectedStateChanged) {
    return finish(
      "STATE_DID_NOT_CHANGE",
      "The intended tab did not become uniquely selected while the previous tab lost selection."
    );
  }
  if (!associatedStateChanged) {
    return finish(
      "ASSOCIATED_STATE_DID_NOT_CHANGE",
      "The selected control changed but its associated visible surface identity/content did not."
    );
  }
  if (!restoration.restored) {
    return finish(
      "RESTORATION_FAILED",
      "The original exact selected state and associated panel did not settle on the same route surface."
    );
  }

  return finish(
    "EXECUTED_VERIFIED",
    "The exact safe alternate tab became uniquely selected, its associated panel changed and settled, and the original state restored exactly."
  );
}

export function summarizeSelectedStateCapability(
  results: readonly BrowserSelectedStateCapabilityResult[]
): BrowserSelectedStateCapabilityTelemetry {
  return summarizeBrowserOperationalCapabilities(
    results.map(toSelectedStateCapabilityEvaluation)
  );
}

export function toSelectedStateCapabilityEvaluation(
  result: BrowserSelectedStateCapabilityResult
): BrowserOperationalCapabilityEvaluation<
  "SELECTED_STATE_OPERATIONAL_CAPABILITY",
  BrowserSelectedStateCapabilityReason
> {
  const common = {
    capabilityKind: result.kind,
    attempted: result.attempted,
    executed: result.executed,
    verifiedStateChange:
      result.selectedStateChanged &&
      result.associatedStateChanged,
    settled: result.settled,
    restorationRequired: true,
    restored: result.restoration.restored,
    transportSafe: result.transportSafety.safe,
    ...(result.surface
      ? {
          surfaceIdentity:
            `${result.surface.routePath}::` +
            result.surface.identity,
        }
      : {}),
    acceptanceProof: {
      attempted: false as const,
      withheldReason:
        result.acceptanceProof.reason,
    },
  };

  return result.status === "ABSTAINED"
    ? {
        ...common,
        status: result.status,
        abstentionReason: result.reason,
      }
    : {
        ...common,
        status: result.status,
      };
}
