import assert from "node:assert/strict";
import test from "node:test";

import {
  auditPlannerAcceptanceCoverage,
} from "./planner-acceptance-coverage-audit.js";

const ledger = {
  sourceStatus:
    "RESOLVED" as const,
  basis:
    "ACCEPTANCE_CRITERIA" as const,
  sourceUnits: [
    {
      id: "jira-req-a",
      sourceKind:
        "ACCEPTANCE_CRITERIA" as const,
      sourceRef:
        "jira.field:runtime",
      text:
        "The selected status remains visible after reload.",
    },
  ],
};

test(
  "exact authoritative requirement text is represented",
  () => {
    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              successCriteria:
                "The selected status remains visible after reload.",
            },
          ],
        },
        ledger
      );

    assert.deepEqual(
      audit,
      {
        status: "COMPLETE",
        sourceUnitCount: 1,
        representedUnitCount: 1,
        unresolvedUnitCount: 0,
        units: [
          {
            sourceUnitId:
              "jira-req-a",
            status:
              "REPRESENTED",
            matchedCaseIds:
              ["web-1"],
          },
        ],
      }
    );
  }
);

test(
  "manual acceptance coverage counts as plan representation",
  () => {
    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              manualChecks: [
                "The selected status remains visible after reload.",
              ],
            },
          ],
        },
        ledger
      );

    assert.equal(
      audit.status,
      "COMPLETE"
    );
  }
);

test(
  "exact source unit inside a multi-sentence plan field is represented",
  () => {
    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              successCriteria:
                "The control is available. " +
                "The selected status remains visible after reload. " +
                "The page remains usable.",
            },
          ],
        },
        ledger
      );

    assert.equal(
      audit.status,
      "COMPLETE"
    );

    assert.deepEqual(
      audit.units[0]?.matchedCaseIds,
      ["web-1"]
    );
  }
);

test(
  "surrounding polarity change cannot represent an exact positive source unit",
  () => {
    const positiveLedger = {
      sourceStatus:
        "RESOLVED" as const,
      basis:
        "ACCEPTANCE_CRITERIA" as const,
      sourceUnits: [
        {
          id:
            "jira-req-positive",
          sourceKind:
            "ACCEPTANCE_CRITERIA" as const,
          sourceRef:
            "jira.field:runtime",
          text:
            "Global work setups are displayed.",
        },
      ],
    };

    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              successCriteria:
                "It is not true that Global work setups are displayed.",
            },
          ],
        },
        positiveLedger
      );

    assert.equal(
      audit.status,
      "INCOMPLETE"
    );

    assert.equal(
      audit.units[0]?.status,
      "UNRESOLVED"
    );
  }
);

test(
  "paraphrase alone remains unresolved instead of claiming semantic coverage",
  () => {
    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              successCriteria:
                "Reloading preserves the chosen status.",
            },
          ],
        },
        ledger
      );

    assert.equal(
      audit.status,
      "INCOMPLETE"
    );

    assert.equal(
      audit.units[0]?.status,
      "UNRESOLVED"
    );
  }
);

test(
  "similar words with changed polarity do not create representation",
  () => {
    const negativeLedger = {
      sourceStatus:
        "RESOLVED" as const,
      basis:
        "ACCEPTANCE_CRITERIA" as const,
      sourceUnits: [
        {
          id: "jira-req-negative",
          sourceKind:
            "ACCEPTANCE_CRITERIA" as const,
          sourceRef:
            "jira.field:runtime",
          text:
            "Global work setups must not be displayed.",
        },
      ],
    };

    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [
            {
              id: "web-1",
              successCriteria:
                "Global work setups are displayed.",
            },
          ],
        },
        negativeLedger
      );

    assert.equal(
      audit.status,
      "INCOMPLETE"
    );
  }
);

test(
  "unavailable source remains source unavailable rather than complete",
  () => {
    const audit =
      auditPlannerAcceptanceCoverage(
        {
          apiCases: [],
          browserCases: [],
        },
        {
          sourceStatus:
            "UNAVAILABLE",
          basis:
            "SOURCE_UNAVAILABLE",
          sourceUnits: [],
        }
      );

    assert.equal(
      audit.status,
      "SOURCE_UNAVAILABLE"
    );
  }
);
