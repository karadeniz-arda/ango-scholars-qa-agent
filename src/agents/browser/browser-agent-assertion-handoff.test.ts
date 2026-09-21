import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGenericBrowserAssertionHandoffCase,
} from "./browser-agent-assertion-handoff.js";

test(
  "keeps only canonical deterministic assertions for autonomous handoff",
  () => {
    const testCase = {
      id: "generic-case",
      goal: "Verify the reached state.",
      steps: [
        {
          action: "clickButton",
          text: "Open",
        },
        {
          action: "assertTextVisible",
          text: "Expected field",
          oracleId: "generic-case:assertion-1",
        },
        {
          action: "selectOption",
          text: "Choice A",
        },
        {
          action: "assertTextNotVisible",
          text: "Legacy field",
          oracleId: "generic-case:assertion-2",
        },
      ],
    };

    const result =
      buildGenericBrowserAssertionHandoffCase(
        testCase
      );

    assert.deepEqual(
      result?.steps,
      [
        {
          action: "assertTextVisible",
          text: "Expected field",
          oracleId: "generic-case:assertion-1",
        },
        {
          action: "assertTextNotVisible",
          text: "Legacy field",
          oracleId: "generic-case:assertion-2",
        },
      ]
    );

    assert.equal(
      testCase.steps.length,
      4
    );
  }
);

test("does not create an autonomous handoff when no deterministic assertions exist", () => {
  const result = buildGenericBrowserAssertionHandoffCase({
    id: "generic-case",
    steps: [
      { action: "clickButton", text: "Open" },
      { action: "selectOption", text: "Choice A" },
    ],
  });
  assert.equal(result, null);
});

test("preserves planner oracle IDs while completing only missing canonical assertion IDs", () => {
  const result = buildGenericBrowserAssertionHandoffCase({
    id: "case-1",
    steps: [
      { action: "assertTextVisible", text: "Alpha", oracleId: "stable-alpha" },
      { action: "assertTextNotVisible", text: "Legacy Alpha" },
    ],
  });
  assert.deepEqual(result?.steps, [
    { action: "assertTextVisible", text: "Alpha", oracleId: "stable-alpha" },
    { action: "assertTextNotVisible", text: "Legacy Alpha", oracleId: "case-1:assertion-1" },
  ]);
});

test("a materialized contract excludes an unauthorized planner suffix from deterministic handoff", () => {
  const result = buildGenericBrowserAssertionHandoffCase({
    id: "as-1373-case",
    steps: [
      {
        action: "assertTextVisible",
        text: "Add up to 10 skills to get better job matches. You can edit them later.",
        oracleId: "planner-long-copy",
      },
      {
        action: "assertTextVisible",
        text: "add up to 10 skills",
        oracleId: "source-member-skills",
      },
    ],
    executionCheckContract: {
      schemaVersion: 1,
      caseId: "as-1373-case",
      executionObligationIds: ["obligation-skills"],
      requiredChecks: [{
        checkId: "source-member-check",
        kind: "SOURCE_BOUND_ASSERTION_MEMBER",
        authority: "SOURCE_AUTHORIZED",
        requirementId: "source-requirement-skills",
        oracle: {
          oracleId: "source-member-skills",
          action: "assertTextVisible",
          expectedText: "add up to 10 skills",
        },
        sourceUnitIds: ["jira-description"],
        sourceRefs: ["jira.description"],
      }],
      requiredManualCheckIds: [],
    },
  });
  assert.deepEqual(result?.steps, [{
    action: "assertTextVisible",
    text: "add up to 10 skills",
    oracleId: "source-member-skills",
  }]);
});
