import fs from "node:fs";
import yaml from "yaml";
import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import type { TestPlan } from "../../planner/types.js";
import type {
  RuntimeContextsByPersona,
} from "../../runtime/runtime-context.js";
import { createCustomToken } from "../../auth/firebase.js";
import type { Page, Locator } from "playwright";
import {
  resolveBrowserRouteCandidates,
} from "./browser-route-resolver.js";
import {
  probeBrowserRouteCandidates,
} from "./browser-route-probe.js";
import {
  reviewBrowserEvidence,
  type BrowserEvidenceCheckpoint,
  type BrowserDeterministicEvidence,
  type BrowserEvidenceIdentity,
} from "./evidence-review.js";
import {
  reviewBrowserVideoEvidence,
  shouldRunVideoEvidenceReview,
} from "./video-evidence-review.js";
import {
  clickSmartButton,
  clickSmartText,
  openLikelyPanelOrItem,
  openMatchingTableRowDetail,
  findTextInOpenDetailSurface,
} from "./generic-browser-actions.js";
import {
  openSmartMenu,
  selectRuntimeTopTab,
  selectSmartOption,
} from "./browser-control-interaction.js";
import {
  openRuntimeControl,
  selectRuntimeFilterOption,
} from "./runtime-filter-interaction.js";
import {
  isInvoiceRowClickRequest,
  resolveAndOpenInvoiceRow,
} from "./browser-entity-interaction.js";




type BrowserPersona = "company_admin" | "talent";

export type BrowserRunOptions = {
  runtimeContexts?:
    RuntimeContextsByPersona;
};

type BrowserArea =
  | "assessments"
  | "languages"
  | "skills"
  | "jobs"
  | "work-setups"
  | "payments"
  | "contracts"
  | "offers"
  | "talent-pool"
  | "onboarding"
  | "talent-profile";

import {
  createDraftJobAndVerifyRedirect,
} from "./browser-job-creation-redirect.js";

import {
  executeDeferredCleanups,
  type DeferredCleanup,
} from "./browser-deferred-cleanup.js";

async function visualAction(page: Page, locator: Locator, action: "click") {
  const isVisible = await locator.first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!isVisible) {
    console.log(" Visual action skipped: target element is not visible.");
    return;
  }
  const box = await locator.first().boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 35 });
    await page.waitForTimeout(250);
  }
  if (action === "click") {
    await locator.click();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRuntimeInvoiceFixtureResolver(
  testCase: any
): boolean {
  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  return steps.some(
    (step: any) =>
      step?.action === "clickText" &&
      isInvoiceRowClickRequest(
        testCase,
        String(step?.text || "")
      )
  );
}

/**
 * Prevent record-specific assertions from producing a
 * false product FAIL when the planner explicitly states
 * that the required staging fixture is unavailable.
 *
 * Invoice cases are exempt because their specialized
 * interaction can discover and verify a safe runtime row.
 */
function isChangeRequestRowDetailClickRequest(
  testCase: any,
  requestedText: string
): boolean {
  const caseText =
    getBrowserCaseText(testCase)
      .replace(/[-_]+/g, " ");

  const requested = String(
    requestedText || ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (
    !requested ||
    /^change requests?$/.test(
      requested
    )
  ) {
    return false;
  }

  const changeRequestContext =
    caseText.includes(
      "change request"
    ) ||
    caseText.includes(
      "publish request"
    ) ||
    caseText.includes(
      "field update request"
    );

  const detailContext =
    caseText.includes("comparison") ||
    caseText.includes("review") ||
    caseText.includes("details") ||
    caseText.includes("detail");

  const requestedRecordState =
    requested.includes("request") ||
    requested.includes("publish") ||
    requested.includes(
      "field update"
    );

  return (
    changeRequestContext &&
    detailContext &&
    requestedRecordState
  );
}

function getExplicitMissingBrowserFixtureReason(
  testCase: any
): string | null {
  const runtimeFixturePolicy =
    String(
      testCase?.runtimeFixturePolicy || ""
    )
      .trim()
      .toLowerCase();

  /*
   * RECORDLESS_CREATE_ROUTE_FIXTURE_GATE_V1
   *
   * A concrete create/new route can be inspected
   * without an existing record fixture when every
   * planned action is observational and read-only.
   */
  const startRoute =
    String(testCase?.startRoute || "")
      .trim();

  const steps =
    Array.isArray(testCase?.steps)
      ? testCase.steps
      : [];

  const safeObservationActions =
    new Set([
      "clickText",
      "openRuntimeControl",
      "assertTextVisible",
      "assertTextNotVisible",
      "assertUrlContains",
      "assertUrlNotContains",
    ]);

  const isRecordlessCreateRoute =
    /(?:^|\/)(?:create|new)(?:\/|$)/i.test(
      startRoute
    );

  const hasOnlySafeObservationSteps =
    steps.length > 0 &&
    steps.every(
      (step: any) =>
        safeObservationActions.has(
          String(step?.action || "")
        )
    );

  if (
    isRecordlessCreateRoute &&
    hasOnlySafeObservationSteps
  ) {
    return null;
  }

  /*
   * COMPATIBLE_STATE_FIXTURE_GATE_V1
   *
   * A compatible-state case may safely inspect the
   * concrete runtime route without requiring one exact
   * record fixture. Real resolver failures are handled
   * separately by runtimeFixtureResolutionFailure.
   */
  if (
    runtimeFixturePolicy ===
      "compatible-state"
  ) {
    return null;
  }

  if (
    hasRuntimeInvoiceFixtureResolver(
      testCase
    )
  ) {
    return null;
  }

  const caseText =
    getBrowserCaseText(testCase)
      .replace(/\s+/g, " ");

  const explicitMissingFixtureSignals = [
    /blocked(?: for automated execution)? until[^.]{0,240}\bfixture\b/,
    /execution requires[^.]{0,240}\bfixture\b/,
    /\bfixture\b[^.]{0,180}\b(?:not supplied|unavailable|missing)\b/,
    /\b(?:not supplied|unavailable|missing)\b[^.]{0,200}\bfixture\b/,
    /\brequires?\b[^.]{0,180}\bmanual_required fixture setup\b/,
  ];

  if (
    !explicitMissingFixtureSignals.some(
      (pattern) =>
        pattern.test(caseText)
    )
  ) {
    return null;
  }

  return (
    `Browser fixture gate blocked ` +
    `${testCase?.id || "case"}: ` +
    `required fixture data is explicitly unavailable ` +
    `or not supplied, and no supported runtime fixture ` +
    `resolver applies.`
  );
}

function getBrowserBlockReason(testCase: any): string | null {
  const persona = String(testCase.persona || "").trim();
  const startRoute = String(testCase.startRoute || "").trim();

  if (!["company_admin", "talent"].includes(persona)) {
    return `Unsupported browser persona "${persona}". Supported browser personas: company_admin, talent.`;
  }
  if (!startRoute || startRoute.toUpperCase() === "UNKNOWN") {
    const runtimeFailure = String(
      testCase.runtimeRouteDiscoveryFailure || ""
    ).trim();

    if (runtimeFailure) {
      return runtimeFailure;
    }

    return "Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed.";
  }
  if (/{[^}]+}/.test(startRoute)) {
  return `Browser startRoute contains unresolved placeholder: ${startRoute}`;
}

const runtimeFixtureResolutionFailure =
  String(
    testCase
      ?.runtimeFixtureResolutionFailure ||
      ""
  ).trim();

if (runtimeFixtureResolutionFailure) {
  return runtimeFixtureResolutionFailure;
}

const urlAssertionPrerequisiteFailure =
  String(
    testCase
      ?.runtimeUrlAssertionPrerequisiteFailure ||
      ""
  ).trim();

if (urlAssertionPrerequisiteFailure) {
  return urlAssertionPrerequisiteFailure;
}

const textAssertionProvenanceFailure =
  String(
    testCase
      ?.runtimeTextAssertionProvenanceFailure ||
      ""
  ).trim();

if (textAssertionProvenanceFailure) {
  return textAssertionProvenanceFailure;
}

const fixtureBlockReason =
  getExplicitMissingBrowserFixtureReason(
    testCase
  );

if (fixtureBlockReason) {
  return fixtureBlockReason;
}

const relevanceBlockReason =
  getBrowserRelevanceBlockReason(testCase);

if (relevanceBlockReason) {
  return relevanceBlockReason;
}

if (
  isAssessmentLanguageModalCase(testCase) &&
  !browserEditFlowsAllowed()
) {
  return (
    "Assessment language modal requires entering " +
    "an edit flow. Browser edit flows are disabled " +
    "by default to protect staging data. " +
    "Set QA_ALLOW_BROWSER_EDIT_FLOWS=true only " +
    "for isolated test data."
  );
}

return null;
}

async function cancelAssessmentEditIfOpen(
  page: Page,
  testCase: any
): Promise<void> {
  if (
    !isAssessmentLanguageModalCase(
      testCase
    )
  ) {
    return;
  }

  const openDialog = page
    .locator(
      '[role="dialog"]:visible, .ant-modal-wrap:visible'
    )
    .last();

  const dialogVisible = await openDialog
    .isVisible({
      timeout: 1000,
    })
    .catch(() => false);

if (dialogVisible) {
  const levelAdjustmentPanelOpen =
    await page
      .getByText(
        /^Listening\*?$/i
      )
      .first()
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  if (levelAdjustmentPanelOpen) {
    const levelAdjustmentButton =
      page
        .getByRole("button", {
          name: /level adjustment/i,
        })
        .first();

    const adjustmentButtonVisible =
      await levelAdjustmentButton
        .isVisible({
          timeout: 500,
        })
        .catch(() => false);

    if (adjustmentButtonVisible) {
      await levelAdjustmentButton.click();
      await page.waitForTimeout(250);

      console.log(
        ` Assessment level adjustment panel ` +
          `closed for ${testCase.id}`
      );
    }
  }

  const modalCancel = openDialog
      .getByRole("button", {
        name: /^cancel$/i,
      })
      .first();

    const modalCancelVisible =
      await modalCancel
        .isVisible({
          timeout: 1000,
        })
        .catch(() => false);

    if (modalCancelVisible) {
      await modalCancel.click();

      console.log(
        ` Assessment language dialog cancelled ` +
          `for ${testCase.id}`
      );
    } else {
      const modalClose = openDialog
        .locator(
          ".ant-modal-close"
        )
        .first();

      const modalCloseVisible =
        await modalClose
          .isVisible({
            timeout: 1000,
          })
          .catch(() => false);

      if (modalCloseVisible) {
        await modalClose.click();

        console.log(
          ` Assessment language dialog closed ` +
            `for ${testCase.id}`
        );
      }
    }

    await page.waitForTimeout(500);
  }

  const cancelEditButton = page
    .getByRole("button", {
      name: /^cancel edit$/i,
    })
    .first();

  const cancelEditVisible =
    await cancelEditButton
      .isVisible({
        timeout: 1000,
      })
      .catch(() => false);

  if (!cancelEditVisible) {
    return;
  }

  await cancelEditButton.click();
  await page.waitForTimeout(500);

  console.log(
    ` Assessment edit flow cancelled for ` +
      `${testCase.id}`
  );
}

function getBrowserBlockReasonCategory(
  reason: string
): string {
  if (
    reason.includes(
      "Browser URL assertion gate blocked"
    )
  ) {
    return (
      "URL_ASSERTION_PREREQUISITE_MISSING"
    );
  }

  if (
    reason.includes(
      "Browser text assertion provenance gate blocked"
    )
  ) {
    return (
      "TEXT_ASSERTION_PROVENANCE_MISSING"
    );
  }

  if (
    reason.includes(
      "Browser fixture gate blocked"
    )
  ) {
    return "TEST_DATA_ISSUE";
  }

  if (
    reason.includes(
      "Browser relevance gate rejected"
    )
  ) {
    return "IRRELEVANT_BROWSER_ROUTE";
  }

  if (
    reason.includes(
      "Unsupported browser persona"
    )
  ) {
    return "UNSUPPORTED_BROWSER_PERSONA";
  }

  if (
    reason.includes(
      "Runtime browser route discovery exhausted"
    )
  ) {
    return "ROUTE_DISCOVERY_EXHAUSTED";
  }

  return "MISSING_BROWSER_ROUTE";
}

type BrowserStep =
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
      hint?: string;
    }
  | {
      action: "createDraftJobAndVerifyRedirect";
      origin: "jobs" | "all-jobs";
    }
  | { action: "clickButton"; text: string }
  | { action: "clickText"; text: string }
  | { action: "openMenu"; text: string }
  | { action: "selectOption"; text: string }
  | { action: "clickProjectDropdown" }
  | { action: "selectLastDropdownOption" }
  | { action: "assertUrlContains"; text: string }
  | { action: "assertUrlNotContains"; text: string }
  | { action: "assertTextVisible"; text: string }
  | { action: "assertTextNotVisible"; text: string }
  | { action: "setViewport"; width: number; height: number };

type BrowserStepResult = {
  status:
    | "PASS"
    | "FAIL"
    | "BLOCKED"
    | "MANUAL_REQUIRED"
    | "ERROR";
  reasonCategory: string;
  notes: string[];
  deterministicEvidence?:
    BrowserDeterministicEvidence[];
};



type BrowserCheckpointCaptureArgs = {
  stepIndex: number;
  step: BrowserStep;
  note: string;
};

type BrowserCheckpointCapture = (
  args: BrowserCheckpointCaptureArgs
) => Promise<void>;

type BrowserTraceStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "MANUAL_REQUIRED"
  | "ERROR";

type BrowserTraceStep = {
  index: number;
  action: string;
  status: BrowserTraceStatus;
  note: string;
  url?: string;
};

type BrowserEvidenceSummary = {
  successSignal: string;
  successSignalReached: boolean;
  authWallDetected: boolean;
  pagesVisited: string[];
  keyVisibleTexts: string[];
};

