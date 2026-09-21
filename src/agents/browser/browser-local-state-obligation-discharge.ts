import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import {
  evaluateBrowserLocalStateTransition,
  type BrowserGroundedLocalStateTransitionEvidence,
  type BrowserLocalStateTransitionProofRequirement,
} from "./browser-local-state-transition-proof.js";

export type BrowserDeterministicObligationDischarge = {
  kind:
    "DETERMINISTIC_OBLIGATION_PROVED";
  obligationId: string;
  sourceId: string;
  proofRequirementId: string;
  proofKind:
    | "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION"
    | "SOURCE_BOUND_ASSERTION_SET";
  evidenceResult: "CONFIRMED";
  note: string;
};

export type BrowserLocalStateObligationDischargeReason =
  | "DETERMINISTIC_OBLIGATION_PROVED"
  | "EVIDENCE_NOT_CONFIRMED"
  | "PROOF_REQUIREMENT_MISMATCH"
  | "PROOF_AUTHORITY_MISMATCH"
  | "OBLIGATION_NOT_AUTHORITATIVE"
  | "OBLIGATION_NOT_ALLOCATED_TO_CASE"
  | "OBLIGATION_ALLOCATION_AMBIGUOUS"
  | "SOURCE_IDENTITY_MISMATCH"
  | "EXPECTED_VALUE_AUTHORITY_MISMATCH"
  | "CONTROL_BINDING_IDENTITY_MISMATCH"
  | "TRANSPORT_OR_RESTORE_INVALID";

export type BrowserLocalStateObligationDischargeDecision =
  | {
      status:
        "DETERMINISTIC_OBLIGATION_PROVED";
      reason:
        "DETERMINISTIC_OBLIGATION_PROVED";
      discharge:
        BrowserDeterministicObligationDischarge;
      note: string;
    }
  | {
      status: "NOT_PROVED";
      reason:
        Exclude<
          BrowserLocalStateObligationDischargeReason,
          "DETERMINISTIC_OBLIGATION_PROVED"
        >;
      note: string;
    };

export type BrowserCaseProofReadiness = {
  status:
    | "CASE_PROOF_READY"
    | "CASE_PROOF_NOT_READY";
  allocatedObligationIds: string[];
  provedObligationIds: string[];
  remainingObligationIds: string[];
  blockingBindingStates: Array<{
    obligationId: string;
    state:
      PlannerBrowserObligationBinding["state"];
  }>;
  note: string;
};

