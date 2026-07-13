import fs from "node:fs";
import yaml from "yaml";
import type { TestPlan } from "../../planner/types.js";
import { getIdTokenForPersona } from "../../auth/firebase.js";
import { resolveExecutionContext, type ExecutionContext } from "./setup-resolver.js";

type SupportedPersona = "company_admin" | "talent" | "unauthenticated";

type ApiExecutionContext = ExecutionContext & {
  workSetupId?: string | undefined;
  familyId?: string | undefined;
  talentId?: string | undefined;
  talentJobWorkSetupId?: string | undefined;
  id?: string | undefined;
};

const supportedPersonas = new Set<SupportedPersona>([
  "company_admin",
  "talent",
  "unauthenticated",
]);

function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/$/, "");
}

function getCaseNotes(testCase: any): string {
  return testCase.notes || testCase.expect?.notes || testCase.expect?.note || "";
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

  return context;
}

function resolveUnknownQueryParams(
  path: string,
  context: ApiExecutionContext
): string {
  if (!path.includes("?")) return path;

  const [basePath, rawQuery] = path.split("?");

  if (!rawQuery) return basePath!;

  const params = new URLSearchParams(rawQuery);

  for (const [key, value] of Array.from(params.entries())) {
    const upperValue = String(value).toUpperCase();

    if (upperValue !== "UNKNOWN") continue;

    if (key === "companyId" && context.companyId) {
      params.set(key, context.companyId);
      continue;
    }

    if (key === "projectId" && context.projectId) {
      params.set(key, context.projectId);
      continue;
    }

    if (key === "jobId" && context.jobId) {
      params.set(key, context.jobId);
      continue;
    }

    if (key === "talentId" && context.talentId) {
      params.set(key, context.talentId);
      continue;
    }

    params.delete(key);
  }

  const cleanedQuery = params.toString();

  return cleanedQuery ? `${basePath}?${cleanedQuery}` : basePath!;
}

function resolvePath(path: string, context: ApiExecutionContext): string {
  let resolvedPath = String(path || "").trim();

  const replacements: Record<string, string | undefined> = {
    companyId: context.companyId,
    projectId: context.projectId,
    jobId: context.jobId,
    id: context.id ?? context.workSetupId,
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

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const cleanPlanFile = planFile
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const plan: TestPlan = JSON.parse(cleanPlanFile);
  const results = [];

  for (const rawTestCase of plan.apiCases as any[]) {
    const testCase = resolveTestCase(rawTestCase, executionContext);

    const method = String(testCase.method || "").trim().toUpperCase();
    const path = String(testCase.path || "").trim();
    const persona = String(testCase.persona || "").trim();

    console.log(`Testing: [${testCase.id}] ${method} ${path} (Rol: ${persona})`);

    if (rawTestCase.path !== testCase.path) {
      console.log(` Resolved path from "${rawTestCase.path}" to "${testCase.path}"`);
    }

    const blockReason = getBlockReason(testCase);

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
        reasonCategory: "MISSING_API_CONTEXT",
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
        results.push({
          id: testCase.id,
          persona,
          method,
          originalPath: rawTestCase.path,
          resolvedPath: path,
          expectedStatus: testCase.expect?.status,
          actualStatus: response.status,
          status: "PASS",
          reasonCategory: "EXPECTED_STATUS_MATCHED",
          notes: "",
        });

        console.log(" Result: PASS");
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