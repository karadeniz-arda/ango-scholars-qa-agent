import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequirementActionPlan,
} from "./browser-requirement-action-plan.js";

test(
  "runtime action-plan expansion preserves canonical assertion oracle IDs",
  () => {
    const testCase: any = {
      successCriteria:
        "After each option is selected, the visible selected value is correct.",
      steps: [
        {
          action: "openMenu",
          text: "Sort",
        },
        {
          action:
            "assertTextVisible",
          text: "Newest",
          oracleId:
            "web-1:assertion-1",
          acceptanceCritical: true,
        },
        {
          action:
            "assertTextVisible",
          text: "Latest",
          oracleId:
            "web-1:assertion-2",
          acceptanceCritical: false,
        },
      ],
    };

    const result =
      buildRequirementActionPlan(
        testCase
      );

    const assertions =
      result.steps.filter(
        (step: any) =>
          step.action ===
          "assertTextVisible"
      );

    assert.deepEqual(
      assertions.map(
        (step: any) =>
          step.oracleId
      ),
      [
        "web-1:assertion-1",
        "web-1:assertion-2",
      ]
    );

    assert.deepEqual(
      assertions.map(
        (step: any) =>
          step.acceptanceCritical
      ),
      [true, false]
    );

    const insertedSelections =
      result.steps.filter(
        (step: any) =>
          step.action ===
          "selectOption"
      );

    assert.equal(
      insertedSelections.length,
      2
    );

    assert.equal(
      insertedSelections.every(
        (step: any) =>
          step.oracleId ===
          undefined
      ),
      true
    );

    assert.equal(
      insertedSelections.every(
        (step: any) =>
          step.acceptanceCritical ===
          undefined
      ),
      true
    );
  }
);
