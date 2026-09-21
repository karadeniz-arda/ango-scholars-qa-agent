import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateUniqueCompatibleFixtureCandidates,
  runtimeInvoiceStateFromCase,
} from "./browser-entity-interaction.js";

test("runtime fixture selection requires exactly one compatible candidate", () => {
  assert.deepEqual(evaluateUniqueCompatibleFixtureCandidates(0), {
    status: "BLOCKED",
    reason: "NO_COMPATIBLE_CANDIDATE",
  });
  assert.deepEqual(evaluateUniqueCompatibleFixtureCandidates(1), {
    status: "UNIQUE",
  });
  assert.deepEqual(evaluateUniqueCompatibleFixtureCandidates(2), {
    status: "BLOCKED",
    reason: "AMBIGUOUS_COMPATIBLE_CANDIDATES",
  });
  assert.deepEqual(evaluateUniqueCompatibleFixtureCandidates(20), {
    status: "BLOCKED",
    reason: "AMBIGUOUS_COMPATIBLE_CANDIDATES",
  });
});

test("typed invoice fixture contract owns required state over absent or wrong planner tabs", () => {
  const testCase = {
    id: "invoice-case",
    runtimeFixtureResolutionContract: {
      status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      policy: "ALL_REQUIRED",
      interactionExecutionCaseId: "execution-1",
      members: [{
        executionCaseId: "execution-1",
        required: true,
        acceptanceFixtureConstraint: {
          fixtureKind: "invoice",
          semantic: { kind: "STATE", state: "processed" },
          authority: "SOURCE_AUTHORIZED",
        },
        fixtureResolutionCapability: {
          fixtureKind: "invoice",
          resolverRef: "browser-visible-invoice-row",
          supportedState: "processed",
        },
      }],
    },
  };

  assert.equal(runtimeInvoiceStateFromCase(testCase), "processed");
  assert.equal(runtimeInvoiceStateFromCase({
    ...testCase,
    steps: [{ action: "clickTopTab", text: "sent for processing" }],
  }), "processed");
  assert.equal(runtimeInvoiceStateFromCase({
    ...testCase,
    steps: [],
  }), "processed");
});

test("malformed typed invoice contract fails closed rather than recovering state from planner tabs", () => {
  assert.equal(runtimeInvoiceStateFromCase({
    runtimeFixtureResolutionContract: {
      status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      policy: "ALL_REQUIRED",
      interactionExecutionCaseId: "execution-1",
      members: [{
        executionCaseId: "execution-1",
        required: true,
        acceptanceFixtureConstraint: {
          fixtureKind: "invoice",
          semantic: { kind: "STATE", state: "processed" },
          authority: "SOURCE_AUTHORIZED",
        },
        fixtureResolutionCapability: {
          fixtureKind: "invoice",
          resolverRef: "browser-visible-invoice-row",
          supportedState: "sent-for-processing",
        },
      }],
    },
    steps: [{ action: "clickTopTab", text: "processed" }],
  }), null);
});