function reconcileBrowserResultFromEvidence(args: {
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
function getBrowserPassSemanticGuardReason(
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

function buildEvidenceReviewCase(
  testCase: any
): any {
  const successCriteria =
    String(
      testCase?.successCriteria || ""
    ).trim();

  const automatedCriteria =
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
      )
      .join(" ");

  return {
    ...testCase,
    successCriteria:
      automatedCriteria ||
      String(testCase?.goal || ""),
  };
}

function buildSuccessSignal(testCase: any): string {
  const successCriteria = String(testCase.successCriteria || "").trim();
  const goal = String(testCase.goal || "").trim();

  if (successCriteria) return successCriteria;
  if (goal) return goal;

  return "Expected browser assertions pass without blocked execution.";
}

function statusFromNote(note: string): BrowserTraceStatus {
  const lower = note.toLowerCase();

  const structuredPrefix = lower.match(
    /^(pass|fail|blocked|manual_required|error):/
  )?.[1];

  if (structuredPrefix === "pass") {
    return "PASS";
  }

  if (structuredPrefix === "fail") {
    return "FAIL";
  }

  if (structuredPrefix === "blocked") {
    return "BLOCKED";
  }

  if (
    structuredPrefix ===
    "manual_required"
  ) {
    return "MANUAL_REQUIRED";
  }

  if (structuredPrefix === "error") {
    return "ERROR";
  }

  const manualRequiredSignals = [
    "manual required",
    "not visible or not safely clickable",
    "could not click",
    "could not open",
    "could not find",
    "could not resolve",
    "could not be resolved",
    "no safe unselected option",
    "could not be verified",
    "was not safely clickable",
    "fallback after",
    "clicked likely panel/item trigger",
  ];

  if (
    manualRequiredSignals.some(
      (signal) => lower.includes(signal)
    )
  ) {
    return "MANUAL_REQUIRED";
  }

  const explicitStatus =
    lower.match(
      /:\s*(pass|fail|blocked|error)\b/
    );

  if (
    explicitStatus?.[1] === "pass"
  ) {
    return "PASS";
  }

  if (
    explicitStatus?.[1] === "fail"
  ) {
    return "FAIL";
  }

  if (
    explicitStatus?.[1] === "blocked"
  ) {
    return "BLOCKED";
  }

  if (
    explicitStatus?.[1] === "error"
  ) {
    return "ERROR";
  }

  if (/^blocked\b/.test(lower)) {
    return "BLOCKED";
  }

  if (/^error\b/.test(lower)) {
    return "ERROR";
  }

  return "PASS";
}

function buildTraceFromBrowserRun(args: {
  targetUrl: string;
  finalUrl: string;
  notes: string[];
  screenshotPath?: string;
  checkpointEvidence?:
    BrowserEvidenceCheckpoint[];
  finalStatus: BrowserTraceStatus;
}): BrowserTraceStep[] {
  const trace: BrowserTraceStep[] = [];

  trace.push({
    index: trace.length + 1,
    action: "navigate",
    status: "PASS",
    note: `Navigated to ${args.targetUrl}`,
    url: args.targetUrl,
  });

  for (const note of args.notes) {
    trace.push({
      index: trace.length + 1,
      action: "browser-step",
      status: statusFromNote(note),
      note,
      url: args.finalUrl,
    });
  }

  for (
    const checkpoint
    of args.checkpointEvidence ?? []
  ) {
    trace.push({
      index: trace.length + 1,
      action: "evidence-checkpoint",
      status: "PASS",
      note:
        `Checkpoint captured after step ` +
        `${checkpoint.stepIndex}: ` +
        `${checkpoint.label} -> ` +
        `${checkpoint.screenshotPath}`,
      url: checkpoint.url,
    });
  }

  if (args.screenshotPath) {
    trace.push({
      index: trace.length + 1,
      action: "screenshot",
      status: "PASS",
      note: `Screenshot captured: ${args.screenshotPath}`,
      url: args.finalUrl,
    });
  }

  trace.push({
    index: trace.length + 1,
    action: "final-status",
    status: args.finalStatus,
    note: `Final browser case status: ${args.finalStatus}`,
    url: args.finalUrl,
  });

  return trace;
}

function formatTrace(trace: BrowserTraceStep[]): string {
  return trace
    .map((step) => {
      const index = String(step.index).padStart(2, "0");
      return `${index}. ${step.action} ${step.status} - ${step.note}`;
    })
    .join(" || ");
}

async function detectAuthWall(page: Page): Promise<boolean> {
  const authWallTexts = [
    "Continue to Scholars",
    "Continue with Google",
    "Email is required",
    "name@email.com",
    "Sign in",
    "Log in",
  ];

  for (const text of authWallTexts) {
    const visible = await page
      .getByText(text, { exact: false })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (visible) return true;
  }

  const currentUrl = page.url().toLowerCase();

  return (
    currentUrl.includes("login") ||
    currentUrl.includes("signin") ||
    currentUrl.includes("sign-in") ||
    currentUrl.includes("auth")
  );
}

async function collectKeyVisibleTexts(page: Page): Promise<string[]> {
  const candidates = [
    "Project",
    "Job Title",
    "Job Description",
    "Skills",
    "All",
    "Continue to Scholars",
    "Continue",
    "Email",
    "Select a project",
    "Newest",
    "Latest",
    "Oldest",
    "Filters",
    "Processed By",
    "Paid On",
    "Work Period",
    "Submit By",
    "Approved By",
    "undefined",
    "null",
  ];

  const visibleTexts: string[] = [];

  for (const text of candidates) {
    const visible = await page
      .getByText(text, { exact: false })
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (visible) visibleTexts.push(text);
  }

  return visibleTexts;
}

async function logVisibleAssessmentControls(
  page: Page,
  testCase: any
): Promise<void> {
  const caseText = getBrowserCaseText(testCase);

  if (!caseText.includes("assessment")) {
    return;
  }

  const labels = await page.evaluate(() => {
    const selectors = [
      "button",
      "a",
      '[role="button"]',
      '[role="tab"]',
      '[aria-label]',
      "h1",
      "h2",
      "h3",
    ];

    const elements = Array.from(
      document.querySelectorAll(
        selectors.join(",")
      )
    ) as HTMLElement[];

    const values = elements
      .filter((element) => {
        const rect =
          element.getBoundingClientRect();

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        );
      })
      .map((element) => {
        return String(
          element.getAttribute("aria-label") ||
            element.innerText ||
            element.textContent ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter((value) => {
        return (
          value.length > 0 &&
          value.length <= 120
        );
      });

    return Array.from(new Set(values))
      .slice(0, 80);
  });

  console.log(
    ` Assessment UI controls for ` +
      `${testCase.id}: ` +
      `${labels.join(" | ") || "none"}`
  );
}

function browserEditFlowsAllowed(): boolean {
  return (
    process.env.QA_ALLOW_BROWSER_EDIT_FLOWS ===
    "true"
  );
}

function isAssessmentLanguageCase(
  testCase: any
): boolean {
  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
    JSON.stringify(
      testCase?.steps ?? []
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  return (
    caseText.includes("assessment") &&
    [
      "language",
      "proficiency",
      "listening",
      "speaking",
      "writing",
      "reading",
    ].some((term) =>
      caseText.includes(term)
    )
  );
}

function isAssessmentLanguageModalCase(
  testCase: any
): boolean {
  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  return (
    isAssessmentLanguageCase(testCase) &&
    [
      "modal",
      "editor",
      "edit flow",
      "edit assessment",
      "editing",
    ].some((term) =>
      caseText.includes(term)
    )
  );
}

function ensureAssessmentLanguageReadOnlyNavigationStep(
  testCase: any
): void {
  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const requiresReadOnlyDetailsState =
    isAssessmentLanguageCase(testCase) &&
    !isAssessmentLanguageModalCase(
      testCase
    ) &&
    [
      "details",
      "detail",
      "review",
      "summary",
    ].some((term) =>
      caseText.includes(term)
    );

  if (!requiresReadOnlyDetailsState) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const alreadyNavigatesToDetails =
    steps.some(
      (step: any) =>
        step?.action === "clickTopTab" &&
        /^details$/i.test(
          String(
            step?.text || ""
          ).trim()
        )
    );

  if (alreadyNavigatesToDetails) {
    return;
  }

  testCase.steps = [
    {
      action: "clickTopTab",
      text: "Details",
    },
    ...steps,
  ];

  console.log(
    ` Assessment language read-only navigation ` +
      `added for ${testCase.id}: Details`
  );
}

function ensureTalentProfileLanguageNavigationStep(
  testCase: any
): void {
  const persona = String(
    testCase?.persona || ""
  ).toLowerCase();

  const caseText = [
    String(testCase?.goal || ""),
    String(
      testCase?.successCriteria || ""
    ),
    JSON.stringify(
      testCase?.steps ?? []
    ),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const isTalentProfileLanguageCase =
    persona === "talent" &&
    [
      "talent profile",
      "scholar profile",
      "profile language",
      "language section",
    ].some((term) =>
      caseText.includes(term)
    ) &&
    [
      "language",
      "listening",
      "speaking",
      "writing",
      "reading",
      "proficiency",
    ].some((term) =>
      caseText.includes(term)
    );

  if (!isTalentProfileLanguageCase) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const alreadyNavigates =
    steps.some(
      (step: any) =>
        step?.action === "clickTopTab" &&
        /^skills\s*&\s*languages$/i.test(
          String(
            step?.text || ""
          ).trim()
        )
    );

  if (alreadyNavigates) {
    return;
  }

  testCase.steps = [
    {
      action: "clickTopTab",
      text: "Skills & Languages",
    },
    ...steps,
  ];

  console.log(
    ` Talent profile language navigation ` +
      `added for ${testCase.id}: ` +
      `Skills & Languages`
  );
}

function ensureJobWizardEmptyStateControlStep(
  testCase: any
): void {
  const caseText =
    getBrowserCaseText(testCase);

  if (
    !caseText.includes("job wizard")
  ) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const emptyStateStep = steps.find(
    (step: any) =>
      step?.action ===
        "assertTextVisible" &&
      /^no\s+.+?\s+found$/i.test(
        String(step?.text || "").trim()
      )
  );

  if (!emptyStateStep) {
    return;
  }

  const emptyStateMatch =
    String(emptyStateStep.text)
      .trim()
      .match(
        /^no\s+(.+?)\s+found$/i
      );

  const entityText =
    emptyStateMatch?.[1]?.trim();

  if (!entityText) {
    return;
  }

  const controlTarget =
    `Search ${entityText}`;

  const alreadyOpensControl =
    steps.some(
      (step: any) =>
        step?.action ===
          "openRuntimeControl" &&
        String(
          step?.target || ""
        )
          .trim()
          .toLowerCase() ===
        controlTarget.toLowerCase()
    );

  if (alreadyOpensControl) {
    return;
  }

  const entityNavigationIndex =
    steps.findIndex(
      (step: any) =>
        step?.action ===
          "clickText" &&
        String(step?.text || "")
          .trim()
          .toLowerCase() ===
        entityText.toLowerCase()
    );

  if (
    entityNavigationIndex < 0
  ) {
    return;
  }

  testCase.steps = [
    ...steps.slice(
      0,
      entityNavigationIndex + 1
    ),
    {
      action: "openRuntimeControl",
      target: controlTarget,
    },
    ...steps.slice(
      entityNavigationIndex + 1
    ),
  ];

  console.log(
    ` Job wizard empty-state control ` +
      `navigation added for ` +
      `${testCase.id}: ${controlTarget}`
  );
}

function ensureAssessmentLanguageEditorNavigationStep(
  testCase: any
): void {
  if (
    !isAssessmentLanguageModalCase(
      testCase
    )
  ) {
    return;
  }

  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const isEditorNavigationStep = (
    step: any
  ): boolean => {
    if (
      step?.action !== "clickButton"
    ) {
      return false;
    }

    const text = String(
      step?.text || ""
    )
      .trim()
      .toLowerCase();

    return (
      text === "configure" ||
      text === "level adjustment"
    );
  };

  testCase.steps = [
    {
      action: "clickButton",
      text: "Configure",
    },
    {
      action: "clickButton",
      text: "Level Adjustment",
    },
    ...steps.filter(
      (step: any) =>
        !isEditorNavigationStep(step)
    ),
  ];

  console.log(
    ` Assessment language editor navigation ` +
      `added for ${testCase.id}: ` +
      `Configure -> Level Adjustment`
  );
}

async function prepareAssessmentLanguageModal(
  page: Page,
  testCase: any
): Promise<void> {
  if (
    !isAssessmentLanguageModalCase(testCase)
  ) {
    return;
  }

  if (!browserEditFlowsAllowed()) {
  console.log(
    ` Assessment modal opener skipped for ` +
      `${testCase.id}: browser edit flows ` +
      `are disabled by default.`
  );

  return;
}

  console.log(
    ` Assessment modal opener starting for ${testCase.id}`
  );

  let result = await clickSmartButton(
    page,
    "Edit"
  );

  if (!result.ok) {
    result = await clickSmartText(
      page,
      "Edit"
    );
  }

  console.log(
    ` Assessment modal opener: ${result.note}`
  );

  if (!result.ok) {
    console.log(
      " Assessment modal opener could not click Edit."
    );
    return;
  }

  await page.waitForTimeout(1500);

  await logVisibleAssessmentControls(
    page,
    {
      ...testCase,
      id: `${testCase.id}-after-edit`,
    }
  );
}

async function clickVisibleTextInMainArea(page: Page, text: string) {
  const locator = page.getByText(new RegExp(`^${escapeRegExp(text)}$`, "i"));
  const count = await locator.count();

  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    const visible = await item.isVisible({ timeout: 500 }).catch(() => false);
    if (!visible) continue;

    const box = await item.boundingBox();
    if (!box) continue;

    if (box.x > 220) {
      await visualAction(page, item, "click");
      await page.waitForTimeout(1000);
      console.log(` Generic browser step clicked main-area text: ${text}`);
      return true;
    }
  }
  console.log(` Generic browser step could not find main-area text: ${text}`);
  return false;
}

async function clickProjectDropdown(page: Page) {
  const directCandidates = [
    page.locator('[role="combobox"]').first(),
    page.locator('[aria-haspopup="listbox"]').first(),
    page.locator('[data-slot="select-trigger"]').first(),
    page.locator(".ant-select-selector").first(),
    page.locator("button").filter({ hasText: /select project/i }).first(),
    page.locator("button").filter({ hasText: /project/i }).first(),
  ];

  for (const candidate of directCandidates) {
    if (await candidate.isVisible({ timeout: 1000 }).catch(() => false)) {
      await visualAction(page, candidate, "click");
      await page.waitForTimeout(1000);
      console.log(" Generic browser step clicked project dropdown.");
      return true;
    }
  }

  const projectLabel = page.getByText(/^Project$/i).first();
  const labelVisible = await projectLabel.isVisible({ timeout: 1000 }).catch(() => false);

  if (labelVisible) {
    const box = await projectLabel.boundingBox();

    if (box) {
      const targetX = box.x + 95;
      const targetY = box.y + 42;

      await page.mouse.move(targetX, targetY, { steps: 25 });
      await page.waitForTimeout(200);
      await page.mouse.click(targetX, targetY);
      await page.waitForTimeout(1000);

      console.log(" Generic browser step clicked project dropdown by sidebar position.");
      return true;
    }
  }

  console.log(" Generic browser step could not find project dropdown.");
  return false;
}

async function selectLastDropdownOption(page: Page) {
  await page.waitForTimeout(500);

  const panelBox = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    const panels = elements
      .map((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        const rect = el.getBoundingClientRect();

        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth;

        return {
          el,
          text,
          rect,
          area: rect.width * rect.height,
          visible,
        };
      })
      .filter((item) => {
        return (
          item.visible &&
          /showing\s+\d+\s+of\s+\d+\s+projects/i.test(item.text) &&
          /search project/i.test(item.text) &&
          item.rect.width >= 220 &&
          item.rect.width <= 430 &&
          item.rect.height >= 250
        );
      })
      .sort((a, b) => a.area - b.area);

    const panel = panels[0]?.el;

    if (!panel) return null;

    const descendants = [panel, ...Array.from(panel.querySelectorAll("*"))] as HTMLElement[];

    const scrollable = descendants
      .filter((el) => el.scrollHeight > el.clientHeight + 8)
      .sort((a, b) => {
        const aScrollable = a.scrollHeight - a.clientHeight;
        const bScrollable = b.scrollHeight - b.clientHeight;
        return bScrollable - aScrollable;
      })[0];

    if (scrollable) {
      scrollable.scrollTop = scrollable.scrollHeight;
    } else {
      panel.scrollTop = panel.scrollHeight;
    }

    const rect = panel.getBoundingClientRect();

    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });

  if (!panelBox) {
    console.log(" Generic browser step could not locate project dropdown panel.");

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-options.png",
      fullPage: true,
    });

    return false;
  }

  await page.waitForTimeout(800);

  const candidate = await page.evaluate((box) => {
    const blockedTexts = ["create project", "search project", "showing", "project"];

    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    const items = elements
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        return {
          text,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((item) => {
        if (!item.text) return false;
        if (item.text.length > 80) return false;
        if (item.width <= 0 || item.height <= 0) return false;

        if (item.x < box.x || item.x > box.x + box.width) return false;
        if (item.y < box.y + 75 || item.y > box.y + box.height - 45) return false;

        const lower = item.text.toLowerCase();

        if (blockedTexts.some((blocked) => lower.includes(blocked))) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.y - a.y);

    return items[0] || null;
  }, panelBox);

  if (!candidate) {
    console.log(" Generic browser step could not find last project item inside dropdown panel.");

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-options.png",
      fullPage: true,
    });

    return false;
  }

  await page.mouse.move(
    candidate.x + candidate.width / 2,
    candidate.y + candidate.height / 2,
    { steps: 25 }
  );

  await page.waitForTimeout(200);

  await page.mouse.click(
    candidate.x + candidate.width / 2,
    candidate.y + candidate.height / 2
  );

  await page.waitForTimeout(1000);

  const verified = await page.evaluate((selectedText) => {
    const expected = String(selectedText || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const elements = Array.from(document.querySelectorAll("body *")) as HTMLElement[];

    return elements.some((el) => {
      const text = (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      const rect = el.getBoundingClientRect();

      return (
        text === expected &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= 0 &&
        rect.x < 230 &&
        rect.y > 100 &&
        rect.y < 650
      );
    });
  }, candidate.text);

  if (!verified) {
    console.log(
      ` Generic browser step clicked "${candidate.text}" but could not verify it became selected.`
    );

    await page.screenshot({
      path: "qa-results/evidence/debug-project-dropdown-selection.png",
      fullPage: true,
    });

    return false;
  }

  console.log(
    ` Generic browser step selected and verified last dropdown item: ${candidate.text}`
  );

  return true;
}

function getBrowserCaseText(testCase: any): string {
  const stepText = Array.isArray(testCase.steps)
    ? testCase.steps
        .map((step: any) => [step.action, step.text].filter(Boolean).join(" "))
        .join(" ")
    : "";

  return [testCase.goal, testCase.successCriteria, stepText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferBrowserAreaFromText(
  rawText: string
): BrowserArea | undefined {
  const text = String(rawText || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return undefined;
  }

  if (text.includes("assessment")) {
    return "assessments";
  }

  /*
   * Specific feature areas must be evaluated before
   * generic relationship words such as "job".
   */
  if (text.includes("talent pool")) {
    return "talent-pool";
  }

  if (
    text.includes("job change request") ||
    text.includes("job review") ||
    text.includes("job details") ||
    text.includes("job list") ||
    /\bjob\b/.test(text)
  ) {
    return "jobs";
  }

/*
 * Work Setup terminology may appear alongside
 * negative legacy-name assertions such as
 * "without onboarding-document naming".
 *
 * The concrete feature must win over the legacy
 * area mentioned only as an excluded term.
 */
if (
  text.includes("work setup") ||
  text.includes("work-setup")
) {
  return "work-setups";
}

if (text.includes("onboarding")) {
  return "onboarding";
}

if (
  text.includes(
    "skills and languages profile"
  ) ||
  text.includes("profile tab") ||
  text.includes("talent profile")
) {
  return "talent-profile";
}

  if (
    text.includes("payment") ||
    text.includes("payout") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  if (text.includes("contract")) {
    return "contracts";
  }

  if (text.includes("offer")) {
    return "offers";
  }

  if (
    text.includes("skill selector") ||
    text.includes("skills page") ||
    text.includes("selected skills")
  ) {
    return "skills";
  }

  if (text.includes("language")) {
    return "languages";
  }

  return undefined;
}

function getPositiveBrowserStepText(
  testCase: any
): string {
  if (!Array.isArray(testCase?.steps)) {
    return "";
  }

  return testCase.steps
    .filter(
      (step: any) =>
        step?.action !==
        "assertTextNotVisible"
    )
    .map(
      (step: any) =>
        [
          step?.action,
          step?.text,
        ]
          .filter(Boolean)
          .join(" ")
    )
    .join(" ");
}

function getPositiveSuccessCriteriaText(
  testCase: any
): string {
  const criteria = String(
    testCase?.successCriteria || ""
  );

  /*
   * Negative oracle clauses describe what must
   * not be present. They must not redefine the
   * intended feature area.
   */
  return criteria
    .split(/[.!?]+/)
    .filter((clause) => {
      const normalized =
        clause.trim().toLowerCase();

      if (!normalized) {
        return false;
      }

      return !(
        /\bmust not\b/.test(normalized) ||
        /\bshould not\b/.test(normalized) ||
        /\bdoes not\b/.test(normalized) ||
        /\bdo not\b/.test(normalized) ||
        /\bnot displayed\b/.test(normalized) ||
        /\bnot visible\b/.test(normalized) ||
        /\babsent\b/.test(normalized) ||
        /\bprohibited\b/.test(normalized) ||
        /\brather than\b/.test(normalized) ||
        /\binstead of\b/.test(normalized)
      );
    })
    .join(" ");
}

function inferBrowserCaseArea(
  testCase: any
): BrowserArea | undefined {
  /*
   * Source priority:
   *
   * 1. The explicit goal defines the feature.
   * 2. Positive executable steps provide evidence.
   * 3. Positive success-criteria clauses are fallback.
   *
   * Negative assertions are deliberately excluded.
   */
  const inferenceSources = [
    String(testCase?.goal || ""),
    getPositiveBrowserStepText(testCase),
    getPositiveSuccessCriteriaText(
      testCase
    ),
  ];

  for (const source of inferenceSources) {
    const area =
      inferBrowserAreaFromText(source);

    if (area) {
      return area;
    }
  }

  return undefined;
}

function inferBrowserRouteArea(
  startRoute: string
): BrowserArea | undefined {
  const route = String(startRoute || "")
    .split("?")[0]!
    .toLowerCase();

  if (!route || route === "unknown") {
    return undefined;
  }

  if (route.includes("assessment")) {
    return "assessments";
  }

  if (route.includes("work-setup")) {
    return "work-setups";
  }

  if (
    route.includes("payment") ||
    route.includes("timesheet")
  ) {
    return "payments";
  }

  if (route.includes("contract")) {
    return "contracts";
  }

  if (route.includes("offer")) {
    return "offers";
  }

  if (
    route.includes("talent-pool") ||
    route.includes("/company/talents")
  ) {
    return "talent-pool";
  }

  if (route.includes("onboarding")) {
    return "onboarding";
  }

  if (
    route.includes("/talent/profile") ||
    route.includes("profile")
  ) {
    return "talent-profile";
  }

  if (route.includes("skills")) {
    return "skills";
  }

  if (route.includes("jobs")) {
    return "jobs";
  }

  return undefined;
}

function areBrowserAreasCompatible(
  wantedArea: BrowserArea,
  selectedArea: BrowserArea
): boolean {
  if (wantedArea === selectedArea) {
    return true;
  }

  const compatibleRoutes: Record<
    BrowserArea,
    Set<BrowserArea>
  > = {
    assessments: new Set(["assessments", "jobs"]),
    languages: new Set([
      "languages",
      "talent-profile",
      "onboarding",
      "assessments",
    ]),
    skills: new Set([
      "skills",
      "jobs",
      "talent-profile",
    ]),
    jobs: new Set(["jobs"]),
    "work-setups": new Set([
      "work-setups",
      "jobs",
      "contracts",
    ]),
    payments: new Set(["payments"]),
    contracts: new Set(["contracts", "jobs"]),
    offers: new Set(["offers", "jobs"]),
    "talent-pool": new Set(["talent-pool"]),
    onboarding: new Set(["onboarding"]),
    "talent-profile": new Set(["talent-profile"]),
  };

  return compatibleRoutes[wantedArea].has(selectedArea);
}

function getBrowserRelevanceBlockReason(
  testCase: any
): string | null {
  const wantedArea =
    inferBrowserCaseArea(testCase);

  const selectedArea =
    inferBrowserRouteArea(testCase.startRoute);

  /**
   * V1 is conservative:
   * unknown intent or unknown route area is not rejected.
   */
  if (!wantedArea || !selectedArea) {
    return null;
  }

  if (
    areBrowserAreasCompatible(
      wantedArea,
      selectedArea
    )
  ) {
    return null;
  }

  return (
    `Browser relevance gate rejected ` +
    `${testCase.id || "case"}: ` +
    `expected area=${wantedArea}, ` +
    `selected area=${selectedArea}, ` +
    `route=${testCase.startRoute}`
  );
}

function isComplexDropdownCase(testCase: any): boolean {
  const text = getBrowserCaseText(testCase);

  const mentionsDropdown =
    text.includes("dropdown") ||
    text.includes("selector") ||
    text.includes("select issue") ||
    text.includes("last item") ||
    text.includes("scrollable") ||
    text.includes("scroll inside");

  const mentionsProjectOrSelection =
    text.includes("project") ||
    text.includes("select") ||
    text.includes("selection");

  return mentionsDropdown && mentionsProjectOrSelection;
}

function isMenuOrFilterCase(testCase: any): boolean {
  const text = getBrowserCaseText(testCase);

  return (
    text.includes("filter") ||
    text.includes("filters") ||
    text.includes("sort") ||
    text.includes("sorting") ||
    text.includes("dropdown") ||
    text.includes("menu") ||
    text.includes("newest") ||
    text.includes("latest") ||
    text.includes("oldest") ||
    text.includes("processed by") ||
    text.includes("paid on") ||
    text.includes("work period") ||
    text.includes("submit by") ||
    text.includes("approved by")
  );
}

function buildManualRequiredNotesForFailedAssertions(
  notes: string[],
  testCase: any
): string[] {
  const caseText = getBrowserCaseText(testCase);

  if (isMenuOrFilterCase(testCase)) {
    const reason =
      "One or more assertions failed in a menu/filter/sort/dropdown or deep-detail UI case. Manual verification is required before treating this as a product bug.";

    if (caseText.includes("filter") || caseText.includes("sort")) {
      return [
        ...notes,
        reason,
        "Generic browser runner may not have opened the correct nested filter/sort menu or dropdown options.",
      ];
    }

    return [...notes, reason];
  }

  return [
    ...notes,
    "One or more assertions failed after a generic browser action limitation. Manual verification is required before treating this as a product bug.",
  ];
}

async function isBrowserTextVisible(
  page: Page,
  text: string
): Promise<boolean> {
  const normalized =
    String(text || "").trim();

  if (!normalized) {
    return false;
  }

  const regex = new RegExp(
    escapeRegExp(normalized)
      .replace(/\\\s+/g, "\\s+"),
    "i"
  );

  /*
   * Search the active drawer/dialog first. A hidden duplicate
   * elsewhere in the DOM must not make a visible assertion
   * fail merely because it is the locator's first match.
   */
  const scopes = [
    page.getByRole("dialog"),

    page.locator(
      '[data-radix-dialog-content]'
    ),

    page.locator(
      '[data-state="open"]'
    ),

    page.locator(
      [
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
      ].join(", ")
    ),

    page.locator("main"),

    page.locator("body"),
  ];

  for (const scope of scopes) {
    const matches =
      scope.getByText(regex);

    const count = Math.min(
      await matches
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const visible =
        await matches
          .nth(index)
          .isVisible()
          .catch(() => false);

      if (visible) {
        return true;
      }
    }
  }

  return false;
}

async function runGenericBrowserSteps(
  page: Page,
  testCase: any,
  captureCheckpoint?:
    BrowserCheckpointCapture,
  registerDeferredCleanup?:
    (
cleanup: DeferredCleanup
    ) => void
): Promise<BrowserStepResult> {
  const steps = testCase.steps as BrowserStep[] | undefined;
  const notes: string[] = [];

  const deterministicEvidence:
    BrowserDeterministicEvidence[] = [];

  if (!Array.isArray(steps) || steps.length === 0) {
    const note =
      "No structured browser steps provided. Screenshot-only browser cases require manual verification.";
    console.log(` Generic browser steps: ${note}`);

    return {
      status: "MANUAL_REQUIRED",
      reasonCategory: "NO_STRUCTURED_STEPS",
      notes: [note],
    };
  }

  let hasAssertion = false;
  let hasAcceptanceAssertion = false;
  let hasPositiveAcceptanceAssertion = false;
  let hasFailedAssertion = false;
  let needsManualVerification = false;
  let hasActionLimitation = false;

  const caseText = getBrowserCaseText(testCase);

const permissionRelevantSuccessCriteria =
  String(
    testCase?.successCriteria || ""
  )
    .split(
      /(?:[.!?]\s+|\n+)/
    )
    .filter(
      (sentence) =>
        !/\bmanual(?:_required|\s+required)\b/i.test(
          sentence
        )
    )
    .join(" ");

const permissionRelevantCaseText = [
  String(testCase?.goal || ""),
  permissionRelevantSuccessCriteria,
  ...steps.map(
    (step: any) =>
      [
        String(step?.action || ""),
        String(step?.text || ""),
      ].join(" ")
  ),
]
  .join(" ")
  .toLowerCase();

const isPermissionSensitiveCase = [
  "permission",
  "has permission",
  "without permission",
  "with permission",
  "lacks permission",
  "can directly",
  "cannot directly",
  "allowed to",
  "not allowed to",
].some(
  (phrase) =>
    permissionRelevantCaseText.includes(
      phrase
    )
);

  function isSanityAssertionText(
    value: string
  ): boolean {
    const normalized = value
      .trim()
      .toLowerCase();

    return [
      "undefined",
      "null",
      "nan",
      "[object object]",
      "something went wrong",
      "unexpected error",
    ].includes(normalized);
  }

  const requiresPanelOrModal =
    caseText.includes("modal") ||
    caseText.includes("details") ||
    caseText.includes("detail") ||
    caseText.includes("panel") ||
    caseText.includes("review") ||
    caseText.includes("upload") ||
    caseText.includes("reupload") ||
    caseText.includes("dialog") ||
    caseText.includes("form") ||
    caseText.includes("wizard") ||
    caseText.includes("step") ||
    caseText.includes("attached");

  async function tryOpenLikelyFallback(reason: string) {
    if (!requiresPanelOrModal) return;

    const note =
      `${reason}: skipped ambiguous fallback; ` +
      `no unrelated panel or item was clicked`;

    notes.push(note);
    console.log(` Generic browser step ${note}`);

    hasActionLimitation = true;
  }

  async function findVisibleActionsButton():
    Promise<Locator | null> {
    const candidates =
      page.getByRole("button", {
        name: /actions/i,
      });

    const count = Math.min(
      await candidates
        .count()
        .catch(() => 0),
      5
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const candidate =
        candidates.nth(index);

      const visible = await candidate
        .isVisible()
        .catch(() => false);

      if (visible) {
        return candidate;
      }
    }

    return null;
  }

  async function captureVisibleActionsSurfaces(
    actionButton: Locator
  ): Promise<string[]> {
    return actionButton
      .evaluate((buttonElement) => {
        if (
          !(buttonElement instanceof HTMLElement)
        ) {
          return [];
        }

        const anchor =
          buttonElement.getBoundingClientRect();

        const descriptors: string[] = [];

        const elements =
          Array.from(
            document.querySelectorAll<HTMLElement>(
              "body *"
            )
          );

        for (const element of elements) {
          if (
            element === buttonElement ||
            buttonElement.contains(element) ||
            element.contains(buttonElement)
          ) {
            continue;
          }

          const role =
            element.getAttribute("role") ||
            "";

          const dataState =
            element.getAttribute("data-state") ||
            "";

          const className =
            typeof element.className === "string"
              ? element.className
              : "";

          const style =
            window.getComputedStyle(element);

          const knownMenuSignal =
            [
              "menu",
              "menuitem",
              "listbox",
              "option",
            ].includes(role) ||
            dataState === "open" ||
            /menu|popover|dropdown|popup|popper/i
              .test(className);

          const floatingPosition =
            style.position === "absolute" ||
            style.position === "fixed";

          if (
            !knownMenuSignal &&
            !floatingPosition
          ) {
            continue;
          }

          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            continue;
          }

          const rect =
            element.getBoundingClientRect();

          if (
            rect.width < 20 ||
            rect.height < 20 ||
            rect.width > 700 ||
            rect.height > 900
          ) {
            continue;
          }

          const text =
            element.innerText
              .replace(/\s+/g, " ")
              .trim();

          if (!text) {
            continue;
          }

          const interactiveCount =
            element.querySelectorAll(
              [
                "button",
                "a",
                '[role="button"]',
                '[role="menuitem"]',
                '[role="option"]',
              ].join(", ")
            ).length;

          const elementIsInteractive =
            [
              "menuitem",
              "option",
            ].includes(role);

          if (
            interactiveCount === 0 &&
            !elementIsInteractive
          ) {
            continue;
          }

          const horizontalGap =
            Math.max(
              0,
              rect.left - anchor.right,
              anchor.left - rect.right
            );

          const verticalGap =
            Math.max(
              0,
              rect.top - anchor.bottom,
              anchor.top - rect.bottom
            );

          if (
            horizontalGap > 300 ||
            verticalGap > 300
          ) {
            continue;
          }

          descriptors.push(
            [
              role || "no-role",
              dataState || "no-state",
              style.position,
              Math.round(rect.left),
              Math.round(rect.top),
              Math.round(rect.width),
              Math.round(rect.height),
              text.slice(0, 250),
            ].join("|")
          );
        }

        return descriptors;
      })
      .catch(() => []);
  }

  async function controlledActionsSurfaceIsVisible(
    actionButton: Locator
  ): Promise<boolean> {
    return actionButton
      .evaluate((buttonElement) => {
        if (
          !(buttonElement instanceof HTMLElement)
        ) {
          return false;
        }

        const controlledId =
          buttonElement.getAttribute(
            "aria-controls"
          ) ||
          buttonElement.getAttribute(
            "aria-owns"
          );

        if (!controlledId) {
          return false;
        }

        const controlled =
          document.getElementById(
            controlledId
          );

        if (
          !(controlled instanceof HTMLElement)
        ) {
          return false;
        }

        const style =
          window.getComputedStyle(
            controlled
          );

        const rect =
          controlled.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width >= 20 &&
          rect.height >= 20
        );
      })
      .catch(() => false);
  }

  async function prepareActionsMenuForAssertion(
    assertedText: string
  ): Promise<{
    ok: boolean;
    note: string;
  } | null> {
    const normalizedText =
      String(assertedText || "")
        .trim()
        .toLowerCase();

    if (
      normalizedText !==
        "request publish"
    ) {
      return null;
    }

    /*
     * Close stale menus first so that the verification
     * always measures the state created by this click.
     */
    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    await page.waitForTimeout(200);

    const actionButton =
      await findVisibleActionsButton();

    if (!actionButton) {
      return {
        ok: false,
        note:
          "visible Actions button could not be found",
      };
    }

    const surfacesBefore =
      await captureVisibleActionsSurfaces(
        actionButton
      );

    try {
      await actionButton
        .scrollIntoViewIfNeeded({
          timeout: 1000,
        });

      await actionButton.click({
        timeout: 1500,
      });
    } catch {
      return {
        ok: false,
        note:
          "Actions button was visible but could not be clicked safely",
      };
    }

    await page.waitForTimeout(600);

    const expanded =
      await actionButton
        .getAttribute("aria-expanded")
        .catch(() => null);

    const controlledSurfaceVisible =
      await controlledActionsSurfaceIsVisible(
        actionButton
      );

    const surfacesAfter =
      await captureVisibleActionsSurfaces(
        actionButton
      );

    const newSurfaces =
      surfacesAfter.filter(
        (surface) =>
          !surfacesBefore.includes(
            surface
          )
      );

    const verified =
      expanded === "true" ||
      controlledSurfaceVisible ||
      newSurfaces.length > 0;

    console.log(
      " Actions menu verification: " +
        `aria-expanded=${expanded || "none"}, ` +
        `controlled-visible=${controlledSurfaceVisible}, ` +
        `surfaces-before=${surfacesBefore.length}, ` +
        `surfaces-after=${surfacesAfter.length}, ` +
        `new-surfaces=${newSurfaces.length}`
    );

    if (!verified) {
      console.log(
        " Actions menu verification surfaces: " +
          JSON.stringify(
            surfacesAfter.slice(0, 5)
          )
      );

      return {
        ok: false,
        note:
          "clicked Actions but no newly opened menu surface was verified",
      };
    }

    return {
      ok: true,
      note:
        "opened and verified Actions menu for Request Publish assertion",
    };
  }

  for (
    let stepOffset = 0;
    stepOffset < steps.length;
    stepOffset += 1
  ) {
    const step = steps[stepOffset];

    if (!step) {
      continue;
    }

    const stepIndex = stepOffset + 1;

    /*
     * Prevent one entity interaction from leaking its
     * identity into a later unrelated checkpoint.
     */
    delete testCase.runtimeEvidenceIdentity;

    if (step.action === "wait") {
      await page.waitForTimeout(step.ms);
      notes.push(`wait ${step.ms}ms`);
      continue;
    }

    if (step.action === "setViewport") {
      await page.setViewportSize({
        width: step.width,
        height: step.height,
      });

      await page.waitForTimeout(1000);

      const note = `setViewport ${step.width}x${step.height}`;
      notes.push(note);
      console.log(` Generic browser step ${note}`);

      continue;
    }

    if (
      step.action ===
      "selectRuntimeTopTab"
    ) {
      const result =
        await selectRuntimeTopTab(
          page
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: a safe inactive ` +
            `main-content tab could not be ` +
            `discovered, selected and verified; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickTopTab") {
      const result = await clickSmartText(page, step.text);

      notes.push(result.note);
      console.log(` Generic browser step ${result.note}`);

      if (!result.ok) {
        hasActionLimitation = true;

        await tryOpenLikelyFallback(
          `fallback after clickTopTab "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite tab action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

await page.waitForTimeout(1000);

await captureCheckpoint?.({
  stepIndex,
  step,
  note: result.note,
});

continue;
    }

    if (
      step.action ===
      "createDraftJobAndVerifyRedirect"
    ) {
      const result =
        await createDraftJobAndVerifyRedirect(
          page,
          {
            caseId: String(
              testCase.id || "browser"
            ),
            origin: step.origin,
          }
        );

      if (result.deferredCleanup) {
        registerDeferredCleanup?.(
          result.deferredCleanup
        );
      }

      const resultNote =
        result.status === "PASS"
          ? result.note
          : `${result.status}: ${result.reasonCategory}: ${result.note}`;

      notes.push(resultNote);

      console.log(
        ` Draft job browser interaction: ` +
          resultNote
      );

      if (result.status !== "PASS") {
        return {
          status: result.status,
          reasonCategory:
            result.reasonCategory,
          notes,
          deterministicEvidence,
        };
      }

      await page.waitForTimeout(750);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickButton") {
      const result = await clickSmartButton(page, step.text);

      notes.push(result.note);
      console.log(` Generic browser step ${result.note}`);

      if (!result.ok) {
        hasActionLimitation = true;

        await tryOpenLikelyFallback(
          `fallback after clickButton "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite button action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

      await page.waitForTimeout(1000);
      continue;
    }

    if (step.action === "openMenu") {
      const result = await openSmartMenu(
        page,
        step.text
      );

      notes.push(result.note);
      console.log(
        ` Generic browser step ${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: menu trigger "${step.text}" ` +
            `could not be opened and verified; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

      await page.waitForTimeout(500);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (
      step.action ===
      "openRuntimeControl"
    ) {
      const result =
        await openRuntimeControl(
          page,
          step.target
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      deterministicEvidence.push({
        stepIndex,
        action: "openRuntimeControl",
        expected:
          `Open interactive control ` +
          `"${step.target}" and verify its ` +
          `expanded surface`,
        passed: result.ok,
        note: result.note,
      });

      if (!result.ok) {
        notes.push(
          `manual required: runtime control ` +
            `"${step.target}" could not be ` +
            `opened with a deterministic ` +
            `expanded-surface signal; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (
      step.action ===
      "selectRuntimeFilterOption"
    ) {
      const result =
        await selectRuntimeFilterOption(
          page,
          step.queryKey,
          step.hint
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ` +
          `${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: a safe runtime ` +
            `filter option for query key ` +
            `"${step.queryKey}" could not be ` +
            `selected with a verified URL ` +
            `transition; remaining assertions ` +
            `were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
        };
      }

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "selectOption") {
      const result = await selectSmartOption(
        page,
        step.text
      );

      notes.push(result.note);
      console.log(
        ` Generic browser step ${result.note}`
      );

      if (!result.ok) {
        notes.push(
          `manual required: menu option "${step.text}" ` +
            `could not be selected safely; remaining ` +
            `assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

      await page.waitForTimeout(500);

      await captureCheckpoint?.({
        stepIndex,
        step,
        note: result.note,
      });

      continue;
    }

    if (step.action === "clickProjectDropdown") {
      const clicked = await clickProjectDropdown(page);

      if (clicked) {
        notes.push("clicked project dropdown");
      } else {
        notes.push("manual required: could not open project dropdown reliably");
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "selectLastDropdownOption") {
      const selected = await selectLastDropdownOption(page);

      if (selected) {
        notes.push("selected last dropdown option");
      } else {
        notes.push(
          "manual required: could not reliably scroll/select/verify the last dropdown option"
        );
        hasActionLimitation = true;
        needsManualVerification = true;
      }

      continue;
    }

    if (step.action === "clickText") {
      if (
        isInvoiceRowClickRequest(
          testCase,
          step.text
        )
      ) {
        const invoiceResult =
          await resolveAndOpenInvoiceRow(
            page,
            testCase,
            step.text
          );

        notes.push(invoiceResult.note);

        console.log(
          ` Invoice browser interaction: ` +
            invoiceResult.note
        );

        if (
          invoiceResult.status ===
          "OPENED"
        ) {
          deterministicEvidence.push({
            stepIndex,
            action:
              "resolveRuntimeInvoiceFixture",
            expected:
              `Open an invoice from required ` +
              `table view=${
                invoiceResult
                  .requiredTableView ||
                "current"
              }`,
            passed: true,
            note:
              `requested=${
                invoiceResult
                  .requestedInvoice ||
                "none"
              }; selected=${
                invoiceResult
                  .selectedInvoice
              }; requiredView=${
                invoiceResult
                  .requiredTableView ||
                "current"
              }; selectedView=${
                invoiceResult
                  .selectedTableView ||
                "current"
              }; exactMatch=${
                invoiceResult
                  .exactInvoiceMatched
              }`,
          });

          await page.waitForTimeout(700);

          /*
           * Screenshot only. No drawer scrolling, DOM
           * mutation or React-controlled interaction.
           */
          await captureCheckpoint?.({
            stepIndex,
            step,
            note:
              `${invoiceResult.note}; ` +
              `invoice drawer opened`,
          });

          continue;
        }

        if (
          invoiceResult.status ===
          "TEST_DATA_ISSUE"
        ) {
          return {
            status: "BLOCKED",
            reasonCategory:
              "TEST_DATA_ISSUE",
            notes,
          };
        }

        hasActionLimitation = true;
        needsManualVerification = true;

        notes.push(
          `manual required: invoice prerequisite state was not reached; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

      if (
        isChangeRequestRowDetailClickRequest(
          testCase,
          step.text
        )
      ) {
        const expectedDetailTexts =
          steps
            .slice(stepOffset + 1)
            .flatMap(
              (candidateStep) =>
                candidateStep.action ===
                "assertTextVisible"
                  ? [
                      candidateStep.text,
                    ]
                  : []
            )
            .filter(
              (text) =>
                !isSanityAssertionText(
                  text
                )
            );

        const rowDetailResult =
          await openMatchingTableRowDetail(
            page,
            step.text,
            expectedDetailTexts
          );

        notes.push(
          rowDetailResult.note
        );

        console.log(
          ` Change-request row interaction: ` +
            rowDetailResult.note
        );

        if (!rowDetailResult.ok) {
          notes.push(
            `manual required: matching ` +
              `change-request row detail ` +
              `could not be opened and ` +
              `verified; remaining ` +
              `assertions were skipped`
          );

          return {
            status:
              "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
            deterministicEvidence,
          };
        }

        await captureCheckpoint?.({
          stepIndex,
          step,
          note:
            rowDetailResult.note,
        });

        continue;
      }

      const clickCaseText = [
        String(testCase?.goal || ""),
        String(
          testCase?.successCriteria || ""
        ),
        JSON.stringify(
          testCase?.steps ?? []
        ),
      ]
        .join(" ")
        .toLowerCase()
        .replace(/[-_]+/g, " ");

      const requiresContentScopedClick =
        clickCaseText.includes(
          "job wizard"
        );

      const result =
        await clickSmartText(
          page,
          step.text,
          {
            allowGlobalNavigationFallback:
              !requiresContentScopedClick,
          }
        );

      notes.push(result.note);

      console.log(
        ` Generic browser step ${result.note}`
      );

      if (!result.ok) {
        hasActionLimitation = true;

        await tryOpenLikelyFallback(
          `fallback after clickText "${step.text}"`
        );

        notes.push(
          `manual required: prerequisite text action failed; ` +
            `remaining assertions were skipped`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
        };
      }

      await page.waitForTimeout(1000);
      continue;
    }

    if (step.action === "reload") {
      const beforeUrl = page.url();

      try {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        await page
          .waitForLoadState(
            "networkidle",
            { timeout: 5000 }
          )
          .catch(() => undefined);

        await page.waitForTimeout(500);
      } catch (error: any) {
        const note =
          `manual required: page reload could not ` +
          `be completed safely: ${String(
            error?.message || error
          )}`;

        notes.push(note);

        console.log(
          ` Generic browser step ${note}`
        );

        return {
          status: "MANUAL_REQUIRED",
          reasonCategory:
            "AUTOMATION_LIMITATION",
          notes,
          deterministicEvidence,
        };
      }

      const note =
        `reloaded page: ${beforeUrl} -> ` +
        `${page.url()}`;

      notes.push(note);

      console.log(
        ` Generic browser step ${note}`
      );

      await captureCheckpoint?.({
        stepIndex,
        step,
        note,
      });

      continue;
    }

    if (
      step.action === "assertUrlContains" ||
      step.action === "assertUrlNotContains"
    ) {
      hasAssertion = true;
      hasAcceptanceAssertion = true;

      if (
        step.action === "assertUrlContains"
      ) {
        hasPositiveAcceptanceAssertion =
          true;
      }

      const expected =
        String(step.text || "").trim();

      const actualUrl = page.url();

      let decodedUrl = actualUrl;

      try {
        decodedUrl =
          decodeURIComponent(actualUrl);
      } catch {
        decodedUrl = actualUrl;
      }

      const containsExpected =
        expected.length > 0 &&
        (
          actualUrl.includes(expected) ||
          decodedUrl.includes(expected)
        );

      const passed =
        step.action === "assertUrlContains"
          ? containsExpected
          : expected.length > 0 &&
            !containsExpected;

      const assertionLabel =
        step.action === "assertUrlContains"
          ? "contains"
          : "does not contain";

      const note =
        `assert URL ${assertionLabel} ` +
        `"${expected}": ` +
        `${passed ? "PASS" : "FAIL"} ` +
        `(actual: ${actualUrl})`;

      deterministicEvidence.push({
        stepIndex,
        action: step.action,
        expected,
        actualUrl,
        passed,
        note,
      });

      notes.push(note);

      console.log(
        ` Generic browser assertion ${note}`
      );

      if (!passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (step.action === "assertTextVisible") {
      hasAssertion = true;

      if (
        !isSanityAssertionText(
          step.text
        )
      ) {
        hasAcceptanceAssertion = true;
        hasPositiveAcceptanceAssertion = true;
      }

      const actionsMenuResult =
        await prepareActionsMenuForAssertion(
          step.text
        );

      if (actionsMenuResult) {
        notes.push(
          actionsMenuResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${actionsMenuResult.note}`
        );

        if (!actionsMenuResult.ok) {
          notes.push(
            "manual required: Actions menu prerequisite " +
              "could not be verified; assertion was skipped"
          );

          return {
            status: "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
          };
        }
      }

let visible =
  await isBrowserTextVisible(
    page,
    step.text
  );

let semanticVisibilitySignal = "";

if (
  !visible &&
  isAssessmentLanguageModalCase(
    testCase
  ) &&
  /^select proficiency level$/i.test(
    String(step.text || "").trim()
  )
) {
  const proficiencyLabelVisible =
    await isBrowserTextVisible(
      page,
      "Proficiency Level"
    );

  const visibleCefrOptionCount =
    await page
      .locator("button:visible")
      .filter({
        hasText:
          /^(A1|A2|B1|B2|C1|C2)$/i,
      })
      .count()
      .catch(() => 0);

  if (
    proficiencyLabelVisible &&
    visibleCefrOptionCount >= 6
  ) {
    visible = true;

    semanticVisibilitySignal =
      " (populated proficiency control; " +
      "visible A1-C2 scale)";
  }
}


if (
  !visible &&
  /^document requirement$/i.test(
    String(step.text || "").trim()
  ) &&
  caseText.includes("work setup") &&
  /\/company\/(?:all-)?work-setups(?:[/?#]|$)/i.test(
    page.url()
  )
) {
  const workSetupsTable = page
    .locator("table:visible")
    .first();

  const documentHeaderVisible =
    await workSetupsTable
      .getByText(/^Document$/i)
      .first()
      .isVisible({
        timeout: 500,
      })
      .catch(() => false);

  const requirementValues =
    workSetupsTable.getByText(
      /^(Required|Not required)$/i
    );

  const requirementValueCount =
    Math.min(
      await requirementValues
        .count()
        .catch(() => 0),
      20
    );

  let visibleRequirementValueCount = 0;

  for (
    let index = 0;
    index < requirementValueCount;
    index += 1
  ) {
    const valueVisible =
      await requirementValues
        .nth(index)
        .isVisible()
        .catch(() => false);

    if (valueVisible) {
      visibleRequirementValueCount += 1;
    }
  }

  if (
    documentHeaderVisible &&
    visibleRequirementValueCount > 0
  ) {
    visible = true;

    semanticVisibilitySignal =
      " (Document column with visible " +
      "Required/Not required indicator)";
  }
}

let scrollAwareResult:
        Awaited<
          ReturnType<
            typeof findTextInOpenDetailSurface
          >
        > | null = null;

      if (!visible) {
        scrollAwareResult =
          await findTextInOpenDetailSurface(
            page,
            step.text
          );

        notes.push(
          scrollAwareResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${scrollAwareResult.note}`
        );

        if (
          scrollAwareResult.visible
        ) {
          visible = true;

          await captureCheckpoint?.({
            stepIndex,
            step,
            note:
              scrollAwareResult.note,
          });
        }
      }

      const scrollSignal =
        scrollAwareResult?.visible
          ? ` (scroll-aware detail surface)`
          : "";

      const note = `assert visible "${step.text}": ${
        visible ? "PASS" : "FAIL"
}${scrollSignal}${semanticVisibilitySignal}`;

      deterministicEvidence.push({
        stepIndex,
        action: "assertTextVisible",
        expected:
          `Text is visible: ${step.text}`,
        passed: visible,
        note,
      });

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!visible) {
        hasFailedAssertion = true;
      }

      continue;
    }

    if (step.action === "assertTextNotVisible") {
      hasAssertion = true;

      if (
        !isSanityAssertionText(
          step.text
        )
      ) {
        hasAcceptanceAssertion = true;
      }

      const actionsMenuResult =
        await prepareActionsMenuForAssertion(
          step.text
        );

      if (actionsMenuResult) {
        notes.push(
          actionsMenuResult.note
        );

        console.log(
          ` Generic browser step ` +
            `${actionsMenuResult.note}`
        );

        if (!actionsMenuResult.ok) {
          notes.push(
            "manual required: Actions menu prerequisite " +
              "could not be verified; assertion was skipped"
          );

          return {
            status: "MANUAL_REQUIRED",
            reasonCategory:
              "AUTOMATION_LIMITATION",
            notes,
          };
        }
      }

      const visible =
        await isBrowserTextVisible(
          page,
          step.text
        );

      const passed = !visible;
      const note = `assert not visible "${step.text}": ${
        passed ? "PASS" : "FAIL"
      }`;

      deterministicEvidence.push({
        stepIndex,
        action:
          "assertTextNotVisible",
        expected:
          `Text is not visible: ${step.text}`,
        passed,
        note,
      });

      notes.push(note);
      console.log(` Generic browser assertion ${note}`);

      if (!passed) {
        hasFailedAssertion = true;
      }

      continue;
    }

    notes.push(`manual required: unsupported browser step "${(step as any).action}"`);
    needsManualVerification = true;
  }

  if (
  needsManualVerification ||
  (isComplexDropdownCase(testCase) && hasActionLimitation)
) {
  return {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    notes,
  };
}


  const hasFailedDeterministicUrlAssertion =
    deterministicEvidence.some(
      (evidence) => !evidence.passed
    );

  if (hasFailedAssertion) {
    if (
      !hasFailedDeterministicUrlAssertion &&
      (
        hasActionLimitation ||
        requiresPanelOrModal ||
        isMenuOrFilterCase(testCase)
      )
    ) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory: "AUTOMATION_LIMITATION",
        notes: buildManualRequiredNotesForFailedAssertions(notes, testCase),
      };
    }

    return {
      status: "FAIL",
      reasonCategory:
        hasFailedDeterministicUrlAssertion
          ? "DETERMINISTIC_URL_ASSERTION_FAILED"
          : "PRODUCT_ASSERTION_FAILED",
      notes,
      deterministicEvidence,
    };
  }

  if (hasAssertion) {
    if (!hasAcceptanceAssertion) {
      notes.push(
        "manual required: only sanity assertions passed; " +
          "no acceptance-level product behavior was verified"
      );

      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "SANITY_ONLY_ASSERTIONS",
        notes,
      };
    }

    if (isPermissionSensitiveCase) {
      notes.push(
        "manual required: the case depends on a specific " +
          "permission fixture that the current browser persona " +
          "does not explicitly verify"
      );

      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "UNVERIFIED_PERMISSION_FIXTURE",
        notes,
      };
    }

    return {
      status: "PASS",
      reasonCategory:
        deterministicEvidence.length > 0
          ? "DETERMINISTIC_URL_ASSERTIONS_PASSED"
          : hasPositiveAcceptanceAssertion
            ? "ACCEPTANCE_ASSERTIONS_PASSED"
            : "NEGATIVE_ACCEPTANCE_ASSERTIONS_PASSED",
      notes,
      deterministicEvidence,
    };
  }

  return {
    status: "MANUAL_REQUIRED",
    reasonCategory: "NO_EXPLICIT_ASSERTIONS",
    notes: [
      ...notes,
      "No explicit assertions were executed. Manual verification is required.",
    ],
  };
}

function cleanJsonFileContent(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

async function resetBrowserStateOnAppOrigin(page: Page, baseUrl: string) {
  const loginUrl = `${baseUrl}/account/login`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page
    .evaluate(async () => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      const dbs = await window.indexedDB.databases();
      dbs.forEach((db) => {
        if (db.name) window.indexedDB.deleteDatabase(db.name);
      });
    })
    .catch(() => {});
  await page.goto(loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  /*
   * The login application may keep analytics,
   * Firebase, SSE or other long-lived requests open.
   * Authentication only requires the app origin and
   * DOM to be available; networkidle is best-effort.
   */
  await page.waitForTimeout(500);

  await page
    .waitForLoadState(
      "networkidle",
      {
        timeout: 5000,
      }
    )
    .catch(() => {
      console.log(
        " Auth reset login page remained network-active; " +
          "continuing after DOMContentLoaded."
      );
    });
}

async function signInAsPersona(
  page: Page,
  baseUrl: string,
  persona: BrowserPersona
) {
  await resetBrowserStateOnAppOrigin(page, baseUrl);

  const customToken = await createCustomToken(persona);

  await page.evaluate(
    async ({ customToken, apiKey, authDomain, projectId }) => {
      // @ts-ignore
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"!
      );

      // @ts-ignore
      const { getAuth, signInWithCustomToken } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"!
      );

      const app = initializeApp({
        apiKey,
        authDomain,
        projectId,
      });

      await signInWithCustomToken(getAuth(app), customToken);
    },
    {
      customToken,
      apiKey: process.env.VITE_FIREBASE_API_KEY!,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
    }
  );

  await page.waitForTimeout(500);
}

export async function runBrowserCases(
  options: BrowserRunOptions = {}
) {
  console.log("\nSmoke Chrome Test starting...");

  const runtimeContexts =
    options.runtimeContexts ?? {};

  const receivedPersonas =
    Object.keys(runtimeContexts);

  if (receivedPersonas.length > 0) {
    console.log(
      ` Browser runtime handoff received for: ` +
        receivedPersonas.join(", ")
    );
  }
  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const baseUrl = String(
    process.env.QA_BASE_URL ?? config.environments.staging.url
  ).replace(/\/$/, "");

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const plan: TestPlan = JSON.parse(cleanJsonFileContent(planFile));
  const results: any[] = [];

const pendingEvidenceReviews: Array<{
  testCase: any;
  evidenceReviewCase: any;
    currentStatus:
      | "PASS"
      | "FAIL"
      | "MANUAL_REQUIRED";
    currentReasonCategory: string;
    screenshotPath: string;
    checkpointEvidence:
      BrowserEvidenceCheckpoint[];
    deterministicEvidence:
      BrowserDeterministicEvidence[];
    currentUrl: string;
    notes: string[];
  }> = [];

  fs.mkdirSync("qa-results", { recursive: true });
  fs.mkdirSync("qa-results/evidence", { recursive: true });
  fs.mkdirSync("qa-results/videos", { recursive: true });
  if (
    !Array.isArray(plan.browserCases) ||
    plan.browserCases.length === 0
  ) {
    console.log("\nNo browser cases were generated.");
    return results;
  }


  const stagehand = new Stagehand({ env: "LOCAL" });
  await stagehand.init();
  let wsEndpoint = "";

  if (typeof (stagehand as any).connectURL === "function") {
    wsEndpoint = await (stagehand as any).connectURL();
  } else {
    wsEndpoint = (stagehand.context as any).browser().wsEndpoint();
  }

  const browser = await chromium.connectOverCDP({ wsEndpoint });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: "qa-results/videos/",
      size: { width: 1280, height: 720 },
    },
  });

  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.style.width = "20px";
      cursor.style.height = "20px";
      cursor.style.borderRadius = "50%";
      cursor.style.backgroundColor = "rgba(255, 0, 0, 0.5)";
      cursor.style.position = "fixed";
      cursor.style.pointerEvents = "none";
      cursor.style.zIndex = "9999999";
      cursor.style.transform = "translate(-50%, -50%)";
      cursor.style.transition = "transform 0.1s ease";
      document.body.appendChild(cursor);

      const style = document.createElement("style");
      style.innerHTML = `
        @keyframes ripple-effect {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
        .playwright-ripple {
          position: fixed;
          width: 40px;
          height: 40px;
          border: 2px solid red;
          border-radius: 50%;
          pointer-events: none;
          z-index: 9999998;
          animation: ripple-effect 0.6s linear forwards;
        }
      `;
      document.head.appendChild(style);

      window.addEventListener("mousemove", (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      });
      window.addEventListener("mousedown", (e) => {
        cursor.style.transform = "translate(-50%, -50%) scale(0.6)";
        const ripple = document.createElement("div");
        ripple.className = "playwright-ripple";
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
      window.addEventListener("mouseup", () => {
        cursor.style.transform = "translate(-50%, -50%) scale(1)";
      });
    });
  });

  let page = await context.newPage();

  await page.goto(`${baseUrl}/account/login`, { waitUntil: "domcontentloaded" });

  let signedInPersona: BrowserPersona | null = null;

  /*
   * Keep browser authentication stable by grouping route
   * probing cases by persona. This prevents sequences such
   * as talent -> company_admin -> talent.
   */
  const personaOrder: Record<
    BrowserPersona,
    number
  > = {
    talent: 0,
    company_admin: 1,
  };

  const probeCases = [
    ...(plan.browserCases as any[]),
  ].sort((left, right) => {
    const leftPersona =
      String(left?.persona || "") as BrowserPersona;

    const rightPersona =
      String(right?.persona || "") as BrowserPersona;

    return (
      (personaOrder[leftPersona] ?? 99) -
      (personaOrder[rightPersona] ?? 99)
    );
  });

  /*
   * Cases that share the same persona and candidate route
   * list also share the same feature entry route.
   * Probe that entry route only once.
   */
  const runtimeRouteProbeCache =
    new Map<string, string>();

  /*
   * Runtime route-discovery pass:
   * - sign in with the correct persona;
   * - rank up to three codebase/runtime candidates;
   * - navigate to each candidate;
   * - accept only a route whose live page matches the
   *   intended feature area.
   */
  for (const testCase of probeCases) {
    const persona =
      String(testCase.persona || "") as BrowserPersona;

    if (
      !["company_admin", "talent"].includes(
        persona
      )
    ) {
      continue;
    }

    const runtimeResourceContext =
      runtimeContexts[persona];

    if (runtimeResourceContext) {
      testCase.runtimeResourceContext =
        runtimeResourceContext;

      console.log(
        ` Browser runtime handoff attached to ` +
          `${testCase.id} (${persona}):`,
        runtimeResourceContext
      );
    }

    try {
      if (signedInPersona !== persona) {
        console.log(
          ` Runtime route probing persona: ` +
            `${signedInPersona ?? "none"} -> ${persona}`
        );

        await context.clearCookies();
        await signInAsPersona(
          page,
          baseUrl,
          persona
        );

        signedInPersona = persona;
      }

      const resolvedCandidates =
        await resolveBrowserRouteCandidates(
          plan,
          testCase,
          3
        );

      const explicitStartRoute =
        String(
          testCase.startRoute || ""
        ).trim();

      const hasConcreteExplicitStartRoute =
        explicitStartRoute.startsWith("/") &&
        explicitStartRoute.toUpperCase() !==
          "UNKNOWN" &&
        !/{[^}]+}/.test(
          explicitStartRoute
        );

      /*
       * READ_ONLY_JOB_WIZARD_ROUTE_PRIORITY_V1
       *
       * A jobs-list startRoute may be a discovery entry
       * point rather than the actual surface required by
       * a read-only job-wizard case.
       *
       * When the runtime resolver has safely selected the
       * non-mutating wizard route, do not let the broad
       * jobs-list entry route override that result.
       */
      const routeSelectionCaseText = [
        String(testCase?.goal || ""),
        String(
          testCase?.successCriteria || ""
        ),
        JSON.stringify(
          testCase?.steps ?? []
        ),
      ]
        .join(" ")
        .toLowerCase()
        .replace(/[-_]+/g, " ");

      const hasDedicatedJobMutationStep =
        Array.isArray(testCase?.steps) &&
        testCase.steps.some(
          (step: any) =>
            step?.action ===
            "createDraftJobAndVerifyRedirect"
        );

      const explicitRouteIsJobsList =
        new Set([
          "/company/jobs",
          "/company/all-jobs",
        ]).has(
          explicitStartRoute.replace(
            /\/$/,
            ""
          )
        );

const resolverSelectedReadOnlyWizard =
  resolvedCandidates[0] ===
  "/company/jobs/create";

const explicitRouteIsAssessmentsList =
  persona === "company_admin" &&
  explicitStartRoute.replace(
    /\/$/,
    ""
  ) === "/company/assessments";

const runtimeAssessmentDetailRoute =
  resolvedCandidates.find(
    (route) =>
      /^\/company\/assessments\/[^/?#]+(?:\?.*)?$/i.test(
        route
      )
  );

const shouldPreferRuntimeAssessmentDetailRoute =
  persona === "company_admin" &&
  isAssessmentLanguageCase(testCase) &&
  explicitRouteIsAssessmentsList &&
  Boolean(runtimeAssessmentDetailRoute);

const isReadOnlyJobWizardCase =
        persona === "company_admin" &&
        routeSelectionCaseText.includes(
          "job wizard"
        ) &&
        !hasDedicatedJobMutationStep;

const shouldPinExplicitStartRoute =
  hasConcreteExplicitStartRoute &&
  !(
    (
      isReadOnlyJobWizardCase &&
      explicitRouteIsJobsList &&
      resolverSelectedReadOnlyWizard
    ) ||
    shouldPreferRuntimeAssessmentDetailRoute
  );

      /*
       * A concrete route supplied by the plan or a
       * focused canary is an execution constraint,
       * not a weak discovery hint.
       *
       * It is still live-probed, but it must be
       * attempted before inferred catalog routes.
       */
const candidates =
  shouldPinExplicitStartRoute
    ? [
        explicitStartRoute,
        ...resolvedCandidates.filter(
          (route) =>
            route !==
            explicitStartRoute
        ),
      ]
    : shouldPreferRuntimeAssessmentDetailRoute &&
        runtimeAssessmentDetailRoute
      ? [
          runtimeAssessmentDetailRoute,
          ...resolvedCandidates.filter(
            (route) =>
              route !==
              runtimeAssessmentDetailRoute
          ),
        ]
      : resolvedCandidates;

      if (
        shouldPinExplicitStartRoute
      ) {
        console.log(
          ` Runtime route candidates pinned ` +
            `explicit startRoute for ` +
            `${testCase.id}: ` +
            `${explicitStartRoute}`
        );

      } else if (
  shouldPreferRuntimeAssessmentDetailRoute &&
  runtimeAssessmentDetailRoute
) {
  console.log(
    ` Runtime route candidates preferred ` +
      `assessment detail route for ` +
      `${testCase.id}: ` +
      `${explicitStartRoute} -> ` +
      `${runtimeAssessmentDetailRoute}`
  );
      } else if (
        hasConcreteExplicitStartRoute &&
        isReadOnlyJobWizardCase &&
        explicitRouteIsJobsList &&
        resolverSelectedReadOnlyWizard
      ) {
        console.log(
          ` Runtime route candidates preferred ` +
            `read-only job wizard route for ` +
            `${testCase.id}: ` +
            `${explicitStartRoute} -> ` +
            `/company/jobs/create`
        );
      }

      const probeCacheKey = [
        persona,
        inferBrowserCaseArea(testCase) ??
          "unknown",
        ...candidates,
      ].join("|");

      const cachedRoute =
        runtimeRouteProbeCache.get(
          probeCacheKey
        );

      if (cachedRoute) {
        const previousRoute =
          String(
            testCase.startRoute ||
              "UNKNOWN"
          );

        testCase.startRoute =
          cachedRoute;

        delete testCase
          .runtimeRouteDiscoveryFailure;

        console.log(
          ` Runtime browser route cache hit for ` +
            `${testCase.id}: ${previousRoute} -> ` +
            `${cachedRoute}`
        );

        continue;
      }

      const probeResult =
        await probeBrowserRouteCandidates(
          page,
          baseUrl,
          testCase,
          candidates
        );

      if (probeResult.acceptedRoute) {
        runtimeRouteProbeCache.set(
          probeCacheKey,
          probeResult.acceptedRoute
        );

        const previousRoute =
          String(testCase.startRoute || "UNKNOWN");

        testCase.startRoute =
          probeResult.acceptedRoute;

        delete testCase.runtimeRouteDiscoveryFailure;

        console.log(
          ` Runtime browser route selected for ` +
            `${testCase.id}: ${previousRoute} -> ` +
            `${probeResult.acceptedRoute}`
        );
      } else {
        testCase.startRoute = "UNKNOWN";

        const attempts = probeResult.attempts
          .map(
            (attempt) =>
              `${attempt.route}: ${attempt.reason}`
          )
          .join(" | ");

        testCase.runtimeRouteDiscoveryFailure =
          "Runtime browser route discovery exhausted. " +
          (
            attempts
              ? `Attempts: ${attempts}`
              : "No concrete route candidates were available."
          );

        console.log(
          ` Runtime browser route discovery exhausted ` +
            `for ${testCase.id}.`
        );
      }
    } catch (error: any) {
      testCase.startRoute = "UNKNOWN";
      testCase.runtimeRouteDiscoveryFailure =
        "Runtime browser route discovery exhausted. " +
        `Probe error: ${String(
          error?.message || error
        )}`;

      console.log(
        ` Runtime browser route probing error for ` +
          `${testCase.id}: ${String(
            error?.message || error
          )}`
      );
    }
  }

  /*
   * Execute the persona that is already authenticated first.
   * JavaScript sort is stable, so case order inside each
   * persona group is preserved.
   */
  const executionCases = [
    ...(plan.browserCases as any[]),
  ].sort((left, right) => {
    const leftIsCurrent =
      String(left?.persona || "") ===
      signedInPersona;

    const rightIsCurrent =
      String(right?.persona || "") ===
      signedInPersona;

    return Number(rightIsCurrent) -
      Number(leftIsCurrent);
  });

  console.log(
    ` Browser execution starts with authenticated persona: ` +
      `${signedInPersona ?? "none"}`
  );

for (const testCase of executionCases) {
  console.log(`\nTaking photo: [${testCase.id}] - ${testCase.goal}`);

  ensureAssessmentLanguageReadOnlyNavigationStep(
  testCase
);

ensureTalentProfileLanguageNavigationStep(
  testCase
);

ensureAssessmentLanguageEditorNavigationStep(
  testCase
);

ensureJobWizardEmptyStateControlStep(
  testCase
);

  const successSignal =
    buildSuccessSignal(testCase);
    const blockReason = getBrowserBlockReason(testCase);

    if (blockReason) {
      results.push({
        id: testCase.id,
        status: "BLOCKED",
        reasonCategory:
  getBrowserBlockReasonCategory(blockReason),
        startRoute: testCase.startRoute,
        evidence: [
          blockReason,
          `Success signal: ${successSignal}`,
          "Success signal reached: false",
        ].join(" | "),
        successSignal,
        successSignalReached: false,
        evidenceSummary: {
          successSignal,
          successSignalReached: false,
          authWallDetected: false,
          pagesVisited: [],
          keyVisibleTexts: [],
        },
        trace: [
          {
            index: 1,
            action: "block-reason",
            status: "BLOCKED",
            note: blockReason,
          },
        ],
      });

      console.log(` Result: BLOCKED (${blockReason})`);
      continue;
    }

const deferredCleanups:
  DeferredCleanup[] = [];

    let deferredCleanupExecuted =
      false;

        if (page.isClosed()) {
      page = await context.newPage();
    }

    try {
      await page.setViewportSize({ width: 1280, height: 720 });

const persona = testCase.persona as BrowserPersona;

if (signedInPersona !== persona) {
  console.log(
    ` Switching browser persona: ${signedInPersona ?? "none"} -> ${persona}`
  );

  await context.clearCookies();
  await signInAsPersona(page, baseUrl, persona);

  signedInPersona = persona;
} else {
  console.log(` Reusing browser session for persona: ${persona}`);
}

      const targetUrl =
        `${baseUrl}${testCase.startRoute}`;

      let authenticatedRouteReached =
        false;

      for (
        let authAttempt = 1;
        authAttempt <= 3;
        authAttempt += 1
      ) {
        await page.goto(
          targetUrl,
          {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }
        );

        await page.waitForTimeout(1000);

        /*
         * DOMContentLoaded is not enough for React Query /
         * async table data. Wait briefly for pending network
         * requests, without failing the case if the app keeps
         * a long-lived request open.
         */
        await page
          .waitForLoadState(
            "networkidle",
            {
              timeout: 5000,
            }
          )
          .catch(() => {});

        const currentUrl =
          page.url().toLowerCase();

        const redirectedToLogin =
          currentUrl.includes(
            "/account/login"
          ) ||
          currentUrl.endsWith("/login") ||
          currentUrl.includes(
            "/login?"
          );

        if (!redirectedToLogin) {
          authenticatedRouteReached =
            true;

          break;
        }

        console.log(
          ` Auth retry for ${testCase.id}: ` +
            `protected route redirected to login ` +
            `(attempt ${authAttempt}/3).`
        );

        if (authAttempt < 3) {
          await signInAsPersona(
            page,
            baseUrl,
            persona
          );

          signedInPersona = persona;

          await page.waitForTimeout(1000);
        }
      }

      if (!authenticatedRouteReached) {
        throw new Error(
          `Authentication session was not ready for ` +
            `${testCase.id}. Protected route kept ` +
            `redirecting to login after 3 attempts.`
        );
      }

      await logVisibleAssessmentControls(
        page,
        testCase
      );

      await prepareAssessmentLanguageModal(
  page,
  testCase
);

      const pagesVisited = new Set<string>();
    pagesVisited.add(page.url());

    const authWallDetected = await detectAuthWall(page);

    if (authWallDetected) {
      const screenshotPath = `qa-results/evidence/${testCase.id}-auth-wall.png`;

      await page.screenshot({ path: screenshotPath, fullPage: true });

      const keyVisibleTexts = await collectKeyVisibleTexts(page);

      const trace = buildTraceFromBrowserRun({
        targetUrl,
        finalUrl: page.url(),
        notes: [
          "Authentication wall detected. Browser reached a login/auth page instead of the protected feature route.",
        ],
        screenshotPath,
        finalStatus: "BLOCKED",
      });



      const evidenceSummary: BrowserEvidenceSummary = {
        successSignal,
        successSignalReached: false,
        authWallDetected: true,
        pagesVisited: Array.from(pagesVisited),
        keyVisibleTexts,
      };

      results.push({
        id: testCase.id,
        status: "BLOCKED",
        reasonCategory:
          getBrowserBlockReasonCategory(blockReason!),
        startRoute: testCase.startRoute,
        evidence: [
          screenshotPath,
          "Authentication wall detected",
          `Success signal: ${successSignal}`,
          "Success signal reached: false",
          `Pages visited: ${evidenceSummary.pagesVisited.join(", ") || "none"}`,
          `Key visible texts: ${evidenceSummary.keyVisibleTexts.join(", ") || "none"}`,
          `Trace: ${formatTrace(trace)}`,
        ].join(" | "),
        successSignal,
        successSignalReached: false,
        evidenceSummary,
        trace,
      });

      console.log(" Result: BLOCKED (Authentication wall detected)");
      console.log(` Screenshot Taken: ${screenshotPath}`);
      continue;
    }

      const checkpointEvidence:
        BrowserEvidenceCheckpoint[] = [];

      const checkpointDirectory =
        `qa-results/evidence/` +
        `${testCase.id}-checkpoints`;

      fs.rmSync(
        checkpointDirectory,
        {
          recursive: true,
          force: true,
        }
      );

      fs.mkdirSync(
        checkpointDirectory,
        { recursive: true }
      );

      const stepResult =
        await runGenericBrowserSteps(
          page,
          testCase,
          async ({
            stepIndex,
            step,
            note,
          }) => {
            const rawText =
              "text" in step
                ? String(step.text || "")
                : "";

            /*
             * RUNTIME_EVIDENCE_IDENTITY_V1
             *
             * A compatible-state interaction may replace the
             * planner fixture with a runtime-selected entity.
             * Evidence filenames and labels must identify the
             * entity actually opened, while retaining the
             * originally requested identity for auditability.
             */
            const runtimeInvoiceFixture =
              step.action === "clickText" &&
              testCase?.runtimeInvoiceFixture &&
              typeof testCase.runtimeInvoiceFixture ===
                "object"
                ? testCase.runtimeInvoiceFixture
                : null;

            const runtimeSelectedIdentity =
              String(
                runtimeInvoiceFixture?.selectedInvoice ||
                  ""
              ).trim();

            const runtimeRequestedIdentity =
              String(
                runtimeInvoiceFixture?.requestedInvoice ||
                  rawText ||
                  ""
              ).trim();

            const runtimeFixturePolicy =
              String(
                runtimeInvoiceFixture?.policy || ""
              ).trim();

            const runtimeIdentitySubstituted =
              Boolean(
                runtimeSelectedIdentity &&
                  runtimeRequestedIdentity &&
                  runtimeSelectedIdentity.toLowerCase() !==
                    runtimeRequestedIdentity.toLowerCase()
              );

            const runtimeHandoffIdentity =
              String(
                runtimeInvoiceFixture?.handoffInvoice ||
                  testCase
                    ?.runtimeResourceContext
                    ?.invoiceNumber ||
                  ""
              ).trim();

            const runtimeHandoffMatched =
              Boolean(
                runtimeInvoiceFixture
                  ?.handoffInvoiceMatched
              );

            const rawGenericIdentity =
              testCase
                ?.runtimeEvidenceIdentity;

            const rawSelectionSource =
              String(
                rawGenericIdentity
                  ?.selectionSource ||
                  ""
              ).trim();

            const genericSelectionSource:
              BrowserEvidenceIdentity[
                "selectionSource"
              ] =
              [
                "planner",
                "api-handoff",
                "runtime-discovery",
                "step",
              ].includes(
                rawSelectionSource
              )
                ? rawSelectionSource as
                    BrowserEvidenceIdentity[
                      "selectionSource"
                    ]
                : "step";

            /*
             * GENERIC_STRUCTURED_EVIDENCE_IDENTITY_V2
             *
             * Prefer the common adapter contract. The legacy
             * invoice fixture remains a compatibility fallback
             * until all entity resolvers publish this contract.
             */
            const genericCheckpointIdentity:
              BrowserEvidenceIdentity | null =
              rawGenericIdentity &&
              typeof rawGenericIdentity ===
                "object" &&
              String(
                rawGenericIdentity
                  .checkpointAction ||
                  step.action
              ) === step.action &&
              String(
                rawGenericIdentity
                  .runtimeIdentity ||
                  ""
              ).trim()
                ? {
                    entityType:
                      String(
                        rawGenericIdentity
                          .entityType ||
                          "resource"
                      ).trim(),
                    requestedIdentity:
                      String(
                        rawGenericIdentity
                          .requestedIdentity ||
                          ""
                      ).trim() ||
                      null,
                    runtimeIdentity:
                      String(
                        rawGenericIdentity
                          .runtimeIdentity ||
                          ""
                      ).trim(),
                    handoffIdentity:
                      String(
                        rawGenericIdentity
                          .handoffIdentity ||
                          ""
                      ).trim() ||
                      null,
                    substituted:
                      Boolean(
                        rawGenericIdentity
                          .substituted
                      ),
                    policy:
                      String(
                        rawGenericIdentity
                          .policy ||
                          ""
                      ).trim() ||
                      null,
                    selectionSource:
                      genericSelectionSource,
                  }
                : null;

            const checkpointIdentity:
              BrowserEvidenceIdentity | null =
              genericCheckpointIdentity ??
              (
                runtimeSelectedIdentity
                  ? {
                      entityType:
                        "invoice",
                      requestedIdentity:
                        runtimeRequestedIdentity ||
                        null,
                      runtimeIdentity:
                        runtimeSelectedIdentity,
                      handoffIdentity:
                        runtimeHandoffIdentity ||
                        null,
                      substituted:
                        runtimeIdentitySubstituted,
                      policy:
                        runtimeFixturePolicy ||
                        null,
                      selectionSource:
                        runtimeHandoffMatched
                          ? "api-handoff"
                          : runtimeIdentitySubstituted
                            ? "runtime-discovery"
                            : "planner",
                    }
                  : null
              );

            const evidenceRuntimeIdentity =
              checkpointIdentity
                ?.runtimeIdentity ||
              runtimeSelectedIdentity;

            const evidenceIdentityText =
              evidenceRuntimeIdentity
                ? `${
                    checkpointIdentity
                      ?.entityType ||
                    "resource"
                  }-${evidenceRuntimeIdentity}`
                : rawText;

            const safeText = evidenceIdentityText
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 48);

            const filename = [
              String(stepIndex).padStart(
                2,
                "0"
              ),
              step.action,
              safeText,
            ]
              .filter(Boolean)
              .join("-") + ".png";

            const checkpointPath =
              `${checkpointDirectory}/` +
              filename;

            const label =
              checkpointIdentity
                ?.runtimeIdentity
              ? [
                  step.action,
                  checkpointIdentity
                    .requestedIdentity
                    ? `requested=${
                        checkpointIdentity
                          .requestedIdentity
                      }`
                    : "",
                  `runtime=${
                    checkpointIdentity
                      .entityType
                  }:${
                    checkpointIdentity
                      .runtimeIdentity
                  }`,
                  checkpointIdentity
                    .handoffIdentity
                    ? `handoff=${
                        checkpointIdentity
                          .handoffIdentity
                      }`
                    : "",
                  `substituted=${
                    checkpointIdentity
                      .substituted
                  }`,
                  checkpointIdentity.policy
                    ? `policy=${
                        checkpointIdentity
                          .policy
                      }`
                    : "",
                  `source=${
                    checkpointIdentity
                      .selectionSource
                  }`,
                ]
                  .filter(Boolean)
                  .join(" ")
              : rawText
                ? `${step.action} ${rawText}`
                : step.action;

            /*
             * TRANSIENT_SURFACE_CHECKPOINT_V1
             *
             * Full-page screenshots may temporarily scroll or
             * resize the page and close an open menu/popover.
             * Capture transient expanded surfaces using the
             * current viewport so following assertions observe
             * the same UI state.
             */
            const preserveTransientSurface =
              step.action ===
                "openRuntimeControl" ||
              step.action === "openMenu";

            try {
              await page.screenshot({
                path: checkpointPath,
                fullPage:
                  !preserveTransientSurface,
              });

              checkpointEvidence.push({
                stepIndex,
                action: step.action,
                label,
                note,
                screenshotPath:
                  checkpointPath,
                url: page.url(),
                ...(checkpointIdentity
                  ? {
                      identity:
                        checkpointIdentity,
                    }
                  : {}),
              });

              console.log(
                ` Evidence checkpoint captured: ` +
                  `step=${stepIndex}, ` +
                  `action=${label}, ` +
                  `path=${checkpointPath}`
              );
            } catch (error: any) {
              console.log(
                ` Evidence checkpoint skipped safely: ` +
                  `step=${stepIndex}, ` +
                  `action=${label}, ` +
                  `reason=${String(
                    error?.message || error
                  )}`
              );
            }
          },
          (cleanup) => {
deferredCleanups.push(
  cleanup
);
          }
        );

      const passSemanticGuardReason =
        stepResult.status === "PASS"
          ? getBrowserPassSemanticGuardReason({
              testCase,
              finalUrl: page.url(),
            })
          : null;

      if (passSemanticGuardReason) {
        stepResult.status =
          "MANUAL_REQUIRED";

        stepResult.reasonCategory =
          "AUTOMATION_LIMITATION";

        stepResult.notes.push(
          passSemanticGuardReason
        );

        console.log(
          ` Browser PASS semantic guard: ` +
            passSemanticGuardReason
        );
      }
      const screenshotPath =
        `qa-results/evidence/` +
        `${testCase.id}-screenshot.png`;

      /*
       * Preserve the URL and visible page state before
       * the exact created resource is deleted.
       */
      const evidenceUrl = page.url();

      pagesVisited.add(evidenceUrl);

      let keyVisibleTexts: string[] = [];
      let screenshotFailure:
        unknown = null;

      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        keyVisibleTexts =
          await collectKeyVisibleTexts(
            page
          );
      } catch (error: unknown) {
        screenshotFailure = error;
      } finally {
        const cleanupExecution =
await executeDeferredCleanups(
  deferredCleanups
);

        deferredCleanupExecuted = true;

        stepResult.notes.push(
          ...cleanupExecution.notes
        );

        stepResult.deterministicEvidence = [
          ...(
            stepResult
              .deterministicEvidence ??
            []
          ),
          ...cleanupExecution
            .deterministicEvidence,
        ];

        if (!cleanupExecution.ok) {
          stepResult.status = "ERROR";
          stepResult.reasonCategory =
            "CLEANUP_FAILED";

          stepResult.notes.push(
            "ERROR: CLEANUP_FAILED: Browser " +
            "evidence was captured, but one " +
            "or more exact deferred cleanups " +
            "failed."
          );
        }
      }

      if (screenshotFailure) {
        throw screenshotFailure;
      }

      await cancelAssessmentEditIfOpen(
        page,
        testCase
      );

      let evidenceReview: Awaited<
        ReturnType<typeof reviewBrowserEvidence>
      > = null;

      if (
        [
          "PASS",
          "FAIL",
          "MANUAL_REQUIRED",
        ].includes(
          stepResult.status
        )
      ) {
pendingEvidenceReviews.push({
  testCase,
  evidenceReviewCase:
    buildEvidenceReviewCase(
      testCase
    ),
  currentStatus:
            stepResult.status as
              | "PASS"
              | "FAIL"
              | "MANUAL_REQUIRED",
          currentReasonCategory:
            String(
              stepResult.reasonCategory ||
                "BROWSER_ASSERTION_FAILED"
            ),
          screenshotPath,
          checkpointEvidence: [
            ...checkpointEvidence,
          ],
          deterministicEvidence: [
            ...(
              stepResult
                .deterministicEvidence ??
              []
            ),
          ],
          currentUrl: evidenceUrl,
          notes: [
            ...stepResult.notes,
          ],
        });

        console.log(
          stepResult.status === "PASS"
            ? " PASS evidence audit queued for post-processing."
            : " Evidence review queued for post-processing."
        );
      }

      const successSignalReached =
        stepResult.status === "PASS";

      const trace = buildTraceFromBrowserRun({
        targetUrl,
        finalUrl: evidenceUrl,
        notes: stepResult.notes,
        screenshotPath,
        checkpointEvidence,
        finalStatus: stepResult.status,
      });

      const evidenceReviewText = "";

      const evidenceSummary: BrowserEvidenceSummary = {
        successSignal,
        successSignalReached,
        authWallDetected: false,
        pagesVisited: Array.from(pagesVisited),
        keyVisibleTexts,
      };

      console.log(` Screenshot Taken: ${screenshotPath}`);
      console.log(` Result: ${stepResult.status}`);
      console.log(` Success signal reached: ${successSignalReached ? "yes" : "no"}`);

      if (stepResult.notes.length > 0) {
        console.log(` Notes: ${stepResult.notes.join(" | ")}`);
      }

      console.log(` Trace: ${formatTrace(trace)}`);

      results.push({
        id: testCase.id,
        status: stepResult.status,
        reasonCategory: stepResult.reasonCategory,
        evidenceReview,
        startRoute: testCase.startRoute,
        evidence: [
          screenshotPath,
          checkpointEvidence.length > 0
            ? `Evidence checkpoints: ` +
              checkpointEvidence
                .map(
                  (checkpoint) =>
                    `${checkpoint.label}=` +
                    checkpoint.screenshotPath
                )
                .join(", ")
            : "",
          (
            stepResult
              .deterministicEvidence
              ?.length ?? 0
          ) > 0
            ? `Deterministic evidence: ` +
              stepResult
                .deterministicEvidence!
                .map(
                  (item) =>
                    `step ${item.stepIndex} ` +
                    `${item.action} ` +
                    `"${item.expected}"=` +
                    `${
                      item.passed
                        ? "PASS"
                        : "FAIL"
                    } ` +
                    `actual=${
                      item.actualUrl ||
                      "(non-URL machine evidence)"
                    }`
                )
                .join(", ")
            : "",
          `Success signal: ${successSignal}`,
          `Success signal reached: ${successSignalReached}`,
          evidenceReviewText,
          `Pages visited: ${evidenceSummary.pagesVisited.join(", ") || "none"}`,
          `Key visible texts: ${evidenceSummary.keyVisibleTexts.join(", ") || "none"}`,
          stepResult.notes.length > 0 ? `Notes: ${stepResult.notes.join(" | ")}` : "",
          `Trace: ${formatTrace(trace)}`,
        ]
          .filter(Boolean)
          .join(" | "),
        successSignal,
        successSignalReached,
        evidenceSummary,
        checkpointEvidence,
        deterministicEvidence:
          stepResult.deterministicEvidence ??
          [],
        trace,
      });
    } catch (error: any) {
      console.log(` Error: ${error.message}`);
      results.push({
        id: testCase.id,
        status: "ERROR",
        reasonCategory: "AGENT_RUNTIME_ERROR",
        startRoute: testCase.startRoute,
        evidence: error.message,
      });
    } finally {
      /*
       * Last-resort orphan prevention. Normal execution
       * already cleans up after final evidence capture.
       */
      if (
        !deferredCleanupExecuted &&
deferredCleanups.length > 0
      ) {
        const fallbackCleanup =
await executeDeferredCleanups(
  deferredCleanups
);

        deferredCleanupExecuted = true;

        const fallbackResult = [
          ...results,
        ]
          .reverse()
          .find(
            (item: any) =>
              item.id === testCase.id
          );

        if (fallbackResult) {
          fallbackResult.evidence = [
            fallbackResult.evidence,
            ...fallbackCleanup.notes,
          ]
            .filter(Boolean)
            .join(" | ");

          if (!fallbackCleanup.ok) {
            fallbackResult.status = "ERROR";
            fallbackResult.reasonCategory =
              "CLEANUP_FAILED";
            fallbackResult
              .successSignalReached = false;

            if (
              fallbackResult.evidenceSummary
            ) {
              fallbackResult
                .evidenceSummary
                .successSignalReached = false;
            }
          }
        }
      }

      const video = page.video();

      await page.close().catch(() => {});

      const rawVideoPath = video
        ? await video.path().catch(
            () => null
          )
        : null;

      if (rawVideoPath) {
        const issueKey = String(
          plan.issueKey ||
            "unknown-issue"
        );

        const caseVideoPath =
          `qa-results/videos/` +
          `${issueKey}-${testCase.id}.webm`;

        if (
          fs.existsSync(caseVideoPath)
        ) {
          fs.rmSync(caseVideoPath);
        }

        fs.renameSync(
          rawVideoPath,
          caseVideoPath
        );

        const currentResult = [
          ...results,
        ]
          .reverse()
          .find(
            (item: any) =>
              item.id === testCase.id
          );

        if (currentResult) {
          currentResult.videoPath =
            caseVideoPath;

          currentResult.evidence = [
            currentResult.evidence,
            `Video: ${caseVideoPath}`,
          ]
            .filter(Boolean)
            .join(" | ");
        }

        console.log(
          ` Video finalized: ` +
            `${caseVideoPath}`
        );
      }
    }
  }

  await context.close();
  await browser.close();
  await stagehand.close();

  console.log(
    "\nBrowser automation completed."
  );

  if (
    pendingEvidenceReviews.length > 0
  ) {
    console.log(
      "Evidence post-processing starting..."
    );
  }

  for (
    const pendingReview
    of pendingEvidenceReviews
  ) {
    const currentResult = [
      ...results,
    ]
      .reverse()
      .find(
        (item: any) =>
          item.id ===
          pendingReview.testCase.id
      );

    if (!currentResult) {
      continue;
    }

const evidenceReview =
  await reviewBrowserEvidence({
    testCase:
      pendingReview
        .evidenceReviewCase,
        currentStatus:
          pendingReview.currentStatus,
        currentReasonCategory:
          pendingReview
            .currentReasonCategory,
        screenshotPath:
          pendingReview.screenshotPath,
        checkpointEvidence:
          pendingReview.checkpointEvidence,
        deterministicEvidence:
          pendingReview.deterministicEvidence,
        currentUrl:
          pendingReview.currentUrl,
        notes:
          pendingReview.notes,
      });

    if (!evidenceReview) {
      if (
        pendingReview.currentStatus ===
          "PASS"
      ) {
        currentResult.status =
          "MANUAL_REQUIRED";

        currentResult.reasonCategory =
          "PASS_EVIDENCE_UNAVAILABLE";

        currentResult.successSignalReached =
          false;

        if (
          currentResult.evidenceSummary
        ) {
          currentResult
            .evidenceSummary
            .successSignalReached =
              false;
        }

        currentResult.evidence = [
          currentResult.evidence,
          "PASS evidence audit was unavailable; " +
            "manual verification is required.",
        ]
          .filter(Boolean)
          .join(" | ");

        console.log(
          ` Evidence reconciliation: [${pendingReview.testCase.id}] ` +
            "PASS -> MANUAL_REQUIRED " +
            "(screenshot review unavailable)"
        );
      }

      continue;
    }

    currentResult.evidenceReview =
      evidenceReview;

    console.log(
      ` Evidence review: [${pendingReview.testCase.id}] ` +
        `${evidenceReview.verdict} ` +
        `(${evidenceReview.confidence})`
    );

    console.log(
      ` Evidence review rationale: [${pendingReview.testCase.id}] ` +
        `${evidenceReview.rationale}`
    );

    const evidenceReviewText = [
      `Evidence review verdict: ` +
        evidenceReview.verdict,

      `Evidence review confidence: ` +
        evidenceReview.confidence,

      `Evidence review rationale: ` +
        evidenceReview.rationale,

      evidenceReview.visibleEvidence
        .length > 0
        ? `Visible evidence: ` +
          evidenceReview
            .visibleEvidence
            .join("; ")
        : "",

      `Evidence review recommended status: ` +
        evidenceReview
          .recommendedStatus,
    ]
      .filter(Boolean)
      .join(" | ");

    currentResult.evidence = [
      currentResult.evidence,
      evidenceReviewText,
    ]
      .filter(Boolean)
      .join(" | ");

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase:
        pendingReview.testCase,
      review: evidenceReview,
      source: "screenshot",
    });

    /*
     * PASS audits use screenshot evidence only.
     * The video reviewer currently handles only
     * FAIL and MANUAL_REQUIRED cases.
     */
    if (
      pendingReview.currentStatus ===
        "PASS"
    ) {
      console.log(
        " PASS evidence audit completed " +
          "with screenshot evidence only."
      );

      continue;
    }

    if (
      !shouldRunVideoEvidenceReview(
        evidenceReview
      )
    ) {
      continue;
    }

    console.log(
      " Video fallback queued: " +
        `${evidenceReview.verdict} ` +
        `(${evidenceReview.confidence})`
    );

    const videoPath = String(
      currentResult.videoPath || ""
    );

    if (
      !videoPath ||
      !fs.existsSync(videoPath)
    ) {
      console.log(
        " Video fallback skipped: " +
          "case video is unavailable."
      );

      continue;
    }

    const issueKey = String(
      plan.issueKey ||
        "unknown-issue"
    );

    const videoEvidenceReview =
      await reviewBrowserVideoEvidence({
        issueKey,
        testCase:
          pendingReview.testCase,
        currentStatus:
          pendingReview.currentStatus,
        currentReasonCategory:
          pendingReview
            .currentReasonCategory,
        notes:
          pendingReview.notes,
        videoPath,
        checkpointEvidence:
          pendingReview
            .checkpointEvidence,
        screenshotReview:
          evidenceReview,
      });

    if (!videoEvidenceReview) {
      continue;
    }

    currentResult.videoEvidenceReview =
      videoEvidenceReview;

    const videoReviewText = [
      "Video fallback triggered: true",

      `Video review verdict: ` +
        videoEvidenceReview.verdict,

      `Video review confidence: ` +
        videoEvidenceReview.confidence,

      `Video review rationale: ` +
        videoEvidenceReview.rationale,

      videoEvidenceReview
        .resolvedFailures.length > 0
        ? `Resolved failures: ` +
          videoEvidenceReview
            .resolvedFailures
            .join("; ")
        : "Resolved failures: none",

      videoEvidenceReview
        .unresolvedFailures.length > 0
        ? `Unresolved failures: ` +
          videoEvidenceReview
            .unresolvedFailures
            .join("; ")
        : "Unresolved failures: none",

      videoEvidenceReview
        .temporalEvidence.length > 0
        ? `Temporal evidence: ` +
          videoEvidenceReview
            .temporalEvidence
            .join("; ")
        : "",

      `Frame paths: ` +
        videoEvidenceReview
          .framePaths
          .join(", "),

      `Video recommended status: ` +
        videoEvidenceReview
          .recommendedStatus,

      `Resolved by video: ` +
        videoEvidenceReview
          .resolvedByVideo,
    ]
      .filter(Boolean)
      .join(" | ");

    currentResult.evidence = [
      currentResult.evidence,
      videoReviewText,
    ]
      .filter(Boolean)
      .join(" | ");

    reconcileBrowserResultFromEvidence({
      currentResult,
      testCase:
        pendingReview.testCase,
      review: videoEvidenceReview,
      source: "video",
    });

    console.log(
      ` Video evidence review: ` +
        `${videoEvidenceReview.verdict} ` +
        `(${videoEvidenceReview.confidence})`
    );

    console.log(
      ` Video resolved by fallback: ` +
        `${videoEvidenceReview.resolvedByVideo}`
    );
  }

  console.log(
    "\nFinal reconciled browser results:"
  );

  for (const result of results) {
    console.log(
      ` Final browser result: ` +
        `[${String(result.id)}] ` +
        `${String(result.status)}`
    );
  }

  console.log(
    "\nBrowser tests are completed"
  );

  return results;
}
