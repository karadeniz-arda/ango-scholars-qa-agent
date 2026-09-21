import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";

import type {
  BrowserCollectionFilterProbe,
  BrowserCollectionFilterRequirement,
  BrowserTestCase,
  PlannerAcceptanceSourceLedger,
} from "../../planner/types.js";
import type { BrowserDeterministicEvidence } from "./evidence-review.js";
import type {
  BrowserProductNonGetGuard,
} from "./browser-local-state-transition-proof.js";
import {
  summarizeBrowserOperationalCapabilities,
  type BrowserOperationalCapabilityEvaluation,
  type BrowserOperationalCapabilityTelemetry,
} from "./browser-capability-evaluation.js";
import {
  BROWSER_ACTIVE_MODAL_SELECTOR,
  BROWSER_OBSERVATION_INPUT_SELECTOR,
  observeBrowserPage,
  type BrowserCollectionObservationAbstention,
  type BrowserGroundedCollectionRow,
  type BrowserObservation,
  type BrowserObservedCollection,
} from "./browser-observation.js";

export type BrowserCollectionFilterUnavailableReason =
  | "SEARCH_REQUIREMENT_NOT_AUTHORITATIVE"
  | "SEARCH_CONTROL_NOT_GROUNDED"
  | "SEARCH_CONTROL_AMBIGUOUS"
  | "COLLECTION_NOT_GROUNDED"
  | "COLLECTION_AMBIGUOUS"
  | "FIELD_BINDING_NOT_AUTHORITATIVE"
  | "FIELD_NOT_GROUNDED"
  | "ROW_IDENTITY_UNAVAILABLE"
  | "SEARCH_PREDICATE_UNSUPPORTED"
  | "SEARCH_SETTLEMENT_UNVERIFIED"
  | "POST_STATE_UNAVAILABLE"
  | "COLLECTION_CHANGED"
  | "FILTER_RESULT_AMBIGUOUS";

export type BrowserCollectionFilterSnapshot = {
  collectionId: string;
  collectionLabel: string;
  collectionShape: "TABLE" | "GRID" | "CARD";
  rowCount: number;
  rowIds: string[];
  groundedRowIdentityCount: number;
  visibleFields: string[];
  rowsTruncated: boolean;
};

export type BrowserCollectionFilterProbeEvidence = {
  probeId: string;
  query: string;
  predicate: BrowserCollectionFilterProbe["predicate"];
  fieldScope: BrowserCollectionFilterProbe["fieldScope"]["kind"];
  expectation: BrowserCollectionFilterProbe["expectation"];
  status: "CONFIRMED" | "CONTRADICTED" | "UNAVAILABLE";
  passed: boolean | null;
  targetRowId?: string;
  postRowIds: string[];
  postRowCount: number;
  settlementMethod?: "CHANGED_THEN_STABLE_GROUNDED_COLLECTION";
  reason?: BrowserCollectionFilterUnavailableReason;
  note: string;
};

export type BrowserCollectionFilterEvidence = {
  kind: "COLLECTION_FILTER";
  requirementId: string;
  sourceClaim: string;
  status: "CONFIRMED" | "CONTRADICTED" | "UNAVAILABLE";
  passed: boolean | null;
  proofReady: boolean;
  controlGrounded: boolean;
  controlLabel?: string;
  controlRole?: string;
  collectionId?: string;
  preState?: BrowserCollectionFilterSnapshot;
  probes: BrowserCollectionFilterProbeEvidence[];
  coveredManualChecks: string[];
  reason?: BrowserCollectionFilterUnavailableReason;
  note: string;
};

export type BrowserCollectionFilterExecution = {
  evidence: BrowserCollectionFilterEvidence;
  deterministicEvidence: BrowserDeterministicEvidence[];
  interactionExecuted: boolean;
  stateChanged: boolean;
};

export type BrowserSearchFilterCapabilityReason =
  | "EXECUTED_VERIFIED"
  | "TRANSPORT_GUARD_REQUIRED"
  | "NON_GET_REQUEST_ATTEMPTED"
  | "CONTROL_NOT_GROUNDED"
  | "CONTROL_AMBIGUOUS"
  | "COLLECTION_NOT_GROUNDED"
  | "COLLECTION_AMBIGUOUS"
  | "QUERY_NOT_SAFE"
  | "PRE_STATE_DID_NOT_SETTLE"
  | "INPUT_VALUE_MISMATCH"
  | "STATE_DID_NOT_CHANGE"
  | "STATE_DID_NOT_SETTLE"
  | "SURFACE_CHANGED"
  | "RESTORATION_FAILED";

export type BrowserSearchFilterCapabilityStateSummary = {
  collectionFingerprint: string;
  rowCount: number;
  stateKind: "COLLECTION" | "EMPTY";
};

/**
 * Generic operational capability evidence only. It cannot create deterministic
 * acceptance evidence, a proof discharge, or a browser verdict.
 */
