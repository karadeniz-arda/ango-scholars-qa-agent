import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerAcceptanceObligationLedger,
  classifyPlannerDescriptionSection,
} from "./planner-acceptance-obligation-ledger.js";
import {
  classifyPlannerBrowserObligationSemanticFamily,
} from "./planner-browser-obligation-semantics.js";
import type {
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
} from "./planner-acceptance-source-ledger.js";

function sourceUnit(
  overrides:
    Partial<PlannerAcceptanceSourceUnit> = {}
): PlannerAcceptanceSourceUnit {
  return {
    id: "jira-req-default",
    sourceKind: "DESCRIPTION",
    sourceRef: "jira.description",
    text: "Behavior A",
    ...overrides,
  };
}

function resolvedLedger(
  sourceUnits:
    PlannerAcceptanceSourceUnit[],
  basis:
    PlannerAcceptanceSourceLedger[
      "basis"
    ] =
      "SUMMARY_DESCRIPTION_FALLBACK"
): PlannerAcceptanceSourceLedger {
  return {
    sourceStatus: "RESOLVED",
    basis,
    sourceUnits,
  };
}

test(
  "direct Jira acceptance criteria become provenance-linked obligations",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger(
          [
            sourceUnit({
              id: "jira-req-ac",
              sourceKind:
                "ACCEPTANCE_CRITERIA",
              sourceRef:
                "jira.field:runtime",
            }),
          ],
          "ACCEPTANCE_CRITERIA"
        )
      );

    assert.equal(
      ledger.derivationStatus,
      "RESOLVED"
    );
    assert.deepEqual(
      ledger.obligations.map(
        (obligation) => ({
          sourceUnitIds:
            obligation.sourceUnitIds,
          sourceRole:
            obligation.sourceRole,
          derivation:
            obligation.derivation,
          text:
            obligation.text,
        })
      ),
      [
        {
          sourceUnitIds: [
            "jira-req-ac",
          ],
          sourceRole: "ACCEPTANCE",
          derivation:
            "DIRECT_ACCEPTANCE_FIELD",
          text: "Behavior A",
        },
      ]
    );
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      []
    );
  }
);

test(
  "Acceptance Criteria content is included while Technical Notes content remains unresolved",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            id: "jira-req-behavior",
            sectionHeading:
              "Acceptance Criteria",
          }),
          sourceUnit({
            id: "jira-req-note",
            sectionHeading:
              "Technical Notes",
            text: "Implementation note",
          }),
        ])
      );

    assert.deepEqual(
      ledger.obligations.map(
        (obligation) =>
          obligation.text
      ),
      ["Behavior A"]
    );
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      ["jira-req-note"]
    );
  }
);

test(
  "Expected Behavior content becomes an obligation",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            sectionHeading:
              "Expected Behavior",
          }),
        ])
      );

    assert.equal(
      ledger.obligations[0]
        ?.sourceRole,
      "EXPECTED_BEHAVIOR"
    );
    assert.equal(
      ledger.obligations[0]
        ?.derivation,
      "DIRECT_DESCRIPTION_SECTION"
    );
  }
);

test(
  "non-acceptance Jira sections do not become V0 obligations",
  () => {
    const headings = [
      "Actual Behavior",
      "Context",
      "Environment",
      "Steps to Reproduce",
      "Requirements",
      "Custom Product Notes",
    ];
    const units =
      headings.map(
        (sectionHeading, index) =>
          sourceUnit({
            id: `jira-req-${index}`,
            sectionHeading,
          })
      );

    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger(units)
      );

    assert.deepEqual(
      ledger.obligations,
      []
    );
    assert.equal(
      ledger.derivationStatus,
      "NO_HIGH_CONFIDENCE_OBLIGATIONS"
    );
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      units.map((unit) => unit.id)
    );
  }
);

