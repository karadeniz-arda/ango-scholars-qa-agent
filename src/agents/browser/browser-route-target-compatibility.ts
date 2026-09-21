import type {
  PlannerRouteEvidenceOrigin,
} from "../../planner/types.js";

export type AcceptanceTargetSurfaceKind =
  | "COLLECTION"
  | "DETAIL"
  | "PREPARE"
  | "EDITOR"
  | "CREATE";

export type AcceptanceTargetSurfaceRequirement = {
  status:
    | "RESOLVED"
    | "UNRESOLVED"
    | "AMBIGUOUS";
  kind?: AcceptanceTargetSurfaceKind;
  source:
    | "CANONICAL_CASE_ACCEPTANCE"
    | "NONE";
  reason: string;
};

export type AcceptanceRouteCandidate = {
  route: string;
  origin?:
    | PlannerRouteEvidenceOrigin
    | "MODEL_PROPOSAL";
  authoritative?: boolean;
  areaCompatible?: boolean;
};

export type AcceptanceCompatibleRouteSelection = {
  status:
    | "SELECTED"
    | "REQUIREMENT_UNRESOLVED"
    | "REQUIREMENT_AMBIGUOUS"
    | "NO_COMPATIBLE_ROUTE"
    | "AMBIGUOUS_COMPATIBLE_ROUTES";
  requirement:
    AcceptanceTargetSurfaceRequirement;
  selectedRoute?: string;
  compatibleRoutes: string[];
  excludedRoutes: string[];
  reason: string;
};

function normalizeAcceptanceText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function acceptanceValues(
  value: unknown
): unknown[] {
  return Array.isArray(value)
    ? value
    : [];
}

/**
 * Surface intent comes only from the canonical case acceptance
 * structure. startRoute and runtime/model action proposals are
 * deliberately excluded: they are candidates, not requirement
 * authority.
 */
export function inferAcceptanceTargetSurfaceRequirement(
  testCase: any
): AcceptanceTargetSurfaceRequirement {
  const text = normalizeAcceptanceText([
    testCase?.goal,
    testCase?.successCriteria,
    ...acceptanceValues(
      testCase?.automatedChecks
    ),
    ...acceptanceValues(
      testCase?.manualChecks
    ),
    ...acceptanceValues(
      testCase?.fixtureRequirements
    ),
  ]
    .filter(Boolean)
    .join(" "));

  const kinds = new Set<
    AcceptanceTargetSurfaceKind
  >();

  if (
    /\b(?:list|history|catalog|pagination)\b/.test(
      text
    )
  ) {
    kinds.add("COLLECTION");
  }

  if (
    /\b(?:prepare|preparation)\b/.test(
      text
    )
  ) {
    kinds.add("PREPARE");
  }

  if (
    /\b(?:detail|details|entity specific|entity-specific)\b/.test(
      text
    )
  ) {
    kinds.add("DETAIL");
  }

  if (
    /\b(?:editor|editing)\b/.test(text)
  ) {
    kinds.add("EDITOR");
  }

  if (
    /\b(?:create|creation|new record)\b/.test(
      text
    )
  ) {
    kinds.add("CREATE");
  }

  if (kinds.size === 0) {
    return {
      status: "UNRESOLVED",
      source: "NONE",
      reason:
        "Canonical case acceptance does not declare a supported target-surface distinction.",
    };
  }

  if (kinds.size > 1) {
    return {
      status: "AMBIGUOUS",
      source:
        "CANONICAL_CASE_ACCEPTANCE",
      reason:
        "Canonical case acceptance declares multiple incompatible target-surface kinds.",
    };
  }

  const kind = [...kinds][0]!;

  return {
    status: "RESOLVED",
    kind,
    source:
      "CANONICAL_CASE_ACCEPTANCE",
    reason:
      `Canonical case acceptance requires the ${kind} surface kind.`,
  };
}

function candidateHasStructuralAuthority(
  candidate: AcceptanceRouteCandidate
): boolean {
  return (
    candidate.authoritative === true &&
    candidate.origin !==
      "PLANNER_LITERAL" &&
    candidate.origin !==
      "MODEL_PROPOSAL"
  );
}

export function classifyAuthoritativeRouteSurface(
  candidate: AcceptanceRouteCandidate
): AcceptanceTargetSurfaceKind | undefined {
  if (
    !candidateHasStructuralAuthority(
      candidate
    )
  ) {
    return undefined;
  }

  const pathname =
    String(candidate.route ?? "")
      .split(/[?#]/)[0]
      ?.replace(/\/+$/, "") ?? "";
  const segments = pathname
    .split("/")
    .filter(Boolean);
  const lastSegment =
    segments.at(-1)?.toLowerCase() ?? "";

  if (lastSegment === "prepare") {
    return "PREPARE";
  }

  if (
    lastSegment === "edit" ||
    lastSegment === "editor"
  ) {
    return "EDITOR";
  }

  if (
    lastSegment === "create" ||
    lastSegment === "new"
  ) {
    return "CREATE";
  }

  if (
    segments.some((segment) =>
      /^:[A-Za-z][A-Za-z0-9_]*$/.test(
        segment
      )
    )
  ) {
    return "DETAIL";
  }

  return "COLLECTION";
}

export function selectAcceptanceCompatibleRoute(
  testCase: any,
  candidates: AcceptanceRouteCandidate[]
): AcceptanceCompatibleRouteSelection {
  const requirement =
    inferAcceptanceTargetSurfaceRequirement(
      testCase
    );

  if (requirement.status === "UNRESOLVED") {
    return {
      status: "REQUIREMENT_UNRESOLVED",
      requirement,
      compatibleRoutes: [],
      excludedRoutes: [],
      reason: requirement.reason,
    };
  }

  if (
    requirement.status === "AMBIGUOUS" ||
    !requirement.kind
  ) {
    return {
      status: "REQUIREMENT_AMBIGUOUS",
      requirement,
      compatibleRoutes: [],
      excludedRoutes: [],
      reason: requirement.reason,
    };
  }

  const authoritativeCandidates =
    candidates.filter(
      (candidate) =>
        candidate.areaCompatible !== false &&
        candidateHasStructuralAuthority(
          candidate
        )
    );
  const compatibleRoutes = [
    ...new Set(
      authoritativeCandidates
        .filter(
          (candidate) =>
            classifyAuthoritativeRouteSurface(
              candidate
            ) === requirement.kind
        )
        .map((candidate) => candidate.route)
    ),
  ].sort();
  const excludedRoutes = [
    ...new Set(
      candidates
        .filter(
          (candidate) =>
            !compatibleRoutes.includes(
              candidate.route
            )
        )
        .map((candidate) => candidate.route)
    ),
  ].sort();

  if (compatibleRoutes.length === 0) {
    return {
      status: "NO_COMPATIBLE_ROUTE",
      requirement,
      compatibleRoutes,
      excludedRoutes,
      reason:
        "No structurally authoritative route is compatible with the required target surface.",
    };
  }

  if (compatibleRoutes.length > 1) {
    return {
      status:
        "AMBIGUOUS_COMPATIBLE_ROUTES",
      requirement,
      compatibleRoutes,
      excludedRoutes,
      reason:
        "Multiple authoritative routes share the required target-surface kind.",
    };
  }

  return {
    status: "SELECTED",
    requirement,
    selectedRoute: compatibleRoutes[0]!,
    compatibleRoutes,
    excludedRoutes,
    reason:
      "Exactly one authoritative route is compatible with the required target surface.",
  };
}
