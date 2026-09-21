/*
 * GENERIC_BROWSER_SEMANTIC_ACTION_CYCLE_V1
 *
 * Repetition is grounded in the evaluator's semantic target,
 * not only in the model's textual action.
 *
 * The same visible label may legitimately identify different
 * controls after a verified UI transition:
 *
 *   Latest menuitem -> Latest button
 *
 * DOM order, pixel position and proximity are intentionally absent.
 */

export type GenericBrowserCycleAction = {
  kind: string;
  target: string;
  value?: unknown;
  contextText?: unknown;
};

export type GenericBrowserCycleMatchedTarget = {
  source?: unknown;
  label?: unknown;
  kind?: unknown;
  contextText?: unknown;
  externalPopup?: unknown;
  semanticOptionBinding?: unknown;
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function booleanToken(
  value: unknown
): string {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "";
}

export function buildGenericBrowserActionSignature(
  action:
    | GenericBrowserCycleAction
    | null
    | undefined,
  matchedTarget:
    | GenericBrowserCycleMatchedTarget
    | null
    | undefined
): string {
  if (!action) {
    return "";
  }

  return [
    normalize(action.kind),
    normalize(action.target),
    normalize(action.value),
    normalize(action.contextText),
    normalize(matchedTarget?.source),
    normalize(matchedTarget?.kind),
    normalize(matchedTarget?.label),
    normalize(matchedTarget?.contextText),
    booleanToken(
      matchedTarget?.externalPopup
    ),
    booleanToken(
      matchedTarget
        ?.semanticOptionBinding
    ),
  ].join("|");
}
