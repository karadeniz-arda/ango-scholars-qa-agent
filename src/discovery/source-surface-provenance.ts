import * as ts from "typescript";

export type SourceSurfaceEvidenceKind =
  | "ROUTE_DECLARED_LABEL"
  | "DOCUMENT_TITLE"
  | "NAVIGATION_LABEL"
  | "TAB_LABEL"
  | "BREADCRUMB_LABEL"
  | "PAGE_COMPONENT_IDENTITY"
  | "SOURCE_DECLARED_SURFACE";

export type SourceSurfaceProvenance = {
  sourceRef: string;
  evidenceKind: SourceSurfaceEvidenceKind;
  value: string;
};

export type SourceBackedSurfaceIdentity = {
  canonicalSurface: string;
  aliases: string[];
  routeRef: string;
  routeTemplateRef?: string;
  persona: "company_admin" | "talent" | "admin" | "unknown";
  provenance: SourceSurfaceProvenance[];
  evidenceKind: SourceSurfaceEvidenceKind;
  authority: "SOURCE_CORROBORATION";
};

export type SourceSurfaceSource = {
  file: string;
  source: string;
};

export type SourceSurfaceRouteInput = {
  route: string;
  file?: string;
  persona?: SourceBackedSurfaceIdentity["persona"];
  routeKind?: "STATIC" | "PARAMETERIZED";
  mountedComponents?: string[];
  mountedComponentSources?: Array<{ componentName: string; file: string }>;
};

const sourceExtensions = /\.(?:ts|tsx|js|jsx)$/i;
const stopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "have", "in", "is", "it", "of", "on", "or", "the", "this",
  "to", "with", "page", "pages", "screen", "surface", "view", "section",
  "area", "flow", "form", "table", "list", "modal",
  "client", "user", "users", "id", "not",
  "found", "create", "new", "requirement", "requirements",
  "click", "open", "show", "shown", "display", "displays", "update", "edit",
  "action", "actions", "area", "row", "rows", "item", "items", "publish",
  "sent", "processed", "processing", "tab", "tabs",
  "drawer", "selection", "selected",
  "company", "talent", "admin", "scholar", "scholars",
]);
const genericLabels = new Set([
  "back", "close", "cancel", "save", "next", "previous", "refresh",
  "loading", "loading...", "home", "project", "company", "talent",
  "details", "detail",
]);
const genericBridgeTokens = new Set([
  ...genericLabels, "search", "work", "change", "payment", "payments",
]);

export function normalizeSourceSurface(value: unknown): string {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-zA-Z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceRef(file: string, source: string, offset: number): string {
  return `${file}:${source.slice(0, offset).split("\n").length}`;
}

function personaForRoute(route: string): SourceBackedSurfaceIdentity["persona"] {
  if (route.startsWith("/company")) return "company_admin";
  if (route.startsWith("/talent")) return "talent";
  if (route.startsWith("/admin")) return "admin";
  return "unknown";
}

function labelLike(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80) return false;
  if (normalized.split(/\s+/).length > 8) return false;
  if (/[.!?]/.test(normalized)) return false;
  if (/^(?:please|you|we|your|cannot|could not|failed|error)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:successfully|saved|published|deleted|not found|coming soon|could not|cannot|should|must|include|contains)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(?:save|create|publish|delete|update|edit|draft|next|previous|back|close|clear|apply|remove)\b/i.test(normalized)) {
    return false;
  }
  return !genericLabels.has(normalized.toLowerCase());
}

function tokenVariants(value: string): string[] {
  const token = value.toLowerCase();
  return token.endsWith("s") && token.length > 3
    ? [token, token.slice(0, -1)]
    : [token];
}

