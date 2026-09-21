import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequirementActionPlan,
} from "./browser-requirement-action-plan.js";

test(
  "expands canonical menu options when every visible selection is required",
  () => {
    const testCase = {
      successCriteria:
        "After each option is selected, the visible selected value is correct.",
      steps: [
        {
          action: "openMenu",
          text: "Sort",
        },
        {
          action: "assertTextVisible",
          text: "Newest",
        },
        {
          action: "assertTextVisible",
          text: "Latest",
        },
        {
          action: "assertTextVisible",
          text: "Oldest",
        },
      ],
    };

    const result =
      buildRequirementActionPlan(
        testCase
      );

    assert.deepEqual(
      result.steps.map((step) =>
        "text" in step
          ? `${step.action}:${step.text}`
          : step.action
      ),
      [
        "openMenu:Sort",
        "assertSurfaceControls",
        "selectOption:Newest",
        "openMenu:Sort",
        "selectOption:Latest",
        "openMenu:Sort",
        "selectOption:Oldest",
      ]
    );

    const structuralAssertion =
      result.steps[1];

    assert.ok(
      structuralAssertion &&
      structuralAssertion.action ===
        "assertSurfaceControls"
    );

    if (
      structuralAssertion.action ===
      "assertSurfaceControls"
    ) {
      assert.equal(
        structuralAssertion.surfaceKind,
        "menu"
      );

      assert.deepEqual(
        structuralAssertion.controls,
        [
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
        ]
      );
    }

    assert.deepEqual(
      testCase.steps,
      [
        {
          action: "openMenu",
          text: "Sort",
        },
        {
          action: "assertTextVisible",
          text: "Newest",
        },
        {
          action: "assertTextVisible",
          text: "Latest",
        },
        {
          action: "assertTextVisible",
          text: "Oldest",
        },
      ]
    );
  }
);

test(
  "does not infer selection actions from availability assertions alone",
  () => {
    const steps = [
      {
        action: "openMenu" as const,
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
        text: "Oldest",
      },
    ];

    const result =
      buildRequirementActionPlan({
        successCriteria:
          "Newest and Oldest are available.",
        steps,
      });

    assert.deepEqual(
      result.steps,
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
              label: "Oldest",
            },
          ],
        },
      ]
    );

    assert.equal(
      result.steps.some(
        (step) =>
          step.action ===
          "selectOption"
      ),
      false
    );

    assert.equal(
      result.notes.length,
      1
    );

    assert.match(
      result.notes[0]!,
      /promoted 2 canonical menu option visibility assertions/i
    );

    /*
     * Runtime transformation must not mutate the canonical
     * planner-authored steps.
     */
    assert.deepEqual(
      steps,
      [
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
          text: "Oldest",
        },
      ]
    );
  }
);
