import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeBrowserOperationalCapabilities,
  type BrowserOperationalCapabilityEvaluation,
} from "./browser-capability-evaluation.js";

type Evaluation = BrowserOperationalCapabilityEvaluation<
  "EXAMPLE_OPERATIONAL_CAPABILITY",
  "NO_TARGET"
>;

function verified(surfaceIdentity = "surface-a"): Evaluation {
  return {
    capabilityKind: "EXAMPLE_OPERATIONAL_CAPABILITY",
    status: "EXECUTED_VERIFIED",
    attempted: true,
    executed: true,
    verifiedStateChange: true,
    settled: true,
    restorationRequired: true,
    restored: true,
    transportSafe: true,
    surfaceIdentity,
    acceptanceProof: {
      attempted: false,
      withheldReason: "OPERATIONAL_EVALUATION_ONLY",
    },
  };
}

function abstained(surfaceIdentity = "surface-b"): Evaluation {
  return {
    capabilityKind: "EXAMPLE_OPERATIONAL_CAPABILITY",
    status: "ABSTAINED",
    abstentionReason: "NO_TARGET",
    attempted: true,
    executed: false,
    verifiedStateChange: false,
    settled: false,
    restorationRequired: true,
    restored: false,
    transportSafe: true,
    surfaceIdentity,
    acceptanceProof: {
      attempted: false,
      withheldReason: "OPERATIONAL_EVALUATION_ONLY",
    },
  };
}

test("EXECUTED_VERIFIED counts attempt, execution, and verified state change", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([verified()]);
  assert.equal(telemetry.capabilityAttemptCount, 1);
  assert.equal(telemetry.capabilityExecutionCount, 1);
  assert.equal(telemetry.verifiedStateChangeCount, 1);
  assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 1);
});

test("ABSTAINED counts only an attempt", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([abstained()]);
  assert.equal(telemetry.capabilityAttemptCount, 1);
  assert.equal(telemetry.capabilityExecutionCount, 0);
  assert.equal(telemetry.verifiedStateChangeCount, 0);
  assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 0);
});

test("two verified evaluations on the same surface count as one reuse", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([
    verified("same"),
    verified("same"),
  ]);
  assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 1);
});

test("two verified evaluations on different surfaces count as two reuse", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([
    verified("one"),
    verified("two"),
  ]);
  assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 2);
});

test("abstained and unresolved surfaces never count as successful reuse", () => {
  const unresolved = { ...verified() };
  delete unresolved.surfaceIdentity;
  const telemetry = summarizeBrowserOperationalCapabilities([
    abstained("abstained"),
    unresolved,
  ]);
  assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 0);
});

test("withheld proof remains descriptive and creates no authority fields", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([verified()]);
  assert.deepEqual(telemetry.surfaces[0]!.acceptanceProof, {
    attempted: false,
    withheldReason: "OPERATIONAL_EVALUATION_ONLY",
  });
  assert.equal("deterministicEvidence" in telemetry, false);
  assert.equal("caseProofReadiness" in telemetry, false);
  assert.equal("status" in telemetry, false);
});

test("attempted proof metadata remains descriptive only", () => {
  const evaluation: Evaluation = {
    ...verified(),
    acceptanceProof: {
      attempted: true,
      attemptSummary: "A capability-owned proof adapter was consulted.",
    },
  };
  const telemetry = summarizeBrowserOperationalCapabilities([evaluation]);
  assert.deepEqual(telemetry.surfaces[0]!.acceptanceProof, {
    attempted: true,
    attemptSummary: "A capability-owned proof adapter was consulted.",
  });
  assert.equal("passed" in telemetry.surfaces[0]!.acceptanceProof, false);
});

test("restorationRequired false does not report restoration failure", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([
    {
      ...verified(),
      restorationRequired: false,
      restored: false,
    },
  ]);
  assert.equal(telemetry.capabilityExecutionCount, 1);
  assert.equal(telemetry.surfaces[0]!.restored, false);
  assert.equal(telemetry.surfaces[0]!.restorationSatisfied, true);
});

test("capability-owned abstention reason is preserved", () => {
  const telemetry = summarizeBrowserOperationalCapabilities([abstained()]);
  assert.equal(telemetry.surfaces[0]!.abstentionReason, "NO_TARGET");
});

test("aggregation does not mutate its source evaluation", () => {
  const source = verified();
  const before = structuredClone(source);
  summarizeBrowserOperationalCapabilities([source]);
  assert.deepEqual(source, before);
});
