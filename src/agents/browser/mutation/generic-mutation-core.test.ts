import assert from "node:assert/strict";
import test from "node:test";
import type {
  GenericFixtureCandidateModelInput,
  GenericFixtureCandidateRequestProposal,
} from "../fixtures/generic-fixture-candidate-selector.js";
import {
  runGenericMutationCore,
} from "./generic-mutation-core.js";
import type {
  GenericMutationCandidate,
  GenericMutationCleanup,
} from "./generic-mutation-types.js";

const requirements = {
  goal: "Reach the requested state.",
  successCriteria:
    "The exact selected transition is observed.",
  automatedChecks: [],
  fixtureRequirements: [],
};

function chooseCapability(
  path: string,
  expected: string
): GenericFixtureCandidateRequestProposal {
  return async (input) => {
    const candidate =
      input.candidates.find(
        (item) =>
          item.capabilities[path] ===
          expected
      )!;

    return {
      decision: "SELECT_CANDIDATE",
      selectionMode:
        candidate.selectionMode,
      candidateId:
        candidate.candidateId,
      confidence: "high",
      rationale:
        "The requested semantic capability is exact.",
      evidence: [
        {
          path,
          expected,
        },
      ],
    };
  };
}

test(
  "two unrelated adapters share the core and select non-first candidates",
  async () => {
    let attached = false;
    const attachmentCandidates:
      GenericMutationCandidate[] = [
        {
          id: "attachment-wrong",
          transitionKind:
            "ATTACH_EXISTING",
          executionReference: {
            relationKey: "wrong",
          },
          semanticCapabilities: {
            audience: "internal",
          },
          eligible: true,
          preconditions: [
            "target exists",
          ],
          mutationPolicy: {
            mutates: true,
            ownership:
              "AGENT_OWNED_ON_SUCCESS",
            rollbackRequired: true,
          },
          expectedPostState: {
            attached: true,
          },
          execute: async (reference) => ({
            status: "APPLIED",
            executionReference:
              reference,
            note: "attached",
          }),
          observePostState:
            async () => ({
              observedState: {
                attached: true,
              },
              note: "attached",
            }),
          rollback: async (reference) => ({
            status: "ROLLED_BACK",
            executionReference:
              reference,
            note: "detached",
          }),
          expectedRollbackState: {
            attached: false,
          },
          observeRollbackState:
            async () => ({
              observedState: {
                attached: false,
              },
              note: "absent",
            }),
        },
        {
          id: "attachment-right",
          transitionKind:
            "ATTACH_EXISTING",
          executionReference: {
            relationKey: "right",
          },
          semanticCapabilities: {
            audience: "external",
          },
          eligible: true,
          preconditions: [
            "target exists",
          ],
          mutationPolicy: {
            mutates: true,
            ownership:
              "AGENT_OWNED_ON_SUCCESS",
            rollbackRequired: true,
          },
          expectedPostState: {
            attached: true,
          },
          execute: async (reference) => {
            attached = true;
            return {
              status: "APPLIED",
              executionReference:
                reference,
              note: "attached",
            };
          },
          observePostState:
            async () => ({
              observedState: {
                attached,
              },
              note: "observed relation",
            }),
          rollback: async (reference) => {
            attached = false;
            return {
              status: "ROLLED_BACK",
              executionReference:
                reference,
              note: "detached",
            };
          },
          expectedRollbackState: {
            attached: false,
          },
          observeRollbackState:
            async () => ({
              observedState: {
                attached,
              },
              note: "observed absence",
            }),
        },
      ];

    const attachmentResult =
      await runGenericMutationCore({
        requirements,
        candidates:
          attachmentCandidates,
        requestProposal:
          chooseCapability(
            "audience",
            "external"
          ),
      });

    assert.equal(
      attachmentResult.status,
      "READY"
    );

    if (
      attachmentResult.status ===
      "READY"
    ) {
      assert.equal(
        attachmentResult
          .candidate.id,
        "attachment-right"
      );
      assert.equal(
        attachmentResult
          .cleanups.length,
        1
      );
      assert.equal(
        (await attachmentResult
          .cleanups[0]!.run())
          .status,
        "PASS"
      );
      assert.equal(attached, false);
    }

    let created = false;
    const createCandidate:
      GenericMutationCandidate = {
        id: "create-record",
        transitionKind: "CREATE_NEW",
        executionReference: {
          command: {
            operation: "insert",
            collection: "catalog",
          },
          payload: {
            template: "green",
          },
        },
        semanticCapabilities: {
          color: "green",
        },
        eligible: true,
        preconditions: [
          "template is available",
        ],
        mutationPolicy: {
          mutates: true,
          ownership:
            "AGENT_OWNED_ON_SUCCESS",
          rollbackRequired: true,
        },
        expectedPostState: {
          recordExists: true,
        },
        execute: async (reference) => {
          created = true;
          return {
            status: "APPLIED",
            executionReference:
              reference,
            note: "created",
          };
        },
        observePostState:
          async () => ({
            observedState: {
              recordExists: created,
            },
            note: "record observed",
          }),
        rollback: async (reference) => {
          created = false;
          return {
            status: "ROLLED_BACK",
            executionReference:
              reference,
            note: "deleted",
          };
        },
        expectedRollbackState: {
          recordExists: false,
        },
        observeRollbackState:
          async () => ({
            observedState: {
              recordExists: created,
            },
            note: "absence observed",
          }),
      };

    const createResult =
      await runGenericMutationCore({
        requirements,
        candidates: [
          createCandidate,
        ],
        requestProposal:
          chooseCapability(
            "color",
            "green"
          ),
      });

    assert.equal(
      createResult.status,
      "READY"
    );

    if (
      createResult.status === "READY"
    ) {
      assert.equal(
        (await createResult
          .cleanups[0]!.run())
          .status,
        "PASS"
      );
      assert.equal(created, false);
    }
  }
);

