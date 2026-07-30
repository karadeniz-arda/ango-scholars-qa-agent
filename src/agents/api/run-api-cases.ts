import fs from "node:fs";
import yaml from "yaml";
import type { TestPlan } from "../../planner/types.js";
import { getIdTokenForPersona } from "../../auth/firebase.js";
import { resolveExecutionContext, type ExecutionContext } from "./setup-resolver.js";
import { resolveSkillsRuntimeFixture } from "./skills-runtime-resolver.js";
import { resolveRuntimePathResources } from "./runtime-resource-resolver.js";
import { evaluateApiDetailSemantics } from "./api-detail-semantic-evaluator.js";
import { findApiEndpointCandidateFromCatalog } from "../../discovery/api-endpoint-catalog.js";
import type {
  RuntimeContextsByPersona,
  RuntimePersona,
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";

type SupportedPersona = "company_admin" | "talent" | "unauthenticated";

type ApiExecutionContext =
  ExecutionContext &
  RuntimeResourceContext & {
    id?: string | undefined;
  };

export type ApiCaseResults =
  any[] & {
    runtimeContexts:
      RuntimeContextsByPersona;
  };

const supportedPersonas = new Set<SupportedPersona>([
  "company_admin",
  "talent",
  "unauthenticated",
]);

function toRuntimeResourceContext(
  context: ApiExecutionContext
): RuntimeResourceContext {
  return {
    companyId: context.companyId,
    projectId: context.projectId,
    jobId: context.jobId,
    workSetupId: context.workSetupId,
    familyId: context.familyId,
    talentId: context.talentId,
    talentJobWorkSetupId:
      context.talentJobWorkSetupId,
    assessmentId: context.assessmentId,
    invoiceId: context.invoiceId,
    invoiceNumber: context.invoiceNumber,
    invoiceStatus: context.invoiceStatus,
    skillIds: context.skillIds,
    skillCategory: context.skillCategory,
    mainDiscipline: context.mainDiscipline,
  };
}

function promoteRuntimeResourcesForHandoff(
  args: {
    runtimeContexts:
      RuntimeContextsByPersona;
    persona: string;
    method: string;
    expectedStatus: unknown;
    actualStatus: number;
    resources:
      RuntimeResourceContext;
    testCaseId: string;
  }
): void {
  const isSafePositiveRead =
    args.method === "GET" &&
    Number(args.expectedStatus) === 200 &&
    args.actualStatus >= 200 &&
    args.actualStatus < 300 &&
    (
      args.persona ===
        "company_admin" ||
      args.persona === "talent"
    );

  if (!isSafePositiveRead) {
    return;
  }

  const promotedResources =
    Object.fromEntries(
      Object.entries(
        args.resources
      ).filter(
        ([, value]) =>
          value !== undefined
      )
    );

  if (
    Object.keys(
      promotedResources
    ).length === 0
  ) {
    return;
  }

  const persona =
    args.persona as
      RuntimePersona;

  const target =
    args.runtimeContexts[
      persona
    ] ?? {};

  Object.assign(
    target,
    promotedResources
  );

  args.runtimeContexts[
    persona
  ] = target;

  console.log(
    ` API runtime handoff promoted for ` +
      `${args.testCaseId} (${persona}):`,
    promotedResources
  );
}

function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/$/, "");
}

function getCaseNotes(testCase: any): string {
  return testCase.notes || testCase.expect?.notes || testCase.expect?.note || "";
}

function isUnknownPathWithOptionalQuery(path: string): boolean {
  const trimmed = String(path || "").trim();

  if (!trimmed) return true;

  const [basePath] = trimmed.split("?");

  return String(basePath || "").trim().toUpperCase() === "UNKNOWN";
}

function mergeCandidatePathWithOriginalQuery(
  originalPath: string,
  candidatePath: string
): string {
  const queryIndex = String(originalPath || "").indexOf("?");

  if (queryIndex === -1) {
    return candidatePath;
  }

  const query = originalPath.slice(queryIndex);

  if (!query || query === "?") {
    return candidatePath;
  }

  return `${candidatePath}${query}`;
}

function extractItems(data: any): any[] {
  if (!data) return [];

  if (Array.isArray(data)) return data;

  if (data.id !== undefined || data._id !== undefined) {
    return [data];
  }

  const possibleArrays = [
    data.items,
    data.results,
    data.data,
    data.rows,
    data.workSetups,
    data.work_setups,
    data.data?.items,
    data.data?.results,
    data.data?.rows,
    data.assessments,
    data.data?.assessments,
    data.data?.workSetups,
    data.data?.work_setups,
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) return arr;
  }

  return [];
}

function firstString(...values: any[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }

  return undefined;
}

type ApiSemanticOutcome =
  | "NOT_APPLICABLE"
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "MANUAL_REQUIRED";

type ApiSemanticEvaluation = {
  outcome: ApiSemanticOutcome;
  notes: string;
};

