import type {
  BrowserTraceStatus,
} from "./browser-execution-types.js";
import {
  isUrlTransitionRequirementSatisfied,
} from "./browser-url-transition-satisfaction.js";
import {
  isSelectedStateRequirementSatisfied,
} from "./browser-selected-state-satisfaction.js";
import {
  summarizeBrowserOrderingEvidenceParity,
  type BrowserOrderingEvidenceParity,
} from "./browser-ordering-evidence.js";
import {
  revalidateTrustedDeterministicRawPass,
} from "./browser-deterministic-pass-policy.js";

export function auditBrowserOrderingEvidenceParity(args: {
  testCase: any;
  currentResult: any;
}): BrowserOrderingEvidenceParity | null {
  const requirements = Array.isArray(
    args.testCase?.acceptanceScope
      ?.orderingRequirements
  )
    ? args.testCase.acceptanceScope
        .orderingRequirements
    : [];

  if (requirements.length === 0) {
    return null;
  }

  return summarizeBrowserOrderingEvidenceParity({
    requirements,
    evidence: Array.isArray(
      args.currentResult?.orderingEvidence
    )
      ? args.currentResult.orderingEvidence
      : [],
  });
}


function normalizeAcceptanceCoverageText(
  value: unknown
): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isStructuralEntityRequirement(
  value: unknown
): boolean {
  const text =
    normalizeAcceptanceCoverageText(
      value
    );

  const structuredEntityPattern =
    /\b(?:fields?|controls?|selectors?|dropdowns?|comboboxes?|inputs?|skills?|entities?)\b/;

  return (
    (
      /\b(?:separate|distinct|individual|independent)\b/.test(
        text
      ) &&
      structuredEntityPattern.test(
        text
      )
    ) ||
    /\b(?:two|three|four|five|six|seven|eight|nine|ten|multiple|several|\d+)\b.{0,80}\b(?:fields?|controls?|selectors?|dropdowns?|comboboxes?|inputs?|skills?|entities?)\b/.test(
      text
    )
  );
}

function hasCompleteExactObligationDischarge(
  testCase: any,
  currentResult: any
): boolean {
  const allocatedIds = [
    ...new Set<string>(
      Array.isArray(
        testCase?.acceptanceObligationIds
      )
        ? testCase.acceptanceObligationIds
            .map((id: unknown) =>
              String(id ?? "").trim()
            )
            .filter(Boolean)
        : []
    ),
  ];
  const provedIds = new Set<string>(
    (Array.isArray(
      currentResult
        ?.deterministicObligationDischarges
    )
      ? currentResult
          .deterministicObligationDischarges
      : [])
      .filter(
        (discharge: any) =>
          discharge?.kind ===
            "DETERMINISTIC_OBLIGATION_PROVED" &&
          discharge?.evidenceResult ===
            "CONFIRMED"
      )
      .map((discharge: any) =>
        String(
          discharge?.obligationId ?? ""
        ).trim()
      )
      .filter(Boolean)
  );

  return (
    currentResult?.caseProofReadiness
      ?.status === "CASE_PROOF_READY" &&
    allocatedIds.length > 0 &&
    allocatedIds.every((id) =>
      provedIds.has(id)
    )
  );
}

/*
 * PASS_TRUST_MANUAL_ACCEPTANCE_COMPLETENESS_V1
 *
 * manualChecks are unresolved acceptance criteria.
 * Passing the automated subset is therefore not sufficient
 * for a whole-case PASS while any non-empty manual
 * acceptance coverage remains.
 *
 * This is a proof-completeness rule only. It does not turn
 * a manual check into an automated behavior claim.
 */
export function getRemainingBrowserManualAcceptanceChecks(
  testCase: any,
  currentResult?: any
): string[] {
  const manualChecks: string[] =
    Array.isArray(testCase?.manualChecks)
      ? testCase.manualChecks
          .map((check: unknown) =>
            String(check ?? "")
              .replace(/\s+/g, " ")
              .trim()
          )
          .filter(Boolean)
      : [];

  /*
   * Stable obligation identity outranks raw model prose. This field is set
   * only after every obligation allocated to the case has an exact positive
   * deterministic discharge; it never comes from text matching.
   */
  if (
    hasCompleteExactObligationDischarge(
      testCase,
      currentResult
    )
  ) {
    return [];
  }

  const deterministicallyCoveredChecks = new Set(
    (Array.isArray(currentResult?.collectionFilterEvidence)
      ? currentResult.collectionFilterEvidence
      : [])
      .filter((evidence: any) =>
        evidence?.kind === "COLLECTION_FILTER" &&
        evidence?.status === "CONFIRMED" &&
        evidence?.proofReady === true
      )
      .flatMap((evidence: any) =>
        Array.isArray(evidence?.coveredManualChecks)
          ? evidence.coveredManualChecks
          : []
      )
      .map(normalizeAcceptanceCoverageText)
  );
  return manualChecks.filter(
    (check) =>
      !deterministicallyCoveredChecks.has(
        normalizeAcceptanceCoverageText(check)
      )
  );
}

