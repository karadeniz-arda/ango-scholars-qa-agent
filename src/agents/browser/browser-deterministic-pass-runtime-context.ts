import type { BrowserDeterministicPassRuntimePrerequisites } from "./browser-deterministic-pass-policy.js";
import type {
  BrowserLocalStatePassProof,
  BrowserSourceBoundAssertionSetPassProof,
} from "./browser-deterministic-pass-policy.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import {
  auditBrowserCaseProofReadiness,
  evaluateBrowserLocalStateObligationDischarge,
  type BrowserCaseProofReadiness,
  type BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import {
  evaluateBrowserSourceBoundAssertionSetDischarge,
} from "./browser-source-bound-assertion-set-proof.js";
import type {
  BrowserSourceBoundStructuralControlPresenceEvidence,
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "./browser-source-bound-structural-control-presence-proof.js";
import type { BrowserCaseRuntimeAudit } from "./browser-case-runtime-audit.js";

export type BrowserPassRuntimeSignal<T> =
  | { status: "AVAILABLE"; value: T; source: string }
  | { status: "UNAVAILABLE"; reason: string };

export type BrowserDeterministicPassRuntimeContext = {
  fixtureStatus: BrowserPassRuntimeSignal<BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"]>;
  acceptedRoutePath: BrowserPassRuntimeSignal<string>;
  targetVerified: BrowserPassRuntimeSignal<boolean>;
  requiredExecutionCompleted: BrowserPassRuntimeSignal<boolean>;
  safetyViolation: BrowserPassRuntimeSignal<boolean>;
  testDataIssue: BrowserPassRuntimeSignal<boolean>;
  productNonGetCount: BrowserPassRuntimeSignal<number>;
  persistenceViolation: BrowserPassRuntimeSignal<boolean>;
};

const unavailable = <T>(reason: string): BrowserPassRuntimeSignal<T> => ({ status: "UNAVAILABLE", reason });

/*
 * CASE_LOCAL_SOURCE_TARGET_AUTHORITY_V1
 *
 * Case-local target verification is intentionally independent from
 * ticket-level obligation allocation/discharge.
 *
 * A fresh source-bound assertion observation can establish that this exact
 * case/persona/route target was reached even when ticket accounting cannot
 * uniquely assign the same Jira obligation to one runtime case.
 *
 * This helper does NOT create PASS authority. Canonical PASS/FAIL is still
 * decided later from executionCheckContract.requiredChecks and their exact
 * deterministic evidence.
 */
function sameStringSet(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000");
}

function sameTargetText(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim() ===
    right.replace(/\s+/g, " ").trim();
}

function sourceBoundProofVerifiesCaseLocalTarget(args: {
  proof: BrowserSourceBoundAssertionSetPassProof;
  testCase: BrowserTestCase;
  acceptedRoutePath: string;
  actualPersona: string | null | undefined;
}): boolean {
  const { requirement, evidence } = args.proof;

  if (!args.actualPersona) return false;

  if (
    requirement.executionCaseId !== args.testCase.id ||
    evidence.executionCaseId !== args.testCase.id ||
    requirement.routePath !== args.acceptedRoutePath ||
    evidence.routePath !== args.acceptedRoutePath ||
    requirement.persona !== args.actualPersona ||
    evidence.persona !== args.actualPersona ||
    evidence.freshObservation !== true ||
    evidence.proofRequirementId !== requirement.requirementId ||
    evidence.obligationId !== requirement.obligationId ||
    !sameStringSet(evidence.sourceUnitIds, requirement.sourceUnitIds) ||
    !sameStringSet(evidence.sourceRefs, requirement.sourceRefs) ||
    evidence.members.length !== requirement.members.length
  ) {
    return false;
  }

  return requirement.members.every((member) =>
    evidence.members.filter((candidate) =>
      candidate.oracleId === member.oracleId &&
      candidate.action === member.action &&
      sameTargetText(candidate.expectedText, member.expectedText) &&
      candidate.result !== "NOT_EXECUTED"
    ).length === 1
  );
}

function structuralControlPresenceProofVerifiesCaseLocalTarget(args: {
  requirement: BrowserSourceBoundStructuralControlPresenceRequirement;
  evidence: BrowserSourceBoundStructuralControlPresenceEvidence;
  testCase: BrowserTestCase;
  acceptedRoutePath: string;
  actualPersona: string | null | undefined;
}): boolean {
  return Boolean(
    args.actualPersona &&
    args.requirement.executionCaseId === args.testCase.id &&
    args.evidence.executionCaseId === args.testCase.id &&
    args.requirement.routePath === args.acceptedRoutePath &&
    args.evidence.routePath === args.acceptedRoutePath &&
    args.requirement.persona === args.actualPersona &&
    args.evidence.persona === args.actualPersona &&
    args.evidence.freshObservation === true &&
    args.evidence.proofRequirementId === args.requirement.requirementId &&
    args.evidence.obligationId === args.requirement.obligationId &&
    sameStringSet(args.evidence.sourceUnitIds, args.requirement.sourceUnitIds) &&
    sameStringSet(args.evidence.sourceRefs, args.requirement.sourceRefs) &&
    args.evidence.control.semanticKind === args.requirement.control.semanticKind &&
    args.evidence.control.cardinality === args.requirement.control.cardinality &&
    args.evidence.result === "CONFIRMED" &&
    args.evidence.matchingControlCount >= 1
  );
}

export type BrowserDeterministicProofRuntimeDerivationInput = {
  testCase?: BrowserTestCase;
  obligationLedger?: PlannerAcceptanceObligationLedger;
  browserObligationBindings?: PlannerBrowserObligationBinding[];
  localStateProofs?: BrowserLocalStatePassProof[];
  sourceBoundAssertionSetProofs?: BrowserSourceBoundAssertionSetPassProof[];
  structuralControlPresenceProofs?: Array<{
    requirement: BrowserSourceBoundStructuralControlPresenceRequirement;
    evidence: BrowserSourceBoundStructuralControlPresenceEvidence;
  }>;
  deterministicObligationDischarges?: BrowserDeterministicObligationDischarge[];
  caseProofReadiness?: BrowserCaseProofReadiness;
  acceptedRoutePath?: string | null;
  actualPersona?: string | null;
};

type IndependentlyValidatedProof = {
  proof: BrowserLocalStatePassProof | BrowserSourceBoundAssertionSetPassProof;
  discharge: BrowserDeterministicObligationDischarge;
};

function exactDischargePresent(
  discharge: BrowserDeterministicObligationDischarge,
  supplied: BrowserDeterministicObligationDischarge[]
): boolean {
  return supplied.filter((candidate) =>
    candidate.kind === "DETERMINISTIC_OBLIGATION_PROVED" &&
    candidate.evidenceResult === "CONFIRMED" &&
    candidate.obligationId === discharge.obligationId &&
    candidate.sourceId === discharge.sourceId &&
    candidate.proofRequirementId === discharge.proofRequirementId &&
    candidate.proofKind === discharge.proofKind
  ).length === 1;
}

function validateApprovedProofs(args: Required<Pick<BrowserDeterministicProofRuntimeDerivationInput,
  "testCase" | "obligationLedger" | "browserObligationBindings" | "localStateProofs" | "sourceBoundAssertionSetProofs"
>>): IndependentlyValidatedProof[] | null {
  const proofs = [
    ...args.localStateProofs,
    ...args.sourceBoundAssertionSetProofs,
  ];
  const validated: IndependentlyValidatedProof[] = [];
  for (const proof of proofs) {
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
    if (decision.status !== "DETERMINISTIC_OBLIGATION_PROVED") return null;
    validated.push({ proof, discharge: decision.discharge });
  }
  return validated;
}

/**
 * Derives only proof-owned prerequisite signals. It revalidates the approved
 * proof families and never accepts navigation, goal, lane, or review signals.
 */
export function deriveBrowserDeterministicProofRuntimeSignals(
  args: BrowserDeterministicProofRuntimeDerivationInput
): Pick<BrowserDeterministicPassRuntimeContext, "targetVerified" | "requiredExecutionCompleted"> {
  const caseLocalSourceTargetVerified = (() => {
    const testCase = args.testCase;
    const acceptedRoutePath = args.acceptedRoutePath;
    const actualPersona = args.actualPersona;
    if (!testCase || !acceptedRoutePath || !actualPersona) return false;
    return args.sourceBoundAssertionSetProofs?.some((proof) =>
      sourceBoundProofVerifiesCaseLocalTarget({
        proof,
        testCase,
        acceptedRoutePath,
        actualPersona,
      })
    ) || (args.structuralControlPresenceProofs ?? []).some((proof) =>
      structuralControlPresenceProofVerifiesCaseLocalTarget({
        ...proof,
        testCase,
        acceptedRoutePath,
        actualPersona,
      })
    ) || false;
  })();
  const targetVerified = args.testCase && args.acceptedRoutePath && args.actualPersona
    ? {
        status: "AVAILABLE" as const,
        value: caseLocalSourceTargetVerified,
        source: caseLocalSourceTargetVerified
          ? "Fresh source-bound evidence independently verified the exact case-local target context."
          : "No fresh source-bound evidence independently verified the exact case-local target context.",
      }
    : unavailable<boolean>("Exact case-local target inputs were not all supplied.");

  if (!args.testCase || !args.obligationLedger || !args.browserObligationBindings ||
      !args.localStateProofs || !args.sourceBoundAssertionSetProofs ||
      !args.deterministicObligationDischarges || !args.caseProofReadiness ||
      !args.acceptedRoutePath) {
    return {
      targetVerified,
      requiredExecutionCompleted: unavailable("Exact deterministic proof-completion inputs were not all supplied."),
    };
  }

  const validated = validateApprovedProofs({
    testCase: args.testCase,
    obligationLedger: args.obligationLedger,
    browserObligationBindings: args.browserObligationBindings,
    localStateProofs: args.localStateProofs,
    sourceBoundAssertionSetProofs: args.sourceBoundAssertionSetProofs,
  });

  if (!validated) {
    return {
      targetVerified: {
        status: "AVAILABLE",
        value: caseLocalSourceTargetVerified,
        source: caseLocalSourceTargetVerified
          ? "Fresh source-bound evidence independently verified the exact case-local target context."
          : "No fresh source-bound evidence independently verified the exact case-local target context.",
      },
      requiredExecutionCompleted: {
        status: "AVAILABLE",
        value: false,
        source: "Ticket-level obligation discharge/readiness did not prove complete allocated-obligation execution.",
      },
    };
  }

  const targetProofs = validated.filter(({ proof, discharge }) => {
    if (!exactDischargePresent(discharge, args.deterministicObligationDischarges!)) return false;
    if (proof.kind === "SOURCE_BOUND_ASSERTION_SET") {
      return proof.requirement.executionCaseId === args.testCase!.id &&
        proof.requirement.routePath === args.acceptedRoutePath &&
        proof.evidence.routePath === args.acceptedRoutePath &&
        proof.requirement.persona === args.actualPersona &&
        proof.evidence.persona === args.actualPersona;
    }
    return proof.requirement.surface.routePath === args.acceptedRoutePath &&
      proof.evidence.surface.routePath === args.acceptedRoutePath;
  });

  const recomputedReadiness = auditBrowserCaseProofReadiness({
    testCase: args.testCase,
    discharges: validated.map(({ discharge }) => discharge),
    browserObligationBindings: args.browserObligationBindings,
  });
  const suppliedReadinessMatches =
    args.caseProofReadiness.status === recomputedReadiness.status &&
    JSON.stringify(args.caseProofReadiness.allocatedObligationIds) === JSON.stringify(recomputedReadiness.allocatedObligationIds) &&
    JSON.stringify(args.caseProofReadiness.provedObligationIds) === JSON.stringify(recomputedReadiness.provedObligationIds) &&
    JSON.stringify(args.caseProofReadiness.remainingObligationIds) === JSON.stringify(recomputedReadiness.remainingObligationIds);
  const complete = recomputedReadiness.status === "CASE_PROOF_READY" &&
    recomputedReadiness.remainingObligationIds.length === 0 &&
    suppliedReadinessMatches &&
    recomputedReadiness.allocatedObligationIds.every((obligationId) =>
      validated.some(({ discharge }) => discharge.obligationId === obligationId &&
        exactDischargePresent(discharge, args.deterministicObligationDischarges!))
    );

  const caseLocalTargetVerified =
    caseLocalSourceTargetVerified || targetProofs.length > 0;

  return {
    targetVerified: {
      status: "AVAILABLE",
      value: caseLocalTargetVerified,
      source: targetProofs.length > 0
        ? "An approved deterministic proof independently revalidated the exact case target context."
        : caseLocalSourceTargetVerified
          ? "Fresh source-bound evidence independently verified the exact case-local target context."
          : "No fresh deterministic evidence independently verified the exact case-local target context.",
    },
    requiredExecutionCompleted: {
      status: "AVAILABLE",
      value: complete,
      source: complete
        ? "Independent deterministic discharge validation and readiness audit prove complete allocated-obligation execution."
        : "Independent deterministic discharge validation and readiness audit did not prove complete allocated-obligation execution.",
    },
  };
}

/** Consumes completed case-scoped runtime facts; it performs no browser I/O. */
export function deriveBrowserCaseRuntimeSafetySignals(
  audit: BrowserCaseRuntimeAudit | undefined
): Pick<BrowserDeterministicPassRuntimeContext, "safetyViolation" | "productNonGetCount" | "persistenceViolation" | "testDataIssue"> {
  if (!audit) {
    return {
      safetyViolation: unavailable("No case-scoped safety audit was supplied."),
      productNonGetCount: unavailable("No case-scoped product request audit was supplied."),
      persistenceViolation: unavailable("No case-scoped persistence audit was supplied."),
      testDataIssue: unavailable("No case-scoped test-data audit was supplied."),
    };
  }
  return {
    safetyViolation: audit.safety.status === "COMPLETE"
      ? { status: "AVAILABLE", value: audit.safety.unsafeExecutionCount > 0, source: "Completed case-scoped deterministic action-safety audit." }
      : unavailable("Case-scoped action-safety accounting did not complete."),
    productNonGetCount: audit.productRequests.status === "COMPLETE"
      ? { status: "AVAILABLE", value: audit.productRequests.nonGetAttempts.length, source: "Completed case-scoped product-origin request observer." }
      : unavailable("Case-scoped product request accounting did not complete."),
    persistenceViolation: audit.persistence.status === "UNAVAILABLE"
      ? unavailable("No authoritative persistence lifecycle result was supplied.")
      : { status: "AVAILABLE", value: audit.persistence.status === "VIOLATION", source: "Completed case-scoped persistence lifecycle audit." },
    testDataIssue: audit.testData.status === "UNAVAILABLE"
      ? unavailable("No authoritative test-data classification coverage was supplied.")
      : { status: "AVAILABLE", value: audit.testData.status === "TEST_DATA_ISSUE", source: "Completed case-scoped deterministic test-data classification." },
  };
}

/**
 * Projects only supplied authoritative runtime observations. Missing signals
 * remain unavailable; this adapter never supplies PASS-friendly defaults.
 */
export function buildBrowserDeterministicPassRuntimeContext(args: {
  fixtureStatus?: BrowserPassRuntimeSignal<BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"]>;
  acceptedRoutePath?: BrowserPassRuntimeSignal<string>;
  targetVerified?: BrowserPassRuntimeSignal<boolean>;
  requiredExecutionCompleted?: BrowserPassRuntimeSignal<boolean>;
  safetyViolation?: BrowserPassRuntimeSignal<boolean>;
  testDataIssue?: BrowserPassRuntimeSignal<boolean>;
  productNonGetCount?: BrowserPassRuntimeSignal<number>;
  persistenceViolation?: BrowserPassRuntimeSignal<boolean>;
}): BrowserDeterministicPassRuntimeContext {
  return {
    fixtureStatus: args.fixtureStatus ?? unavailable("No authoritative fixture lifecycle result was supplied."),
    acceptedRoutePath: args.acceptedRoutePath ?? unavailable("No accepted runtime route signal was supplied."),
    targetVerified: args.targetVerified ?? unavailable("No exact deterministic target-grounding signal was supplied."),
    requiredExecutionCompleted: args.requiredExecutionCompleted ?? unavailable("No deterministic proof-completion signal was supplied."),
    safetyViolation: args.safetyViolation ?? unavailable("No case-wide browser safety accounting signal was supplied."),
    testDataIssue: args.testDataIssue ?? unavailable("No authoritative test-data signal was supplied."),
    productNonGetCount: args.productNonGetCount ?? unavailable("No case-wide observed product non-GET accounting signal was supplied."),
    persistenceViolation: args.persistenceViolation ?? unavailable("No case-wide persistence/restore accounting signal was supplied."),
  };
}

export function materializeBrowserDeterministicPassRuntimePrerequisites(
  context: BrowserDeterministicPassRuntimeContext
): BrowserDeterministicPassRuntimePrerequisites | null {
  const signals = Object.values(context);
  if (signals.some((signal) => signal.status !== "AVAILABLE")) return null;
  const available = signals as Array<{ status: "AVAILABLE"; value: unknown }>;
  return {
    fixtureStatus: available[0]!.value as BrowserDeterministicPassRuntimePrerequisites["fixtureStatus"],
    acceptedRoutePath: available[1]!.value as string,
    targetVerified: available[2]!.value as boolean,
    requiredExecutionCompleted: available[3]!.value as boolean,
    safetyViolation: available[4]!.value as boolean,
    testDataIssue: available[5]!.value as boolean,
    productNonGetCount: available[6]!.value as number,
    persistenceViolation: available[7]!.value as boolean,
  };
}
