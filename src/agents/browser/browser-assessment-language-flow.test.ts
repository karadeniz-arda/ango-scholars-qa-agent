import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureAssessmentLanguageEditorNavigationStep,
  isAssessmentLanguageCase,
} from "./browser-assessment-language-flow.js";

test(
  "does not treat a job comparison field list as an assessment-language case",
  () => {
    assert.equal(
      isAssessmentLanguageCase({
        goal:
          "Open a publish request comparison view with full job details.",
        successCriteria:
          "Verify current and proposed Skills, Languages, and Assessments.",
        steps: [
          {
            action: "clickText",
            text: "Change requests",
          },
        ],
      }),
      false
    );
  }
);

test(
  "adds contextual verified entry for the assessment language editor",
  () => {
    const testCase = {
      id: "assessment-language",
      goal:
        "Edit assessment Language Requirements.",
      successCriteria:
        "Verify the proficiency level adjustment controls.",
      steps: [
        {
          action: "clickText",
          text: "Language Requirements",
        },
        {
          action:
            "openRuntimeControl",
          target:
            "Language Requirements",
        },
        {
          action:
            "openRuntimeControl",
          target: "Select Language",
        },
        {
          action:
            "assertTextVisible",
          text: "Listening",
        },
      ],
    };

    ensureAssessmentLanguageEditorNavigationStep(
      testCase
    );

    assert.deepEqual(
      testCase.steps.slice(0, 2),
      [
        {
          action: "clickButton",
          text: "Configure",
          contextText:
            "Language Requirements",
          verifyExpandedSurface: true,
          compatibilityNavigation: "ADVISORY",
        },
      {
        action: "clickButton",
        text: "Level Adjustment",
        compatibilityNavigation: "ADVISORY",
        assertionSurfaceGrounding: "REQUIRED",
        verifyExpandedSurface: true,
      },
      ]
    );

    assert.deepEqual(
      testCase.steps.slice(2),
      [
        {
          action:
            "openRuntimeControl",
          target: "Select Language",
        },
        {
          action:
            "assertTextVisible",
          text: "Listening",
        },
      ]
    );
  }
);

test(
  "retains real assessment language classification",
  () => {
    assert.equal(
      isAssessmentLanguageCase({
        goal:
          "Verify assessment language proficiency details.",
        successCriteria:
          "Listening, Speaking, Writing, and Reading are visible.",
      }),
      true
    );
  }
);