export function getBrowserManualAcceptanceCoverageGapReason(
  testCase: any,
  currentResult?: any
): string | null {
  const remainingManualChecks =
    getRemainingBrowserManualAcceptanceChecks(
      testCase,
      currentResult
    );

  if (remainingManualChecks.length === 0) {
    return null;
  }

  return (
    "manual required: " +
    `${remainingManualChecks.length} acceptance ` +
    `${
      remainingManualChecks.length === 1
        ? "check remains"
        : "checks remain"
    } outside automated proof; whole-case PASS ` +
    "requires complete acceptance coverage"
  );
}

export function getBrowserAcceptanceCoverageGapReason(args: {
  testCase: any;
  currentResult: any;
}): string | null {
  const manualAcceptanceCoverageGapReason =
    getBrowserManualAcceptanceCoverageGapReason(
      args.testCase,
      args.currentResult
    );

  if (manualAcceptanceCoverageGapReason) {
    return manualAcceptanceCoverageGapReason;
  }

  const caseProofReadiness =
    args.currentResult
      ?.caseProofReadiness;

  if (
    caseProofReadiness?.status ===
      "CASE_PROOF_NOT_READY"
  ) {
    const remaining = Array.isArray(
      caseProofReadiness
        .remainingObligationIds
    )
      ? caseProofReadiness
          .remainingObligationIds
      : [];

    return (
      "manual required: " +
      `${remaining.length} allocated authoritative ` +
      `obligation${remaining.length === 1 ? "" : "s"} ` +
      "remain without exact deterministic discharge"
    );
  }

  const acceptanceText =
    normalizeAcceptanceCoverageText(
      [
        args.testCase?.goal,
        args.testCase?.successCriteria,
        ...(Array.isArray(
          args.testCase?.acceptanceScope
            ?.behaviorClaims
        )
          ? args.testCase.acceptanceScope
              .behaviorClaims
          : []),
      ]
        .filter(Boolean)
        .join(" ")
    );

  const deterministicEvidence =
    Array.isArray(
      args.currentResult?.deterministicEvidence
    )
      ? args.currentResult.deterministicEvidence
      : [];

  const executionText =
    normalizeAcceptanceCoverageText(
      [
        JSON.stringify(
          args.testCase?.automatedChecks ?? []
        ),
        JSON.stringify(
          args.testCase?.steps ?? []
        ),
        JSON.stringify(
          args.currentResult?.trace ?? []
        ),
      ].join(" ")
    );

  /*
   * LINK_NAVIGATION_FALSE_PASS_GUARD_V1
   *
   * Seeing a document/link label does not prove that
   * the link was activated or that its target opened.
   */
  const requiresLinkNavigation =
    /\b(?:links?|href|clickable)\b/.test(
      acceptanceText
    ) &&
    /\b(?:activate|activates|activated|navigate|navigates|navigated|navigation|destinations?|target|open|opens|opened)\b/.test(
      acceptanceText
    );

  if (requiresLinkNavigation) {
    const hasLinkInteraction =
      /\b(?:clicked|opened|activated)\b/.test(
        executionText
      );

    const hasUrlOracle =
      deterministicEvidence.some(
        (evidence: any) =>
          evidence?.passed === true &&
          (
            evidence?.action ===
              "assertUrlContains" ||
            evidence?.action ===
              "assertUrlNotContains"
          )
      );

    if (
      !hasLinkInteraction ||
      !hasUrlOracle
    ) {
      return (
        "manual required: the acceptance goal " +
        "requires a link interaction and resulting " +
        "navigation, but the automated execution " +
        "did not prove both"
      );
    }
  }

  /*
   * ORDERING_FALSE_PASS_GUARD_V1
   *
   * Showing sort choices proves the controls exist.
   * It does not prove that the resulting records are
   * actually ordered correctly.
   */
  const requiresOrderingBehavior =
    /\b(?:sort|sorting|order|ordering)\b/.test(
      acceptanceText
    ) &&
    /\b(?:apply|applies|correct|date-based|ascending|descending)\b/.test(
      acceptanceText
    );

  if (requiresOrderingBehavior) {
    const hasOrderingOracle =
      deterministicEvidence.some(
        (evidence: any) =>
          evidence?.passed === true &&
          /(?:sort|order)/i.test(
            String(evidence?.action || "")
          )
      );

    if (!hasOrderingOracle) {
      return (
        "manual required: the acceptance goal " +
        "requires correct ordering behavior, but " +
        "the automated execution did not verify " +
        "the resulting record order"
      );
    }
  }

  /*
   * OPTIONAL_EMPTY_STATE_FLOW_FALSE_PASS_GUARD_V1
   *
   * Seeing a wizard label does not prove that an
   * optional empty state permits the remaining flow
   * to continue. The current deterministic primitives
   * do not establish that end-to-end outcome.
   */
  const requiresOptionalEmptyStateFlow =
    /\b(?:zero|none|no|without)\b/.test(
      acceptanceText
    ) &&
    /\b(?:flow|wizard|process)\b/.test(
      acceptanceText
    ) &&
    /\b(?:continue|continues|continued|continuing|work|works|working|prevent|prevents|prevented|preventing|block|blocks|blocked|blocking)\b/.test(
      acceptanceText
    );

  if (requiresOptionalEmptyStateFlow) {
    return (
      "manual required: the acceptance goal " +
      "requires an optional empty state to preserve " +
      "the remaining flow, but the automated " +
      "execution did not prove that end-to-end outcome"
    );
  }

  const structuralBehaviorClaims =
    Array.isArray(
      args.testCase?.acceptanceScope
        ?.behaviorClaims
    )
      ? args.testCase.acceptanceScope
          .behaviorClaims
          .filter(
            (claim: unknown) =>
              isStructuralEntityRequirement(
                claim
              )
          )
      : [];

  if (structuralBehaviorClaims.length > 0) {
    return (
      "manual required: the acceptance goal " +
      "requires separate structured UI entities, " +
      "but plain visible-text evidence does not " +
      "prove their roles, associations, or distinctness"
    );
  }

  return null;
}

