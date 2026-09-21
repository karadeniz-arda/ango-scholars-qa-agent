const BROWSER_CONTEXT =
  /\b(?:ui|browser|page|screen|table|list|view|tab|menu|dropdown|select|control|display|visible|web|client|frontend|address\s+bar)\b/i;
const API_CONTEXT =
  /\b(?:api|endpoint|controller|dto|backend|server|fetch|axios|http\s+request)\b/i;
const URL_CONTEXT =
  /\b(?:url|address\s+bar|route\s+query|query\s+string|query\s+params?|query\s+parameters?|search\s+params?|search\s+parameters?)\b/i;

type FilterEvidence = {
  clause: string;
  filterKey: string;
  hint: string;
  menuHint: string;
  visibleControlGrounded: boolean;
};

function jiraContext(sourceContext: string): string {
  const start = sourceContext.indexOf("--- JIRA TICKET ---");
  if (start < 0) return "";
  const end = sourceContext.indexOf("--- GITHUB CHANGE CONTEXT ---", start);
  return sourceContext.slice(start, end < 0 ? sourceContext.length : end);
}

function frontendBlocks(sourceContext: string): string[] {
  return sourceContext
    .split(/(?=^(?:- (?:added|modified|deleted):|Patch for )\s*)/gm)
    .filter((block) => /\.(?:tsx|jsx)\b/i.test(block.split(/\r?\n/, 1)[0] || ""));
}

function criteria(value: unknown): string[] {
  return String(Array.isArray(value) ? value.join("\n") : value ?? "")
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function jiraBrowserUrlContext(sourceContext: string): string {
  const jira = jiraContext(sourceContext);
  const summary = /^Summary:\s*(.+)$/im.exec(jira)?.[1] || "";
  return criteria(jira)
    .filter(
    (clause) =>
      URL_CONTEXT.test(clause) &&
      BROWSER_CONTEXT.test(`${summary} ${clause}`) &&
      !(API_CONTEXT.test(clause) && !BROWSER_CONTEXT.test(clause))
    )
    .join("\n");
}

function frontendRouterBlocks(sourceContext: string): string[] {
  return frontendBlocks(sourceContext).filter((block) =>
    /\b(?:useSearchParams|searchParams|URLSearchParams|location\.search|router|navigate)\b/.test(block)
  );
}

function sourceWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => normalizeKey(word))
    .filter(Boolean);
}

