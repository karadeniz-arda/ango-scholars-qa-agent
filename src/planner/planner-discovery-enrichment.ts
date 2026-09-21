import { findApiEndpointCandidateFromCatalog } from "../discovery/api-endpoint-catalog.js";
import {
  discoverBrowserRouteCandidates,
  type RouteCandidate,
} from "../discovery/route-candidate-discovery.js";
import {
  escapeRegularExpression,
  isDeepBrowserCase,
  isGenericBrowserEntryRoute,
} from "./planner-browser-policy.js";
import type {
  PlannerRouteEvidence,
} from "./types.js";

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

type PlannerDiscoveryDependencies = {
  discoverBrowserRouteCandidates?: (
    plan: any,
    testCase: any
  ) => RouteCandidate[];
  routeEvidence?: PlannerRouteEvidence[];
};

function routeMatchesPersona(
  route: string,
  persona: unknown
): boolean {
  if (persona === "company_admin") {
    return route.startsWith("/company");
  }

  if (persona === "talent") {
    return route.startsWith("/talent");
  }

  return false;
}

function normalizeRouteForComparison(
  route: string
): string {
  const [rawPathname, query] = route.trim().split("?", 2);
  const pathname = rawPathname ?? "";
  const normalizedPath =
    pathname === "/"
      ? pathname
      : pathname.replace(/\/+$/, "");

  return query === undefined
    ? normalizedPath
    : `${normalizedPath}?${query}`;
}

function routesMatch(
  left: string,
  right: string
): boolean {
  return (
    normalizeRouteForComparison(left) ===
    normalizeRouteForComparison(right)
  );
}

function requiresRuntimeRouteIdentity(
  route: string
): boolean {
  return (
    route.includes("{") ||
    route.includes("}") ||
    /:[A-Za-z0-9_]+/.test(route) ||
    route.includes("${")
  );
}

function sourceEvidenceCandidates(
  testCase: any,
  evidence: PlannerRouteEvidence[],
  catalogCandidates: RouteCandidate[]
): RouteCandidate[] {
  const personaEvidence = evidence.filter(
    (item) =>
      routeMatchesPersona(
        item.route,
        testCase?.persona
      )
  );
  const authoritativeJiraRoutes = [
    ...new Set(
      personaEvidence
        .filter(
          (item) =>
            item.origin ===
              "JIRA_EXPLICIT_ROUTE" &&
            item.authoritative === true
        )
        .map((item) => item.route)
    ),
  ];
  const strongCatalogRoutes = new Set(
    catalogCandidates
      .filter(
        (candidate) =>
          candidate.source ===
            "ui-route-catalog" &&
          candidate.confidence === "high"
      )
      .map((candidate) =>
        normalizeRouteForComparison(
          candidate.route
        )
      )
  );

  return personaEvidence.map((item) => {
    const manifestCompatible =
      strongCatalogRoutes.has(
        normalizeRouteForComparison(
          item.route
        )
      );
    const soleJiraRoute =
      item.origin ===
        "JIRA_EXPLICIT_ROUTE" &&
      authoritativeJiraRoutes.length === 1;
    const stronglyGrounded =
      item.authoritative &&
      (soleJiraRoute || manifestCompatible);

    return {
      route: item.route,
      confidence: stronglyGrounded
        ? "high"
        : "medium",
      source: item.origin,
      origin: item.origin,
      authoritative: item.authoritative,
      ...(item.disposition
        ? {
            routeEvidenceDisposition:
              item.disposition,
          }
        : {}),
      ...(item.sourceRef
        ? { sourceRef: item.sourceRef }
        : {}),
      groundingScore:
        item.origin ===
        "JIRA_EXPLICIT_ROUTE"
          ? stronglyGrounded
            ? 1600
            : 350
          : item.origin ===
              "GITHUB_ROUTER_MAPPING"
            ? stronglyGrounded
              ? 1500
              : 300
            : 150,
      evidence: [
        item.origin,
        ...(manifestCompatible
          ? [
              "CASE_SURFACE_MANIFEST_COMPATIBLE",
            ]
          : []),
        ...(soleJiraRoute
          ? ["SOLE_PERSONA_JIRA_ROUTE"]
          : []),
      ],
      reason:
        item.reason ??
        (`Route evidence from ${item.origin}` +
          (item.sourceRef
            ? ` (${item.sourceRef}).`
            : ".")),
    };
  });
}

function dedupeCandidates(
  candidates: RouteCandidate[]
): RouteCandidate[] {
  const byRoute = new Map<string, RouteCandidate>();

  for (const candidate of candidates) {
    const key = normalizeRouteForComparison(
      candidate.route
    );
    const existing = byRoute.get(key);

    if (
      !existing ||
      getCandidateGroundingScore(candidate) >
        getCandidateGroundingScore(existing)
    ) {
      byRoute.set(key, candidate);
    }
  }

  return [...byRoute.values()].sort(
    (left, right) =>
      getCandidateGroundingScore(right) -
        getCandidateGroundingScore(left) ||
      left.route.localeCompare(right.route)
  );
}

