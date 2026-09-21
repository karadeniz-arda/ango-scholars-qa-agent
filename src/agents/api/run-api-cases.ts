import fs from "node:fs";
import yaml from "yaml";
import type { TestPlan } from "../../planner/types.js";
import { readExecutionTestPlan } from "../../planner/compiled-test-plan.js";
import { getIdTokenForPersona } from "../../auth/firebase.js";
import { resolveExecutionContext } from "./setup-resolver.js";
import {
  copySkillsRuntimeFixture,
  deriveSkillsRuntimeRequirements,
  mergeSkillsRuntimeQuery,
  resolveSkillsRuntimeFixture,
  type SkillsRuntimeResolution,
} from "./skills-runtime-resolver.js";
import { resolveRuntimePathResources } from "./runtime-resource-resolver.js";
import {
  evaluateApiSemanticExpectations,
  getUnverifiedApiSemanticRequirementReason,
} from "./api-semantic-expectation-evaluator.js";
import {
  enrichExecutionContext,
  normalizeBaseUrl,
  resolveOwnTalentIdFromRuntime,
} from "./api-runtime-execution-context.js";
import type {
  ApiExecutionContext,
} from "./api-runtime-execution-context.js";
import {
  isUnknownPathWithOptionalQuery,
  mergeCandidatePathWithOriginalQuery,
  resolveTestCase,
} from "./api-case-resolution.js";
import {
  getBlockReason,
} from "./api-case-blocking-policy.js";
import { findApiEndpointCandidateFromCatalog } from "../../discovery/api-endpoint-catalog.js";
import type {
  RuntimeContextsByPersona,
  RuntimePersona,
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";

export type ApiCaseResults =
  any[] & {
    runtimeContexts:
      RuntimeContextsByPersona;
  };

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
    skillLabels: context.skillLabels,
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

  const plan: TestPlan = readExecutionTestPlan().plan;

  const skillsRuntimeRequirements =
    deriveSkillsRuntimeRequirements(
      plan
    );

  let skillsRuntimeResolution:
    SkillsRuntimeResolution | undefined;

  if (
    skillsRuntimeRequirements
      .requiresSelectedSkills
  ) {
    skillsRuntimeResolution =
      await resolveSkillsRuntimeFixture(
        apiUrl,
        setupToken,
        skillsRuntimeRequirements
      );

    if (
      skillsRuntimeResolution.status ===
      "READY"
    ) {
      copySkillsRuntimeFixture(
        executionContext,
        skillsRuntimeResolution.fixture
      );

      /*
       * Keep the talent context compatible with future
       * talent /skills cases as well.
       */
      copySkillsRuntimeFixture(
        talentExecutionContext,
        skillsRuntimeResolution.fixture
      );

      console.log(
        " API skills runtime resolver selected " +
          `${skillsRuntimeResolution.fixture.skillIds.length} ` +
          "existing record(s) for shared API/browser execution."
      );
    } else {
      console.log(
          " API skills runtime resolver blocked: " +
          skillsRuntimeResolution.reason
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

    const caseSkillsRuntimeRequirements =
      deriveSkillsRuntimeRequirements({
        summary: plan.summary,
        notes: (plan as any).notes,
        apiCases: [rawTestCase],
        browserCases: [],
      });

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

    let skillsRuntimeCaseFailure:
      string | undefined;

    if (
      caseSkillsRuntimeRequirements
        .requiresSelectedSkills
    ) {
      if (
        skillsRuntimeResolution?.status !==
        "READY"
      ) {
        skillsRuntimeCaseFailure =
          skillsRuntimeResolution?.reason ??
          "Selected-skill runtime context could not be resolved safely.";
      } else {
        const mergedSkillQuery =
          mergeSkillsRuntimeQuery(
            String(
              catalogResolvedRawTestCase
                .path || ""
            ),
            skillsRuntimeResolution.fixture,
            caseSkillsRuntimeRequirements
          );

        if (
          mergedSkillQuery.status ===
          "BLOCKED"
        ) {
          skillsRuntimeCaseFailure =
            mergedSkillQuery.reason;
        } else {
          catalogResolvedRawTestCase.path =
            mergedSkillQuery.path;
        }
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
      skillsRuntimeCaseFailure ??
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
