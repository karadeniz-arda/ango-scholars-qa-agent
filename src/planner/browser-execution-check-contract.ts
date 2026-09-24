import type {
  BrowserExecutionCheckContract,
  BrowserExecutionCheckRequirement,
  BrowserTestCase,
} from "./types.js";
import type {
  BrowserSourceBoundAssertionSetRequirement,
} from "../agents/browser/browser-source-bound-assertion-set-proof.js";
import {
  hasApprovedCaseLevelSourceBoundAssertionAuthority,
} from "../agents/browser/browser-source-bound-assertion-set-proof.js";
import {
  dispatchBrowserDeterministicCapability,
} from "../agents/browser/browser-deterministic-capability-dispatch.js";
import type {
  BrowserSourceBoundStructuralControlPresenceRequirement,
} from "../agents/browser/browser-source-bound-structural-control-presence-proof.js";

function stableCheckId(parts: string[]): string {
  return `browser-execution-check:${parts
    .map((part) => `${part.length}:${part}`)
    .join("|")}`;
}

function executionCaseIdentity(testCase: BrowserTestCase): string {
  return testCase.runtimeFixtureResolutionContract
    ?.interactionExecutionCaseId ??
    testCase.executionSurfacePrerequisiteContract
      ?.executionContext.executionCaseId ??
    testCase.id;
}

/**
 * A materialized check contract is the only source-authorized assertion set
 * at the runtime boundary. This validates its transport shape without
 * deriving authority from planner steps, screenshots, or review output.
 */
export function hasValidBrowserExecutionCheckContract(args: {
  caseId: string;
  contract: BrowserExecutionCheckContract | undefined;
}): boolean {
  const contract = args.contract;
  if (
    !contract ||
    contract.schemaVersion !== 1 ||
    contract.caseId !== args.caseId ||
    contract.requiredChecks.length === 0
  ) return false;

  return contract.requiredChecks.every((check) => {
    if (
      check.authority !== "SOURCE_AUTHORIZED" ||
      !String(check.checkId || "").trim()
    ) return false;
    if (check.kind === "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE") {
      return Boolean(String(check.requirementId || "").trim() &&
        check.sourceUnitIds.length > 0 && check.sourceRefs.length > 0);
    }
    if (check.kind !== "SOURCE_BOUND_ASSERTION_MEMBER") return true;
    return Boolean(
      String(check.requirementId || "").trim() &&
      String(check.oracle?.oracleId || "").trim() &&
      String(check.oracle?.expectedText || "").trim() &&
      check.sourceUnitIds.length > 0 &&
      check.sourceRefs.length > 0
    );
  });
}

/**
 * Pure pre-execution derivation. It accepts only already typed,
 * source-authorized requirements and bindings; canonical assertions are
 * validated carriers rather than a separate source of authority.
 *
 * A duplicate stable ID makes the whole derivation unavailable. Callers must
 * not replace that failure with an inferred or partial contract.
 */
