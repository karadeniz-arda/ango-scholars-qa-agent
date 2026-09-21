import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerAcceptanceSourceLedger,
  buildPlannerJiraSourceUnits,
} from "./planner-acceptance-source-ledger.js";

test(
  "route-context source units retain summary, structured description, and acceptance criteria",
  () => {
    const units =
      buildPlannerJiraSourceUnits({
        summary:
          "Navigate to /company/current.",
        descriptionText: "",
        descriptionAdf: {
          type: "doc",
          content: [
            {
              type: "heading",
              content: [
                {
                  type: "text",
                  text: "Legacy behavior",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    "Do not use /company/old.",
                },
              ],
            },
          ],
        },
        acceptanceCriteriaDiscovery: {
          status: "RESOLVED",
          candidateFieldCount: 1,
          sources: [
            {
              fieldId:
                "customfield_runtime",
              fieldName:
                "Acceptance Criteria",
              text:
                "The page remains available.",
            },
          ],
        },
      });

    assert.deepEqual(
      units.map((unit) => ({
        sourceKind: unit.sourceKind,
        text: unit.text,
        sectionHeading:
          unit.sectionHeading,
      })),
      [
        {
          sourceKind: "SUMMARY",
          text:
            "Navigate to /company/current.",
          sectionHeading: undefined,
        },
        {
          sourceKind: "DESCRIPTION",
          text:
            "Do not use /company/old.",
          sectionHeading:
            "Legacy behavior",
        },
        {
          sourceKind:
            "ACCEPTANCE_CRITERIA",
          text:
            "The page remains available.",
          sectionHeading: undefined,
        },
      ]
    );
  }
);

test(
  "populated Jira acceptance criteria remain authoritative over fallback text",
  () => {
    const ledger =
      buildPlannerAcceptanceSourceLedger({
        summary:
          "Summary should not become the acceptance source.",
        descriptionText:
          "Description should not become the acceptance source.",
        acceptanceCriteriaDiscovery: {
          status: "RESOLVED",
          candidateFieldCount: 1,
          sources: [
            {
              fieldId:
                "customfield_runtime",
              fieldName:
                "Acceptance Criteria",
              text:
                "First required behavior. Second required behavior.",
            },
          ],
        },
      });

    assert.equal(
      ledger.sourceStatus,
      "RESOLVED"
    );
    assert.equal(
      ledger.basis,
      "ACCEPTANCE_CRITERIA"
    );

    assert.deepEqual(
      ledger.sourceUnits.map(
        (unit) => ({
          sourceKind:
            unit.sourceKind,
          sourceRef:
            unit.sourceRef,
          text:
            unit.text,
        })
      ),
      [
        {
          sourceKind:
            "ACCEPTANCE_CRITERIA",
          sourceRef:
            "jira.field:customfield_runtime",
          text:
            "First required behavior.",
        },
        {
          sourceKind:
            "ACCEPTANCE_CRITERIA",
          sourceRef:
            "jira.field:customfield_runtime",
          text:
            "Second required behavior.",
        },
      ]
    );
  }
);

test(
  "confirmed-empty acceptance criteria use Jira summary and description fallback",
  () => {
    const ledger =
      buildPlannerAcceptanceSourceLedger({
        summary:
          "Update the visible control behavior",
        descriptionText:
          "The first state remains supported. The second state remains supported.",
        acceptanceCriteriaDiscovery: {
          status: "RESOLVED",
          candidateFieldCount: 2,
          sources: [],
        },
      });

    assert.equal(
      ledger.basis,
      "SUMMARY_DESCRIPTION_FALLBACK"
    );

    assert.deepEqual(
      ledger.sourceUnits.map(
        (unit) =>
          unit.sourceKind
      ),
      [
        "SUMMARY",
        "DESCRIPTION",
        "DESCRIPTION",
      ]
    );
  }
);