export type BrowserSearchFilterCapabilityResult = {
  kind: "SEARCH_FILTER_OPERATIONAL_CAPABILITY";
  status: "EXECUTED_VERIFIED" | "ABSTAINED";
  reason: BrowserSearchFilterCapabilityReason;
  attempted: true;
  executed: boolean;
  stateChanged: boolean;
  settled: boolean;
  surface?: {
    routePath: string;
    collectionId: string;
    collectionLabel: string;
    collectionShape: "TABLE" | "GRID" | "CARD";
    associationMethod:
      "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE";
  };
  control?: {
    label: string;
    role: string;
  };
  query?: {
    source: "RUNTIME_VISIBLE_COLLECTION_CONTENT";
    fingerprint: string;
    length: number;
  };
  beforeState?: BrowserSearchFilterCapabilityStateSummary;
  afterState?: BrowserSearchFilterCapabilityStateSummary;
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

export type BrowserSearchFilterCapabilityTelemetry =
  BrowserOperationalCapabilityTelemetry<
    "SEARCH_FILTER_OPERATIONAL_CAPABILITY",
    BrowserSearchFilterCapabilityReason
  >;

type GroundedSearchControl = {
  locator: Locator;
  label: string;
  role: string;
};

type SettledPostState =
  | { kind: "COLLECTION"; collection: BrowserObservedCollection }
  | {
      kind: "EMPTY";
      abstention: BrowserCollectionObservationAbstention;
    };

const MAX_SETTLEMENT_POLLS = 32;
const SETTLEMENT_POLL_MS = 150;

type OperationalSettlementOptions = {
  maxPolls?: number;
  pollMs?: number;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFolded(value: unknown): string {
  return normalize(value).toLocaleLowerCase("en-US");
}

function stableId(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 12);
}

function sourceUnitFor(
  ledger: PlannerAcceptanceSourceLedger | undefined,
  predicate: (text: string) => boolean
) {
  if (ledger?.sourceStatus !== "RESOLVED") return undefined;
  return ledger.sourceUnits.find((unit) => predicate(normalizeFolded(unit.text)));
}

/**
 * Conservatively upgrades legacy human-readable search coverage into one
 * structured requirement only when Jira authority and all required checks
 * agree on the same invoice-search contract. No runtime evidence is created.
 */
export function buildCollectionFilterRequirements(args: {
  testCase: BrowserTestCase;
  acceptanceSourceLedger?: PlannerAcceptanceSourceLedger;
}): BrowserCollectionFilterRequirement[] {
  const manualChecks = (args.testCase.manualChecks ?? [])
    .map(normalize)
    .filter(Boolean);
  const sourceSearch = sourceUnitFor(
    args.acceptanceSourceLedger,
    (text) => /\bsearch\b/.test(text) && /\binvoices?\b/.test(text)
  );
  const sourceIdentity = sourceUnitFor(
    args.acceptanceSourceLedger,
    (text) => /\binvoice number\/id\b/.test(text)
  );
  const inputCheck = manualChecks.find(
    (text) => /\bsearch input\b/i.test(text)
  );
  const idCheck = manualChecks.find(
    (text) => /\bexact numeric invoice id\b/i.test(text)
  );
  const numberCheck = manualChecks.find(
    (text) => /\bexact invoice number\b/i.test(text)
  );
  const emptyCheck = manualChecks.find(
    (text) => /\bnonmatching search term\b/i.test(text) && /\bno matching invoice\b/i.test(text)
  );

  if (
    !sourceSearch ||
    !sourceIdentity ||
    !inputCheck ||
    !idCheck ||
    !numberCheck ||
    !emptyCheck
  ) {
    return [];
  }

  const requirementId = `${args.testCase.id}-collection-filter-1`;
  const sourceRef = `${sourceIdentity.sourceRef}#${sourceIdentity.id}`;
  const fieldBinding = {
    bindingId: `collection-filter-binding-${stableId([
      requirementId,
      "Invoice Number",
      sourceRef,
    ])}`,
    requirementId,
    proposedField: "Invoice Number",
    proposalSource: "AC_EXPLICIT" as const,
    authority: "AUTHORITATIVE" as const,
    sourceRef,
  };

  return [{
    kind: "COLLECTION_FILTER",
    requirementId,
    sourceClaim: sourceIdentity.text,
    interactionKind: "TEXT_SEARCH",
    collectionHint: "invoice",
    controlSemantic: "SEARCH",
    authority: "AUTHORITATIVE",
    sourceRef,
    controlManualCheck: inputCheck,
    probes: [
      {
        probeId: `${requirementId}:row-id`,
        querySource: "RUNTIME_ROW_ID",
        predicate: "EXACT_TEXT",
        fieldScope: {
          kind: "DURABLE_ROW_ID",
          authority: "AUTHORITATIVE",
          sourceRef,
        },
        expectation: "MATCHING_ROW_INCLUDED",
        manualCheck: idCheck,
      },
      {
        probeId: `${requirementId}:invoice-number`,
        querySource: "RUNTIME_VISIBLE_FIELD",
        predicate: "CASE_INSENSITIVE_CONTAINS",
        fieldScope: {
          kind: "VISIBLE_FIELD",
          visibleLabel: "Invoice Number",
          proofFieldBinding: fieldBinding,
        },
        expectation: "MATCHING_ROW_INCLUDED",
        manualCheck: numberCheck,
      },
      {
        probeId: `${requirementId}:empty`,
        querySource: "GENERATED_NON_MATCHING",
        predicate: "CASE_INSENSITIVE_CONTAINS",
        fieldScope: {
          kind: "GLOBAL_VISIBLE_FIELDS",
          authority: "AUTHORITATIVE",
          sourceRef: `${sourceSearch.sourceRef}#${sourceSearch.id}`,
        },
        expectation: "EMPTY_FILTER_RESULT",
        manualCheck: emptyCheck,
      },
    ],
  }];
}

function collectionMatchesRequirement(
  collection: BrowserObservedCollection,
  requirement: BrowserCollectionFilterRequirement
): boolean {
  const hint = normalizeFolded(requirement.collectionHint);
  const semanticText = [
    collection.identity.sourceText,
    ...collection.fields.map((field) => field.visibleLabel),
  ].map(normalizeFolded).join(" ");

  return !hint || semanticText.includes(hint);
}

export function selectGroundedFilterCollection(args: {
  observation: BrowserObservation;
  requirement: BrowserCollectionFilterRequirement;
}):
  | { collection: BrowserObservedCollection }
  | { reason: BrowserCollectionFilterUnavailableReason } {
  const candidates = (args.observation.collections ?? [])
    .filter((collection) => collectionMatchesRequirement(collection, args.requirement));

  if (candidates.length === 0) return { reason: "COLLECTION_NOT_GROUNDED" };
  if (candidates.length !== 1) return { reason: "COLLECTION_AMBIGUOUS" };
  return { collection: candidates[0]! };
}

export function snapshotGroundedFilterCollection(
  collection: BrowserObservedCollection
): BrowserCollectionFilterSnapshot {
  return {
    collectionId: collection.collectionId,
    collectionLabel: collection.identity.sourceText,
    collectionShape: collection.shape,
    rowCount: collection.rows.length,
    rowIds: collection.rows.flatMap((row) => row.rowId ? [row.rowId] : []),
    groundedRowIdentityCount: collection.rows.filter((row) => row.rowIdentityStatus === "GROUNDED").length,
    visibleFields: collection.fields.map((field) => field.visibleLabel),
    rowsTruncated: Boolean(collection.provenance.rowsTruncated),
  };
}

function rowFieldValue(
  collection: BrowserObservedCollection,
  row: BrowserGroundedCollectionRow,
  visibleLabel: string
): string | null {
  const fields = collection.fields.filter(
    (field) => normalizeFolded(field.visibleLabel) === normalizeFolded(visibleLabel)
  );
  if (fields.length !== 1) return null;
  const cells = row.cells.filter((cell) => cell.visibleFieldId === fields[0]!.visibleFieldId);
  return cells.length === 1 ? cells[0]!.rawValue : null;
}

function predicateMatches(
  actual: string,
  query: string,
  predicate: BrowserCollectionFilterProbe["predicate"]
): boolean | null {
  if (predicate === "EXACT_TEXT") return normalize(actual) === normalize(query);
  if (predicate === "CASE_INSENSITIVE_CONTAINS") {
    return normalizeFolded(actual).includes(normalizeFolded(query));
  }
  return null;
}

function rowMatchesProbe(args: {
  requirement: BrowserCollectionFilterRequirement;
  collection: BrowserObservedCollection;
  row: BrowserGroundedCollectionRow;
  probe: BrowserCollectionFilterProbe;
  query: string;
}): boolean | null {
  const { fieldScope } = args.probe;
  if (fieldScope.kind === "DURABLE_ROW_ID") {
    if (fieldScope.authority !== "AUTHORITATIVE") return null;
    const rawId = args.row.rowIdentity?.sourceText;
    return rawId ? predicateMatches(rawId, args.query, args.probe.predicate) : null;
  }
  if (fieldScope.kind === "VISIBLE_FIELD") {
    const binding = fieldScope.proofFieldBinding;
    if (
      binding.authority !== "AUTHORITATIVE" ||
      binding.proposalSource !== "AC_EXPLICIT" ||
      binding.requirementId !== args.requirement.requirementId
    ) return null;
    const value = rowFieldValue(args.collection, args.row, fieldScope.visibleLabel);
    return value === null ? null : predicateMatches(value, args.query, args.probe.predicate);
  }
  if (fieldScope.authority !== "AUTHORITATIVE") return null;
  const matches = args.row.cells.map((cell) =>
    predicateMatches(cell.rawValue, args.query, args.probe.predicate)
  );
  return matches.some(Boolean);
}

export function evaluateCollectionFilterProbe(args: {
  requirement: BrowserCollectionFilterRequirement;
  probe: BrowserCollectionFilterProbe;
  preCollection: BrowserObservedCollection;
  postState: SettledPostState;
  query: string;
  targetRowId?: string;
  settlementVerified: boolean;
}): BrowserCollectionFilterProbeEvidence {
  const base = {
    probeId: args.probe.probeId,
    query: args.query,
    predicate: args.probe.predicate,
    fieldScope: args.probe.fieldScope.kind,
    expectation: args.probe.expectation,
    ...(args.targetRowId ? { targetRowId: args.targetRowId } : {}),
  };
  const unavailable = (
    reason: BrowserCollectionFilterUnavailableReason,
    postRowIds: string[] = [],
    postRowCount = 0
  ): BrowserCollectionFilterProbeEvidence => ({
    ...base,
    status: "UNAVAILABLE",
    passed: null,
    postRowIds,
    postRowCount,
    reason,
    note: `Collection filter proof unavailable: ${reason}.`,
  });

  if (args.requirement.authority !== "AUTHORITATIVE") {
    return unavailable("SEARCH_REQUIREMENT_NOT_AUTHORITATIVE");
  }
  if (!args.settlementVerified) return unavailable("SEARCH_SETTLEMENT_UNVERIFIED");

  if (args.postState.kind === "EMPTY") {
    const sameIdentity =
      normalizeFolded(args.postState.abstention.identity?.sourceText) ===
      normalizeFolded(args.preCollection.identity.sourceText);
    if (!sameIdentity) return unavailable("COLLECTION_CHANGED");
    const passed = args.probe.expectation === "EMPTY_FILTER_RESULT";
    return {
      ...base,
      status: passed ? "CONFIRMED" : "CONTRADICTED",
      passed,
      postRowIds: [],
      postRowCount: 0,
      settlementMethod: "CHANGED_THEN_STABLE_GROUNDED_COLLECTION",
      note: passed
        ? "The same grounded collection settled into its explicit empty result for the nonmatching query."
        : "The required matching-row query settled into an empty collection.",
    };
  }

  const post = args.postState.collection;
  if (post.collectionId !== args.preCollection.collectionId) {
    return unavailable("COLLECTION_CHANGED", [], post.rows.length);
  }
  const postRowIds = post.rows.flatMap((row) => row.rowId ? [row.rowId] : []);
  if (args.probe.expectation === "EMPTY_FILTER_RESULT") {
    return {
      ...base,
      status: "CONTRADICTED",
      passed: false,
      postRowIds,
      postRowCount: post.rows.length,
      settlementMethod: "CHANGED_THEN_STABLE_GROUNDED_COLLECTION",
      note: "The nonmatching query left visible rows in the grounded collection.",
    };
  }
  if (!args.targetRowId || post.rows.some((row) => !row.rowId)) {
    return unavailable("ROW_IDENTITY_UNAVAILABLE", postRowIds, post.rows.length);
  }

  const matches = post.rows.map((row) => rowMatchesProbe({
    requirement: args.requirement,
    collection: post,
    row,
    probe: args.probe,
    query: args.query,
  }));
  if (matches.some((match) => match === null)) {
    const fieldReason = args.probe.fieldScope.kind === "VISIBLE_FIELD"
      ? "FIELD_NOT_GROUNDED"
      : "FIELD_BINDING_NOT_AUTHORITATIVE";
    return unavailable(fieldReason, postRowIds, post.rows.length);
  }
  const targetIncluded = postRowIds.includes(args.targetRowId);
  const passed = targetIncluded && matches.every((match) => match === true);
  return {
    ...base,
    status: passed ? "CONFIRMED" : "CONTRADICTED",
    passed,
    postRowIds,
    postRowCount: post.rows.length,
    settlementMethod: "CHANGED_THEN_STABLE_GROUNDED_COLLECTION",
    note: passed
      ? "Every visible post-search row satisfies the authoritative predicate and the grounded target row remains present."
      : "Post-search membership violates the authoritative predicate or omits the grounded target row.",
  };
}

function collectionFingerprint(state: SettledPostState): string {
  if (state.kind === "EMPTY") {
    return `empty:${normalizeFolded(state.abstention.identity?.sourceText)}`;
  }
  return JSON.stringify({
    id: state.collection.collectionId,
    rows: state.collection.rows.map((row) => ({
      id: row.rowId ?? null,
      cells: row.cells.map((cell) => [cell.visibleFieldId, cell.rawValue]),
    })),
  });
}

function capabilityStateSummary(
  state: SettledPostState
): BrowserSearchFilterCapabilityStateSummary {
  return {
    collectionFingerprint: stableId([
      collectionFingerprint(state),
    ]),
    rowCount:
      state.kind === "COLLECTION"
        ? state.collection.rows.length
        : 0,
    stateKind: state.kind,
  };
}

function sameCollectionPostState(
  observation: BrowserObservation,
  preCollection: BrowserObservedCollection
): SettledPostState | null {
  const exact = (observation.collections ?? [])
    .filter((collection) => collection.collectionId === preCollection.collectionId);
  if (exact.length === 1) return { kind: "COLLECTION", collection: exact[0]! };
  const empty = (observation.collectionAbstentions ?? [])
    .filter((item) =>
      item.reason === "COLLECTION_EMPTY" &&
      normalizeFolded(item.identity?.sourceText) === normalizeFolded(preCollection.identity.sourceText)
    );
  if (empty.length === 1) return { kind: "EMPTY", abstention: empty[0]! };
  return null;
}

async function waitForChangedStableCollection(args: {
  page: Page;
  preCollection: BrowserObservedCollection;
  beforeFingerprint: string;
}): Promise<SettledPostState | null> {
  let previousFingerprint = "";
  let stableCount = 0;
  let changed = false;

  for (let index = 0; index < MAX_SETTLEMENT_POLLS; index += 1) {
    const observation = await observeBrowserPage(args.page);
    const state = sameCollectionPostState(observation, args.preCollection);
    if (state) {
      const fingerprint = collectionFingerprint(state);
      changed ||= fingerprint !== args.beforeFingerprint;
      stableCount = fingerprint === previousFingerprint ? stableCount + 1 : 1;
      previousFingerprint = fingerprint;
      if (changed && stableCount >= 2) return state;
    } else {
      stableCount = 0;
      previousFingerprint = "";
    }
    await args.page.waitForTimeout(SETTLEMENT_POLL_MS);
  }
  return null;
}

function exactOperationalPostState(
  observation: BrowserObservation,
  preCollection: BrowserObservedCollection
): SettledPostState | null {
  const collections =
    observation.collections ?? [];

  if (
    collections.length === 1 &&
    collections[0]?.collectionId ===
      preCollection.collectionId
  ) {
    return {
      kind: "COLLECTION",
      collection: collections[0],
    };
  }

  if (collections.length !== 0) {
    return null;
  }

  const empty =
    (observation.collectionAbstentions ?? [])
      .filter((item) =>
        item.reason === "COLLECTION_EMPTY" &&
        normalizeFolded(
          item.identity?.sourceText
        ) === normalizeFolded(
          preCollection.identity.sourceText
        )
      );

  return empty.length === 1
    ? { kind: "EMPTY", abstention: empty[0]! }
    : null;
}

async function waitForOperationalSettlement(args: {
  page: Page;
  preCollection: BrowserObservedCollection;
  beforeFingerprint?: string;
  options?: OperationalSettlementOptions;
}): Promise<{
  state: SettledPostState | null;
  changedObserved: boolean;
}> {
  const maxPolls = Math.max(
    2,
    Math.min(
      100,
      args.options?.maxPolls ??
        MAX_SETTLEMENT_POLLS
    )
  );
  const pollMs = Math.max(
    0,
    Math.min(
      1000,
      args.options?.pollMs ??
        SETTLEMENT_POLL_MS
    )
  );
  let previousFingerprint = "";
  let stableCount = 0;
  let changedObserved =
    args.beforeFingerprint === undefined;

  for (
    let index = 0;
    index < maxPolls;
    index += 1
  ) {
    const observation =
      await observeBrowserPage(args.page);
    const state = exactOperationalPostState(
      observation,
      args.preCollection
    );

    if (state) {
      const fingerprint =
        collectionFingerprint(state);
      changedObserved ||=
        fingerprint !==
          args.beforeFingerprint;
      stableCount =
        fingerprint === previousFingerprint
          ? stableCount + 1
          : 1;
      previousFingerprint = fingerprint;

      if (
        changedObserved &&
        stableCount >= 2
      ) {
        return { state, changedObserved };
      }
    } else {
      previousFingerprint = "";
      stableCount = 0;
    }

    await args.page.waitForTimeout(pollMs);
  }

  return {
    state: null,
    changedObserved,
  };
}

async function waitForExactOperationalState(args: {
  page: Page;
  preCollection: BrowserObservedCollection;
  expectedFingerprint: string;
  options?: OperationalSettlementOptions;
}): Promise<SettledPostState | null> {
  const maxPolls = Math.max(
    2,
    Math.min(
      100,
      args.options?.maxPolls ??
        MAX_SETTLEMENT_POLLS
    )
  );
  const pollMs = Math.max(
    0,
    Math.min(
      1000,
      args.options?.pollMs ??
        SETTLEMENT_POLL_MS
    )
  );
  let stableCount = 0;

  for (
    let index = 0;
    index < maxPolls;
    index += 1
  ) {
    const observation =
      await observeBrowserPage(args.page);
    const state = exactOperationalPostState(
      observation,
      args.preCollection
    );
    const exact =
      state &&
      collectionFingerprint(state) ===
        args.expectedFingerprint;
    stableCount = exact
      ? stableCount + 1
      : 0;

    if (state && stableCount >= 2) {
      return state;
    }

    await args.page.waitForTimeout(pollMs);
  }

  return null;
}

export function findGroundedSearchControlCandidate(
  observation: BrowserObservation
):
  | { label: string; role: string }
  | { reason: BrowserCollectionFilterUnavailableReason } {
  const candidates = observation.inputs.filter((input) => {
    const text = normalizeFolded(input.placeholder || input.label);
    return (
      !input.disabled &&
      ["textbox", "searchbox"].includes(normalizeFolded(input.role)) &&
      /^search(?:\b|\s+by\b)/.test(text)
    );
  });
  if (candidates.length === 0) return { reason: "SEARCH_CONTROL_NOT_GROUNDED" };
  if (candidates.length !== 1) return { reason: "SEARCH_CONTROL_AMBIGUOUS" };
  const candidate = candidates[0]!;
  return {
    label: normalize(candidate.placeholder || candidate.label),
    role: normalize(candidate.role),
  };
}

export function selectOperationalSearchSurface(
  observation: BrowserObservation
):
  | {
      collection: BrowserObservedCollection;
      control: { label: string; role: string };
      associationMethod:
        "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE";
    }
  | { reason: BrowserSearchFilterCapabilityReason } {
  const control =
    findGroundedSearchControlCandidate(
      observation
    );

  if ("reason" in control) {
    return {
      reason:
        control.reason ===
        "SEARCH_CONTROL_AMBIGUOUS"
          ? "CONTROL_AMBIGUOUS"
          : "CONTROL_NOT_GROUNDED",
    };
  }

  const collections =
    observation.collections ?? [];

  if (collections.length === 0) {
    return {
      reason: "COLLECTION_NOT_GROUNDED",
    };
  }

  if (collections.length !== 1) {
    return {
      reason: "COLLECTION_AMBIGUOUS",
    };
  }

  return {
    collection: collections[0]!,
    control,
    associationMethod:
      "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE",
  };
}

export function selectSafeRuntimeSearchQuery(
  collection: BrowserObservedCollection
):
  | {
      query: string;
      fingerprint: string;
    }
  | { reason: "QUERY_NOT_SAFE" } {
  if (collection.rows.length < 2) {
    return { reason: "QUERY_NOT_SAFE" };
  }

  const rowValues = collection.rows.map(
    (row) => [
      ...new Set(
        row.cells
          .map((cell) => normalize(cell.rawValue))
          .filter((value) =>
            value.length >= 3 &&
            value.length <= 64 &&
            /[\p{L}\p{N}]/u.test(value) &&
            !/^(?:undefined|null|n\/a)$/i.test(value) &&
            !/^https?:\/\//i.test(value)
          )
      ),
    ]
  );
  const candidates = [
    ...new Set(rowValues.flat()),
  ].filter((candidate) => {
    const folded = normalizeFolded(candidate);
    return rowValues.filter((values) =>
      values.some((value) =>
        normalizeFolded(value).includes(folded)
      )
    ).length === 1;
  });

  candidates.sort((left, right) =>
    stableId([
      collection.collectionId,
      normalizeFolded(left),
    ]).localeCompare(
      stableId([
        collection.collectionId,
        normalizeFolded(right),
      ])
    )
  );

  const query = candidates[0];
  return query
    ? {
        query,
        fingerprint: stableId([
          collection.collectionId,
          normalizeFolded(query),
        ]),
      }
    : { reason: "QUERY_NOT_SAFE" };
}

async function groundSearchControl(
  page: Page,
  observation: BrowserObservation
): Promise<GroundedSearchControl | BrowserCollectionFilterUnavailableReason> {
  const candidate = findGroundedSearchControlCandidate(observation);
  if ("reason" in candidate) return candidate.reason;
  const activeModals = page
    .locator(BROWSER_ACTIVE_MODAL_SELECTOR)
    .filter({ visible: true });
  const activeModalCount = await activeModals.count();
  if (activeModalCount > 1) return "SEARCH_CONTROL_AMBIGUOUS";
  const root = activeModalCount === 1 ? activeModals : page;
  const allInputs = root.locator(BROWSER_OBSERVATION_INPUT_SELECTOR);
  const semanticMatchCount = await allInputs.evaluateAll((elements, expected) =>
    elements.filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      const label = String(
        element.getAttribute("placeholder") ||
        element.getAttribute("aria-label") ||
        ""
      ).replace(/\s+/g, " ").trim();
      return visible && label === expected;
    }).length, candidate.label);
  if (semanticMatchCount === 0) return "SEARCH_CONTROL_NOT_GROUNDED";
  if (semanticMatchCount !== 1) return "SEARCH_CONTROL_AMBIGUOUS";
  const exactPlaceholder = root
    .getByPlaceholder(candidate.label, { exact: true })
    .filter({ visible: true });
  const placeholderCount = await exactPlaceholder.count();
  const exactAccessibleName = root
    .getByRole("textbox", { name: candidate.label, exact: true })
    .filter({ visible: true });
  const accessibleNameCount = await exactAccessibleName.count();
  const locator = placeholderCount === 1
    ? exactPlaceholder
    : accessibleNameCount === 1
      ? exactAccessibleName
      : null;
  if (!locator) return "SEARCH_CONTROL_NOT_GROUNDED";
  return { locator, label: candidate.label, role: candidate.role };
}