test(
  "heading normalization accepts only exact supported headings",
  () => {
    assert.equal(
      classifyPlannerDescriptionSection(
        " Acceptance Criteria: "
      ),
      "ACCEPTANCE"
    );
    assert.equal(
      classifyPlannerDescriptionSection(
        "EXPECTED   BEHAVIOR"
      ),
      "EXPECTED_BEHAVIOR"
    );
    assert.equal(
      classifyPlannerDescriptionSection(
        "Expected results."
      ),
      "EXPECTED_BEHAVIOR"
    );
    assert.equal(
      classifyPlannerDescriptionSection(
        "Acceptance Criteria deployment notes"
      ),
      "UNCLASSIFIED"
    );
  }
);

test(
  "source unavailable remains distinct from known source without obligations",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger({
        sourceStatus: "UNAVAILABLE",
        basis: "SOURCE_UNAVAILABLE",
        sourceUnits: [],
      });

    assert.deepEqual(
      ledger,
      {
        sourceStatus: "UNAVAILABLE",
        derivationStatus:
          "SOURCE_UNAVAILABLE",
        obligations: [],
        unresolvedSourceUnitIds: [],
      }
    );
  }
);

test(
  "obligation IDs remain stable for the same immutable provenance",
  () => {
    const sourceLedger =
      resolvedLedger([
        sourceUnit({
          id: "jira-req-stable",
          sectionHeading:
            "Expected Behavior",
        }),
      ]);

    const first =
      buildPlannerAcceptanceObligationLedger(
        sourceLedger
      );
    const second =
      buildPlannerAcceptanceObligationLedger(
        sourceLedger
      );

    assert.equal(
      first.obligations[0]?.id,
      second.obligations[0]?.id
    );
  }
);

test(
  "the same text under Expected and Actual Behavior derives only the expected obligation",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            id: "jira-req-expected",
            sectionHeading:
              "Expected Behavior",
            text: "Shared text",
          }),
          sourceUnit({
            id: "jira-req-actual",
            sectionHeading:
              "Actual Behavior",
            text: "Shared text",
          }),
        ])
      );

    assert.deepEqual(
      ledger.obligations[0]
        ?.sourceUnitIds,
      ["jira-req-expected"]
    );
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      ["jira-req-actual"]
    );
  }
);

test(
  "identical text from distinct valid source units preserves distinct provenance IDs",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            id: "jira-req-one",
            sectionHeading:
              "Expected Behavior",
            text: "Shared text",
          }),
          sourceUnit({
            id: "jira-req-two",
            sectionHeading:
              "Expected Behavior",
            text: "Shared text",
          }),
        ])
      );

    assert.equal(
      ledger.obligations.length,
      2
    );
    assert.notEqual(
      ledger.obligations[0]?.id,
      ledger.obligations[1]?.id
    );
  }
);

test(
  "duplicate source provenance does not silently create duplicate obligations",
  () => {
    const unit = sourceUnit({
      id: "jira-req-duplicate",
      sectionHeading:
        "Acceptance Criteria",
    });
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([unit, unit])
      );

    assert.equal(
      ledger.obligations.length,
      1
    );
  }
);

test(
  "summary source remains scope evidence rather than an atomic V0 obligation",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            sourceKind: "SUMMARY",
            sourceRef: "jira.summary",
            text: "Ticket summary",
          }),
        ])
      );

    assert.equal(
      ledger.obligations.length,
      0
    );
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      ["jira-req-default"]
    );
  }
);

test(
  "heading words in source text do not become an obligation without structural heading provenance",
  () => {
    const ledger =
      buildPlannerAcceptanceObligationLedger(
        resolvedLedger([
          sourceUnit({
            text:
              "Acceptance Criteria",
          }),
        ])
      );

    assert.equal(
      ledger.obligations.length,
      0
    );
  }
);

