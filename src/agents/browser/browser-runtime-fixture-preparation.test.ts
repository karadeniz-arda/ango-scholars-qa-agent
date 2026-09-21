import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  evaluateRuntimeInvoiceFixturePreparation,
  requiresRuntimeInvoiceFixturePreparation,
  runtimeFixturePreparationAllowsInteraction,
  type RuntimeInvoiceFixtureState,
} from "./browser-runtime-fixture-preparation.js";

const PREPARED_AT =
  "2026-09-02T12:00:00.000Z";

function v2Case(
  state: RuntimeInvoiceFixtureState =
    "processed",
  identityPolicy:
    | "compatible-state"
    | "exact" = "compatible-state"
) {
  const executionCaseId =
    `candidate-${state}`;

  return {
    id: `case-${state}`,
    persona: "company_admin",
    runtimeFixturePolicy:
      identityPolicy,
    runtimeFixtureResolutionContract: {
      status:
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      policy: "ALL_REQUIRED",
      members: [
        {
          executionCaseId,
          required: true,
          acceptanceFixtureConstraint: {
            executionCaseId,
            sourceCaseId:
              executionCaseId,
            partition: {
              mode: "ALL_REQUIRED",
              memberId: state,
              memberCount: 1,
            },
            fixtureKind: "invoice",
            semantic: {
              kind: "STATE",
              state,
            },
            obligationIds: [
              "jira-obligation-1",
            ],
            sourceUnitRefs: [
              {
                sourceUnitId:
                  "jira-unit-1",
                sourceRef:
                  "jira.description",
              },
            ],
            identityPolicy,
            authority:
              "SOURCE_AUTHORIZED",
          },
          fixtureResolutionCapability: {
            executionCaseId,
            fixtureKind: "invoice",
            resolverRef:
              "browser-visible-invoice-row",
            classification:
              "READ_ONLY_DISCOVERY",
            persona: "company_admin",
            supportedState: state,
            identityPolicy,
            selectionPolicy:
              "UNIQUE_COMPATIBLE_ONLY",
            ambiguityPolicy:
              "BLOCK_TEST_DATA_ISSUE",
            provenance: {
              module:
                "src/agents/browser/browser-entity-interaction.ts",
              exportName:
                "resolveAndOpenInvoiceRow",
            },
          },
          runtimeFixtureBinding:
            "NOT_YET_RESOLVED",
        },
      ],
      fixtureReadyForInteraction: false,
      interactionExecutionCaseId:
        executionCaseId,
    },
  };
}

function evaluate(args: {
  testCase?: any;
  state?: RuntimeInvoiceFixtureState;
  stateVerified?: boolean;
  persona?: string | null;
  candidates?: Array<{
    identityRef: string;
    verifiedState:
      RuntimeInvoiceFixtureState;
  }>;
  requestedIdentity?: string | null;
}) {
  const state = args.state ?? "processed";

  return evaluateRuntimeInvoiceFixturePreparation({
    testCase:
      args.testCase ?? v2Case(state),
    actualPersona:
      args.persona === undefined
        ? "company_admin"
        : args.persona,
    requiredState: state,
    stateVerified:
      args.stateVerified ?? true,
    candidates: args.candidates ?? [],
    ...(args.requestedIdentity !== undefined
      ? {
          requestedIdentity:
            args.requestedIdentity,
        }
      : {}),
    preparedAt: PREPARED_AT,
    evidenceRef:
      "runtime-fixture-preparation:test-case",
  });
}

test("zero candidates block without binding or interaction readiness", () => {
  const result = evaluate({});

  assert.equal(result.status, "TEST_DATA_BLOCKED");
  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(result.binding, null);
  assert.equal(result.fixtureReadyForInteraction, false);
  assert.equal(runtimeFixturePreparationAllowsInteraction(result), false);
});

