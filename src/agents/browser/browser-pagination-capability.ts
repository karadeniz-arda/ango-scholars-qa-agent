import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";

import {
  BROWSER_ACTIVE_MODAL_SELECTOR,
  observeBrowserPage,
  type BrowserObservation,
  type BrowserObservedCollection,
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

export type BrowserPaginationCapabilityReason =
  | "EXECUTED_VERIFIED"
  | "TRANSPORT_GUARD_REQUIRED"
  | "NON_GET_REQUEST_ATTEMPTED"
  | "COLLECTION_NOT_GROUNDED"
  | "COLLECTION_AMBIGUOUS"
  | "COLLECTION_NOT_POPULATED"
  | "PAGINATION_CONTROL_GROUP_NOT_GROUNDED"
  | "PAGINATION_CONTROL_GROUP_AMBIGUOUS"
  | "CURRENT_PAGE_UNKNOWN"
  | "NEXT_UNAVAILABLE"
  | "UNSAFE_CONSEQUENCE"
  | "ACTION_FAILED"
  | "STATE_DID_NOT_CHANGE"
  | "COLLECTION_DID_NOT_CHANGE"
  | "COLLECTION_IDENTITY_CHANGED"
  | "STATE_DID_NOT_SETTLE"
  | "INVERSE_UNAVAILABLE"
  | "RESTORATION_FAILED"
  | "SURFACE_CHANGED_UNEXPECTEDLY";

export type BrowserPaginationPageState = {
  currentPage: number;
  pageCount: number;
  totalItems?: number;
  unit?: string;
  source: "EXPLICIT_VISIBLE_TEXT";
  sourceText: string;
};

export type BrowserPaginationCapabilityState = {
  page: BrowserPaginationPageState;
  collectionId: string;
  collectionFingerprint: string;
  itemCount: number;
  routePath: string;
};

export type BrowserPaginationCapabilityResult = {
  kind: "PAGINATION_OPERATIONAL_CAPABILITY";
  status: "EXECUTED_VERIFIED" | "ABSTAINED";
  reason: BrowserPaginationCapabilityReason;
  attempted: true;
  executed: boolean;
  pageStateChanged: boolean;
  collectionStateChanged: boolean;
  settled: boolean;
  surface?: {
    routePath: string;
    collectionId: string;
    collectionLabel: string;
    collectionShape: "TABLE" | "GRID" | "CARD";
    identity: string;
    associationMethod:
      | "SOURCE_DECLARED_COLLECTION_PAGINATION"
      | "SINGLE_COLLECTION_SINGLE_PAGINATION_GROUP_IN_ACTIVE_SURFACE";
  };
  controls?: {
    next: { role: "button"; label: string };
    previous: { role: "button"; label: string };
  };
  beforeState?: BrowserPaginationCapabilityState;
  afterState?: BrowserPaginationCapabilityState;
  restoration: {
    attempted: boolean;
    settled: boolean;
    restored: boolean;
    restoredState?: BrowserPaginationCapabilityState;
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

export type BrowserPaginationCapabilityTelemetry =
  BrowserOperationalCapabilityTelemetry<
    "PAGINATION_OPERATIONAL_CAPABILITY",
    BrowserPaginationCapabilityReason
  >;

type SettlementOptions = {
  maxPolls?: number;
  pollMs?: number;
};

type GroundedPaginationSurface = {
  collection: BrowserObservedCollection;
  page: BrowserPaginationPageState;
  associationMethod:
    | "SOURCE_DECLARED_COLLECTION_PAGINATION"
    | "SINGLE_COLLECTION_SINGLE_PAGINATION_GROUP_IN_ACTIVE_SURFACE";
};

type TransitionWaitResult = {
  state: BrowserPaginationCapabilityState | null;
  pageChangedObserved: boolean;
  collectionChangedObserved: boolean;
  collectionIdentityChangedObserved: boolean;
  routeChangedObserved: boolean;
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

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function populatedItemCount(collection: BrowserObservedCollection): number {
  return collection.shape === "CARD"
    ? collection.items?.length ?? 0
    : collection.rows.length;
}

export function fingerprintPaginationCollection(
  collection: BrowserObservedCollection
): string {
  return fingerprint({
    collectionId: collection.collectionId,
    shape: collection.shape,
    rows: collection.rows.map((row) => ({
      rowId: row.rowId ?? null,
      cells: row.cells.map((cell) => [
        cell.visibleFieldId,
        cell.rawValue,
      ]),
    })),
    items: (collection.items ?? []).map((item) => ({
      sequencePosition: item.sequencePosition,
      durableItemId: item.durableItemId ?? null,
      visibleItemName: item.visibleItemName,
      fields: item.fields.map((field) => [field.field, field.rawValue]),
    })),
  });
}

export function observeExplicitPaginationPageState(
  observation: BrowserObservation
):
  | { page: BrowserPaginationPageState }
  | { reason: "CURRENT_PAGE_UNKNOWN" } {
  const matches = observation.visibleText.flatMap((text) => {
    const normalized = normalize(text);
    const match = normalized.match(
      /^(\d+)\s+of\s+(\d+)(?:\s*[•·]\s*(\d+)\s+total(?:\s+(.+))?)?$/i
    );
    if (!match) return [];
    const currentPage = Number(match[1]);
    const pageCount = Number(match[2]);
    const totalItems = match[3] === undefined
      ? undefined
      : Number(match[3]);
    if (
      !Number.isInteger(currentPage) ||
      !Number.isInteger(pageCount) ||
      currentPage < 1 ||
      pageCount < 2 ||
      currentPage > pageCount ||
      (totalItems !== undefined &&
        (!Number.isInteger(totalItems) || totalItems < 2))
    ) {
      return [];
    }
    return [{
      currentPage,
      pageCount,
      ...(totalItems === undefined ? {} : { totalItems }),
      ...(match[4] ? { unit: normalizeFolded(match[4]) } : {}),
      source: "EXPLICIT_VISIBLE_TEXT" as const,
      sourceText: normalized,
    }];
  });

  return matches.length === 1
    ? { page: matches[0]! }
    : { reason: "CURRENT_PAGE_UNKNOWN" };
}

function exactObservedControls(
  observation: BrowserObservation,
  label: string
) {
  return observation.controls.filter(
    (control) =>
      control.kind === "button" &&
      normalizeFolded(control.label) === normalizeFolded(label)
  );
}

export function groundPaginationSurface(
  observation: BrowserObservation,
  options: { requireEnabledNext?: boolean } = {}
):
  | GroundedPaginationSurface
  | { reason: BrowserPaginationCapabilityReason } {
  const collections = observation.collections ?? [];
  if (collections.length === 0) {
    return { reason: "COLLECTION_NOT_GROUNDED" };
  }
  if (collections.length !== 1) {
    return { reason: "COLLECTION_AMBIGUOUS" };
  }
  const collection = collections[0]!;
  if (populatedItemCount(collection) < 2) {
    return { reason: "COLLECTION_NOT_POPULATED" };
  }

  const previous = exactObservedControls(observation, "Previous page");
  const next = exactObservedControls(observation, "Next page");
  if (previous.length > 1 || next.length > 1) {
    return { reason: "PAGINATION_CONTROL_GROUP_AMBIGUOUS" };
  }
  if (previous.length !== 1 || next.length !== 1) {
    return { reason: "PAGINATION_CONTROL_GROUP_NOT_GROUNDED" };
  }

  let associationMethod:
    GroundedPaginationSurface["associationMethod"] =
      "SINGLE_COLLECTION_SINGLE_PAGINATION_GROUP_IN_ACTIVE_SURFACE";
  if (collection.paginationControls) {
    const sourcePrevious = collection.paginationControls.filter(
      (control) => control.kind === "PREVIOUS"
    );
    const sourceNext = collection.paginationControls.filter(
      (control) => control.kind === "NEXT"
    );
    if (sourcePrevious.length > 1 || sourceNext.length > 1) {
      return { reason: "PAGINATION_CONTROL_GROUP_AMBIGUOUS" };
    }
    if (sourcePrevious.length !== 1 || sourceNext.length !== 1) {
      return { reason: "PAGINATION_CONTROL_GROUP_NOT_GROUNDED" };
    }
    associationMethod = "SOURCE_DECLARED_COLLECTION_PAGINATION";
  }

  const page = observeExplicitPaginationPageState(observation);
  if ("reason" in page) return page;
  if (
    options.requireEnabledNext !== false &&
    next[0]!.disabled
  ) {
    return { reason: "NEXT_UNAVAILABLE" };
  }

  return {
    collection,
    page: page.page,
    associationMethod,
  };
}

function pageIdentityEqual(
  left: BrowserPaginationPageState,
  right: BrowserPaginationPageState
): boolean {
  return (
    left.currentPage === right.currentPage &&
    left.pageCount === right.pageCount &&
    left.totalItems === right.totalItems &&
    left.unit === right.unit
  );
}

function compatibleRoute(
  value: string,
  initial: URL
): boolean {
  try {
    const candidate = new URL(value);
    return (
      candidate.origin === initial.origin &&
      candidate.pathname === initial.pathname
    );
  } catch {
    return false;
  }
}

function capabilityState(args: {
  observation: BrowserObservation;
  surface: GroundedPaginationSurface;
}): BrowserPaginationCapabilityState {
  const url = new URL(args.observation.url);
  return {
    page: args.surface.page,
    collectionId: args.surface.collection.collectionId,
    collectionFingerprint:
      fingerprintPaginationCollection(args.surface.collection),
    itemCount: populatedItemCount(args.surface.collection),
    routePath: `${url.pathname}${url.search}`,
  };
}

async function activeControlRoot(
  page: Page
): Promise<Locator | Page | null> {
  const activeModals = page
    .locator(BROWSER_ACTIVE_MODAL_SELECTOR)
    .filter({ visible: true });
  const modalCount = await activeModals.count();
  if (modalCount > 1) return null;
  return modalCount === 1 ? activeModals : page;
}

async function exactEnabledButton(args: {
  page: Page;
  label: "Next page" | "Previous page";
}): Promise<Locator | null> {
  const root = await activeControlRoot(args.page);
  if (!root) return null;
  const locator = root
    .getByRole("button", {
      name: args.label,
      exact: true,
    })
    .filter({ visible: true });
  if ((await locator.count()) !== 1) return null;
  return (await locator.isEnabled().catch(() => false))
    ? locator
    : null;
}

async function clickExactSafePaginationButton(args: {
  page: Page;
  label: "Next page" | "Previous page";
}): Promise<"EXECUTED" | "UNSAFE" | "FAILED" | "AMBIGUOUS"> {
  const safety = classifyGenericBrowserActionSafety({
    actionKind: "click",
    targetSource: "control",
    targetKind: "button",
    label: args.label,
  });
  if (safety !== "TRANSIENT_REVEAL") return "UNSAFE";
  const locator = await exactEnabledButton(args);
  if (!locator) return "AMBIGUOUS";
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
    await locator.click({ trial: true, timeout: 2000 });
    await locator.click({ timeout: 2500 });
    return "EXECUTED";
  } catch {
    return "FAILED";
  }
}

async function waitForStableInitialState(args: {
  page: Page;
  initialUrl: URL;
  options?: SettlementOptions;
}): Promise<{
  observation: BrowserObservation;
  surface: GroundedPaginationSurface;
  state: BrowserPaginationCapabilityState;
} | null> {
  const maxPolls = args.options?.maxPolls ?? DEFAULT_MAX_SETTLEMENT_POLLS;
  const pollMs = args.options?.pollMs ?? DEFAULT_SETTLEMENT_POLL_MS;
  let previousSignature = "";

  for (let index = 0; index < maxPolls; index += 1) {
    const observation = await observeBrowserPage(args.page);
    const grounded = groundPaginationSurface(observation);
    if (!("reason" in grounded) && compatibleRoute(observation.url, args.initialUrl)) {
      const state = capabilityState({ observation, surface: grounded });
      const signature = fingerprint(state);
      if (signature === previousSignature) {
        return { observation, surface: grounded, state };
      }
      previousSignature = signature;
    } else {
      previousSignature = "";
    }
    await args.page.waitForTimeout(pollMs);
  }
  return null;
}

async function waitForChangedStableState(args: {
  page: Page;
  initialUrl: URL;
  before: BrowserPaginationCapabilityState;
  options?: SettlementOptions;
}): Promise<TransitionWaitResult> {
  const maxPolls = args.options?.maxPolls ?? DEFAULT_MAX_SETTLEMENT_POLLS;
  const pollMs = args.options?.pollMs ?? DEFAULT_SETTLEMENT_POLL_MS;
  let previousSignature = "";
  let pageChangedObserved = false;
  let collectionChangedObserved = false;
  let collectionIdentityChangedObserved = false;
  let routeChangedObserved = false;

  for (let index = 0; index < maxPolls; index += 1) {
    const observation = await observeBrowserPage(args.page);
    routeChangedObserved ||= !compatibleRoute(observation.url, args.initialUrl);
    const grounded = groundPaginationSurface(observation, {
      requireEnabledNext: false,
    });
    if (!("reason" in grounded)) {
      const state = capabilityState({ observation, surface: grounded });
      collectionIdentityChangedObserved ||=
        state.collectionId !== args.before.collectionId;
      if (state.collectionId === args.before.collectionId) {
        pageChangedObserved ||=
          state.page.currentPage !== args.before.page.currentPage;
        collectionChangedObserved ||=
          state.collectionFingerprint !== args.before.collectionFingerprint;
        const eligible =
          !routeChangedObserved &&
          state.page.currentPage !== args.before.page.currentPage &&
          state.page.pageCount === args.before.page.pageCount &&
          state.page.totalItems === args.before.page.totalItems &&
          state.collectionFingerprint !== args.before.collectionFingerprint;
        if (eligible) {
          const signature = fingerprint(state);
          if (signature === previousSignature) {
            return {
              state,
              pageChangedObserved,
              collectionChangedObserved,
              collectionIdentityChangedObserved,
              routeChangedObserved,
            };
          }
          previousSignature = signature;
        } else {
          previousSignature = "";
        }
      }
    }
    await args.page.waitForTimeout(pollMs);
  }

  return {
    state: null,
    pageChangedObserved,
    collectionChangedObserved,
    collectionIdentityChangedObserved,
    routeChangedObserved,
  };
}

async function waitForExactRestoredState(args: {
  page: Page;
  initialUrl: URL;
  before: BrowserPaginationCapabilityState;
  options?: SettlementOptions;
}): Promise<BrowserPaginationCapabilityState | null> {
  const maxPolls = args.options?.maxPolls ?? DEFAULT_MAX_SETTLEMENT_POLLS;
  const pollMs = args.options?.pollMs ?? DEFAULT_SETTLEMENT_POLL_MS;
  let previousSignature = "";

  for (let index = 0; index < maxPolls; index += 1) {
    const observation = await observeBrowserPage(args.page);
    const grounded = groundPaginationSurface(observation);
    if (!("reason" in grounded) && compatibleRoute(observation.url, args.initialUrl)) {
      const state = capabilityState({ observation, surface: grounded });
      const exact =
        state.collectionId === args.before.collectionId &&
        state.collectionFingerprint === args.before.collectionFingerprint &&
        pageIdentityEqual(state.page, args.before.page);
      if (exact) {
        const signature = fingerprint(state);
        if (signature === previousSignature) return state;
        previousSignature = signature;
      } else {
        previousSignature = "";
      }
    } else {
      previousSignature = "";
    }
    await args.page.waitForTimeout(pollMs);
  }
  return null;
}

export async function executeGroundedPaginationCapability(args: {
  page: Page;
  transportGuard?: BrowserProductNonGetGuard;
  settlement?: SettlementOptions;
}): Promise<BrowserPaginationCapabilityResult> {
  const guard = args.transportGuard;
  const transport = () => ({
    guardActive: Boolean(guard?.active),
    productNonGetAttemptCount: guard?.attempts.length ?? 0,
    safe: Boolean(guard?.active) && (guard?.attempts.length ?? 0) === 0,
  });
  const acceptanceProof = {
    attempted: false as const,
    reason: "OPERATIONAL_EVALUATION_ONLY" as const,
  };
  let executed = false;
  let pageStateChanged = false;
  let collectionStateChanged = false;
  let settled = false;
  let surface: BrowserPaginationCapabilityResult["surface"];
  let controls: BrowserPaginationCapabilityResult["controls"];
  let beforeState: BrowserPaginationCapabilityResult["beforeState"];
  let afterState: BrowserPaginationCapabilityResult["afterState"];
  let restoration: BrowserPaginationCapabilityResult["restoration"] = {
    attempted: false,
    settled: false,
    restored: false,
  };
  const finish = (
    reason: BrowserPaginationCapabilityReason,
    note: string
  ): BrowserPaginationCapabilityResult => ({
    kind: "PAGINATION_OPERATIONAL_CAPABILITY",
    status: reason === "EXECUTED_VERIFIED" ? "EXECUTED_VERIFIED" : "ABSTAINED",
    reason,
    attempted: true,
    executed,
    pageStateChanged,
    collectionStateChanged,
    settled,
    ...(surface ? { surface } : {}),
    ...(controls ? { controls } : {}),
    ...(beforeState ? { beforeState } : {}),
    ...(afterState ? { afterState } : {}),
    restoration,
    transportSafety: transport(),
    acceptanceProof,
    note,
  });

  const initialObservation = await observeBrowserPage(args.page);
  let initialUrl: URL;
  try {
    initialUrl = new URL(initialObservation.url);
  } catch {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Pagination could not establish the active route identity."
    );
  }
  if (!guard?.active || guard.origin !== initialUrl.origin) {
    return finish(
      "TRANSPORT_GUARD_REQUIRED",
      "Operational Pagination requires an active same-origin product non-GET guard."
    );
  }
  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "Operational Pagination abstained because the transport guard already recorded a product non-GET attempt."
    );
  }

  const initialGrounding = groundPaginationSurface(initialObservation);
  if ("reason" in initialGrounding) {
    return finish(
      initialGrounding.reason,
      `Operational Pagination abstained: ${initialGrounding.reason}.`
    );
  }

  const stableBefore = await waitForStableInitialState({
    page: args.page,
    initialUrl,
    ...(args.settlement ? { options: args.settlement } : {}),
  });
  if (!stableBefore) {
    return finish(
      "STATE_DID_NOT_SETTLE",
      "Operational Pagination could not establish a stable initial collection and page state."
    );
  }
  beforeState = stableBefore.state;
  surface = {
    routePath: initialUrl.pathname,
    collectionId: stableBefore.surface.collection.collectionId,
    collectionLabel: stableBefore.surface.collection.identity.sourceText,
    collectionShape: stableBefore.surface.collection.shape,
    identity: fingerprint([
      initialUrl.pathname,
      stableBefore.surface.collection.collectionId,
    ]),
    associationMethod: stableBefore.surface.associationMethod,
  };
  controls = {
    next: { role: "button", label: "Next page" },
    previous: { role: "button", label: "Previous page" },
  };

  const forward = await clickExactSafePaginationButton({
    page: args.page,
    label: "Next page",
  });
  if (forward === "UNSAFE") {
    return finish(
      "UNSAFE_CONSEQUENCE",
      "Operational Pagination rejected the forward control as consequential."
    );
  }
  if (forward === "AMBIGUOUS") {
    return finish(
      "PAGINATION_CONTROL_GROUP_AMBIGUOUS",
      "Operational Pagination could not re-bind one exact enabled Next control."
    );
  }
  if (forward === "FAILED") {
    return finish(
      "ACTION_FAILED",
      "Operational Pagination could not execute the exact safe Next control."
    );
  }
  executed = true;

  const transition = await waitForChangedStableState({
    page: args.page,
    initialUrl,
    before: beforeState,
    ...(args.settlement ? { options: args.settlement } : {}),
  });
  pageStateChanged = transition.pageChangedObserved;
  collectionStateChanged = transition.collectionChangedObserved;

  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "The product non-GET guard blocked a request during the forward Pagination action."
    );
  }
  if (transition.routeChangedObserved) {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Pagination changed the route surface unexpectedly."
    );
  }
  if (transition.collectionIdentityChangedObserved) {
    return finish(
      "COLLECTION_IDENTITY_CHANGED",
      "Operational Pagination could not retain the same grounded collection identity."
    );
  }
  if (!transition.pageChangedObserved) {
    return finish(
      "STATE_DID_NOT_CHANGE",
      "The exact Next action did not change the explicit current-page state."
    );
  }
  if (!transition.collectionChangedObserved) {
    return finish(
      "COLLECTION_DID_NOT_CHANGE",
      "The explicit page changed without a meaningful same-collection content change."
    );
  }
  if (!transition.state) {
    return finish(
      "STATE_DID_NOT_SETTLE",
      "The changed page and same collection did not reach two compatible stable observations."
    );
  }
  settled = true;
  afterState = transition.state;

  const inverse = await clickExactSafePaginationButton({
    page: args.page,
    label: "Previous page",
  });
  if (inverse !== "EXECUTED") {
    return finish(
      inverse === "UNSAFE" ? "UNSAFE_CONSEQUENCE" : "INVERSE_UNAVAILABLE",
      "Operational Pagination could not execute one exact safe inverse Previous control."
    );
  }
  restoration = {
    attempted: true,
    settled: false,
    restored: false,
  };

  const restoredState = await waitForExactRestoredState({
    page: args.page,
    initialUrl,
    before: beforeState,
    ...(args.settlement ? { options: args.settlement } : {}),
  });
  restoration = {
    attempted: true,
    settled: Boolean(restoredState),
    restored: Boolean(restoredState),
    ...(restoredState ? { restoredState } : {}),
  };

  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "The product non-GET guard blocked a request during Pagination restoration."
    );
  }
  if (!compatibleRoute(args.page.url(), initialUrl)) {
    return finish(
      "SURFACE_CHANGED_UNEXPECTEDLY",
      "Operational Pagination did not remain on the original route surface."
    );
  }
  if (!restoration.restored) {
    return finish(
      "RESTORATION_FAILED",
      "The original exact page and same-collection fingerprint did not restore and settle."
    );
  }

  return finish(
    "EXECUTED_VERIFIED",
    "The exact safe Next control changed and settled the same grounded collection, and Previous restored the exact original page and collection fingerprint."
  );
}

