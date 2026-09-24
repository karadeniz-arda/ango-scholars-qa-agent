import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import type {
  BrowserExecutionVerdictScope,
} from "../../planner/types.js";
import type {
  BrowserOrderingEvidence,
  BrowserOrderingEvidenceParity,
} from "./browser-ordering-evidence.js";
import type {
  BrowserCollectionFilterEvidence,
} from "./browser-grounded-search-proof.js";
import type {
  BrowserGroundedLocalStateTransitionEvidence,
} from "./browser-local-state-transition-proof.js";
import type {
  BrowserCaseProofReadiness,
  BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import type {
  BrowserDeterministicCasePassEligibilityDecision,
  BrowserDeterministicPassValidationContext,
  BrowserLocalStatePassProof,
  BrowserSourceBoundAssertionSetPassProof,
} from "./browser-deterministic-pass-policy.js";
import type { BrowserDeterministicPassRuntimeContext } from "./browser-deterministic-pass-runtime-context.js";
import type {
  BrowserRuntimeFixturePreparationResult,
} from "./browser-runtime-fixture-preparation.js";
import type {
  BrowserEvidenceContractProofCoverage,
  BrowserEvidenceContractProofResult,
} from "./browser-evidence-contract-proof.js";
import type {
  BrowserRuntimeSourceAssertionAllocation,
  BrowserSourceBoundAssertionSetEvidence,
  BrowserSourceBoundAssertionSetRequirement,
} from "./browser-source-bound-assertion-set-proof.js";
import type { BrowserCaseVerdictResult } from "./browser-case-verdict.js";
import type { BrowserRuntimeExecutionBinding } from "./browser-runtime-execution-binding.js";
import type { BrowserRuntimeExecutionBindingValidationReason } from "./browser-runtime-execution-binding.js";
import type {
  BrowserSourceBoundStructuralControlPresenceEvidence,
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "./browser-source-bound-structural-control-presence-proof.js";
import type { BrowserHumanReadableQaResult } from "./browser-human-readable-result.js";

export type BrowserStep =
  | { action: "wait"; ms: number }
  | { action: "reload" }
  | { action: "clickTopTab"; text: string }
  | { action: "selectRuntimeTopTab" }
  | {
      action: "openRuntimeControl";
      target: string;
    }
  | {
      action: "selectRuntimeFilterOption";
      queryKey: string;
      filterKey?: never;
      hint?: string;
      verification?: "url";
    }
  | {
      action: "selectRuntimeFilterOption";
      filterKey: string;
      queryKey?: never;
      hint?: string;
      verification: "visible-state";
      interactionId?: string;
      oracleId?: string;
    }
  | {
      action: "createDraftJobAndVerifyRedirect";
      origin: "jobs" | "all-jobs";
    }
| {
    action: "clickButton";
    text: string;
    interactionId?: string;
    /** Runtime compatibility navigation may assist execution but never adds proof authority. */
    compatibilityNavigation?: "ADVISORY";
    /**
     * This interaction must establish a fresh semantic surface before later
     * assertions may contribute deterministic evidence. It is an execution
     * precondition only: it never authorizes an acceptance requirement.
     */
    assertionSurfaceGrounding?: "REQUIRED";
    contextText?: string;
    verifyExpandedSurface?: boolean;
  }
| {
    action: "clickText";
    text: string;
    interactionId?: string;
  }
  | { action: "openMenu"; text: string }
  | { action: "selectOption"; text: string }
  | { action: "clickProjectDropdown" }
  | { action: "selectLastDropdownOption" }
  | { action: "assertUrlContains"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | { action: "assertUrlNotContains"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | { action: "assertTextVisible"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | {
      /*
       * GENERIC_BROWSER_SURFACE_CONTROL_ASSERTION_PLUMBING_V1
       *
       * Deterministically prove an exact semantic control set
       * inside one uniquely observed semantic surface.
       */
      action: "assertSurfaceControls";
      surfaceKind:
        | "dialog"
        | "menu"
        | "listbox"
        | "region"
        | "surface";
      controls: Array<{
        kind:
          | "button"
          | "link"
          | "tab"
          | "menuitem"
          | "option"
          | "control";
        label: string;
      }>;
      oracleId?: string;
      acceptanceCritical?: boolean;
    }
  | { action: "assertTextNotVisible"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | { action: "setViewport"; width: number; height: number };

export type BrowserInteractionExecutionEvidence = {
  stepIndex: number;
  interactionId: string;
  action:
    | "clickButton"
    | "clickText"
    | "selectRuntimeFilterOption";
  succeeded: true;
  note: string;
};

export type BrowserRuntimeTopTabObservation = {
  stepIndex: number;
  action: "selectRuntimeTopTab";
  candidateLabels: string[];
  selectionStrategy:
    "stable-accessible-label";
  targetTabLabel: string;
  interactionSucceeded: boolean;
  observedActiveTabLabel:
    | string
    | null;
  activeStateVerified: boolean;
  activeStateSource:
    | "aria-selected"
    | "data-state"
    | "aria-current"
    | "semantic-class"
    | null;
  urlChanged: boolean;
  note: string;
};

export type BrowserExpandedSurfaceObservation = {
  stepIndex: number;
  action: "clickButton";
  triggerText: string;
  contextText?: string;
  interactionSucceeded: boolean;
  expandedSurfaceVerified: boolean;
  surfaceRole: string | null;
  surfaceType: string | null;
  surfaceName: string | null;
  verificationSource: string | null;
  note: string;
};



export type BrowserStepResult = {
  /**
   * Legacy-compatible transport for the canonical case verdict after it is
   * derived. Before case evaluation it may carry runner progress only.
   */
  status:
    | "PASS"
    | "FAIL"
    | "BLOCKED"
    | "MANUAL_REQUIRED"
    | "ERROR";

  reasonCategory: string;
  notes: string[];

  /**
   * Patch-2 transport only. The runner does not populate this until the
   * separate CASE_VERDICT wiring patch; it never aliases legacy raw status.
   */
  caseVerdict?: BrowserCaseVerdictResult;

  /** Presentation-only projection of finalized canonical result facts. */
  humanReadableResult?: BrowserHumanReadableQaResult;

  /** Rerun audit metadata only; never read by proof, reconciliation, or verdict code. */
  rerunLineage?: {
    rerunOf: string;
    resolutionRequestId: string;
    resolutionProvenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT";
    resolvedInputKeys: string[];
  };

  /** Observable execution-only lane; never a canonical acceptance verdict. */
  operationalExecution?: {
    kind: "DISCOVERY_ONLY_SUPPORT";
  };

  /** Validated runtime HOW binding; transport-only until CASE_VERDICT Patch C. */
  runtimeExecutionBinding?: BrowserRuntimeExecutionBinding;
  runtimeExecutionBindingRejectionReason?: BrowserRuntimeExecutionBindingValidationReason;

  terminationReason?: BrowserTerminationReason;

  deterministicEvidence?:
    BrowserDeterministicEvidence[];

  /**
   * Exact scope copied from the materialized case. GROUP_ONLY means local
   * proof readiness is not a final verdict.
   */
  executionVerdictScope?: BrowserExecutionVerdictScope;

  /** Verdict-neutral deterministic ordering observation (V0). */
  orderingEvidence?: BrowserOrderingEvidence[];
  orderingEvidenceParity?: BrowserOrderingEvidenceParity;

  collectionFilterEvidence?:
    BrowserCollectionFilterEvidence[];

  /** Positive-only proof evidence; never a direct PASS/FAIL generator. */
  localStateTransitionEvidence?:
    BrowserGroundedLocalStateTransitionEvidence[];

  /** Exact stable-ID obligation discharges derived from confirmed proof. */
  deterministicObligationDischarges?:
    BrowserDeterministicObligationDischarge[];

  /** Source-bound assertion artifacts are evidence/accounting, never planner authority. */
  sourceBoundAssertionSetRequirements?:
    BrowserSourceBoundAssertionSetRequirement[];
  sourceBoundAssertionSetEvidence?:
    BrowserSourceBoundAssertionSetEvidence[];
  runtimeSourceAssertionAllocations?:
    BrowserRuntimeSourceAssertionAllocation[];
  structuralControlPresenceRequirements?:
    BrowserSourceBoundStructuralControlPresenceRequirement[];
  structuralControlPresenceEvidence?:
    BrowserSourceBoundStructuralControlPresenceEvidence[];

  /** Original typed validator inputs; transport-only, never regenerated downstream. */
  sourceBoundAssertionSetPassProofs?:
    BrowserSourceBoundAssertionSetPassProof[];
  localStatePassProofs?:
    BrowserLocalStatePassProof[];
  deterministicPassRuntimeContext?: BrowserDeterministicPassRuntimeContext;

  /** Completeness accounting only; status remains reconciliation-owned. */
  caseProofReadiness?:
    BrowserCaseProofReadiness;

  /** Independently revalidated raw-PASS eligibility; never screenshot-derived. */
  deterministicPassEligibility?:
    BrowserDeterministicCasePassEligibilityDecision;

  /** Complete typed inputs required to revalidate a trusted raw PASS. */
  deterministicPassValidationContext?:
    BrowserDeterministicPassValidationContext;

  interactionExecutionEvidence?:
    BrowserInteractionExecutionEvidence[];

  /*
   * Runtime capability observation only. This is not a
   * structured acceptance requirement and is not consumed
   * by verdict reconciliation.
   */
  runtimeTopTabObservations?:
    BrowserRuntimeTopTabObservation[];

  /*
   * Runtime capability observation only. It records a
   * verified expanded-surface transition, not acceptance
   * satisfaction, and is not consumed by reconciliation.
   */
  expandedSurfaceObservations?:
    BrowserExpandedSurfaceObservation[];

  /** Runtime fixture readiness only; never acceptance proof or a verdict. */
  runtimeFixturePreparations?:
    BrowserRuntimeFixturePreparationResult[];

  /** Fresh, source-bound proof observations; verdict-neutral in V1. */
  evidenceContractProofResults?:
    BrowserEvidenceContractProofResult[];
  evidenceContractProofCoverage?:
    BrowserEvidenceContractProofCoverage[];
};

export type BrowserStopReason =
  | "GOAL_ALREADY_SATISFIED"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT"
  | "STEP_BUDGET_EXCEEDED"
  | "RUNTIME_ERROR"
  | "PROOF_GAP"
  | "COMPLETED";

export type BrowserCheckpointCaptureArgs = {
  stepIndex: number;
  step: BrowserStep;
  note: string;
};

export type BrowserCheckpointCapture = (
  args: BrowserCheckpointCaptureArgs
) => Promise<void>;

export type BrowserTraceStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "MANUAL_REQUIRED"
  | "ERROR";

export type BrowserTraceStep = {
  index: number;
  action: string;
  status: BrowserTraceStatus;
  note: string;
  url?: string;
};

export type BrowserEvidenceSummary = {
  successSignal: string;
  successSignalReached: boolean;
  authWallDetected: boolean;
  pagesVisited: string[];
  keyVisibleTexts: string[];
  stopReason?: BrowserStopReason;
};

export type BrowserTerminationReason =
  | "SUCCESS_SIGNAL_REACHED"
  | "PROOF_GAP"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT"
  | "MISSING_ROUTE"
  | "AUTH_BLOCKED"
  | "STEP_BUDGET_EXHAUSTED"
  | "GROUNDING_AMBIGUITY"
  | "RUNTIME_ERROR";
