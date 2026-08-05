import {
  runGenericFixtureCandidateSelection,
  type GenericFixtureCandidateSelectionMode,
} from "../fixtures/generic-fixture-candidate-selector.js";
import type {
  GenericMutationCandidate,
  GenericMutationCleanup,
  GenericMutationCleanupResult,
  GenericMutationCoreArgs,
  GenericMutationCoreResult,
  GenericMutationJson,
  GenericMutationTransitionKind,
} from "./generic-mutation-types.js";

function selectionModeForTransition(
  kind: GenericMutationTransitionKind
): GenericFixtureCandidateSelectionMode {
  switch (kind) {
    case "REUSE_EXISTING":
      return "REUSE_EXISTING";
    case "ATTACH_EXISTING":
      return "ATTACH_NEW";
    case "CREATE_NEW":
      return "CREATE_NEW";
    case "UPDATE_EXISTING":
      return "UPDATE_EXISTING";
    case "DELETE_EXISTING":
      return "DELETE_EXISTING";
  }
}

function stableJson(
  value: GenericMutationJson
): string {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    if (
      typeof value === "number" &&
      !Number.isFinite(value)
    ) {
      throw new Error(
        "Generic mutation JSON cannot contain a non-finite number."
      );
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${
      value.map(stableJson).join(",")
    }]`;
  }

  return `{${
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(value[key]!)}`
      )
      .join(",")
  }}`;
}

export function genericMutationJsonEquals(
  left: GenericMutationJson,
  right: GenericMutationJson
): boolean {
  return stableJson(left) ===
    stableJson(right);
}

function validateCandidate(
  candidate:
    GenericMutationCandidate
): string | null {
  if (
    !candidate.id.trim()
  ) {
    return "A discovered transition is missing its exact internal ID.";
  }

  if (
    candidate.preconditions.length ===
      0
  ) {
    return `Transition ${candidate.id} has no explicit preconditions.`;
  }

  const policy =
    candidate.mutationPolicy;

  if (!policy.mutates) {
    if (
      policy.ownership !==
        "PRE_EXISTING" ||
      policy.rollbackRequired ||
      candidate.execute ||
      candidate.rollback
    ) {
      return `Read-only transition ${candidate.id} has an inconsistent mutation policy.`;
    }

    return null;
  }

  if (
    policy.ownership !==
      "AGENT_OWNED_ON_SUCCESS" ||
    !policy.rollbackRequired ||
    !candidate.execute ||
    !candidate.rollback ||
    candidate.expectedRollbackState ===
      undefined ||
    !candidate.observeRollbackState
  ) {
    return `Mutating transition ${candidate.id} lacks an exact owned rollback contract.`;
  }

  return null;
}

function buildCleanup(
  candidate:
    GenericMutationCandidate
): {
  cleanup:
    GenericMutationCleanup;
  markOwned: () => void;
} {
  let owned = false;
  let cleanupPromise:
    Promise<
      GenericMutationCleanupResult
    > | null = null;

  const run = async ():
  Promise<
    GenericMutationCleanupResult
  > => {
    if (!owned) {
      return {
        status: "PASS",
        note:
          "No exact mutation success established ownership; cleanup is a verified no-op.",
      };
    }

    let rollback;

    try {
      rollback =
        await candidate.rollback!(
          candidate.executionReference
        );
    } catch (error: unknown) {
      return {
        status: "FAIL",
        note:
          `Exact rollback threw: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      };
    }

    if (
      rollback.status !==
        "ROLLED_BACK"
    ) {
      return {
        status: "FAIL",
        note:
          `Exact rollback failed: ${rollback.note}`,
      };
    }

    if (
      !genericMutationJsonEquals(
        rollback.executionReference,
        candidate.executionReference
      )
    ) {
      return {
        status: "FAIL",
        note:
          "Rollback reported a different execution reference than the selected transition.",
      };
    }

    let observation;

    try {
      observation =
        await candidate
          .observeRollbackState!(
            candidate
              .executionReference
          );
    } catch (error: unknown) {
      return {
        status: "FAIL",
        note:
          `Post-rollback observation threw: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
      };
    }

    if (
      !genericMutationJsonEquals(
        observation.observedState,
        candidate
          .expectedRollbackState!
      )
    ) {
      return {
        status: "FAIL",
        note:
          `Rollback completed but exact rollback state was not observed: ${observation.note}`,
      };
    }

    return {
      status: "PASS",
      note:
        `Exact rollback and post-rollback state were verified: ${observation.note}`,
    };
  };

  return {
    cleanup: {
      label:
        `owned transition ${candidate.id}`,
      expected:
        "Rollback the exact owned transition and verify the exact post-rollback state",
      run: () => {
        if (!cleanupPromise) {
          cleanupPromise = run();
        }

        return cleanupPromise;
      },
    },
    markOwned: () => {
      owned = true;
    },
  };
}

export async function runGenericMutationCore(
  args: GenericMutationCoreArgs
): Promise<GenericMutationCoreResult> {
  const candidateIds =
    new Set<string>();

  for (const candidate of args.candidates) {
    if (
      candidateIds.has(candidate.id)
    ) {
      return {
        status: "ERROR",
        reasonCategory:
          "DUPLICATE_TRANSITION_ID",
        note:
          "Discovered transition IDs must be exact and unique.",
        cleanups: [],
      };
    }

    candidateIds.add(candidate.id);

    const validationFailure =
      validateCandidate(candidate);

    if (validationFailure) {
      return {
        status: "ERROR",
        reasonCategory:
          "INVALID_TRANSITION_CONTRACT",
        note: validationFailure,
        cleanups: [],
      };
    }
  }

  const selectCandidate =
    args.selectCandidate ??
    runGenericFixtureCandidateSelection;

  const selection =
    await selectCandidate({
      requirements:
        args.requirements,
      candidates:
        args.candidates.map(
          (candidate) => ({
            id: candidate.id,
            ...(candidate.label
              ? {
                  label:
                    candidate.label,
                }
              : {}),
            usable:
              candidate.eligible,
            alreadyAttached:
              candidate
                .transitionKind ===
              "REUSE_EXISTING",
            selectionMode:
              selectionModeForTransition(
                candidate
                  .transitionKind
              ),
            semanticCapabilities:
              candidate
                .semanticCapabilities,
          })
        ),
      ...(args.requestProposal
        ? {
            requestProposal:
              args.requestProposal,
          }
        : {}),
      ...(args.selectionPolicy
        ? {
            selectionPolicy:
              args.selectionPolicy,
          }
        : {}),
    });

  if (selection.status === "ERROR") {
    return {
      status: "ERROR",
      reasonCategory:
        "TRANSITION_SELECTION_ERROR",
      note: selection.note,
      cleanups: [],
    };
  }

  if (selection.status === "BLOCKED") {
    return {
      status: "BLOCKED",
      reasonCategory:
        "TRANSITION_SELECTION_BLOCKED",
      note: selection.note,
      cleanups: [],
      proposal:
        selection.proposal,
      evaluation:
        selection.evaluation,
    };
  }

  const candidate =
    args.candidates.find(
      (item) =>
        item.id ===
        selection.candidate.id
    );

  if (!candidate) {
    return {
      status: "ERROR",
      reasonCategory:
        "TRANSITION_MAPPING_ERROR",
      note:
        "The selected transition was not present in the discovered runtime set.",
      cleanups: [],
      proposal:
        selection.proposal,
      evaluation:
        selection.evaluation,
    };
  }

  const cleanups:
    GenericMutationCleanup[] = [];

  let markOwned:
    (() => void) | undefined;

  if (
    candidate.mutationPolicy
      .mutates
  ) {
    const ownedCleanup =
      buildCleanup(candidate);

    cleanups.push(
      ownedCleanup.cleanup
    );
    markOwned =
      ownedCleanup.markOwned;

    args.registerCleanup?.(
      ownedCleanup.cleanup
    );

    let execution;

    try {
      execution =
        await candidate.execute!(
          candidate
            .executionReference
        );
    } catch (error: unknown) {
      return {
        status: "ERROR",
        reasonCategory:
          "TRANSITION_EXECUTION_ERROR",
        note:
          `Transition execution threw before exact success was established: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        cleanups,
        proposal:
          selection.proposal,
        evaluation:
          selection.evaluation,
      };
    }

    if (
      execution.status !==
        "APPLIED"
    ) {
      return {
        status: "BLOCKED",
        reasonCategory:
          "TRANSITION_NOT_APPLIED",
        note: execution.note,
        cleanups,
        proposal:
          selection.proposal,
        evaluation:
          selection.evaluation,
      };
    }

    if (
      !genericMutationJsonEquals(
        execution.executionReference,
        candidate.executionReference
      )
    ) {
      return {
        status: "ERROR",
        reasonCategory:
          "EXECUTION_REFERENCE_MISMATCH",
        note:
          "The adapter reported a different execution reference than the selected discovered transition.",
        cleanups,
        proposal:
          selection.proposal,
        evaluation:
          selection.evaluation,
      };
    }

    markOwned();
  }

  let observation;

  try {
    observation =
      await candidate
        .observePostState(
          candidate.executionReference
        );
  } catch (error: unknown) {
    return {
      status: "ERROR",
      reasonCategory:
        "POST_STATE_OBSERVATION_ERROR",
      note:
        `Exact post-state observation threw: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      cleanups,
      proposal:
        selection.proposal,
      evaluation:
        selection.evaluation,
    };
  }

  if (
    !genericMutationJsonEquals(
      observation.observedState,
      candidate.expectedPostState
    )
  ) {
    return {
      status: "BLOCKED",
      reasonCategory:
        "POST_STATE_VERIFICATION_FAILED",
      note:
        `The exact expected post-state was not observed: ${observation.note}`,
      cleanups,
      proposal:
        selection.proposal,
      evaluation:
        selection.evaluation,
    };
  }

  return {
    status: "READY",
    note:
      `Selected transition ${candidate.id}; exact post-state verified: ${observation.note}`,
    candidate,
    proposal:
      selection.proposal,
    evaluation:
      selection.evaluation,
    cleanups,
  };
}
