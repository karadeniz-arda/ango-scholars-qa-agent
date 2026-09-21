import { createHash } from "node:crypto";

import type {
  BrowserShadowAction,
} from "./browser-agent-shadow.js";
import type {
  BrowserShadowMatchedTarget,
} from "./browser-agent-shadow-evaluator.js";
import type {
  BrowserReadOnlyExecutionResult,
} from "./browser-agent-readonly-executor.js";
import type {
  BrowserObservation,
  BrowserObservationControl,
} from "./browser-observation.js";
import {
  fingerprintPaginationCollection,
  groundPaginationSurface,
} from "./browser-pagination-capability.js";
import {
  classifyGenericBrowserActionSafety,
} from "./generic-browser-action-safety.js";
import type {
  BrowserOperationalCapabilityEvaluation,
} from "./browser-capability-evaluation.js";

export type BrowserStandardRunCapabilityKind =
  | "SELECTED_STATE_OPERATIONAL_CAPABILITY"
  | "PAGINATION_OPERATIONAL_CAPABILITY";

export type BrowserStandardRunCapabilityReason =
  | "EXECUTED_VERIFIED"
  | "EXECUTION_NOT_VERIFIED"
  | "AFTER_STATE_UNAVAILABLE"
  | "STATE_DID_NOT_CHANGE"
  | "ASSOCIATED_STATE_DID_NOT_CHANGE"
  | "COLLECTION_DID_NOT_CHANGE"
  | "COLLECTION_IDENTITY_CHANGED"
  | "SURFACE_CHANGED_UNEXPECTEDLY"
  | "STATE_DID_NOT_SETTLE";

export type BrowserStandardRunCapabilityEvaluation =
  BrowserOperationalCapabilityEvaluation<
    BrowserStandardRunCapabilityKind,
    BrowserStandardRunCapabilityReason
  >;

type RecognitionEvidence =
  | {
      kind: "SELECTED_STATE";
      targetLabel: string;
      previousLabel: string;
      associatedSurfaceId: string;
      beforeContentFingerprint: string;
      afterContentFingerprint?: string;
    }
  | {
      kind: "PAGINATION";
      direction: "NEXT" | "PREVIOUS";
      collectionId: string;
      beforePage: number;
      afterPage?: number;
      beforeCollectionFingerprint: string;
      afterCollectionFingerprint?: string;
    };

/**
 * Verdict-neutral recognition of an action the normal generic runner already
 * executed. It does not select, authorize, execute, retry, or restore actions.
 */
export type BrowserStandardRunCapabilityRecognition = {
  evaluation: BrowserStandardRunCapabilityEvaluation;
  evidence: RecognitionEvidence;
};

export type RecognizeOperationalCapabilityTransitionArgs = {
  beforeObservation: BrowserObservation;
  proposedAction: BrowserShadowAction;
  matchedTarget: BrowserShadowMatchedTarget;
  executionResult: Pick<
    BrowserReadOnlyExecutionResult,
    "status" | "executed" | "stateChanged" | "afterObservation"
  >;
  /** A later observation already produced by the next normal loop iteration. */
  settlementObservation?: BrowserObservation;
};

