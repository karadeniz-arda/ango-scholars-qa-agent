import type {
  Page,
} from "playwright";

export type CreatedResourceRedirectContract = {
  resourceLabel: string;

  extractPathResourceId: (
    pathname: string
  ) => string | null;

  buildExpectedPath: (
    resourceId: string
  ) => string;

  requiredQueryParams: Array<{
    key: string;
    value: string;
  }>;

  forbiddenQueryParams: Array<{
    key: string;
    note: string;
  }>;

  forbiddenUrlValues: Array<{
    value: string;
    note: string;
  }>;
};

export type CreatedResourceRedirectEvaluation = {
  finalUrl: URL;
  responseResourceId: string | null;
  routeResourceId: string | null;
  createdResourceId: string | null;
  assertionFailures: string[];
};

export async function evaluateCreatedResourceRedirect(
  page: Page,
  args: {
    responseResourceId: string | null;
    contract: CreatedResourceRedirectContract;
    timeoutMs?: number;
  }
): Promise<CreatedResourceRedirectEvaluation> {
  const timeoutMs =
    args.timeoutMs ?? 15000;

  await page
    .waitForURL(
      (url) =>
        Boolean(
          args.contract
            .extractPathResourceId(
              url.pathname
            )
        ),
      {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      }
    )
    .catch(() => undefined);

  const finalUrl =
    new URL(page.url());

  const routeResourceId =
    args.contract
      .extractPathResourceId(
        finalUrl.pathname
      );

  const createdResourceId =
    args.responseResourceId ||
    routeResourceId;

  const assertionFailures =
    new Set<string>();

  if (createdResourceId) {
    const expectedPath =
      args.contract.buildExpectedPath(
        createdResourceId
      );

    if (
      finalUrl.pathname !==
      expectedPath
    ) {
      assertionFailures.add(
        `expected pathname ${expectedPath}, ` +
        `actual ${finalUrl.pathname}`
      );
    }
  }

  if (
    args.responseResourceId &&
    routeResourceId &&
    args.responseResourceId !==
      routeResourceId
  ) {
    assertionFailures.add(
      `created response id=` +
      `${args.responseResourceId} ` +
      `does not match route id=` +
      `${routeResourceId}`
    );
  }

  for (
    const requirement
    of args.contract.requiredQueryParams
  ) {
    const actualValue =
      finalUrl.searchParams.get(
        requirement.key
      );

    if (
      actualValue !==
      requirement.value
    ) {
      assertionFailures.add(
        `expected ${requirement.key}=` +
        `${requirement.value}, actual ` +
        `${requirement.key}=` +
        `${actualValue || "(missing)"}`
      );
    }
  }

  const finalQueryKeys =
    Array.from(
      finalUrl.searchParams.keys()
    );

  for (
    const forbidden
    of args.contract.forbiddenQueryParams
  ) {
    const forbiddenKey =
      forbidden.key.toLowerCase();

    const present =
      finalQueryKeys.some(
        (key) =>
          key.toLowerCase() ===
          forbiddenKey
      );

    if (present) {
      assertionFailures.add(
        forbidden.note
      );
    }
  }

  const lowerFinalUrl =
    finalUrl
      .toString()
      .toLowerCase();

  for (
    const forbidden
    of args.contract.forbiddenUrlValues
  ) {
    if (
      lowerFinalUrl.includes(
        forbidden.value.toLowerCase()
      )
    ) {
      assertionFailures.add(
        forbidden.note
      );
    }
  }

  return {
    finalUrl,
    responseResourceId:
      args.responseResourceId,
    routeResourceId,
    createdResourceId,
    assertionFailures:
      Array.from(assertionFailures),
  };
}