test(
  "bounded explicit Task behavior becomes a provenance-linked obligation",
  () => {
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger([
        sourceUnit({
          id: "jira-req-task-search",
          sectionHeading: "Task",
          text: "Add a search bar to the relevant collection page.",
        }),
        sourceUnit({
          id: "jira-req-task-snapshot",
          sectionHeading: "Task",
          text: "Save a snapshot of the records when a resource is created.",
        }),
      ])
    );

    assert.deepEqual(
      ledger.obligations.map((obligation) => ({
        sourceRole: obligation.sourceRole,
        derivation: obligation.derivation,
        sourceUnitIds: obligation.sourceUnitIds,
      })),
      [
        {
          sourceRole: "TASK",
          derivation: "DIRECT_TASK_SECTION",
          sourceUnitIds: ["jira-req-task-search"],
        },
        {
          sourceRole: "TASK",
          derivation: "DIRECT_TASK_SECTION",
          sourceUnitIds: ["jira-req-task-snapshot"],
        },
      ]
    );
  }
);

test(
  "Task eligibility requires bounded expected behavior rather than an imperative alone",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-vague-task",
        sectionHeading: "Task",
        text: "Add the required changes.",
      }),
      sourceUnit({
        id: "jira-req-incomplete-task",
        sectionHeading: "Task",
        text: "This will be possible after .",
      }),
      sourceUnit({
        id: "jira-req-context-shaped",
        sectionHeading: "Context",
        text: "Add a search bar to the relevant collection page.",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(ledger.obligations, []);
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      units.map((unit) => unit.id)
    );
  }
);

test(
  "explicit Task requirements survive independently of OTHER automation semantics",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-drawer",
        sectionHeading: "Task",
        text: "The details drawer displays Invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-warning",
        sectionHeading: "Task",
        text: "When inviting an external person from another country, display a warning explaining the mismatch.",
      }),
      sourceUnit({
        id: "jira-req-filter",
        sectionHeading: "Task",
        text: "The Type filter lets the user distinguish Publish and Update requests.",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(
      ledger.obligations.map((obligation) => ({
        text: obligation.text,
        sourceRole: obligation.sourceRole,
        semanticFamily:
          classifyPlannerBrowserObligationSemanticFamily(
            obligation.text
          ),
      })),
      units.map((unit) => ({
        text: unit.text,
        sourceRole: "TASK",
        semanticFamily: "OTHER",
      }))
    );
    assert.deepEqual(ledger.unresolvedSourceUnitIds, []);
  }
);

test(
  "Task authority guards reject actual-state, speculative, broad, fragmentary, and implementation prose",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-current",
        sectionHeading: "Task",
        text: "Currently the drawer is missing Invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-reported",
        sectionHeading: "Task",
        text: "Users have reported problems with invoice details.",
      }),
      sourceUnit({
        id: "jira-req-speculative",
        sectionHeading: "Task",
        text: "It may be useful to display the invoice number.",
      }),
      sourceUnit({
        id: "jira-req-broad",
        sectionHeading: "Task",
        text: "Update the Work Setup experience.",
      }),
      sourceUnit({
        id: "jira-req-implementation",
        sectionHeading: "Task",
        text: "Use the same endpoint for applying the request; no API changes.",
      }),
      sourceUnit({
        id: "jira-req-fragment",
        sectionHeading: "Task",
        text: "Invoice number",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(ledger.obligations, []);
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      units.map((unit) => unit.id)
    );
  }
);

test(
  "expected-state wording cannot promote context, actual behavior, or feature headings",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-context",
        sectionHeading: "Context",
        text: "The details drawer displays Invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-actual",
        sectionHeading: "Actual Behavior",
        text: "The details drawer displays the wrong invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-feature",
        sectionHeading: "Invoice Details Drawer",
        text: "The details drawer displays Invoice ID.",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(ledger.obligations, []);
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      units.map((unit) => unit.id)
    );
  }
);