function normalized(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function notProved(
  reason: Exclude<
    BrowserLocalStateObligationDischargeReason,
    "DETERMINISTIC_OBLIGATION_PROVED"
  >,
  note: string
): BrowserLocalStateObligationDischargeDecision {
  return {
    status: "NOT_PROVED",
    reason,
    note,
  };
}

/**
 * Positive-only bridge from one already-evaluated local transition proof to
 * one exact source-backed obligation. It never creates PASS or FAIL.
 */
export function evaluateBrowserLocalStateObligationDischarge(
  args: {
    testCase: BrowserTestCase;
    obligationLedger:
      PlannerAcceptanceObligationLedger | undefined;
    browserObligationBindings:
      PlannerBrowserObligationBinding[] | undefined;
    requirement:
      BrowserLocalStateTransitionProofRequirement;
    evidence:
      BrowserGroundedLocalStateTransitionEvidence;
  }
): BrowserLocalStateObligationDischargeDecision {
  const {
    testCase,
    obligationLedger,
    browserObligationBindings,
    requirement,
    evidence,
  } = args;

  if (
    requirement.proofAuthority !==
      "ACCEPTANCE" ||
    evidence.proofAuthority !==
      "ACCEPTANCE"
  ) {
    return notProved(
      "PROOF_AUTHORITY_MISMATCH",
      "The proof requirement and evidence must both carry acceptance authority."
    );
  }

  if (
    evidence.proofRequirementId !==
      requirement.requirementId ||
    evidence.obligationId !==
      requirement.obligationId ||
    evidence.sourceId !==
      requirement.sourceId ||
    normalized(evidence.surface.label) !==
      normalized(requirement.surface.label) ||
    evidence.surface.routePath !==
      requirement.surface.routePath
  ) {
    return notProved(
      "PROOF_REQUIREMENT_MISMATCH",
      "Evidence identity does not exactly match its local-state proof requirement."
    );
  }

  if (
    requirement.expectedValueAuthority !==
      "JIRA_AUTHORIZED" ||
    evidence.expectedValueAuthority !==
      "JIRA_AUTHORIZED" ||
    evidence.expectedValue !==
      requirement.expectedValue
  ) {
    return notProved(
      "EXPECTED_VALUE_AUTHORITY_MISMATCH",
      "The evidence expected value does not match the Jira-authorized proof requirement."
    );
  }

  const obligation =
    obligationLedger?.sourceStatus ===
      "RESOLVED" &&
    obligationLedger.derivationStatus ===
      "RESOLVED"
      ? obligationLedger.obligations.find(
          (candidate) =>
            candidate.id ===
            requirement.obligationId
        )
      : undefined;

  if (
    !obligation ||
    obligation.sourceRole !==
      "ACCEPTANCE"
  ) {
    return notProved(
      "OBLIGATION_NOT_AUTHORITATIVE",
      "The exact obligation was not present as a resolved authoritative acceptance obligation."
    );
  }

  if (
    requirement.sourceRole !==
      obligation.sourceRole ||
    !obligation.sourceUnitIds.includes(
      requirement.sourceId
    )
  ) {
    return notProved(
      "SOURCE_IDENTITY_MISMATCH",
      "The proof source ID is not in the authoritative obligation source chain."
    );
  }

  const allocatedIds = new Set(
    testCase.acceptanceObligationIds ?? []
  );
  const matchingBindings =
    (browserObligationBindings ?? [])
      .filter(
        (binding) =>
          binding.obligationId ===
          requirement.obligationId
      );

  if (
    !allocatedIds.has(
      requirement.obligationId
    ) ||
    matchingBindings.length !== 1 ||
    !matchingBindings[0]!
      .allocatedCaseIds.includes(
        testCase.id
      )
  ) {
    return notProved(
      "OBLIGATION_NOT_ALLOCATED_TO_CASE",
      "The exact obligation is not uniquely allocated to the current browser case."
    );
  }

  const binding = matchingBindings[0]!;

  if (
    binding.state ===
      "AMBIGUOUS_CASE_ALLOCATION" ||
    binding.allocatedCaseIds.length !== 1
  ) {
    return notProved(
      "OBLIGATION_ALLOCATION_AMBIGUOUS",
      "The obligation allocation is ambiguous and cannot receive proof authority."
    );
  }

  if (
    !binding.sourceUnitIds.includes(
      requirement.sourceId
    )
  ) {
    return notProved(
      "SOURCE_IDENTITY_MISMATCH",
      "The runtime allocation does not preserve the proof requirement source ID."
    );
  }

  const sourceBindings = [
    evidence.bindings.activation,
    evidence.bindings.valueInitial,
    evidence.bindings.valueAlternate,
    evidence.bindings.reset,
    evidence.bindings.valueReset,
  ];

  if (
    sourceBindings.some(
      (control) =>
        control.sourceRef !==
          requirement.sourceId ||
        normalized(control.surfaceLabel) !==
          normalized(
            requirement.surface.label
          )
    )
  ) {
    return notProved(
      "CONTROL_BINDING_IDENTITY_MISMATCH",
      "Every control binding must preserve the exact proof source and active surface identity."
    );
  }

  const activationIdentity =
    evidence.bindings.activation
      .bindingIdentity;
  const valueIdentity =
    evidence.bindings.valueInitial
      .bindingIdentity;
  const resetIdentity =
    evidence.bindings.reset
      .bindingIdentity;

  if (
    new Set([
      activationIdentity,
      valueIdentity,
      resetIdentity,
    ]).size !== 3 ||
    evidence.actions.activation
      .targetBindingIdentity !==
      activationIdentity ||
    evidence.actions.alternateSetup
      .targetBindingIdentity !==
      valueIdentity ||
    evidence.actions.reset
      .targetBindingIdentity !==
      resetIdentity
  ) {
    return notProved(
      "CONTROL_BINDING_IDENTITY_MISMATCH",
      "Activation, value, and reset actions must target their distinct exact source-bound controls."
    );
  }

  const {
    result: _result,
    reason: _reason,
    note: _note,
    ...evaluatorInput
  } = evidence;
  const reevaluated =
    evaluateBrowserLocalStateTransition(
      evaluatorInput
    );

  if (
    evidence.result !== "CONFIRMED" ||
    reevaluated.result !== "CONFIRMED"
  ) {
    return notProved(
      "EVIDENCE_NOT_CONFIRMED",
      "Only independently revalidated CONFIRMED evidence may discharge an obligation; contradiction remains evidence-only."
    );
  }

  if (
    evidence.transportGuard
      .activeDuringProof !== true ||
    evidence.transportGuard
      .productNonGetCount !== 0 ||
    evidence.transportGuard
      .attempts.length !== 0 ||
    evidence.restore.modalClosed !==
      true ||
    evidence.restore
      .draftDiscardVerified !== true ||
    evidence.restore.routePreserved !==
      true
  ) {
    return notProved(
      "TRANSPORT_OR_RESTORE_INVALID",
      "Transport safety and local draft restoration must both be exact and complete."
    );
  }

  const discharge:
    BrowserDeterministicObligationDischarge = {
      kind:
        "DETERMINISTIC_OBLIGATION_PROVED",
      obligationId:
        requirement.obligationId,
      sourceId: requirement.sourceId,
      proofRequirementId:
        requirement.requirementId,
      proofKind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
      evidenceResult: "CONFIRMED",
      note:
        "The exact authoritative obligation was proved by independently revalidated local-state transition evidence.",
    };

  return {
    status:
      "DETERMINISTIC_OBLIGATION_PROVED",
    reason:
      "DETERMINISTIC_OBLIGATION_PROVED",
    discharge,
    note: discharge.note,
  };
}

export function auditBrowserCaseProofReadiness(
  args: {
    testCase: BrowserTestCase;
    discharges:
      BrowserDeterministicObligationDischarge[];
    browserObligationBindings:
      PlannerBrowserObligationBinding[] | undefined;
  }
): BrowserCaseProofReadiness {
  const allocatedObligationIds = [
    ...new Set(
      args.testCase
        .acceptanceObligationIds ?? []
    ),
  ];
  const allocatedSet = new Set(
    allocatedObligationIds
  );
  const provedObligationIds = [
    ...new Set(
      args.discharges
        .filter(
          (discharge) =>
            discharge.kind ===
              "DETERMINISTIC_OBLIGATION_PROVED" &&
            allocatedSet.has(
              discharge.obligationId
            )
        )
        .map(
          (discharge) =>
            discharge.obligationId
        )
    ),
  ];
  const provedSet = new Set(
    provedObligationIds
  );
  const remainingObligationIds =
    allocatedObligationIds.filter(
      (id) => !provedSet.has(id)
    );
  const remainingSet = new Set(
    remainingObligationIds
  );
  const blockingBindingStates =
    (args.browserObligationBindings ?? [])
      .filter(
        (binding) =>
          remainingSet.has(
            binding.obligationId
          ) &&
          binding.allocatedCaseIds.includes(
            args.testCase.id
          )
      )
      .map((binding) => ({
        obligationId:
          binding.obligationId,
        state: binding.state,
      }));
  const ready =
    allocatedObligationIds.length > 0 &&
    remainingObligationIds.length === 0;

  return {
    status: ready
      ? "CASE_PROOF_READY"
      : "CASE_PROOF_NOT_READY",
    allocatedObligationIds,
    provedObligationIds,
    remainingObligationIds,
    blockingBindingStates,
    note: ready
      ? "Every authoritative obligation allocated to this browser case has an exact deterministic discharge."
      : remainingObligationIds.length > 0
        ? `${remainingObligationIds.length} allocated authoritative obligation(s) remain without deterministic discharge.`
        : "The browser case has no stable allocated authoritative obligation IDs.",
  };
}

export function applyBrowserLocalStateObligationDischarge(
  args: {
    currentResult: any;
    testCase: BrowserTestCase;
    obligationLedger:
      PlannerAcceptanceObligationLedger | undefined;
    browserObligationBindings:
      PlannerBrowserObligationBinding[] | undefined;
    requirement:
      BrowserLocalStateTransitionProofRequirement;
    evidence:
      BrowserGroundedLocalStateTransitionEvidence;
  }
): BrowserLocalStateObligationDischargeDecision {
  const decision =
    evaluateBrowserLocalStateObligationDischarge(
      args
    );
  const existing:
    BrowserDeterministicObligationDischarge[] =
    Array.isArray(
      args.currentResult
        ?.deterministicObligationDischarges
    )
      ? args.currentResult
          .deterministicObligationDischarges
      : [];

  if (
    decision.status ===
      "DETERMINISTIC_OBLIGATION_PROVED"
  ) {
    args.currentResult
      .deterministicObligationDischarges = [
        ...existing.filter(
          (discharge) =>
            discharge.obligationId !==
            decision.discharge.obligationId
        ),
        decision.discharge,
      ];
  }

  args.currentResult
    .localStateObligationDischargeAudit =
      decision;
  args.currentResult.caseProofReadiness =
    auditBrowserCaseProofReadiness({
      testCase: args.testCase,
      discharges:
        args.currentResult
          .deterministicObligationDischarges ??
        existing,
      browserObligationBindings:
        args.browserObligationBindings,
    });

  return decision;
}
