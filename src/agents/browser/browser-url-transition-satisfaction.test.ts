import assert from "node:assert/strict";
import test from "node:test";

import {
  isUrlTransitionRequirementSatisfied,
} from "./browser-url-transition-satisfaction.js";

const requirement = {
  kind: "URL_TRANSITION" as const,
  sourceClaim:
    "Opening the Details link navigates to the details page.",
  interactionId:
    "web-1:interaction-1",
  urlAssertionOracleId:
    "web-1:assertion-1",
};

test(
  "satisfies URL_TRANSITION when the exact interaction and positive URL oracle both pass",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [
          {
            stepIndex: 2,
            interactionId:
              "web-1:interaction-1",
            action: "clickText",
            succeeded: true,
            note:
              'clicked text "Details"',
          },
        ],

        deterministicEvidence: [
          {
            stepIndex: 3,
            oracleId:
              "web-1:assertion-1",
            action:
              "assertUrlContains",
            expected:
              'URL contains "/details"',
            actualUrl:
              "https://example.test/details",
            passed: true,
            note:
              'assert URL contains "/details": PASS',
          },
        ],
      });

    assert.equal(satisfied, true);
  }
);

test(
  "does not satisfy URL_TRANSITION when interaction execution proof is missing",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [],

        deterministicEvidence: [
          {
            stepIndex: 3,
            oracleId:
              "web-1:assertion-1",
            action:
              "assertUrlContains",
            expected:
              'URL contains "/details"',
            passed: true,
            note:
              'assert URL contains "/details": PASS',
          },
        ],
      });

    assert.equal(satisfied, false);
  }
);

test(
  "does not satisfy URL_TRANSITION when the URL oracle is missing",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [
          {
            stepIndex: 2,
            interactionId:
              "web-1:interaction-1",
            action: "clickText",
            succeeded: true,
            note:
              'clicked text "Details"',
          },
        ],

        deterministicEvidence: [],
      });

    assert.equal(satisfied, false);
  }
);

test(
  "does not satisfy URL_TRANSITION when the exact URL oracle failed",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [
          {
            stepIndex: 2,
            interactionId:
              "web-1:interaction-1",
            action: "clickText",
            succeeded: true,
            note:
              'clicked text "Details"',
          },
        ],

        deterministicEvidence: [
          {
            stepIndex: 3,
            oracleId:
              "web-1:assertion-1",
            action:
              "assertUrlContains",
            expected:
              'URL contains "/details"',
            passed: false,
            note:
              'assert URL contains "/details": FAIL',
          },
        ],
      });

    assert.equal(satisfied, false);
  }
);

test(
  "does not satisfy URL_TRANSITION from an unrelated passing URL oracle",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [
          {
            stepIndex: 2,
            interactionId:
              "web-1:interaction-1",
            action: "clickText",
            succeeded: true,
            note:
              'clicked text "Details"',
          },
        ],

        deterministicEvidence: [
          {
            stepIndex: 3,
            oracleId:
              "web-1:assertion-2",
            action:
              "assertUrlContains",
            expected:
              'URL contains "/details"',
            passed: true,
            note:
              'assert URL contains "/details": PASS',
          },
        ],
      });

    assert.equal(satisfied, false);
  }
);

test(
  "does not use a negative URL assertion as URL_TRANSITION proof",
  () => {
    const satisfied =
      isUrlTransitionRequirementSatisfied({
        requirement,

        interactionExecutionEvidence: [
          {
            stepIndex: 2,
            interactionId:
              "web-1:interaction-1",
            action: "clickText",
            succeeded: true,
            note:
              'clicked text "Details"',
          },
        ],

        deterministicEvidence: [
          {
            stepIndex: 3,
            oracleId:
              "web-1:assertion-1",
            action:
              "assertUrlNotContains",
            expected:
              'URL does not contain "/items"',
            passed: true,
            note:
              'assert URL does not contain "/items": PASS',
          },
        ],
      });

    assert.equal(satisfied, false);
  }
);