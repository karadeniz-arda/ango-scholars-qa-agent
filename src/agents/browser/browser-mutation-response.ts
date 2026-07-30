import type {
  Page,
  Response,
} from "playwright";

export type ObservedMutationResponse = {
  response: Response;
  requestBody: unknown;
  responseText: string;
  responseBody: unknown;
  responseSummary: string;
};

export async function observeMutationResponse(
  page: Page,
  args: {
    method: string;
    matchesResponse: (
      response: Response
    ) => boolean;
    trigger: () => Promise<unknown>;
    timeoutMs?: number;
    responseSummaryLimit?: number;
  }
): Promise<ObservedMutationResponse | null> {
  const expectedMethod =
    args.method.toUpperCase();

  let response: Response;

  try {
    const [observedResponse] =
      await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate
              .request()
              .method()
              .toUpperCase() ===
              expectedMethod &&
            args.matchesResponse(
              candidate
            ),
          {
            timeout:
              args.timeoutMs ??
              30000,
          }
        ),
        args.trigger(),
      ]);

    response = observedResponse;
  } catch {
    return null;
  }

  let requestBody: unknown = null;

  try {
    requestBody =
      response
        .request()
        .postDataJSON();
  } catch {
    requestBody = null;
  }

  const responseText =
    await response
      .text()
      .catch(() => "");

  let responseBody: unknown = null;

  if (responseText) {
    try {
      responseBody =
        JSON.parse(responseText);
    } catch {
      responseBody = null;
    }
  }

  const responseSummary =
    responseText
      .replace(/\s+/g, " ")
      .trim()
      .slice(
        0,
        args.responseSummaryLimit ??
          1600
      );

  return {
    response,
    requestBody,
    responseText,
    responseBody,
    responseSummary,
  };
}