export async function executeGroundedSearchFilterCapability(args: {
  page: Page;
  transportGuard?: BrowserProductNonGetGuard;
  settlement?: OperationalSettlementOptions;
}): Promise<BrowserSearchFilterCapabilityResult> {
  const initialObservation =
    await observeBrowserPage(args.page);
  const selected =
    selectOperationalSearchSurface(
      initialObservation
    );
  const guard = args.transportGuard;
  const transport = () => ({
    guardActive: Boolean(guard?.active),
    productNonGetAttemptCount:
      guard?.attempts.length ?? 0,
    safe:
      Boolean(guard?.active) &&
      (guard?.attempts.length ?? 0) === 0,
  });
  const acceptanceProof = {
    attempted: false as const,
    reason:
      "OPERATIONAL_EVALUATION_ONLY" as const,
  };
  let executed = false;
  let stateChanged = false;
  let settled = false;
  let surface:
    BrowserSearchFilterCapabilityResult["surface"];
  let control:
    BrowserSearchFilterCapabilityResult["control"];
  let query:
    BrowserSearchFilterCapabilityResult["query"];
  let beforeState:
    BrowserSearchFilterCapabilityResult["beforeState"];
  let afterState:
    BrowserSearchFilterCapabilityResult["afterState"];
  let restoration = {
    attempted: false,
    settled: false,
    restored: false,
  };
  const finish = (
    reason: BrowserSearchFilterCapabilityReason,
    note: string
  ): BrowserSearchFilterCapabilityResult => ({
    kind:
      "SEARCH_FILTER_OPERATIONAL_CAPABILITY",
    status:
      reason === "EXECUTED_VERIFIED"
        ? "EXECUTED_VERIFIED"
        : "ABSTAINED",
    reason,
    attempted: true,
    executed,
    stateChanged,
    settled,
    ...(surface ? { surface } : {}),
    ...(control ? { control } : {}),
    ...(query ? { query } : {}),
    ...(beforeState ? { beforeState } : {}),
    ...(afterState ? { afterState } : {}),
    restoration,
    transportSafety: transport(),
    acceptanceProof,
    note,
  });

  if ("reason" in selected) {
    return finish(
      selected.reason,
      `Operational Search/Filter abstained: ${selected.reason}.`
    );
  }

  let route: URL;
  try {
    route = new URL(initialObservation.url);
  } catch {
    return finish(
      "SURFACE_CHANGED",
      "Operational Search/Filter abstained because the active route identity was unavailable."
    );
  }
  surface = {
    routePath: route.pathname,
    collectionId:
      selected.collection.collectionId,
    collectionLabel:
      selected.collection.identity.sourceText,
    collectionShape:
      selected.collection.shape,
    associationMethod:
      selected.associationMethod,
  };
  control = selected.control;

  if (
    !guard?.active ||
    guard.origin !== route.origin
  ) {
    return finish(
      "TRANSPORT_GUARD_REQUIRED",
      "Operational Search/Filter requires an active same-origin product non-GET guard."
    );
  }
  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "Operational Search/Filter abstained because the transport guard already recorded a product non-GET attempt."
    );
  }

  const groundedControl =
    await groundSearchControl(
      args.page,
      initialObservation
    );
  if (typeof groundedControl === "string") {
    return finish(
      groundedControl ===
      "SEARCH_CONTROL_AMBIGUOUS"
        ? "CONTROL_AMBIGUOUS"
        : "CONTROL_NOT_GROUNDED",
      "Operational Search/Filter could not bind the exact observed Search input."
    );
  }

  const stablePre =
    await waitForOperationalSettlement({
      page: args.page,
      preCollection: selected.collection,
      ...(args.settlement
        ? { options: args.settlement }
        : {}),
    });
  if (
    !stablePre.state ||
    stablePre.state.kind !== "COLLECTION"
  ) {
    return finish(
      "PRE_STATE_DID_NOT_SETTLE",
      "Operational Search/Filter abstained because the initial collection did not settle."
    );
  }
  const preCollection =
    stablePre.state.collection;
  const beforeFingerprint =
    collectionFingerprint(stablePre.state);
  beforeState =
    capabilityStateSummary(stablePre.state);
  const selectedQuery =
    selectSafeRuntimeSearchQuery(
      preCollection
    );
  if ("reason" in selectedQuery) {
    return finish(
      selectedQuery.reason,
      "Operational Search/Filter found no bounded runtime-derived query unique to one visible collection item."
    );
  }
  query = {
    source:
      "RUNTIME_VISIBLE_COLLECTION_CONTENT",
    fingerprint: selectedQuery.fingerprint,
    length: selectedQuery.query.length,
  };

  const restore = async () => {
    restoration = {
      attempted: true,
      settled: false,
      restored: false,
    };
    await groundedControl.locator
      .fill("")
      .catch(() => {});
    const restored =
      await waitForExactOperationalState({
        page: args.page,
        preCollection,
        expectedFingerprint:
          beforeFingerprint,
        ...(args.settlement
          ? { options: args.settlement }
          : {}),
      });
    const value =
      await groundedControl.locator
        .inputValue()
        .catch(() => "__unavailable__");
    restoration = {
      attempted: true,
      settled: Boolean(restored),
      restored:
        Boolean(restored) &&
        value === "" &&
        new URL(args.page.url()).pathname ===
          route.pathname,
    };
  };

  try {
    await groundedControl.locator.fill(
      selectedQuery.query
    );
    executed = true;
  } catch {
    await restore();
    return finish(
      "INPUT_VALUE_MISMATCH",
      "Operational Search/Filter could not apply the selected transient query."
    );
  }

  const appliedValue =
    await groundedControl.locator
      .inputValue()
      .catch(() => "");
  if (appliedValue !== selectedQuery.query) {
    await restore();
    return finish(
      "INPUT_VALUE_MISMATCH",
      "Operational Search/Filter did not observe the intended transient input value."
    );
  }

  const post =
    await waitForOperationalSettlement({
      page: args.page,
      preCollection,
      beforeFingerprint,
      ...(args.settlement
        ? { options: args.settlement }
        : {}),
    });
  stateChanged = post.changedObserved;
  settled = Boolean(post.state);
  if (post.state) {
    afterState =
      capabilityStateSummary(post.state);
  }

  await restore();

  if (guard.attempts.length > 0) {
    return finish(
      "NON_GET_REQUEST_ATTEMPTED",
      "The product non-GET guard blocked a request during transient Search/Filter evaluation."
    );
  }
  if (
    new URL(args.page.url()).pathname !==
    route.pathname
  ) {
    return finish(
      "SURFACE_CHANGED",
      "Operational Search/Filter changed the active route identity and was not accepted."
    );
  }
  if (!post.state) {
    return finish(
      post.changedObserved
        ? "STATE_DID_NOT_SETTLE"
        : "STATE_DID_NOT_CHANGE",
      post.changedObserved
        ? "The associated collection changed but did not reach a stable grounded state."
        : "The associated collection did not change after the transient query."
    );
  }
  if (!restoration.restored) {
    return finish(
      "RESTORATION_FAILED",
      "The transient Search/Filter state did not restore to the exact stable pre-state."
    );
  }

  return finish(
    "EXECUTED_VERIFIED",
    "The exact grounded Search input changed and settled the same collection, then clearing it restored the exact stable pre-state."
  );
}

