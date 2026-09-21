import type {
  PlannerRouteEvidenceDisposition,
  PlannerRouteEvidence,
  PlannerRouteEvidenceOrigin,
} from "./types.js";
import type {
  PlannerAcceptanceSourceUnit,
} from "./planner-acceptance-source-ledger.js";

type PlannerRouteEvidenceInput = {
  jiraSummary?: string;
  jiraDescription?: string;
  jiraAcceptanceCriteria?: string;
  jiraSourceUnits?:
    PlannerAcceptanceSourceUnit[];
  githubContext?: string;
};

const INTERNAL_ROUTE_PATTERN =
  /(?:^|[\s"'`(=])((?:\/(?:company|talent|admin))(?:\/[A-Za-z0-9_.$:{}-]+)*(?:\?[A-Za-z0-9_.$:{}?&=%-]+)?)/gi;

const ORIGIN_ORDER: Record<
  PlannerRouteEvidenceOrigin,
  number
> = {
  JIRA_EXPLICIT_ROUTE: 0,
  GITHUB_ROUTER_MAPPING: 1,
  GITHUB_FRONTEND_ROUTE_LITERAL: 2,
  UI_ROUTE_MANIFEST: 3,
  UI_ROUTE_CATALOG: 4,
  DETERMINISTIC_FEATURE_POLICY: 5,
  PLANNER_LITERAL: 6,
};

function normalizeRouteLiteral(
  value: string
): string {
  return value
    .trim()
    .replace(/["'`),.;]+$/, "");
}

function extractInternalRoutes(
  text: string
): string[] {
  const routes: string[] = [];

  for (const match of text.matchAll(
    INTERNAL_ROUTE_PATTERN
  )) {
    const route = normalizeRouteLiteral(
      match[1] ?? ""
    );

    if (route) routes.push(route);
  }

  return [...new Set(routes)].sort();
}

function escapeRegularExpression(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function classifyReplacementPairs(
  text: string,
  routes: string[]
): Map<string, PlannerRouteEvidenceDisposition> {
  const dispositions =
    new Map<
      string,
      PlannerRouteEvidenceDisposition
    >();

  for (const fromRoute of routes) {
    for (const toRoute of routes) {
      if (fromRoute === toRoute) continue;

      const from = escapeRegularExpression(
        fromRoute
      );
      const to = escapeRegularExpression(
        toRoute
      );
      const replacementPatterns = [
        new RegExp(
          String.raw`${from}.{0,80}?(?:was\s+)?replaced\s+by.{0,20}?${to}`,
          "i"
        ),
        new RegExp(
          String.raw`(?:do\s+not|don't)\s+use\s+${from}.{0,80}?(?:instead\s+)?use\s+${to}`,
          "i"
        ),
        new RegExp(
          String.raw`(?:moved|redirects?)\s+from\s+${from}.{0,40}?to\s+${to}`,
          "i"
        ),
      ];

      if (
        replacementPatterns.some(
          (pattern) => pattern.test(text)
        )
      ) {
        dispositions.set(
          fromRoute,
          "REPLACED_FROM"
        );
        dispositions.set(toRoute, "CURRENT");
      }
    }
  }

  return dispositions;
}

function classifyJiraRouteMention(
  text: string,
  route: string,
  pairedDisposition?:
    PlannerRouteEvidenceDisposition
): PlannerRouteEvidenceDisposition {
  if (pairedDisposition) {
    return pairedDisposition;
  }

  const escaped = escapeRegularExpression(route);
  const resourceOrApiPatterns = [
    new RegExp(
      String.raw`\b(?:api\s+endpoint|signed\s+(?:pdf\s+)?url|download\s+url|storage\s+url|resource\s+url|artifact\s+url)\b.{0,80}?${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`${escaped}.{0,50}?\b(?:signed\s+download|resource\s+url|api\s+endpoint)\b`,
      "i"
    ),
  ];

  if (
    resourceOrApiPatterns.some(
      (pattern) => pattern.test(text)
    )
  ) {
    return "RESOURCE_OR_API";
  }

  const negatedPatterns = [
    new RegExp(
      String.raw`\b(?:do\s+not|don't)\s+use\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:should|must)\s+not\s+navigate\s+to\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\bno\s+longer\s+(?:uses?|navigates?\s+to)\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`${escaped}.{0,40}?\b(?:should|must)\s+not\s+be\s+used\b`,
      "i"
    ),
  ];
  const legacyPatterns = [
    new RegExp(
      String.raw`\b(?:old|previous|legacy)\s+route(?:\s+was|\s+is)?\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\bused\s+to\s+be\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:was\s+)?moved\s+from\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\bredirects?\s+from\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`${escaped}.{0,30}?\b(?:is\s+deprecated|was\s+removed|is\s+legacy|is\s+no\s+longer\s+used)\b`,
      "i"
    ),
  ];
  const negated = negatedPatterns.some(
    (pattern) => pattern.test(text)
  );
  const legacy = legacyPatterns.some(
    (pattern) => pattern.test(text)
  );

  if (negated && legacy) return "AMBIGUOUS";
  if (negated) return "NEGATED";
  if (legacy) return "LEGACY";

  const positivePatterns = [
    new RegExp(
      String.raw`\b(?:navigate|navigates|redirect|redirects|open|opens|verify)\s+(?:the\s+(?:browser|page)\s+)?(?:to\s+)?${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\b(?:page|route|browser\s+url)\b.{0,30}?\b(?:is\s+available\s+at|should\s+be|must\s+be|becomes|is)\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`(?:^|[;,.]\s*|\binstead\s+)use\s+${escaped}`,
      "i"
    ),
    new RegExp(
      String.raw`\bin\s+${escaped}(?:\b|[?])`,
      "i"
    ),
    new RegExp(
      String.raw`${escaped}.{0,30}?\b(?:is\s+the\s+current\s+route|is\s+the\s+browser\s+route)\b`,
      "i"
    ),
  ];

  return positivePatterns.some(
    (pattern) => pattern.test(text)
  )
    ? "CURRENT"
    : "AMBIGUOUS";
}

function dispositionReason(
  disposition:
    PlannerRouteEvidenceDisposition
): string {
  switch (disposition) {
    case "CURRENT":
      return "Jira route mention has explicit current browser-route context.";
    case "NEGATED":
      return "Jira route mention is explicitly forbidden or negated.";
    case "LEGACY":
      return "Jira route mention is explicitly described as old, legacy, deprecated, or removed.";
    case "REPLACED_FROM":
      return "Jira route mention is the replaced or redirected-from route.";
    case "RESOURCE_OR_API":
      return "Jira route-like literal is described as an API or resource URL.";
    default:
      return "Jira route mention lacks unambiguous current-route context.";
  }
}

function isFrontendSourceFile(
  file: string
): boolean {
  return /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(
    file
  );
}

function isRouterSourceFile(
  file: string
): boolean {
  return (
    isFrontendSourceFile(file) &&
    /(?:^|\/)(?:routes?|router)(?:\/|\.|$)|(?:route|router)s?\.[cm]?[jt]sx?$/i.test(
      file
    )
  );
}

function hasStructuralRouterSyntax(
  line: string
): boolean {
  return (
    /\b(?:path|to|href|redirect|navigate)\s*[:=]/i.test(
      line
    ) ||
    /<(?:Route|Navigate)\b/i.test(line) ||
    /\b(?:createBrowserRouter|createRoutesFromElements|useRoutes)\b/.test(
      line
    )
  );
}

function collectJiraEvidence(
  input: PlannerRouteEvidenceInput
): PlannerRouteEvidence[] {
  const fallbackUnits = [
    ["JIRA_SUMMARY", input.jiraSummary],
    ["JIRA_DESCRIPTION", input.jiraDescription],
    ["JIRA_ACCEPTANCE_CRITERIA", input.jiraAcceptanceCriteria],
  ].flatMap(([sourceRef, value]) =>
    String(value ?? "")
      .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
      .map((text, index) => ({
        id: `${sourceRef}:${index + 1}`,
        sourceRef,
        text: text.trim(),
      }))
      .filter((unit) => unit.text)
  );
  const units =
    Array.isArray(input.jiraSourceUnits) &&
    input.jiraSourceUnits.length > 0
      ? input.jiraSourceUnits
      : fallbackUnits;

  return units.flatMap((unit) => {
    const routes = extractInternalRoutes(
      unit.text
    );
    const pairedDispositions =
      classifyReplacementPairs(
        unit.text,
        routes
      );

    return routes.map((route) => {
      const disposition =
        classifyJiraRouteMention(
          unit.text,
          route,
          pairedDispositions.get(route)
        );

      return {
        route,
        origin:
          "JIRA_EXPLICIT_ROUTE" as const,
        sourceRef:
          `${unit.sourceRef}#${unit.id}`,
        authoritative:
          disposition === "CURRENT",
        disposition,
        reason:
          dispositionReason(disposition),
      };
    });
  });
}

function collectGithubEvidence(
  githubContext: string
): PlannerRouteEvidence[] {
  const evidence: PlannerRouteEvidence[] = [];
  let currentFile = "";
  let inPatch = false;

  for (const line of githubContext.split(/\r?\n/)) {
    const patchHeader = line.match(
      /^Patch for (.+):$/
    );

    if (patchHeader) {
      currentFile = patchHeader[1]?.trim() ?? "";
      inPatch = false;
      continue;
    }

    if (line === "```diff") {
      inPatch = true;
      continue;
    }

    if (line === "```") {
      inPatch = false;
      continue;
    }

    if (
      !inPatch ||
      !currentFile ||
      !isFrontendSourceFile(currentFile) ||
      line.startsWith("-") ||
      line.startsWith("@@") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      continue;
    }

    const structural =
      isRouterSourceFile(currentFile) &&
      hasStructuralRouterSyntax(line);

    for (const route of extractInternalRoutes(line)) {
      evidence.push({
        route,
        origin: structural
          ? "GITHUB_ROUTER_MAPPING"
          : "GITHUB_FRONTEND_ROUTE_LITERAL",
        sourceRef: currentFile,
        authoritative: structural,
        disposition: structural
          ? "CURRENT"
          : "AMBIGUOUS",
        reason: structural
          ? "Route literal appears in structural frontend router syntax."
          : "Frontend route literal is not a structural router mapping.",
      });
    }
  }

  return evidence;
}

/**
 * Extract bounded route-origin metadata before planner output exists.
 * This metadata supports navigation grounding only; it is never proof.
 */
export function extractPlannerRouteEvidence(
  input: PlannerRouteEvidenceInput
): PlannerRouteEvidence[] {
  const evidence = [
    ...collectJiraEvidence(input),
    ...collectGithubEvidence(
      input.githubContext ?? ""
    ),
  ];
  const seen = new Set<string>();

  return evidence
    .sort(
      (left, right) =>
        ORIGIN_ORDER[left.origin] -
          ORIGIN_ORDER[right.origin] ||
        left.route.localeCompare(right.route) ||
        String(left.sourceRef ?? "").localeCompare(
          String(right.sourceRef ?? "")
        )
    )
    .filter((item) => {
      const key = [
        item.origin,
        item.route,
        item.sourceRef ?? "",
        item.disposition ?? "",
      ].join("\u0000");

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}
