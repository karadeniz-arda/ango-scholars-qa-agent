import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSuccessfulInteractionEvidence,
} from "./browser-interaction-execution-evidence.js";

test(
  "builds stable execution evidence for a successful clickText interaction",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 2,
        step: {
          action: "clickText",
          text: "Details",
          interactionId:
            "web-1:interaction-1",
        },
        note: 'clicked text "Details"',
      });

    assert.deepEqual(
      evidence,
      {
        stepIndex: 2,
        interactionId:
          "web-1:interaction-1",
        action: "clickText",
        succeeded: true,
        note: 'clicked text "Details"',
      }
    );
  }
);

test(
  "builds stable execution evidence for a successful clickButton interaction",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 3,
        step: {
          action: "clickButton",
          text: "Continue",
          interactionId:
            "web-1:interaction-2",
        },
        note: 'clicked button "Continue"',
      });

    assert.equal(
      evidence?.interactionId,
      "web-1:interaction-2"
    );

    assert.equal(
      evidence?.succeeded,
      true
    );
  }
);

test(
  "does not manufacture interaction proof without a stable interactionId",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 2,
        step: {
          action: "clickText",
          text: "Details",
        },
        note: 'clicked text "Details"',
      });

    assert.equal(
      evidence,
      undefined
    );
  }
);

test(
  "builds execution evidence for a successful visible-state runtime filter selection",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 4,
        step: {
          action:
            "selectRuntimeFilterOption",
          filterKey: "status",
          verification:
            "visible-state",
          interactionId:
            "web-1:interaction-3",
          oracleId:
            "web-1:assertion-2",
        },
        note:
          'selected runtime filter option "Active"',
      });

    assert.deepEqual(evidence, {
      stepIndex: 4,
      interactionId:
        "web-1:interaction-3",
      action:
        "selectRuntimeFilterOption",
      succeeded: true,
      note:
        'selected runtime filter option "Active"',
    });
  }
);

test(
  "does not emit interaction evidence for URL-mode runtime filter selection",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 4,
        step: {
          action:
            "selectRuntimeFilterOption",
          queryKey: "status",
          verification: "url",
        },
        note:
          'selected runtime filter option "Active"',
      });

    assert.equal(evidence, undefined);
  }
);

test(
  "does not treat an assertion as interaction execution evidence",
  () => {
    const evidence =
      buildSuccessfulInteractionEvidence({
        stepIndex: 3,
        step: {
          action: "assertUrlContains",
          text: "/details",
          oracleId:
            "web-1:assertion-1",
        },
        note:
          'assert URL contains "/details": PASS',
      });

    assert.equal(
      evidence,
      undefined
    );
  }
);