function getCandidateGroundingScore(
  candidate: RouteCandidate
): number {
  if (
    typeof candidate.groundingScore ===
      "number" &&
    Number.isFinite(
      candidate.groundingScore
    )
  ) {
    return candidate.groundingScore;
  }

  if (candidate.source === "planner-literal") {
    return 50;
  }

  if (candidate.source === "feature-area") {
    return candidate.confidence === "high"
      ? 750
      : 200;
  }

  if (
    candidate.source ===
    "ui-route-catalog"
  ) {
    return candidate.confidence === "high"
      ? 500
      : 100;
  }

  return 0;
}

function candidateMetadata(
  candidate: RouteCandidate,
  disposition:
    | "SELECTED"
    | "REJECTED",
  rejectionReason?: string
) {
  return {
    route: candidate.route,
    confidence:
      candidate.confidence,
    source: candidate.source,
    ...(candidate.origin
      ? { origin: candidate.origin }
      : {}),
    ...(typeof candidate.authoritative ===
    "boolean"
      ? {
          authoritative:
            candidate.authoritative,
        }
      : {}),
    ...(candidate.routeEvidenceDisposition
      ? {
          routeEvidenceDisposition:
            candidate.routeEvidenceDisposition,
        }
      : {}),
    ...(candidate.sourceRef
      ? { sourceRef: candidate.sourceRef }
      : {}),
    ...(candidate.derivation
      ? {
          derivation:
            candidate.derivation,
        }
      : {}),
    ...(candidate.routeKind
      ? {
          routeKind:
            candidate.routeKind,
        }
      : {}),
    ...(candidate.parentRoute
      ? {
          parentRoute:
            candidate.parentRoute,
        }
      : {}),
    ...(candidate.parentSourceRef
      ? {
          parentSourceRef:
            candidate.parentSourceRef,
        }
      : {}),
    ...(candidate.surfaceIdentity
      ? { surfaceIdentity: candidate.surfaceIdentity }
      : {}),
    reason: candidate.reason,
    ...(Array.isArray(
      candidate.evidence
    )
      ? {
          evidence:
            candidate.evidence,
        }
      : {}),
    groundingScore:
      getCandidateGroundingScore(
        candidate
      ),
    disposition,
    ...(rejectionReason
      ? { rejectionReason }
      : {}),
  };
}

function boundRouteCandidateMetadata<
  T
>(candidates: T[]): T[] {
  return candidates.slice(0, 8);
}

