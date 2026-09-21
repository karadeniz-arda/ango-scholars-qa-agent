import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "yaml";
import {
  recoverStaticSurfaceRoutes,
  type StaticSurfaceRouteDerivation,
  type StaticSurfaceRouteKind,
} from "./static-surface-route-extraction.js";
import type { SourceBackedSurfaceIdentity } from "./source-surface-provenance.js";
import {
  extractSourceBackedSurfaceIdentities,
} from "./source-surface-provenance.js";

export type UiRouteEntry = {
  path: string;
  file: string;
  params: string[];
  area: string;
  persona: "company_admin" | "talent" | "admin" | "unknown";
  origin?: "UI_ROUTE_MANIFEST";
  authoritative?: true;
  derivation?: StaticSurfaceRouteDerivation;
  routeKind?: StaticSurfaceRouteKind;
  sourceRef?: string;
  childRoute?: string;
  parentRoute?: string;
  parentSourceRef?: string;
  mountedComponents?: string[];
  mountedComponentSources?: Array<{ componentName: string; file: string }>;
  surfaceIdentity?: SourceBackedSurfaceIdentity;
};

export type UiRoutesManifest = {
  generatedAt: string;
  sourceRoot: string;
  routes: UiRouteEntry[];
};

function getArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index === -1) return undefined;

  return process.argv[index + 1];
}

function normalizePath(filePath: string): string {
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
        if (!shouldSkipDir(entry.name)) {
          walk(fullPath);
        }

        continue;
      }

      if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }

  walk(root);

  return output;
}

function isRouteCandidateFile(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();

  if (!/\.(ts|tsx|js|jsx)$/.test(fileName)) return false;

  return (
    fileName.includes("route") ||
    fileName.includes("router") ||
    fileName === "routes.ts" ||
    fileName === "routes.tsx" ||
    normalized.includes("/routes/") ||
    normalized.includes("/router/")
  );
}

function extractParams(routePath: string): string[] {
  const params = new Set<string>();

  for (const match of routePath.matchAll(/:([A-Za-z0-9_]+)/g)) {
    params.add(match[1]!);
  }

  for (const match of routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    params.add(match[1]!);
  }

  for (const match of routePath.matchAll(/\$([A-Za-z0-9_]+)/g)) {
    params.add(match[1]!);
  }

  return [...params];
}

function inferPersona(routePath: string): UiRouteEntry["persona"] {
  if (routePath.startsWith("/company")) return "company_admin";
  if (routePath.startsWith("/talent")) return "talent";
  if (routePath.startsWith("/admin")) return "admin";

  return "unknown";
}

function inferArea(routePath: string, filePath: string): string {
  const text = `${routePath} ${filePath}`.toLowerCase();

  if (text.includes("work-setup") || text.includes("worksetup")) {
    return "work-setups";
  }

  if (text.includes("skill")) {
    return "skills";
  }

  if (text.includes("job")) {
    return "jobs";
  }

  if (text.includes("payment") || text.includes("timesheet")) {
    return "payments";
  }

  if (text.includes("language") || text.includes("proficiency")) {
    return "languages";
  }

  if (text.includes("assessment")) {
    return "assessments";
  }

  if (text.includes("contract")) {
    return "contracts";
  }

  if (text.includes("talent")) {
    return "talent";
  }

  return "unknown";
}

