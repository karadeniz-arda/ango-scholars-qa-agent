import type {
  RuntimeFixtureBinding,
} from "../../planner/types.js";

export type RuntimeInvoiceFixtureState =
  | "processed"
  | "sent-for-processing";

export type RuntimeInvoiceFixtureCandidateObservation = {
  identityRef: string;
  verifiedState: RuntimeInvoiceFixtureState;
};

export type BrowserRuntimeFixturePreparationFailureReason =
  | "MALFORMED_CONTRACT"
  | "PERSONA_MISMATCH"
  | "STATE_NOT_VERIFIED"
  | "NO_COMPATIBLE_CANDIDATE"
  | "AMBIGUOUS_COMPATIBLE_CANDIDATES"
  | "EXACT_IDENTITY_MISMATCH";

export type BrowserRuntimeFixturePreparationResult = {
  schemaVersion: 1;
  caseId: string;
  status: "RESOLVED" | "TEST_DATA_BLOCKED";
  candidateCount: number;
  selectedIdentity: string | null;
  requiredState: RuntimeInvoiceFixtureState | null;
  verifiedState: RuntimeInvoiceFixtureState | null;
  persona: "company_admin" | "talent" | null;
  resolver: "browser-visible-invoice-row";
  binding: RuntimeFixtureBinding | null;
  fixtureReadyForInteraction: boolean;
  failureClassification: "TEST_DATA_ISSUE" | null;
  failureReason:
    | BrowserRuntimeFixturePreparationFailureReason
    | null;
  preparedAt: string;
  evidenceRef: string | null;
  note: string;
};

export type EvaluateRuntimeInvoiceFixturePreparationArgs = {
  testCase: any;
  actualPersona: string | null | undefined;
  requiredState: RuntimeInvoiceFixtureState | null;
  stateVerified: boolean;
  candidates: RuntimeInvoiceFixtureCandidateObservation[];
  requestedIdentity?: string | null;
  preparedAt: string;
  evidenceRef: string;
};

function blockedResult(args: {
  caseId: string;
  candidateCount: number;
  requiredState: RuntimeInvoiceFixtureState | null;
  persona: "company_admin" | "talent" | null;
  preparedAt: string;
  reason: BrowserRuntimeFixturePreparationFailureReason;
  note: string;
}): BrowserRuntimeFixturePreparationResult {
  return {
    schemaVersion: 1,
    caseId: args.caseId,
    status: "TEST_DATA_BLOCKED",
    candidateCount: args.candidateCount,
    selectedIdentity: null,
    requiredState: args.requiredState,
    verifiedState: null,
    persona: args.persona,
    resolver: "browser-visible-invoice-row",
    binding: null,
    fixtureReadyForInteraction: false,
    failureClassification: "TEST_DATA_ISSUE",
    failureReason: args.reason,
    preparedAt: args.preparedAt,
    evidenceRef: null,
    note: args.note,
  };
}

