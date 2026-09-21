import type {
  BrowserStep,
  BrowserStepResult,
} from "./browser-execution-types.js";
import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import {
  buildManualRequiredNotesForFailedAssertions,
  isComplexDropdownCase,
  isMenuOrFilterCase,
} from "./browser-case-relevance.js";

export function isSanityAssertionText(
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

export function isPermissionSensitiveBrowserCase(
  testCase: any,
  steps: BrowserStep[]
): boolean {
  const permissionRelevantSuccessCriteria =
    String(
      testCase?.successCriteria || ""
    )
      .split(
        /(?:[.!?]\s+|\n+)/
      )
      .filter(
        (sentence) =>
          ![
            /\bmanual(?:_required|\s+required)\b/i,
            /\bmanual\s+follow[- ]?up\b/i,
            /\bmanual\s+verification\b/i,
            /\bmanual\s+coverage\b/i,
            /\bchecked separately\b/i,
            /\bmust be checked separately\b/i,
            /\brequires?\s+manual\b/i,
          ].some((pattern) =>
            pattern.test(sentence)
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

  return [
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
}

export function requiresPanelOrModalBrowserCase(
  caseText: string
): boolean {
  return [
    "modal",
    "details",
    "detail",
    "panel",
    "review",
    "upload",
    "reupload",
    "dialog",
    "form",
    "wizard",
    "step",
    "attached",
  ].some(
    (keyword) =>
      caseText.includes(keyword)
  );
}

function isDeterministicAssertionEvidence(
  evidence: BrowserDeterministicEvidence
): boolean {
  return [
    "assertUrlContains",
    "assertUrlNotContains",
    "assertTextVisible",
    "assertSurfaceControls",
    "assertTextNotVisible",
    "assertCollectionFilter",
  ].includes(evidence.action);
}

function hasConflictingAssertionCriticality(
  deterministicEvidence:
    BrowserDeterministicEvidence[]
): boolean {
  const criticalityByOracle =
    new Map<string, Set<string>>();

  for (const evidence of deterministicEvidence) {
    const oracleId = String(
      evidence.oracleId ?? ""
    ).trim();

    if (!oracleId) {
      continue;
    }

    const criticality =
      evidence.acceptanceCritical === false
        ? "false"
        : evidence.acceptanceCritical === true
          ? "true"
          : "unknown";

    const observed =
      criticalityByOracle.get(oracleId) ??
      new Set<string>();

    observed.add(criticality);
    criticalityByOracle.set(
      oracleId,
      observed
    );
  }

  return Array.from(
    criticalityByOracle.values()
  ).some(
    (criticalities) =>
      criticalities.size > 1
  );
}

function onlyExplicitlyNonCriticalAssertionsFailed(
  deterministicEvidence:
    BrowserDeterministicEvidence[]
): boolean {
  const failedEvidence =
    deterministicEvidence.filter(
      (evidence) => !evidence.passed
    );

  return (
    failedEvidence.length > 0 &&
    failedEvidence.every(
      (evidence) =>
        isDeterministicAssertionEvidence(
          evidence
        ) &&
        evidence.acceptanceCritical ===
          false
    ) &&
    !hasConflictingAssertionCriticality(
      deterministicEvidence
    )
  );
}

export function finalizeBrowserStepResult(args: {
  testCase: any;
  notes: string[];
  deterministicEvidence:
    BrowserDeterministicEvidence[];
  hasAssertion: boolean;
  hasAcceptanceAssertion: boolean;
  hasPositiveAcceptanceAssertion: boolean;
  hasFailedAssertion: boolean;
  needsManualVerification: boolean;
  hasActionLimitation: boolean;
  requiresPanelOrModal: boolean;
  isPermissionSensitiveCase: boolean;
}): BrowserStepResult {
  const {
    testCase,
    notes,
    deterministicEvidence,
    hasAssertion,
    hasAcceptanceAssertion,
    hasPositiveAcceptanceAssertion,
    hasFailedAssertion,
    needsManualVerification,
    hasActionLimitation,
    requiresPanelOrModal,
    isPermissionSensitiveCase,
  } = args;

  if (
    needsManualVerification ||
    (
      isComplexDropdownCase(testCase) &&
      hasActionLimitation
    )
  ) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      notes,
      ...(deterministicEvidence.length > 0
        ? { deterministicEvidence }
        : {}),
    };
  }

  const hasFailedDeterministicEvidence =
    deterministicEvidence.some(
      (evidence) => !evidence.passed
    );

  if (hasFailedAssertion) {
    if (
      onlyExplicitlyNonCriticalAssertionsFailed(
        deterministicEvidence
      )
    ) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "NON_CRITICAL_ASSERTION_FAILED",
        notes: [
          ...notes,
          "manual required: only explicitly non-critical " +
            "deterministic assertion evidence failed; " +
            "acceptance behavior was not proven enough " +
            "for PASS",
        ],
        deterministicEvidence,
      };
    }

    if (
      !hasFailedDeterministicEvidence &&
      (
        hasActionLimitation ||
        requiresPanelOrModal ||
        isMenuOrFilterCase(testCase)
      )
    ) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "AUTOMATION_LIMITATION",
        notes:
          buildManualRequiredNotesForFailedAssertions(
            notes,
            testCase
          ),
      };
    }

    return {
      status: "FAIL",
      reasonCategory:
        hasFailedDeterministicEvidence
          ? "DETERMINISTIC_URL_ASSERTION_FAILED"
          : "PRODUCT_ASSERTION_FAILED",
      notes,
      deterministicEvidence,
    };
  }

  if (hasAssertion) {
    if (!hasAcceptanceAssertion) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "SANITY_ONLY_ASSERTIONS",
        notes: [
          ...notes,
          "manual required: only sanity assertions passed; " +
            "no acceptance-level product behavior was verified",
        ],
      };
    }

    if (isPermissionSensitiveCase) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "UNVERIFIED_PERMISSION_FIXTURE",
        notes: [
          ...notes,
          "manual required: the case depends on a specific " +
            "permission fixture that the current browser persona " +
            "does not explicitly verify",
        ],
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
    reasonCategory:
      "NO_EXPLICIT_ASSERTIONS",
    notes: [
      ...notes,
      "No explicit assertions were executed. Manual verification is required.",
    ],
  };
}
