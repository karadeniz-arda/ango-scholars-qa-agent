import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD";

type ApiEndpointEntry = {
  method: HttpMethod;
  path: string;
  file: string;
  params: string[];
  area: string;
  source: "source-scan";
};

type ApiEndpointsManifest = {
  generatedAt: string;
  sourceRoots: string[];
  endpoints: ApiEndpointEntry[];
};

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function normalizeFilePath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}

function shouldSkipDir(dirName: string): boolean {
  return [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    "storybook-static",
  ].includes(dirName);
}

function walkFiles(root: string): string[] {
  const output: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) walk(fullPath);
        continue;
      }

      if (entry.isFile()) output.push(fullPath);
    }
  }

  walk(root);
  return output;
}

function isApiCandidateFile(filePath: string): boolean {
  const normalized = normalizeFilePath(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  if (!/\.(ts|tsx|js|jsx|json|yaml|yml)$/.test(fileName)) return false;

  return (
    normalized.includes("/api/") ||
    normalized.includes("/endpoints/") ||
    normalized.includes("/services/") ||
    normalized.includes("openapi") ||
    normalized.includes("swagger") ||
    normalized.includes("scholars-server") ||
    fileName.includes("api") ||
    fileName.includes("endpoint")
  );
}

function normalizeApiPath(rawPath: string): string | undefined {
  let value = rawPath.trim();

  value = value
    .replaceAll("${companyId}", "{companyId}")
    .replaceAll("${projectId}", "{projectId}")
    .replaceAll("${jobId}", "{jobId}")
    .replaceAll("${talentId}", "{talentId}")
    .replaceAll("${assessmentId}", "{assessmentId}")
    .replaceAll("${id}", "{id}")
    .replaceAll("${familyId}", "{familyId}")
    .replaceAll("${workSetupId}", "{workSetupId}")
    .replaceAll("${talentJobWorkSetupId}", "{talentJobWorkSetupId}");

  value = value.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

  value = value.split("?")[0] || value;

  if (!value.startsWith("/")) return undefined;

  if (
    !value.startsWith("/companies") &&
    !value.startsWith("/talents") &&
    !value.startsWith("/talent") &&
    !value.startsWith("/skills") &&
    !value.startsWith("/languages") &&
    !value.startsWith("/assessments") &&
    !value.startsWith("/public") &&
    !value.startsWith("/auth")
  ) {
    return undefined;
  }

  if (value.includes(" ")) return undefined;
  if (value.length < 2) return undefined;
  if (value.length > 220) return undefined;

  return value;
}

function extractParams(apiPath: string): string[] {
  const params = new Set<string>();

  for (const match of apiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    params.add(match[1]!);
  }

  return [...params];
}

function inferArea(apiPath: string, filePath: string): string {
  const text = `${apiPath} ${filePath}`.toLowerCase();

  if (text.includes("work-setup") || text.includes("worksetup")) return "work-setups";
  if (text.includes("talent-job-work-setup")) return "work-setups";
  if (text.includes("skill")) return "skills";
  if (text.includes("language")) return "languages";
  if (text.includes("assessment")) return "assessments";
  if (text.includes("job")) return "jobs";
  if (text.includes("project")) return "projects";

  /**
   * Invoice endpoints belong to the payments domain. Evaluate this
   * before contracts/offers because invoice routes may be nested
   * beneath another resource while still representing payment data.
   */
  if (
    text.includes("invoice") ||
    text.includes("payment") ||
    text.includes("payout") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  if (text.includes("contract")) return "contracts";
  if (text.includes("offer")) return "offers";

  return "unknown";
}

function nearbyMethod(content: string, index: number): HttpMethod | undefined {
  const before = content.slice(Math.max(0, index - 700), index);
  const after = content.slice(index, Math.min(content.length, index + 700));
  const windowText = `${before}\n${after}`;

  const methodPatterns: Array<[HttpMethod, RegExp[]]> = [
    ["GET", [/\bmethod\s*:\s*["'`]get["'`]/i, /\bmethod\s*=\s*["'`]get["'`]/i, /\bget\s*\(/i, /\.get\s*\(/i]],
    ["POST", [/\bmethod\s*:\s*["'`]post["'`]/i, /\bmethod\s*=\s*["'`]post["'`]/i, /\bpost\s*\(/i, /\.post\s*\(/i]],
    ["PATCH", [/\bmethod\s*:\s*["'`]patch["'`]/i, /\bmethod\s*=\s*["'`]patch["'`]/i, /\bpatch\s*\(/i, /\.patch\s*\(/i]],
    ["PUT", [/\bmethod\s*:\s*["'`]put["'`]/i, /\bmethod\s*=\s*["'`]put["'`]/i, /\bput\s*\(/i, /\.put\s*\(/i]],
    ["DELETE", [/\bmethod\s*:\s*["'`]delete["'`]/i, /\bmethod\s*=\s*["'`]delete["'`]/i, /\bdelete\s*\(/i, /\.delete\s*\(/i]],
    ["HEAD", [/\bmethod\s*:\s*["'`]head["'`]/i, /\bmethod\s*=\s*["'`]head["'`]/i, /\bhead\s*\(/i, /\.head\s*\(/i]],
  ];

  for (const [method, patterns] of methodPatterns) {
    if (patterns.some((pattern) => pattern.test(windowText))) return method;
  }

  return undefined;
}

function extractEndpointsFromFile(sourceRoot: string, filePath: string): ApiEndpointEntry[] {
  const content = fs.readFileSync(filePath, "utf8");
  const relativeFile = normalizeFilePath(path.relative(sourceRoot, filePath));
  const endpoints: ApiEndpointEntry[] = [];

  const pathRegex =
    /["'`]((?:\/(?:companies|talents|talent|skills|languages|assessments|public|auth)[A-Za-z0-9_/$?&=.:{}-]*))["'`]/g;

  for (const match of content.matchAll(pathRegex)) {
    const rawPath = match[1] || "";
    const apiPath = normalizeApiPath(rawPath);

    if (!apiPath) continue;

    const method = nearbyMethod(content, match.index ?? 0) || "GET";

    endpoints.push({
      method,
      path: apiPath,
      file: relativeFile,
      params: extractParams(apiPath),
      area: inferArea(apiPath, relativeFile),
      source: "source-scan",
    });
  }

  return endpoints;
}

function dedupeEndpoints(endpoints: ApiEndpointEntry[]): ApiEndpointEntry[] {
  const map = new Map<string, ApiEndpointEntry>();

  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, endpoint);
      continue;
    }

    if (endpoint.params.length < existing.params.length) {
      map.set(key, endpoint);
    }
  }

  return [...map.values()].sort((a, b) => {
    const byArea = a.area.localeCompare(b.area);
    if (byArea !== 0) return byArea;

    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;

    return a.method.localeCompare(b.method);
  });
}

function buildManifest(sourceRoots: string[]): ApiEndpointsManifest {
  const allEndpoints: ApiEndpointEntry[] = [];
  const existingRoots = sourceRoots.filter((root) => fs.existsSync(root));

  for (const root of existingRoots) {
    const files = walkFiles(root).filter(isApiCandidateFile);

    for (const file of files) {
      allEndpoints.push(...extractEndpointsFromFile(root, file));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceRoots: existingRoots.map((root) => path.resolve(root)),
    endpoints: dedupeEndpoints(allEndpoints),
  };
}

function main() {
  const rawRoots =
    getArg("--source-roots") ||
    process.env.QA_API_SOURCE_ROOTS ||
    "../ango-scholars-client,../ango-scholars-server";

  const sourceRoots = rawRoots
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean);

  const outPath =
    getArg("--out") ||
    process.env.QA_API_ENDPOINTS_MANIFEST ||
    "config/api-endpoints.manifest.yaml";

  const manifest = buildManifest(sourceRoots);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, yaml.stringify(manifest), "utf8");

  console.log(`API endpoints manifest written to ${outPath}`);
  console.log(`Source roots: ${manifest.sourceRoots.join(", ") || "none found"}`);
  console.log(`Endpoints discovered: ${manifest.endpoints.length}`);

  const byArea = new Map<string, number>();
  for (const endpoint of manifest.endpoints) {
    byArea.set(endpoint.area, (byArea.get(endpoint.area) || 0) + 1);
  }

  console.log("Areas:");
  for (const [area, count] of [...byArea.entries()].sort()) {
    console.log(`- ${area}: ${count}`);
  }
}

main();