function normalizeSemanticValue(
  value: unknown
): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function getQueryParams(
  path: string
): URLSearchParams {
  try {
    return new URL(
      path,
      "http://qa-agent.local"
    ).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function notesAllowEmptyResult(
  testCase: any
): boolean {
  const notes = getCaseNotes(testCase)
    .toLowerCase();

  return [
    "empty result",
    "empty items",
    "empty list",
    "no matching",
    "zero records",
    "0 records",
  ].some(
    (phrase) =>
      notes.includes(phrase)
  );
}

function getRequestTypeValue(
  item: any
): string | undefined {
  return firstString(
    item?.type,
    item?.changeRequestType,
    item?.requestType,
    item?.change_request_type,
    item?.request?.type
  );
}

function getSkillItemId(
  item: any
): string | undefined {
  return firstString(
    item?.id,
    item?.skillId,
    item?._id,
    item?.skill?.id
  );
}

function getSkillCategoryValue(
  item: any
): string | undefined {
  return firstString(
    typeof item?.category === "string"
      ? item.category
      : undefined,
    item?.category?.name,
    item?.categoryName,
    item?.category_name
  );
}

function getMainDisciplineValue(
  item: any
): string | undefined {
  return firstString(
    typeof item?.mainDiscipline === "string"
      ? item.mainDiscipline
      : undefined,
    item?.mainDiscipline?.name,
    item?.mainDisciplineName,
    item?.main_discipline
  );
}

function parseExplicitBoolean(
  value: unknown
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized =
    normalizeSemanticValue(value);

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no"
  ) {
    return false;
  }

  return undefined;
}

function getExplicitGlobalFlag(
  item: any
): boolean | undefined {
  const directValues = [
    item?.isGlobal,
    item?.global,
    item?.is_global,
  ];

  for (const value of directValues) {
    const parsed =
      parseExplicitBoolean(value);

    if (parsed !== undefined) {
      return parsed;
    }
  }

  const scope = normalizeSemanticValue(
    item?.scope
  );

  if (scope === "global") {
    return true;
  }

  if (
    scope === "project" ||
    scope === "project-specific"
  ) {
    return false;
  }

  return undefined;
}

function getUnverifiedApiSemanticRequirementReason(
  testCase: any
): string | null {
  const notes = getCaseNotes(testCase)
    .trim()
    .toLowerCase();

  if (!notes) {
    return null;
  }

  const asksForVerification =
    /\b(verify|confirm|ensure|must|should|expect)\b/.test(
      notes
    );

  if (!asksForVerification) {
    return null;
  }

  const categories: string[] = [];

  if (
    /\b(sort|sorted|sorting|order|ordered|ascending|descending|newest|latest|oldest|sortby|sortorder|createdat|updatedat)\b/.test(
      notes
    )
  ) {
    categories.push(
      "sorting or ordering behavior"
    );
  }

  if (
    /\b(filter|filtered|filtering|query parameter|query parameters|query param|query params)\b/.test(
      notes
    )
  ) {
    categories.push(
      "filter or query behavior"
    );
  }

  /*
   * POSITIVE_API_SEMANTIC_VERB_GUARD_V1
   *
   * Planner notes commonly use "returns", "retrieved",
   * "provides", or "displays" instead of "contains".
   * These still describe payload semantics and must not
   * fall through to an HTTP-status-only PASS.
   */
  const mentionsPayloadStructure =
    /\b(field|fields|record|records|item|items|collection|collections|data|value|values|mode|modes|level|levels|title|titles|description|descriptions|status values|statuses|document|documents|note|notes|requirement|requirements|relation|relations)\b/.test(
      notes
    );

  const asksForPayloadAssertion =
    /\b(include|includes|included|contain|contains|contained|return|returns|returned|retrieve|retrieves|retrieved|provide|provides|provided|supply|supplies|supplied|expose|exposes|exposed|display|displays|displayed|every|each|only|limited|exclude|excludes|excluded|absent|missing|match|matches|matched|mapped|mapping|preserve|preserved)\b/.test(
      notes
    );

  const explicitlyMentionsResponseShape =
    /\b(response|payload|body)\b/.test(
      notes
    ) &&
    /\b(include|includes|contain|contains|every|each|only|exclude|absent|missing|match|mapped|preserve)\b/.test(
      notes
    );

  if (
    (
      mentionsPayloadStructure &&
      asksForPayloadAssertion
    ) ||
    explicitlyMentionsResponseShape
  ) {
    categories.push(
      "response content or schema"
    );
  }

  if (
    /\b(persist|persists|persisted|persistence|subsequent|after creation|after update|create and update|read create and update|without data loss)\b/.test(
      notes
    )
  ) {
    categories.push(
      "cross-request or persistence behavior"
    );
  }

  if (categories.length === 0) {
    return null;
  }

  return (
    "HTTP status matched, but the plan also " +
    `requires ${[
      ...new Set(categories),
    ].join(", ")}. ` +
    "No supported semantic evaluator confirmed " +
    "those requirements."
  );
}

function evaluateApiSemanticExpectations(args: {
  testCase: any;
  path: string;
  responseStatus: number;
  responseBody: any;
}): ApiSemanticEvaluation {
  const {
    testCase,
    path,
    responseStatus,
    responseBody,
  } = args;

  /*
   * Error and auth responses are validated primarily
   * through HTTP status. Semantic collection checks
   * apply only to successful responses.
   */
  if (
    responseStatus < 200 ||
    responseStatus >= 300
  ) {
    return {
      outcome: "NOT_APPLICABLE",
      notes: "",
    };
  }

  const params = getQueryParams(path);
  const items = extractItems(responseBody);
  const caseNotes = getCaseNotes(testCase)
    .toLowerCase();

const failures: string[] = [];
const blockedReasons: string[] = [];
const manualReasons: string[] = [];
const passedChecks: string[] = [];

  const detailEvaluation =
    evaluateApiDetailSemantics({
      testCase,
      path,
      responseBody,
    });

  if (
    detailEvaluation.outcome ===
    "FAIL"
  ) {
    failures.push(
      detailEvaluation.notes
    );
  } else if (
    detailEvaluation.outcome ===
    "MANUAL_REQUIRED"
  ) {
    manualReasons.push(
      detailEvaluation.notes
    );
  } else if (
    detailEvaluation.outcome ===
    "PASS"
  ) {
    passedChecks.push(
      detailEvaluation.notes
    );
  }

  const emptyResultAllowed =
    notesAllowEmptyResult(testCase);

  const isChangeRequestEndpoint =
    /\/jobs\/change-requests(?:\?|$)/i.test(
      path
    ) ||
    caseNotes.includes(
      "change-request"
    ) ||
    caseNotes.includes(
      "change request"
    );

  const expectedType =
    params.get("type");

  if (
    expectedType &&
    isChangeRequestEndpoint
  ) {
    if (items.length === 0) {
      if (emptyResultAllowed) {
        passedChecks.push(
          `empty result accepted for type=${expectedType}`
        );
      } else {
        manualReasons.push(
          `type=${expectedType} could not be verified because the response contains no records`
        );
      }
    } else {
      const actualTypes = items.map(
        getRequestTypeValue
      );

      if (
        actualTypes.some(
          (value) => !value
        )
      ) {
        manualReasons.push(
          `type=${expectedType} could not be fully verified because one or more response records have no readable type field`
        );
      } else {
        const mismatchedTypes =
          actualTypes.filter(
            (value) =>
              normalizeSemanticValue(
                value
              ) !==
              normalizeSemanticValue(
                expectedType
              )
          );

        if (mismatchedTypes.length > 0) {
          failures.push(
            `type filter mismatch: expected every record to have type=${expectedType}, received ${[
              ...new Set(
                mismatchedTypes
              ),
            ].join(", ")}`
          );
        } else {
          passedChecks.push(
            `all ${items.length} record(s) matched type=${expectedType}`
          );
        }
      }
    }
  } else if (
    isChangeRequestEndpoint &&
    (
      caseNotes.includes(
        "type field"
      ) ||
      caseNotes.includes(
        "request type"
      )
    )
  ) {
    if (items.length === 0) {
      manualReasons.push(
        "change-request type fields could not be verified because the response contains no records"
      );
    } else {
      const missingTypeCount =
        items.filter(
          (item) =>
            !getRequestTypeValue(item)
        ).length;

      if (missingTypeCount > 0) {
        failures.push(
          `${missingTypeCount} change-request record(s) are missing a readable type field`
        );
      } else {
        passedChecks.push(
          `all ${items.length} change-request record(s) contain a type field`
        );
      }
    }
  }

  const isSkillsEndpoint =
    /\/skills(?:\?|$)/i.test(path);

  if (isSkillsEndpoint) {
    const requestedSkillIds =
      params
        .getAll("skillIds")
        .flatMap(
          (value) =>
            value.split(",")
        )
        .map(
          (value) =>
            value.trim()
        )
        .filter(Boolean);

    if (requestedSkillIds.length > 0) {
      if (items.length === 0) {
        if (emptyResultAllowed) {
          passedChecks.push(
            "empty skill result accepted by the plan"
          );
        } else {
          manualReasons.push(
            "skillIds filtering could not be verified because the response contains no skills"
          );
        }
      } else {
        const actualSkillIds =
          items.map(getSkillItemId);

        if (
          actualSkillIds.some(
            (value) => !value
          )
        ) {
          manualReasons.push(
            "skillIds filtering could not be fully verified because one or more skills have no readable ID"
          );
        } else {
          const requestedSet =
            new Set(
              requestedSkillIds
            );

          const actualSet =
            new Set(
              actualSkillIds as string[]
            );

          const unexpected =
            [...actualSet].filter(
              (id) =>
                !requestedSet.has(id)
            );

          const missing =
            [...requestedSet].filter(
              (id) =>
                !actualSet.has(id)
            );

          if (
            unexpected.length > 0 ||
            missing.length > 0
          ) {
            failures.push(
              `skillIds mismatch: unexpected=[${unexpected.join(", ")}], missing=[${missing.join(", ")}]`
            );
          } else {
            passedChecks.push(
              `returned skill IDs matched requested skillIds=[${requestedSkillIds.join(", ")}]`
            );
          }
        }
      }
    }

    const expectedCategory =
      params.get("category");

    if (expectedCategory) {
      if (items.length === 0) {
        manualReasons.push(
          `category=${expectedCategory} could not be verified because the response contains no skills`
        );
      } else {
        const categories =
          items.map(
            getSkillCategoryValue
          );

        if (
          categories.some(
            (value) => !value
          )
        ) {
          manualReasons.push(
            `category=${expectedCategory} could not be fully verified because one or more skills have no readable category`
          );
        } else if (
          categories.some(
            (value) =>
              normalizeSemanticValue(
                value
              ) !==
              normalizeSemanticValue(
                expectedCategory
              )
          )
        ) {
          failures.push(
            `category filter returned records outside category=${expectedCategory}`
          );
        } else {
          passedChecks.push(
            `all ${items.length} skill(s) matched category=${expectedCategory}`
          );
        }
      }
    }

    const expectedMainDiscipline =
      params.get(
        "mainDiscipline"
      );

    if (expectedMainDiscipline) {
      if (items.length === 0) {
        manualReasons.push(
          `mainDiscipline=${expectedMainDiscipline} could not be verified because the response contains no skills`
        );
      } else {
        const disciplines =
          items.map(
            getMainDisciplineValue
          );

        if (
          disciplines.some(
            (value) => !value
          )
        ) {
          manualReasons.push(
            `mainDiscipline=${expectedMainDiscipline} could not be fully verified because one or more skills have no readable mainDiscipline`
          );
        } else if (
          disciplines.some(
            (value) =>
              normalizeSemanticValue(
                value
              ) !==
              normalizeSemanticValue(
                expectedMainDiscipline
              )
          )
        ) {
          failures.push(
            `mainDiscipline filter returned records outside mainDiscipline=${expectedMainDiscipline}`
          );
        } else {
          passedChecks.push(
            `all ${items.length} skill(s) matched mainDiscipline=${expectedMainDiscipline}`
          );
        }
      }
    }
  }

  const includeGlobalRaw =
    params.get("includeGlobal");

  const isWorkSetupEndpoint =
    /\/work-setups(?:\?|$)/i.test(
      path
    );

  if (
    includeGlobalRaw !== null &&
    isWorkSetupEndpoint
  ) {
    const expectedIncludeGlobal =
      parseExplicitBoolean(
        includeGlobalRaw
      );

    if (
      expectedIncludeGlobal ===
      undefined
    ) {
      manualReasons.push(
        `includeGlobal=${includeGlobalRaw} could not be interpreted safely`
      );
    } else if (items.length === 0) {
      manualReasons.push(
        `includeGlobal=${includeGlobalRaw} could not be verified because the response contains no work setups`
      );
    } else {
      const flags =
        items.map(
          getExplicitGlobalFlag
        );

      if (
        flags.some(
          (flag) =>
            flag === undefined
        )
      ) {
        manualReasons.push(
          `includeGlobal=${includeGlobalRaw} could not be fully verified because one or more work setups have no explicit global/project marker`
        );
      } else if (
        expectedIncludeGlobal ===
        false &&
        flags.some(
          (flag) =>
            flag === true
        )
      ) {
        failures.push(
          "includeGlobal=false returned at least one explicitly global work setup"
        );
      } else if (
        expectedIncludeGlobal ===
        false
      ) {
        passedChecks.push(
          "includeGlobal=false returned no explicitly global work setups"
        );
      } else if (
        flags.some(
          (flag) =>
            flag === true
        )
      ) {
        passedChecks.push(
          "includeGlobal=true returned at least one explicitly global work setup"
        );
      } else {
        manualReasons.push(
          "includeGlobal=true returned no explicitly global work setup; the environment may not contain suitable global test data"
        );
      }
    }
  }

  /*
   * Generic Work Setup collection semantics.
   *
   * These checks are path- and response-driven.
   * They do not depend on an issue key.
   */
  const semanticBasePath = String(
    path.split("?")[0] || ""
  ).replace(/\/+$/, "");

  const hasOwnField = (
    value: any,
    key: string
  ): boolean =>
    Boolean(value) &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(
      value,
      key
    );

  const isCompanyWorkSetupsList =
    /^\/companies\/[^/]+\/work-setups$/i.test(
      semanticBasePath
    );

  const isTalentWorkSetupsList =
    /^\/talents\/[^/]+\/work-setups$/i.test(
      semanticBasePath
    );

  const isTalentJobWorkSetupsList =
    /^\/companies\/[^/]+\/talent-job-work-setups$/i.test(
      semanticBasePath
    );

  if (isCompanyWorkSetupsList) {
    if (items.length === 0) {
      blockedReasons.push(
        "Compatible company Work Setup fixture is unavailable because the response contains no records"
      );
    } else {
      const invalidRecords =
        items.filter((item) => {
          const hasReferenceDocumentState =
            hasOwnField(
              item,
              "documentPath"
            ) ||
            hasOwnField(
              item,
              "documentUrl"
            );

          return (
            !firstString(item?.id) ||
            !String(
              item?.title ?? ""
            ).trim() ||
            !hasOwnField(
              item,
              "description"
            ) ||
            !hasReferenceDocumentState ||
            typeof item?.requireFileUpload !==
              "boolean" ||
            typeof item?.requireApproval !==
              "boolean" ||
            !firstString(
              item?.familyId
            ) ||
            !Number.isFinite(
              Number(item?.version)
            )
          );
        });

      if (invalidRecords.length > 0) {
        failures.push(
          `${invalidRecords.length} company Work Setup record(s) are missing required management fields`
        );
      } else {
        const familyIds =
          items.map((item) =>
            firstString(
              item?.familyId
            )
          ) as string[];

        const uniqueFamilyIds =
          new Set(familyIds);

        if (
          uniqueFamilyIds.size !==
          familyIds.length
        ) {
          failures.push(
            "Company Work Setup response contains multiple records for the same family instead of one latest version per family"
          );
        } else {
          passedChecks.push(
            `all ${items.length} company Work Setup record(s) expose title, description, document state, file requirement, approval requirement, family identity, and version`
          );

          passedChecks.push(
            `company Work Setup response contains one latest record per family across ${uniqueFamilyIds.size} family/families`
          );
        }
      }
    }
  }

  if (isTalentWorkSetupsList) {
    if (items.length === 0) {
      blockedReasons.push(
        "Compatible talent Work Setup fixture is unavailable because the talent has no active contract Work Setup records"
      );
    } else {
      manualReasons.push(
        `talent Work Setup response contains ${items.length} record(s), but its non-empty contract-state schema has not yet been grounded`
      );
    }
  }

  if (isTalentJobWorkSetupsList) {
    if (items.length === 0) {
      blockedReasons.push(
        "Compatible talent-job Work Setup review fixture is unavailable because the response contains no submissions"
      );
    } else {
      const missingStatusCount =
        items.filter(
          (item) =>
            !String(
              item?.status ?? ""
            ).trim()
        ).length;

      const missingWorkSetupCount =
        items.filter(
          (item) =>
            !firstString(
              item?.workSetup?.id,
              item?.jobWorkSetup
                ?.workSetup?.id
            )
        ).length;

      const missingReviewShapeCount =
        items.filter(
          (item) =>
            !hasOwnField(
              item,
              "reviewedBy"
            ) ||
            !hasOwnField(
              item,
              "reviewedAt"
            )
        ).length;

      if (missingStatusCount > 0) {
        failures.push(
          `${missingStatusCount} talent-job Work Setup submission(s) are missing status`
        );
      }

      if (missingWorkSetupCount > 0) {
        failures.push(
          `${missingWorkSetupCount} talent-job Work Setup submission(s) are missing Work Setup identity`
        );
      }

      if (missingReviewShapeCount > 0) {
        failures.push(
          `${missingReviewShapeCount} talent-job Work Setup submission(s) are missing review metadata fields`
        );
      }

      if (
        missingStatusCount === 0 &&
        missingWorkSetupCount === 0 &&
        missingReviewShapeCount === 0
      ) {
        passedChecks.push(
          `all ${items.length} talent-job Work Setup submission(s) contain status, Work Setup identity, reviewedBy, and reviewedAt`
        );
      }
    }
  }

if (failures.length > 0) {
  return {
    outcome: "FAIL",
    notes: failures.join(" | "),
  };
}

if (blockedReasons.length > 0) {
  return {
    outcome: "BLOCKED",
    notes: [
      ...passedChecks,
      ...blockedReasons,
    ].join(" | "),
  };
}

if (manualReasons.length > 0) {
    return {
      outcome: "MANUAL_REQUIRED",
      notes: [
        ...passedChecks,
        ...manualReasons,
      ].join(" | "),
    };
  }

  if (passedChecks.length > 0) {
    return {
      outcome: "PASS",
      notes: passedChecks.join(" | "),
    };
  }

  return {
    outcome: "NOT_APPLICABLE",
    notes: "",
  };
}

function getJobId(job: any): string | undefined {
  return firstString(job?.id, job?.jobId, job?._id);
}

function selectBestJob(jobs: any[]): any | undefined {
  const withId = jobs.filter((job) => getJobId(job));

  if (withId.length === 0) return undefined;

  const preferred = withId.find((job) => {
    const status = String(job?.status || "").toLowerCase();
    const visibility = String(job?.visibility || "").toLowerCase();

    return (
      !["closed", "archived", "deleted"].includes(status) &&
      visibility !== "private"
    );
  });

  return preferred ?? withId[0];
}

async function resolveJobIdFromRuntime(
  apiUrl: string,
  setupToken: string,
  context: ApiExecutionContext
): Promise<string | undefined> {
  if (!context.companyId) return undefined;

  const candidatePaths = [
    context.projectId
      ? `/companies/${context.companyId}/jobs?projectId=${context.projectId}&limit=100&offset=0`
      : undefined,
    `/companies/${context.companyId}/jobs?limit=100&offset=0`,
  ].filter(Boolean) as string[];

  for (const path of candidatePaths) {
    const jobsData = await apiGet(apiUrl, path, setupToken);
    const jobs = extractItems(jobsData);
    const selectedJob = selectBestJob(jobs);
    const jobId = getJobId(selectedJob);

    if (jobId) {
      console.log(`API context resolver selected jobId=${jobId} from ${path}`);
      return jobId;
    }

    console.log(`API context resolver found no usable jobId from ${path}`);
  }

  return undefined;
}

function getAssessmentId(assessment: any): string | undefined {
  return firstString(
    assessment?.id,
    assessment?.assessmentId,
    assessment?._id
  );
}

function getAssessmentLanguages(
  assessment: any
): any[] {
  const candidates = [
    assessment?.languages,
    assessment?.assessment?.languages,
    assessment?.data?.languages,
    assessment?.data?.assessment?.languages,
  ];

  return (
    candidates.find(
      (candidate) =>
        Array.isArray(candidate)
    ) ?? []
  );
}

function selectBestAssessment(
  assessments: any[]
): any | undefined {
  const withId = assessments.filter((assessment) =>
    getAssessmentId(assessment)
  );

  if (withId.length === 0) {
    return undefined;
  }

  const preferred = withId.find((assessment) => {
    const status = String(
      assessment?.status || ""
    ).toLowerCase();

    return !["deleted", "archived"].includes(status);
  });

  return preferred ?? withId[0];
}

async function resolveAssessmentIdFromRuntime(
  apiUrl: string,
  setupToken: string,
  context: ApiExecutionContext
): Promise<string | undefined> {
  if (!context.companyId) {
    return undefined;
  }

  const candidatePaths = [
    `/companies/${context.companyId}/assessments?limit=100&offset=0`,
    `/companies/${context.companyId}/assessments`,
  ];

  for (const path of candidatePaths) {
    const assessmentsData = await apiGet(
      apiUrl,
      path,
      setupToken
    );

    const assessments =
      extractItems(assessmentsData);

    const preferred =
      selectBestAssessment(assessments);

    const orderedAssessments = [
      preferred,
      ...assessments.filter(
        (assessment) =>
          assessment !== preferred
      ),
    ].filter(Boolean);

    const probedIds = new Set<string>();

    for (
      const assessment
      of orderedAssessments
    ) {
      const assessmentId =
        getAssessmentId(assessment);

      if (
        !assessmentId ||
        probedIds.has(assessmentId)
      ) {
        continue;
      }

      probedIds.add(assessmentId);

      const detailPath =
        `/companies/${context.companyId}` +
        `/assessments/${assessmentId}`;

      const detail = await apiGet(
        apiUrl,
        detailPath,
        setupToken
      );

      const languages =
        getAssessmentLanguages(detail);

      console.log(
        `API assessment resolver probed ` +
        `assessmentId=${assessmentId} ` +
        `languages=${languages.length}`
      );

      if (languages.length > 0) {
        console.log(
          `API context resolver selected ` +
          `language-compatible ` +
          `assessmentId=${assessmentId} ` +
          `from ${detailPath}`
        );

        return assessmentId;
      }
    }

    const fallbackId =
      getAssessmentId(preferred);

    if (fallbackId) {
      console.log(
        `API context resolver found no ` +
        `language-compatible assessment; ` +
        `falling back to assessmentId=` +
        `${fallbackId} from ${path}`
      );

      return fallbackId;
    }

    console.log(
      `API context resolver found no usable ` +
      `assessmentId from ${path}`
    );
  }

  return undefined;
}

async function apiGet(
  apiUrl: string,
  path: string,
  token: string
): Promise<any | undefined> {
  const url = `${normalizeBaseUrl(apiUrl)}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    console.log(` API context resolver GET failed ${response.status}: ${path}`);
    return undefined;
  }

  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function firstId(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function extractOwnTalentId(data: any): string | undefined {
  const directId = firstId(
    data?.talentId,
    data?.talent?.id,
    data?.talent?.talentId,
    data?.profile?.talentId,
    data?.profile?.id,
    data?.user?.talentId,
    data?.user?.talent?.id,
    data?.id
  );

  if (directId) {
    return directId;
  }

  const items = extractItems(data);

  for (const item of items) {
    const itemId = firstId(
      item?.talentId,
      item?.talent?.id,
      item?.talent?.talentId,
      item?.profile?.talentId,
      item?.id
    );

    if (itemId) {
      return itemId;
    }
  }

  return undefined;
}

async function resolveOwnTalentIdFromRuntime(
  apiUrl: string,
  talentToken: string
): Promise<string | undefined> {
  const candidatePaths = [
    "/talents/me",
    "/talent/me",
    "/talents/profile",
    "/talent/profile",
    "/users/me",
    "/auth/me",
    "/me",
  ];

  for (const path of candidatePaths) {
    const data = await apiGet(apiUrl, path, talentToken);
    const talentId = extractOwnTalentId(data);

    if (talentId) {
      console.log(
        `API context resolver selected own talentId=${talentId} from ${path}`
      );
      return talentId;
    }
  }

  console.log(
    "API context resolver could not resolve own talentId for talent persona"
  );

  return undefined;
}

async function enrichExecutionContext(
  apiUrl: string,
  setupToken: string,
  baseContext: ExecutionContext
): Promise<ApiExecutionContext> {
  const context: ApiExecutionContext = { ...baseContext };

  if (!context.companyId) {
    return context;
  }

  /**
   * Work Setups list resolver.
   * This lets us resolve:
   * - {id}
   * - {workSetupId}
   * - {familyId}
   */
  const workSetupsData = await apiGet(
    apiUrl,
    `/companies/${context.companyId}/work-setups`,
    setupToken
  );

  const firstWorkSetup = extractItems(workSetupsData)[0];

  if (firstWorkSetup) {
    context.workSetupId = firstString(
      firstWorkSetup.id,
      firstWorkSetup.workSetupId,
      firstWorkSetup._id
    );

    context.familyId = firstString(
      firstWorkSetup.familyId,
      firstWorkSetup.family?.id,
      firstWorkSetup.family?.familyId,
      firstWorkSetup.workSetupFamilyId
    );

    context.id = context.workSetupId;

    console.log("API context resolver selected work setup:", {
      workSetupId: context.workSetupId,
      familyId: context.familyId,
    });
  } else {
    console.log("API context resolver did not find any work setup item.");
  }

  /**
   * Company talent work setup progress resolver.
   * This lets us resolve:
   * - {talentJobWorkSetupId}
   * - sometimes {talentId}
   * - sometimes {workSetupId}
   */
  const talentWorkSetupsData = await apiGet(
    apiUrl,
    `/companies/${context.companyId}/talent-job-work-setups`,
    setupToken
  );

  const firstTalentWorkSetup = extractItems(talentWorkSetupsData)[0];

  if (firstTalentWorkSetup) {
    context.talentJobWorkSetupId = firstString(
      firstTalentWorkSetup.id,
      firstTalentWorkSetup.talentJobWorkSetupId,
      firstTalentWorkSetup._id
    );

    context.talentId = firstString(
      firstTalentWorkSetup.talentId,
      firstTalentWorkSetup.talent?.id,
      firstTalentWorkSetup.contract?.talentId,
      firstTalentWorkSetup.talentJob?.talentId,
      context.talentId
    );

    context.workSetupId = firstString(
      context.workSetupId,
      firstTalentWorkSetup.workSetupId,
      firstTalentWorkSetup.workSetup?.id,
      firstTalentWorkSetup.jobWorkSetup?.workSetupId,
      firstTalentWorkSetup.jobWorkSetup?.workSetup?.id
    );

    context.id = context.id ?? context.workSetupId;

    console.log("API context resolver selected talent work setup:", {
      talentJobWorkSetupId: context.talentJobWorkSetupId,
      talentId: context.talentId,
      workSetupId: context.workSetupId,
    });
  } else {
    console.log("API context resolver did not find any talent-job-work-setup item.");
  }

if (!context.jobId) {
  const resolvedJobId =
    await resolveJobIdFromRuntime(
      apiUrl,
      setupToken,
      context
    );

  if (resolvedJobId) {
    context.jobId = resolvedJobId;
  }
}

if (!context.assessmentId) {
  context.assessmentId =
    await resolveAssessmentIdFromRuntime(
      apiUrl,
      setupToken,
      context
    );
}

  return context;
}

function resolveUnknownQueryParams(
  path: string,
  context: ApiExecutionContext
): string {
  if (!path.includes("?")) {
    return path;
  }

  const queryIndex =
    path.indexOf("?");

  const basePath =
    path.slice(0, queryIndex);

  const rawQuery =
    path.slice(queryIndex + 1);

  if (!rawQuery) {
    return basePath;
  }

  const inputParams =
    new URLSearchParams(rawQuery);

  const outputParams =
    new URLSearchParams();

  const contextValues:
    Record<
      string,
      string | undefined
    > = {
      companyId:
        context.companyId,
      projectId:
        context.projectId,
      jobId:
        context.jobId,
      assessmentId:
        context.assessmentId,
      talentId:
        context.talentId,
      workSetupId:
        context.workSetupId,
      familyId:
        context.familyId,
      talentJobWorkSetupId:
        context.talentJobWorkSetupId,
      id:
        context.id ??
        context.workSetupId,
    };

  const hasUnknownSkillIds =
    inputParams
      .getAll("skillIds")
      .some(
        (value) =>
          String(value)
            .toUpperCase() ===
          "UNKNOWN"
      );

  let skillIdsExpanded = false;

  for (
    const [key, value]
    of inputParams.entries()
  ) {
    const isUnknown =
      String(value)
        .toUpperCase() ===
      "UNKNOWN";

    if (!isUnknown) {
      outputParams.append(
        key,
        value
      );

      continue;
    }

    if (key === "skillIds") {
      if (!skillIdsExpanded) {
        for (
          const skillId
          of context.skillIds || []
        ) {
          outputParams.append(
            "skillIds",
            skillId
          );
        }

        skillIdsExpanded = true;
      }

      continue;
    }

    if (
      key === "category" &&
      context.skillCategory
    ) {
      outputParams.append(
        key,
        context.skillCategory
      );

      continue;
    }

    if (
      key === "mainDiscipline" &&
      context.mainDiscipline
    ) {
      outputParams.append(
        key,
        context.mainDiscipline
      );

      continue;
    }

    if (
      key === "limit" &&
      hasUnknownSkillIds &&
      context.skillIds?.length
    ) {
      outputParams.append(
        key,
        String(
          context.skillIds.length
        )
      );

      continue;
    }

    const contextValue =
      contextValues[key];

    if (contextValue) {
      outputParams.append(
        key,
        contextValue
      );
    }

    /*
     * Unknown values without a safe runtime fixture are
     * intentionally omitted.
     */
  }

  const cleanedQuery =
    outputParams.toString();

  return cleanedQuery
    ? `${basePath}?${cleanedQuery}`
    : basePath;
}

function resolveGenericPathId(
  path: string,
  context: ApiExecutionContext
): string | undefined {
  const normalizedPath =
    String(path || "").toLowerCase();

  const hasGenericIdAfter = (
    resource: string
  ): boolean =>
    normalizedPath.includes(
      `/${resource}/{id}`
    ) ||
    normalizedPath.includes(
      `/${resource}/:id`
    );

  /*
   * A generic {id} must be resolved from the
   * resource segment that owns it.
   *
   * Never fall back to context.id here because
   * context.id may belong to an unrelated entity.
   */
  if (
    hasGenericIdAfter("assessments")
  ) {
    return context.assessmentId;
  }

  if (
    hasGenericIdAfter(
      "talent-job-work-setups"
    )
  ) {
    return context.talentJobWorkSetupId;
  }

  if (
    hasGenericIdAfter("work-setups")
  ) {
    return context.workSetupId;
  }

    if (
    hasGenericIdAfter("invoices")
  ) {
    return context.invoiceId;
  }

  if (
    hasGenericIdAfter("jobs")
  ) {
    return context.jobId;
  }

  if (
    hasGenericIdAfter("projects")
  ) {
    return context.projectId;
  }

  if (
    hasGenericIdAfter("talents")
  ) {
    return context.talentId;
  }

  /*
   * Unknown ownership stays unresolved so the
   * existing unresolved-path guard returns BLOCKED
   * instead of sending a request with a guessed ID.
   */
  return undefined;
}

function resolvePath(path: string, context: ApiExecutionContext): string {
  let resolvedPath = String(path || "").trim();

  const replacements: Record<string, string | undefined> = {
    companyId: context.companyId,
    projectId: context.projectId,
    assessmentId: context.assessmentId,
    jobId: context.jobId,
    invoiceId: context.invoiceId,
    id: resolveGenericPathId(
      resolvedPath,
      context
    ),
    workSetupId: context.workSetupId,
    familyId: context.familyId,
    talentId: context.talentId,
    talentJobWorkSetupId: context.talentJobWorkSetupId,
  };

  for (const [key, value] of Object.entries(replacements)) {
    if (!value) continue;

    resolvedPath = resolvedPath.replaceAll(`{${key}}`, value);
    resolvedPath = resolvedPath.replaceAll(`:${key}`, value);
  }

  if (context.companyId) {
    resolvedPath = resolvedPath.replaceAll(
      "/companies/UNKNOWN",
      `/companies/${context.companyId}`
    );
  }

  if (context.projectId) {
    resolvedPath = resolvedPath.replaceAll(
      "/projects/UNKNOWN",
      `/projects/${context.projectId}`
    );
  }

  if (context.jobId) {
    resolvedPath = resolvedPath.replaceAll(
      "/jobs/UNKNOWN",
      `/jobs/${context.jobId}`
    );
  }

  if (context.talentId) {
    resolvedPath = resolvedPath.replaceAll(
      "/talents/UNKNOWN",
      `/talents/${context.talentId}`
    );
  }

  resolvedPath = resolveUnknownQueryParams(resolvedPath, context);

  return resolvedPath;
}

function resolveBodyValue(value: any, context: ApiExecutionContext): any {
  if (Array.isArray(value)) {
    return value.map((item) => resolveBodyValue(item, context));
  }

  if (value && typeof value === "object") {
    const next: Record<string, any> = {};

    for (const [key, childValue] of Object.entries(value)) {
      next[key] = resolveBodyValue(childValue, context);
    }

    return next;
  }

  if (typeof value !== "string") {
    return value;
  }

  let resolved = value;

  const replacements: Record<string, string | undefined> = {
    companyId: context.companyId,
    projectId: context.projectId,
    jobId: context.jobId,
    assessmentId: context.assessmentId,
    invoiceId: context.invoiceId,
    id: context.id ?? context.workSetupId,
    workSetupId: context.workSetupId,
    familyId: context.familyId,
    talentId: context.talentId,
    talentJobWorkSetupId: context.talentJobWorkSetupId,
  };

  for (const [key, replacement] of Object.entries(replacements)) {
    if (!replacement) continue;

    resolved = resolved.replaceAll(`{${key}}`, replacement);

    if (resolved.toUpperCase() === "UNKNOWN") {
      resolved = replacement;
    }
  }

  return resolved;
}

function resolveTestCase(testCase: any, context: ApiExecutionContext): any {
  return {
    ...testCase,
    path: resolvePath(testCase.path, context),
    body:
      testCase.body === undefined
        ? undefined
        : resolveBodyValue(testCase.body, context),
  };
}

function hasUnresolvedPathValue(path: string): boolean {
  return (
    !path ||
    path.toUpperCase().includes("UNKNOWN") ||
    /{[^}]+}/.test(path) ||
    /:[A-Za-z0-9_]+/.test(path)
  );
}

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

function getBlockReason(testCase: any): string | null {
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

export async function runApiCases() {
  console.log("\nAPI Tests starting..");

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);

  const apiUrl = normalizeBaseUrl(
    process.env.QA_API_URL ?? config.environments.staging.api_url
  );

  const setupToken = await getIdTokenForPersona("company_admin");
  const baseExecutionContext = await resolveExecutionContext(apiUrl, setupToken);
  const executionContext = await enrichExecutionContext(
    apiUrl,
    setupToken,
    baseExecutionContext
  );

  console.log("Execution context:", executionContext);

    const talentExecutionContext: ApiExecutionContext = {
    ...executionContext,
  };

  /**
   * Do not reuse company-side talentId for talent persona cases.
   * It may belong to a different talent than the talent auth token.
   */
  delete talentExecutionContext.talentId;

  let talentSetupToken:
    string | undefined;

  try {
    talentSetupToken =
      await getIdTokenForPersona(
        "talent"
      );

    const ownTalentId =
      await resolveOwnTalentIdFromRuntime(
      apiUrl,
      talentSetupToken
    );

    if (ownTalentId) {
      talentExecutionContext.talentId = ownTalentId;
    }
  } catch (error) {
    console.log(
      "API context resolver could not prepare talent execution context:",
      error
    );
  }

  console.log("Talent execution context:", talentExecutionContext);

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const cleanPlanFile = planFile
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const plan: TestPlan = JSON.parse(cleanPlanFile);

  const planNeedsSkillsRuntimeFixture =
    (plan.apiCases as any[]).some(
      (testCase) => {
        const path = String(
          testCase?.path || ""
        );

        return (
          /\/skills(?:\?|$)/i.test(
            path
          ) &&
          /(?:skillIds|category|mainDiscipline)=UNKNOWN/i.test(
            path
          )
        );
      }
    );

  if (
    planNeedsSkillsRuntimeFixture
  ) {
    const skillsFixture =
      await resolveSkillsRuntimeFixture(
        apiUrl,
        setupToken
      );

    if (skillsFixture) {
      executionContext.skillIds =
        skillsFixture.skillIds;

      executionContext.skillCategory =
        skillsFixture.category;

      executionContext.mainDiscipline =
        skillsFixture.mainDiscipline;

      /*
       * Keep the talent context compatible with future
       * talent /skills cases as well.
       */
      talentExecutionContext.skillIds =
        skillsFixture.skillIds;

      talentExecutionContext.skillCategory =
        skillsFixture.category;

      talentExecutionContext.mainDiscipline =
        skillsFixture.mainDiscipline;

      console.log(
        "API skills execution context:",
        {
          skillIds:
            executionContext.skillIds,
          category:
            executionContext.skillCategory,
          mainDiscipline:
            executionContext.mainDiscipline,
        }
      );
    } else {
      console.log(
        "API skills execution context " +
          "could not be resolved."
      );
    }
  }

  const runtimeContexts:
    RuntimeContextsByPersona = {
      company_admin:
        toRuntimeResourceContext(
          executionContext
        ),
      talent:
        toRuntimeResourceContext(
          talentExecutionContext
        ),
    };

  const results:
    ApiCaseResults =
    Object.assign(
      [] as any[],
      {
        runtimeContexts,
      }
    );

  for (const rawTestCase of plan.apiCases as any[]) {
    const catalogResolvedRawTestCase = { ...rawTestCase };

    const originalRawPath = String(
      rawTestCase.path || "UNKNOWN"
    ).trim();

    const originalRawMethod = String(
      rawTestCase.method || ""
    )
      .trim()
      .toUpperCase();

    const hasUnknownMethod =
      originalRawMethod === "" ||
      originalRawMethod === "UNKNOWN";

    const hasUnknownPath =
      isUnknownPathWithOptionalQuery(
        originalRawPath
      );

    const hasMutatingMethod = [
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
    ].includes(originalRawMethod);

    /**
     * Runtime catalog resolution is allowed only for
     * read-only cases whose HTTP method is already known.
     *
     * It must not guess:
     * - both method and path;
     * - mutation endpoint paths.
     */
    const canResolveUnknownPathFromCatalog =
      hasUnknownPath &&
      !hasUnknownMethod &&
      !hasMutatingMethod;

    if (canResolveUnknownPathFromCatalog) {
      const candidate = findApiEndpointCandidateFromCatalog(plan, rawTestCase);

      if (candidate && candidate.confidence !== "low") {
        const resolvedCatalogPath = mergeCandidatePathWithOriginalQuery(
          originalRawPath,
          candidate.path
        );

        console.log(
          ` API catalog selected path for ${rawTestCase.id}: ${originalRawPath} -> ${resolvedCatalogPath} (${candidate.confidence})`
        );
        console.log(` API catalog reason: ${candidate.reason}`);

        catalogResolvedRawTestCase.path = resolvedCatalogPath;
      }
    }

    const rawPersona = String(rawTestCase.persona || "").trim();

    const baseContextForCase:
      ApiExecutionContext =
      rawPersona === "talent"
        ? talentExecutionContext
        : executionContext;

    const resolverToken =
      rawPersona === "talent"
        ? talentSetupToken
        : rawPersona ===
            "company_admin"
          ? setupToken
          : undefined;

    const runtimePathResources =
      await resolveRuntimePathResources({
        apiUrl,
        token: resolverToken,
        persona: rawPersona,
        testCase:
          catalogResolvedRawTestCase,
        context: baseContextForCase,
      });

    /*
     * Keep runtime fixture values case-local.
     *
     * A positive 200 case may receive a real invoiceId,
     * while a 404/403 negative case must remain unresolved
     * unless a dedicated negative-fixture policy exists.
     */
    const executionContextForCase:
      ApiExecutionContext = {
      ...baseContextForCase,
      ...runtimePathResources,
    };

    const testCase = resolveTestCase(
      catalogResolvedRawTestCase,
      executionContextForCase
    );
    const method = String(testCase.method || "").trim().toUpperCase();
    const path = String(testCase.path || "").trim();
    const persona = String(testCase.persona || "").trim();

    console.log(`Testing: [${testCase.id}] ${method} ${path} (Rol: ${persona})`);

    if (catalogResolvedRawTestCase.path !== testCase.path) {
      console.log(
        ` Resolved path from "${catalogResolvedRawTestCase.path}" to "${testCase.path}"`
      );
    } else if (rawTestCase.path !== catalogResolvedRawTestCase.path) {
      console.log(` Resolved path from "${rawTestCase.path}" to "${testCase.path}"`);
    }

    const unresolvedContractBlockReason =
      hasUnknownMethod
        ? "HTTP method is UNKNOWN. The canonical API contract must be resolved before execution."
        : isUnknownPathWithOptionalQuery(path)
          ? "API path is UNKNOWN. The canonical endpoint must be resolved before execution."
          : undefined;

    const blockReason =
      unresolvedContractBlockReason ??
      getBlockReason(testCase);

    if (blockReason) {
      results.push({
        id: testCase.id,
        persona,
        method,
        originalPath: rawTestCase.path,
        resolvedPath: path,
        expectedStatus: testCase.expect?.status,
        actualStatus: "",
        status: "BLOCKED",
        reasonCategory:
          blockReason.startsWith(
            "API fixture gate blocked"
          )
            ? "TEST_DATA_ISSUE"
            : "MISSING_API_CONTEXT",
        notes: blockReason,
      });

      console.log(` Result: BLOCKED (${blockReason})`);
      continue;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (persona !== "unauthenticated") {
        const token = await getIdTokenForPersona(persona as any);
        headers.Authorization = `Bearer ${token}`;
      }

      const requestOptions: RequestInit = {
        method,
        headers,
      };

      if (testCase.body !== undefined && !["GET", "HEAD"].includes(method)) {
        requestOptions.body = JSON.stringify(testCase.body);
      }

      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const url = `${apiUrl}${normalizedPath}`;

      const response = await fetch(url, requestOptions);
      const responseText = await response.text();

      let responseBody: any = responseText;

      try {
        responseBody = responseText ? JSON.parse(responseText) : "";
      } catch {
        responseBody = responseText;
      }

      if (response.status === testCase.expect.status) {
        const semanticEvaluation =
          evaluateApiSemanticExpectations({
            testCase,
            path,
            responseStatus:
              response.status,
            responseBody,
          });

if (
  semanticEvaluation.outcome ===
    "BLOCKED"
) {
  results.push({
    id: testCase.id,
    persona,
    method,
    originalPath:
      rawTestCase.path,
    resolvedPath: path,
    expectedStatus:
      testCase.expect?.status,
    actualStatus:
      response.status,
    status: "BLOCKED",
    reasonCategory:
      "TEST_DATA_ISSUE",
    notes:
      semanticEvaluation.notes,
  });

  console.log(
    ` Result: BLOCKED (Fixture unavailable: ${semanticEvaluation.notes})`
  );
} else if (
  semanticEvaluation.outcome ===
    "FAIL"
) {
          results.push({
            id: testCase.id,
            persona,
            method,
            originalPath:
              rawTestCase.path,
            resolvedPath: path,
            expectedStatus:
              testCase.expect?.status,
            actualStatus:
              response.status,
            status: "FAIL",
            reasonCategory:
              "API_SEMANTIC_ASSERTION_FAILED",
            notes:
              semanticEvaluation.notes,
          });

          console.log(
            ` Result: FAIL (Semantic assertion: ${semanticEvaluation.notes})`
          );
        } else if (
          semanticEvaluation.outcome ===
          "MANUAL_REQUIRED"
        ) {
          results.push({
            id: testCase.id,
            persona,
            method,
            originalPath:
              rawTestCase.path,
            resolvedPath: path,
            expectedStatus:
              testCase.expect?.status,
            actualStatus:
              response.status,
            status:
              "MANUAL_REQUIRED",
            reasonCategory:
              "API_SEMANTIC_ASSERTION_UNVERIFIED",
            notes:
              semanticEvaluation.notes,
          });

          console.log(
            ` Result: MANUAL_REQUIRED (Semantic assertion could not be verified: ${semanticEvaluation.notes})`
          );
        } else {
          const unverifiedSemanticReason =
            semanticEvaluation.outcome ===
              "NOT_APPLICABLE" &&
            response.status >= 200 &&
            response.status < 300
              ? getUnverifiedApiSemanticRequirementReason(
                  testCase
                )
              : null;

          if (unverifiedSemanticReason) {
            results.push({
              id: testCase.id,
              persona,
              method,
              originalPath:
                rawTestCase.path,
              resolvedPath: path,
              expectedStatus:
                testCase.expect?.status,
              actualStatus:
                response.status,
              status:
                "MANUAL_REQUIRED",
              reasonCategory:
                "API_SEMANTIC_ASSERTION_UNSUPPORTED",
              notes:
                unverifiedSemanticReason,
            });

            console.log(
              ` Result: MANUAL_REQUIRED (Limited API assertion: ${unverifiedSemanticReason})`
            );
          } else {
            const semanticNotes =
              semanticEvaluation.outcome ===
              "PASS"
                ? semanticEvaluation.notes
                : "";

            results.push({
              id: testCase.id,
              persona,
              method,
              originalPath:
                rawTestCase.path,
              resolvedPath: path,
              expectedStatus:
                testCase.expect?.status,
              actualStatus:
                response.status,
              status: "PASS",
              reasonCategory:
                semanticEvaluation.outcome ===
                "PASS"
                  ? "API_SEMANTIC_ASSERTIONS_PASSED"
                  : "EXPECTED_STATUS_MATCHED",
              notes: semanticNotes,
            });

            /*
             * API_BROWSER_RUNTIME_HANDOFF_V1
             *
             * Promote only resources used by a successful
             * positive read case. Negative fixtures and
             * unresolved resources remain case-local.
             */
            promoteRuntimeResourcesForHandoff({
              runtimeContexts,
              persona,
              method,
              expectedStatus:
                testCase.expect?.status,
              actualStatus:
                response.status,
              resources:
                runtimePathResources,
              testCaseId:
                String(
                  testCase.id ||
                    "case"
                ),
            });

            if (semanticNotes) {
              console.log(
                ` Result: PASS (Semantic assertions: ${semanticNotes})`
              );
            } else {
              console.log(
                " Result: PASS"
              );
            }
          }
        }
      } else {
        results.push({
          id: testCase.id,
          persona,
          method,
          originalPath: rawTestCase.path,
          resolvedPath: path,
          expectedStatus: testCase.expect?.status,
          actualStatus: response.status,
          status: "FAIL",
          reasonCategory: "API_EXPECTATION_FAILED",
          notes: `Expected: ${testCase.expect.status}, Given: ${response.status}. Body: ${JSON.stringify(responseBody).slice(0, 1000)}`,
        });

        console.log(
          ` Result: FAIL (Expected: ${testCase.expect.status}, Given: ${response.status})`
        );
        console.log(" Response body:", responseBody);
      }
    } catch (error: any) {
      results.push({
        id: testCase.id,
        persona,
        method,
        originalPath: rawTestCase.path,
        resolvedPath: path,
        expectedStatus: testCase.expect?.status,
        actualStatus: "ERROR",
        status: "ERROR",
        reasonCategory: "AGENT_RUNTIME_ERROR",
        notes: `Agent/runtime execution error: ${error.message}`,
      });

      console.log(` Result: ERROR (Agent/runtime execution error: ${error.message})`);
    }
  }

  return results;
}