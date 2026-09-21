import {
  getCaseNotes,
  getQueryParams,
} from "./api-semantic-expectation-evaluator.js";
import {
  hasUnresolvedPathValue,
} from "./api-case-resolution.js";

type SupportedPersona = "company_admin" | "talent" | "unauthenticated";

const supportedPersonas = new Set<SupportedPersona>([
  "company_admin",
  "talent",
  "unauthenticated",
]);

function isMutationMethod(method: string): boolean {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function mutationsEnabled(): boolean {
  return String(process.env.QA_ALLOW_API_MUTATIONS || "").toLowerCase() === "true";
}

/**
 * Prevent status-only PASS results when the API case
 * explicitly requires query parameters that are absent
 * from the executable request.
 *
 * Concrete or runtime-resolved query values continue
 * normally and are verified by semantic assertions.
 */
function getConcreteQueryValues(
  path: string,
  key: string
): string[] {
  return getQueryParams(path)
    .getAll(key)
    .map((value) =>
      String(value || "").trim()
    )
    .filter(
      (value) =>
        Boolean(value) &&
        value.toUpperCase() !==
          "UNKNOWN"
    );
}

function getExplicitMissingApiFixtureReason(
  testCase: any
): string | null {
  const path = String(
    testCase?.path || ""
  ).trim();

  const [rawBasePath] =
    path.split("?");

  const basePath = String(
    rawBasePath || ""
  )
    .replace(/\/+$/, "")
    .toLowerCase();

  const caseText = [
    testCase?.goal,
    testCase?.successCriteria,
    getCaseNotes(testCase),
    JSON.stringify(
      testCase?.expect || {}
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");

  /*
   * Selected-skills behavior cannot be validated
   * by a plain GET /skills response.
   */
  if (basePath === "/skills") {
    const skillIds =
      getConcreteQueryValues(
        path,
        "skillIds"
      );

    const requiresSelectedSkillIds =
      [
        /\b(?:request|query|path)\b[^.]{0,180}\b(?:include|contain|send|use)\w*\b[^.]{0,100}\bskillids\b/,
        /\b(?:using|with)\b[^.]{0,120}\b(?:exact\s+)?selected(?:-|\s)+skill ids\b/,
        /\bskillids\b[^.]{0,120}\b(?:filter|selected(?:-|\s)+skill|selected ids)\b/,
      ].some((pattern) =>
        pattern.test(caseText)
      );

    if (
      requiresSelectedSkillIds &&
      skillIds.length === 0
    ) {
      return (
        `API fixture gate blocked ` +
        `${testCase?.id || "case"}: ` +
        `selected-skills behavior requires ` +
        `a concrete skillIds query parameter, ` +
        `but the executable request contains none.`
      );
    }
  }

  /*
   * Project-scoped Work Setup filtering cannot be
   * validated by the unfiltered list endpoint.
   */
  const isWorkSetupsList =
    /^\/companies\/[^/]+\/work-setups$/i.test(
      basePath
    ) ||
    basePath === "/work-setups";

  if (isWorkSetupsList) {
    const projectIds =
      getConcreteQueryValues(
        path,
        "projectId"
      );

    const includeGlobalValues =
      getConcreteQueryValues(
        path,
        "includeGlobal"
      ).map((value) =>
        value.toLowerCase()
      );

    const requiresProjectFilter =
      caseText.includes(
        "projectid"
      ) &&
      (
        caseText.includes(
          "selected project"
        ) ||
        caseText.includes(
          "project filtering"
        ) ||
        /\brequest\b[^.]{0,180}\bprojectid\b/.test(
          caseText
        )
      );

    const requiresGlobalRecords =
      /includeglobal\s*=\s*true/.test(
        caseText
      ) ||
      /includeglobal[^.]{0,60}\btrue\b/.test(
        caseText
      );

    const missingRequirements:
      string[] = [];

    if (
      requiresProjectFilter &&
      projectIds.length === 0
    ) {
      missingRequirements.push(
        "projectId"
      );
    }

    if (
      requiresGlobalRecords &&
      !includeGlobalValues.includes(
        "true"
      )
    ) {
      missingRequirements.push(
        "includeGlobal=true"
      );
    }

    if (
      missingRequirements.length > 0
    ) {
      return (
        `API fixture gate blocked ` +
        `${testCase?.id || "case"}: ` +
        `project-scoped Work Setup behavior ` +
        `requires ${missingRequirements.join(
          " and "
        )}, but the executable request ` +
        `does not contain the required query ` +
        `parameters.`
      );
    }
  }

  return null;
}

export function getBlockReason(testCase: any): string | null {
  const persona = String(testCase.persona || "").trim();
  const path = String(testCase.path || "").trim();
  const method = String(testCase.method || "").trim().toUpperCase();

  if (!supportedPersonas.has(persona as SupportedPersona)) {
    return `Unsupported persona "${persona}". Supported personas: company_admin, talent, unauthenticated.`;
  }

  if (hasUnresolvedPathValue(path)) {
    return `API path contains unresolved setup data: ${path}`;
  }

  const expectedStatus =
    String(
      testCase.expect?.status ?? ""
    )
      .trim()
      .toUpperCase();

  /**
   * An UNKNOWN expected status means the API
   * contract has not been grounded yet.
   *
   * Do not execute a discovered endpoint and compare
   * its real HTTP response against the literal string
   * "UNKNOWN", because that creates an agent-origin
   * false FAIL.
   */
  if (expectedStatus === "UNKNOWN") {
    return (
      `Expected API status is UNKNOWN for ` +
      `${testCase.id || "case"}. ` +
      `The endpoint contract and expected response ` +
      `must be resolved before execution.`
    );
  }

  const fixtureBlockReason =
    getExplicitMissingApiFixtureReason(
      testCase
    );

  if (fixtureBlockReason) {
    return fixtureBlockReason;
  }

  /**
   * Safety guard:
   * By default we execute GET/HEAD read-only cases.
   * Mutating POST/PATCH/PUT/DELETE cases require explicit opt-in.
   */
  if (isMutationMethod(method) && !mutationsEnabled()) {
    return `${method} is a mutating API case. It is blocked by default to avoid changing staging data. Set QA_ALLOW_API_MUTATIONS=true only when test data is safe.`;
  }

  if (["POST", "PATCH", "PUT"].includes(method) && testCase.body === undefined) {
    return `${method} request has no body. GitHub diff/API contract is needed to build a valid request payload.`;
  }

  if (
    testCase.body !== undefined &&
    JSON.stringify(testCase.body).toUpperCase().includes("UNKNOWN")
  ) {
    return `${method} request body contains UNKNOWN setup data. Real test data is needed before this case can be executed.`;
  }

  return null;
}
