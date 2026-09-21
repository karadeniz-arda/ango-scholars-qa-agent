import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import {
  getRemainingBrowserManualAcceptanceChecks,
} from "./browser-result-reconciliation.js";
import {
  auditBrowserCaseProofReadiness,
  evaluateBrowserLocalStateObligationDischarge,
  type BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import type {
  BrowserGroundedLocalStateTransitionEvidence,
  BrowserLocalStateTransitionProofRequirement,
} from "./browser-local-state-transition-proof.js";
import {
  evaluateBrowserSourceBoundAssertionSetDischarge,
  type BrowserSourceBoundAssertionSetEvidence,
  type BrowserSourceBoundAssertionSetRequirement,
  type BrowserRuntimeSourceAssertionAllocation,
} from "./browser-source-bound-assertion-set-proof.js";

export const VERDICT_AUTHORIZED_DETERMINISTIC_PROOF_KINDS = [
  "COLLECTION_FILTER",
  "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
  "SOURCE_BOUND_ASSERTION_SET",
] as const;

export type BrowserDeterministicPassRuntimePrerequisites = {
  fixtureStatus:
    | "READY"
    | "NOT_REQUIRED"
    | "UNKNOWN"
    | "UNAVAILABLE";
  acceptedRoutePath: string | null;
  targetVerified: boolean;
  requiredExecutionCompleted: boolean;
  safetyViolation: boolean;
  testDataIssue: boolean;
  productNonGetCount: number;
  persistenceViolation: boolean;
};

export type BrowserLocalStatePassProof = {
  kind:
    "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION";
  requirement:
    BrowserLocalStateTransitionProofRequirement;
  evidence:
    BrowserGroundedLocalStateTransitionEvidence;
};

export type BrowserSourceBoundAssertionSetPassProof = {
  kind: "SOURCE_BOUND_ASSERTION_SET";
  requirement: BrowserSourceBoundAssertionSetRequirement;
  evidence: BrowserSourceBoundAssertionSetEvidence;
  allocation: BrowserRuntimeSourceAssertionAllocation;
};

export type BrowserDeterministicPassValidationContext = {
  obligationLedger:
    PlannerAcceptanceObligationLedger | undefined;
  browserObligationBindings:
    PlannerBrowserObligationBinding[] | undefined;
  localStateProofs:
    BrowserLocalStatePassProof[];
  sourceBoundAssertionSetProofs?:
    BrowserSourceBoundAssertionSetPassProof[] | undefined;
  runtime:
    BrowserDeterministicPassRuntimePrerequisites;
};

export type BrowserDeterministicCasePassEligibility = {
  status:
    "DETERMINISTIC_CASE_PASS_ELIGIBLE";
  reason:
    "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE";
  caseId: string;
  allocatedObligationIds: string[];
  provedObligationIds: string[];
  proofKinds: Array<
    typeof VERDICT_AUTHORIZED_DETERMINISTIC_PROOF_KINDS[number]
  >;
  note: string;
};

export type BrowserDeterministicCasePassIneligibilityReason =
  | "NO_AUTHORITATIVE_ACCEPTANCE_OBLIGATION"
  | "AUTHORITATIVE_OBLIGATION_LEDGER_UNRESOLVED"
  | "OBLIGATION_NOT_AUTHORITATIVE"
  | "OBLIGATION_ALLOCATION_INVALID"
  | "OBLIGATION_ALLOCATION_AMBIGUOUS"
  | "OBLIGATION_PROOF_MISSING"
  | "OBLIGATION_DISCHARGE_INVALID"
  | "OBLIGATION_DISCHARGE_MISSING"
  | "MANUAL_ACCEPTANCE_GAP"
  | "FIXTURE_NOT_READY"
  | "ROUTE_NOT_ACCEPTED"
  | "TARGET_NOT_VERIFIED"
  | "REQUIRED_EXECUTION_INCOMPLETE"
  | "SAFETY_VIOLATION"
  | "TEST_DATA_ISSUE"
  | "TRANSPORT_VIOLATION"
  | "PERSISTENCE_VIOLATION";

function sameObligationScope(
  left: string[],
  right: string[]
): boolean {
  return [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000");
}

/**
 * The only Task-shaped authority admitted by deterministic case PASS.
 *
 * A resolved Task is not generally an acceptance obligation. The sole
 * exception is the already-approved direct UI-member family. This predicate
 * is deliberately structural: it consumes the existing typed proof chain
 * rather than case prose or a planner assertion.
 *
 * Full source identity, freshness, evidence, and discharge validation remain
 * the responsibility of evaluateBrowserSourceBoundAssertionSetDischarge,
 * which the policy invokes below before generating PASS.
 */
function hasApprovedDirectTaskMemberPresenceAuthority(args: {
  obligation: NonNullable<PlannerAcceptanceObligationLedger["obligations"]>[number];
  testCase: BrowserTestCase;
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceBoundAssertionSetProofs:
    BrowserSourceBoundAssertionSetPassProof[] | undefined;
}): boolean {
  if (
    args.obligation.sourceRole !== "TASK" ||
    args.obligation.derivation !== "DIRECT_TASK_SECTION"
  ) {
    return false;
  }

  const matches = (args.sourceBoundAssertionSetProofs ?? [])
    .filter((proof) =>
      proof.requirement.obligationId === args.obligation.id
    );

  if (matches.length !== 1) return false;

  const proof = matches[0]!;
  const requirement = proof.requirement;

  const structurallyApproved =
    requirement.sourceRole === "TASK" &&
    requirement.derivation === "DIRECT_TASK_SECTION" &&
    requirement.proofAuthority === "DIRECT_TASK" &&
    requirement.semanticFamily ===
      "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" &&
    requirement.executionCaseId === args.testCase.id &&
    requirement.sourceUnitIds.length > 0 &&
    requirement.sourceUnitIds.every((sourceUnitId) =>
      args.obligation.sourceUnitIds.includes(sourceUnitId)
    ) &&
    proof.allocation.state === "SUPPORTED_AND_BOUND" &&
    proof.allocation.allocatedCaseIds.length === 1 &&
    proof.allocation.allocatedCaseIds[0] === args.testCase.id;

  if (!structurallyApproved) return false;

  return evaluateBrowserSourceBoundAssertionSetDischarge({
    testCase: args.testCase,
    obligationLedger: args.obligationLedger,
    allocation: proof.allocation,
    requirement,
    evidence: proof.evidence,
  }).status === "DETERMINISTIC_OBLIGATION_PROVED";
}

export type BrowserDeterministicCasePassEligibilityDecision =
  | BrowserDeterministicCasePassEligibility
  | {
      status:
        "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE";
      reason:
        BrowserDeterministicCasePassIneligibilityReason;
      note: string;
    };

function ineligible(
  reason:
    BrowserDeterministicCasePassIneligibilityReason,
  note: string
): BrowserDeterministicCasePassEligibilityDecision {
  return {
    status:
      "DETERMINISTIC_CASE_PASS_NOT_ELIGIBLE",
    reason,
    note,
  };
}

/**
 * Independently revalidates exact deterministic acceptance completion before
 * raw PASS is generated. A CASE_PROOF_READY marker is deliberately ignored as
 * authority; readiness is recomputed from approved typed proof inputs.
 */
export function evaluateBrowserDeterministicPassEligibility(
  args: {
    testCase: BrowserTestCase;
    obligationLedger:
      PlannerAcceptanceObligationLedger | undefined;
    browserObligationBindings:
      PlannerBrowserObligationBinding[] | undefined;
    currentResult: any;
    localStateProofs:
      BrowserLocalStatePassProof[];
    sourceBoundAssertionSetProofs?:
      BrowserSourceBoundAssertionSetPassProof[];
    runtime:
      BrowserDeterministicPassRuntimePrerequisites;
  }
): BrowserDeterministicCasePassEligibilityDecision {
  const verdictScope = args.testCase.executionVerdictScope;
  if (verdictScope?.verdictAuthority === "GROUP_ONLY") {
    return ineligible(
      "MANUAL_ACCEPTANCE_GAP",
      "This execution unit has GROUP_ONLY verdict authority; a future group-level reducer must validate the complete verdict scope before PASS."
    );
  }
  if (
    verdictScope?.verdictAuthority === "INDEPENDENT" &&
    !sameObligationScope(
      verdictScope.executionObligationIds,
      verdictScope.verdictScopeObligationIds
    )
  ) {
    return ineligible(
      "OBLIGATION_ALLOCATION_INVALID",
      "INDEPENDENT verdict authority requires the execution and final verdict scopes to match exactly."
    );
  }
  const allocatedObligationIds = [
    ...new Set(
      args.testCase
        .acceptanceObligationIds ?? []
    ),
  ];

  if (allocatedObligationIds.length === 0) {
    return ineligible(
      "NO_AUTHORITATIVE_ACCEPTANCE_OBLIGATION",
      "Deterministic PASS requires at least one stable authoritative obligation allocated to the case."
    );
  }

  if (
    args.obligationLedger?.sourceStatus !==
      "RESOLVED" ||
    args.obligationLedger
      .derivationStatus !== "RESOLVED"
  ) {
    return ineligible(
      "AUTHORITATIVE_OBLIGATION_LEDGER_UNRESOLVED",
      "The authoritative obligation ledger is not fully resolved."
    );
  }

  const ledgerById = new Map(
    args.obligationLedger.obligations.map(
      (obligation) => [
        obligation.id,
        obligation,
      ]
    )
  );

  for (const obligationId of
    allocatedObligationIds) {
    const obligation = ledgerById.get(obligationId);
    const acceptanceAuthority =
      obligation?.sourceRole === "ACCEPTANCE";
    const directTaskMemberPresenceAuthority =
      obligation
        ? hasApprovedDirectTaskMemberPresenceAuthority({
            obligation,
            testCase: args.testCase,
            obligationLedger: args.obligationLedger,
            sourceBoundAssertionSetProofs:
              args.sourceBoundAssertionSetProofs,
          })
        : false;

    if (!acceptanceAuthority && !directTaskMemberPresenceAuthority) {
      return ineligible(
        "OBLIGATION_NOT_AUTHORITATIVE",
        `Allocated obligation ${obligationId} is neither a resolved acceptance obligation nor an approved direct Task member-presence proof.`
      );
    }

    const bindings =
      (args.browserObligationBindings ?? [])
        .filter(
          (binding) =>
            binding.obligationId ===
            obligationId
        );
    const sourceAllocations =
      (args.sourceBoundAssertionSetProofs ?? [])
        .filter(
          (proof) =>
            proof.requirement.obligationId ===
              obligationId
        )
        .map((proof) => proof.allocation);
    const sourceAllocation =
      sourceAllocations.length === 1
        ? sourceAllocations[0]
        : undefined;

    if (
      sourceAllocation?.state ===
        "AMBIGUOUS_CASE_ALLOCATION"
    ) {
      return ineligible(
        "OBLIGATION_ALLOCATION_AMBIGUOUS",
        `Allocated obligation ${obligationId} has ambiguous runtime source assertion allocation.`
      );
    }
    if (
      sourceAllocation?.state ===
        "SUPPORTED_AND_BOUND" &&
      sourceAllocation.allocatedCaseIds.length === 1 &&
      sourceAllocation.allocatedCaseIds[0] ===
        args.testCase.id
    ) {
      continue;
    }
    if (
      bindings.length !== 1 ||
      !bindings[0]!.allocatedCaseIds
        .includes(args.testCase.id)
    ) {
      return ineligible(
        "OBLIGATION_ALLOCATION_INVALID",
        `Allocated obligation ${obligationId} does not have one exact binding to case ${args.testCase.id}.`
      );
    }
    if (
      bindings[0]!.state ===
        "AMBIGUOUS_CASE_ALLOCATION" ||
      bindings[0]!.allocatedCaseIds
        .length !== 1
    ) {
      return ineligible(
        "OBLIGATION_ALLOCATION_AMBIGUOUS",
        `Allocated obligation ${obligationId} has ambiguous case allocation.`
      );
    }
    if (
      bindings[0]!.state ===
      "MANUAL_BY_NATURE"
    ) {
      return ineligible(
        "MANUAL_ACCEPTANCE_GAP",
        `Allocated obligation ${obligationId} remains manual by nature.`
      );
    }
  }

  const independentlyValidated:
    BrowserDeterministicObligationDischarge[] = [];

  for (const obligationId of
    allocatedObligationIds) {
    const localProofs = args.localStateProofs.filter(
      (proof) => proof.requirement.obligationId === obligationId
    );
    const assertionProofs = (args.sourceBoundAssertionSetProofs ?? []).filter(
      (proof) => proof.requirement.obligationId === obligationId
    );
    const proofs = [...localProofs, ...assertionProofs];

    if (proofs.length !== 1) {
      return ineligible(
        "OBLIGATION_PROOF_MISSING",
        `Allocated obligation ${obligationId} does not have one approved typed proof input.`
      );
    }

    const proof = proofs[0]!;
    const decision = proof.kind === "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION"
      ? evaluateBrowserLocalStateObligationDischarge({
          testCase: args.testCase,
          obligationLedger: args.obligationLedger,
          browserObligationBindings: args.browserObligationBindings,
          requirement: proof.requirement,
          evidence: proof.evidence,
        })
      : evaluateBrowserSourceBoundAssertionSetDischarge({
          testCase: args.testCase,
          obligationLedger: args.obligationLedger,
          allocation: proof.allocation,
          requirement: proof.requirement,
          evidence: proof.evidence,
        });

    if (
      decision.status !==
      "DETERMINISTIC_OBLIGATION_PROVED"
    ) {
      return ineligible(
        "OBLIGATION_DISCHARGE_INVALID",
        `Allocated obligation ${obligationId} failed independent proof validation: ${decision.note}.`
      );
    }
    independentlyValidated.push(
      decision.discharge
    );
  }

  const suppliedDischarges:
    BrowserDeterministicObligationDischarge[] =
    Array.isArray(
      args.currentResult
        ?.deterministicObligationDischarges
    )
      ? args.currentResult
          .deterministicObligationDischarges
      : [];

  for (const expected of
    independentlyValidated) {
    const exact = suppliedDischarges.filter(
      (candidate) =>
        candidate.kind ===
          "DETERMINISTIC_OBLIGATION_PROVED" &&
        candidate.evidenceResult ===
          "CONFIRMED" &&
        candidate.obligationId ===
          expected.obligationId &&
        candidate.sourceId ===
          expected.sourceId &&
        candidate.proofRequirementId ===
          expected.proofRequirementId &&
        candidate.proofKind ===
          expected.proofKind
    );
    if (exact.length !== 1) {
      return ineligible(
        "OBLIGATION_DISCHARGE_MISSING",
        `Allocated obligation ${expected.obligationId} lacks one exact confirmed typed discharge in the result.`
      );
    }
  }

  const recomputedReadiness =
    auditBrowserCaseProofReadiness({
      testCase: args.testCase,
      discharges:
        independentlyValidated,
      browserObligationBindings:
        args.browserObligationBindings,
    });
  if (
    recomputedReadiness.status !==
      "CASE_PROOF_READY" ||
    recomputedReadiness
      .remainingObligationIds.length > 0
  ) {
    return ineligible(
      "OBLIGATION_PROOF_MISSING",
      "Independent readiness accounting found an allocated obligation without exact proof."
    );
  }

  const remainingManualChecks =
    getRemainingBrowserManualAcceptanceChecks(
      args.testCase,
      {
        ...args.currentResult,
        deterministicObligationDischarges:
          independentlyValidated,
        caseProofReadiness:
          recomputedReadiness,
      }
    );
  if (remainingManualChecks.length > 0) {
    return ineligible(
      "MANUAL_ACCEPTANCE_GAP",
      `${remainingManualChecks.length} acceptance-level manual check(s) remain.`
    );
  }

  if (
    args.testCase.fixtureRequirements
      ?.length &&
    args.runtime.fixtureStatus !==
      "READY"
  ) {
    return ineligible(
      "FIXTURE_NOT_READY",
      "The case declares fixture requirements but runtime fixture readiness was not established."
    );
  }
  if (!args.runtime.acceptedRoutePath) {
    return ineligible(
      "ROUTE_NOT_ACCEPTED",
      "No accepted runtime route was recorded."
    );
  }
  if (
    args.localStateProofs.some(
      (proof) => proof.requirement.surface.routePath !== args.runtime.acceptedRoutePath
    ) || (args.sourceBoundAssertionSetProofs ?? []).some(
      (proof) => proof.requirement.routePath !== args.runtime.acceptedRoutePath
    )
  ) {
    return ineligible(
      "ROUTE_NOT_ACCEPTED",
      "The accepted route does not match every approved proof requirement."
    );
  }
  if (!args.runtime.targetVerified) {
    return ineligible(
      "TARGET_NOT_VERIFIED",
      "The exact acceptance-compatible runtime target was not verified."
    );
  }
  if (
    !args.runtime
      .requiredExecutionCompleted
  ) {
    return ineligible(
      "REQUIRED_EXECUTION_INCOMPLETE",
      "Required deterministic interaction and proof execution did not complete."
    );
  }
  if (args.runtime.safetyViolation) {
    return ineligible(
      "SAFETY_VIOLATION",
      "A browser safety violation prevents deterministic PASS."
    );
  }
  if (args.runtime.testDataIssue) {
    return ineligible(
      "TEST_DATA_ISSUE",
      "An unresolved test-data issue prevents deterministic PASS."
    );
  }
  if (
    args.runtime.productNonGetCount !== 0
  ) {
    return ineligible(
      "TRANSPORT_VIOLATION",
      "A product non-GET request prevents deterministic PASS."
    );
  }
  if (args.runtime.persistenceViolation) {
    return ineligible(
      "PERSISTENCE_VIOLATION",
      "A persistent product mutation or failed restoration prevents deterministic PASS."
    );
  }

  return {
    status:
      "DETERMINISTIC_CASE_PASS_ELIGIBLE",
    reason:
      "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE",
    caseId: args.testCase.id,
    allocatedObligationIds,
    provedObligationIds:
      independentlyValidated.map(
        (discharge) =>
          discharge.obligationId
      ),
    proofKinds: [...new Set(independentlyValidated.map(
      (discharge) => discharge.proofKind
    ))],
    note:
      "Every allocated authoritative obligation has one independently revalidated approved deterministic discharge, with complete runtime prerequisites and no acceptance or safety gap.",
  };
}

export function generateTrustedDeterministicRawPass(
  args: Parameters<
    typeof evaluateBrowserDeterministicPassEligibility
  >[0]
): BrowserDeterministicCasePassEligibilityDecision {
  const decision =
    evaluateBrowserDeterministicPassEligibility(
      args
    );
  args.currentResult
    .deterministicPassEligibility =
      decision;

  if (
    decision.status ===
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  ) {
    args.currentResult
      .deterministicPassValidationContext = {
        obligationLedger:
          args.obligationLedger,
        browserObligationBindings:
          args.browserObligationBindings,
        localStateProofs:
          args.localStateProofs,
        sourceBoundAssertionSetProofs:
          args.sourceBoundAssertionSetProofs ?? [],
        runtime: args.runtime,
      } satisfies BrowserDeterministicPassValidationContext;
    args.currentResult.notes = [
      ...(Array.isArray(
        args.currentResult.notes
      )
        ? args.currentResult.notes
        : []),
      decision.note,
    ];
  }

  return decision;
}

/**
 * Revalidates a raw deterministic PASS from its complete typed validation
 * context. Neither the PASS status nor its eligibility marker is trusted on
 * its own.
 */
export function revalidateTrustedDeterministicRawPass(
  args: {
    testCase: BrowserTestCase;
    currentResult: any;
  }
): BrowserDeterministicCasePassEligibilityDecision {
  const marker = args.currentResult
    ?.deterministicPassEligibility;
  const context:
    BrowserDeterministicPassValidationContext | undefined =
    args.currentResult
      ?.deterministicPassValidationContext;

  if (
    args.currentResult?.status !== "PASS" ||
    args.currentResult?.reasonCategory !==
      "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE" ||
    marker?.status !==
      "DETERMINISTIC_CASE_PASS_ELIGIBLE" ||
    marker?.reason !==
      "DETERMINISTIC_ACCEPTANCE_PROOF_COMPLETE" ||
    !context
  ) {
    return ineligible(
      "OBLIGATION_PROOF_MISSING",
      "The raw PASS does not carry a complete trusted deterministic validation context."
    );
  }

  const revalidated =
    evaluateBrowserDeterministicPassEligibility({
      testCase: args.testCase,
      currentResult: args.currentResult,
      obligationLedger:
        context.obligationLedger,
      browserObligationBindings:
        context.browserObligationBindings,
      localStateProofs:
        context.localStateProofs,
      sourceBoundAssertionSetProofs:
        context.sourceBoundAssertionSetProofs ?? [],
      runtime: context.runtime,
    });

  if (
    revalidated.status !==
    "DETERMINISTIC_CASE_PASS_ELIGIBLE"
  ) {
    return revalidated;
  }

  if (
    marker.caseId !== revalidated.caseId ||
    JSON.stringify(
      marker.allocatedObligationIds
    ) !== JSON.stringify(
      revalidated.allocatedObligationIds
    ) ||
    JSON.stringify(
      marker.provedObligationIds
    ) !== JSON.stringify(
      revalidated.provedObligationIds
    ) ||
    JSON.stringify(marker.proofKinds) !==
      JSON.stringify(
        revalidated.proofKinds
      )
  ) {
    return ineligible(
      "OBLIGATION_DISCHARGE_INVALID",
      "The stored eligibility marker does not match independently revalidated deterministic completion."
    );
  }

  return revalidated;
}
