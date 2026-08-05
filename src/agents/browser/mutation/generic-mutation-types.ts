import type {
  GenericFixtureCandidateEvaluation,
  GenericFixtureCandidateProposal,
  GenericFixtureCandidateRequestProposal,
  GenericFixtureRequirementContext,
  GenericFixtureScalar,
} from "../fixtures/generic-fixture-candidate-selector.js";

export type GenericMutationJson =
  | GenericFixtureScalar
  | GenericMutationJson[]
  | {
      [key: string]:
        GenericMutationJson;
    };

export type GenericMutationTransitionKind =
  | "REUSE_EXISTING"
  | "ATTACH_EXISTING"
  | "CREATE_NEW"
  | "UPDATE_EXISTING"
  | "DELETE_EXISTING";

export type GenericMutationOwnership =
  | "PRE_EXISTING"
  | "AGENT_OWNED_ON_SUCCESS";

export type GenericMutationPolicy = {
  mutates: boolean;
  ownership:
    GenericMutationOwnership;
  rollbackRequired: boolean;
};

export type GenericMutationExecutionResult = {
  status:
    | "APPLIED"
    | "NOT_APPLIED";
  executionReference:
    GenericMutationJson;
  note: string;
};

export type GenericMutationObservation = {
  observedState:
    GenericMutationJson;
  note: string;
};

export type GenericMutationRollbackResult = {
  status:
    | "ROLLED_BACK"
    | "FAILED";
  executionReference:
    GenericMutationJson;
  note: string;
};

export type GenericMutationCandidate = {
  id: string;
  label?: string;
  transitionKind:
    GenericMutationTransitionKind;
  executionReference:
    GenericMutationJson;
  semanticCapabilities:
    Record<
      string,
      GenericFixtureScalar
    >;
  eligible: boolean;
  preconditions: string[];
  mutationPolicy:
    GenericMutationPolicy;
  expectedPostState:
    GenericMutationJson;
  observePostState: (
    executionReference:
      GenericMutationJson
  ) => Promise<
    GenericMutationObservation
  >;
  execute?: (
    executionReference:
      GenericMutationJson
  ) => Promise<
    GenericMutationExecutionResult
  >;
  rollback?: (
    executionReference:
      GenericMutationJson
  ) => Promise<
    GenericMutationRollbackResult
  >;
  expectedRollbackState?:
    GenericMutationJson;
  observeRollbackState?: (
    executionReference:
      GenericMutationJson
  ) => Promise<
    GenericMutationObservation
  >;
};

export type GenericMutationCleanupResult = {
  status: "PASS" | "FAIL";
  note: string;
};

export type GenericMutationCleanup = {
  label: string;
  expected: string;
  run: () => Promise<
    GenericMutationCleanupResult
  >;
};

export type GenericMutationCoreArgs = {
  requirements:
    GenericFixtureRequirementContext;
  candidates:
    GenericMutationCandidate[];
  requestProposal?:
    GenericFixtureCandidateRequestProposal;
  selectCandidate?: typeof import(
    "../fixtures/generic-fixture-candidate-selector.js"
  ).runGenericFixtureCandidateSelection;
  selectionPolicy?: {
    allowReusePreference?: boolean;
  };
  registerCleanup?: (
    cleanup:
      GenericMutationCleanup
  ) => void;
};

export type GenericMutationCoreResult =
  | {
      status: "READY";
      note: string;
      candidate:
        GenericMutationCandidate;
      proposal:
        GenericFixtureCandidateProposal;
      evaluation:
        GenericFixtureCandidateEvaluation;
      cleanups:
        GenericMutationCleanup[];
    }
  | {
      status: "BLOCKED";
      reasonCategory: string;
      note: string;
      cleanups:
        GenericMutationCleanup[];
      proposal?:
        GenericFixtureCandidateProposal;
      evaluation?:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "ERROR";
      reasonCategory: string;
      note: string;
      cleanups:
        GenericMutationCleanup[];
      proposal?:
        GenericFixtureCandidateProposal;
      evaluation?:
        GenericFixtureCandidateEvaluation;
    };