test(
  "strong normative requirements survive domain-specific and unheaded description sections",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-domain-heading",
        sectionHeading: "Contract Details",
        text: "The detail card should show only summary information.",
      }),
      sourceUnit({
        id: "jira-req-issue-heading",
        sectionHeading: "Issue",
        text: "The action should instead say Move to Review.",
      }),
      sourceUnit({
        id: "jira-req-unheaded",
        text: "The description must be rendered as markdown and links must appear as links:",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(
      ledger.obligations.map((item) => ({
        sourceUnitIds: item.sourceUnitIds,
        sourceRole: item.sourceRole,
        derivation: item.derivation,
      })),
      units.map((item) => ({
        sourceUnitIds: [item.id],
        sourceRole: "TASK",
        derivation: "DIRECT_TASK_SECTION",
      }))
    );
  }
);

test(
  "unclassified description authority still rejects weak, declarative, contextual, and actual prose",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-declarative-feature",
        sectionHeading: "Invoice Details Drawer",
        text: "The details drawer displays Invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-vague-issue",
        sectionHeading: "Issue",
        text: "There is a problem with the button behavior.",
      }),
      sourceUnit({
        id: "jira-req-incomplete-addition",
        sectionHeading: "Issue",
        text: "Add a button:",
      }),
      sourceUnit({
        id: "jira-req-context-normative",
        sectionHeading: "Context",
        text: "The details drawer should display Invoice ID.",
      }),
      sourceUnit({
        id: "jira-req-actual-normative",
        sectionHeading: "Actual Behavior",
        text: "The details drawer should display the wrong Invoice ID.",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(ledger.obligations, []);
    assert.deepEqual(
      ledger.unresolvedSourceUnitIds,
      units.map((item) => item.id)
    );
  }
);

test(
  "bounded Task wording supports mention and retains a valid clause before an incomplete tail",
  () => {
    const units = [
      sourceUnit({
        id: "jira-req-mention",
        sectionHeading: "Task",
        text: "Update the helper description to mention that users can add up to ten items.",
      }),
      sourceUnit({
        id: "jira-req-valid-before-tail",
        sectionHeading: "Task",
        text: "We should instead use the configuration from the contract. This will be possible after .",
      }),
      sourceUnit({
        id: "jira-req-tail-only",
        sectionHeading: "Task",
        text: "This will be possible after .",
      }),
    ];
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger(units)
    );

    assert.deepEqual(
      ledger.obligations.map((item) => item.sourceUnitIds[0]),
      ["jira-req-mention", "jira-req-valid-before-tail"]
    );
    assert.ok(ledger.unresolvedSourceUnitIds.includes("jira-req-tail-only"));
  }
);

test(
  "declarative Task requirements do not require modal keywords",
  () => {
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger([
        sourceUnit({
          id: "jira-req-declarative",
          sectionHeading: "Task",
          text: "The drawer displays the invoice number.",
        }),
      ])
    );

    assert.equal(ledger.obligations.length, 1);
    assert.equal(
      ledger.obligations[0]?.sourceRole,
      "TASK"
    );
  }
);

test(
  "source-derived OTHER obligations preserve stable authority through JSON serialization",
  () => {
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger([
        sourceUnit({
          id: "jira-req-serialized",
          sectionHeading: "Task",
          text: "The details drawer displays Invoice ID.",
        }),
      ])
    );
    const reloaded = JSON.parse(JSON.stringify(ledger));

    assert.deepEqual(reloaded, ledger);
    assert.equal(reloaded.obligations.length, 1);
    assert.equal(
      classifyPlannerBrowserObligationSemanticFamily(
        reloaded.obligations[0]?.text
      ),
      "OTHER"
    );
  }
);

test(
  "an empty or heading-only Results Acceptance Criteria section produces no obligation",
  () => {
    assert.equal(
      classifyPlannerDescriptionSection("Results / Acceptance Criteria"),
      "UNCLASSIFIED"
    );
    const ledger = buildPlannerAcceptanceObligationLedger(
      resolvedLedger([])
    );
    assert.equal(ledger.obligations.length, 0);
  }
);