type GroundedSelectedState = {
  controls: BrowserObservationControl[];
  target: BrowserObservationControl & { controls: string };
  previous: BrowserObservationControl & { controls: string };
  groupIdentity: string;
  contentFingerprint: string;
  associatedTextLength: number;
  routePath: string;
  activeSurfaceIdentity: string;
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function folded(value: unknown): string {
  return normalize(value).toLocaleLowerCase("en-US");
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function routePath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function activeSurfaceIdentity(
  observation: BrowserObservation
): string | null {
  const modalSurfaces = observation.surfaces.filter(
    (surface) => surface.modal
  );
  if (modalSurfaces.length > 1) return null;
  if (modalSurfaces.length === 0) return "PAGE";
  const surface = modalSurfaces[0]!;
  return [
    surface.kind,
    surface.role,
    normalize(surface.label),
  ].join(":");
}

function tabIdentity(
  controls: readonly BrowserObservationControl[]
): string {
  return fingerprint(
    controls
      .map((control) => [
        folded(control.label),
        control.controls,
      ])
      .sort((left, right) =>
        String(left[0]).localeCompare(
          String(right[0]),
          "en-US"
        )
      )
  );
}

function selectedStateCandidate(args: {
  observation: BrowserObservation;
  targetLabel: string;
}): GroundedSelectedState | null {
  const route = routePath(args.observation.url);
  const surface = activeSurfaceIdentity(args.observation);
  if (!route || !surface) return null;

  const controls = args.observation.controls.filter(
    (control) =>
      control.kind === "tab" &&
      control.role === "tab"
  );
  if (controls.length < 2) return null;
  if (
    controls.some(
      (control) =>
        !normalize(control.label) ||
        control.selected === null ||
        !normalize(control.controls) ||
        control.controlledSurface?.id !== control.controls ||
        control.controlledSurface?.role !== "tabpanel"
    )
  ) {
    return null;
  }
  const labels = controls.map((control) => folded(control.label));
  const panelIds = controls.map((control) => normalize(control.controls));
  if (
    new Set(labels).size !== labels.length ||
    new Set(panelIds).size !== panelIds.length
  ) {
    return null;
  }

  const selected = controls.filter((control) => control.selected === true);
  const targets = controls.filter(
    (control) => folded(control.label) === folded(args.targetLabel)
  );
  if (
    selected.length !== 1 ||
    targets.length !== 1 ||
    targets[0]!.selected !== false ||
    targets[0]!.disabled
  ) {
    return null;
  }
  const visiblePanels = controls.filter(
    (control) =>
      control.controlledSurface?.visible === true
  );
  if (
    visiblePanels.length !== 1 ||
    visiblePanels[0] !== selected[0] ||
    targets[0]!.controlledSurface?.visible !== false
  ) {
    return null;
  }

  return {
    controls,
    target: targets[0]! as BrowserObservationControl & { controls: string },
    previous: selected[0]! as BrowserObservationControl & { controls: string },
    groupIdentity: tabIdentity(controls),
    contentFingerprint:
      selected[0]!.controlledSurface!.contentFingerprint,
    associatedTextLength:
      selected[0]!.controlledSurface!.textLength,
    routePath: route,
    activeSurfaceIdentity: surface,
  };
}

function selectedStateAfter(args: {
  observation: BrowserObservation;
  before: GroundedSelectedState;
}): {
  contentFingerprint: string;
  associatedTextLength: number;
  routePath: string;
  activeSurfaceIdentity: string;
} | null {
  const route = routePath(args.observation.url);
  const surface = activeSurfaceIdentity(args.observation);
  if (!route || !surface) return null;
  const controls = args.observation.controls.filter(
    (control) => control.kind === "tab" && control.role === "tab"
  );
  if (tabIdentity(controls) !== args.before.groupIdentity) return null;
  const selected = controls.filter((control) => control.selected === true);
  const target = controls.filter(
    (control) =>
      folded(control.label) === folded(args.before.target.label) &&
      normalize(control.controls) === normalize(args.before.target.controls)
  );
  const previous = controls.filter(
    (control) =>
      folded(control.label) === folded(args.before.previous.label) &&
      normalize(control.controls) === normalize(args.before.previous.controls)
  );
  if (
    selected.length !== 1 ||
    target.length !== 1 ||
    target[0]!.selected !== true ||
    previous.length !== 1 ||
    previous[0]!.selected !== false
  ) {
    return null;
  }
  const visiblePanels = controls.filter(
    (control) =>
      control.controlledSurface?.visible === true
  );
  if (
    visiblePanels.length !== 1 ||
    visiblePanels[0] !== target[0] ||
    target[0]!.controlledSurface?.id !== args.before.target.controls ||
    target[0]!.controlledSurface?.role !== "tabpanel" ||
    previous[0]!.controlledSurface?.visible !== false
  ) {
    return null;
  }
  return {
    contentFingerprint:
      target[0]!.controlledSurface.contentFingerprint,
    associatedTextLength:
      target[0]!.controlledSurface.textLength,
    routePath: route,
    activeSurfaceIdentity: surface,
  };
}

function evaluation(args: {
  capabilityKind: BrowserStandardRunCapabilityKind;
  reason: BrowserStandardRunCapabilityReason;
  executed: boolean;
  verifiedStateChange: boolean;
  settled: boolean;
  transportSafe: boolean;
  surfaceIdentity: string;
}): BrowserStandardRunCapabilityEvaluation {
  const common = {
    capabilityKind: args.capabilityKind,
    attempted: true,
    executed: args.executed,
    verifiedStateChange: args.verifiedStateChange,
    settled: args.settled,
    restorationRequired: false,
    restored: false,
    transportSafe: args.transportSafe,
    surfaceIdentity: args.surfaceIdentity,
    acceptanceProof: {
      attempted: false as const,
      withheldReason:
        "STANDARD_RUN_OPERATIONAL_RECOGNITION_HAS_NO_ACCEPTANCE_AUTHORITY",
    },
  };
  return args.reason === "EXECUTED_VERIFIED"
    ? { ...common, status: "EXECUTED_VERIFIED" }
    : {
        ...common,
        status: "ABSTAINED",
        abstentionReason: args.reason,
      };
}

function executionVerified(
  result: RecognizeOperationalCapabilityTransitionArgs["executionResult"]
): boolean {
  return (
    result.status === "EXECUTED" &&
    result.executed === true &&
    result.stateChanged === true
  );
}

function recognizeSelectedState(
  args: RecognizeOperationalCapabilityTransitionArgs
): BrowserStandardRunCapabilityRecognition | null {
  if (
    args.proposedAction.kind !== "click" ||
    args.matchedTarget.source !== "control" ||
    args.matchedTarget.kind !== "tab" ||
    folded(args.matchedTarget.label) !== folded(args.proposedAction.target)
  ) {
    return null;
  }
  const before = selectedStateCandidate({
    observation: args.beforeObservation,
    targetLabel: args.proposedAction.target,
  });
  if (!before) return null;

  const safe =
    classifyGenericBrowserActionSafety({
      actionKind: args.proposedAction.kind,
      targetSource: "control",
      targetKind: "tab",
      label: args.matchedTarget.label,
    }) !== "PERSISTED_OR_CONSEQUENTIAL_CHANGE";
  const surfaceIdentity =
    `${before.routePath}::${before.activeSurfaceIdentity}::${before.groupIdentity}`;
  const evidence: RecognitionEvidence = {
    kind: "SELECTED_STATE",
    targetLabel: before.target.label,
    previousLabel: before.previous.label,
    associatedSurfaceId: before.target.controls,
    beforeContentFingerprint: before.contentFingerprint,
  };
  if (!executionVerified(args.executionResult)) {
    return {
      evaluation: evaluation({
        capabilityKind: "SELECTED_STATE_OPERATIONAL_CAPABILITY",
        reason: "EXECUTION_NOT_VERIFIED",
        executed: args.executionResult.executed,
        verifiedStateChange: false,
        settled: false,
        transportSafe: safe,
        surfaceIdentity,
      }),
      evidence,
    };
  }
  const immediate = args.executionResult.afterObservation
    ? selectedStateAfter({
        observation: args.executionResult.afterObservation,
        before,
      })
    : null;
  if (!immediate) {
    return {
      evaluation: evaluation({
        capabilityKind: "SELECTED_STATE_OPERATIONAL_CAPABILITY",
        reason: "AFTER_STATE_UNAVAILABLE",
        executed: true,
        verifiedStateChange: false,
        settled: false,
        transportSafe: safe,
        surfaceIdentity,
      }),
      evidence,
    };
  }
  evidence.afterContentFingerprint = immediate.contentFingerprint;
  const surfaceCompatible =
    immediate.routePath === before.routePath &&
    immediate.activeSurfaceIdentity === before.activeSurfaceIdentity;
  const changed =
    before.previous.controls !== before.target.controls ||
    immediate.contentFingerprint !== before.contentFingerprint ||
    immediate.associatedTextLength !== before.associatedTextLength;
  const settled = args.settlementObservation
    ? selectedStateAfter({
        observation: args.settlementObservation,
        before,
      })
    : null;
  const stable = Boolean(
    args.settlementObservation !==
      args.executionResult.afterObservation &&
    settled &&
      settled.routePath === immediate.routePath &&
      settled.activeSurfaceIdentity === immediate.activeSurfaceIdentity &&
      settled.contentFingerprint === immediate.contentFingerprint &&
      settled.associatedTextLength === immediate.associatedTextLength
  );
  const reason: BrowserStandardRunCapabilityReason =
    !surfaceCompatible
      ? "SURFACE_CHANGED_UNEXPECTEDLY"
      : !changed
        ? "ASSOCIATED_STATE_DID_NOT_CHANGE"
        : !stable
          ? "STATE_DID_NOT_SETTLE"
          : "EXECUTED_VERIFIED";
  return {
    evaluation: evaluation({
      capabilityKind: "SELECTED_STATE_OPERATIONAL_CAPABILITY",
      reason,
      executed: true,
      verifiedStateChange:
        surfaceCompatible && changed,
      settled: stable,
      transportSafe: safe,
      surfaceIdentity,
    }),
    evidence,
  };
}

function recognizePagination(
  args: RecognizeOperationalCapabilityTransitionArgs
): BrowserStandardRunCapabilityRecognition | null {
  const normalizedTarget = folded(args.proposedAction.target);
  const direction = normalizedTarget === "next page"
    ? "NEXT"
    : normalizedTarget === "previous page"
      ? "PREVIOUS"
      : null;
  if (
    args.proposedAction.kind !== "click" ||
    args.matchedTarget.source !== "control" ||
    args.matchedTarget.kind !== "button" ||
    folded(args.matchedTarget.label) !== normalizedTarget ||
    !direction
  ) {
    return null;
  }
  const before = groundPaginationSurface(
    args.beforeObservation,
    { requireEnabledNext: direction === "NEXT" }
  );
  if ("reason" in before) return null;
  const beforeRoute = routePath(args.beforeObservation.url);
  const surface = activeSurfaceIdentity(args.beforeObservation);
  if (!beforeRoute || !surface) return null;
  const beforeFingerprint =
    fingerprintPaginationCollection(before.collection);
  const surfaceIdentity =
    `${beforeRoute}::${surface}::${before.collection.collectionId}`;
  const evidence: RecognitionEvidence = {
    kind: "PAGINATION",
    direction,
    collectionId: before.collection.collectionId,
    beforePage: before.page.currentPage,
    beforeCollectionFingerprint: beforeFingerprint,
  };
  const safe =
    classifyGenericBrowserActionSafety({
      actionKind: "click",
      targetSource: "control",
      targetKind: "button",
      label: args.matchedTarget.label,
    }) === "TRANSIENT_REVEAL";
  if (!executionVerified(args.executionResult)) {
    return {
      evaluation: evaluation({
        capabilityKind: "PAGINATION_OPERATIONAL_CAPABILITY",
        reason: "EXECUTION_NOT_VERIFIED",
        executed: args.executionResult.executed,
        verifiedStateChange: false,
        settled: false,
        transportSafe: safe,
        surfaceIdentity,
      }),
      evidence,
    };
  }
  const afterObservation = args.executionResult.afterObservation;
  if (!afterObservation) {
    return {
      evaluation: evaluation({
        capabilityKind: "PAGINATION_OPERATIONAL_CAPABILITY",
        reason: "AFTER_STATE_UNAVAILABLE",
        executed: true,
        verifiedStateChange: false,
        settled: false,
        transportSafe: safe,
        surfaceIdentity,
      }),
      evidence,
    };
  }
  const after = groundPaginationSurface(
    afterObservation,
    { requireEnabledNext: false }
  );
  if ("reason" in after) {
    return {
      evaluation: evaluation({
        capabilityKind: "PAGINATION_OPERATIONAL_CAPABILITY",
        reason: "AFTER_STATE_UNAVAILABLE",
        executed: true,
        verifiedStateChange: false,
        settled: false,
        transportSafe: safe,
        surfaceIdentity,
      }),
      evidence,
    };
  }
  const afterRoute = routePath(afterObservation.url);
  const afterSurface = activeSurfaceIdentity(afterObservation);
  const afterFingerprint =
    fingerprintPaginationCollection(after.collection);
  evidence.afterPage = after.page.currentPage;
  evidence.afterCollectionFingerprint = afterFingerprint;
  const expectedPage =
    before.page.currentPage + (direction === "NEXT" ? 1 : -1);
  const routeCompatible =
    afterRoute === beforeRoute && afterSurface === surface;
  const identityCompatible =
    after.collection.collectionId === before.collection.collectionId;
  const pageChanged =
    after.page.currentPage === expectedPage &&
    after.page.pageCount === before.page.pageCount &&
    after.page.totalItems === before.page.totalItems &&
    after.page.unit === before.page.unit;
  const collectionChanged = afterFingerprint !== beforeFingerprint;
  const settledObservation = args.settlementObservation;
  const settledSurface = settledObservation
    ? groundPaginationSurface(settledObservation, {
        requireEnabledNext: false,
      })
    : null;
  const stable = Boolean(
    settledObservation &&
      settledObservation !== afterObservation &&
      settledSurface &&
      !("reason" in settledSurface) &&
      routePath(settledObservation.url) === afterRoute &&
      activeSurfaceIdentity(settledObservation) === afterSurface &&
      settledSurface.collection.collectionId === after.collection.collectionId &&
      settledSurface.page.currentPage === after.page.currentPage &&
      settledSurface.page.pageCount === after.page.pageCount &&
      settledSurface.page.totalItems === after.page.totalItems &&
      fingerprintPaginationCollection(settledSurface.collection) ===
        afterFingerprint
  );
  const reason: BrowserStandardRunCapabilityReason =
    !routeCompatible
      ? "SURFACE_CHANGED_UNEXPECTEDLY"
      : !identityCompatible
        ? "COLLECTION_IDENTITY_CHANGED"
        : !pageChanged
          ? "STATE_DID_NOT_CHANGE"
          : !collectionChanged
            ? "COLLECTION_DID_NOT_CHANGE"
            : !stable
              ? "STATE_DID_NOT_SETTLE"
              : "EXECUTED_VERIFIED";
  return {
    evaluation: evaluation({
      capabilityKind: "PAGINATION_OPERATIONAL_CAPABILITY",
      reason,
      executed: true,
      verifiedStateChange:
        routeCompatible &&
        identityCompatible &&
        pageChanged &&
        collectionChanged,
      settled: stable,
      transportSafe: safe,
      surfaceIdentity,
    }),
    evidence,
  };
}

export function recognizeOperationalCapabilityTransition(
  args: RecognizeOperationalCapabilityTransitionArgs
): BrowserStandardRunCapabilityRecognition | null {
  return recognizeSelectedState(args) ?? recognizePagination(args);
}