export function enrichTestPlanWithDiscovery(
  plan: any,
  dependencies:
    PlannerDiscoveryDependencies = {}
): any {
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
    const originalRoute =
      String(
        browserCase?.startRoute ??
        "UNKNOWN"
      ).trim() || "UNKNOWN";

    const deepCase =
      isDeepBrowserCase(browserCase);

    const catalogAndPlannerCandidates =
      (
        dependencies
          .discoverBrowserRouteCandidates ??
        discoverBrowserRouteCandidates
      )(
        plan,
        browserCase
      );
    // Count source claims before concrete-route filtering or score-based
    // deduplication. A shared child label must not silently choose a parent.
    const sourceGroundedRoutes = new Set(catalogAndPlannerCandidates
      .filter((item) => item.confidence === "high" &&
        item.evidence?.includes("SOURCE_SURFACE_PROVENANCE") &&
        routeMatchesPersona(item.route, browserCase?.persona))
      .map((item) => normalizeRouteForComparison(item.route)));
    const discoveredCandidates =
      dedupeCandidates([
        ...sourceEvidenceCandidates(
          browserCase,
          dependencies.routeEvidence ?? [],
          catalogAndPlannerCandidates
        ),
        ...catalogAndPlannerCandidates,
      ]);
    const eligibleCandidates:
      RouteCandidate[] = [];
    const rejectedCandidates:
      ReturnType<
        typeof candidateMetadata
      >[] = [];

    for (const item of discoveredCandidates) {
      if (!routeMatchesPersona(item.route, browserCase?.persona)) {
        rejectedCandidates.push(candidateMetadata(item, "REJECTED", "PERSONA_CONFLICT"));
        continue;
      }
      if (item.confidence !== "high") {
        rejectedCandidates.push(
          candidateMetadata(
            item,
            "REJECTED",
            "HIGH_CONFIDENCE_GROUNDING_REQUIRED"
          )
        );
        continue;
      }

      if (!isConcretePlannerRoute(item.route)) {
        rejectedCandidates.push(
          candidateMetadata(
            item,
            "REJECTED",
            requiresRuntimeRouteIdentity(
              item.route
            )
              ? "ROUTE_REQUIRES_RUNTIME_IDENTITY"
              : "ROUTE_NOT_CONCRETE"
          )
        );
        continue;
      }

      if (
        !isExplicitBrowserSurfaceRouteCompatible(
          browserCase,
          item.route
        )
      ) {
        rejectedCandidates.push(
          candidateMetadata(
            item,
            "REJECTED",
            "EXPLICIT_CASE_SURFACE_MISMATCH"
          )
        );
        continue;
      }

      /**
       * A generic list/landing page is not enough for
       * job details, comparison, modal, or review cases.
       */
      if (
        deepCase &&
        isGenericBrowserEntryRoute(item.route)
      ) {
        rejectedCandidates.push(
          candidateMetadata(
            item,
            "REJECTED",
            "DEEP_CASE_REQUIRES_NON_GENERIC_ROUTE"
          )
        );
        continue;
      }

      eligibleCandidates.push(item);
    }

    const bestGroundingScore =
      eligibleCandidates.reduce(
        (best, candidate) =>
          Math.max(
            best,
            getCandidateGroundingScore(
              candidate
            )
          ),
        Number.NEGATIVE_INFINITY
      );
    const bestCandidates =
      eligibleCandidates.filter(
        (candidate) =>
          getCandidateGroundingScore(
            candidate
          ) === bestGroundingScore
      );
    const candidate =
      sourceGroundedRoutes.size <= 1 && bestCandidates.length === 1 &&
      (sourceGroundedRoutes.size === 0 || sourceGroundedRoutes.has(
        normalizeRouteForComparison(bestCandidates[0]!.route)
      ))
        ? bestCandidates[0]
        : undefined;

    if (!candidate) {
      const ambiguous =
        sourceGroundedRoutes.size > 1 || bestCandidates.length > 1;

      const hadConcretePlannerRoute =
        !isUnknownBrowserRoute(
          originalRoute
        );

      if (hadConcretePlannerRoute) {
        browserCase.startRoute = "UNKNOWN";
      }

      browserCase.routeResolution = {
        status: ambiguous
          ? "AMBIGUOUS"
          : hadConcretePlannerRoute
            ? "UNVERIFIED"
            : "UNRESOLVED",
        originalRoute,
        confidence: ambiguous
          ? "high"
          : discoveredCandidates[0]
              ?.confidence ?? "low",
        totalCandidateCount:
          discoveredCandidates.length,
        candidates:
          boundRouteCandidateMetadata([
            ...bestCandidates.map(
              (item) =>
                candidateMetadata(
                  item,
                  "REJECTED",
                  sourceGroundedRoutes.size > 1
                    ? "AMBIGUOUS_SOURCE_SURFACE_PROVENANCE"
                    : "COMPETING_EQUIVALENT_GROUNDING"
                )
            ),
            ...eligibleCandidates
              .filter(
                (item) =>
                  !bestCandidates.includes(
                    item
                  )
              )
              .map((item) =>
                candidateMetadata(
                  item,
                  "REJECTED",
                  "STRONGER_CANDIDATE_AVAILABLE"
                )
              ),
            ...rejectedCandidates,
          ]),
      };

      console.log(
        ` Discovery enrichment left browser ${browserCase?.id ?? "case"} unresolved: ` +
          `${
            ambiguous
              ? "multiple equally grounded routes."
              : deepCase
              ? "deep UI case has no safe concrete detail route."
              : "no high-confidence concrete route."
          }`
      );
      continue;
    }

    const hadConcretePlannerRoute =
      !isUnknownBrowserRoute(originalRoute);
    const plannerRouteValidated =
      hadConcretePlannerRoute &&
      routesMatch(
        originalRoute,
        candidate.route
      );

    browserCase.startRoute = candidate.route;
    browserCase.routeResolution = {
      status: plannerRouteValidated
        ? "VALIDATED"
        : hadConcretePlannerRoute
          ? "REPLACED"
          : "RESOLVED",
      originalRoute,
      selectedRoute:
        candidate.route,
      confidence:
        candidate.confidence,
      totalCandidateCount:
        discoveredCandidates.length,
      candidates:
        boundRouteCandidateMetadata([
          candidateMetadata(
            candidate,
            "SELECTED"
          ),
          ...eligibleCandidates
            .filter(
              (item) =>
                item !== candidate
            )
            .map((item) =>
              candidateMetadata(
                item,
                "REJECTED",
                "STRONGER_CANDIDATE_AVAILABLE"
              )
            ),
          ...rejectedCandidates,
        ]),
    };
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
