import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type { RouteCandidate } from "./route-candidate-discovery.js";
import type {
  DeepRouteBindingSlot,
  DeepRouteTemplate,
} from "../agents/browser/browser-deep-route-binding.js";
import {
  extractSourceBackedSurfaceIdentities,
  type SourceBackedSurfaceIdentity,
  type SourceSurfaceSource,
} from "./source-surface-provenance.js";
import {
  recoverStaticSurfaceRoutes,
} from "./static-surface-route-extraction.js";
import {
  matchSourceBackedSurfaceIdentity,
} from "./source-surface-provenance.js";

export type UiRouteEntry = {
  path: string;
  file?: string;
  params?: string[];
  area?: string;
  persona?: "company_admin" | "talent" | "admin" | "unknown";
  origin?: "UI_ROUTE_MANIFEST";
  authoritative?: boolean;
  derivation?:
    | "DIRECT"
    | "NESTED_COMPOSITION";
  routeKind?:
    | "STATIC"
    | "PARAMETERIZED";
  sourceRef?: string;
  parentRoute?: string;
  parentSourceRef?: string;
  mountedComponents?: string[];
  mountedComponentSources?: Array<{ componentName: string; file: string }>;
  surfaceIdentity?: SourceBackedSurfaceIdentity;
};

type UiRoutesManifest = {
  sourceRoot?: string;
  routes?: UiRouteEntry[];
};

let cachedRoutes: UiRouteEntry[] | undefined;

function shouldSkipSourceDirectory(name: string): boolean {
  return ["node_modules", ".git", "dist", "build", ".next", "coverage", "storybook-static"].includes(name);
}

function sourceFiles(root: string): SourceSurfaceSource[] {
  if (!fs.existsSync(root)) return [];
  const output: SourceSurfaceSource[] = [];
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipSourceDirectory(entry.name)) walk(full);
      } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/i.test(entry.name)) {
        output.push({
          file: path.relative(root, full).replaceAll(path.sep, "/"),
          source: fs.readFileSync(full, "utf8"),
        });
      }
    }
  }
  walk(root);
  return output.sort((left, right) => left.file.localeCompare(right.file));
}

function enrichWithSourceSurfaceProvenance(
  routes: UiRouteEntry[],
  manifest: UiRoutesManifest
): UiRouteEntry[] {
  const configuredRoot = manifest.sourceRoot || process.env.QA_CLIENT_REPO_PATH || "../ango-scholars-client";
  const sourceRoot = path.resolve(configuredRoot);
  const sources = sourceFiles(sourceRoot);
  if (sources.length === 0) return routes;
  const recovered = recoverStaticSurfaceRoutes(sources);
  const recoveredByRoute = new Map(recovered.map((item) => [item.route, item]));
  const identities = extractSourceBackedSurfaceIdentities({
    routes: routes.map((entry) => {
      const structural = recoveredByRoute.get(entry.path);
      return {
        route: entry.path,
        ...(entry.file ? { file: entry.file } : {}),
        ...(entry.persona ? { persona: entry.persona } : {}),
        ...(entry.routeKind ? { routeKind: entry.routeKind } : {}),
        ...(entry.mountedComponents
          ? { mountedComponents: entry.mountedComponents }
          : structural?.mountedComponents
            ? { mountedComponents: structural.mountedComponents }
            : {}),
        ...(structural?.mountedComponentSources
          ? { mountedComponentSources: structural.mountedComponentSources }
          : {}),
      };
    }),
    sources,
  });
  const identityByRoute = new Map(identities.map((identity) => [identity.routeRef, identity]));
  return routes.map((entry) => {
    const identity = identityByRoute.get(entry.path);
    const structural = recoveredByRoute.get(entry.path);
    return {
      ...entry,
      ...(structural?.mountedComponents && !entry.mountedComponents
        ? { mountedComponents: structural.mountedComponents }
        : {}),
      ...(structural?.mountedComponentSources
        ? { mountedComponentSources: structural.mountedComponentSources }
        : {}),
      ...(identity ? { surfaceIdentity: identity } : {}),
    };
  });
}

