import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import {
  finalizeBrowserStepResult,
} from "./browser-step-result-policy.js";

function assertionEvidence(
  overrides:
    Partial<BrowserDeterministicEvidence> = {}
): BrowserDeterministicEvidence {
  return {
    stepIndex: 1,
    action: "assertTextVisible",
    expected: "Text is visible: Expected",
    passed: false,
    note: "assert visible Expected: FAIL",
    ...overrides,
  };
}

function finalize(args: {
  deterministicEvidence:
    BrowserDeterministicEvidence[];
  hasFailedAssertion?: boolean;
  hasAssertion?: boolean;
  hasAcceptanceAssertion?: boolean;
  needsManualVerification?: boolean;
}) {
  return finalizeBrowserStepResult({
    testCase: {
      goal: "Verify expected behavior.",
      successCriteria:
        "Expected behavior is visible.",
    },
    notes: [],
    deterministicEvidence:
      args.deterministicEvidence,
    hasAssertion:
      args.hasAssertion ?? true,
    hasAcceptanceAssertion:
      args.hasAcceptanceAssertion ?? true,
    hasPositiveAcceptanceAssertion: true,
    hasFailedAssertion:
      args.hasFailedAssertion ?? true,
    needsManualVerification:
      args.needsManualVerification ?? false,
    hasActionLimitation: false,
    requiresPanelOrModal: false,
    isPermissionSensitiveCase: false,
  });
}

test(
  "unknown assertion criticality retains FAIL",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence(),
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "acceptance-critical assertion failure retains FAIL",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          acceptanceCritical: true,
        }),
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "only explicitly non-critical assertion failures require manual verification",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          acceptanceCritical: false,
        }),
      ],
    });

    assert.equal(
      result.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      result.reasonCategory,
      "NON_CRITICAL_ASSERTION_FAILED"
    );
    assert.notEqual(result.status, "PASS");
  }
);

test(
  "non-critical failure cannot mask an unknown criticality failure",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          acceptanceCritical: false,
        }),
        assertionEvidence({
          stepIndex: 2,
        }),
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "non-critical assertion cannot mask failed non-assertion evidence",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          acceptanceCritical: false,
        }),
        {
          stepIndex: 2,
          action: "selectOption",
          expected:
            "Select the expected option",
          passed: false,
          note:
            "select expected option: FAIL",
        },
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "conflicting criticality for one oracle retains FAIL",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          oracleId: "web-1:assertion-1",
          acceptanceCritical: false,
        }),
        assertionEvidence({
          stepIndex: 2,
          oracleId: "web-1:assertion-1",
          acceptanceCritical: true,
          passed: true,
          note: "assert visible Expected: PASS",
        }),
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "malformed assertion criticality retains FAIL",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          acceptanceCritical:
            "false" as any,
        }),
      ],
    });

    assert.equal(result.status, "FAIL");
  }
);

test(
  "passing acceptance assertion behavior remains PASS",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          passed: true,
          note: "assert visible Expected: PASS",
        }),
      ],
      hasFailedAssertion: false,
    });

    assert.equal(result.status, "PASS");
  }
);

test(
  "passing sanity-only assertions remain manual",
  () => {
    const result = finalize({
      deterministicEvidence: [
        assertionEvidence({
          action: "assertTextNotVisible",
          expected:
            "Text is not visible: undefined",
          passed: true,
          note:
            "assert not visible undefined: PASS",
        }),
      ],
      hasFailedAssertion: false,
      hasAcceptanceAssertion: false,
    });

    assert.equal(
      result.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      result.reasonCategory,
      "SANITY_ONLY_ASSERTIONS"
    );
  }
);

test(
  "existing automation limitation remains manual",
  () => {
    const result = finalize({
      deterministicEvidence: [],
      needsManualVerification: true,
    });

    assert.equal(
      result.status,
      "MANUAL_REQUIRED"
    );
    assert.equal(
      result.reasonCategory,
      "AUTOMATION_LIMITATION"
    );
  }
);