function normalizedIdentity(
  value: unknown
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function evaluateRuntimeInvoiceFixturePreparation(
  args: EvaluateRuntimeInvoiceFixturePreparationArgs
): BrowserRuntimeFixturePreparationResult {
  const caseId = String(
    args.testCase?.id || ""
  ).trim();
  const actualPersona =
    args.actualPersona === "company_admin" ||
    args.actualPersona === "talent"
      ? args.actualPersona
      : null;
  const contract =
    args.testCase?.runtimeFixtureResolutionContract;
  const members = Array.isArray(contract?.members)
    ? contract.members
    : [];
  const executionCaseId = String(
    contract?.interactionExecutionCaseId || ""
  ).trim();
  const member = members.find(
    (item: any) =>
      String(item?.executionCaseId || "").trim() ===
      executionCaseId
  );
  const capability =
    member?.fixtureResolutionCapability;
  const constraint =
    member?.acceptanceFixtureConstraint;
  const plannedPersona = String(
    args.testCase?.persona || ""
  ).trim();
  const contractValid =
    Boolean(caseId) &&
    contract?.status ===
      "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" &&
    contract?.policy === "ALL_REQUIRED" &&
    contract?.fixtureReadyForInteraction === false &&
    members.length === 1 &&
    member?.required === true &&
    member?.runtimeFixtureBinding ===
      "NOT_YET_RESOLVED" &&
    constraint?.authority === "SOURCE_AUTHORIZED" &&
    constraint?.fixtureKind === "invoice" &&
    constraint?.semantic?.kind === "STATE" &&
    capability?.fixtureKind === "invoice" &&
    capability?.resolverRef ===
      "browser-visible-invoice-row" &&
    capability?.classification ===
      "READ_ONLY_DISCOVERY" &&
    capability?.selectionPolicy ===
      "UNIQUE_COMPATIBLE_ONLY" &&
    capability?.ambiguityPolicy ===
      "BLOCK_TEST_DATA_ISSUE" &&
    capability?.identityPolicy ===
      constraint?.identityPolicy &&
    capability?.supportedState ===
      constraint?.semantic?.state &&
    capability?.supportedState ===
      args.requiredState &&
    args.testCase?.runtimeFixturePolicy ===
      constraint?.identityPolicy;

  if (!contractValid) {
    return blockedResult({
      caseId,
      candidateCount: args.candidates.length,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason: "MALFORMED_CONTRACT",
      note:
        "blocked: runtime fixture resolution metadata is incomplete, inconsistent, or lacks source-authorized acceptance authority; no runtime binding was produced",
    });
  }

  if (
    !actualPersona ||
    plannedPersona !== actualPersona ||
    capability?.persona !== actualPersona
  ) {
    return blockedResult({
      caseId,
      candidateCount: args.candidates.length,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason: "PERSONA_MISMATCH",
      note:
        "blocked: runtime fixture capability persona does not match the active execution persona; no runtime binding was produced",
    });
  }

  if (!args.stateVerified) {
    return blockedResult({
      caseId,
      candidateCount: args.candidates.length,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason: "STATE_NOT_VERIFIED",
      note:
        `blocked: required invoice state ${
          args.requiredState || "unknown"
        } was not deterministically verified; no runtime binding was produced`,
    });
  }

  const compatibleCandidates =
    args.candidates.filter(
      (candidate) =>
        candidate.verifiedState ===
        args.requiredState
    );

  if (compatibleCandidates.length === 0) {
    return blockedResult({
      caseId,
      candidateCount: 0,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason: "NO_COMPATIBLE_CANDIDATE",
      note:
        "blocked: no compatible runtime invoice candidate is visible; no runtime binding was produced",
    });
  }

  if (compatibleCandidates.length > 1) {
    return blockedResult({
      caseId,
      candidateCount:
        compatibleCandidates.length,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason:
        "AMBIGUOUS_COMPATIBLE_CANDIDATES",
      note:
        `blocked: ${compatibleCandidates.length} equally compatible runtime invoice candidates are visible; unique-compatible selection is required and no runtime binding was produced`,
    });
  }

  const selected = compatibleCandidates[0]!;
  const requestedIdentity =
    String(args.requestedIdentity || "").trim();

  if (
    constraint?.identityPolicy === "exact" &&
    (
      !requestedIdentity ||
      normalizedIdentity(selected.identityRef) !==
        normalizedIdentity(requestedIdentity)
    )
  ) {
    return blockedResult({
      caseId,
      candidateCount: 1,
      requiredState: args.requiredState,
      persona: actualPersona,
      preparedAt: args.preparedAt,
      reason: "EXACT_IDENTITY_MISMATCH",
      note:
        "blocked: the unique compatible runtime invoice does not match the exact required identity; no substitution or runtime binding was produced",
    });
  }

  const binding: RuntimeFixtureBinding = {
    status: "RESOLVED",
    executionCaseId,
    fixtureKind: "invoice",
    fixtureIdentityRef:
      selected.identityRef,
    verifiedState:
      selected.verifiedState,
    ownerPersonaRef: "company_admin",
    identityPolicy:
      constraint.identityPolicy,
    selectionPolicy:
      "UNIQUE_COMPATIBLE_ONLY",
    resolverProvenance: {
      resolverRef:
        "browser-visible-invoice-row",
      evidenceRef: args.evidenceRef,
    },
    verifiedAt: args.preparedAt,
  };

  return {
    schemaVersion: 1,
    caseId,
    status: "RESOLVED",
    candidateCount: 1,
    selectedIdentity:
      selected.identityRef,
    requiredState: args.requiredState,
    verifiedState:
      selected.verifiedState,
    persona: actualPersona,
    resolver:
      "browser-visible-invoice-row",
    binding,
    fixtureReadyForInteraction: true,
    failureClassification: null,
    failureReason: null,
    preparedAt: args.preparedAt,
    evidenceRef: args.evidenceRef,
    note:
      `runtime invoice fixture prepared: ` +
      `selected=${selected.identityRef}; ` +
      `verifiedState=${selected.verifiedState}; ` +
      `persona=${actualPersona}; ` +
      `selection=UNIQUE_COMPATIBLE_ONLY`,
  };
}

export function runtimeFixturePreparationAllowsInteraction(
  result:
    BrowserRuntimeFixturePreparationResult | null | undefined
): boolean {
  return Boolean(
    result?.status === "RESOLVED" &&
    result.fixtureReadyForInteraction === true &&
    result.binding?.status === "RESOLVED" &&
    result.binding.fixtureIdentityRef ===
      result.selectedIdentity &&
    result.binding.verifiedState ===
      result.verifiedState
  );
}

export function requiresRuntimeInvoiceFixturePreparation(
  testCase: any
): boolean {
  return (
    testCase?.runtimeFixtureResolutionContract?.status ===
    "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
  );
}