function readCatalog(): UiRouteEntry[] {
  if (cachedRoutes) return cachedRoutes;

  const manifestPath =
    process.env.QA_UI_ROUTES_MANIFEST || "config/ui-routes.manifest.yaml";

  if (!fs.existsSync(manifestPath)) {
    cachedRoutes = [];
    return cachedRoutes;
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = yaml.parse(raw) as UiRoutesManifest;

  const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
  cachedRoutes = enrichWithSourceSurfaceProvenance(routes, parsed);

  return cachedRoutes;
}

/**
 * Returns exact static repository route bindings for planner-side execution
 * mechanics. The caller must fail closed when more than one persona remains.
 * This does not make the route part of acceptance semantics.
 */
export function findExactStaticUiRouteBindings(route: string): Array<{
  route: string;
  persona: "company_admin" | "talent";
  /** Manifest/source-owned coarse area; never derived from candidate prose. */
  area: string;
  sourceRef: string;
}> {
  return readCatalog()
    .filter((entry) =>
      entry.path === route &&
      (!entry.params || entry.params.length === 0) &&
      (entry.persona === "company_admin" || entry.persona === "talent")
    )
    .map((entry) => ({
      route: entry.path,
      persona: entry.persona as "company_admin" | "talent",
      area: entry.area ?? "",
      sourceRef: entry.sourceRef ?? entry.file ?? "config/ui-routes.manifest.yaml",
    }))
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) =>
        candidate.route === entry.route &&
        candidate.persona === entry.persona &&
        candidate.sourceRef === entry.sourceRef
      ) === index
    )
    .sort((left, right) =>
      left.persona.localeCompare(right.persona) ||
      left.sourceRef.localeCompare(right.sourceRef)
    );
}

/**
 * Returns a static manifest route only when the manifest identifies one
 * unambiguous entry route for a persona/feature-area pair. This is route
 * discovery metadata, not source-target or proof authority: callers must
 * still live-probe the route before using it at runtime.
 */
export function findUniqueStaticUiRouteForArea(input: {
  persona: "company_admin" | "talent";
  area: string;
}): {
  route: string;
  sourceRefs: string[];
} | undefined {
  const bindings = readCatalog()
    .filter((entry) =>
      entry.persona === input.persona &&
      entry.area === input.area &&
      (!entry.params || entry.params.length === 0)
    )
    .map((entry) => ({
      route: entry.path,
      sourceRef:
        entry.sourceRef ??
        entry.file ??
        "config/ui-routes.manifest.yaml",
    }));

  const routes = [...new Set(bindings.map((binding) => binding.route))]
    .sort();

  if (routes.length !== 1) return undefined;

  const route = routes[0]!;

  return {
    route,
    sourceRefs: bindings
      .filter((binding) => binding.route === route)
      .map((binding) => binding.sourceRef)
      .filter((sourceRef, index, entries) =>
        entries.indexOf(sourceRef) === index
      )
      .sort(),
  };
}

export type ExplicitStaticUiRouteBindingResolution =
  | { kind: "NO_BINDING" }
  | {
      kind: "UNIQUE_EXACT_BINDING";
      binding: {
        route: string;
        persona: "company_admin" | "talent";
        sourceRefs: string[];
      };
    }
  | {
      kind: "AMBIGUOUS_BINDING";
      routes: string[];
    };

/**
 * Resolves one explicitly named list/page surface against the existing static
 * route manifest. Catalog scoring supplies candidates; exact surface wording
 * and manifest identity are both required before the result can be used as an
 * execution navigation binding.
 *
 * The result deliberately distinguishes no binding from ambiguous binding so
 * downstream authority transport can preserve conservative behavior for
 * absence while failing closed on conflicting exact bindings.
 */
