import type {
  Response,
} from "playwright";

export function positiveNumericResourceId(
  value: unknown
): string | null {
  const normalized =
    String(value ?? "").trim();

  return /^[1-9]\d*$/.test(normalized)
    ? normalized
    : null;
}

/*
 * Extract a concrete created-resource ID from either:
 *
 * - a scalar response body;
 * - a direct resource object;
 * - one of the profile-provided response wrappers.
 *
 * Resource-specific aliases remain outside this helper.
 */
export function findCreatedResourceId(
  value: unknown,
  idKeys: readonly string[],
  wrapperKeys: readonly string[],
  depth = 0
): string | null {
  if (depth > 3) {
    return null;
  }

  const scalarId =
    positiveNumericResourceId(value);

  if (scalarId) {
    return scalarId;
  }

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const record =
    value as Record<string, unknown>;

  for (const key of idKeys) {
    const directId =
      positiveNumericResourceId(
        record[key]
      );

    if (directId) {
      return directId;
    }
  }

  for (const key of wrapperKeys) {
    const nestedId =
      findCreatedResourceId(
        record[key],
        idKeys,
        wrapperKeys,
        depth + 1
      );

    if (nestedId) {
      return nestedId;
    }
  }

  return null;
}

export function getResponseRequestHeader(
  response: Response,
  headerName: string
): string | undefined {
  const wanted =
    headerName.toLowerCase();

  for (
    const [key, value]
    of Object.entries(
      response.request().headers()
    )
  ) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }

  return undefined;
}
