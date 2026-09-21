import assert from "node:assert/strict";
import test from "node:test";

import {
  renderBrowserCoverageScope,
} from "./write-report.js";

test(
  "reports manual coverage separately from automated checks",
  () => {
    const summary =
      renderBrowserCoverageScope({
        automatedChecks: [
          "Verify Work Setups is visible.",
          "Verify Compliance Requirements is visible.",
        ],
        manualChecks: [
          "Complete the Work Setup and verify refreshed status.",
        ],
        acceptanceScope: {
          requiresBehaviorProof: false,
          behaviorClaims: [],
        },
      });

    assert.equal(
      summary,
      "Automated checks: 2; " +
        "Manual planned: 1; " +
        "Manual remaining: 1; " +
        "Behavior proof: none required"
    );
  }
);

test(
  "reports behavior-proof requirements without claiming satisfaction",
  () => {
    const summary =
      renderBrowserCoverageScope({
        automatedChecks: [
          'Verify "Newest" is visible.',
          'Verify "Oldest" is visible.',
        ],
        manualChecks: [
          "Verify backend ordering separately.",
        ],
        acceptanceScope: {
          requiresBehaviorProof: true,
          behaviorClaims: [
            "After an option is selected, the visible selected value is correct.",
          ],
        },
      });

    assert.equal(
      summary,
      "Automated checks: 2; " +
        "Manual planned: 1; " +
        "Manual remaining: 1; " +
        "Behavior proof: required " +
        "(1 claim; satisfaction not structurally evaluated)"
    );

    assert.equal(
      summary.includes("satisfied"),
      false
    );
  }
);

test(
  "reports unavailable behavior scope for legacy cases",
  () => {
    const summary =
      renderBrowserCoverageScope({
        automatedChecks: [
          'Verify "Compliance Document" is visible.',
        ],
        manualChecks: [],
      });

    assert.equal(
      summary,
      "Automated checks: 1; " +
        "Manual planned: 0; " +
        "Manual remaining: 0; " +
        "Behavior proof: scope unavailable"
    );
  }
);

const manualChecks = [
  "The visible filtered results match Alpha.",
  "Clearing the filter restores the collection.",
  "Pagination remains associated with the collection.",
  "The empty state is absent when matches exist.",
];

function reconciledResult(args: {
  status: "PASS" | "MANUAL_REQUIRED";
  coveredManualChecks: string[];
}) {
  return {
    id: "web-1",
    status: args.status,
    collectionFilterEvidence: [{
      kind: "COLLECTION_FILTER",
      status: "CONFIRMED",
      proofReady: true,
      coveredManualChecks:
        args.coveredManualChecks,
    }],
    reconciliationAudit: [{
      legacyAcceptanceCoverageGapDetected:
        args.coveredManualChecks.length <
        manualChecks.length,
    }],
  };
}

function renderManualCoverage(
  result?: ReturnType<
    typeof reconciledResult
  >
) {
  return renderBrowserCoverageScope(
    {
      automatedChecks: [],
      manualChecks,
    },
    result
  );
}

test(
  "reports four planned and four remaining without deterministic discharge",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "MANUAL_REQUIRED",
        coveredManualChecks: [],
      })
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 4/
    );
  }
);

test(
  "reports four planned and two remaining after exact partial discharge",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "MANUAL_REQUIRED",
        coveredManualChecks:
          manualChecks.slice(0, 2),
      })
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 2/
    );
  }
);

test(
  "reports four planned and zero remaining after complete exact discharge",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "PASS",
        coveredManualChecks: manualChecks,
      })
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 0/
    );
  }
);

test(
  "does not double-count duplicate covered checks",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "MANUAL_REQUIRED",
        coveredManualChecks: [
          manualChecks[0]!,
          manualChecks[0]!,
        ],
      })
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 3/
    );
  }
);

test(
  "does not discharge unrelated covered text",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "MANUAL_REQUIRED",
        coveredManualChecks: [
          "An unrelated observation.",
        ],
      })
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 4/
    );
  }
);

test(
  "uses exact discharge for MANUAL_REQUIRED results",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "MANUAL_REQUIRED",
        coveredManualChecks:
          manualChecks.slice(0, 2),
      })
    );

    assert.match(
      summary,
      /Manual remaining: 2/
    );
  }
);

test(
  "uses exact discharge for PASS results",
  () => {
    const summary = renderManualCoverage(
      reconciledResult({
        status: "PASS",
        coveredManualChecks: manualChecks,
      })
    );

    assert.match(
      summary,
      /Manual remaining: 0/
    );
  }
);

test(
  "keeps all planned checks remaining without reconciliation state",
  () => {
    const result = reconciledResult({
      status: "PASS",
      coveredManualChecks: manualChecks,
    });
    delete (result as {
      reconciliationAudit?: unknown;
    }).reconciliationAudit;

    const summary = renderManualCoverage(
      result
    );

    assert.match(
      summary,
      /Manual planned: 4; Manual remaining: 4/
    );
  }
);