export function deriveBrowserExecutionCheckContract(args: {
  testCase: BrowserTestCase;
  assertionSourceCase?: BrowserTestCase;
  sourceBoundAssertionSetRequirements?: BrowserSourceBoundAssertionSetRequirement[];
  structuralControlPresenceRequirements?: BrowserSourceBoundStructuralControlPresenceRequirement[];
}): BrowserExecutionCheckContract | null {
  const executionObligationIds = [
    ...new Set(
      args.testCase.executionVerdictScope?.executionObligationIds ??
        args.testCase.acceptanceObligationIds ?? []
    ),
  ].sort();
  const executionObligationIdSet = new Set(executionObligationIds);
  const checks: BrowserExecutionCheckRequirement[] = [];
  const coveredObligationIds = new Set<string>();

  for (const requirement of args.sourceBoundAssertionSetRequirements ?? []) {
    if (
      requirement.executionCaseId !== args.testCase.id ||
      requirement.persona !== args.testCase.persona ||
      requirement.routePath !== args.testCase.startRoute ||
      !executionObligationIdSet.has(requirement.obligationId) ||
      !hasApprovedCaseLevelSourceBoundAssertionAuthority(requirement) ||
      requirement.sourceUnitIds.length === 0 ||
      requirement.sourceRefs.length === 0
    ) continue;
    for (const member of requirement.members) {
      checks.push({
        checkId: stableCheckId([
          "SOURCE_BOUND_ASSERTION_MEMBER",
          requirement.requirementId,
          member.oracleId,
        ]),
        kind: "SOURCE_BOUND_ASSERTION_MEMBER",
        authority: "SOURCE_AUTHORIZED",
        requirementId: requirement.requirementId,
        oracle: {
          oracleId: member.oracleId,
          action: member.action,
          expectedText: member.expectedText,
        },
        sourceUnitIds: [...new Set(requirement.sourceUnitIds)].sort(),
        sourceRefs: [...new Set(requirement.sourceRefs)].sort(),
      });
    }
    coveredObligationIds.add(requirement.obligationId);
  }

  for (const requirement of args.structuralControlPresenceRequirements ?? []) {
    if (
      requirement.executionCaseId !== args.testCase.id ||
      requirement.persona !== args.testCase.persona ||
      requirement.routePath !== args.testCase.startRoute ||
      !executionObligationIdSet.has(requirement.obligationId) ||
      !(
        requirement.sourceRole === "ACCEPTANCE" && requirement.proofAuthority === "ACCEPTANCE" ||
        requirement.sourceRole === "TASK" && requirement.proofAuthority === "DIRECT_TASK" && requirement.derivation === "DIRECT_TASK_SECTION"
      ) ||
      requirement.sourceUnitIds.length === 0 ||
      requirement.sourceRefs.length === 0
    ) continue;
    checks.push({
      checkId: stableCheckId(["SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE", requirement.requirementId]),
      kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE",
      authority: "SOURCE_AUTHORIZED",
      requirementId: requirement.requirementId,
      control: requirement.control,
      sourceUnitIds: [...new Set(requirement.sourceUnitIds)].sort(),
      sourceRefs: [...new Set(requirement.sourceRefs)].sort(),
    });
    coveredObligationIds.add(requirement.obligationId);
  }

  for (const obligationId of executionObligationIds) {
    const dispatch = dispatchBrowserDeterministicCapability({
      caseId: args.testCase.id,
      obligationId,
      acceptanceScope: args.testCase.acceptanceScope,
    });
    if (dispatch.status !== "MATCHED") continue;
    checks.push({
      checkId: dispatch.candidate.requirementId,
      kind: "LOCAL_STATE_TRANSITION",
      authority: "SOURCE_AUTHORIZED",
      requirementId: dispatch.candidate.requirementId,
    });
    coveredObligationIds.add(obligationId);
  }

  const expectedExecutionCaseId = executionCaseIdentity(args.testCase);
  for (const binding of args.testCase.deterministicProofBindings ?? []) {
    if (
      binding.authority !== "SOURCE_AUTHORIZED" ||
      binding.executionCaseId !== expectedExecutionCaseId ||
      binding.runtimePreconditions.persona !== args.testCase.persona ||
      binding.runtimePreconditions.route !== args.testCase.startRoute ||
      !executionObligationIdSet.has(binding.obligationId)
    ) continue;
    checks.push({
      checkId: stableCheckId([
        "EVIDENCE_CONTRACT_BINDING",
        binding.bindingId,
        binding.evidenceContractId,
      ]),
      kind: "EVIDENCE_CONTRACT_BINDING",
      authority: "SOURCE_AUTHORIZED",
      bindingId: binding.bindingId,
      evidenceContractId: binding.evidenceContractId,
    });
    coveredObligationIds.add(binding.obligationId);
  }

  const checkIds = checks.map((check) => check.checkId);
  if (new Set(checkIds).size !== checkIds.length) return null;

  /*
   * A non-empty contract may never silently prove only a subset of the
   * execution scope. An entirely unsupported scope remains explicitly empty
   * for diagnostics; a mixed scope fails closed before case verdicting.
   */
  if (
    checks.length > 0 &&
    executionObligationIds.some((obligationId) =>
      !coveredObligationIds.has(obligationId)
    )
  ) return null;

  return {
    schemaVersion: 1,
    caseId: args.testCase.id,
    executionObligationIds,
    requiredChecks: checks.sort((left, right) =>
      left.checkId.localeCompare(right.checkId)
    ),
    // Existing manualChecks are prose-only, so none are eligible here.
    requiredManualCheckIds: [],
  };
}
