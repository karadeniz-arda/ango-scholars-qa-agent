import {
  evaluateApiDetailSemantics,
} from "./api-detail-semantic-evaluator.js";

export function getCaseNotes(testCase: any): string {
  return testCase.notes || testCase.expect?.notes || testCase.expect?.note || "";
}

export function extractItems(data: any): any[] {
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

export function firstString(...values: any[]): string | undefined {
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

export function getQueryParams(
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

export function getUnverifiedApiSemanticRequirementReason(
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

export function evaluateApiSemanticExpectations(args: {
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
