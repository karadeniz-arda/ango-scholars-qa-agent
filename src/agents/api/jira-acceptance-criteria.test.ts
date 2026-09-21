import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAcceptanceCriteriaSources,
  findAcceptanceCriteriaFields,
  jiraFieldValueToText,
} from "./jira-acceptance-criteria.js";

test(
  "discovers acceptance criteria fields by normalized semantic name",
  () => {
    const fields = [
      {
        id: "customfield_a",
        name: "Acceptance Criteria ",
      },
      {
        id: "customfield_b",
        name: "acceptance criterion",
      },
      {
        id: "customfield_c",
        name: "Acceptance Criteria Status",
      },
      {
        id: "summary",
        name: "Summary",
      },
    ];

    assert.deepEqual(
      findAcceptanceCriteriaFields(
        fields
      ).map((field) => field.id),
      [
        "customfield_a",
        "customfield_b",
      ]
    );
  }
);

test(
  "preserves every populated acceptance source with provenance",
  () => {
    const result =
      collectAcceptanceCriteriaSources(
        [
          {
            id: "customfield_a",
            name: "Acceptance Criteria",
          },
          {
            id: "customfield_b",
            name: "Acceptance Criteria ",
          },
        ],
        {
          customfield_a:
            "First requirement",
          customfield_b: [
            {
              value:
                "Second requirement",
            },
          ],
        }
      );

    assert.deepEqual(
      result,
      {
        candidateFieldCount: 2,
        sources: [
          {
            fieldId:
              "customfield_a",
            fieldName:
              "Acceptance Criteria",
            text:
              "First requirement",
          },
          {
            fieldId:
              "customfield_b",
            fieldName:
              "Acceptance Criteria",
            text:
              "Second requirement",
          },
        ],
      }
    );
  }
);

test(
  "ignores empty matching fields without treating them as populated sources",
  () => {
    const result =
      collectAcceptanceCriteriaSources(
        [
          {
            id: "customfield_a",
            name: "Acceptance Criteria",
          },
          {
            id: "customfield_b",
            name: "Acceptance Criteria",
          },
        ],
        {
          customfield_a: null,
          customfield_b: [],
        }
      );

    assert.equal(
      result.candidateFieldCount,
      2
    );
    assert.deepEqual(
      result.sources,
      []
    );
  }
);

test(
  "normalizes ADF and option-shaped Jira values without exposing structural metadata",
  () => {
    assert.equal(
      jiraFieldValueToText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text:
                  "Visible acceptance text",
              },
            ],
          },
        ],
      }),
      "Visible acceptance text"
    );

    assert.equal(
      jiraFieldValueToText({
        id: "10001",
        value:
          "Checkbox acceptance text",
      }),
      "Checkbox acceptance text"
    );
  }
);
