export type PlannerBrowserObligationSemanticFamily =
  | "SEARCH_FILTER"
  | "PAGINATION"
  | "GROUPED_CONTROLS"
  | "STATE_TRANSITION"
  | "LAYOUT_DIRECTION"
  | "SERVER_LIFECYCLE_NON_BROWSER"
  | "OTHER";

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyPlannerBrowserObligationSemanticFamily(
  value: unknown
): PlannerBrowserObligationSemanticFamily {
  const text = normalized(value);

  if (
    /\b(?:search bar|search input|search control|search field)\b/.test(text) ||
    /\bsearch\b/.test(text)
  ) {
    return "SEARCH_FILTER";
  }

  if (
    /\bpagination\b/.test(text) ||
    /\b(?:next|previous|selected) page\b/.test(text) ||
    /\bpage transition\b/.test(text)
  ) {
    return "PAGINATION";
  }

  if (
    /\b(?:radio|checkbox|custom scoring|grouped controls?)\b/.test(text)
  ) {
    return "GROUPED_CONTROLS";
  }

  if (
    /\b(?:right-to-left|left-to-right|rtl|ltr)\b/.test(text) ||
    /\b(?:text|content) direction\b/.test(text) ||
    /\b(?:headings?|paragraphs?|blocks?|lists?|blockquotes?|tables?|editor)\b.+\bdirection\b/.test(text) ||
    /\b(?:lists?|blockquotes?|tables?)\b.+\b(?:alignment|side|direction)\b/.test(text) ||
    /\b(?:alignment|anchor)\b.+\b(?:left|right|text-start)\b/.test(text)
  ) {
    return "LAYOUT_DIRECTION";
  }

  if (
    /\bsnapshot\b/.test(text) &&
    /\b(?:creat(?:e|ed|ion)|persist|store|save)\b/.test(text)
  ) {
    return "SERVER_LIFECYCLE_NON_BROWSER";
  }

  if (
    /\b(?:reset|restore|overrides?|remain unchanged|retains?|instead use|instead of|rather than)\b/.test(text) ||
    /\b(?:events?|results?)\b.+\b(?:score|pass|unchanged)\b/.test(text)
  ) {
    return "STATE_TRANSITION";
  }

  return "OTHER";
}

function hasExplicitTaskRequirementShape(
  text: string
): boolean {
  const words = text.match(/[a-z0-9]+/g) ?? [];
  const explicitOutcome =
    /\b(?:appear|appears|display|displays|displayed|show|shows|shown|render|renders|rendered|expose|exposes|exposed|see|sees|view|views|open|opens|hide|hides|prevent|prevents|allow|allows|let|lets|distinguish|distinguishes|filter|filters|filtered|mention|mentions|read|reads|say|says|retain|retains|restore|restores|refresh|refreshes|redirect|redirects)\b/.test(
      text
    );
  const hasCompletedNormativeOutcome =
    /\b(?:must|shall|should)\b/.test(text) &&
    explicitOutcome;

  if (
    words.length < 5 ||
    (/:\s*$/.test(text) &&
      !hasCompletedNormativeOutcome) ||
    /\b(?:may|might|could)\b/.test(text) ||
    /\b(?:it|this)\s+would\s+be\s+(?:useful|nice|great|helpful)\b/.test(text) ||
    /\bif\s+supported\b/.test(text) ||
    /\bbased\s+on\s+(?:a\s+)?product\s+decision\b/.test(text) ||
    /\bsuggested\b/.test(text) ||
    /\bconsider(?:ed|ing)?\b/.test(text)
  ) {
    return false;
  }

  if (
    /^(?:currently|today|at present|actual(?:ly)?)\b/.test(text) ||
    /\busers?\s+(?:have\s+)?reported\b/.test(text) ||
    /\b(?:is|are)\s+(?:currently\s+)?missing\b/.test(text)
  ) {
    return false;
  }

  if (
    /\b(?:npm\s+run|scaffold\s+functions?|generated\s+(?:query|mutation|client|file)s?|api\s+changes?|same\s+endpoint|endpoint\s+for)\b/.test(text) ||
    /^(?:implement|update|improve|revamp|refactor|rework|support)\b.*\b(?:experience|ui|flows?|feature|changes?)\b[.!]?\s*$/.test(text)
  ) {
    return false;
  }

  const concreteAddition =
    /\b(?:add|adds|added|provide|provides|provided|include|includes|included)\b/.test(
      text
    ) &&
    /\b(?:button|control|drawer|field|filter|form|information|input|label|link|list|message|modal|note|option|page|panel|request|row|screen|status|table|tab|text|value|view|warning)\b/.test(
      text
    );

  return explicitOutcome || concreteAddition;
}

/**
 * Task sections are eligible only through a bounded expected-behavior clause.
 * Recognized semantic families retain their narrow V0 rules. An unrecognized
 * family may still be an authoritative requirement when the exact Task source
 * expresses a concrete expected outcome. This authority decision neither
 * assigns a proof capability nor makes OTHER semantics automatable.
 */
export function isBoundedExplicitTaskBehavior(
  value: unknown
): boolean {
  const text = normalized(value);

  if (!text || text.length < 12) {
    return false;
  }

  const family =
    classifyPlannerBrowserObligationSemanticFamily(text);

  switch (family) {
    case "SEARCH_FILTER":
      return (
        /\b(?:add|provide|include|create|display|show)\b/.test(text) &&
        /\b(?:search bar|search input|search control|search field)\b/.test(text)
      );
    case "PAGINATION":
      return (
        /\b(?:fix|correct|provide|support)\b/.test(text) &&
        /\bpagination\b/.test(text)
      );
    case "SERVER_LIFECYCLE_NON_BROWSER":
      return (
        /\b(?:save|store|persist|take)\b/.test(text) &&
        /\bsnapshot\b/.test(text) &&
        /\b(?:when|upon)\b.+\bcreat(?:e|ed|ion)\b/.test(text)
      );
    case "STATE_TRANSITION":
      return (
        /\b(?:should\s+)?instead\s+(?:display|read|say|show|use)\b/.test(text) ||
        /\buse\b.+\b(?:instead of|rather than)\b/.test(text) ||
        /\b(?:must|shall|should)\b.+\b(?:appear|display|render|show)\w*\b.+\b(?:instead of|rather than)\b/.test(
          text
        )
      );
    case "LAYOUT_DIRECTION":
      return (
        /\b(?:render|display|type)\b/.test(text) &&
        /\b(?:right-to-left|left-to-right|rtl|ltr)\b/.test(text)
      );
    case "GROUPED_CONTROLS":
      return (
        /\b(?:add|provide|configure|group)\b/.test(text) &&
        /\b(?:radio|checkbox|controls?)\b/.test(text)
      );
    default:
      return hasExplicitTaskRequirementShape(text);
  }
}
