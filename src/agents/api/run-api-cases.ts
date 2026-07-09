import fs from "node:fs";
import yaml from "yaml";
import type { TestPlan } from "../../planner/types.js";
import { getIdTokenForPersona } from "../../auth/firebase.js";
import { resolveExecutionContext, type ExecutionContext } from "./setup-resolver.js";

type SupportedPersona = "company_admin" | "talent" | "unauthenticated";

const supportedPersonas = new Set<SupportedPersona>([
  "company_admin",
  "talent",
  "unauthenticated",
]);

function getCaseNotes(testCase: any): string {
  return testCase.notes || testCase.expect?.notes || testCase.expect?.note || "";
}

function resolveUnknownQueryParams(path: string, context: ExecutionContext): string {
  if (!path.includes("?")) return path;

  const [basePath, rawQuery] = path.split("?");

  if (!rawQuery) return basePath!;

  const params = new URLSearchParams(rawQuery);

  for (const [key, value] of Array.from(params.entries())) {
    const upperValue = String(value).toUpperCase();

    if (upperValue !== "UNKNOWN") continue;

    if (key === "projectId" && context.projectId) {
      params.set(key, context.projectId);
      continue;
    }

    if (key === "jobId" && context.jobId) {
      params.set(key, context.jobId);
      continue;
    }

    params.delete(key);
  }

  const cleanedQuery = params.toString();

  return cleanedQuery ? `${basePath}?${cleanedQuery}` : basePath!;
}

function resolvePath(path: string, context: ExecutionContext): string {
  let resolvedPath = String(path || "").trim();

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

  resolvedPath = resolveUnknownQueryParams(resolvedPath, context);

  return resolvedPath;
}

function resolveTestCase(testCase: any, context: ExecutionContext): any {
  return {
    ...testCase,
    path: resolvePath(testCase.path, context),
  };
}

function getBlockReason(testCase: any): string | null {
  const persona = String(testCase.persona || "").trim();
  const path = String(testCase.path || "").trim();
  const method = String(testCase.method || "").trim().toUpperCase();
  const notes = getCaseNotes(testCase).toLowerCase();

  if (!supportedPersonas.has(persona as SupportedPersona)) {
    return `Unsupported persona "${persona}". Supported personas: company_admin, talent, unauthenticated.`;
  }

  if (!path || path.toUpperCase().includes("UNKNOWN")) {
    return `API path contains UNKNOWN value: ${path}. Setup data or GitHub/API context is needed before this case can be executed.`;
  }

  if (/{[^}]+}/.test(path)) {
    return `API path contains unresolved placeholder: ${path}`;
  }

  if (["POST", "PATCH", "PUT"].includes(method) && testCase.body === undefined) {
    return `${method} request has no body. GitHub diff/API contract is needed to build a valid request payload.`;
  }

  if (testCase.body !== undefined && JSON.stringify(testCase.body).toUpperCase().includes("UNKNOWN")) {
    return `${method} request body contains UNKNOWN setup data. Real test data is needed before this case can be executed.`;
  }

  return null;
}

export async function runApiCases() {
  console.log("\nAPI Tests starting..");

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const apiUrl = String(config.environments.staging.api_url).replace(/\/$/, "");
  const setupToken = await getIdTokenForPersona("company_admin");
  const executionContext = await resolveExecutionContext(apiUrl, setupToken);

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
          notes: `Expected: ${testCase.expect.status}, Given: ${response.status}. Body: ${JSON.stringify(responseBody).slice(0, 1000)}`,
        });

        console.log(` Result: FAIL (Expected: ${testCase.expect.status}, Given: ${response.status})`);
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
        status: "FAIL",
        notes: `Execution Error: ${error.message}`,
      });

      console.log(` Result: FAIL (Execution Error: ${error.message})`);
    }
  }

  return results;
}