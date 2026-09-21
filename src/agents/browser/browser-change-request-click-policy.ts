import {
  getBrowserCaseText,
} from "./browser-case-relevance.js";

export function isChangeRequestRowDetailClickRequest(
  testCase: any,
  requestedText: string
): boolean {
  const caseText =
    getBrowserCaseText(testCase)
      .replace(/[-_]+/g, " ");

  const requested = String(
    requestedText || ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (
    !requested ||
    /^change requests?$/.test(
      requested
    )
  ) {
    return false;
  }

  const changeRequestContext =
    caseText.includes(
      "change request"
    ) ||
    caseText.includes(
      "publish request"
    ) ||
    caseText.includes(
      "field update request"
    );

  const detailContext =
    caseText.includes("comparison") ||
    caseText.includes("review") ||
    caseText.includes("details") ||
    caseText.includes("detail");

  const requestedRecordState =
    requested.includes("request") ||
    requested.includes("publish") ||
    requested.includes(
      "field update"
    );

  return (
    changeRequestContext &&
    detailContext &&
    requestedRecordState
  );
}
