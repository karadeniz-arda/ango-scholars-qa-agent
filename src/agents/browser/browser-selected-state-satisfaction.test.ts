import assert from "node:assert/strict";
import test from "node:test";

import {
  isSelectedStateRequirementSatisfied,
} from "./browser-selected-state-satisfaction.js";

const requirement = {
  kind: "SELECTED_STATE" as const,
  sourceClaim:
    "The selected filter value is visible.",
  interactionId:
    "web-1:interaction-1",
  selectionOracleId:
    "web-1:assertion-1",
};

const interactionEvidence = {
  stepIndex: 1,
  interactionId:
    "web-1:interaction-1",
  action:
    "selectRuntimeFilterOption" as const,
  succeeded: true as const,
  note: "selected Active",
};

const oracleEvidence = {
  stepIndex: 1,
  oracleId:
    "web-1:assertion-1",
  action:
    "selectRuntimeFilterOption" as const,
  verificationMode:
    "visible-state" as const,
  targetSelectedLabel: "Active",
  observedSelectedLabel: "Active",
  expected:
    "Select Active and observe Active",
  passed: true,
  note: "exact selected label observed",
};

test(
  "satisfies SELECTED_STATE from exact interaction and exact passing oracle IDs",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [
          oracleEvidence,
        ],
      }),
      true
    );
  }
);

test(
  "does not satisfy SELECTED_STATE without interaction evidence",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [],
        deterministicEvidence: [
          oracleEvidence,
        ],
      }),
      false
    );
  }
);

test(
  "does not satisfy SELECTED_STATE without oracle evidence",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [],
      }),
      false
    );
  }
);

test(
  "does not satisfy SELECTED_STATE from a failed exact oracle",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [
          {
            ...oracleEvidence,
            passed: false,
          },
        ],
      }),
      false
    );
  }
);

test(
  "does not satisfy SELECTED_STATE from an unrelated passing oracle ID",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [
          {
            ...oracleEvidence,
            oracleId:
              "web-1:assertion-2",
          },
        ],
      }),
      false
    );
  }
);

test(
  "does not satisfy SELECTED_STATE from an unrelated interaction ID",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          {
            ...interactionEvidence,
            interactionId:
              "web-1:interaction-2",
          },
        ],
        deterministicEvidence: [
          oracleEvidence,
        ],
      }),
      false
    );
  }
);

test(
  "does not substitute URL-mode runtime filter evidence for selected-state proof",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [
          {
            ...oracleEvidence,
            verificationMode:
              "url",
          },
        ],
      }),
      false
    );
  }
);

test(
  "does not substitute a text assertion with the same oracle ID",
  () => {
    assert.equal(
      isSelectedStateRequirementSatisfied({
        requirement,
        interactionExecutionEvidence: [
          interactionEvidence,
        ],
        deterministicEvidence: [
          {
            ...oracleEvidence,
            action:
              "assertTextVisible",
          },
        ],
      }),
      false
    );
  }
);
