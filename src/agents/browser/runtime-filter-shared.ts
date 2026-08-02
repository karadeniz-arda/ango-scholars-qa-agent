import type {
  Locator,
} from "playwright";

export type FilterControlCandidate = {
  locator: Locator;
  score: number;
  descriptor: string;
  currentText: string;
  nativeSelect: boolean;
};

export type RuntimeOptionCandidate = {
  locator: Locator;
  label: string;
  score: number;
};

export function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeQueryKey(
  value: unknown
): string {
  return String(value ?? "")
    .trim();
}

export function queryKeyTokens(
  queryKey: string,
  hint?: string
): string[] {
  const splitQueryKey =
    queryKey
      .replace(
        /([a-z0-9])([A-Z])/g,
        "$1 $2"
      )
      .replace(
        /[_\-.]+/g,
        " "
      );

  const values = [
    queryKey,
    splitQueryKey,
    hint ?? "",
  ];

  const normalizedKey =
    normalize(queryKey);

  const aliases:
    Record<string, string[]> = {
      project: [
        "project",
        "projects",
      ],
      status: [
        "status",
        "statuses",
      ],
      type: [
        "type",
        "types",
      ],
      category: [
        "category",
        "categories",
      ],
      skillids: [
        "skill",
        "skills",
      ],
      searchtext: [
        "search",
        "keyword",
      ],
      maindiscipline: [
        "main discipline",
        "discipline",
      ],
      secondarydiscipline: [
        "secondary discipline",
        "discipline",
      ],
    };

  values.push(
    ...(
      aliases[normalizedKey] ??
      []
    )
  );

  const tokens = new Set<string>();

  for (const value of values) {
    const normalized =
      normalize(value);

    if (!normalized) {
      continue;
    }

    tokens.add(normalized);

    for (
      const token
      of normalized.split(
        /[^a-z0-9]+/i
      )
    ) {
      if (token.length >= 3) {
        tokens.add(token);
      }
    }
  }

  return [...tokens];
}

export function isUnsafeFilterOptionLabel(
  value: string
): boolean {
  const normalized =
    normalize(value);

  if (
    !normalized ||
    normalized.length > 120
  ) {
    return true;
  }

  if (
    /^(all|any|none|clear|reset|select|choose|search|filter|filters|apply|cancel|close|done)(\b|$)/i
      .test(normalized)
  ) {
    return true;
  }

  return [
    "delete",
    "reject",
    "approve",
    "submit",
    "publish",
    "create",
    "save",
    "send",
    "invite",
    "archive",
    "remove",
    "request publish",
    "invite external people",
    "complete",
  ].includes(normalized);
}

export async function clickVisible(
  locator: Locator
): Promise<boolean> {
  const visible =
    await locator
      .isVisible({
        timeout: 700,
      })
      .catch(() => false);

  if (!visible) {
    return false;
  }

  try {
    await locator
      .scrollIntoViewIfNeeded({
        timeout: 1000,
      });

    await locator.click({
      timeout: 1800,
    });

    return true;
  } catch {
    return false;
  }
}