function substantiveTokens(value: string): string[] {
  return normalizeSourceSurface(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function addEvidence(
  map: Map<string, SourceSurfaceProvenance[]>,
  route: string,
  evidence: SourceSurfaceProvenance
): void {
  const list = map.get(route) ?? [];
  const key = `${evidence.sourceRef}\u0000${evidence.evidenceKind}\u0000${normalizeSourceSurface(evidence.value)}`;
  if (!list.some((item) => `${item.sourceRef}\u0000${item.evidenceKind}\u0000${normalizeSourceSurface(item.value)}` === key)) {
    list.push(evidence);
  }
  map.set(route, list);
}

function sourceAst(input: SourceSurfaceSource): ts.SourceFile {
  return ts.createSourceFile(
    input.file,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    /x$/i.test(input.file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function literalProperty(
  node: ts.ObjectLiteralExpression,
  name: string
): ts.StringLiteralLike | undefined {
  // A spread can override either the route or its label at runtime.
  if (node.properties.some(ts.isSpreadAssignment)) return undefined;
  const properties = node.properties.filter((property) =>
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
    property.name.text === name
  );
  if (properties.length !== 1) return undefined;
  const property = properties[0]!;
  return ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)
    ? property.initializer
    : undefined;
}

function objectRouteEvidence(sources: SourceSurfaceSource[], args: {
  routeProperty: "path" | "key";
  labelProperty: "title" | "label";
  evidenceKind: "DOCUMENT_TITLE" | "NAVIGATION_LABEL";
}): Array<{
  route: string;
  evidence: SourceSurfaceProvenance;
}> {
  const output: Array<{ route: string; evidence: SourceSurfaceProvenance }> = [];
  for (const input of sources) {
    if (!sourceExtensions.test(input.file)) continue;
    const ast = sourceAst(input);
    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const route = literalProperty(node, args.routeProperty)?.text.trim();
        const label = literalProperty(node, args.labelProperty);
        const value = label?.text.trim();
        if (route?.startsWith("/") && value && labelLike(value)) {
          output.push({
            route,
            evidence: {
              sourceRef: sourceRef(input.file, input.source, label!.getStart(ast)),
              evidenceKind: args.evidenceKind,
              value,
            },
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return output;
}

function componentIdentityLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\.(?:route|routes)$/i, "")
    .trim();
}

function componentEvidence(
  source: SourceSurfaceSource,
  kind: SourceSurfaceEvidenceKind = "SOURCE_DECLARED_SURFACE"
): SourceSurfaceProvenance[] {
  const output: SourceSurfaceProvenance[] = [];
  const ast = sourceAst(source);
  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of ["defaultMessage", "label", "title"]) {
        const literal = literalProperty(node, property);
        const value = literal?.text.trim();
        if (!value || !labelLike(value)) continue;
        output.push({
          sourceRef: sourceRef(source.file, source.source, literal!.getStart(ast)),
          evidenceKind: kind,
          value,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return output;
}

function routeSegment(route: string): string | undefined {
  const segment = route.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1);
  if (!segment || /^[:${]/.test(segment)) return undefined;
  const normalized = normalizeSourceSurface(segment).replace(/^all /, "");
  return normalized || undefined;
}

/**
 * Extracts source-derived surface identities. This is deliberately a closed
 * contract: only route/title/navigation/component source text can populate it.
 * Planner prose and Jira summaries are never inputs to extraction.
 */
export function extractSourceBackedSurfaceIdentities(args: {
  routes: SourceSurfaceRouteInput[];
  sources: SourceSurfaceSource[];
}): SourceBackedSurfaceIdentity[] {
  const evidenceByRoute = new Map<string, SourceSurfaceProvenance[]>();
  for (const item of objectRouteEvidence(args.sources, { routeProperty: "path", labelProperty: "title", evidenceKind: "DOCUMENT_TITLE" })) addEvidence(evidenceByRoute, item.route, item.evidence);
  for (const item of objectRouteEvidence(args.sources, { routeProperty: "key", labelProperty: "label", evidenceKind: "NAVIGATION_LABEL" })) addEvidence(evidenceByRoute, item.route, item.evidence);
  const byFile = new Map(args.sources.map((source) => [source.file, source]));

  for (const route of args.routes) {
    for (const { componentName, file } of route.mountedComponentSources ?? []) {
      const component = byFile.get(file);
      if (component && sourceExtensions.test(component.file)) {
        const componentLabel = componentIdentityLabel(componentName);
        if (labelLike(componentLabel)) {
          addEvidence(evidenceByRoute, route.route, {
            sourceRef: component.file,
            evidenceKind: "PAGE_COMPONENT_IDENTITY",
            value: componentLabel,
          });
        }
        for (const evidence of componentEvidence(component)) addEvidence(evidenceByRoute, route.route, evidence);
      }
    }
    const segment = routeSegment(route.route);
    if (segment && route.file) {
      addEvidence(evidenceByRoute, route.route, {
        sourceRef: route.file,
        evidenceKind: "ROUTE_DECLARED_LABEL",
        value: segment,
      });
    }
  }

  return args.routes.flatMap((route) => {
    const provenance = [...(evidenceByRoute.get(route.route) ?? [])]
      .sort((left, right) => left.sourceRef.localeCompare(right.sourceRef) || left.value.localeCompare(right.value));
    if (provenance.length === 0) return [];
    const aliases = [...new Set(provenance.map((item) => item.value.trim()).filter(Boolean))].sort();
    const canonicalSurface = aliases.find((value) => provenance.some((item) => item.evidenceKind === "DOCUMENT_TITLE" && item.value === value))
      ?? aliases.find((value) => provenance.some((item) => item.evidenceKind === "NAVIGATION_LABEL" && item.value === value))
      ?? aliases[0]!;
    const identity: SourceBackedSurfaceIdentity = {
      canonicalSurface,
      aliases,
      routeRef: route.route,
      ...(route.routeKind === "PARAMETERIZED" ? { routeTemplateRef: route.route } : {}),
      persona: route.persona ?? personaForRoute(route.route),
      provenance,
      evidenceKind: provenance[0]!.evidenceKind,
      authority: "SOURCE_CORROBORATION",
    };
    return [identity];
  });
}

export function matchSourceBackedSurfaceIdentity(args: {
  requestedSurface: string;
  identity: SourceBackedSurfaceIdentity;
}): {
  matched: boolean;
  matchedEvidence: SourceSurfaceProvenance[];
  reason: string;
} {
  const requested = normalizeSourceSurface(args.requestedSurface);
  if (!requested) return { matched: false, matchedEvidence: [], reason: "REQUESTED_SURFACE_EMPTY" };
  const requestedBaseTokens = substantiveTokens(requested);
  const requestedTokens = new Set(requestedBaseTokens.flatMap(tokenVariants));
  if (requestedBaseTokens.length < 2) return { matched: false, matchedEvidence: [], reason: "INSUFFICIENT_REQUEST_TOKENS" };
  const matchedEvidence = args.identity.provenance.filter((item) => {
    const evidenceTokens = substantiveTokens(item.value).flatMap(tokenVariants);
    return evidenceTokens.some((token) => requestedTokens.has(token));
  });
  const matchedAliasKeys = new Set(
    args.identity.aliases
      .filter((alias) => {
        const aliasBaseTokens = substantiveTokens(alias);
        if (aliasBaseTokens.length === 1 && genericLabels.has(aliasBaseTokens[0]!)) return false;
        return aliasBaseTokens.length > 0 && aliasBaseTokens.every((token) => tokenVariants(token).some((variant) => requestedTokens.has(variant)));
      })
      .map((alias) => substantiveTokens(alias).flatMap(tokenVariants).sort().join(" "))
      .filter(Boolean)
  );
  const supportingAliasKeys = new Set(
    args.identity.aliases
      .filter((alias) => {
        const aliasBaseTokens = substantiveTokens(alias);
        return aliasBaseTokens.length > 0 &&
          aliasBaseTokens.some((token) => tokenVariants(token).some((variant) => requestedTokens.has(variant)));
      })
      .map((alias) => substantiveTokens(alias)
        .flatMap(tokenVariants)
        .sort()
        .join(" "))
      .filter(Boolean)
  );
  const independent = new Set(matchedEvidence.map((item) => `${item.sourceRef}\u0000${item.evidenceKind}`));
  const matchedTokens = new Set(matchedEvidence.flatMap((item) => normalizeSourceSurface(item.value).split(" ").flatMap(tokenVariants)));
  const coveredRequestedTokens = new Set(
    requestedBaseTokens.filter((token) => tokenVariants(token).some((variant) => matchedTokens.has(variant)))
  );
  // A label for one child surface cannot erase a requested parent or another
  // substantive qualifier. Persona words are not independent surface anchors.
  if (coveredRequestedTokens.size !== new Set(requestedBaseTokens).size) {
    return { matched: false, matchedEvidence, reason: "UNSUPPORTED_SURFACE_QUALIFIER" };
  }
  const exactAliasMatch = args.identity.aliases.some((alias) => {
    const normalizedAlias = normalizeSourceSurface(alias);
    if (genericLabels.has(normalizedAlias)) return false;
    const aliasBaseTokens = substantiveTokens(normalizedAlias);
    if (aliasBaseTokens.length < 2) return false;
    return normalizedAlias.length > 0 &&
      requested.includes(normalizedAlias) &&
      aliasBaseTokens.length > 0;
  });
  const canonicalBaseTokens = substantiveTokens(args.identity.canonicalSurface);
  const canonicalSingleTokenBridge = canonicalBaseTokens.length === 1 &&
    !genericBridgeTokens.has(canonicalBaseTokens[0]!) &&
    args.identity.provenance.some((item) =>
      ["DOCUMENT_TITLE", "NAVIGATION_LABEL", "ROUTE_DECLARED_LABEL", "PAGE_COMPONENT_IDENTITY"].includes(item.evidenceKind) &&
      normalizeSourceSurface(item.value) === normalizeSourceSurface(args.identity.canonicalSurface)
    ) &&
    tokenVariants(canonicalBaseTokens[0]!).some((variant) => requestedTokens.has(variant)) &&
    supportingAliasKeys.size >= 2 &&
    coveredRequestedTokens.size >= 2;
  const strongAliasMatch = args.identity.aliases.some((alias) => {
    const aliasBaseTokens = substantiveTokens(alias);
    return aliasBaseTokens.length >= 2 &&
      aliasBaseTokens.every((token) => tokenVariants(token).some((variant) => requestedTokens.has(variant)));
  });
  const aliasesGrounded = matchedAliasKeys.size >= 2 ||
    exactAliasMatch ||
    canonicalSingleTokenBridge;
  if (matchedEvidence.length === 0 || independent.size < 2 || !aliasesGrounded || (!exactAliasMatch && !strongAliasMatch && !canonicalSingleTokenBridge)) {
    return { matched: false, matchedEvidence, reason: "INSUFFICIENT_INDEPENDENT_SOURCE_EVIDENCE" };
  }
  return { matched: true, matchedEvidence, reason: "SOURCE_SURFACE_PROVENANCE_MATCH" };
}