export function reconcileBrowserResultFromEvidence(args: {
  currentResult: any;
  testCase: any;
  review: any;
  source: "screenshot" | "video";
}): void {
  const {
    currentResult,
    testCase,
    review,
    source,
  } = args;

  const orderingEvidenceParity =
    auditBrowserOrderingEvidenceParity({
      testCase,
      currentResult,
    });

  if (orderingEvidenceParity) {
    /* Observational parity only; V0 never changes status or reason. */
    currentResult.orderingEvidenceParity =
      orderingEvidenceParity;
  }

  /*
   * PHASE1_CANONICAL_CASE_VERDICT_V1
   *
   * Review remains useful corroboration/diagnostic material, but a completed
   * typed case verdict is the sole authority for the case result. In
   * particular, visual review may not promote a partial case or downgrade a
   * complete deterministic case. The legacy reconciliation below remains for
   * results produced before case verdict materialization.
   */
  if (currentResult?.caseVerdict) {
    currentResult.status = currentResult.caseVerdict.verdict;
    currentResult.reasonCategory = currentResult.caseVerdict.reason;
    currentResult.evidenceReconciliationAudit = [
      ...(Array.isArray(currentResult.evidenceReconciliationAudit)
        ? currentResult.evidenceReconciliationAudit
        : []),
      {
        source,
        decision: "CASE_VERDICT_CANONICAL",
        reviewVerdict: String(review?.verdict || ""),
        canonicalVerdict: currentResult.caseVerdict.verdict,
      },
    ];
    return;
  }

  const previousStatus =
    String(
      currentResult?.status || ""
    ) as BrowserTraceStatus;

  const verdict = String(
    review?.verdict || ""
  );

  const deterministicEvidence =
    Array.isArray(
      currentResult?.deterministicEvidence
    )
      ? currentResult.deterministicEvidence
      : [];

  const failedDeterministicAssertions =
    deterministicEvidence.filter(
      (evidence: any) =>
        evidence?.passed === false &&
        /^assert/.test(
          String(
            evidence?.action || ""
          )
        )
    );

  const failedDeterministicActions =
    failedDeterministicAssertions.map(
      (evidence: any) =>
        String(
          evidence?.action || "unknown"
        )
    );

  const hasFailedDeterministicUrlAssertion =
    failedDeterministicAssertions.some(
      (evidence: any) =>
        evidence?.action ===
          "assertUrlContains" ||
        evidence?.action ===
          "assertUrlNotContains"
    );

  const hasFailedDeterministicUiAssertion =
    failedDeterministicAssertions.some(
      (evidence: any) =>
        evidence?.action ===
          "assertTextVisible" ||
        evidence?.action ===
          "assertTextNotVisible"
    );
  const hasFailedDeterministicCollectionFilter =
    failedDeterministicAssertions.some(
      (evidence: any) =>
        evidence?.action ===
          "assertCollectionFilter"
    );


  const confidence = String(
    review?.confidence || ""
  )
    .trim()
    .toLowerCase();

  const testCaseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
    JSON.stringify(
      testCase?.steps || []
    ),
  ]
    .join(" ")
    .toLowerCase();

  /*
   * These cases depend on a runtime state that the
   * screenshot itself cannot prove was provisioned.
   *
   * A visually clear mismatch is not enough to call
   * PRODUCT_BUG when the expected fixture/oracle was
   * never verified.
   */
  const hasUnverifiedOracleDependency = [
    "seeded",
    "pre-seeded",
    "preseeded",
    "fixture",
    "specific permission",
    "permission fixture",
    "pending publish request",
    "existing publish request",
    "canpublishjob",
    "canrequestjobchange",
  ].some(
    (phrase) =>
      testCaseText.includes(phrase)
  );

  const hasSuccessfulInteractionCheckpoint =
    Array.isArray(
      currentResult?.trace
    ) &&
    currentResult.trace.some(
      (step: any) =>
        step?.action ===
          "evidence-checkpoint" &&
        step?.status === "PASS"
    );

  const hasUnresolvedExecutionStep =
    Array.isArray(
      currentResult?.trace
    ) &&
    currentResult.trace.some(
      (step: any) =>
        step?.action ===
          "browser-step" &&
        [
          "BLOCKED",
          "MANUAL_REQUIRED",
          "ERROR",
        ].includes(
          String(step?.status || "")
        )
    );

  /*
   * URL assertions are independently observable.
   *
   * UI visibility assertions additionally require a
   * successful interaction checkpoint proving that a
   * concrete nested UI state was reached.
   */
  const hasRetainableDeterministicFailure =
    previousStatus === "FAIL" &&
    !hasUnresolvedExecutionStep &&
    (
      hasFailedDeterministicUrlAssertion ||
      hasFailedDeterministicCollectionFilter ||
      (
        hasFailedDeterministicUiAssertion &&
        hasSuccessfulInteractionCheckpoint
      )
    );

  const recordReconciliationAudit = (
decision:
  | "RETAIN_DETERMINISTIC_FAIL"
  | "RETAIN_DETERMINISTIC_PASS"
  | "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE"
  | "DETERMINISTIC_OBLIGATION_PROOF_PARITY"
  | "BEHAVIOR_PROOF_REQUIREMENT_PRESENT"
  | "URL_TRANSITION_PROOF_PARITY"
  | "SELECTED_STATE_PROOF_PARITY"
  | "STATUS_CHANGED",
    finalStatus: BrowserTraceStatus,
    reasonCategory?: string,
    details?: Record<string, unknown>
  ): void => {
    const previousAudit =
      Array.isArray(
        currentResult?.reconciliationAudit
      )
        ? currentResult.reconciliationAudit
        : [];

    currentResult.reconciliationAudit = [
      ...previousAudit,
            {
        source,
        verdict,
        confidence,
        rawStatus: previousStatus,
        finalStatus,
        decision,
        reasonCategory:
          reasonCategory || null,
        failedDeterministicActions,
        interactionCheckpointReached:
          hasSuccessfulInteractionCheckpoint,
        unresolvedExecutionStep:
          hasUnresolvedExecutionStep,
        ...(details ?? {}),
      },
    ];

    const behaviorProofAuditSuffix =
      decision ===
      "BEHAVIOR_PROOF_REQUIREMENT_PRESENT"
        ? (
            `, behaviorClaims=${JSON.stringify(
              details?.["behaviorClaims"] ?? []
            )}` +
            `, legacyAcceptanceCoverageGapDetected=${
              details?.[
                "legacyAcceptanceCoverageGapDetected"
              ] === true
            }`
          )
        : "";

        const urlTransitionProofParitySuffix =
  decision ===
  "URL_TRANSITION_PROOF_PARITY"
    ? (
        `, urlTransitionRequirementCount=${String(
          details?.[
            "urlTransitionRequirementCount"
          ] ?? 0
        )}` +
        `, urlTransitionSatisfiedCount=${String(
          details?.[
            "urlTransitionSatisfiedCount"
          ] ?? 0
        )}` +
        `, urlTransitionUnsatisfiedCount=${String(
          details?.[
            "urlTransitionUnsatisfiedCount"
          ] ?? 0
        )}` +
        `, urlTransitionAllSatisfied=${
          details?.[
            "urlTransitionAllSatisfied"
          ] === true
        }` +
        `, legacyAcceptanceCoverageGapDetected=${
          details?.[
            "legacyAcceptanceCoverageGapDetected"
          ] === true
        }`
      )
    : "";

    const selectedStateProofParitySuffix =
      decision ===
      "SELECTED_STATE_PROOF_PARITY"
        ? (
            `, selectedStateRequirementCount=${String(
              details?.[
                "selectedStateRequirementCount"
              ] ?? 0
            )}` +
            `, selectedStateSatisfiedCount=${String(
              details?.[
                "selectedStateSatisfiedCount"
              ] ?? 0
            )}` +
            `, selectedStateUnsatisfiedCount=${String(
              details?.[
                "selectedStateUnsatisfiedCount"
              ] ?? 0
            )}` +
            `, selectedStateAllSatisfied=${
              details?.[
                "selectedStateAllSatisfied"
              ] === true
            }`
          )
        : "";

    console.log(
      `Evidence reconciliation audit: ` +
        `raw=${previousStatus}, ` +
        `final=${finalStatus}, ` +
        `decision=${decision}, ` +
        `caseId=${String(
          testCase?.id ?? "unknown"
        )}, ` +
        `source=${source}, ` +
        `verdict=${verdict}, ` +
        `failedActions=${
          failedDeterministicActions.length > 0
            ? failedDeterministicActions.join(",")
            : "none"
        }` +
behaviorProofAuditSuffix +
urlTransitionProofParitySuffix +
selectedStateProofParitySuffix
    );
  };

  const acceptanceScope =
    testCase?.acceptanceScope;

  if (
    currentResult?.caseProofReadiness
  ) {
    recordReconciliationAudit(
      "DETERMINISTIC_OBLIGATION_PROOF_PARITY",
      previousStatus,
      "DETERMINISTIC_OBLIGATION_PROOF_PARITY",
      {
        caseProofReadiness:
          currentResult
            .caseProofReadiness.status,
        allocatedObligationIds:
          currentResult
            .caseProofReadiness
            .allocatedObligationIds ?? [],
        provedObligationIds:
          currentResult
            .caseProofReadiness
            .provedObligationIds ?? [],
        remainingObligationIds:
          currentResult
            .caseProofReadiness
            .remainingObligationIds ?? [],
      }
    );
  }

  let hasExplicitSelectedStateRequirements =
    false;
  let selectedStateRequirementsSatisfied =
    true;

  const hasDeclaredSelectedStateRequirement =
    Array.isArray(
      acceptanceScope
        ?.selectedStateRequirements
    ) &&
    acceptanceScope
      .selectedStateRequirements
      .some(
        (requirement: any) =>
          requirement?.kind ===
          "SELECTED_STATE"
      );

  if (
    acceptanceScope
      ?.requiresBehaviorProof === true ||
    hasDeclaredSelectedStateRequirement
  ) {
    const behaviorClaims =
      Array.isArray(
        acceptanceScope?.behaviorClaims
      )
        ? acceptanceScope.behaviorClaims
            .map((claim: unknown) =>
              String(claim ?? "")
                .replace(/\s+/g, " ")
                .trim()
            )
            .filter(Boolean)
        : [];

    /*
     * PHASE_2_BEHAVIOR_PROOF_AUDIT_V1
     *
     * Acceptance scope describes a requirement,
     * not proof and not a verdict.
     *
     * Keep the legacy acceptance-coverage guard
     * independent for now. We only record whether
     * both mechanisms currently agree that a
     * coverage gap exists.
     */
    const legacyAcceptanceCoverageGapReason =
      getBrowserAcceptanceCoverageGapReason({
        testCase,
        currentResult,
      });

    recordReconciliationAudit(
      "BEHAVIOR_PROOF_REQUIREMENT_PRESENT",
      previousStatus,
      "BEHAVIOR_PROOF_REQUIREMENT_PRESENT",
      {
        behaviorClaims,
        legacyAcceptanceCoverageGapDetected:
          Boolean(
            legacyAcceptanceCoverageGapReason
          ),
        legacyAcceptanceCoverageGapReason:
          legacyAcceptanceCoverageGapReason ??
          null,
      }

    );
    const urlTransitionRequirements =
  Array.isArray(
    acceptanceScope
      ?.urlTransitionRequirements
  )
    ? acceptanceScope
        .urlTransitionRequirements
        .filter(
          (requirement: any) =>
            requirement?.kind ===
            "URL_TRANSITION"
        )
    : [];

if (
  urlTransitionRequirements.length >
  0
) {
  const interactionExecutionEvidence =
    Array.isArray(
      currentResult
        ?.interactionExecutionEvidence
    )
      ? currentResult
          .interactionExecutionEvidence
      : [];

  const structuredDeterministicEvidence =
    Array.isArray(
      currentResult
        ?.deterministicEvidence
    )
      ? currentResult
          .deterministicEvidence
      : [];

  const satisfactionResults =
    urlTransitionRequirements.map(
      (requirement: any) => ({
        requirement,
        satisfied:
          isUrlTransitionRequirementSatisfied({
            requirement,
            interactionExecutionEvidence,
            deterministicEvidence:
              structuredDeterministicEvidence,
          }),
      })
    );

  const satisfiedCount =
    satisfactionResults.filter(
      (result: any) =>
        result.satisfied === true
    ).length;

  const unsatisfiedCount =
    satisfactionResults.length -
    satisfiedCount;

  recordReconciliationAudit(
    "URL_TRANSITION_PROOF_PARITY",
    previousStatus,
    "URL_TRANSITION_PROOF_PARITY",
    {
      urlTransitionRequirementCount:
        satisfactionResults.length,

      urlTransitionSatisfiedCount:
        satisfiedCount,

      urlTransitionUnsatisfiedCount:
        unsatisfiedCount,

      urlTransitionAllSatisfied:
        unsatisfiedCount === 0,

      legacyAcceptanceCoverageGapDetected:
        Boolean(
          legacyAcceptanceCoverageGapReason
        ),

      legacyAcceptanceCoverageGapReason:
        legacyAcceptanceCoverageGapReason ??
        null,
    }
  );
}

const selectedStateRequirements =
  Array.isArray(
    acceptanceScope
      ?.selectedStateRequirements
  )
    ? acceptanceScope
        .selectedStateRequirements
        .filter(
          (requirement: any) =>
            requirement?.kind ===
            "SELECTED_STATE"
        )
    : [];

if (
  selectedStateRequirements.length >
  0
) {
  hasExplicitSelectedStateRequirements =
    true;
  const interactionExecutionEvidence =
    Array.isArray(
      currentResult
        ?.interactionExecutionEvidence
    )
      ? currentResult
          .interactionExecutionEvidence
      : [];

  const structuredDeterministicEvidence =
    Array.isArray(
      currentResult
        ?.deterministicEvidence
    )
      ? currentResult
          .deterministicEvidence
      : [];

  const satisfactionResults =
    selectedStateRequirements.map(
      (requirement: any) => ({
        requirement,
        satisfied:
          isSelectedStateRequirementSatisfied({
            requirement,
            interactionExecutionEvidence,
            deterministicEvidence:
              structuredDeterministicEvidence,
          }),
      })
    );

  const satisfiedCount =
    satisfactionResults.filter(
      (result: any) =>
        result.satisfied === true
    ).length;

  const unsatisfiedCount =
    satisfactionResults.length -
    satisfiedCount;

  selectedStateRequirementsSatisfied =
    unsatisfiedCount === 0;

  /*
   * SELECTED_STATE_PROOF_PARITY_V1
   *
   * The current pipeline has no single legacy
   * selected-state coverage boolean. Record only
   * structured observations rather than inventing
   * a comparator. This audit is verdict-neutral.
   */
  recordReconciliationAudit(
    "SELECTED_STATE_PROOF_PARITY",
    previousStatus,
    "SELECTED_STATE_PROOF_PARITY",
    {
      selectedStateRequirementCount:
        satisfactionResults.length,
      selectedStateSatisfiedCount:
        satisfiedCount,
      selectedStateUnsatisfiedCount:
        unsatisfiedCount,
      selectedStateAllSatisfied:
        unsatisfiedCount === 0,
    }
  );
}
  }



  let nextStatus:
    | BrowserTraceStatus
    | undefined;

  let nextReasonCategory:
    | string
    | undefined;

  const passAcceptanceCoverageGapReason =
    previousStatus === "PASS"
      ? getBrowserAcceptanceCoverageGapReason({
          testCase,
          currentResult,
        })
      : null;

  /*
   * Evidence may safely downgrade an unproven FAIL.
   * It must never create a PASS by itself.
   *
   * PRODUCT_BUG also does not upgrade
   * MANUAL_REQUIRED to FAIL. A product failure is
   * retained only when the runner had already
   * produced FAIL from executed assertions.
   */
  if (
    previousStatus === "PASS" &&
    passAcceptanceCoverageGapReason &&
    (
      verdict === "PASS_CONFIRMED" ||
      verdict === "PRODUCT_BUG"
    )
  ) {
    nextStatus = "MANUAL_REQUIRED";
    nextReasonCategory =
      "ACCEPTANCE_COVERAGE_GAP";

    currentResult.evidence = [
      currentResult.evidence,
      passAcceptanceCoverageGapReason,
    ]
      .filter(Boolean)
      .join(" | ");
  } else if (
    previousStatus === "PASS" &&
    hasExplicitSelectedStateRequirements &&
    !selectedStateRequirementsSatisfied
  ) {
    /*
     * SELECTED_STATE_PASS_ELIGIBILITY_V1
     *
     * Structured satisfaction is not a PASS
     * generator. It is only a proof prerequisite
     * for a raw PASS that explicitly declares a
     * SELECTED_STATE acceptance requirement.
     */
    nextStatus =
      "MANUAL_REQUIRED";
    nextReasonCategory =
      "ACCEPTANCE_COVERAGE_GAP";

    currentResult.evidence = [
      currentResult.evidence,
      "manual required: an explicit SELECTED_STATE " +
        "acceptance requirement lacks the matching " +
        "successful interaction and exact passing " +
        "visible-state oracle evidence",
    ]
      .filter(Boolean)
      .join(" | ");
  } else if (
    verdict === "PASS_CONFIRMED" &&
    previousStatus === "PASS"
  ) {
    const acceptanceCoverageGapReason =
      passAcceptanceCoverageGapReason;

    if (acceptanceCoverageGapReason) {

      nextStatus =
        "MANUAL_REQUIRED";
      nextReasonCategory =
        "ACCEPTANCE_COVERAGE_GAP";

      currentResult.evidence = [
        currentResult.evidence,
        acceptanceCoverageGapReason,
      ]
        .filter(Boolean)
        .join(" | ");

    } else if (confidence === "high") {
      currentResult.reasonCategory =
        "PASS_EVIDENCE_CONFIRMED";

      console.log(
        " Evidence confirmation: PASS retained " +
          "(PASS_CONFIRMED, high)"
      );

      return;
    } else {
      nextStatus =
        "MANUAL_REQUIRED";
      nextReasonCategory =
        "PASS_EVIDENCE_NOT_CONCLUSIVE";
    }
  } else if (
    verdict === "WRONG_ROUTE"
  ) {
    nextStatus = "BLOCKED";
    nextReasonCategory =
      "WRONG_ROUTE";
  } else if (
    verdict === "TEST_DATA_ISSUE"
  ) {
    nextStatus = "BLOCKED";
    nextReasonCategory =
      "TEST_DATA_ISSUE";
  } else if (
    verdict ===
      "AUTOMATION_LIMITATION"
  ) {

    if (
      hasRetainableDeterministicFailure
    ) {
      recordReconciliationAudit(
        "RETAIN_DETERMINISTIC_FAIL",
        previousStatus,
        String(
          currentResult?.reasonCategory ||
            "DETERMINISTIC_ASSERTION_FAILED"
        )
      );

      console.log(
        " Deterministic failure retained; " +
          `${source} automation limitation ` +
          "cannot override completed machine assertions."
      );

      return;
    }

    nextStatus =
      "MANUAL_REQUIRED";
    nextReasonCategory =
      "AUTOMATION_LIMITATION";
  } else if (
    verdict === "INCONCLUSIVE"
  ) {

    if (
      hasRetainableDeterministicFailure
    ) {
      recordReconciliationAudit(
        "RETAIN_DETERMINISTIC_FAIL",
        previousStatus,
        String(
          currentResult?.reasonCategory ||
            "DETERMINISTIC_ASSERTION_FAILED"
        )
      );

      console.log(
        " Deterministic failure retained; " +
          `${source} inconclusive evidence ` +
          "cannot override completed machine assertions."
      );

      return;
    }

    const deterministicPassRevalidation =
      previousStatus === "PASS"
        ? revalidateTrustedDeterministicRawPass({
            testCase,
            currentResult,
          })
        : null;

    if (
      deterministicPassRevalidation?.status ===
      "DETERMINISTIC_CASE_PASS_ELIGIBLE"
    ) {
      currentResult.reasonCategory =
        "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE";
      recordReconciliationAudit(
        "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE",
        previousStatus,
        "DETERMINISTIC_PASS_RETAINED_DESPITE_VISUAL_INCONCLUSIVE",
        {
          deterministicPassEligibility:
            deterministicPassRevalidation.status,
          visualReviewVerdict: verdict,
          visualReviewConfidence:
            confidence,
          retainedRawPass: true,
        }
      );

      console.log(
        " Trusted deterministic raw PASS retained; " +
          `${source} evidence was INCONCLUSIVE and did not contradict the independently revalidated proof.`
      );
      return;
    }

    nextStatus =
      "MANUAL_REQUIRED";
    nextReasonCategory =
      "EVIDENCE_INCONCLUSIVE";
  } else if (
    verdict === "PRODUCT_BUG" &&
    previousStatus === "FAIL"
  ) {
    /*
     * INDEPENDENT_URL_PRODUCT_FINDING_V1
     *
     * A completed source-grounded URL assertion is an
     * independent oracle. Unrelated fixture wording in the
     * case must not downgrade that deterministic mismatch.
     */
const hasIndependentUrlContractFailure =
  hasRetainableDeterministicFailure &&
  hasFailedDeterministicUrlAssertion;

if (
  hasRetainableDeterministicFailure &&
  !hasUnverifiedOracleDependency
) {
  recordReconciliationAudit(
    "RETAIN_DETERMINISTIC_FAIL",
    previousStatus,
    String(
      currentResult?.reasonCategory ||
        "DETERMINISTIC_ASSERTION_FAILED"
    )
  );

  console.log(
    " Deterministic failure retained; " +
      `${source} product-bug confidence ` +
      "cannot downgrade completed machine assertions."
  );

  return;
}

if (
  confidence === "high" &&
  (
    !hasUnverifiedOracleDependency ||
    hasIndependentUrlContractFailure
  )
) {
      nextStatus = "FAIL";
      nextReasonCategory =
        "PRODUCT_ASSERTION_FAILED";
    } else {
      nextStatus =
        "MANUAL_REQUIRED";

      nextReasonCategory =
        hasUnverifiedOracleDependency
          ? "UNVERIFIED_TEST_ORACLE"
          : "UNCONFIRMED_PRODUCT_BUG";
    }
  }

  if (
    !nextStatus ||
    nextStatus === previousStatus
  ) {
    return;
  }

  currentResult.status =
    nextStatus;

  currentResult.reasonCategory =
    nextReasonCategory;

  recordReconciliationAudit(
    "STATUS_CHANGED",
    nextStatus,
    nextReasonCategory
  );

  currentResult.terminationReason =
  nextReasonCategory === "PASS_EVIDENCE_UNAVAILABLE"
    ? "PROOF_GAP"
    : nextReasonCategory === "NO_SAFE_ACTION"
      ? "NO_SAFE_ACTION"
      : nextReasonCategory === "NEEDS_MORE_CONTEXT"
        ? "NEEDS_MORE_CONTEXT"
        : nextStatus === "PASS"
          ? "SUCCESS_SIGNAL_REACHED"
          : undefined;

  currentResult.successSignalReached =
    nextStatus === "PASS";

  if (
    currentResult.evidenceSummary
  ) {
    currentResult
      .evidenceSummary
      .successSignalReached =
        nextStatus === "PASS";
  }

  if (
    Array.isArray(
      currentResult.trace
    )
  ) {
    const finalStatusStep = [
      ...currentResult.trace,
    ]
      .reverse()
      .find(
        (step: any) =>
          step?.action ===
          "final-status"
      );

    if (finalStatusStep) {
      finalStatusStep.status =
        nextStatus;

      finalStatusStep.note =
        `Final browser case status: ` +
        `${nextStatus} ` +
        `(reconciled from ` +
        `${previousStatus} by ` +
        `${source} evidence: ` +
        `${verdict})`;
    }
  }

  const reconciliationNote =
    `Evidence reconciliation: ` +
    `${previousStatus} -> ` +
    `${nextStatus} ` +
    `(${source}: ${verdict})`;

  currentResult.evidence = [
    currentResult.evidence,
    reconciliationNote,
  ]
    .filter(Boolean)
    .join(" | ");

  console.log(
    ` ${reconciliationNote}`
  );
}