export function toPaginationCapabilityEvaluation(
  result: BrowserPaginationCapabilityResult
): BrowserOperationalCapabilityEvaluation<
  "PAGINATION_OPERATIONAL_CAPABILITY",
  BrowserPaginationCapabilityReason
> {
  const common = {
    capabilityKind: result.kind,
    attempted: result.attempted,
    executed: result.executed,
    verifiedStateChange:
      result.pageStateChanged && result.collectionStateChanged,
    settled: result.settled,
    restorationRequired: true,
    restored: result.restoration.restored,
    transportSafe: result.transportSafety.safe,
    ...(result.surface
      ? {
          surfaceIdentity:
            `${result.surface.routePath}::${result.surface.collectionId}`,
        }
      : {}),
    acceptanceProof: {
      attempted: false as const,
      withheldReason: result.acceptanceProof.reason,
    },
  };
  return result.status === "EXECUTED_VERIFIED"
    ? { ...common, status: "EXECUTED_VERIFIED" }
    : {
        ...common,
        status: "ABSTAINED",
        abstentionReason: result.reason,
      };
}

export function summarizePaginationCapability(
  results: readonly BrowserPaginationCapabilityResult[]
): BrowserPaginationCapabilityTelemetry {
  return summarizeBrowserOperationalCapabilities(
    results.map(toPaginationCapabilityEvaluation)
  );
}