for (const state of [
  "processed",
  "sent-for-processing",
] as const) {
  test(`one unique ${state} candidate produces a typed ready binding`, () => {
    const result = evaluate({
      state,
      candidates: [
        {
          identityRef: "INV-3-202609-0001",
          verifiedState: state,
        },
      ],
    });

    assert.equal(result.status, "RESOLVED");
    assert.equal(result.candidateCount, 1);
    assert.equal(result.verifiedState, state);
    assert.equal(result.fixtureReadyForInteraction, true);
    assert.equal(result.binding?.verifiedState, state);
    assert.equal(
      result.binding?.fixtureIdentityRef,
      "INV-3-202609-0001"
    );
    assert.equal(
      result.binding?.selectionPolicy,
      "UNIQUE_COMPATIBLE_ONLY"
    );
    assert.equal(runtimeFixturePreparationAllowsInteraction(result), true);
  });
}

test("multiple candidates block without selecting the first item", () => {
  const result = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
      {
        identityRef: "INV-B",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.failureReason, "AMBIGUOUS_COMPATIBLE_CANDIDATES");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.selectedIdentity, null);
  assert.equal(result.binding, null);
});

test("wrong-state candidate cannot produce a binding", () => {
  const result = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState:
          "sent-for-processing",
      },
    ],
  });

  assert.equal(result.status, "TEST_DATA_BLOCKED");
  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(result.binding, null);
});