export function resolveExplicitStaticUiRouteBinding(input: {
  plan: unknown;
  persona: "company_admin" | "talent";
  surface: string;
}): ExplicitStaticUiRouteBindingResolution {
  const surface = normalizeSemanticText(input.surface);
  if (
    (input.persona === "company_admin" && /\btalent\b/.test(surface)) ||
    (input.persona === "talent" && /\bcompany\b/.test(surface))
  ) {
    return { kind: "NO_BINDING" };
  }
  const qualifiers = "page|list|history|flow|view|screen|table|dashboard|details?|wizard";
  const exactSurface = (route: string): boolean => {
    const segment = normalizeSemanticText(
      route.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1)
    );
    if (!segment) return false;
    const allQualified = segment.startsWith("all ");
    const term = allQualified ? segment.slice(4) : segment;
    const expression = new RegExp(
      `(?:^|\\b)(all\\s+)?${escapeRegularExpression(term)}\\s+(?:${qualifiers})\\b`,
      "gi"
    );
    return [...surface.matchAll(expression)]
      .some((match) => Boolean(match[1]) === allQualified);
  };

  const routes = findRouteCandidatesFromCatalog(input.plan, {
    persona: input.persona,
    goal: input.surface,
    successCriteria: "",
    automatedChecks: [],
    manualChecks: [],
    fixtureRequirements: [],
  })
    .filter((candidate) =>
      candidate.confidence === "high" &&
      candidate.evidence?.includes("EXPLICIT_CASE_SURFACE_REFERENCE") &&
      exactSurface(candidate.route)
    )
    .flatMap((candidate) =>
      findExactStaticUiRouteBindings(candidate.route)
        .filter((binding) => binding.persona === input.persona)
    );
  const routeNames = [...new Set(routes.map((item) => item.route))].sort();
  if (routeNames.length === 0) {
    return { kind: "NO_BINDING" };
  }
  if (routeNames.length > 1) {
    return {
      kind: "AMBIGUOUS_BINDING",
      routes: routeNames,
    };
  }
  const route = routeNames[0]!;
  return {
    kind: "UNIQUE_EXACT_BINDING",
    binding: {
      route,
      persona: input.persona,
      sourceRefs: [...new Set(routes
        .filter((item) => item.route === route)
        .map((item) => item.sourceRef))].sort(),
    },
  };
}

export function findUnambiguousExplicitStaticUiRouteBinding(input: {
  plan: unknown;
  persona: "company_admin" | "talent";
  surface: string;
}): {
  route: string;
  persona: "company_admin" | "talent";
  sourceRefs: string[];
} | undefined {
  const resolution = resolveExplicitStaticUiRouteBinding(input);
  return resolution.kind === "UNIQUE_EXACT_BINDING"
    ? resolution.binding
    : undefined;
}

/**
 * Returns structural parameterized routes from the generated UI manifest.
 * This is template authority only: it never supplies runtime identifiers.
 */
export function findAuthoritativeUiRouteTemplates(
  input: {
    persona: "company_admin" | "talent";
    area: string;
    requiredBindings:
      DeepRouteBindingSlot[];
  }
): DeepRouteTemplate[] {
  const requiredParams =
    input.requiredBindings.map(
      (binding) => binding.param
    );

  return readCatalog()
    .filter((entry) => {
      const params =
        Array.isArray(entry.params)
          ? entry.params
          : [];

      return (
        entry.persona === input.persona &&
        entry.area === input.area &&
        params.length ===
          requiredParams.length &&
        params.every(
          (param, index) =>
            param ===
            requiredParams[index]
        )
      );
    })
    .map((entry) => ({
      template: entry.path,
      sourceOrigin:
        "UI_ROUTE_MANIFEST" as const,
      ...(entry.file
        ? { sourceRef: entry.file }
        : {}),
      authoritative: true,
      persona: input.persona,
      requiredBindings:
        input.requiredBindings.map(
          (binding) => ({
            ...binding,
          })
        ),
      disposition: "CURRENT" as const,
    }))
    .sort((left, right) =>
      left.template.localeCompare(
        right.template
      )
    );
}

function parameterEntityKind(param: string): string {
  const withoutId = param.replace(/Id$/i, "");
  return normalizeSemanticText(withoutId || param).replace(/\s+/g, "-");
}

