import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePlannerBrowserScopes,
} from "./planner-browser-policy.js";

test(
  "canonical browser assertions receive stable oracle IDs",
  () => {
    const plan: any = {
      browserCases: [
        {
          id: "web-7",
          goal: "Verify scoped behavior.",
          successCriteria:
            "Verify scoped behavior.",
          steps: [
            {
              action: "wait",
              ms: 100,
            },
            {
              action:
                "assertTextVisible",
              text: "Alpha",
            },
            {
              action:
                "assertUrlContains",
              text: "tab=jobs",
              oracleId:
                "custom-existing-oracle",
            },
            {
              action:
                "assertTextNotVisible",
              text: "undefined",
            },
          ],
        },
      ],
    };

    normalizePlannerBrowserScopes(plan);

    const firstPass =
      plan.browserCases[0].steps;

    assert.equal(
      firstPass[0].oracleId,
      undefined
    );

    assert.equal(
      firstPass[1].oracleId,
      "web-7:assertion-1"
    );

    assert.equal(
      firstPass[1]
        .acceptanceCritical,
      undefined
    );

    assert.equal(
      firstPass[2].oracleId,
      "custom-existing-oracle"
    );

    assert.equal(
      firstPass[3].oracleId,
      "web-7:assertion-2"
    );

    normalizePlannerBrowserScopes(plan);

    const secondPass =
      plan.browserCases[0].steps;

    assert.deepEqual(
      secondPass.map(
        (step: any) =>
          step.oracleId
      ),
      firstPass.map(
        (step: any) =>
          step.oracleId
      )
    );
  }
);
