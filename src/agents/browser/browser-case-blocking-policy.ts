import {
  isInvoiceRowClickRequest,
} from "./browser-entity-interaction.js";
import {
  getBrowserCaseText,
  getBrowserRelevanceBlockReason,
} from "./browser-case-relevance.js";
import {
  browserEditFlowsAllowed,
  hasAssessmentLanguagePersistMutationStep,
  isAssessmentLanguageModalCase,
} from "./browser-assessment-language-flow.js";

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

export function getBrowserBlockReason(testCase: any): string | null {
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
  hasAssessmentLanguagePersistMutationStep(
    testCase
  ) &&
  !browserEditFlowsAllowed()
) {
  return (
    "Assessment language case includes an action " +
    "that may persist changes. Browser edit-flow " +
    "mutations are disabled by default to protect " +
    "staging data. Set " +
    "QA_ALLOW_BROWSER_EDIT_FLOWS=true only for " +
    "isolated test data."
  );
}

return null;
}


export function getBrowserBlockReasonCategory(
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