test(
  "preserves explicit Jira description heading provenance without emitting headings as source units",
  () => {
    const ledger =
      buildPlannerAcceptanceSourceLedger({
        summary:
          "Structured description",
        descriptionText:
          "Acceptance Criteria\nFirst behavior.\nSecond behavior.\nTechnical Notes\nSupporting note.",
        descriptionAdf: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: {
                level: 2,
              },
              content: [
                {
                  type: "text",
                  text:
                    "Acceptance Criteria",
                },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text:
                            "First behavior.",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text:
                            "Second behavior.",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "heading",
              attrs: {
                level: 2,
              },
              content: [
                {
                  type: "text",
                  text:
                    "Technical Notes",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    "Supporting note.",
                },
              ],
            },
          ],
        },
        acceptanceCriteriaDiscovery: {
          status: "RESOLVED",
          candidateFieldCount: 0,
          sources: [],
        },
      });

    const descriptionUnits =
      ledger.sourceUnits.filter(
        (unit) =>
          unit.sourceKind ===
          "DESCRIPTION"
      );

    assert.deepEqual(
      descriptionUnits.map(
        (unit) => ({
          text:
            unit.text,
          sectionHeading:
            unit.sectionHeading,
        })
      ),
      [
        {
          text:
            "First behavior.",
          sectionHeading:
            "Acceptance Criteria",
        },
        {
          text:
            "Second behavior.",
          sectionHeading:
            "Acceptance Criteria",
        },
        {
          text:
            "Supporting note.",
          sectionHeading:
            "Technical Notes",
        },
      ]
    );

    assert.equal(
      descriptionUnits.some(
        (unit) =>
          unit.text ===
          "Acceptance Criteria" ||
          unit.text ===
          "Technical Notes"
      ),
      false
    );
  }
);

test(
  "identical description text under different Jira headings receives distinct provenance IDs",
  () => {
    const ledger =
      buildPlannerAcceptanceSourceLedger({
        summary:
          "Structured description",
        descriptionText:
          "Expected Behavior\nShared text.\nActual Behavior\nShared text.",
        descriptionAdf: {
          type: "doc",
          content: [
            {
              type: "heading",
              content: [
                {
                  type: "text",
                  text:
                    "Expected Behavior",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    "Shared text.",
                },
              ],
            },
            {
              type: "heading",
              content: [
                {
                  type: "text",
                  text:
                    "Actual Behavior",
                },
              ],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text:
                    "Shared text.",
                },
              ],
            },
          ],
        },
        acceptanceCriteriaDiscovery: {
          status: "RESOLVED",
          candidateFieldCount: 0,
          sources: [],
        },
      });

    const sharedUnits =
      ledger.sourceUnits.filter(
        (unit) =>
          unit.text ===
          "Shared text."
      );

    assert.equal(
      sharedUnits.length,
      2
    );

    assert.notEqual(
      sharedUnits[0]?.id,
      sharedUnits[1]?.id
    );

    assert.deepEqual(
      sharedUnits.map(
        (unit) =>
          unit.sectionHeading
      ),
      [
        "Expected Behavior",
        "Actual Behavior",
      ]
    );
  }
);

test(
  "unavailable acceptance source is not treated as confirmed-empty fallback",
  () => {
    const ledger =
      buildPlannerAcceptanceSourceLedger({
        summary:
          "A plausible summary",
        descriptionText:
          "A plausible description",
        acceptanceCriteriaDiscovery: {
          status: "UNAVAILABLE",
          candidateFieldCount: 0,
          sources: [],
        },
      });

    assert.deepEqual(
      ledger,
      {
        sourceStatus:
          "UNAVAILABLE",
        basis:
          "SOURCE_UNAVAILABLE",
        sourceUnits: [],
      }
    );
  }
);

