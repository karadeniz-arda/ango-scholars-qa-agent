import { findApiEndpointCandidateFromCatalog } from "../discovery/api-endpoint-catalog.js";
import { discoverBrowserRouteCandidates } from "../discovery/route-candidate-discovery.js";
import {
  escapeRegularExpression,
  isDeepBrowserCase,
  isGenericBrowserEntryRoute,
} from "./planner-browser-policy.js";

function isUnknownApiPath(path: unknown): boolean {
  const value = String(path ?? "").trim().toUpperCase();

  return value === "UNKNOWN" || value.startsWith("UNKNOWN?");
}

function isUnknownMethod(method: unknown): boolean {
  const value = String(method ?? "").trim().toUpperCase();

  return value === "" || value === "UNKNOWN";
}

function isUnknownBrowserRoute(route: unknown): boolean {
  return String(route ?? "").trim().toUpperCase() === "UNKNOWN";
}

function isExplicitBrowserSurfaceRouteCompatible(
  testCase: any,
  route: string
): boolean {
  const goal = String(
    testCase?.goal || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

  const pathname =
    String(route || "")
      .trim()
      .split(/[?#]/)[0]
      ?.replace(/\/+$/, "") || "";

  const segments = pathname
    .split("/")
    .filter(Boolean);

  const routeSurface =
    String(
      segments[segments.length - 1] || ""
    )
      .toLowerCase()
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (!goal || !routeSurface) {
    return true;
  }

  const routeTargetsAll =
    routeSurface.startsWith("all ");

  const baseSurface = routeTargetsAll
    ? routeSurface.slice(4).trim()
    : routeSurface;

  if (!baseSurface) {
    return true;
  }

  const explicitPageTarget =
    goal.match(
      new RegExp(
        `\\b(all\\s+)?` +
          `${escapeRegularExpression(
            baseSurface
          )}\\s+page\\b`,
        "i"
      )
    );

  /*
   * The goal does not explicitly distinguish
   * an X page from an All X page.
   */
  if (!explicitPageTarget) {
    return true;
  }

  const goalTargetsAll =
    Boolean(explicitPageTarget[1]);

  return (
    goalTargetsAll === routeTargetsAll
  );
}

function mergeResolvedApiPath(
  originalPath: unknown,
  resolvedPath: string
): string {
  const original = String(originalPath ?? "").trim();
  const queryIndex = original.indexOf("?");

  if (queryIndex === -1) {
    return resolvedPath;
  }

  const query = original.slice(queryIndex + 1).trim();

  if (!query) {
    return resolvedPath;
  }

  return resolvedPath.includes("?")
    ? `${resolvedPath}&${query}`
    : `${resolvedPath}?${query}`;
}

function isConcretePlannerRoute(route: string): boolean {
  const value = route.trim();

  if (!value.startsWith("/")) return false;
  if (value.toUpperCase().includes("UNKNOWN")) return false;
  if (value.includes("{") || value.includes("}")) return false;
  if (/:[A-Za-z0-9_]+/.test(value)) return false;

  return true;
}

function isMutatingApiMethod(method: unknown): boolean {
  const value = String(method ?? "")
    .trim()
    .toUpperCase();

  return ["POST", "PATCH", "PUT", "DELETE"].includes(
    value
  );
}

export function enrichTestPlanWithDiscovery(plan: any): any {
  const apiCases = Array.isArray(plan?.apiCases)
    ? plan.apiCases
    : [];

  const browserCases = Array.isArray(plan?.browserCases)
    ? plan.browserCases
    : [];

  let resolvedApiPaths = 0;
  let resolvedApiMethods = 0;
  let resolvedBrowserRoutes = 0;

  for (const apiCase of apiCases) {
    const needsPathResolution = isUnknownApiPath(
      apiCase?.path
    );

    const needsMethodResolution = isUnknownMethod(
      apiCase?.method
    );

    if (!needsPathResolution && !needsMethodResolution) {
      continue;
    }

    /**
     * Do not guess both the HTTP method and endpoint.
     * Apply/reject-style cases must stay unresolved until
     * their canonical API contract is known.
     */
    if (needsMethodResolution) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `HTTP method is unknown.`
      );
      continue;
    }

    /**
     * Mutating operations require an exact canonical endpoint.
     * Area-level catalog scoring is not sufficient because it
     * can incorrectly map change-request creation to job creation.
     */
    if (
      needsPathResolution &&
      isMutatingApiMethod(apiCase?.method)
    ) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `${String(apiCase?.method || "").toUpperCase()} path requires an exact contract.`
      );
      continue;
    }

    const candidate = findApiEndpointCandidateFromCatalog(
      plan,
      apiCase
    );

    if (!candidate) {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: no candidate.`
      );
      continue;
    }

    if (candidate.confidence !== "high") {
      console.log(
        ` Discovery enrichment left API ${apiCase?.id ?? "case"} unresolved: ` +
          `${candidate.confidence} confidence candidate ${candidate.method} ${candidate.path}.`
      );
      continue;
    }

    if (needsPathResolution) {
      const originalPath = apiCase.path;

      apiCase.path = mergeResolvedApiPath(
        originalPath,
        candidate.path
      );

      resolvedApiPaths += 1;
    }

    if (needsMethodResolution) {
      apiCase.method = candidate.method;
      resolvedApiMethods += 1;
    }

    console.log(
      ` Discovery enriched API ${apiCase?.id ?? "case"}: ` +
        `${apiCase.method} ${apiCase.path} (${candidate.confidence})`
    );
  }

  for (const browserCase of browserCases) {
    if (!isUnknownBrowserRoute(browserCase?.startRoute)) {
      continue;
    }

    const deepCase =
      isDeepBrowserCase(browserCase);

    const candidate = discoverBrowserRouteCandidates(
      plan,
      browserCase
    ).find((item) => {
      if (item.confidence !== "high") {
        return false;
      }

      if (!isConcretePlannerRoute(item.route)) {
        return false;
      }

      if (
  !isExplicitBrowserSurfaceRouteCompatible(
    browserCase,
    item.route
  )
) {
  return false;
}

      /**
       * A generic list/landing page is not enough for
       * job details, comparison, modal, or review cases.
       */
      if (
        deepCase &&
        isGenericBrowserEntryRoute(item.route)
      ) {
        return false;
      }

      return true;
    });

    if (!candidate) {
      console.log(
        ` Discovery enrichment left browser ${browserCase?.id ?? "case"} unresolved: ` +
          `${
            deepCase
              ? "deep UI case has no safe concrete detail route."
              : "no high-confidence concrete route."
          }`
      );
      continue;
    }

    browserCase.startRoute = candidate.route;
    resolvedBrowserRoutes += 1;

    console.log(
      ` Discovery enriched browser ${browserCase?.id ?? "case"}: ` +
        `${candidate.route} (${candidate.confidence}, ${candidate.source})`
    );
  }

  console.log(
    ` Discovery enrichment summary: ` +
      `${resolvedApiPaths} API paths, ` +
      `${resolvedApiMethods} API methods, ` +
      `${resolvedBrowserRoutes} browser routes resolved.`
  );

  return plan;
}
