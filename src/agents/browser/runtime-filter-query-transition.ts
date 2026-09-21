import type {
  Page,
} from "playwright";

export type RuntimeFilterVerificationMode =
  | "url"
  | "visible-state";

export type RuntimeFilterInteractionResult = {
  ok: boolean;
  note: string;
  selectedLabel?: string;
  interactionSucceeded?: boolean;
  observedSelectedLabel?:
    | string
    | null;
  visibleStateVerified?: boolean;
};

type QueryState = {
  has: boolean;
  values: string[];
};

function readQueryState(
  rawUrl: string,
  queryKey: string
): QueryState {
  try {
    const url = new URL(rawUrl);

    return {
      has:
        url.searchParams.has(
          queryKey
        ),
      values:
        url.searchParams.getAll(
          queryKey
        ),
    };
  } catch {
    return {
      has: false,
      values: [],
    };
  }
}

function queryStateChanged(
  before: QueryState,
  after: QueryState
): boolean {
  return (
    before.has !== after.has ||
    JSON.stringify(
      before.values
    ) !==
      JSON.stringify(
        after.values
      )
  );
}

function compactQueryFamilyKey(
  value: string
): string {
  return value
    .replace(/[_\-.]+/g, "")
    .toLowerCase()
    .replace(/ids?$/, "");
}

function findRelatedChangedQueryKey(
  beforeUrl: string,
  afterUrl: string,
  expectedKey: string
): string | null {
  try {
    const before =
      new URL(beforeUrl);

    const after =
      new URL(afterUrl);

    const expectedFamily =
      compactQueryFamilyKey(
        expectedKey
      );

    const keys =
      new Set([
        ...before.searchParams.keys(),
        ...after.searchParams.keys(),
      ]);

    for (const key of keys) {
      if (
        key === expectedKey ||
        compactQueryFamilyKey(key) !==
          expectedFamily
      ) {
        continue;
      }

      const beforeValues =
        before.searchParams.getAll(key);

      const afterValues =
        after.searchParams.getAll(key);

      if (
        JSON.stringify(beforeValues) !==
        JSON.stringify(afterValues)
      ) {
        return key;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function verifyQueryTransition(
  page: Page,
  beforeUrl: string,
  queryKey: string,
  selectedLabel: string
): Promise<RuntimeFilterInteractionResult> {
  await page.waitForTimeout(900);

  let afterUrl = page.url();

  if (afterUrl === beforeUrl) {
    await page.waitForTimeout(1100);
    afterUrl = page.url();
  }

  const beforeState =
    readQueryState(
      beforeUrl,
      queryKey
    );

  const afterState =
    readQueryState(
      afterUrl,
      queryKey
    );

  const urlChanged =
    afterUrl !== beforeUrl;

  const relevantQueryChanged =
    queryStateChanged(
      beforeState,
      afterState
    );

  if (
    urlChanged &&
    relevantQueryChanged &&
    afterState.has
  ) {
    return {
      ok: true,
      note:
        `selected runtime filter option ` +
        `"${selectedLabel}" for query key ` +
        `"${queryKey}" and observed URL ` +
        `transition: ${beforeUrl} -> ` +
        `${afterUrl}`,
    };
  }

  const relatedChangedKey =
    urlChanged
      ? findRelatedChangedQueryKey(
          beforeUrl,
          afterUrl,
          queryKey
        )
      : null;

  /*
   * The UI interaction succeeded when a related query
   * key changed. Continue execution so the following
   * exact URL assertion can determine whether this is
   * the expected contract or a deterministic mismatch.
   */
  if (relatedChangedKey) {
    return {
      ok: true,
      note:
        `selected runtime filter option ` +
        `"${selectedLabel}" and observed related ` +
        `query transition via ` +
        `"${relatedChangedKey}" instead of exact ` +
        `"${queryKey}": ${beforeUrl} -> ` +
        `${afterUrl}; exact query-key mapping ` +
        `remains for following assertions`,
    };
  }

  return {
    ok: false,
    note:
      `selected runtime filter option ` +
      `"${selectedLabel}", but query key ` +
      `"${queryKey}" transition could not ` +
      `be verified: ${beforeUrl} -> ` +
      `${afterUrl}`,
  };
}