function parameterizedSurfaceTerms(entry: UiRouteEntry): string[] {
  const area = normalizeSemanticText(entry.area);
  const pathTerms = String(entry.path ?? "")
    .split(/[/?#]/)
    .filter((part) => part && !part.startsWith(":"))
    .map(normalizeSemanticText)
    .filter((part) => !["company", "talent", "admin"].includes(part));
  return [...new Set([area, ...pathTerms]
    .flatMap((term) => [term, term.endsWith("s") ? term.slice(0, -1) : term])
    .filter((term) =>
      Boolean(term) && !["company", "talent", "admin"].includes(term)
    ))];
}

function parameterizedTemplateMatchesSurface(
  entry: UiRouteEntry,
  surface: string
): boolean {
  const normalizedSurface = normalizeSemanticText(surface);
  return parameterizedSurfaceTerms(entry).some((term) =>
    new RegExp(`(?:^|\\b)${escapeRegularExpression(term)}(?:\\b|$)`, "i")
      .test(normalizedSurface)
  );
}

/**
 * Finds all manifest-authoritative parameterized templates compatible with an
 * explicitly grounded target surface. Cardinality is intentionally left to
 * the caller so ambiguity always fails closed.
 */
export function findAuthoritativeParameterizedUiRouteTemplatesFromEntries(
  entries: UiRouteEntry[],
  input: {
    surface: string;
    persona?: "company_admin" | "talent";
  }
): DeepRouteTemplate[] {
  const eligible = entries.filter((entry) => {
    const params = Array.isArray(entry.params) ? entry.params : [];
    return params.length > 0 &&
      (entry.persona === "company_admin" || entry.persona === "talent") &&
      (!input.persona || entry.persona === input.persona);
  });
  const sourceGrounded = eligible.filter((entry) =>
    entry.surfaceIdentity &&
      entry.surfaceIdentity.routeRef === entry.path &&
      entry.surfaceIdentity.persona === entry.persona
      ? matchSourceBackedSurfaceIdentity({
          requestedSurface: input.surface,
          identity: entry.surfaceIdentity,
        }).matched
      : false
  );
  const matchingEntries = sourceGrounded.length > 0
    ? sourceGrounded
    : eligible.filter((entry) =>
        parameterizedTemplateMatchesSurface(entry, input.surface)
      );

  return matchingEntries
    .map((entry) => ({
      template: entry.path,
      sourceOrigin: "UI_ROUTE_MANIFEST" as const,
      ...(entry.sourceRef || entry.file
        ? { sourceRef: entry.sourceRef ?? entry.file }
        : {}),
      authoritative: true,
      persona: entry.persona as "company_admin" | "talent",
      requiredBindings: entry.params!.map((param) => ({
        param,
        entityKind: parameterEntityKind(param),
      })),
      disposition: "CURRENT" as const,
    }))
    .filter((template, index, templates) =>
      templates.findIndex((candidate) =>
        JSON.stringify(candidate) === JSON.stringify(template)
      ) === index
    )
    .sort((left, right) =>
      left.template.localeCompare(right.template) ||
      left.persona.localeCompare(right.persona)
    );
}

export function findAuthoritativeParameterizedUiRouteTemplates(input: {
  surface: string;
  persona?: "company_admin" | "talent";
}): DeepRouteTemplate[] {
  return findAuthoritativeParameterizedUiRouteTemplatesFromEntries(
    readCatalog(),
    input
  );
}

function normalizeSemanticText(
  value: unknown
): string {
  return String(value ?? "")
    .replace(
      /([a-z0-9])([A-Z])/g,
      "$1 $2"
    )
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function collectTextValues(
  value: unknown
): unknown[] {
  return Array.isArray(value)
    ? value
    : [];
}

/*
 * PLANNER_ROUTE_SCOPE_TEXT_V1
 *
 * Route selection uses Jira-derived plan summary plus the
 * current case's acceptance scope. Plan-wide notes and steps
 * are excluded because they may contain collateral GitHub
 * changes or execution details from another product surface.
 */
function collectSurfaceContext(
  plan: any,
  testCase: any
): {
  goalText: string;
  caseText: string;
  summaryText: string;
  allText: string;
} {
  const goalText =
    normalizeSemanticText(
      testCase?.goal
    );
  const caseText =
    normalizeSemanticText([
      testCase?.goal,
      testCase?.successCriteria,
      ...collectTextValues(
        testCase?.automatedChecks
      ),
      ...collectTextValues(
        testCase?.manualChecks
      ),
      ...collectTextValues(
        testCase?.fixtureRequirements
      ),
    ]
      .filter(Boolean)
      .join(" "));
  const summaryText =
    normalizeSemanticText(
      plan?.summary
    );

  return {
    goalText,
    caseText,
    summaryText,
    allText: [
      goalText,
      caseText,
      summaryText,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function sourceBackedCandidateForCase(
  plan: any,
  testCase: any
): any | undefined {
  const candidates = plan?.browserSemanticIr?.candidates?.filter(
    (item: any) => item?.proposedCaseId === testCase?.id
  );
  if (!Array.isArray(candidates) || candidates.length !== 1) return undefined;
  const candidate = candidates[0];
  if (!candidate || !candidate.proposedTargetSurface ||
      !Array.isArray(candidate.obligationIds) || !Array.isArray(candidate.sourceUnitIds)) return undefined;
  const obligations = plan?.acceptanceObligationLedger?.obligations;
  const sourceUnits = plan?.acceptanceSourceLedger?.sourceUnits;
  if (!Array.isArray(obligations) || !Array.isArray(sourceUnits)) return undefined;
  const obligationById = new Map(obligations.map((item: any) => [item.id, item]));
  const sourceById = new Map(sourceUnits.map((item: any) => [item.id, item]));
  const boundObligations = candidate.obligationIds
    .map((id: string) => obligationById.get(id))
    .filter(Boolean);
  if (boundObligations.length !== candidate.obligationIds.length || boundObligations.length === 0) return undefined;
  const requiredSourceUnitIds = [...new Set(boundObligations.flatMap((item: any) => item.sourceUnitIds))].sort();
  if (JSON.stringify(requiredSourceUnitIds) !== JSON.stringify([...candidate.sourceUnitIds].sort())) return undefined;
  if (requiredSourceUnitIds.length === 0 || requiredSourceUnitIds.some((id) =>
    !["ACCEPTANCE_CRITERIA", "DESCRIPTION"].includes(sourceById.get(id)?.sourceKind)
  )) return undefined;
  // The planner persona is advisory. The caller already filters routes by the
  // canonical case persona; a proposal mismatch cannot erase source-backed
  // surface provenance once that execution context is resolved.
  return candidate;
}

function sourceSurfaceGrounding(
  plan: any,
  testCase: any,
  route: UiRouteEntry
): {
  matched: boolean;
  reason?: string;
  evidence?: string[];
} {
  const candidate = sourceBackedCandidateForCase(plan, testCase);
  if (!candidate || !route.surfaceIdentity) {
    return { matched: false };
  }
  if (route.surfaceIdentity.routeRef !== route.path ||
      route.surfaceIdentity.persona !== route.persona ||
      route.surfaceIdentity.persona !== testCase?.persona) {
    return { matched: false, reason: "SOURCE_SURFACE_PERSONA_CONFLICT" };
  }
  const requested = normalizeSemanticText(candidate.proposedTargetSurface);
  const routeSegment = normalizeSemanticText(
    route.path.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1)
  );
  const routeTargetsAll = routeSegment.startsWith("all ");
  const requestedTargetsAll = /\ball\b/.test(requested);
  if (routeTargetsAll !== requestedTargetsAll) {
    return { matched: false, reason: "SOURCE_SURFACE_SCOPE_CONFLICT" };
  }
  const match = matchSourceBackedSurfaceIdentity({
    requestedSurface: candidate.proposedTargetSurface,
    identity: route.surfaceIdentity,
  });
  return {
    matched: match.matched,
    reason: match.reason,
    ...(match.matched
      ? {
          evidence: [
            "SOURCE_SURFACE_PROVENANCE",
            ...match.matchedEvidence.map((item) =>
              `SOURCE_SURFACE:${item.evidenceKind}:${item.sourceRef}`
            ),
          ],
        }
      : {}),
  };
}

function inferWantedArea(text: string): string | undefined {
  const isJobWizardContext =
    (
      text.includes("job") &&
      text.includes("wizard")
    ) ||
    text.includes("job creation") ||
    text.includes("create job") ||
    text.includes("create a job") ||
    text.includes("edit job") ||
    text.includes("editing a job");

  if (isJobWizardContext) {
    return "jobs";
  }

  const isJobDetailContainer =
    text.includes("job details") ||
    text.includes("job detail") ||
    text.includes("hired area") ||
    text.includes("hired section") ||
    text.includes("hired table") ||
    text.includes("applicants") ||
    text.includes("review modal") ||
    text.includes("job status") ||
    text.includes("job visibility");

  if (isJobDetailContainer) {
    return "jobs";
  }

  if (
    text.includes("work setups") ||
    text.includes("work setup") ||
    text.includes("document requirement") ||
    text.includes("manager approval")
  ) {
    return "work-setups";
  }

  if (
    text.includes("language") ||
    text.includes("proficiency") ||
    text.includes("listening") ||
    text.includes("speaking") ||
    text.includes("writing") ||
    text.includes("reading")
  ) {
    return "languages";
  }

  if (
    text.includes("skill") ||
    text.includes("skills") ||
    text.includes("taxonomy") ||
    text.includes("discipline")
  ) {
    return "skills";
  }

  /*
   * Specific feature areas must be evaluated before
   * generic relationship words such as "job".
   */
  if (
    text.includes("talent pool") ||
    text.includes("talent-pool")
  ) {
    return "talent-pool";
  }

  if (text.includes("payment") || text.includes("timesheet")) {
    return "payments";
  }

  if (text.includes("assessment")) {
    return "assessments";
  }

  if (text.includes("contract")) {
    return "contracts";
  }

  if (
    text.includes("job") ||
    text.includes("jobs") ||
    text.includes("job wizard") ||
    text.includes("hired") ||
    text.includes("applicants") ||
    text.includes("newest") ||
    text.includes("latest") ||
    text.includes("oldest")
  ) {
    return "jobs";
  }

  return undefined;
}

function isCatalogAreaCompatible(
  wantedArea: string,
  routePath: string,
  area: string
): boolean {
  if (wantedArea === area) {
    return true;
  }

  if (wantedArea === "languages") {
    return (
      area === "assessments" ||
      routePath.includes("/talent/profile") ||
      routePath.includes("/talent/onboarding")
    );
  }

  return false;
}

function routeMatchesPersona(route: UiRouteEntry, persona: string): boolean {
  const routePath = String(route.path || "");

  if (persona === "company_admin") {
    return routePath.startsWith("/company");
  }

  if (persona === "talent") {
    return routePath.startsWith("/talent");
  }

  return false;
}

function hasParams(route: UiRouteEntry): boolean {
  return Array.isArray(route.params) && route.params.length > 0;
}

function escapeRegularExpression(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function routeSurfaceTerms(
  route: UiRouteEntry
): string[] {
  const pathname =
    String(route.path ?? "")
      .split(/[?#]/)[0] ?? "";
  const lastSegment =
    pathname
      .split("/")
      .filter(Boolean)
      .at(-1) ?? "";

  const surface =
    normalizeSemanticText(lastSegment)
      .replace(/^all\s+/, "");
  const singularSurface =
    surface.endsWith("s")
      ? surface.slice(0, -1)
      : surface;

  return [...new Set([
    surface,
    singularSurface,
  ].filter(Boolean))];
}

function hasExplicitSurfaceReference(
  text: string,
  route: UiRouteEntry
): boolean {
  const qualifiers =
    "page|list|history|flow|view|screen|table|dashboard|details?|wizard";

  return routeSurfaceTerms(route)
    .some((term) => {
      const escaped =
        escapeRegularExpression(term);

      return (
        new RegExp(
          `\\b${escaped}\\s+(?:${qualifiers})\\b`,
          "i"
        ).test(text) ||
        new RegExp(
          `\\b(?:${qualifiers})\\s+(?:of\\s+)?${escaped}\\b`,
          "i"
        ).test(text)
      );
    });
}

function scoreRoute(
  route: UiRouteEntry,
  context:
    ReturnType<
      typeof collectSurfaceContext
    >,
  persona: string,
  sourceSurface?: ReturnType<typeof sourceSurfaceGrounding>
): {
  score: number;
  confidence:
    RouteCandidate["confidence"];
  evidence: string[];
  wantedArea?: string;
  wantedAreaSource?: string;
} {
  let score = 0;

  const wantedAreaFromGoal =
    inferWantedArea(context.goalText);
  const wantedAreaFromCase =
    inferWantedArea(context.caseText);
  const wantedAreaFromSummary =
    inferWantedArea(
      context.summaryText
    );
  const wantedArea =
    wantedAreaFromGoal ??
    wantedAreaFromCase ??
    wantedAreaFromSummary;
  const wantedAreaSource =
    wantedAreaFromGoal
      ? "CASE_GOAL"
      : wantedAreaFromCase
        ? "CASE_ACCEPTANCE"
        : wantedAreaFromSummary
          ? "JIRA_SUMMARY"
          : undefined;
  const text = context.allText;
  const routePath = String(route.path || "").toLowerCase();
  const filePath = String(route.file || "").toLowerCase();
  const area = String(route.area || "").toLowerCase();

  if (
    routePath === "/company" ||
    routePath === "/talent" ||
    routePath === "/admin"
    ) {
    return {
      score: -999,
      confidence: "low",
      evidence: [],
    };
  }

  if (filePath.includes("acceptinvitation")) {
    return {
      score: -999,
      confidence: "low",
      evidence: [],
    };
  }

  if (!routeMatchesPersona(route, persona)) {
    return {
      score: -999,
      confidence: "low",
      evidence: [],
    };
  }

  score += 20;

  if (sourceSurface?.matched) {
    // Source corroboration is a bounded navigation bonus, never acceptance
    // authority. It deliberately outranks lexical area similarity.
    score += 500;
  }

  if (
    wantedArea &&
    isCatalogAreaCompatible(
      wantedArea,
      routePath,
      area
    )
  ) {
    score += 60;
  }

  if (wantedArea && routePath.includes(wantedArea)) {
    score += 30;
  }

  if (wantedArea && filePath.includes(wantedArea)) {
    score += 20;
  }

  const exactRouteMentioned =
    text.includes(routePath);

  if (exactRouteMentioned) {
    score += 80;
  }

  const explicitSurfaceReference =
    hasExplicitSurfaceReference(
      context.caseText,
      route
    );

  if (explicitSurfaceReference) {
    score += 45;
  }

  /*
   * When one feature may live on multiple surfaces,
   * prefer the surface explicitly named by the case.
   */
  if (
    wantedArea === "languages" &&
    text.includes("profile") &&
    routePath.includes("profile")
  ) {
    score += 30;
  }

  if (
    wantedArea === "languages" &&
    text.includes("onboarding") &&
    routePath.includes("onboarding")
  ) {
    score += 30;
  }

  if (
    wantedArea === "languages" &&
    text.includes("assessment") &&
    area === "assessments"
  ) {
    score += 30;
  }

  /**
   * Prefer safe list/index routes as start routes.
   */
  if (
    routePath.includes("/all-") ||
    routePath.endsWith("/skills") ||
    routePath.endsWith("/jobs") ||
    routePath.endsWith("/payments") ||
    routePath.endsWith("/work-setups") ||
    routePath.endsWith("/all-work-setups") ||
    routePath.endsWith("/all-jobs")
  ) {
    score += 25;
  }

  /**
   * Param routes are useful in the catalog, but unsafe as generic start routes
   * unless another resolver fills IDs later.
   */
  if (hasParams(route) || routePath.includes(":") || routePath.includes("$")) {
    score -= 50;
  }

  /**
   * Product-specific preference: top-level Work Setups page is safer than
   * project/detail routes when the case asks for generic Work Setups UI.
   */
  if (wantedArea === "work-setups" && routePath.includes("all-work-setups")) {
    score += 40;
  }

  const evidence = [
    ...(sourceSurface?.matched
      ? sourceSurface.evidence ?? ["SOURCE_SURFACE_PROVENANCE"]
      : []),
    ...(wantedArea
      ? [
          `WANTED_AREA:${wantedArea}`,
        ]
      : []),
    ...(wantedAreaSource
      ? [
          `WANTED_AREA_SOURCE:${wantedAreaSource}`,
        ]
      : []),
    ...(exactRouteMentioned
      ? ["EXACT_ROUTE_MENTION"]
      : []),
    ...(explicitSurfaceReference
      ? [
          "EXPLICIT_CASE_SURFACE_REFERENCE",
        ]
      : []),
  ];

  return {
    score,
    confidence:
      sourceSurface?.matched || explicitSurfaceReference
        ? "high"
        : route.origin ===
            "UI_ROUTE_MANIFEST"
          ? "medium"
        : confidenceFromScore(score) ===
            "low"
          ? "low"
          : "medium",
    evidence,
    ...(wantedArea
      ? { wantedArea }
      : {}),
    ...(wantedAreaSource
      ? { wantedAreaSource }
      : {}),
  };
}

function confidenceFromScore(score: number): RouteCandidate["confidence"] {
  if (score >= 80) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function findRouteCandidatesFromCatalog(
  plan: any,
  testCase: any
): RouteCandidate[] {
  return findRouteCandidatesFromEntries(
    readCatalog(),
    plan,
    testCase
  );
}

export function findRouteCandidatesFromEntries(
  routes: UiRouteEntry[],
  plan: any,
  testCase: any
): RouteCandidate[] {

  if (routes.length === 0) {
    return [];
  }

  const context =
    collectSurfaceContext(
      plan,
      testCase
    );
  const persona = String(testCase?.persona || "");

  return routes
    .map((route) => {
    const sourceSurface = sourceSurfaceGrounding(plan, testCase, route);
    const grounding =
      scoreRoute(
        route,
        context,
        persona,
        sourceSurface
      );

      return {
        route: route.path,
        score: grounding.score,
        confidence:
          grounding.confidence,
        source: "ui-route-catalog",
        origin:
          route.origin ??
          ("UI_ROUTE_CATALOG" as const),
        authoritative:
          route.authoritative === true || sourceSurface.matched,
        ...(route.sourceRef || route.file
          ? {
              sourceRef:
                route.sourceRef ??
                route.file,
            }
          : {}),
        ...(route.derivation
          ? {
              derivation:
                route.derivation,
            }
          : {}),
        ...(route.routeKind
          ? {
              routeKind:
                route.routeKind,
            }
          : {}),
        ...(route.parentRoute
          ? {
              parentRoute:
                route.parentRoute,
            }
          : {}),
        ...(route.parentSourceRef
          ? {
              parentSourceRef:
                route.parentSourceRef,
            }
        : {}),
        ...(route.surfaceIdentity
          ? { surfaceIdentity: route.surfaceIdentity }
          : {}),
        groundingScore:
          grounding.confidence ===
          "high"
            ? 500 + grounding.score
            : grounding.score,
        evidence:
          [
            ...grounding.evidence,
            ...(route.derivation
              ? [
                  `ROUTE_DERIVATION:${route.derivation}`,
                ]
              : []),
          ],
        reason:
          `UI route manifest candidate. ` +
          `file=${route.file || "unknown"}, ` +
          `area=${route.area || "unknown"}, ` +
          `score=${grounding.score}, ` +
          `evidence=${
            grounding.evidence.join("|") ||
            "none"
          }`,
      };
    })
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...candidate }) => candidate);
}