test(
  "source unit IDs are stable for identical provenance and text",
  () => {
    const args = {
      summary:
        "Stable summary behavior",
      descriptionText: "",
      acceptanceCriteriaDiscovery: {
        status:
          "RESOLVED" as const,
        candidateFieldCount: 0,
        sources: [],
      },
    };

    const first =
      buildPlannerAcceptanceSourceLedger(
        args
      );

    const second =
      buildPlannerAcceptanceSourceLedger(
        args
      );

    assert.equal(
      first.sourceUnits[0]?.id,
      second.sourceUnits[0]?.id
    );

    assert.match(
      first.sourceUnits[0]?.id ?? "",
      /^jira-req-[0-9a-f]{12}$/
    );
  }
);

test(
  "structured ADF list items preserve abbreviation punctuation as one source unit",
  () => {
    const ledger = buildPlannerAcceptanceSourceLedger({
      summary: "Structured criteria",
      descriptionText: "",
      descriptionAdf: {
        type: "doc",
        content: [
          {
            type: "heading",
            content: [{ type: "text", text: "Acceptance Criteria" }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{
                  type: "paragraph",
                  content: [{
                    type: "text",
                    text: "An explicit stored value (e.g. -10) still overrides the default. It remains authoritative.",
                  }],
                }],
              },
              {
                type: "listItem",
                content: [{
                  type: "paragraph",
                  content: [{
                    type: "text",
                    text: "A second item (i.e. a separate ADF boundary) remains separate.",
                  }],
                }],
              },
            ],
          },
        ],
      },
      acceptanceCriteriaDiscovery: {
        status: "RESOLVED",
        candidateFieldCount: 0,
        sources: [],
      },
    });

    const descriptionUnits = ledger.sourceUnits.filter(
      (unit) => unit.sourceKind === "DESCRIPTION"
    );

    assert.deepEqual(
      descriptionUnits.map((unit) => unit.text),
      [
        "An explicit stored value (e.g. -10) still overrides the default. It remains authoritative.",
        "A second item (i.e. a separate ADF boundary) remains separate.",
      ]
    );
    assert.deepEqual(
      descriptionUnits.map((unit) => unit.sectionHeading),
      ["Acceptance Criteria", "Acceptance Criteria"]
    );
  }
);

test(
  "structured headings remain boundaries and never merge into ordinary punctuated body text",
  () => {
    const ledger = buildPlannerAcceptanceSourceLedger({
      summary: "Structured criteria",
      descriptionText: "",
      descriptionAdf: {
        type: "doc",
        content: [
          {
            type: "heading",
            content: [{ type: "text", text: "Expected Behavior" }],
          },
          {
            type: "paragraph",
            content: [{
              type: "text",
              text: "First sentence. Second sentence? Third sentence!",
            }],
          },
          {
            type: "heading",
            content: [{ type: "text", text: "Actual Behavior" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "A separate body." }],
          },
        ],
      },
      acceptanceCriteriaDiscovery: {
        status: "RESOLVED",
        candidateFieldCount: 0,
        sources: [],
      },
    });

    assert.deepEqual(
      ledger.sourceUnits.filter((unit) => unit.sourceKind === "DESCRIPTION")
        .map((unit) => [unit.sectionHeading, unit.text]),
      [
        ["Expected Behavior", "First sentence. Second sentence? Third sentence!"],
        ["Actual Behavior", "A separate body."],
      ]
    );
  }
);

test(
  "heading-only structured ADF does not fall back to flattened heading text",
  () => {
    const ledger = buildPlannerAcceptanceSourceLedger({
      summary: "Fix pagination",
      descriptionText:
        "Context\nTask\nAction\nResults / Acceptance Criteria\n",
      descriptionAdf: {
        type: "doc",
        content: [
          "Context",
          "Task",
          "Action",
          "Results / Acceptance Criteria",
        ].map((text) => ({
          type: "heading",
          content: [{ type: "text", text }],
        })),
      },
      acceptanceCriteriaDiscovery: {
        status: "RESOLVED",
        candidateFieldCount: 2,
        sources: [],
      },
    });

    assert.deepEqual(
      ledger.sourceUnits.map((unit) => unit.sourceKind),
      ["SUMMARY"]
    );
  }
);
