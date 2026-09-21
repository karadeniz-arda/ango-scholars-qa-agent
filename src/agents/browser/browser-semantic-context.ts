export const BROWSER_SEMANTIC_CONTEXT_MAX_DEPTH =
  6;

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(
  value: unknown
): string {
  return normalize(value).toLowerCase();
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

export function findBrowserSemanticContextDepth(
  ancestorTexts: string[],
  requestedContext: string
): number | null {
  const context =
    normalizedKey(requestedContext);

  if (!context) {
    return null;
  }

  const index = ancestorTexts.findIndex(
    (text) =>
      normalizedKey(text).includes(
        context
      )
  );

  return index < 0
    ? null
    : index + 1;
}

export function deriveBrowserObservationContextCandidates(
  ancestorTexts: string[],
  targetLabel: string
): string[] {
  const target = normalize(targetLabel);

  if (!target) {
    return [];
  }

  /*
   * Context used for execution must remain a contiguous substring
   * of the real ancestor text so the runtime contextual resolver
   * can verify it again without DOM-order fallback.
   *
   * Prefer text that appears before the target. This naturally
   * captures headings, field labels, row labels, card titles, and
   * other grouping semantics while remaining conservative about
   * arbitrary text that follows an interactive control.
   */
  const targetPattern = new RegExp(
    `(^|\\s)${escapeRegExp(
      target
    )}(?=\\s|$)`,
    "i"
  );

  const result: string[] = [];
  const seen = new Set<string>();

  for (const ancestorText of ancestorTexts) {
    const ancestor =
      normalize(ancestorText);
    const match =
      targetPattern.exec(ancestor);

    if (!match) {
      continue;
    }

    const targetStart =
      match.index +
      match[1]!.length;

    const candidate = normalize(
      ancestor.slice(
        0,
        targetStart
      )
    );

    const key =
      normalizedKey(candidate);

    if (
      !candidate ||
      key === normalizedKey(target) ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(candidate);
  }

  return result;
}

export function deriveBrowserObservationContext(
  ancestorTexts: string[],
  targetLabel: string
): string | null {
  const target = normalize(targetLabel);

  if (!target) {
    return null;
  }

  const targetPattern = new RegExp(
    `(^|\\s)${escapeRegExp(
      target
    )}(?=\\s|$)`,
    "gi"
  );

  for (const ancestorText of ancestorTexts) {
    const candidate = normalize(
      normalize(ancestorText).replace(
        targetPattern,
        "$1"
      )
    );

    if (candidate) {
      return candidate;
    }
  }

  return null;
}
