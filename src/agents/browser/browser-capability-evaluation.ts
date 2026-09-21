export type BrowserOperationalCapabilityStatus =
  | "EXECUTED_VERIFIED"
  | "ABSTAINED";

/** Descriptive metadata only; it carries no proof or verdict authority. */
export type BrowserOperationalCapabilityProofDisposition =
  | {
      attempted: false;
      withheldReason: string;
    }
  | {
      attempted: true;
      attemptSummary: string;
    };

type BrowserOperationalCapabilityEvaluationBase<
  TCapabilityKind extends string,
> = {
  capabilityKind: TCapabilityKind;
  attempted: boolean;
  executed: boolean;
  verifiedStateChange: boolean;
  settled: boolean;
  restorationRequired: boolean;
  restored: boolean;
  transportSafe: boolean;
  surfaceIdentity?: string;
  acceptanceProof: BrowserOperationalCapabilityProofDisposition;
};

export type BrowserOperationalCapabilityEvaluation<
  TCapabilityKind extends string = string,
  TReason extends string = string,
> = BrowserOperationalCapabilityEvaluationBase<TCapabilityKind> &
  (
    | {
        status: "EXECUTED_VERIFIED";
        abstentionReason?: never;
      }
    | {
        status: "ABSTAINED";
        abstentionReason: TReason;
      }
  );

export type BrowserOperationalCapabilityTelemetry<
  TCapabilityKind extends string = string,
  TReason extends string = string,
> = {
  capabilityAttemptCount: number;
  capabilityExecutionCount: number;
  verifiedStateChangeCount: number;
  capabilityReuseAcrossDistinctSurfaces: number;
  surfaces: Array<{
    capabilityKind: TCapabilityKind;
    surfaceIdentity: string;
    status: BrowserOperationalCapabilityStatus;
    attempted: boolean;
    executed: boolean;
    verifiedStateChange: boolean;
    settled: boolean;
    restorationRequired: boolean;
    restored: boolean;
    restorationSatisfied: boolean;
    transportSafe: boolean;
    abstentionReason?: TReason;
    acceptanceProof: BrowserOperationalCapabilityProofDisposition;
  }>;
};

/**
 * Pure operational maturity aggregation. This function cannot create browser
 * evidence, obligation discharge, proof readiness, PASS, or FAIL.
 */
export function summarizeBrowserOperationalCapabilities<
  TCapabilityKind extends string,
  TReason extends string,
>(
  evaluations: readonly BrowserOperationalCapabilityEvaluation<
    TCapabilityKind,
    TReason
  >[]
): BrowserOperationalCapabilityTelemetry<TCapabilityKind, TReason> {
  const verifiedSurfaceIdentities = new Set<string>();
  const surfaces = evaluations.map((evaluation) => {
    if (
      evaluation.status === "EXECUTED_VERIFIED" &&
      evaluation.surfaceIdentity
    ) {
      verifiedSurfaceIdentities.add(evaluation.surfaceIdentity);
    }

    return {
      capabilityKind: evaluation.capabilityKind,
      surfaceIdentity:
        evaluation.surfaceIdentity ?? "UNRESOLVED_SURFACE",
      status: evaluation.status,
      attempted: evaluation.attempted,
      executed: evaluation.executed,
      verifiedStateChange: evaluation.verifiedStateChange,
      settled: evaluation.settled,
      restorationRequired: evaluation.restorationRequired,
      restored: evaluation.restored,
      restorationSatisfied:
        !evaluation.restorationRequired || evaluation.restored,
      transportSafe: evaluation.transportSafe,
      ...(evaluation.status === "ABSTAINED"
        ? { abstentionReason: evaluation.abstentionReason }
        : {}),
      acceptanceProof: { ...evaluation.acceptanceProof },
    };
  });

  return {
    capabilityAttemptCount: evaluations.filter(
      (evaluation) => evaluation.attempted
    ).length,
    capabilityExecutionCount: evaluations.filter(
      (evaluation) => evaluation.status === "EXECUTED_VERIFIED"
    ).length,
    verifiedStateChangeCount: evaluations.filter(
      (evaluation) =>
        evaluation.status === "EXECUTED_VERIFIED" &&
        evaluation.verifiedStateChange
    ).length,
    capabilityReuseAcrossDistinctSurfaces:
      verifiedSurfaceIdentities.size,
    surfaces,
  };
}
