import type { BrowserTestCase } from "../../planner/types.js";
import type { BrowserDeterministicEvidence } from "./evidence-review.js";
import type { BrowserCaseRuntimeAudit } from "./browser-case-runtime-audit.js";
import {
  deriveBrowserCaseRuntimeSafetySignals,
  type BrowserPassRuntimeSignal,
} from "./browser-deterministic-pass-runtime-context.js";
import type { BrowserDeterministicPassRuntimePrerequisites } from "./browser-deterministic-pass-policy.js";
import type { BrowserEvidenceContractProofResult } from "./browser-evidence-contract-proof.js";
import type { BrowserGroundedLocalStateTransitionEvidence } from "./browser-local-state-transition-proof.js";
import {
  evaluateBrowserSourceBoundAssertionSet,
  hasApprovedCaseLevelSourceBoundAssertionAuthority,
  type BrowserSourceBoundAssertionSetEvidence,
  type BrowserSourceBoundAssertionSetRequirement,
} from "./browser-source-bound-assertion-set-proof.js";
import {
  deriveBrowserExecutionCheckContract,
} from "../../planner/browser-execution-check-contract.js";
import type {
  BrowserSourceBoundStructuralControlPresenceEvidence,
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "./browser-source-bound-structural-control-presence-proof.js";
import type {
  BrowserExecutionCheckContract,
  BrowserExecutionCheckRequirement,
} from "../../planner/types.js";

export type BrowserCaseVerdict =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "MANUAL_REQUIRED"
  | "ERROR";

export type BrowserCaseVerdictReason =
  | "RUNNER_ERROR"
  | "EXECUTION_CONTRACT_UNAVAILABLE"
  | "EXECUTION_CONTEXT_UNAVAILABLE"
  | "FIXTURE_UNAVAILABLE"
  | "RUNTIME_AUDIT_INCOMPLETE"
  | "UNSAFE_EXECUTION"
  | "PRODUCT_MUTATION_OBSERVED"
  | "PERSISTENCE_VIOLATION"
  | "TEST_DATA_ISSUE"
  | "REQUIRED_CHECK_CONTRADICTED"
  | "NO_SOURCE_AUTHORIZED_EXECUTION_CHECKS"
  | "TYPED_MANUAL_CHECK_REQUIRED"
  | "REQUIRED_CHECK_EVIDENCE_MISSING"
  | "ALL_REQUIRED_CHECKS_CONFIRMED";

export type BrowserCaseVerdictResult = {
  verdict: BrowserCaseVerdict;
  reason: BrowserCaseVerdictReason;
  /** Presentation-only first failed prerequisite; never changes the verdict. */
  blockerDiagnostic?: string;
  requiredCheckIds: string[];
  passedCheckIds: string[];
  failedCheckIds: string[];
  missingCheckIds: string[];
};

/** Presentation-only decomposition of the existing execution-context gate. */
export function executionContextBlocker(
  authority: BrowserCaseExecutionAuthority,
  testCase: BrowserTestCase
): string | null {
  if (authority.actualPersona.status !== "AVAILABLE") return "ACTUAL_PERSONA_UNAVAILABLE";
  if (authority.actualPersona.value !== testCase.persona) return "PERSONA_MISMATCH";
  if (authority.acceptedRoutePath.status !== "AVAILABLE") return "ACCEPTED_ROUTE_UNAVAILABLE";
  const routePolicy = testCase.executionIntentAuthority?.sourceTargetEnvelope.routePolicy;
  if (routePolicy?.kind === "PREBOUND_EXACT" && routePolicy.authority === "SOURCE_ROUTE" && authority.acceptedRoutePath.value !== routePolicy.route) return "SOURCE_ROUTE_MISMATCH";
  if (authority.targetVerified.status !== "AVAILABLE") return "TARGET_VERIFICATION_UNAVAILABLE";
  if (authority.targetVerified.value !== true) return "TARGET_VERIFICATION_FAILED";
  return null;
}

/** Discovery support execution is operational unless it owns local acceptance scope. */
export function isOperationalDiscoverySupportUnit(testCase: BrowserTestCase): boolean {
  return testCase.executionPolicy?.lane === "DISCOVERY_ONLY" &&
    (testCase.acceptanceObligationIds?.length ?? 0) === 0;
}

/**
 * Applies the sole canonical case-level outcome to the legacy result transport.
 *
 * Legacy status remains populated for existing consumers, but may only mirror
 * this already-derived verdict after case evaluation. Coverage policy and
 * visual review therefore cannot independently promote or replace a case
 * outcome.
 */
export function applyBrowserCaseVerdict<T extends {
  status: BrowserCaseVerdict;
  reasonCategory: string;
  caseVerdict?: BrowserCaseVerdictResult;
}>(result: T, caseVerdict: BrowserCaseVerdictResult): T {
  result.caseVerdict = caseVerdict;
  result.status = caseVerdict.verdict;
  result.reasonCategory = caseVerdict.reason;
  return result;
}

/** Typed finalized facts that are intentionally separate from raw-PASS proof readiness. */
export type BrowserCaseExecutionAuthority = {
  actualPersona: BrowserPassRuntimeSignal<BrowserTestCase["persona"]>;
  acceptedRoutePath: BrowserPassRuntimeSignal<string>;
  targetVerified: BrowserPassRuntimeSignal<boolean>;
  fixtureStatus: BrowserPassRuntimeSignal<BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"]>;
};

type CheckOutcome = "PASS" | "FAIL" | "MISSING";

function sameIds(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000");
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim() ===
    right.replace(/\s+/g, " ").trim();
}

function unavailableResult(
  reason: Extract<BrowserCaseVerdictReason,
    "EXECUTION_CONTRACT_UNAVAILABLE" | "EXECUTION_CONTEXT_UNAVAILABLE" |
    "FIXTURE_UNAVAILABLE" | "RUNTIME_AUDIT_INCOMPLETE" | "UNSAFE_EXECUTION" |
    "PRODUCT_MUTATION_OBSERVED" | "PERSISTENCE_VIOLATION" | "TEST_DATA_ISSUE">,
  contract?: BrowserExecutionCheckContract,
  blockerDiagnostic?: string
): BrowserCaseVerdictResult {
  return {
    verdict: "BLOCKED",
    reason,
    ...(blockerDiagnostic ? { blockerDiagnostic } : {}),
    requiredCheckIds: contract?.requiredChecks.map((check) => check.checkId) ?? [],
    passedCheckIds: [],
    failedCheckIds: [],
    missingCheckIds: [],
  };
}

function exactSourceRequirement(
  check: Extract<BrowserExecutionCheckRequirement, { kind: "SOURCE_BOUND_ASSERTION_MEMBER" }>,
  testCase: BrowserTestCase,
  requirements: BrowserSourceBoundAssertionSetRequirement[]
): BrowserSourceBoundAssertionSetRequirement | null {
  const routePolicy =
    testCase.executionIntentAuthority
      ?.sourceTargetEnvelope
      .routePolicy;

  /*
   * RUNTIME_ROUTE_REQUIREMENT_ID_REBIND_V1
   *
   * Source-bound requirement IDs currently include routePath. A contract
   * created before runtime route discovery therefore carries the bounded
   * planner-time requirement ID, while fresh runtime proof carries an ID
   * derived from the accepted route.
   *
   * Route rebinding may relax only that generated requirement ID when the
   * source did not author an exact route. Case, obligation, source units,
   * source refs, oracle, action and expected text remain exact and unique.
   * Explicit SOURCE_ROUTE authority keeps exact requirement-ID matching.
   */
  const runtimeRouteMayRebindRequirementIdentity =
    routePolicy?.kind === "RUNTIME_DISCOVERABLE" ||
    (
      routePolicy?.kind === "PREBOUND_EXACT" &&
      routePolicy.authority !== "SOURCE_ROUTE"
    );

  const matches = requirements.filter((requirement) =>
    (
      runtimeRouteMayRebindRequirementIdentity ||
      requirement.requirementId === check.requirementId
    ) &&
    requirement.executionCaseId === testCase.id &&
    (testCase.executionVerdictScope?.executionObligationIds ?? [])
      .includes(requirement.obligationId) &&
    sameIds(requirement.sourceUnitIds, check.sourceUnitIds) &&
    sameIds(requirement.sourceRefs, check.sourceRefs) &&
    requirement.members.filter((member) =>
      member.oracleId === check.oracle.oracleId &&
      member.action === check.oracle.action &&
      sameText(member.expectedText, check.oracle.expectedText)
    ).length === 1
  );
  return matches.length === 1 ? matches[0]! : null;
}

function sourceBoundOutcome(args: {
  check: Extract<BrowserExecutionCheckRequirement, { kind: "SOURCE_BOUND_ASSERTION_MEMBER" }>;
  testCase: BrowserTestCase;
  executionAuthority: BrowserCaseExecutionAuthority;
  requirements: BrowserSourceBoundAssertionSetRequirement[];
  evidence: BrowserSourceBoundAssertionSetEvidence[];
  deterministicEvidence: BrowserDeterministicEvidence[];
}): CheckOutcome {
  const requirement = exactSourceRequirement(
    args.check, args.testCase, args.requirements
  );
  if (!requirement) return "MISSING";
  const evidence = args.evidence.filter((item) =>
    item.proofRequirementId === requirement.requirementId &&
    item.obligationId === requirement.obligationId &&
    item.executionCaseId === requirement.executionCaseId &&
    item.persona === requirement.persona &&
    item.routePath === requirement.routePath &&
    item.freshObservation === true &&
    sameIds(item.sourceUnitIds, requirement.sourceUnitIds) &&
    sameIds(item.sourceRefs, requirement.sourceRefs) &&
    item.members.filter((member) =>
      member.oracleId === args.check.oracle.oracleId &&
      member.action === args.check.oracle.action &&
      sameText(member.expectedText, args.check.oracle.expectedText)
    ).length === 1
  );
  if (evidence.length !== 1) return "MISSING";
  const recordedMember = evidence[0]!.members.find((member) =>
    member.oracleId === args.check.oracle.oracleId &&
    member.action === args.check.oracle.action &&
    sameText(member.expectedText, args.check.oracle.expectedText)
  );
  if (!recordedMember) return "MISSING";

  if (args.check.oracle.action === "assertExactVisibleButton") {
    return recordedMember.result === "CONFIRMED"
      ? "PASS"
      : recordedMember.result === "CONTRADICTED" ? "FAIL" : "MISSING";
  }
  if (
    args.executionAuthority.actualPersona.status !== "AVAILABLE" ||
    args.executionAuthority.acceptedRoutePath.status !== "AVAILABLE"
  ) return "MISSING";
  const revalidated = evaluateBrowserSourceBoundAssertionSet({
    requirement,
    deterministicEvidence: args.deterministicEvidence,
    actualPersona: args.executionAuthority.actualPersona.value,
    actualRoutePath: args.executionAuthority.acceptedRoutePath.value,
    freshObservation: true,
  });
  const revalidatedMember = revalidated.members.find((member) =>
    member.oracleId === args.check.oracle.oracleId &&
    member.action === args.check.oracle.action &&
    sameText(member.expectedText, args.check.oracle.expectedText)
  );
  if (!revalidatedMember || revalidatedMember.result !== recordedMember.result) {
    return "MISSING";
  }
  return recordedMember.result === "CONFIRMED"
    ? "PASS"
    : recordedMember.result === "CONTRADICTED" ? "FAIL" : "MISSING";
}

function structuralControlPresenceOutcome(args: {
  check: Extract<BrowserExecutionCheckRequirement, { kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE" }>;
  testCase: BrowserTestCase;
  requirements: BrowserSourceBoundStructuralControlPresenceRequirement[];
  evidence: BrowserSourceBoundStructuralControlPresenceEvidence[];
}): CheckOutcome {
  const requirementMatches = args.requirements.filter((requirement) =>
    requirement.requirementId === args.check.requirementId &&
    requirement.executionCaseId === args.testCase.id &&
    (requirement.sourceRole === "ACCEPTANCE" && requirement.proofAuthority === "ACCEPTANCE" ||
      requirement.sourceRole === "TASK" && requirement.proofAuthority === "DIRECT_TASK" && requirement.derivation === "DIRECT_TASK_SECTION") &&
    (args.testCase.executionVerdictScope?.executionObligationIds ?? []).includes(requirement.obligationId) &&
    sameIds(requirement.sourceUnitIds, args.check.sourceUnitIds) &&
    sameIds(requirement.sourceRefs, args.check.sourceRefs) &&
    requirement.control.semanticKind === args.check.control.semanticKind &&
    requirement.control.cardinality === args.check.control.cardinality
  );
  if (requirementMatches.length !== 1) return "MISSING";
  const requirement = requirementMatches[0]!;
  const evidenceMatches = args.evidence.filter((item) =>
    item.proofRequirementId === requirement.requirementId &&
    item.obligationId === requirement.obligationId &&
    item.executionCaseId === requirement.executionCaseId &&
    item.persona === requirement.persona && item.routePath === requirement.routePath &&
    item.freshObservation === true && sameIds(item.sourceUnitIds, requirement.sourceUnitIds) &&
    sameIds(item.sourceRefs, requirement.sourceRefs) &&
    item.control.semanticKind === requirement.control.semanticKind &&
    item.control.cardinality === requirement.control.cardinality
  );
  if (evidenceMatches.length !== 1) return "MISSING";
  return evidenceMatches[0]!.result === "CONFIRMED" ? "PASS" : "MISSING";
}

function localStateOutcome(args: {
  check: Extract<BrowserExecutionCheckRequirement, { kind: "LOCAL_STATE_TRANSITION" }>;
  testCase: BrowserTestCase;
  executionAuthority: BrowserCaseExecutionAuthority;
  evidence: BrowserGroundedLocalStateTransitionEvidence[];
}): CheckOutcome {
  if (args.executionAuthority.acceptedRoutePath.status !== "AVAILABLE") return "MISSING";
  const routePath = args.executionAuthority.acceptedRoutePath.value;
  const matches = args.evidence.filter((item) =>
    item.proofRequirementId === args.check.requirementId &&
    (args.testCase.executionVerdictScope?.executionObligationIds ?? [])
      .includes(item.obligationId) &&
    item.proofAuthority === "ACCEPTANCE" &&
    item.expectedValueAuthority === "JIRA_AUTHORIZED" &&
    item.surface.routePath === routePath
  );
  if (matches.length !== 1) return "MISSING";
  return matches[0]!.result === "CONFIRMED"
    ? "PASS"
    : matches[0]!.result === "CONTRADICTED" ? "FAIL" : "MISSING";
}

function evidenceContractOutcome(args: {
  check: Extract<BrowserExecutionCheckRequirement, { kind: "EVIDENCE_CONTRACT_BINDING" }>;
  testCase: BrowserTestCase;
  evidence: BrowserEvidenceContractProofResult[];
}): CheckOutcome {
  const matches = args.evidence.filter((item) =>
    item.bindingId === args.check.bindingId &&
    item.evidenceContractId === args.check.evidenceContractId &&
    (args.testCase.executionVerdictScope?.executionObligationIds ?? [])
      .includes(item.obligationId) &&
    item.freshObservation === true
  );
  if (matches.length !== 1) return "MISSING";
  return matches[0]!.status === "CONFIRMED"
    ? "PASS"
    : matches[0]!.status === "CONTRADICTED" ? "FAIL" : "MISSING";
}

function checkOutcome(args: {
  check: BrowserExecutionCheckRequirement;
  testCase: BrowserTestCase;
  executionAuthority: BrowserCaseExecutionAuthority;
  sourceBoundAssertionSetRequirements: BrowserSourceBoundAssertionSetRequirement[];
  sourceBoundAssertionSetEvidence: BrowserSourceBoundAssertionSetEvidence[];
  structuralControlPresenceRequirements: BrowserSourceBoundStructuralControlPresenceRequirement[];
  structuralControlPresenceEvidence: BrowserSourceBoundStructuralControlPresenceEvidence[];
  deterministicEvidence: BrowserDeterministicEvidence[];
  localStateTransitionEvidence: BrowserGroundedLocalStateTransitionEvidence[];
  evidenceContractProofResults: BrowserEvidenceContractProofResult[];
}): CheckOutcome {
  if (args.check.kind === "SOURCE_BOUND_ASSERTION_MEMBER") {
    return sourceBoundOutcome({
      check: args.check,
      testCase: args.testCase,
      executionAuthority: args.executionAuthority,
      requirements: args.sourceBoundAssertionSetRequirements,
      evidence: args.sourceBoundAssertionSetEvidence,
      deterministicEvidence: args.deterministicEvidence,
    });
  }
  if (args.check.kind === "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE") {
    return structuralControlPresenceOutcome({
      check: args.check,
      testCase: args.testCase,
      requirements: args.structuralControlPresenceRequirements,
      evidence: args.structuralControlPresenceEvidence,
    });
  }
  if (args.check.kind === "LOCAL_STATE_TRANSITION") {
    return localStateOutcome({
      check: args.check,
      testCase: args.testCase,
      executionAuthority: args.executionAuthority,
      evidence: args.localStateTransitionEvidence,
    });
  }
  return evidenceContractOutcome({
    check: args.check,
    testCase: args.testCase,
    evidence: args.evidenceContractProofResults,
  });
}

function validContract(args: {
  testCase: BrowserTestCase;
  contract: BrowserExecutionCheckContract | undefined;
}): args is { testCase: BrowserTestCase; contract: BrowserExecutionCheckContract } {
  if (!args.contract || !args.testCase.executionVerdictScope) return false;
  const checkIds = args.contract.requiredChecks.map((check) => check.checkId);
  return args.contract.caseId === args.testCase.id &&
    sameIds(
      args.contract.executionObligationIds,
      args.testCase.executionVerdictScope.executionObligationIds
    ) &&
    new Set(checkIds).size === checkIds.length;
}

/**
 * RUNTIME_SOURCE_AUTHORIZED_EXECUTION_CONTRACT_RECONSTRUCTION_V1
 *
 * A missing planner-time executionCheckContract must not itself become
 * execution authority or a permanent veto.
 *
 * Reconstruction is allowed only from already-materialized, typed,
 * source-authorized runtime requirements. Planner prose, screenshots,
 * evidence review, raw PASS, and untyped assertions cannot participate.
 *
 * An existing contract is never replaced here. Invalid existing transport
 * must continue to fail closed rather than being hidden by reconstruction.
 */
export function materializeBrowserRuntimeExecutionContract(args: {
  testCase: BrowserTestCase;
  executionCheckContract?: BrowserExecutionCheckContract;
  acceptedRoutePath: string | null | undefined;
  sourceBoundAssertionSetRequirements?: BrowserSourceBoundAssertionSetRequirement[];
  structuralControlPresenceRequirements?: BrowserSourceBoundStructuralControlPresenceRequirement[];
}): {
  testCase: BrowserTestCase;
  executionCheckContract?: BrowserExecutionCheckContract;
} {
  if (args.executionCheckContract) {
    if ((args.structuralControlPresenceRequirements ?? []).length === 0) {
      return {
        testCase: args.testCase,
        executionCheckContract:
          args.executionCheckContract,
      };
    }
    const structuralRuntimeCase: BrowserTestCase = {
      ...args.testCase,
      startRoute: String(args.acceptedRoutePath || args.testCase.startRoute || ""),
    };
    const structuralContract = deriveBrowserExecutionCheckContract({
      testCase: structuralRuntimeCase,
      ...(args.structuralControlPresenceRequirements
        ? {
            structuralControlPresenceRequirements:
              args.structuralControlPresenceRequirements,
          }
        : {}),
    });
    if (!structuralContract || structuralContract.requiredChecks.length === 0) {
      return {
        testCase: args.testCase,
        executionCheckContract: args.executionCheckContract,
      };
    }
    return {
      testCase: args.testCase,
      executionCheckContract: {
        ...args.executionCheckContract,
        requiredChecks: [
          ...args.executionCheckContract.requiredChecks,
          ...structuralContract.requiredChecks.filter((structuralCheck) =>
            !args.executionCheckContract!.requiredChecks.some((check) =>
              check.checkId === structuralCheck.checkId
            )
          ),
        ].sort((left, right) => left.checkId.localeCompare(right.checkId)),
      },
    };
  }

  const acceptedRoutePath =
    String(args.acceptedRoutePath || "").trim();

  if (!acceptedRoutePath) {
    return {
      testCase: args.testCase,
    };
  }

  const routePolicy =
    args.testCase.executionIntentAuthority
      ?.sourceTargetEnvelope
      .routePolicy;

  if (
    routePolicy?.kind === "PREBOUND_EXACT" &&
    routePolicy.authority === "SOURCE_ROUTE" &&
    routePolicy.route !== acceptedRoutePath
  ) {
    return {
      testCase: args.testCase,
    };
  }

  const requirements =
    (
      args.sourceBoundAssertionSetRequirements ??
      []
    ).filter((requirement) =>
      requirement.executionCaseId ===
        args.testCase.id &&
      requirement.persona ===
        args.testCase.persona &&
      requirement.routePath ===
        acceptedRoutePath &&
      requirement.sourceUnitIds.length > 0 &&
      requirement.sourceRefs.length > 0 &&
      hasApprovedCaseLevelSourceBoundAssertionAuthority(
        requirement
      )
    );

  const existingExecutionObligationIds =
    args.testCase.executionVerdictScope
      ?.executionObligationIds ??
    args.testCase.acceptanceObligationIds ??
    [];

  const executionObligationIds = [
    ...new Set(
      existingExecutionObligationIds.length > 0
        ? existingExecutionObligationIds
        : requirements.map(
            (requirement) =>
              requirement.obligationId
          )
    ),
  ].sort();

  if (executionObligationIds.length === 0) {
    return {
      testCase: args.testCase,
    };
  }

  /*
   * Do not reconstruct a partial case contract. Every execution obligation
   * must have at least one approved typed source requirement at runtime.
   */
  const structuralRequirements = (args.structuralControlPresenceRequirements ?? []).filter((requirement) =>
    requirement.executionCaseId === args.testCase.id && requirement.persona === args.testCase.persona &&
    requirement.routePath === acceptedRoutePath &&
    (requirement.sourceRole === "ACCEPTANCE" && requirement.proofAuthority === "ACCEPTANCE" ||
      requirement.sourceRole === "TASK" && requirement.proofAuthority === "DIRECT_TASK" && requirement.derivation === "DIRECT_TASK_SECTION") &&
    requirement.sourceUnitIds.length > 0 && requirement.sourceRefs.length > 0
  );
  const requirementObligationIds =
    new Set(
      [...requirements, ...structuralRequirements].map(
        (requirement) =>
          requirement.obligationId
      )
    );

  if (
    executionObligationIds.some(
      (obligationId) =>
        !requirementObligationIds.has(
          obligationId
        )
    )
  ) {
    return {
      testCase: args.testCase,
    };
  }

  const executionVerdictScope =
    args.testCase.executionVerdictScope ?? {
      executionObligationIds,
      verdictScopeObligationIds:
        executionObligationIds,
      /*
       * Reconstructed runtime scope is local-only.
       * It must never manufacture independent ticket authority.
       */
      verdictAuthority:
        "GROUP_ONLY" as const,
    };

  const runtimeCase: BrowserTestCase = {
    ...args.testCase,
    /*
     * Navigation startRoute remains planner/runtime guidance.
     * Contract derivation binds to the accepted runtime route.
     */
    startRoute: acceptedRoutePath,
    executionVerdictScope,
  };

  const executionCheckContract =
    deriveBrowserExecutionCheckContract({
      testCase: runtimeCase,
      sourceBoundAssertionSetRequirements:
        requirements,
      structuralControlPresenceRequirements: structuralRequirements,
    });

  if (
    !executionCheckContract ||
    executionCheckContract.requiredChecks
      .length === 0
  ) {
    return {
      testCase: args.testCase,
    };
  }

  return {
    testCase: runtimeCase,
    executionCheckContract,
  };
}

/**
 * Pure case-level verdict derivation. It has no ticket authority: callers may
 * transport this result independently from the legacy raw browser status.
 */
export function deriveBrowserCaseVerdict(args: {
  testCase: BrowserTestCase;
  executionCheckContract?: BrowserExecutionCheckContract;
  executionAuthority: BrowserCaseExecutionAuthority;
  runtimeAudit?: BrowserCaseRuntimeAudit;
  runnerStatus?: "PASS" | "FAIL" | "BLOCKED" | "MANUAL_REQUIRED" | "ERROR";
  sourceBoundAssertionSetRequirements?: BrowserSourceBoundAssertionSetRequirement[];
  sourceBoundAssertionSetEvidence?: BrowserSourceBoundAssertionSetEvidence[];
  structuralControlPresenceRequirements?: BrowserSourceBoundStructuralControlPresenceRequirement[];
  structuralControlPresenceEvidence?: BrowserSourceBoundStructuralControlPresenceEvidence[];
  deterministicEvidence?: BrowserDeterministicEvidence[];
  localStateTransitionEvidence?: BrowserGroundedLocalStateTransitionEvidence[];
  evidenceContractProofResults?: BrowserEvidenceContractProofResult[];
}): BrowserCaseVerdictResult {
  if (args.runnerStatus === "ERROR") {
    return {
      verdict: "ERROR", reason: "RUNNER_ERROR", requiredCheckIds: [],
      passedCheckIds: [], failedCheckIds: [], missingCheckIds: [],
    };
  }
  if (!validContract({ testCase: args.testCase, contract: args.executionCheckContract })) {
    return unavailableResult("EXECUTION_CONTRACT_UNAVAILABLE", args.executionCheckContract);
  }
  const contract = args.executionCheckContract;
  if (!contract) {
    return unavailableResult("EXECUTION_CONTRACT_UNAVAILABLE");
  }
  const authority = args.executionAuthority;
  /*
   * PHASE2_RUNTIME_ROUTE_AUTHORITY_V1
   *
   * Planner startRoute and manifest-derived routes describe HOW to begin
   * navigation. A fresh accepted runtime route may legitimately differ after
   * bounded navigation. Only a route explicitly constrained by source remains
   * a hard case-verdict route constraint.
   */
  const contextBlocker = executionContextBlocker(authority, args.testCase);
  if (contextBlocker) return unavailableResult("EXECUTION_CONTEXT_UNAVAILABLE", contract, contextBlocker);
  if (
    authority.fixtureStatus.status !== "AVAILABLE" ||
    !["READY", "NOT_REQUIRED"].includes(authority.fixtureStatus.value)
  ) return unavailableResult("FIXTURE_UNAVAILABLE", contract);

  const safety = deriveBrowserCaseRuntimeSafetySignals(args.runtimeAudit);
  if (
    safety.safetyViolation.status !== "AVAILABLE" ||
    safety.productNonGetCount.status !== "AVAILABLE" ||
    safety.persistenceViolation.status !== "AVAILABLE" ||
    safety.testDataIssue.status !== "AVAILABLE"
  ) return unavailableResult("RUNTIME_AUDIT_INCOMPLETE", contract);
  if (safety.safetyViolation.value) return unavailableResult("UNSAFE_EXECUTION", contract);
  if (safety.productNonGetCount.value > 0) return unavailableResult("PRODUCT_MUTATION_OBSERVED", contract);
  if (safety.persistenceViolation.value) return unavailableResult("PERSISTENCE_VIOLATION", contract);
  if (safety.testDataIssue.value) return unavailableResult("TEST_DATA_ISSUE", contract);

  const outcomes = contract.requiredChecks.map((check) => ({
    checkId: check.checkId,
    outcome: checkOutcome({
      check,
      testCase: args.testCase,
      executionAuthority: authority,
      sourceBoundAssertionSetRequirements: args.sourceBoundAssertionSetRequirements ?? [],
      sourceBoundAssertionSetEvidence: args.sourceBoundAssertionSetEvidence ?? [],
      structuralControlPresenceRequirements: args.structuralControlPresenceRequirements ?? [],
      structuralControlPresenceEvidence: args.structuralControlPresenceEvidence ?? [],
      deterministicEvidence: args.deterministicEvidence ?? [],
      localStateTransitionEvidence: args.localStateTransitionEvidence ?? [],
      evidenceContractProofResults: args.evidenceContractProofResults ?? [],
    }),
  }));
  const result = {
    requiredCheckIds: contract.requiredChecks.map((check) => check.checkId),
    passedCheckIds: outcomes.filter((item) => item.outcome === "PASS").map((item) => item.checkId),
    failedCheckIds: outcomes.filter((item) => item.outcome === "FAIL").map((item) => item.checkId),
    missingCheckIds: outcomes.filter((item) => item.outcome === "MISSING").map((item) => item.checkId),
  };
  if (result.failedCheckIds.length > 0) {
    return { verdict: "FAIL", reason: "REQUIRED_CHECK_CONTRADICTED", ...result };
  }
  if (contract.requiredChecks.length === 0) {
    return { verdict: "MANUAL_REQUIRED", reason: "NO_SOURCE_AUTHORIZED_EXECUTION_CHECKS", ...result };
  }
  if (contract.requiredManualCheckIds.length > 0) {
    return { verdict: "MANUAL_REQUIRED", reason: "TYPED_MANUAL_CHECK_REQUIRED", ...result };
  }
  if (result.missingCheckIds.length > 0) {
    return { verdict: "MANUAL_REQUIRED", reason: "REQUIRED_CHECK_EVIDENCE_MISSING", ...result };
  }
  return { verdict: "PASS", reason: "ALL_REQUIRED_CHECKS_CONFIRMED", ...result };
}