test(
  "opaque execution data never reaches the proposal and a mismatched reference is rejected",
  async () => {
    let captured:
      GenericFixtureCandidateModelInput |
      undefined;

    const candidate:
      GenericMutationCandidate = {
        id: "private-runtime-id",
        transitionKind: "CREATE_NEW",
        executionReference: {
          endpoint:
            "/private/runtime/path",
          method: "POST",
          payload: {
            privateField:
              "private-value",
          },
        },
        semanticCapabilities: {
          purpose: "demo",
        },
        eligible: true,
        preconditions: ["ready"],
        mutationPolicy: {
          mutates: true,
          ownership:
            "AGENT_OWNED_ON_SUCCESS",
          rollbackRequired: true,
        },
        expectedPostState: {
          exists: true,
        },
        execute: async () => ({
          status: "APPLIED",
          executionReference: {
            endpoint:
              "/invented/path",
          },
          note: "mismatched",
        }),
        observePostState:
          async () => ({
            observedState: {
              exists: true,
            },
            note: "exists",
          }),
        rollback: async (reference) => ({
          status: "ROLLED_BACK",
          executionReference:
            reference,
          note: "rolled back",
        }),
        expectedRollbackState: {
          exists: false,
        },
        observeRollbackState:
          async () => ({
            observedState: {
              exists: false,
            },
            note: "absent",
          }),
      };

    const result =
      await runGenericMutationCore({
        requirements,
        candidates: [candidate],
        requestProposal:
          async (input) => {
            captured = input;
            return chooseCapability(
              "purpose",
              "demo"
            )(input);
          },
      });

    const serialized =
      JSON.stringify(captured);

    assert.equal(
      serialized.includes(
        "/private/runtime/path"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "private-value"
      ),
      false
    );
    assert.equal(
      serialized.includes(
        "private-runtime-id"
      ),
      false
    );
    assert.equal(result.status, "ERROR");

    if (result.status === "ERROR") {
      assert.equal(
        result.reasonCategory,
        "EXECUTION_REFERENCE_MISMATCH"
      );
    }
  }
);

test(
  "pre-existing state owns no cleanup and failed verification retains owned cleanup",
  async () => {
    const reuse:
      GenericMutationCandidate = {
        id: "reuse",
        transitionKind:
          "REUSE_EXISTING",
        executionReference: {
          reference: "existing",
        },
        semanticCapabilities: {
          type: "shared",
        },
        eligible: true,
        preconditions: [
          "state exists",
        ],
        mutationPolicy: {
          mutates: false,
          ownership: "PRE_EXISTING",
          rollbackRequired: false,
        },
        expectedPostState: {
          exists: true,
        },
        observePostState:
          async () => ({
            observedState: {
              exists: true,
            },
            note: "existing",
          }),
      };

    const reused =
      await runGenericMutationCore({
        requirements,
        candidates: [reuse],
        requestProposal:
          chooseCapability(
            "type",
            "shared"
          ),
      });

    assert.equal(reused.status, "READY");
    assert.deepEqual(
      reused.cleanups,
      []
    );

    const registered:
      GenericMutationCleanup[] = [];
    const lifecycleOrder:
      string[] = [];
    const owned = {
      ...reuse,
      id: "owned",
      transitionKind:
        "CREATE_NEW" as const,
      executionReference: {
        reference: "owned",
      },
      mutationPolicy: {
        mutates: true,
        ownership:
          "AGENT_OWNED_ON_SUCCESS" as const,
        rollbackRequired: true,
      },
      execute: async (
        reference:
          GenericMutationCandidate["executionReference"]
      ) => {
        lifecycleOrder.push(
          "executed"
        );

        return {
          status: "APPLIED" as const,
          executionReference:
            reference,
          note: "created",
        };
      },
      observePostState:
        async () => ({
          observedState: {
            exists: false,
          },
          note:
            "expected state missing",
        }),
      rollback: async (
        reference:
          GenericMutationCandidate["executionReference"]
      ) => ({
        status: "FAILED" as const,
        executionReference:
          reference,
        note: "rollback rejected",
      }),
      expectedRollbackState: {
        exists: false,
      },
      observeRollbackState:
        async () => ({
          observedState: {
            exists: true,
          },
          note: "still present",
        }),
    } satisfies GenericMutationCandidate;

    const failedVerification =
      await runGenericMutationCore({
        requirements,
        candidates: [owned],
        requestProposal:
          chooseCapability(
            "type",
            "shared"
          ),
        registerCleanup:
          (cleanup) => {
            lifecycleOrder.push(
              "registered"
            );
            registered.push(cleanup);
          },
      });

    assert.equal(
      failedVerification.status,
      "BLOCKED"
    );
    assert.equal(registered.length, 1);
    assert.equal(
      lifecycleOrder.join(","),
      "registered,executed"
    );
    assert.equal(
      failedVerification
        .cleanups.length,
      1
    );
    assert.equal(
      (await registered[0]!.run())
        .status,
      "FAIL"
    );
  }
);