test("unverified state cannot produce a binding", () => {
  const result = evaluate({
    stateVerified: false,
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.failureReason, "STATE_NOT_VERIFIED");
  assert.equal(result.binding, null);
});

test("wrong or absent execution persona cannot produce a binding", () => {
  for (const persona of ["talent", null]) {
    const result = evaluate({
      persona,
      candidates: [
        {
          identityRef: "INV-A",
          verifiedState: "processed",
        },
      ],
    });

    assert.equal(result.failureReason, "PERSONA_MISMATCH");
    assert.equal(result.binding, null);
  }
});

test("malformed contract cannot produce a binding", () => {
  const testCase = v2Case();
  testCase.runtimeFixtureResolutionContract.members[0]!
    .fixtureResolutionCapability.selectionPolicy =
      "FIRST_VISIBLE";
  const result = evaluate({
    testCase,
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.failureReason, "MALFORMED_CONTRACT");
  assert.equal(result.binding, null);
});

test("candidate-only authority cannot produce a binding", () => {
  const testCase = v2Case();
  testCase.runtimeFixtureResolutionContract.members[0]!
    .acceptanceFixtureConstraint.authority =
      "CANDIDATE_ONLY";
  const result = evaluate({
    testCase,
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.failureReason, "MALFORMED_CONTRACT");
  assert.equal(result.binding, null);
});

test("exact identity cannot be substituted", () => {
  const testCase = v2Case("processed", "exact");
  const result = evaluate({
    testCase,
    requestedIdentity: "INV-EXPECTED",
    candidates: [
      {
        identityRef: "INV-DIFFERENT",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.failureReason, "EXACT_IDENTITY_MISMATCH");
  assert.equal(result.binding, null);
});

test("compatible-state identity may bind one verified substitute", () => {
  const result = evaluate({
    requestedIdentity: "INV-EXPECTED",
    candidates: [
      {
        identityRef: "INV-COMPATIBLE",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(result.status, "RESOLVED");
  assert.equal(result.selectedIdentity, "INV-COMPATIBLE");
});

test("binding contains safe execution and resolver provenance", () => {
  const result = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.deepEqual(result.binding, {
    status: "RESOLVED",
    executionCaseId: "candidate-processed",
    fixtureKind: "invoice",
    fixtureIdentityRef: "INV-A",
    verifiedState: "processed",
    ownerPersonaRef: "company_admin",
    identityPolicy: "compatible-state",
    selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
    resolverProvenance: {
      resolverRef: "browser-visible-invoice-row",
      evidenceRef: "runtime-fixture-preparation:test-case",
    },
    verifiedAt: PREPARED_AT,
  });
});

test("durable result serializes without secret-bearing fields", () => {
  const result = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });
  const serialized = JSON.stringify(result);
  const reloaded = JSON.parse(serialized);

  assert.deepEqual(reloaded, result);
  assert.doesNotMatch(
    serialized,
    /credential|cookie|authorization|access[_-]?token|refresh[_-]?token|sessiondata/i
  );
});

test("planning contract remains unresolved and false after evaluation", () => {
  const testCase = v2Case();
  const before = structuredClone(testCase);

  evaluate({
    testCase,
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.deepEqual(testCase, before);
  assert.equal(
    testCase.runtimeFixtureResolutionContract.members[0]!
      .runtimeFixtureBinding,
    "NOT_YET_RESOLVED"
  );
  assert.equal(
    testCase.runtimeFixtureResolutionContract
      .fixtureReadyForInteraction,
    false
  );
});

test("runtime readiness is separate and exists only with a binding", () => {
  const blocked = evaluate({});
  const resolved = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(blocked.fixtureReadyForInteraction, false);
  assert.equal(blocked.binding, null);
  assert.equal(resolved.fixtureReadyForInteraction, true);
  assert.notEqual(resolved.binding, null);
});

test("tampered or absent binding cannot pass the interaction gate", () => {
  const resolved = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  });

  assert.equal(runtimeFixturePreparationAllowsInteraction(undefined), false);
  assert.equal(
    runtimeFixturePreparationAllowsInteraction({
      ...resolved,
      binding: null,
    }),
    false
  );
  assert.equal(
    runtimeFixturePreparationAllowsInteraction({
      ...resolved,
      fixtureReadyForInteraction: false,
    }),
    false
  );
});

test("fixture preparation result contains no proof or verdict authority", () => {
  const result = evaluate({
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState: "processed",
      },
    ],
  }) as any;

  assert.equal(result.status, "RESOLVED");
  assert.equal("passed" in result, false);
  assert.equal("verdict" in result, false);
  assert.equal("proof" in result, false);
  assert.equal("evidenceContract" in result, false);
});

test("legacy cases do not require the V2 preparation boundary", () => {
  assert.equal(
    requiresRuntimeInvoiceFixturePreparation({
      id: "legacy-case",
      runtimeFixturePolicy:
        "compatible-state",
    }),
    false
  );
  assert.equal(
    requiresRuntimeInvoiceFixturePreparation(
      v2Case()
    ),
    true
  );
});

test("evaluation is idempotent for the same observation and timestamp", () => {
  const args = {
    candidates: [
      {
        identityRef: "INV-A",
        verifiedState:
          "processed" as const,
      },
    ],
  };

  assert.deepEqual(evaluate(args), evaluate(args));
});

test("Fresh AS-1014 canary contract reaches PREPARE but cannot bind artifact-only", () => {
  const planPath =
    "qa-results/runs/" +
    "browser-planner-overhaul-canary-20260902-191206/" +
    "AS-1014/test-plan.json";
  const plan = JSON.parse(
    fs.readFileSync(planPath, "utf8")
  );
  const testCase = plan.browserCases.find(
    (candidate: any) =>
      candidate.id ===
      "web-runtime-fixture-cc9ad0c6298b"
  );

  assert.ok(testCase);
  assert.equal(
    requiresRuntimeInvoiceFixturePreparation(testCase),
    true
  );
  const result = evaluate({
    testCase,
    state: "processed",
    candidates: [],
  });

  assert.equal(result.failureReason, "NO_COMPATIBLE_CANDIDATE");
  assert.equal(result.binding, null);
  assert.equal(result.fixtureReadyForInteraction, false);
  assert.equal(
    testCase.runtimeFixtureResolutionContract.members[0]
      .runtimeFixtureBinding,
    "NOT_YET_RESOLVED"
  );
});
