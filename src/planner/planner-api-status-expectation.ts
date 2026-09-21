const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

function isValidHttpStatus(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_HTTP_STATUS &&
    value <= MAX_HTTP_STATUS
  );
}

function normalizeExpectedStatus(
  value: unknown
): number | "UNKNOWN" {
  if (isValidHttpStatus(value)) {
    return value;
  }

  const text = String(value ?? "")
    .trim()
    .toUpperCase();

  if (text === "UNKNOWN") {
    return "UNKNOWN";
  }

  if (/^\d{3}$/.test(text)) {
    const numericStatus = Number(text);

    if (isValidHttpStatus(numericStatus)) {
      return numericStatus;
    }
  }

  return "UNKNOWN";
}

/**
 * Keep machine-readable API expectations aligned with
 * the runtime contract.
 *
 * Alternative or prose-like status encodings are not
 * interpreted here. When the source does not establish
 * one exact status, the existing UNKNOWN sentinel makes
 * the case block before a request is sent.
 */
export function normalizePlannerApiStatusExpectations(
  plan: any
): any {
  if (!Array.isArray(plan?.apiCases)) {
    return plan;
  }

  for (const testCase of plan.apiCases) {
    if (
      !testCase ||
      typeof testCase !== "object"
    ) {
      continue;
    }

    const expect =
      testCase.expect &&
      typeof testCase.expect === "object"
        ? testCase.expect
        : {};

    const originalStatus =
      expect.status;

    const normalizedStatus =
      normalizeExpectedStatus(
        originalStatus
      );

    testCase.expect = {
      ...expect,
      status: normalizedStatus,
    };

    if (
      normalizedStatus === "UNKNOWN" &&
      String(originalStatus ?? "")
        .trim()
        .toUpperCase() !== "UNKNOWN"
    ) {
      console.log(
        ` Planner API expectation repair: ` +
          `${testCase.id || "case"} normalized ` +
          `invalid expect.status to UNKNOWN.`
      );
    }
  }

  return plan;
}