function routeSurfaceWords(startRoute: unknown): string[] {
  const segments = String(startRoute ?? "")
    .split(/[?#]/, 1)[0]
    ?.split("/")
    .filter(Boolean) ?? [];
  const personaIndex = segments.findIndex((segment) =>
    /^(?:company|talent)$/.test(segment.toLowerCase())
  );
  const surface = segments[personaIndex >= 0 ? personaIndex + 1 : 0] || "";
  return sourceWords(surface);
}

function frontendBlockMatchesRoute(block: string, startRoute: unknown): boolean {
  const routeWords = routeSurfaceWords(startRoute);
  if (routeWords.length === 0) return false;

  const header = block.split(/\r?\n/, 1)[0] || "";
  const fileWords = sourceWords(header);
  if (!routeWords.every((word) => fileWords.includes(word))) return false;

  const surfaceWord = routeWords.at(-1);
  const routeTargetsAll = routeWords[0] === "all";
  const fileTargetsAll = fileWords.some(
    (word, index) => word === "all" && fileWords[index + 1] === surfaceWord
  );
  return routeTargetsAll === fileTargetsAll;
}

function matchesGroundedQueryAssertion(expected: string, context: string): boolean {
  if (!context) return false;
  if (context.includes(expected)) return true;

  const match = /^([A-Za-z][A-Za-z0-9_.-]*)=([^\s&#]*)$/.exec(expected);
  if (!match) return true;

  const [, queryKey, value] = match;
  if (!queryKey || value) return false;
  const key = queryKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(
      `\\b[A-Za-z_$][A-Za-z0-9_$]*(?:Params|Parameters)\\s*\\.\\s*` +
        `(?:get|set|append|delete|has)\\s*\\(\\s*["'\`]${key}["'\`]`,
      "i"
    ),
    new RegExp(
      `\\b(?:queryKey|queryParam|queryParameter)\\s*[:=]\\s*["'\`]${key}["'\`]`,
      "i"
    ),
    new RegExp(`\\b${key}\\b\\s+(?:query\\s+)?(?:key|parameter|param)\\b`, "i"),
    new RegExp(
      `\\b(?:query\\s+)?(?:key|parameter|param)\\s+(?:named\\s+)?["'\`]?${key}["'\`]?\\b`,
      "i"
    ),
  ].some((pattern) => pattern.test(context));
}

function explicitRouterQueryKeys(context: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /\b[A-Za-z_$][A-Za-z0-9_$]*(?:Params|Parameters)\s*\.\s*(?:get|set|append|delete|has)\s*\(\s*["'`]([A-Za-z][A-Za-z0-9_.-]*)["'`]/gi,
    /\b(?:queryKey|queryParam|queryParameter)\s*[:=]\s*["'`]([A-Za-z][A-Za-z0-9_.-]*)["'`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of context.matchAll(pattern)) {
      if (match[1]) keys.add(match[1]);
    }
  }
  return [...keys];
}

function semanticQueryKey(value: string): string {
  return value.toLowerCase().replace(/id$/, "");
}

export function hasSourceGroundedQueryAssertion(
  expected: string,
  sourceContext: string,
  startRoute?: unknown
): boolean {
  const match = /^([A-Za-z][A-Za-z0-9_.-]*)=([^\s&#]*)$/.exec(expected);
  if (!match) return true;

  const jiraContext = jiraBrowserUrlContext(sourceContext);
  if (matchesGroundedQueryAssertion(expected, jiraContext)) return true;

  const routerBlocks = frontendRouterBlocks(sourceContext);
  const scopedRouterBlocks = startRoute
    ? routerBlocks.filter((block) => frontendBlockMatchesRoute(block, startRoute))
    : routerBlocks;
  const routerContext = scopedRouterBlocks.join("\n");
  if (!routerContext) return false;

  const assertedKey = match[1] || "";
  const competingKeys = explicitRouterQueryKeys(routerContext).filter(
    (key) => semanticQueryKey(key) === semanticQueryKey(assertedKey)
  );
  if (new Set(competingKeys.map((key) => key.toLowerCase())).size > 1) return false;

  return matchesGroundedQueryAssertion(expected, routerContext);
}

function normalizeKey(value: unknown): string {
  const words = String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        ![
          "a",
          "an",
          "the",
          "of",
          "other",
          "remaining",
          "rest",
          "filter",
          "filters",
        ].includes(word)
    );
  const last = words.at(-1);
  if (last?.endsWith("ies") && last.length > 4) words[words.length - 1] = `${last.slice(0, -3)}y`;
  else if (
    last?.endsWith("s") &&
    !/(?:ss|us|is)$/.test(last) &&
    last.length > 3
  ) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join("-");
}

function normalizeVisibleControlLabel(value: unknown): string {
  return normalizeKey(
    String(value ?? "")
      .replace(/\b(?:select|choose|pick)\b/gi, " ")
      .replace(/\b(?:a|an|the)\b/gi, " ")
  );
}

function discoverDirectVisibleControls(sourceContext: string): FilterEvidence[] {
  const found: FilterEvidence[] = [];
  const controlTag = String.raw`(?:select|[A-Za-z][A-Za-z0-9_.:-]*(?:Select|Combobox|Dropdown))`;

  for (const block of frontendBlocks(sourceContext)) {
    const sourceLabel = block.split(/\r?\n/, 1)[0] || "Frontend visible filter control";
    const directAttribute = new RegExp(
      String.raw`<${controlTag}\b[^>]*\b(?:aria-label|placeholder|label)\s*=\s*["'\x60]([^"'\x60]+)["'\x60][^>]*>`,
      "gi"
    );
    const roleThenName =
      /<[A-Za-z][A-Za-z0-9_.:-]*\b[^>]*\brole\s*=\s*["'`]combobox["'`][^>]*\b(?:aria-label|placeholder|label)\s*=\s*["'`]([^"'`]+)["'`][^>]*>/gi;
    const nameThenRole =
      /<[A-Za-z][A-Za-z0-9_.:-]*\b[^>]*\b(?:aria-label|placeholder|label)\s*=\s*["'`]([^"'`]+)["'`][^>]*\brole\s*=\s*["'`]combobox["'`][^>]*>/gi;

    for (const pattern of [directAttribute, roleThenName, nameThenRole]) {
      for (const match of block.matchAll(pattern)) {
        const hint = String(match[1] || "").replace(/\s+/g, " ").trim();
        const filterKey = normalizeVisibleControlLabel(hint);
        if (!filterKey) continue;
        found.push({
          clause: sourceLabel,
          filterKey,
          hint,
          menuHint: "filter",
          visibleControlGrounded: true,
        });
      }
    }

    for (const match of block.matchAll(/<label\b([^>]*)>([^<]+)<\/label>/gi)) {
      const attributes = match[1] || "";
      const hint = String(match[2] || "").replace(/\s+/g, " ").trim();
      const filterKey = normalizeVisibleControlLabel(hint);
      if (!filterKey) continue;

      const htmlFor = /\bhtmlFor\s*=\s*["'`]([^"'`]+)["'`]/i.exec(attributes)?.[1];
      const labelEnd = (match.index || 0) + match[0].length;
      const nearbySource = block.slice(labelEnd, labelEnd + 320);
      const associatedById =
        !!htmlFor &&
        new RegExp(
          String.raw`<${controlTag}\b[^>]*\bid\s*=\s*["'\x60]${htmlFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\x60]`,
          "i"
        ).test(block);
      const adjacentControl = new RegExp(String.raw`<${controlTag}\b`, "i").test(nearbySource);
      if (!associatedById && !adjacentControl) continue;

      found.push({
        clause: sourceLabel,
        filterKey,
        hint,
        menuHint: "filter",
        visibleControlGrounded: true,
      });
    }
  }

  return found;
}

function inferDimension(clause: string): Pick<FilterEvidence, "filterKey" | "hint"> | null {
  for (const pattern of [
    /\bbased\s+on\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,2})/i,
    /\bfilter(?:ed|ing)?\s+by\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,2})/i,
    /\b([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*)?)\s+filters?\b/i,
  ]) {
    const hint = pattern.exec(clause)?.[1]?.replace(/\s+/g, " ").trim() || "";
    const filterKey = normalizeKey(hint);
    if (/^[a-z][a-z0-9-]*$/.test(filterKey)) return { filterKey, hint };
  }
  return null;
}

function discoverFilters(sourceContext: string): FilterEvidence[] {
  const jira = jiraContext(sourceContext);
  const summary = /^Summary:\s*(.+)$/im.exec(jira)?.[1] || "";
  const found: FilterEvidence[] = [];

  for (const clause of criteria(jira)) {
    if (!/\bfilter(?:s|ed|ing)?\b/i.test(clause)) continue;
    if (API_CONTEXT.test(clause) && !BROWSER_CONTEXT.test(clause)) continue;
    if (!BROWSER_CONTEXT.test(`${summary} ${clause}`)) continue;
    const dimension = inferDimension(clause);
    if (dimension) {
      found.push({
        clause,
        ...dimension,
        menuHint: /\bfilters\b/i.test(clause) ? "filters" : "filter",
        visibleControlGrounded: false,
      });
    }
  }

  if (found.length === 0) {
    for (const block of frontendBlocks(sourceContext)) {
      if (
        !/\bfilter(?:s|ed|ing)?\b/i.test(block) ||
        !/\b(?:select|dropdown|menu|options?|FilterDefinition|use[A-Za-z0-9]*Filters)\b/.test(block)
      ) continue;
      for (const match of block.matchAll(/\bfilters\.([A-Za-z][A-Za-z0-9_]*)\b/g)) {
        const hint = match[1] || "";
        const filterKey = normalizeKey(hint);
        if (filterKey) {
          found.push({
            clause: block.split(/\r?\n/, 1)[0] || `Frontend UI filter ${hint}`,
            filterKey,
            hint,
            menuHint: "filter",
            visibleControlGrounded: false,
          });
        }
      }
    }
  }

  found.push(...discoverDirectVisibleControls(sourceContext));

  const merged = new Map<string, FilterEvidence>();
  for (const item of found) {
    const existing = merged.get(item.filterKey);
    merged.set(
      item.filterKey,
      existing
        ? {
            ...existing,
            hint: item.visibleControlGrounded ? item.hint : existing.hint,
            visibleControlGrounded:
              existing.visibleControlGrounded || item.visibleControlGrounded,
          }
        : item
    );
  }
  return [...merged.values()];
}

function caseText(browserCase: any): string {
  return [
    browserCase?.goal,
    browserCase?.successCriteria,
    ...(Array.isArray(browserCase?.automatedChecks)
      ? browserCase.automatedChecks
      : browserCase?.automatedChecks
        ? [browserCase.automatedChecks]
        : []),
    ...(Array.isArray(browserCase?.steps)
      ? browserCase.steps.flatMap((step: any) => [
          step?.action,
          step?.text,
          step?.hint,
          step?.filterKey,
          step?.queryKey,
        ])
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function runtimeStepMatches(step: any, filterKey: string): boolean {
  return (
    step?.action === "selectRuntimeFilterOption" &&
    [step?.filterKey, step?.queryKey].some((value) => normalizeKey(value) === filterKey)
  );
}

function isFilterCase(browserCase: any, evidence: FilterEvidence): boolean {
  const text = caseText(browserCase);
  const normalizedText = String(text)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => normalizeKey(word))
    .filter(Boolean)
    .join(" ");
  const normalizedDimension = evidence.filterKey.replace(/-/g, " ");
  return (
    (browserCase?.steps || []).some((step: any) => runtimeStepMatches(step, evidence.filterKey)) ||
    (/\bfilter(?:s|ed|ing)?\b/i.test(text) &&
      (` ${normalizedText} `.includes(` ${normalizedDimension} `)))
  );
}

function groundedQueryKey(
  browserCase: any,
  evidence: FilterEvidence,
  sourceContext: string
): string | null {
  const candidates = [
    ...(browserCase?.steps || [])
      .filter((step: any) => step?.action === "selectRuntimeFilterOption")
      .map((step: any) => String(step?.queryKey || "").trim()),
    evidence.filterKey,
  ];
  return candidates.find(
    (key) =>
      key &&
      hasSourceGroundedQueryAssertion(
        `${key}=`,
        sourceContext,
        browserCase?.startRoute
      )
  ) || null;
}

function repairCase(
  browserCase: any,
  evidence: FilterEvidence,
  queryKey: string | null
): void {
  let steps = Array.isArray(browserCase?.steps) ? [...browserCase.steps] : [];
  let menuIndex = steps.findIndex(
    (step: any) => step?.action === "openMenu" && /\bfilter(?:s|ed|ing)?\b/i.test(String(step?.text || ""))
  );
  if (menuIndex < 0) {
    menuIndex = steps.findIndex((step: any) => String(step?.action || "").startsWith("assert"));
    if (menuIndex < 0) menuIndex = steps.length;
    steps.splice(menuIndex, 0, { action: "openMenu", text: evidence.menuHint });
  }

  const exactOptionIndex = steps.findIndex(
    (step: any, index: number) => index > menuIndex && step?.action === "selectOption" && String(step?.text || "").trim()
  );
  let runtimeIndex = steps.findIndex((step: any) => runtimeStepMatches(step, evidence.filterKey));
  if (exactOptionIndex < 0 && runtimeIndex < 0) {
    runtimeIndex = menuIndex + 1;
    steps.splice(runtimeIndex, 0, { action: "selectRuntimeFilterOption" });
  }
  if (runtimeIndex >= 0) {
    const hint = steps[runtimeIndex]?.hint || evidence.hint;
    steps[runtimeIndex] = queryKey
      ? { action: "selectRuntimeFilterOption", queryKey, hint, verification: "url" }
      : {
          action: "selectRuntimeFilterOption",
          filterKey: evidence.filterKey,
          hint,
          verification: "visible-state",
        };
  }

  if (queryKey) {
    const expected = `${queryKey}=`;
    const selectionIndex = runtimeIndex >= 0 ? runtimeIndex : exactOptionIndex;
    if (
      selectionIndex >= 0 &&
      !steps.some(
        (step: any) => step?.action === "assertUrlContains" && String(step?.text || "").trim() === expected
      )
    ) {
      steps.splice(selectionIndex + 1, 0, { action: "assertUrlContains", text: expected });
    }
  } else {
    const expected = `${evidence.filterKey}=`;
    steps = steps.filter(
      (step: any) =>
        !(step?.action === "assertUrlContains" && String(step?.text || "").trim() === expected)
    );
    if (!steps.some((step: any) => /^assertUrl(?:Contains|NotContains)$/.test(String(step?.action || "")))) {
      steps = steps.filter((step: any) => step?.action !== "reload");
    }
  }
  browserCase.steps = steps;

  const manualChecks = Array.isArray(browserCase?.manualChecks)
    ? browserCase.manualChecks.map(String)
    : browserCase?.manualChecks
      ? [String(browserCase.manualChecks)]
      : [];
  if (!manualChecks.some((check: string) => /\b(?:backend|network|returned|rows?|records?)\b/i.test(check))) {
    manualChecks.push(
      `Verify separately that records returned for the source-grounded "${evidence.hint}" filter ` +
        `match the selected option; visible-state selection alone does not prove backend, network, ` +
        `reload-persistence, or option-to-value semantics.`
    );
  }
  browserCase.manualChecks = [...new Set(manualChecks.map((check: string) => check.replace(/\s+/g, " ").trim()))];
}

function canonicalizeRuntimeSteps(browserCases: any[], sourceContext: string): void {
  for (const browserCase of browserCases) {
    if (!Array.isArray(browserCase?.steps)) continue;
    browserCase.steps = browserCase.steps.map((step: any) => {
      if (step?.action !== "selectRuntimeFilterOption") return step;
      const queryKey = String(step?.queryKey || "").trim();
      const hint = String(step?.hint || "").trim();
      if (
        queryKey &&
        hasSourceGroundedQueryAssertion(
          `${queryKey}=`,
          sourceContext,
          browserCase?.startRoute
        )
      ) {
        return { action: "selectRuntimeFilterOption", queryKey, ...(hint ? { hint } : {}), verification: "url" };
      }
      return step;
    });
  }
}

export function applySourceGroundedBrowserFilterCoverage(plan: any, sourceContext: string): any {
  const browserCases = Array.isArray(plan?.browserCases) ? plan.browserCases : [];
  canonicalizeRuntimeSteps(browserCases, sourceContext);
  let repaired = 0;

  for (const evidence of discoverFilters(sourceContext)) {
    const matchingCases = browserCases.filter((candidate: any) =>
      isFilterCase(candidate, evidence)
    );
    if (matchingCases.length !== 1) continue;

    const browserCase = matchingCases[0];
    const queryKey = groundedQueryKey(browserCase, evidence, sourceContext);
    if (!queryKey && !evidence.visibleControlGrounded) continue;

    repairCase(browserCase, evidence, queryKey);
    repaired += 1;
  }

  plan.browserCases = browserCases;
  if (repaired) {
    console.log(` Planner browser filter coverage gate: ${repaired} source-grounded filter behavior(s) validated or repaired.`);
  }
  return plan;
}
