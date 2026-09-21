import type { Page, Request } from "playwright";

export type BrowserCaseRuntimeAudit = {
  caseId: string;
  safety: { status: "COMPLETE"; attemptedActionCount: number; unsafeExecutionCount: number } | { status: "INCOMPLETE" };
  productRequests: { status: "COMPLETE"; nonGetAttempts: Array<{ method: string; path: string }> } | { status: "INCOMPLETE" };
  persistence: { status: "CLEAN" | "VIOLATION" } | { status: "UNAVAILABLE" };
  testData: { status: "CLEAR" | "TEST_DATA_ISSUE" } | { status: "UNAVAILABLE" };
};

export type BrowserCaseRuntimeAuditController = {
  recordSafetyEvaluation(evaluation: { safeToExecute: boolean; executed: boolean }): void;
  completeSafetyAccounting(): void;
  recordPersistence(result: "CLEAN" | "VIOLATION"): void;
  recordTestData(result: "CLEAR" | "TEST_DATA_ISSUE"): void;
  finish(): BrowserCaseRuntimeAudit;
};

/**
 * A page-scoped observer. Requests are admitted only while this case's audit
 * is active, so authentication/navigation before begin and later cases cannot
 * contaminate the count. It observes; it never authorizes or blocks traffic.
 */
export function beginBrowserCaseRuntimeAudit(args: {
  caseId: string;
  page: Pick<Page, "on" | "off">;
  productOrigin: string;
}): BrowserCaseRuntimeAuditController {
  const origin = new URL(args.productOrigin).origin;
  const nonGetAttempts: Array<{ method: string; path: string }> = [];
  let active = true;
  let finishedAudit: BrowserCaseRuntimeAudit | null = null;
  let safetyComplete = false;
  let attemptedActionCount = 0;
  let unsafeExecutionCount = 0;
  let persistence: BrowserCaseRuntimeAudit["persistence"] = { status: "UNAVAILABLE" };
  let testData: BrowserCaseRuntimeAudit["testData"] = { status: "UNAVAILABLE" };
  const onRequest = (request: Request) => {
    if (!active) return;
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.origin === origin && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      nonGetAttempts.push({ method, path: url.pathname });
    }
  };
  args.page.on("request", onRequest);
  return {
    recordSafetyEvaluation(evaluation) {
      if (!active) return;
      attemptedActionCount += 1;
      if (!evaluation.safeToExecute && evaluation.executed) unsafeExecutionCount += 1;
    },
    completeSafetyAccounting() { if (active) safetyComplete = true; },
    recordPersistence(result) { if (active) persistence = { status: result }; },
    recordTestData(result) { if (active) testData = { status: result }; },
    finish() {
      if (finishedAudit) return finishedAudit;
      active = false;
      args.page.off("request", onRequest);
      /*
       * CLEAN_NO_PERSISTENCE_ACTIVITY is stricter than a zero request count:
       * the case safety scope must also have completed, so every generic
       * executable opportunity was deterministically evaluated.
       */
      if (
        persistence.status === "UNAVAILABLE" &&
        safetyComplete &&
        unsafeExecutionCount === 0 &&
        nonGetAttempts.length === 0
      ) {
        persistence = { status: "CLEAN" };
      }
      finishedAudit = {
        caseId: args.caseId,
        safety: safetyComplete ? { status: "COMPLETE", attemptedActionCount, unsafeExecutionCount } : { status: "INCOMPLETE" },
        productRequests: { status: "COMPLETE", nonGetAttempts: [...nonGetAttempts] },
        persistence,
        testData,
      };
      return finishedAudit;
    },
  };
}
