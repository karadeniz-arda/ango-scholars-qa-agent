import type {
  BrowserTraceStatus,
} from "./browser-execution-types.js";

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
      (
        hasFailedDeterministicUiAssertion &&
        hasSuccessfulInteractionCheckpoint
      )
    );

  const recordReconciliationAudit = (
    decision:
      | "RETAIN_DETERMINISTIC_FAIL"
      | "RETAIN_DETERMINISTIC_PASS"
      | "STATUS_CHANGED",
    finalStatus: BrowserTraceStatus,
    reasonCategory?: string
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
      },
    ];

    console.log(
      ` Evidence reconciliation audit: ` +
        `raw=${previousStatus}, ` +
        `final=${finalStatus}, ` +
        `decision=${decision}, ` +
        `source=${source}, ` +
        `verdict=${verdict}, ` +
        `failedActions=${
          failedDeterministicActions.length > 0
            ? failedDeterministicActions.join(",")
            : "none"
        }`
    );
  };

  let nextStatus:
    | BrowserTraceStatus
    | undefined;

  let nextReasonCategory:
    | string
    | undefined;

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
    verdict === "PASS_CONFIRMED" &&
    previousStatus === "PASS"
  ) {
    if (confidence === "high") {
      currentResult.reasonCategory =
        "PASS_EVIDENCE_CONFIRMED";

      console.log(
        " Evidence confirmation: PASS retained " +
          "(PASS_CONFIRMED, high)"
      );

      return;
    }

    nextStatus =
      "MANUAL_REQUIRED";
    nextReasonCategory =
      "PASS_EVIDENCE_NOT_CONCLUSIVE";
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