export function summarizeSearchFilterCapability(
  results: readonly BrowserSearchFilterCapabilityResult[]
): BrowserSearchFilterCapabilityTelemetry {
  return summarizeBrowserOperationalCapabilities(
    results.map(toSearchFilterCapabilityEvaluation)
  );
}

export function toSearchFilterCapabilityEvaluation(
  result: BrowserSearchFilterCapabilityResult
): BrowserOperationalCapabilityEvaluation<
  "SEARCH_FILTER_OPERATIONAL_CAPABILITY",
  BrowserSearchFilterCapabilityReason
> {
  const common = {
    capabilityKind: result.kind,
    attempted: result.attempted,
    executed: result.executed,
    verifiedStateChange: result.stateChanged,
    settled: result.settled,
    restorationRequired: true,
    restored: result.restoration.restored,
    transportSafe: result.transportSafety.safe,
    ...(result.surface
      ? {
          surfaceIdentity:
            `${result.surface.routePath}::` +
            result.surface.collectionId,
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

function targetFixture(args: {
  collection: BrowserObservedCollection;
  requirement: BrowserCollectionFilterRequirement;
}):
  | { row: BrowserGroundedCollectionRow; rowId: string; invoiceNumber: string }
  | { reason: BrowserCollectionFilterUnavailableReason } {
  const numberProbe = args.requirement.probes.find(
    (probe) => probe.querySource === "RUNTIME_VISIBLE_FIELD"
  );
  if (!numberProbe || numberProbe.fieldScope.kind !== "VISIBLE_FIELD") {
    return { reason: "FIELD_NOT_GROUNDED" };
  }
  const visibleLabel = numberProbe.fieldScope.visibleLabel;
  const candidates = args.collection.rows.flatMap((row) => {
    const rawId = normalize(row.rowIdentity?.sourceText);
    const value = rowFieldValue(args.collection, row, visibleLabel);
    return row.rowId && /^\d+$/.test(rawId) && value
      ? [{ row, rowId: row.rowId, invoiceNumber: value }]
      : [];
  });
  candidates.sort((left, right) =>
    normalize(left.row.rowIdentity?.sourceText).localeCompare(
      normalize(right.row.rowIdentity?.sourceText),
      "en-US",
      { numeric: true }
    )
  );
  return candidates.length > 0 ? candidates[0]! : { reason: "ROW_IDENTITY_UNAVAILABLE" };
}

function generatedNonMatchingQuery(
  requirementId: string,
  collection: BrowserObservedCollection
): string {
  const visible = collection.rows.flatMap((row) => row.cells.map((cell) => normalizeFolded(cell.rawValue)));
  for (let counter = 0; counter < 20; counter += 1) {
    const candidate = `qa-search-${stableId([requirementId, String(counter), ...visible])}`;
    if (!visible.some((value) => value.includes(normalizeFolded(candidate)))) return candidate;
  }
  return `qa-search-${stableId([requirementId, "fallback"])}-absent`;
}

function aggregateEvidence(args: {
  requirement: BrowserCollectionFilterRequirement;
  control?: GroundedSearchControl;
  preCollection?: BrowserObservedCollection;
  probes?: BrowserCollectionFilterProbeEvidence[];
  reason?: BrowserCollectionFilterUnavailableReason;
}): BrowserCollectionFilterEvidence {
  const probes = args.probes ?? [];
  const contradicted = probes.some((probe) => probe.status === "CONTRADICTED");
  const confirmed = probes.length === args.requirement.probes.length &&
    probes.every((probe) => probe.status === "CONFIRMED");
  const status = contradicted ? "CONTRADICTED" : confirmed ? "CONFIRMED" : "UNAVAILABLE";
  const effectiveReason = args.reason ?? probes.find(
    (probe) => probe.status === "UNAVAILABLE"
  )?.reason;
  const coveredManualChecks = [
    ...(args.control && status === "CONFIRMED" && args.requirement.controlManualCheck
      ? [args.requirement.controlManualCheck]
      : []),
    ...probes.filter((probe) => probe.status === "CONFIRMED")
      .map((probe) => args.requirement.probes.find((item) => item.probeId === probe.probeId)?.manualCheck)
      .filter((value): value is string => Boolean(value)),
  ];
  return {
    kind: "COLLECTION_FILTER",
    requirementId: args.requirement.requirementId,
    sourceClaim: args.requirement.sourceClaim,
    status,
    passed: status === "CONFIRMED" ? true : status === "CONTRADICTED" ? false : null,
    proofReady: status !== "UNAVAILABLE" && Boolean(args.control && args.preCollection),
    controlGrounded: Boolean(args.control),
    ...(args.control ? { controlLabel: args.control.label, controlRole: args.control.role } : {}),
    ...(args.preCollection ? {
      collectionId: args.preCollection.collectionId,
      preState: snapshotGroundedFilterCollection(args.preCollection),
    } : {}),
    probes,
    coveredManualChecks,
    ...(effectiveReason ? { reason: effectiveReason } : {}),
    note: status === "CONFIRMED"
      ? "All authoritative collection-filter probes were deterministically confirmed."
      : status === "CONTRADICTED"
        ? "At least one authoritative collection-filter probe was deterministically contradicted."
        : `Collection-filter proof abstained${effectiveReason ? `: ${effectiveReason}` : ""}. ` +
          `Probes=${probes.map((probe) =>
            `${probe.probeId}:${probe.status}${probe.reason ? `(${probe.reason})` : ""}`
          ).join(",") || "none"}.`,
  };
}

export async function executeGroundedCollectionFilterRequirement(args: {
  page: Page;
  requirement: BrowserCollectionFilterRequirement;
  stepIndex?: number;
}): Promise<BrowserCollectionFilterExecution> {
  const stepIndex = args.stepIndex ?? 0;
  const initialObservation = await observeBrowserPage(args.page);
  const selected = selectGroundedFilterCollection({
    observation: initialObservation,
    requirement: args.requirement,
  });
  if ("reason" in selected) {
    return {
      evidence: aggregateEvidence({ requirement: args.requirement, reason: selected.reason }),
      deterministicEvidence: [], interactionExecuted: false, stateChanged: false,
    };
  }
  const groundedControl = await groundSearchControl(args.page, initialObservation);
  if (typeof groundedControl === "string") {
    return {
      evidence: aggregateEvidence({ requirement: args.requirement, preCollection: selected.collection, reason: groundedControl }),
      deterministicEvidence: [], interactionExecuted: false, stateChanged: false,
    };
  }
  const fixture = targetFixture({ collection: selected.collection, requirement: args.requirement });
  if ("reason" in fixture) {
    return {
      evidence: aggregateEvidence({ requirement: args.requirement, control: groundedControl, preCollection: selected.collection, reason: fixture.reason }),
      deterministicEvidence: [], interactionExecuted: false, stateChanged: false,
    };
  }

  const probeEvidence: BrowserCollectionFilterProbeEvidence[] = [];
  const deterministicEvidence: BrowserDeterministicEvidence[] = [];
  let previousState: SettledPostState = { kind: "COLLECTION", collection: selected.collection };
  let stateChanged = false;

  for (const probe of args.requirement.probes) {
    if (probe.querySource !== "RUNTIME_ROW_ID" && previousState.kind !== "COLLECTION") break;
    if (probeEvidence.length > 0) {
      const beforeClear = collectionFingerprint(previousState);
      await groundedControl.locator.fill("");
      const restored = await waitForChangedStableCollection({
        page: args.page,
        preCollection: selected.collection,
        beforeFingerprint: beforeClear,
      });
      if (!restored || restored.kind !== "COLLECTION") break;
      previousState = restored;
    }

    const query = probe.querySource === "RUNTIME_ROW_ID"
      ? normalize(fixture.row.rowIdentity?.sourceText)
      : probe.querySource === "RUNTIME_VISIBLE_FIELD"
        ? fixture.invoiceNumber
        : generatedNonMatchingQuery(args.requirement.requirementId, selected.collection);
    const beforeFingerprint = collectionFingerprint(previousState);
    await groundedControl.locator.fill(query);
    const valueApplied = await groundedControl.locator.inputValue().catch(() => "");
    const postState = valueApplied === query
      ? await waitForChangedStableCollection({
          page: args.page,
          preCollection: selected.collection,
          beforeFingerprint,
        })
      : null;
    stateChanged ||= Boolean(postState);
    const evaluated = postState
      ? evaluateCollectionFilterProbe({
          requirement: args.requirement,
          probe,
          preCollection: selected.collection,
          postState,
          query,
          targetRowId: fixture.rowId,
          settlementVerified: true,
        })
      : evaluateCollectionFilterProbe({
          requirement: args.requirement,
          probe,
          preCollection: selected.collection,
          postState: previousState,
          query,
          targetRowId: fixture.rowId,
          settlementVerified: false,
        });
    probeEvidence.push(evaluated);
    if (evaluated.passed !== null) {
      deterministicEvidence.push({
        stepIndex,
        oracleId: probe.probeId,
        acceptanceCritical: true,
        action: "assertCollectionFilter",
        expected: `${probe.expectation} via ${probe.predicate} on ${probe.fieldScope.kind}`,
        passed: evaluated.passed,
        note: `${evaluated.note} query=${query}; postRowCount=${evaluated.postRowCount}; postRowIds=${evaluated.postRowIds.slice(0, 20).join(",") || "none"}`,
      });
    }
    if (!postState || evaluated.status !== "CONFIRMED") break;
    previousState = postState;
  }

  const finalFingerprint = collectionFingerprint(previousState);
  await groundedControl.locator.fill("").catch(() => {});
  await waitForChangedStableCollection({
    page: args.page,
    preCollection: selected.collection,
    beforeFingerprint: finalFingerprint,
  }).catch(() => null);
  const evidence = aggregateEvidence({
    requirement: args.requirement,
    control: groundedControl,
    preCollection: selected.collection,
    probes: probeEvidence,
    ...(probeEvidence.length < args.requirement.probes.length
      ? { reason: "SEARCH_SETTLEMENT_UNVERIFIED" as const }
      : {}),
  });

  return {
    evidence,
    deterministicEvidence,
    interactionExecuted: probeEvidence.length > 0,
    stateChanged,
  };
}