/**
 * Prevent generic text assertions from producing PASS
 * when the case requires a concrete navigation result.
 *
 * Example:
 * Clicking Next and seeing "Jobs" does not prove that
 * job creation completed or redirected to job details.
 */
export function getBrowserPassSemanticGuardReason(
  args: {
    testCase: any;
    finalUrl: string;
  }
): string | null {
  const caseText = [
    args.testCase?.goal,
    args.testCase?.successCriteria,
    JSON.stringify(
      args.testCase?.steps ?? []
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");

  const hasJobCreationIntent =
    [
      "job creation",
      "job-creation",
      "create new job",
      "completing job creation",
      "successful job creation",
    ].some((term) =>
      caseText.includes(term)
    );

  const hasDetailsRedirectIntent =
    caseText.includes("redirect") ||
    caseText.includes(
      "job details page"
    ) ||
    /\/company\/(?:all-)?jobs\/\{jobid\}/i.test(
      caseText
    );

  if (
    !hasJobCreationIntent ||
    !hasDetailsRedirectIntent
  ) {
    return null;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(
      args.finalUrl
    );
  } catch {
    return (
      "manual required: the job-creation " +
      "redirect could not be verified because " +
      `the final URL is invalid: ${args.finalUrl}`
    );
  }

  const pathname =
    parsedUrl.pathname
      .toLowerCase()
      .replace(/\/+$/, "");

  const detailsMatch =
    pathname.match(
      /^\/company\/(?:all-jobs|jobs)\/([^/]+)$/
    );

  const jobIdSegment =
    String(
      detailsMatch?.[1] || ""
    ).trim();

  const invalidDetailsSegments =
    new Set([
      "",
      "create",
      "new",
      "edit",
      "unknown",
    ]);

  const onConcreteJobDetailsRoute =
    Boolean(detailsMatch) &&
    !invalidDetailsSegments.has(
      jobIdSegment
    ) &&
    !jobIdSegment.includes("{") &&
    !jobIdSegment.includes("}");

  if (!onConcreteJobDetailsRoute) {
    return (
      "manual required: job creation redirect " +
      "was not proven; the final URL is not a " +
      "concrete job details route: " +
      args.finalUrl
    );
  }

  const requiresProjectQuery =
    caseText.includes(
      "project query parameter"
    ) ||
    caseText.includes(
      "project={projectid}"
    ) ||
    /[?&]project=\{projectid\}/i.test(
      caseText
    );

  const projectId =
    parsedUrl.searchParams
      .get("project")
      ?.trim();

  if (
    requiresProjectQuery &&
    !projectId
  ) {
    return (
      "manual required: the concrete job " +
      "details route was reached, but the " +
      "required project query parameter " +
      "is missing."
    );
  }

  const hasObsoleteJobIdQuery =
    Array.from(
      parsedUrl.searchParams.keys()
    ).some(
      (key) =>
        key.toLowerCase() ===
        "jobid"
    );

  if (hasObsoleteJobIdQuery) {
    return (
      "manual required: the final URL uses " +
      "the obsolete jobId query parameter, " +
      "so the expected redirect cannot be " +
      "confirmed as passing."
    );
  }

  return null;
}

export function buildEvidenceReviewCase(
  testCase: any
): any {
  const successCriteria =
    String(
      testCase?.successCriteria || ""
    ).trim();

  const legacyAutomatedCriteria =
    successCriteria
      .split(
        /(?<=[.!?])\s+|\n+/
      )
      .map(
        (sentence) =>
          sentence.trim()
      )
      .filter(Boolean)
      .filter(
        (sentence) =>
          !(
            /\bmanual(?:_required|\s+required)\b/i.test(
              sentence
            ) ||
            /\bchecked separately\b/i.test(
              sentence
            ) ||
            /\bmust be checked separately\b/i.test(
              sentence
            ) ||
            /\brequires? manual\b/i.test(
              sentence
            )
          )
      );

  const automatedChecks =
    Array.isArray(
      testCase?.automatedChecks
    )
      ? testCase.automatedChecks
          .map((check: unknown) =>
            String(check ?? "").trim()
          )
          .filter(Boolean)
      : [];

  const reviewCriteria =
    automatedChecks.length > 0
      ? automatedChecks
      : legacyAutomatedCriteria;

  return {
    ...testCase,
    successCriteria:
      reviewCriteria.join(" ") ||
      String(testCase?.goal || ""),
    automatedChecks:
      reviewCriteria,
    manualChecks:
      Array.isArray(
        testCase?.manualChecks
      )
        ? testCase.manualChecks
        : [],
    fixtureRequirements:
      Array.isArray(
        testCase?.fixtureRequirements
      )
        ? testCase.fixtureRequirements
        : [],
  };
}
