import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequirementActionPlan,
} from "./browser-requirement-action-plan.js";

test(
  "promotes canonical menu option visibility into one scoped structural assertion",
  () => {
    const plan =
      buildRequirementActionPlan({
        successCriteria:
          "Newest, Latest, and Oldest are available as distinct options.",
        steps: [
          {
            action: "openMenu",
            text: "Sort",
          },
          {
            action:
              "assertTextVisible",
            text: "Newest",
          },
          {
            action:
              "assertTextVisible",
            text: "Latest",
          },
          {
            action:
              "assertTextVisible",
            text: "Oldest",
          },
        ],
      });

    assert.deepEqual(
      plan.steps,
      [
        {
          action: "openMenu",
          text: "Sort",
        },
        {
          action:
            "assertSurfaceControls",
          surfaceKind: "menu",
          controls: [
            {
              kind: "menuitem",
              label: "Newest",
            },
            {
              kind: "menuitem",
              label: "Latest",
            },
            {
              kind: "menuitem",
              label: "Oldest",
            },
          ],
        },
      ]
    );
  }
);

test(
  "recognizes after-each-option wording and preserves selected-state verification",
  () => {
    const plan =
      buildRequirementActionPlan({
        successCriteria:
          "Newest, Latest, and Oldest are available as distinct options. " +
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
          },
          {
            action:
              "assertTextVisible",
            text: "Latest",
          },
          {
            action:
              "assertTextVisible",
            text: "Oldest",
          },
        ],
      });

    assert.deepEqual(
      plan.steps.map(
        (step) =>
          step.action
      ),
      [
        "openMenu",
        "assertSurfaceControls",
        "selectOption",
        "openMenu",
        "selectOption",
        "openMenu",
        "selectOption",
      ]
    );

    assert.deepEqual(
      plan.steps
        .filter(
          (step) =>
            step.action ===
            "selectOption"
        )
        .map(
          (step) =>
            step.action ===
              "selectOption"
              ? step.text
              : ""
        ),
      [
        "Newest",
        "Latest",
        "Oldest",
      ]
    );
  }
);

test(
  "does not aggregate canonical oracle identities that would be lost",
  () => {
    const originalSteps = [
      {
        action:
          "openMenu" as const,
        text: "Sort",
      },
      {
        action:
          "assertTextVisible" as const,
        text: "Newest",
        oracleId:
          "newest-visible",
      },
      {
        action:
          "assertTextVisible" as const,
        text: "Latest",
        oracleId:
          "latest-visible",
      },
    ];

    const plan =
      buildRequirementActionPlan({
        successCriteria:
          "The options are visible.",
        steps:
          originalSteps,
      });

    assert.deepEqual(
      plan.steps,
      originalSteps
    );
  }
);

test(
  "does not structurally promote duplicate canonical labels",
  () => {
    const originalSteps = [
      {
        action:
          "openMenu" as const,
        text: "Sort",
      },
      {
        action:
          "assertTextVisible" as const,
        text: "Newest",
      },
      {
        action:
          "assertTextVisible" as const,
        text: "Newest",
      },
    ];

    const plan =
      buildRequirementActionPlan({
        successCriteria:
          "The options are visible.",
        steps:
          originalSteps,
      });

    assert.deepEqual(
      plan.steps,
      originalSteps
    );
  }
);