function extractRoutesFromFile(clientRoot: string, filePath: string): UiRouteEntry[] {
  const content = fs.readFileSync(filePath, "utf8");
  const relativeFile = normalizePath(path.relative(clientRoot, filePath));

  const routes = new Map<string, UiRouteEntry>();

  /**
   * Only collect browser UI routes.
   * We intentionally avoid API paths like /companies/{companyId}/...
   */
  const absoluteRouteRegex =
    /["'`]((?:\/(?:company|talent|admin)[A-Za-z0-9_/$?&=.:{}-]*))["'`]/g;

  for (const match of content.matchAll(absoluteRouteRegex)) {
    const routePath = String(match[1] || "").trim();

    if (!routePath) continue;

    routes.set(routePath, {
      path: routePath,
      file: relativeFile,
      params: extractParams(routePath),
      area: inferArea(routePath, relativeFile),
      persona: inferPersona(routePath),
    });
  }

  return [...routes.values()];
}

export function buildUiRoutesManifest(
  clientRoot: string
): UiRoutesManifest {
  const allFiles = walkFiles(clientRoot);
  const routeFiles = allFiles.filter(isRouteCandidateFile);
  const sourceInputs = allFiles
    .filter((file) => /\.(?:ts|tsx|js|jsx)$/i.test(file))
    .map((file) => ({
      file: normalizePath(path.relative(clientRoot, file)),
      source: fs.readFileSync(file, "utf8"),
    }));

  const routeMap = new Map<string, UiRouteEntry>();

  for (const file of routeFiles) {
    const routes = extractRoutesFromFile(clientRoot, file);

    for (const route of routes) {
      const existing = routeMap.get(route.path);

      if (!existing) {
        routeMap.set(route.path, route);
        continue;
      }

      /**
       * Prefer entries with fewer params as safer start routes.
       */
      if (route.params.length < existing.params.length) {
        routeMap.set(route.path, route);
      }
    }
  }

  const structuralRoutes =
    recoverStaticSurfaceRoutes(sourceInputs);

  for (const route of structuralRoutes) {
    const existing = routeMap.get(route.route);
    if (existing) {
      if (route.mountedComponents || route.mountedComponentSources) {
        routeMap.set(route.route, {
          ...existing,
          ...(route.mountedComponents ? { mountedComponents: route.mountedComponents } : {}),
          ...(route.mountedComponentSources ? { mountedComponentSources: route.mountedComponentSources } : {}),
        });
      }
      continue;
    }
    if (route.routeKind !== "STATIC") continue;

    const sourceFile =
      route.sourceRef.replace(/:\d+$/, "");

    routeMap.set(route.route, {
      path: route.route,
      file: sourceFile,
      params: extractParams(route.route),
      area: inferArea(route.route, sourceFile),
      persona: inferPersona(route.route),
      origin: route.origin,
      authoritative: true,
      derivation: route.derivation,
      routeKind: route.routeKind,
      sourceRef: route.sourceRef,
      childRoute: route.childRoute,
      ...(route.mountedComponents
        ? { mountedComponents: route.mountedComponents }
        : {}),
      ...(route.mountedComponentSources
        ? { mountedComponentSources: route.mountedComponentSources }
        : {}),
      ...(route.parentRoute
        ? { parentRoute: route.parentRoute }
        : {}),
      ...(route.parentSourceRef
        ? {
            parentSourceRef:
              route.parentSourceRef,
          }
        : {}),
    });
  }

  const routes = [...routeMap.values()].sort((a, b) =>
    a.path.localeCompare(b.path)
  );

  const surfaceIdentities = extractSourceBackedSurfaceIdentities({
    routes: routes.map((route) => ({
      route: route.path,
      ...(route.file ? { file: route.file } : {}),
      persona: route.persona,
      ...(route.routeKind ? { routeKind: route.routeKind } : {}),
      ...(route.mountedComponents
        ? { mountedComponents: route.mountedComponents }
        : {}),
      ...(route.mountedComponentSources
        ? { mountedComponentSources: route.mountedComponentSources }
        : {}),
    })),
    sources: sourceInputs,
  });
  const identityByRoute = new Map(
    surfaceIdentities.map((identity) => [identity.routeRef, identity])
  );
  const enrichedRoutes = routes.map((route) => {
    const surfaceIdentity = identityByRoute.get(route.path);
    return surfaceIdentity
      ? { ...route, surfaceIdentity }
      : route;
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceRoot: path.resolve(clientRoot),
    routes: enrichedRoutes,
  };
}

function main() {
  const clientRoot =
    getArg("--client-root") ||
    process.env.QA_CLIENT_REPO_PATH ||
    "../ango-scholars-client";

  const outPath =
    getArg("--out") ||
    process.env.QA_UI_ROUTES_MANIFEST ||
    "config/ui-routes.manifest.yaml";

  if (!fs.existsSync(clientRoot)) {
    throw new Error(
      `Client root not found: ${clientRoot}. Pass --client-root or set QA_CLIENT_REPO_PATH.`
    );
  }

  const manifest = buildUiRoutesManifest(clientRoot);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, yaml.stringify(manifest), "utf8");

  console.log(`UI route manifest written to ${outPath}`);
  console.log(`Source root: ${path.resolve(clientRoot)}`);
  console.log(`Routes discovered: ${manifest.routes.length}`);
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main();
}
