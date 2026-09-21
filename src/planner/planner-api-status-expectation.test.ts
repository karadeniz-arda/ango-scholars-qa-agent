import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePlannerApiStatusExpectations,
} from "./planner-api-status-expectation.js";
import {
  getBlockReason,
} from "../agents/api/api-case-blocking-policy.js";

function normalize(
  status: unknown,
  notes = ""
): any {
  const plan = {
    apiCases: [
      {
        id: "api-1",
        expect: {
          status,
          notes,
        },
      },
    ],
  };

  normalizePlannerApiStatusExpectations(
    plan
  );

  return plan.apiCases[0]!.expect;
}

test("preserves an exact numeric API status", () => {
  assert.deepEqual(
    normalize(401),
    {
      status: 401,
      notes: "",
    }
  );
});

test("repairs a numeric-string status without weakening exactness", () => {
  assert.equal(
    normalize("403").status,
    403
  );
});

test("preserves the explicit UNKNOWN sentinel", () => {
  assert.equal(
    normalize("UNKNOWN").status,
    "UNKNOWN"
  );
});

test("fails safe for an encoded status alternative", () => {
  const expect =
    normalize("401_or_403");

  assert.equal(expect.status, "UNKNOWN");

  assert.match(
    getBlockReason({
      id: "api-1",
      persona: "unauthenticated",
      method: "GET",
      path: "/resource",
      expect,
    }) ?? "",
    /Expected API status is UNKNOWN/
  );
});

test("fails safe for empty or malformed status metadata", () => {
  assert.equal(
    normalize(undefined).status,
    "UNKNOWN"
  );
  assert.equal(
    normalize([]).status,
    "UNKNOWN"
  );
  assert.equal(
    normalize(700).status,
    "UNKNOWN"
  );
});

test("does not infer statuses from prose notes", () => {
  assert.equal(
    normalize(
      "UNKNOWN",
      "The endpoint may return 401 or 403."
    ).status,
    "UNKNOWN"
  );
});
