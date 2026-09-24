
import type { SourceBackedSurfaceIdentity } from "../discovery/source-surface-provenance.js";
import type { BrowserExecutionIntentAuthority } from "../agents/browser/browser-runtime-execution-binding.js";
import type { PlannerBrowserSemanticCandidateProposal } from "./planner-model-proposal.js";

// One HTTP test
export type ApiTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  expect: {
    status: number | "UNKNOWN";
    contentType?: string;
    notes?: string;
  };
};

export type BrowserStep =
  | { action: "wait"; ms: number }
  | { action: "reload" }
  | { action: "setViewport"; width: number; height: number }
  | { action: "clickTopTab"; text: string }
  | { action: "selectRuntimeTopTab" }
  | {
      action: "openRuntimeControl";
      target: string;
    }
  | {
      action: "selectRuntimeFilterOption";
      queryKey: string;
      filterKey?: never;
      hint?: string;
      verification?: "url";
    }
  | {
      action: "selectRuntimeFilterOption";
      filterKey: string;
      queryKey?: never;
      hint?: string;
      verification: "visible-state";
      interactionId?: string;
      oracleId?: string;
    }
  | {
      action: "createDraftJobAndVerifyRedirect";
      origin: "jobs" | "all-jobs";
    }
| {
    action: "clickButton";
    text: string;
    interactionId?: string;
    /** Runtime compatibility navigation may assist execution but never adds proof authority. */
    compatibilityNavigation?: "ADVISORY";
    /**
     * This interaction must establish a fresh semantic surface before later
     * assertions may contribute deterministic evidence. It is an execution
     * precondition only: it never authorizes an acceptance requirement.
     */
    assertionSurfaceGrounding?: "REQUIRED";
    contextText?: string;
    verifyExpandedSurface?: boolean;
  }
| {
    action: "clickText";
    text: string;
    interactionId?: string;
  }
  | { action: "openMenu"; text: string }
  | { action: "selectOption"; text: string }
  | { action: "assertUrlContains"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | { action: "assertUrlNotContains"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | { action: "assertTextVisible"; text: string; oracleId?: string; acceptanceCritical?: boolean }
  | {
      /*
       * GENERIC_BROWSER_SURFACE_CONTROL_ASSERTION_PLUMBING_V1
       *
       * Deterministically prove an exact semantic control set
       * inside one uniquely observed semantic surface.
       */
      action: "assertSurfaceControls";
      surfaceKind:
        | "dialog"
        | "menu"
        | "listbox"
        | "region"
        | "surface";
      controls: Array<{
        kind:
          | "button"
          | "link"
          | "tab"
          | "menuitem"
          | "option"
          | "control";
        label: string;
      }>;
      oracleId?: string;
      acceptanceCritical?: boolean;
    }
  | { action: "assertTextNotVisible"; text: string; oracleId?: string; acceptanceCritical?: boolean };

export type UrlTransitionRequirement = {
  kind: "URL_TRANSITION";

  /*
   * Human-readable audit context only.
   * Never use this text as a machine linkage key.
   */
  sourceClaim: string;

  /*
   * Stable identity of the interaction expected
   * to cause the URL transition.
   */
  interactionId: string;

  /*
   * Stable identity of the positive URL assertion
   * that proves the destination.
   */
  urlAssertionOracleId: string;
};

export type SelectedStateRequirement = {
  kind: "SELECTED_STATE";

  /*
   * Human-readable audit context only.
   * Never use this text as a machine linkage key.
   */
  sourceClaim: string;

  /*
   * Stable identity of the selection interaction.
   */
  interactionId: string;

  /*
   * Stable identity of the deterministic
   * post-selection oracle.
   */
  selectionOracleId: string;
};

export type BrowserOrderingRequirement = {
  kind: "ORDERING";

  /** Stable planner-owned identity; never inferred from runtime text. */
  requirementId: string;

  /** Human-readable audit context, not a runtime linkage key. */
  sourceClaim: string;

  /** Business ordering meaning, independent of any implementation field. */
  semanticDimension?:
    | "RECENCY"
    | "NUMERIC_MAGNITUDE"
    | "LEXICAL_ORDER";

  direction: "ASC" | "DESC";
  comparisonType:
    | "DATE_TIME"
    | "NUMERIC"
    | "LEXICAL";

  /** Optional collection grounding hint. Absence must fail safe at runtime. */
  collectionHint?: string;

  /**
   * Legacy/diagnostic field proposal. This is never proof authority by itself;
   * runtime comparison is gated by proofFieldBinding.
   */
  fieldHint?: string;

  /** Explicit authority-bearing (or candidate-only) proof-field proposal. */
  proofFieldBinding?: BrowserOrderingProofFieldBinding;

  /** Exact visible sort-option label associated with this requirement. */
  selectionHint?: string;
};

export type BrowserOrderingProofFieldBinding = {
  /** Stable identity derived from immutable requirement and proposal inputs. */
  bindingId: string;
  requirementId: string;
  semanticDimension:
    NonNullable<BrowserOrderingRequirement["semanticDimension"]>;
  proposedField: string;
  proposalSource:
    | "AC_EXPLICIT"
    | "IMPLEMENTATION_DERIVED"
    | "PLANNER_HEURISTIC";
  authority:
    | "AUTHORITATIVE"
    | "CANDIDATE";
  /** Bounded authoritative or implementation source reference, if known. */
  sourceRef?: string;
};

export type BrowserCollectionFilterPredicate =
  | "EXACT_TEXT"
  | "CASE_INSENSITIVE_CONTAINS";

export type BrowserCollectionFilterFieldScope =
  | {
      kind: "DURABLE_ROW_ID";
      authority: "AUTHORITATIVE" | "CANDIDATE";
      sourceRef?: string;
    }
  | {
      kind: "VISIBLE_FIELD";
      visibleLabel: string;
      proofFieldBinding: {
        bindingId: string;
        requirementId: string;
        proposedField: string;
        proposalSource:
          | "AC_EXPLICIT"
          | "IMPLEMENTATION_DERIVED"
          | "PLANNER_HEURISTIC";
        authority: "AUTHORITATIVE" | "CANDIDATE";
        sourceRef?: string;
      };
    }
  | {
      kind: "GLOBAL_VISIBLE_FIELDS";
      authority: "AUTHORITATIVE" | "CANDIDATE";
      sourceRef?: string;
    };

export type BrowserCollectionFilterProbe = {
  probeId: string;
  querySource:
    | "RUNTIME_ROW_ID"
    | "RUNTIME_VISIBLE_FIELD"
    | "GENERATED_NON_MATCHING";
  predicate: BrowserCollectionFilterPredicate;
  fieldScope: BrowserCollectionFilterFieldScope;
  expectation:
    | "MATCHING_ROW_INCLUDED"
    | "EMPTY_FILTER_RESULT";
  manualCheck: string;
};

export type BrowserCollectionFilterRequirement = {
  kind: "COLLECTION_FILTER";
  requirementId: string;
  sourceClaim: string;
  interactionKind: "TEXT_SEARCH";
  collectionHint?: string;
  controlSemantic: "SEARCH";
  authority: "AUTHORITATIVE" | "CANDIDATE";
  sourceRef?: string;
  controlManualCheck?: string;
  probes: BrowserCollectionFilterProbe[];
};

export type BrowserRequirementSourceRef = {
  sourceUnitId: string;
  sourceRef: string;
  sourceRole: "ACCEPTANCE";
};

/**
 * SOURCE_BACKED_LOCAL_STATE_TRANSITION_REQUIREMENT_V0
 *
 * One narrow, source-authorized reset contract. Jira owns the expected
 * behavior and value. Frontend source contributes binding metadata only.
 * Presence is a proof requirement, never proof or verdict authority.
 */
export type BrowserLocalControlStateTransitionRequirement = {
  kind:
    "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT";
  requirementId: string;
  obligationId: string;
  sourceRefs: BrowserRequirementSourceRef[];
  authority: {
    sourceRole: "ACCEPTANCE";
    proofAuthority: "ACCEPTANCE";
  };
  transition: {
    semantic:
      "RESET_RESTORES_DEFAULT";
    expectedValue: number;
    expectedValueAuthority:
      "JIRA_AUTHORIZED";
  };
  structuralBinding: {
    sourceEvidenceRefs: string[];
    valueBinding: {
      evidenceKind:
        "LABELLED_DEFAULT_PROPERTY";
      sourceLabel: string;
      sourceProperty: string;
    };
  };
};

export type BrowserAcceptanceScope = {
  requiresBehaviorProof: boolean;

  /**
   * Automated acceptance claims that need proof
   * beyond static visibility.
   *
   * These remain human-readable requirements,
   * not machine proof or matching keys.
   */
  behaviorClaims: string[];

  /**
   * Narrow machine-readable URL transition
   * requirements.
   *
   * Requirement presence does not imply
   * satisfaction.
   */
  urlTransitionRequirements?:
    UrlTransitionRequirement[];

  /**
   * Narrow machine-readable selected-state
   * requirements.
   *
   * Requirement presence does not imply
   * satisfaction.
   */
  selectedStateRequirements?:
    SelectedStateRequirement[];

  /**
   * GENERIC_BROWSER_ORDERING_EVIDENCE_V0
   *
   * Structured requirements only. Their presence does not imply proof and
   * ordering evidence is deliberately verdict-neutral in V0.
   */
  orderingRequirements?:
    BrowserOrderingRequirement[];

  /**
   * GROUNDED_SEARCH_FILTER_PROOF_V0
   *
   * Structured requirements only. Runtime interaction and deterministic
   * proof remain separate, and an oracle result does not decide the case.
   */
  collectionFilterRequirements?:
    BrowserCollectionFilterRequirement[];

  /** Source-authorized requirements only; runtime dispatch is separate. */
  localControlStateTransitionRequirements?:
    BrowserLocalControlStateTransitionRequirement[];
};

export type PlannerBrowserRouteResolutionCandidate = {
  route: string;
  confidence:
    | "high"
    | "medium"
    | "low";
  source: string;
  origin?: PlannerRouteEvidenceOrigin;
  authoritative?: boolean;
  routeEvidenceDisposition?:
    PlannerRouteEvidenceDisposition;
  sourceRef?: string;
  reason: string;
  evidence?: string[];
  groundingScore?: number;
  disposition:
    | "SELECTED"
    | "REJECTED";
  rejectionReason?: string;
  /** Source-derived UI identity used only for navigation corroboration. */
  surfaceIdentity?: SourceBackedSurfaceIdentity;
};

export type PlannerBrowserRouteResolution = {
  status:
    | "PRESERVED"
    | "VALIDATED"
    | "REPLACED"
    | "UNVERIFIED"
    | "RESOLVED"
    | "UNRESOLVED"
    | "AMBIGUOUS";
  originalRoute: string;
  selectedRoute?: string;
  confidence:
    | "high"
    | "medium"
    | "low"
    | "unassessed";
  totalCandidateCount: number;
  candidates:
    PlannerBrowserRouteResolutionCandidate[];
};

export type PlannerRouteEvidenceOrigin =
  | "JIRA_EXPLICIT_ROUTE"
  | "GITHUB_ROUTER_MAPPING"
  | "GITHUB_FRONTEND_ROUTE_LITERAL"
  | "UI_ROUTE_MANIFEST"
  | "UI_ROUTE_CATALOG"
  | "DETERMINISTIC_FEATURE_POLICY"
  | "PLANNER_LITERAL";

export type PlannerRouteEvidenceDisposition =
  | "CURRENT"
  | "NEGATED"
  | "LEGACY"
  | "REPLACED_FROM"
  | "AMBIGUOUS"
  | "RESOURCE_OR_API";

export type PlannerRouteEvidence = {
  route: string;
  origin: PlannerRouteEvidenceOrigin;
  sourceRef?: string;
  authoritative: boolean;
  disposition?: PlannerRouteEvidenceDisposition;
  reason?: string;
};

/**
 * Separates the exact obligations one execution unit may observe from the
 * authoritative scope required for a final verdict. This is transport and
 * policy input only; it never creates execution reach or proof authority.
 */
export type BrowserExecutionVerdictScope = {
  executionObligationIds: string[];
  verdictScopeObligationIds: string[];
  verdictAuthority: "INDEPENDENT" | "GROUP_ONLY";
};

/**
 * Immutable, source-authorized deterministic checks required by one bounded
 * execution unit. This is execution-contract transport only: it neither
 * discharges an acceptance obligation nor creates a final verdict.
 */
export type BrowserExecutionCheckContract = {
  schemaVersion: 1;
  caseId: string;
  executionObligationIds: string[];
  requiredChecks: BrowserExecutionCheckRequirement[];
  /**
   * Reserved for a future typed manual requirement representation. Free-form
   * planner manualChecks are deliberately not transported here.
   */
  requiredManualCheckIds: string[];
};

export type BrowserExecutionCheckRequirement =
  | {
      checkId: string;
      kind: "SOURCE_BOUND_ASSERTION_MEMBER";
      authority: "SOURCE_AUTHORIZED";
      requirementId: string;
      oracle: {
        oracleId: string;
        action:
          | "assertUrlContains"
          | "assertTextVisible"
          | "assertTextNotVisible"
          | "assertExactVisibleButton";
        expectedText: string;
      };
      sourceUnitIds: string[];
      sourceRefs: string[];
    }
  | {
      checkId: string;
      kind: "LOCAL_STATE_TRANSITION";
      authority: "SOURCE_AUTHORIZED";
      requirementId: string;
    }
  | {
      checkId: string;
      kind: "EVIDENCE_CONTRACT_BINDING";
      authority: "SOURCE_AUTHORIZED";
      bindingId: string;
      evidenceContractId: string;
    }
  | {
      checkId: string;
      kind: "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE";
      authority: "SOURCE_AUTHORIZED";
      requirementId: string;
      control: {
        semanticKind: "SEARCH_INPUT";
        cardinality: "AT_LEAST_ONE";
      };
      sourceUnitIds: string[];
      sourceRefs: string[];
    };

// One browser test
export type BrowserTestCase = {
  id: string;
  persona: "talent" | "company_admin" | "unauthenticated";
  goal: string;
  startRoute: string;
  successCriteria: string;
  /**
   * Legacy frozen-plan marker. New compiled plans use runtime prerequisite
   * contracts on normal browser cases instead of a separate execution lane.
   */
  executionPolicy?: { lane: "DISCOVERY_ONLY" };

  /**
   * Case-level acceptance coverage metadata.
   *
   * true means the declared automated scope includes
   * behavior that cannot be established by static
   * visibility alone.
   *
   * This describes a proof requirement only.
   * It does not claim that the proof was satisfied.
   */
  acceptanceScope?: BrowserAcceptanceScope;

  /**
   * Stable source-backed obligation identities allocated by deterministic
   * planner normalization. These IDs are accounting metadata, never proof.
   */
  acceptanceObligationIds?: string[];

  /**
   * Exact execution-versus-verdict authority attached by deterministic
   * materialization. Absent only for preserved legacy cases.
   */
  executionVerdictScope?: BrowserExecutionVerdictScope;

  /**
   * Deterministically derived before browser execution from typed source
   * authority only. Runtime evidence may read but never reconstruct it.
   */
  executionCheckContract?: BrowserExecutionCheckContract;

  /**
   * Immutable source-authorized WHAT for a bounded runtime binding attempt.
   * This transport has no proof, verdict, or execution-admission effect.
   */
  executionIntentAuthority?: BrowserExecutionIntentAuthority;

  /** Deterministic V1 traceability; optional for legacy preserved plans. */
  semanticVerdictContract?: {
    verdictGroupId: string;
    obligationIds: string[];
    sourceUnitIds: string[];
    relationship:
      PlannerAcceptanceVerdictRelationship;
    dependencyVerdictGroupIds: string[];
    disposition:
      | "AUTOMATED_ALLOCATED"
      | "ALLOCATED_MANUAL";
  };

  /**
   * Deterministic execution-shell lineage created by planner case transforms.
   * This preserves identity and required partition completeness; it grants no
   * acceptance, proof, or verdict authority.
   */
  plannerExecutionShell?: {
    sourceCaseId: string;
    partition: {
      mode: "ALL_REQUIRED";
      memberId: string;
      memberCount: number;
    };
  };

  /**
   * Deterministic planner-owned expansion lineage. This is transport metadata
   * only: it never grants acceptance, proof, or verdict authority. Raw model
   * proposals are normalized without this field; only validated source-backed
   * planner transforms may create it.
   */
  deterministicExecutionExpansion?:
    PlannerBrowserDeterministicExecutionExpansion;

  /**
   * V2 planner authorization for runtime fixture PREPARE. This is capability
   * metadata only: runtime bindings are deliberately absent until execution.
   */
  runtimeFixtureResolutionContract?:
    PlannerRuntimeFixtureResolutionContract;
  /**
   * Planning-only authority to resolve an interaction surface from a fresh
   * browser observation. This never asserts that the surface currently exists.
   */
  executionSurfacePrerequisiteContract?:
    PlannerExecutionSurfacePrerequisiteContract;
  runtimeTargetGroundingContract?:
    PlannerRuntimeTargetGroundingContract;
  runtimeNavigationResolutionContract?: PlannerRuntimeNavigationResolutionContract;
  composedRuntimeResolution?: PlannerComposedRuntimeResolutionLink;

  /**
   * Deterministic execution-only authority for revealing one existing detail
   * surface. The target phrase and disclosure semantic both originate in the
   * same authoritative source unit. Runtime must still ground one unique
   * visible target; this contract is neither proof nor verdict authority.
   */
  readOnlyDisclosureExecutionContract?:
    PlannerReadOnlyDisclosureExecutionContract;

  /**
   * Source-authorized planner bindings for deterministic evidence collection.
   * These bindings are planning metadata only: runtime must still perform a
   * fresh observation, and neither presence nor execution creates a verdict.
   */
  deterministicProofBindings?:
    PlannerBrowserDeterministicProofBinding[];

  /**
   * Deterministic planner route-selection provenance.
   * This metadata explains navigation grounding only and
   * cannot satisfy an oracle or affect a verdict.
   */
  routeResolution?:
    PlannerBrowserRouteResolution;

  /*
   * INVOICE_FIXTURE_POLICY_ENFORCEMENT_V1
   *
   * exact:
   *   The requested entity identity is part of
   *   the test oracle. Do not substitute another
   *   runtime record.
   *
   * compatible-state:
   *   A safe record in the same required runtime
   *   state may replace the candidate fixture.
   */
  runtimeFixturePolicy?:
    | "exact"
    | "compatible-state";

  /**
   * Deterministic source authority for runtime entity identity.
   * Runtime discovery can supply candidates, but only an explicit
   * authoritative source identity can authorize exact substitution
   * semantics.
   */
  fixtureIdentityAuthority?: {
    authority:
      | "EXPLICIT_SOURCE_IDENTITY"
      | "CANDIDATE_ONLY"
      | "NONE"
      | "SOURCE_UNAVAILABLE";
    entityKind: string;
    entityId?: string;
    sourceRef?: string;
    reason: string;
  };

  /**
   * Acceptance criteria that the runner and evidence reviewer
   * can verify automatically.
   */
  automatedChecks?: string[];

  /**
   * Unresolved acceptance criteria that require human
   * verification, unsupported interaction, external
   * verification, or an unavailable deterministic oracle.
   *
   * Automated checks may still succeed, but non-empty manual
   * acceptance coverage prevents a whole-case PASS until the
   * remaining acceptance requirements are resolved.
   */
  manualChecks?: string[];

  /**
   * Runtime records, lifecycle states, or permission fixtures
   * required before the case can execute.
   */
  fixtureRequirements?: string[];

  steps?: BrowserStep[];
};

export type PlannerAcceptanceSourceUnit = {
  id: string;
  sourceKind:
    | "ACCEPTANCE_CRITERIA"
    | "SUMMARY"
    | "DESCRIPTION";
  sourceRef: string;
  sectionHeading?: string;
  text: string;
};

export type PlannerAcceptanceSourceLedger = {
  sourceStatus:
    | "RESOLVED"
    | "UNAVAILABLE";
  basis:
    | "ACCEPTANCE_CRITERIA"
    | "SUMMARY_DESCRIPTION_FALLBACK"
    | "SOURCE_UNAVAILABLE";
  sourceUnits:
    PlannerAcceptanceSourceUnit[];
};

export type PlannerAcceptanceCoverageUnitAudit = {
  sourceUnitId: string;
  status:
    | "REPRESENTED"
    | "UNRESOLVED";
  matchedCaseIds: string[];
};

export type PlannerAcceptanceCoverageAudit = {
  status:
    | "COMPLETE"
    | "INCOMPLETE"
    | "SOURCE_UNAVAILABLE";
  sourceUnitCount: number;
  representedUnitCount: number;
  unresolvedUnitCount: number;
  units:
    PlannerAcceptanceCoverageUnitAudit[];
};

export type PlannerAcceptanceObligation = {
  id: string;
  sourceUnitIds: string[];
  sourceRole:
    | "ACCEPTANCE"
    | "EXPECTED_BEHAVIOR"
    | "TASK";
  derivation:
    | "DIRECT_ACCEPTANCE_FIELD"
    | "DIRECT_DESCRIPTION_SECTION"
    | "DIRECT_TASK_SECTION";
  text: string;
};

export type PlannerBrowserObligationSemanticFamily =
  | "SEARCH_FILTER"
  | "PAGINATION"
  | "GROUPED_CONTROLS"
  | "STATE_TRANSITION"
  | "LAYOUT_DIRECTION"
  | "SERVER_LIFECYCLE_NON_BROWSER"
  | "OTHER";

export type PlannerBrowserObligationBindingState =
  | "SUPPORTED_AND_BOUND"
  | "SUPPORTED_BUT_UNBOUND"
  | "UNSUPPORTED_AUTOMATION_SEMANTIC"
  | "UNALLOCATED_AUTHORITATIVE_OBLIGATION"
  | "AMBIGUOUS_CASE_ALLOCATION"
  | "MANUAL_BY_NATURE";

export type PlannerBrowserObligationBinding = {
  obligationId: string;
  sourceUnitIds: string[];
  semanticFamily:
    PlannerBrowserObligationSemanticFamily;
  state:
    PlannerBrowserObligationBindingState;
  allocatedCaseIds: string[];
  reason: string;
  missingAuthority?: string[];
  emittedRequirementIds?: string[];
};

export type PlannerAcceptanceObligationLedger = {
  sourceStatus:
    | "RESOLVED"
    | "UNAVAILABLE";
  derivationStatus:
    | "RESOLVED"
    | "NO_HIGH_CONFIDENCE_OBLIGATIONS"
    | "SOURCE_UNAVAILABLE";
  obligations:
    PlannerAcceptanceObligation[];
  unresolvedSourceUnitIds: string[];
};

/**
 * Source-authorized member dimensions retained before model-authored
 * candidate grouping. This is planning/accounting metadata only: it grants
 * no route, interaction, fixture, proof, or verdict authority.
 */
export type PlannerSourceDerivedObligationMemberLedger = {
  version: "V1";
  sourceStatus: "RESOLVED" | "UNAVAILABLE";
  memberSets: Array<{
    memberSetId: string;
    parentObligationId: string;
    sourceUnitRef: {
      sourceUnitId: string;
      sourceRef: string;
    };
    dimension: "TARGET" | "SURFACE" | "STATE" | "FIELD";
    policy: "ALL_REQUIRED";
    members: Array<{
      memberId: string;
      exactSourceText: string;
      canonicalMemberText: string;
      kind: "TARGET" | "SURFACE" | "STATE" | "FIELD";
      ordinal: number;
      required: true;
    }>;
  }>;
  obligationAudits: Array<{
    parentObligationId: string;
    status: "DECOMPOSED" | "UNDECOMPOSED";
    reason?:
      | "SOURCE_UNAVAILABLE"
      | "NO_EXPLICIT_MEMBER_STRUCTURE"
      | "AMBIGUOUS_MEMBER_STRUCTURE"
      | "DUPLICATE_MEMBER_IDENTITY"
      | "UNSUPPORTED_MEMBER_SHAPE";
  }>;
};

/**
 * Deterministic accounting of a candidate's structured target-surface claim
 * against already-authoritative source members. It is not execution, proof,
 * route, fixture, or verdict authority.
 */
export type PlannerSemanticMemberCoverageAudit = {
  version: "V1";
  invalidClaimRefs: Array<{
    candidateId: string;
    memberId: string;
  }>;
  candidateCoverage: Array<{
    candidateId: string;
    parentObligationId: string;
    sourceUnitRef: {
      sourceUnitId: string;
      sourceRef: string;
    };
    coveredMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    validlyClaimedMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    invalidClaimRefs: string[];
    disposition:
      | "EXACT_MEMBER_COVERAGE"
      | "MULTI_MEMBER_COVERAGE"
      | "PARENT_ONLY";
  }>;
  memberSetCensus: Array<{
    memberSetId: string;
    parentObligationId: string;
    requiredMemberCount: number;
    coveredMemberCount: number;
    deterministicallyCoveredMemberCount: number;
    validlyClaimedMemberCount: number;
    uncoveredMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    multiplyCoveredMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    claimedButNotDeterministicallyCoveredMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    multiplyClaimedMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
    ambiguousMemberRefs: Array<{
      memberSetId: string;
      memberId: string;
    }>;
  }>;
};

export type PlannerAcceptanceVerdictRelationship =
  | "ATOMIC"
  | "INDEPENDENT"
  | "DEPENDS_ON"
  | "UNKNOWN";

export type PlannerAcceptanceVerdictGroup = {
  verdictGroupId: string;
  obligationIds: string[];
  relationship:
    PlannerAcceptanceVerdictRelationship;
  dependencyVerdictGroupIds: string[];
  authority: {
    status:
      | "AUTHORITATIVE"
      | "CANDIDATE"
      | "UNRESOLVED";
    source:
      | "EXPLICIT_SOURCE"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
    sourceRefs: Array<{
      sourceUnitId: string;
      sourceRef: string;
    }>;
  };
  reason: string;
  accountingDisposition:
    | "ACCOUNTED"
    | "ACCOUNTED_FAIL_CLOSED"
    | "CANDIDATE_ONLY";
};

export type PlannerAcceptanceVerdictGrouping = {
  version: "V0";
  status:
    | "AUTHORITATIVE"
    | "CANDIDATE_ONLY"
    | "UNKNOWN"
    | "EMPTY";
  groups:
    PlannerAcceptanceVerdictGroup[];
  candidateGroups:
    PlannerAcceptanceVerdictGroup[];
  accounting: {
    status: "COMPLETE" | "INCOMPLETE";
    authoritativeObligationCount: number;
    accountedObligationIds: string[];
    unaccountedObligationIds: string[];
    invalidProposalCount: number;
  };
};

export type PlannerBrowserSemanticMutationClass =
  | "READ_ONLY"
  | "TRANSIENT_REVERSIBLE"
  | "PERSISTENT_BROWSER"
  | "API_MUTATION"
  | "EXTERNAL_LIFECYCLE"
  | "MANUAL"
  | "UNKNOWN";

export type PlannerReadOnlyDisclosureExecutionContract = {
  schemaVersion: 1;
  contractId: string;
  kind: "SOURCE_BACKED_EXISTING_DETAIL_DISCLOSURE";
  authority: "SOURCE_AUTHORIZED";
  obligationId: string;
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  interaction: {
    action: "clickText";
    targetText: string;
    interactionId?: string;
    targetIdentity: "EXACT_SOURCE_PHRASE";
    runtimeGroundingPolicy: "UNIQUE_EXACT_VISIBLE_TARGET";
  };
  consequence: "TRANSIENT_DETAIL_REVEAL_ONLY";
  proofAuthority: "NONE";
};

export type PlannerBrowserSemanticCandidate = {
  candidateId: string;
  proposedCaseId: string;
  obligationIds: string[];
  sourceUnitIds: string[];
  proposedBehavior: string;
  proposedPersona?:
    | "company_admin"
    | "talent"
    | "unknown";
  proposedTargetSurface?: string;
  proposedMutationClass?:
    PlannerBrowserSemanticMutationClass;
  proposedChecks: Array<{
    text: string;
    obligationIds: string[];
    proposedRole:
      | "ACCEPTANCE_PROOF"
      | "SUPPLEMENTAL_SANITY"
      | "PRECONDITION"
      | "STRUCTURAL_SUPPORT";
  }>;
  proposedFixtureNeeds: Array<{
    text: string;
    obligationIds: string[];
  }>;
  proposedRelationshipHints: Array<{
    relationship:
      PlannerAcceptanceVerdictRelationship;
    obligationIds: string[];
    dependsOnObligationIds: string[];
    reason: string;
  }>;
  /**
   * Model claims validated against the source-derived member ledger. They are
   * candidate metadata only and never become source, execution, or proof authority.
   */
  validatedSourceMemberCoverageClaims?: Array<{
    memberId: string;
    provenance: "VALIDATED_MODEL_MEMBER_CLAIM";
  }>;
  /** Rejected model-supplied IDs retained only for coverage diagnostics. */
  invalidSourceMemberCoverageClaimIds?: string[];
  /** Planner-owned semantic specialization; never authored by the model. */
  sourceMemberSemanticSpecialization?: {
    schemaVersion: 1;
    kind: "SOURCE_MEMBER_SEMANTIC_SPECIALIZATION_V1";
    parentCandidateId: string;
    parentCaseId: string;
    memberSetId: string;
    memberId: string;
    sourceUnitRef: {
      sourceUnitId: string;
      sourceRef: string;
    };
    exactSourceText: string;
    canonicalMemberText: string;
    authority: "SOURCE_AUTHORIZED";
  };
  /** Planner-owned lineage for a source-backed derived execution member. */
  deterministicExecutionExpansion?:
    PlannerBrowserDeterministicExecutionExpansion;
  authority: "CANDIDATE";
};

/**
 * Generic deterministic execution expansion provenance. The authority is
 * carried from an existing source-backed obligation; it is never inferred
 * from candidate wording or used as acceptance proof.
 */
export type PlannerBrowserDeterministicExecutionExpansion = {
  schemaVersion: 1;
  kind: "SOURCE_BACKED_ATOMIC_MEMBER";
  parentCandidateId: string;
  parentCaseId: string;
  memberId: string;
  memberCount: number;
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  authority: "SOURCE_AUTHORIZED";
};

export type PlannerBrowserSemanticIr = {
  version: "V1";
  status:
    | "ACTIVE"
    | "LEGACY_INPUT"
    | "NO_GROUNDED_CANDIDATES";
  candidates: PlannerBrowserSemanticCandidate[];
  rejectedCandidates: Array<{
    candidateId: string;
    reason:
      | "MALFORMED"
      | "UNKNOWN_OBLIGATION"
      | "SOURCE_ANCHOR_MISMATCH"
      | "MISSING_CASE_CANDIDATE"
      | "DUPLICATE_CANDIDATE";
  }>;
};

export type PlannerBrowserProofCapability = {
  obligationId: string;
  state:
    | "SUPPORTED_AND_BOUND"
    | "SUPPORTED_BUT_UNBOUND"
    | "UNSUPPORTED_AUTOMATION_SEMANTIC"
    | "MANUAL_BY_NATURE"
    | "UNKNOWN";
  requirementIds: string[];
  reason: string;
  /** Exact, source-backed bindings; absence never permits runtime inference. */
  bindings?: PlannerBrowserDeterministicProofBinding[];
};

type PlannerBrowserDeterministicProofBindingBase = {
  schemaVersion: 1;
  bindingId: string;
  evidenceContractId: string;
  obligationId: string;
  executionCaseId: string;
  authority: "SOURCE_AUTHORIZED";
  runtimePreconditions: {
    persona: "company_admin" | "talent";
    route: string;
    requiresRuntimeFixtureBinding: boolean;
  };
  acceptanceCoverage: {
    policy: "ALL_REQUIRED";
    requiredMemberIds: string[];
    plannedMemberIds: string[];
    memberId: string;
  };
};

export type PlannerBrowserDeterministicProofBinding =
  | (PlannerBrowserDeterministicProofBindingBase & {
  capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE";
  assertion: {
    action: "assertTextVisible";
    oracleId: string;
    expectedText: string;
    sourceUnitId: string;
    sourceRef: string;
  };
  surface: {
    kind: "EXPANDED_DETAIL_SURFACE";
    sourceUnitId: string;
    sourceRef: string;
  };
})
  | (PlannerBrowserDeterministicProofBindingBase & {
  /** GENERIC_SEARCH_INPUT_PRESENCE_PROOF_V1 */
  capabilityKind: "SEARCH_INPUT_PRESENT";
  prerequisite: {
    kind: "SEARCH_INPUT";
    prerequisiteId: string;
    sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
    selectionPolicy: "UNIQUE_GROUNDED_CONTROL_ONLY";
    ambiguityPolicy: "BLOCK_SURFACE_UNAVAILABLE";
    surfacePartitionId: string;
  };
});

export type PlannerBrowserGroupDisposition =
  | "AUTOMATED_ALLOCATED"
  | "ALLOCATED_MANUAL"
  | "MANUAL_BY_NATURE"
  | "POLICY_BLOCKED"
  | "UNSUPPORTED_AUTOMATION"
  | "TARGET_UNRESOLVED"
  | "RUNTIME_TARGET_GROUNDING_REQUIRED"
  | "FIXTURE_UNAVAILABLE"
  | "UNALLOCATED_BUDGET"
  | "UNKNOWN_GROUPING"
  | "CANDIDATE_UNAVAILABLE";

export type PlannerBrowserVerdictContract = {
  verdictGroupId: string;
  obligationIds: string[];
  sourceUnitIds: string[];
  relationship:
    PlannerAcceptanceVerdictRelationship;
  relationshipAuthority:
    "AUTHORITATIVE" | "UNRESOLVED";
  dependencyVerdictGroupIds: string[];
  candidateIds: string[];
  disposition:
    PlannerBrowserGroupDisposition;
  allocatedCaseId?: string;
  mutationClass:
    PlannerBrowserSemanticMutationClass;
  proofCapabilities:
    PlannerBrowserProofCapability[];
  acceptanceChecks: Array<{
    text: string;
    obligationIds: string[];
    role:
      | "ACCEPTANCE_PROOF"
      | "SUPPLEMENTAL_SANITY"
      | "PRECONDITION"
      | "STRUCTURAL_SUPPORT";
    authority:
      | "SOURCE_AUTHORIZED"
      | "CANDIDATE_ONLY";
  }>;
  target: {
    status:
      | "AUTHORITATIVE"
      | "CANDIDATE"
      | "UNRESOLVED"
      | "CONFLICT";
    route?: string;
    surface?: string;
    sourceRef?: string;
    basis:
      | "SOURCE_ROUTE"
      | "ROUTE_MANIFEST"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
  };
  persona: {
    status:
      | "AUTHORITATIVE"
      | "CANDIDATE"
      | "UNRESOLVED"
      | "CONFLICT";
    value?: "company_admin" | "talent";
    basis:
      | "SOURCE_ACTOR"
      | "PERSONA_SURFACE_BINDING"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
  };
  fixture: {
    status:
      | "READY"
      | "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
      | "UNKNOWN"
      | "UNAVAILABLE"
      | "POLICY_BLOCKED";
    requirements: Array<{
      text: string;
      obligationIds: string[];
      authority:
        | "SOURCE_AUTHORIZED"
        | "CANDIDATE_ONLY";
    }>;
    reason: string;
  };
  reason: string;
};

export type PlannerInvoiceAcceptanceFixtureConstraint = {
  executionCaseId: string;
  sourceCaseId: string;
  partition: {
    mode: "ALL_REQUIRED";
    memberId: string;
    memberCount: number;
  };
  fixtureKind: "invoice";
  semantic: {
    kind: "STATE";
    state: "processed" | "sent-for-processing";
  };
  obligationIds: string[];
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  identityPolicy: "exact" | "compatible-state";
  authority: "SOURCE_AUTHORIZED";
};

export type PlannerTalentContractFixturePredicateKey =
  | "contract.accessibleToOwner"
  | "contract.hasWorkSetups"
  | "contract.documentMetadataPresent"
  | "contract.workAuthorizationSnapshotPresent"
  | "compliance.COMPLIANCE_DOCUMENT.present"
  | "compliance.COMPLIANCE_DOCUMENT.signed"
  | "compliance.COMPLIANCE_DOCUMENT.signedAtPresent"
  | "compliance.COMPLIANCE_DOCUMENT.agreementVersionPresent"
  | "compliance.COMPLIANCE_DOCUMENT.signatureValuePresent"
  | "compliance.MASTER_SERVICE_AGREEMENT.present"
  | "compliance.MASTER_SERVICE_AGREEMENT.signed"
  | "compliance.MASTER_SERVICE_AGREEMENT.signedAtPresent"
  | "compliance.MASTER_SERVICE_AGREEMENT.agreementVersionPresent"
  | "compliance.MASTER_SERVICE_AGREEMENT.signatureValuePresent"
  | "compliance.BACKGROUND_CHECK.present"
  | "compliance.BACKGROUND_CHECK.statusPresent"
  | "compliance.BACKGROUND_CHECK.issueDatePresent"
  | "compliance.WORK_AUTHORIZATION.present"
  | "compliance.TROLLEY_ONBOARDING_SETUP.present"
  | "compliance.TROLLEY_ONBOARDING_SETUP.statusPresent"
  | "compliance.DEEL_ONBOARDING_SETUP.present"
  | "compliance.DEEL_ONBOARDING_SETUP.statusPresent"
  | "compliance.setup.anyCompleted";

export type PlannerTalentContractFixturePredicate = {
  key: PlannerTalentContractFixturePredicateKey;
  expected: boolean;
  obligationIds: string[];
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  authority: "SOURCE_AUTHORIZED";
};

export type PlannerTalentContractAcceptanceFixtureConstraint = {
  constraintId: string;
  executionCaseId: string;
  sourceCaseId: string;
  partition: {
    mode: "ALL_REQUIRED";
    memberId: string;
    memberCount: number;
  };
  fixtureKind: "talent-contract";
  semantic: {
    kind: "PREDICATES";
    predicates: PlannerTalentContractFixturePredicate[];
  };
  obligationIds: string[];
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  identityPolicy: "exact" | "compatible-state";
  exactEntityId?: string;
  authority: "SOURCE_AUTHORIZED";
};

export type PlannerAcceptanceFixtureConstraint =
  | PlannerInvoiceAcceptanceFixtureConstraint
  | PlannerTalentContractAcceptanceFixtureConstraint;

/**
 * Source-authorized identity for the bounded invoice runtime capability.
 * This identifies the permitted capability and required source states only;
 * interaction steps remain planner/runtime guidance.
 */
export type PlannerSourceInvoiceExecutionCapability = {
  kind: "INVOICE_RUNTIME_FIXTURE";
  authority: "SOURCE_AUTHORIZED";
  obligationIds: string[];
  sourceUnitIds: string[];
  requiredStates: Array<"processed" | "sent-for-processing">;
  targetScope: "INVOICE_DETAILS_DRAWER";
  resolverRef: "browser-visible-invoice-row";
  supportedPersona: "company_admin";
};

export type PlannerInvoiceFixtureResolutionCapability = {
  executionCaseId: string;
  fixtureKind: "invoice";
  resolverRef: "browser-visible-invoice-row";
  classification: "READ_ONLY_DISCOVERY";
  persona: "company_admin";
  supportedState: "processed" | "sent-for-processing";
  identityPolicy: "compatible-state";
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY";
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE";
  provenance: {
    module: "src/agents/browser/browser-entity-interaction.ts";
    exportName: "resolveAndOpenInvoiceRow";
  };
};

export type PlannerTalentContractFixtureResolutionCapability = {
  capabilityId: string;
  executionCaseId: string;
  fixtureKind: "talent-contract";
  resolverRef: "talent-contract-detail-readonly-v1";
  classification: "AUTHENTICATED_READ_ONLY_DISCOVERY";
  persona: "talent";
  supportedPredicates: PlannerTalentContractFixturePredicateKey[];
  identityPolicy: "exact" | "compatible-state";
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY";
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE";
  identityVerification: "REQUIRED";
  ownershipVerification: "REQUIRED";
  provenance: {
    module: "src/agents/browser/fixtures/verified-contract-fixture-state.ts";
    exportName: "selectVerifiedContractFixtureCandidate";
  };
};

export type PlannerFixtureResolutionCapability =
  | PlannerInvoiceFixtureResolutionCapability
  | PlannerTalentContractFixtureResolutionCapability;

/** Execution-time output only. Planner code must never manufacture this. */
export type RuntimeInvoiceFixtureBinding = {
  status: "RESOLVED";
  executionCaseId: string;
  fixtureKind: "invoice";
  fixtureIdentityRef: string;
  verifiedState: "processed" | "sent-for-processing";
  ownerPersonaRef: "company_admin";
  resolverProvenance: {
    resolverRef: "browser-visible-invoice-row";
    evidenceRef: string;
  };
  identityPolicy:
    | "exact"
    | "compatible-state";
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY";
  verifiedAt: string;
};

export type RuntimeTalentContractFixtureBinding = {
  status: "RESOLVED";
  executionCaseId: string;
  fixtureKind: "talent-contract";
  fixtureContractId: string;
  fixtureIdentityRef: string;
  /** Invoice-only compatibility field; never populated for talent contracts. */
  verifiedState?: never;
  ownerPersonaRef: "talent";
  ownerIdentityRef: string;
  identityPolicy: "exact" | "compatible-state";
  ownershipVerification: "VERIFIED";
  predicateVerification: "VERIFIED";
  verifiedPredicates: Array<{
    key: PlannerTalentContractFixturePredicateKey;
    expected: boolean;
  }>;
  selectionPolicy:
    | "UNIQUE_COMPATIBLE_ONLY"
    | "CANONICAL_EQUIVALENT_COMPATIBLE_REPRESENTATIVE";
  resolverProvenance: {
    resolverRef: "talent-contract-detail-readonly-v1";
    evidenceRef: string;
  };
  verifiedAt: string;
};

export type RuntimeFixtureBinding =
  | RuntimeInvoiceFixtureBinding
  | RuntimeTalentContractFixtureBinding;

export type PlannerRuntimeFixtureResolutionMember = {
  executionCaseId: string;
  required: boolean;
  acceptanceFixtureConstraint?: PlannerAcceptanceFixtureConstraint;
  fixtureResolutionCapability?: PlannerFixtureResolutionCapability;
  unavailableReason?: string;
  runtimeFixtureBinding:
    | "NOT_YET_RESOLVED"
    | RuntimeFixtureBinding;
};

export type PlannerRuntimeFixtureResolutionContract = {
  fixtureContractId?: string;
  status:
    | "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
    | "UNAVAILABLE";
  policy: "ALL_REQUIRED";
  members: PlannerRuntimeFixtureResolutionMember[];
  /**
   * Planning-only coverage partition. `plannedMemberIds` describes what the
   * authored execution unit can attempt; `requiredMemberIds` remains the
   * source-backed parent acceptance set. Neither list is proof or a verdict.
   */
  acceptanceCoverage?:
    | {
        kind: "INVOICE_STATE";
        policy: "ALL_REQUIRED";
        requiredMemberIds: Array<
          "processed" | "sent-for-processing"
        >;
        plannedMemberIds: Array<
          "processed" | "sent-for-processing"
        >;
      }
    | {
        kind: "TALENT_CONTRACT_PREDICATES";
        policy: "ALL_REQUIRED";
        requiredPredicateKeys:
          PlannerTalentContractFixturePredicateKey[];
        plannedPredicateKeys:
          PlannerTalentContractFixturePredicateKey[];
      };
  interactionExecutionCaseId?: string;
  fixtureReadyForInteraction: false;
};

export type PlannerExecutionSurfacePrerequisiteKind =
  | "SEARCH_INPUT"
  | "TAB_OR_FILTER_CONTROL";

/**
 * Deferred, planning-time authorization to look for one uniquely grounded UI
 * prerequisite. It carries execution readiness only, never acceptance proof.
 */
export type PlannerExecutionSurfacePrerequisiteContract = {
  schemaVersion: 1;
  prerequisiteId: string;
  status: "SURFACE_RUNTIME_RESOLUTION_REQUIRED";
  kind: PlannerExecutionSurfacePrerequisiteKind;
  authority: "SOURCE_AUTHORIZED";
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  surfacePartition: {
    partitionId: string;
    verdictGroupId: string;
    obligationId: string;
    memberId: string;
    surface: string;
  };
  executionContext: {
    executionContainerId: string;
    semanticCandidateId: string;
    executionCaseId: string;
    route: string;
    persona: "company_admin" | "talent";
  };
  acceptanceCoverage: {
    policy: "ALL_REQUIRED";
    requiredMemberIds: string[];
    plannedMemberIds: string[];
    memberId: string;
  };
  selectionPolicy:
    | "UNIQUE_GROUNDED_CONTROL_ONLY"
    | "GROUNDED_CONTROL_SURFACE_PRESENT";
  ambiguityPolicy:
    | "BLOCK_SURFACE_UNAVAILABLE"
    | "ALLOW_MULTIPLE_GROUNDED_CONTROLS";
  runtimeBinding: "NOT_YET_RESOLVED";
  surfaceReadyForInteraction: false;
};

export type PlannerRuntimeTargetInteractionClass =
  | "OBSERVE"
  | "ASSERT_VISIBLE"
  | "INTERNAL_NAVIGATION"
  | "TRANSIENT_REVEAL"
  | "EXISTING_SEMANTIC_OPTION_SELECTION";

/**
 * Deterministic authority envelope for resolving an exact in-page target from
 * a fresh browser observation. Runtime proposals never alter this authority.
 */
export type PlannerRuntimeTargetGroundingContract = {
  schemaVersion: 1;
  contractId: string;
  status: "RUNTIME_TARGET_GROUNDING_REQUIRED";
  authority: "SOURCE_AUTHORIZED";
  obligationIds: string[];
  sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
  coarseEnvelope: {
    routeKind: "STATIC" | "PARAMETERIZED";
    route: string;
    routeAuthority: "SOURCE_ROUTE" | "UI_ROUTE_MANIFEST";
    routeSourceRefs: string[];
    /** Exact authoritative obligation text; never a model-authored target. */
    sourceSurface: string;
  };
  persona: {
    value: "company_admin" | "talent";
    authority: "SOURCE_ACTOR" | "ROUTE_ENVELOPE";
  };
  fixtureRequirements: Array<{
    text: string;
    obligationIds: string[];
    authority: "SOURCE_AUTHORIZED";
  }>;
  allowedInteractionClasses: PlannerRuntimeTargetInteractionClass[];
  forbiddenConsequenceClasses: Array<
    | "PERSISTED_OR_CONSEQUENTIAL_CHANGE"
    | "UNKNOWN_CONSEQUENCE"
    | "EXTERNAL_NAVIGATION"
  >;
  proofExpectations: Array<{
    obligationId: string;
    capabilityState: PlannerBrowserProofCapability["state"];
    proofAuthority: "DETERMINISTIC_ONLY" | "NONE";
  }>;
  selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY";
  ambiguityPolicy: "NO_SAFE_ACTION";
  unavailablePolicy: "BLOCK_TARGET_GROUNDING_UNAVAILABLE";
  runtimeBinding: "NOT_YET_RESOLVED";
  targetReadyForInteraction: false;
};

/**
 * Planner-time capability metadata for one authoritative parameterized route.
 * The concrete runtime identity and route deliberately remain absent here.
 */
export type PlannerRuntimeNavigationResolutionContract = {
  capabilityId: string;
  status: "RUNTIME_NAVIGATION_RESOLUTION_REQUIRED";
  template: string;
  templateSourceOrigin: "UI_ROUTE_MANIFEST";
  templateSourceRef?: string;
  persona: "company_admin" | "talent";
  parameters: Array<{
    param: string;
    entityKind: string;
  }>;
  resolverRef: "talent-contract-detail-readonly-v1";
  resolverClassification: "AUTHENTICATED_READ_ONLY_DISCOVERY";
  resolverProvenance: {
    module: "src/agents/browser/browser-route-talent-contract.ts";
    exportName: "resolveTalentContractDetailRoute";
  };
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY";
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE";
  identityVerification: "REQUIRED";
  ownershipVerification: "REQUIRED";
  stateVerification: "WHEN_REQUIRED";
  runtimeIdentity: "NOT_YET_RESOLVED";
  navigationReadyForExecution: false;
};

/** Execution-time output only. Planner code must never manufacture this. */
export type RuntimeNavigationBinding = {
  status: "RESOLVED";
  navigationReadyForExecution: true;
  executionCaseId: string;
  template: string;
  concreteRoute: string;
  selectedIdentityReferences: Array<{
    param: string;
    entityKind: string;
    identityRef: string;
    source:
      | "AUTHENTICATED_GET"
      | "DETERMINISTIC_FIXTURE"
      | "GROUNDED_PAGE"
      | "CANONICAL_RUNTIME_FIXTURE";
  }>;
  persona: "company_admin" | "talent";
  resolverRef: PlannerRuntimeNavigationResolutionContract["resolverRef"];
  ownershipVerification: "VERIFIED" | "NOT_REQUIRED";
  stateVerification: "VERIFIED" | "NOT_REQUIRED";
  resolvedAt: string;
  evidenceReference: string;
};

/** Planning-only linkage. Both bindings must derive from one runtime selection. */
export type PlannerComposedRuntimeResolutionLink = {
  schemaVersion: 1;
  linkId: string;
  executionContainerId: string;
  executionCaseId: string;
  navigationCapabilityId: string;
  fixtureCapabilityId: string;
  fixtureContractId: string;
  fixtureConstraintId: string;
  entityKind: "contract";
  resolverRef: "talent-contract-detail-readonly-v1";
  persona: "talent";
  identityPolicy: "exact" | "compatible-state";
  exactEntityId?: string;
  sourceUnitRefs: Array<{ sourceUnitId: string; sourceRef: string }>;
  runtimeIdentity: "NOT_YET_RESOLVED";
  runtimeReadyForInteraction: false;
};

export type PlannerBrowserEvidenceContractDisposition =
  | "PLANNED"
  | "RUNTIME_TARGET_GROUNDING_REQUIRED"
  | "SURFACE_RUNTIME_RESOLUTION_REQUIRED"
  | "COMPOSED_RUNTIME_RESOLUTION_REQUIRED"
  | "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
  | "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED"
  | "TARGET_UNRESOLVED"
  | "NAVIGATION_UNRESOLVED"
  | "SESSION_UNRESOLVED"
  | "ACTOR_CONSTRAINT_UNRESOLVED"
  | "PERSONA_UNRESOLVED"
  | "ROUTE_UNRESOLVED"
  | "FIXTURE_UNAVAILABLE"
  | "POLICY_BLOCKED"
  | "CANDIDATE_UNAVAILABLE"
  | "UNALLOCATED_BUDGET";

/**
 * Planner-only authority to seek evidence for exactly one authoritative
 * obligation. This is neither an evidence result nor a verdict.
 */
export type PlannerBrowserEvidenceContract = {
  evidenceContractId: string;
  obligationId: string;
  verdictGroupId: string;
  semanticCandidateId: string;
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  executionContainerId?: string;
  targetConstraint?: PlannerBrowserExecutionContainer["target"]["constraint"]["obligations"][number];
  actorConstraint?: PlannerBrowserExecutionContainer["acceptanceActorConstraint"]["obligations"][number];
  routeConstraint?: PlannerBrowserExecutionContainer["acceptanceRouteConstraint"]["obligations"][number];
  proofCapability: PlannerBrowserProofCapability;
  disposition: PlannerBrowserEvidenceContractDisposition;
  reason: string;
};

export type PlannerBrowserExecutionContainer = {
  executionContainerId: string;
  evidenceContractIds: string[];
  semanticCandidateId: string;
  sourceCaseId: string;
  executionCaseIds: string[];
  requiredExecutionCaseIds: string[];
  target: {
    sourceScope: {
      status: "AUTHORITATIVE" | "UNRESOLVED";
      /** Exact authoritative obligation text, never a model-authored label. */
      surface?: string;
      basis: "SOURCE_OBLIGATION" | "UNAVAILABLE";
      sourceUnitRefs?: Array<{
        sourceUnitId: string;
        sourceRef: string;
      }>;
    };
    /** Preserved for diagnostics only; this value carries no authority. */
    candidateSurface?: string;
    constraint: {
      status: "COMPATIBLE" | "UNRESOLVED";
      policy: "ALL_REQUIRED";
      basis:
        | "SOURCE_ANCHOR_MATCH"
        | "SOURCE_SCOPE_UNRESOLVED"
        | "CANDIDATE_SURFACE_UNAVAILABLE"
        | "INSUFFICIENT_SOURCE_ANCHORS"
        | "NO_STRONG_SOURCE_ANCHOR_MATCH";
      obligations: Array<{
        obligationId: string;
        status: "COMPATIBLE" | "UNRESOLVED";
        basis:
          | "SOURCE_ANCHOR_MATCH"
          | "SOURCE_SCOPE_UNRESOLVED"
          | "CANDIDATE_SURFACE_UNAVAILABLE"
          | "INSUFFICIENT_SOURCE_ANCHORS"
          | "NO_STRONG_SOURCE_ANCHOR_MATCH";
        sourceAnchors: string[];
        candidateAnchors: string[];
        matchedAnchors: string[];
        sourceUnitRefs: Array<{
          sourceUnitId: string;
          sourceRef: string;
        }>;
      }>;
    };
  };
  acceptanceActorConstraint: {
    status: "NONE" | "PRESENT" | "UNRESOLVED";
    policy: "ALL_REQUIRED";
    obligations: Array<{
      obligationId: string;
      status: "NONE" | "PRESENT" | "UNRESOLVED";
      basis:
        | "NO_SOURCE_CONSTRAINT"
        | "SOURCE_ACTOR"
        | "SOURCE_PERMISSION"
        | "SOURCE_SCOPE_UNRESOLVED";
      actor?: "company_admin" | "talent";
      requiredPermissionText?: string;
      sourceUnitRefs: Array<{
        sourceUnitId: string;
        sourceRef: string;
      }>;
    }>;
  };
  acceptanceRouteConstraint: {
    status: "NONE" | "PRESENT" | "UNRESOLVED";
    policy: "ALL_REQUIRED";
    obligations: Array<{
      obligationId: string;
      status: "NONE" | "PRESENT" | "UNRESOLVED";
      basis:
        | "NO_SOURCE_CONSTRAINT"
        | "SOURCE_ROUTE"
        | "SOURCE_SCOPE_UNRESOLVED";
      route?: string;
      sourceUnitRefs: Array<{
        sourceUnitId: string;
        sourceRef: string;
      }>;
    }>;
  };
  executionNavigationBinding: {
    status: "BOUND" | "CANDIDATE" | "UNRESOLVED";
    route?: string;
    persona?: "company_admin" | "talent";
    basis:
      | "SOURCE_ROUTE"
      | "UI_ROUTE_MANIFEST"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
    sourceRefs?: string[];
  };
  runtimeNavigationResolution?:
    PlannerRuntimeNavigationResolutionContract;
  composedRuntimeResolution?: PlannerComposedRuntimeResolutionLink;
  executionSessionBinding: {
    status: "BOUND" | "CANDIDATE" | "UNRESOLVED";
    persona?: "company_admin" | "talent";
    basis:
      | "RUNTIME_SESSION_CONFIG"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
    personaSource?:
      | "STATIC_NAVIGATION_BINDING"
      | "PARAMETERIZED_RUNTIME_NAVIGATION_CAPABILITY";
  };
  actorCompatibility: {
    status:
      | "NO_CONSTRAINT"
      | "SATISFIED"
      | "UNSATISFIED"
      | "UNRESOLVED";
    policy: "ALL_REQUIRED";
    obligations: Array<{
      obligationId: string;
      status:
        | "NO_CONSTRAINT"
        | "SATISFIED"
        | "UNSATISFIED"
        | "UNRESOLVED";
      reason: string;
    }>;
  };
  route: {
    status:
      | "AUTHORITATIVE"
      | "CANDIDATE"
      | "UNRESOLVED"
      | "CONFLICT";
    value?: string;
    basis:
      | "SOURCE_ROUTE"
      | "ROUTE_MANIFEST"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
    sourceRef?: string;
  };
  persona: {
    status:
      | "AUTHORITATIVE"
      | "CANDIDATE"
      | "UNRESOLVED"
      | "CONFLICT";
    value?: "company_admin" | "talent";
    basis:
      | "SOURCE_ACTOR"
      | "PERSONA_SURFACE_BINDING"
      | "PLANNER_CANDIDATE"
      | "UNAVAILABLE";
    sourceUnitRefs?: Array<{
      sourceUnitId: string;
      sourceRef: string;
    }>;
  };
  fixture: PlannerBrowserVerdictContract["fixture"];
  runtimeFixtureResolution?:
    PlannerRuntimeFixtureResolutionContract;
  executionSurfacePrerequisite?:
    PlannerExecutionSurfacePrerequisiteContract;
  runtimeTargetGrounding?:
    PlannerRuntimeTargetGroundingContract;
  mutationClass: PlannerBrowserSemanticMutationClass;
  readiness:
    | "READY"
    | "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
    | "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
    | "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION"
    | "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING"
    | "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED"
    | "TARGET_UNRESOLVED"
    | "NAVIGATION_UNRESOLVED"
    | "SESSION_UNRESOLVED"
    | "ACTOR_CONSTRAINT_UNRESOLVED"
    | "PERSONA_UNRESOLVED"
    | "ROUTE_UNRESOLVED"
    | "FIXTURE_UNAVAILABLE"
    | "POLICY_BLOCKED"
    | "CANDIDATE_UNAVAILABLE"
    | "UNALLOCATED_BUDGET";
  /** Independent, non-authoritative admission for bounded runtime discovery. */
  discoveryAdmission?: {
    status: "ELIGIBLE";
    reason: string;
  };
  reason: string;
};

/**
 * Planning-only partition for one atomic obligation that explicitly names
 * multiple UI page surfaces. Member identity comes from authoritative source
 * text; candidate text may only bind an execution shell to an existing member.
 * This metadata is neither proof nor verdict authority.
 */
export type PlannerSourceBackedAtomicSurfacePartition = {
  partitionId: string;
  verdictGroupId: string;
  obligationId: string;
  authority: "SOURCE_AUTHORIZED";
  policy: "ALL_REQUIRED";
  status:
    | "VALIDATED"
    | "INCOMPLETE"
    | "AMBIGUOUS"
    | "REJECTED";
  sourceUnitRefs: Array<{
    sourceUnitId: string;
    sourceRef: string;
  }>;
  requiredMemberIds: string[];
  plannedMemberIds: string[];
  members: Array<{
    memberId: string;
    surface: string;
    semanticCandidateId?: string;
    executionContainerId?: string;
    executionCaseIds: string[];
    executionReadiness?: PlannerBrowserExecutionContainer["readiness"];
    status:
      | "EXECUTION_ELIGIBLE"
      | "EXECUTION_BLOCKED"
      | "BINDING_UNRESOLVED";
    reason: string;
  }>;
  rejectedCandidateIds: string[];
  reason: string;
};

export type PlannerBrowserObligationEvidenceAccounting = {
  obligationId: string;
  disposition:
    | "EVIDENCE_CONTRACT_ALLOCATED"
    | "MANUAL"
    | "UNSUPPORTED_AUTOMATION"
    | "BLOCKED"
    | "UNALLOCATED"
    | "UNRESOLVED";
  evidenceContractIds: string[];
  reason: string;
};

export type PlannerBrowserSemanticPlanningAudit = {
  version: "V1" | "V2";
  status:
    | "APPLIED"
    | "LEGACY_COMPATIBILITY"
    | "FAIL_CLOSED";
  authoritativeObligationCount: number;
  accountedObligationIds: string[];
  unaccountedObligationIds: string[];
  verdictGroupCount: number;
  authoritativeGroupCount: number;
  unknownGroupCount: number;
  allocatedCaseCount: number;
  ticketManualObligationIds: string[];
  policyBlockedObligationIds: string[];
  unsupportedObligationIds: string[];
  targetUnresolvedObligationIds: string[];
  /** Exact target is deferred within an already-authorized coarse envelope. */
  runtimeTargetGroundingRequiredObligationIds?: string[];
  /** Additive V2 execution-binding diagnostics; absent from legacy plans. */
  navigationUnresolvedObligationIds?: string[];
  /** Parameterized route is authoritative, but runtime identity is unresolved. */
  navigationRuntimeResolutionRequiredObligationIds?: string[];
  /** A source-compatible read-only case may attempt bounded runtime route discovery. */
  /** Additive V2 execution-binding diagnostics; absent from legacy plans. */
  sessionUnresolvedObligationIds?: string[];
  /** Additive V2 execution-binding diagnostics; absent from legacy plans. */
  actorConstraintUnresolvedObligationIds?: string[];
  /** Additive V2 diagnostics; absent from legacy plans. */
  personaUnresolvedObligationIds?: string[];
  /** Additive V2 diagnostics; absent from legacy plans. */
  routeUnresolvedObligationIds?: string[];
  fixtureUnavailableObligationIds: string[];
  unallocatedBudgetObligationIds: string[];
  manualCouplingViolationCount: number;
  duplicateObligationCoverageCount: number;
  hallucinatedAuthorityCount: number;
  contracts: PlannerBrowserVerdictContract[];
  /** Additive V2 planner metadata; absent on legacy V1 plans. */
  evidenceContracts?: PlannerBrowserEvidenceContract[];
  /** Additive V2 execution planning; containers never carry verdicts. */
  executionContainers?: PlannerBrowserExecutionContainer[];
  /** Source-authorized atomic surface coverage; planning-only and verdict-neutral. */
  sourceBackedAtomicSurfacePartitions?:
    PlannerSourceBackedAtomicSurfacePartition[];
  /** Exactly one planner-time accounting row per authoritative obligation. */
  obligationEvidenceAccounting?:
    PlannerBrowserObligationEvidenceAccounting[];
};

export type PlannerCaseBudgetAudit = {
  api: {
    inputCount: number;
    distinctCount: number;
    retainedCount: number;
    overflowCount: number;
  };
  browser: {
    inputCount: number;
    distinctCount: number;
    retainedCount: number;
    overflowCount: number;
  };
  removals: Array<{
    originalCaseId: string;
    kind: "api" | "browser";
    reason:
      | "REMOVED_EXACT_DUPLICATE"
      | "REMOVED_REPEATED_DEPENDENCY"
      | "REMOVED_SEMANTIC_SPECIAL_DUPLICATE"
      | "REMOVED_CAPACITY_OVERFLOW";
    acceptanceFingerprint: string;
    exactObligationIds?: string[];
  }>;
};

export type PlannerObligationCaseAllocationAudit = {
  obligationCount: number;
  stableIdCaseRepresentationCount: number;
  exactCaseRepresentationCount: number;
  exactRepresentationRemovedCount: number;
  notesOnlyCount: number;
  notExactlyRepresentedCount: number;
  allocations: Array<{
    obligationId: string;
    status:
      | "STABLE_ID_CASE_REPRESENTATION"
      | "EXACT_CASE_REPRESENTATION"
      | "EXACT_REPRESENTATION_REMOVED"
      | "NOTES_ONLY"
      | "NOT_EXACTLY_REPRESENTED";
    matchedCaseIds: string[];
    removedCaseIds: string[];
  }>;
};

// Full plan for one ticket
export type TestPlan = {
  issueKey: string;
  summary: string;
  /**
   * Deterministic Jira-source provenance added after
   * model planning. It is coverage metadata, not proof.
   */
  acceptanceSourceLedger?:
    PlannerAcceptanceSourceLedger;
  /**
   * Conservative deterministic acceptance obligations derived
   * from Jira source provenance. Observational only: this does
   * not assign support, prove behavior, or affect verdicts.
   */
  acceptanceObligationLedger?:
    PlannerAcceptanceObligationLedger;
  /** Source-derived capability identity used before model compatibility transforms. */
  sourceInvoiceExecutionCapabilities?:
    PlannerSourceInvoiceExecutionCapability[];
  /**
   * Source-derived required member dimensions. Planning/accounting only;
   * model candidates and runtime execution cannot create authority from it.
   */
  sourceDerivedObligationMemberLedger?:
    PlannerSourceDerivedObligationMemberLedger;
  /** Candidate/member coverage accounting only; it cannot affect execution or verdicts. */
  semanticMemberCoverageAudit?:
    PlannerSemanticMemberCoverageAudit;
  /** Verdict-neutral atomicity/dependency metadata; UNKNOWN never authorizes separation. */
  acceptanceVerdictGrouping?:
    PlannerAcceptanceVerdictGrouping;
  /** Candidate model semantics only; never proof or relationship authority. */
  browserSemanticIr?:
    PlannerBrowserSemanticIr;
  /** Deterministic group/case allocation and ticket-level coverage accounting. */
  browserSemanticPlanningAudit?:
    PlannerBrowserSemanticPlanningAudit;
  /**
   * Conservative post-planner representation audit.
   * This is coverage metadata, not behavioral proof.
   */
  acceptanceCoverageAudit?:
    PlannerAcceptanceCoverageAudit;
  /** Observational only; case retention semantics are unchanged. */
  plannerCaseBudgetAudit?:
    PlannerCaseBudgetAudit;
  /** Stable-ID/legacy exact-text allocation observability; never proof authority. */
  obligationCaseAllocationAudit?:
    PlannerObligationCaseAllocationAudit;
  /**
   * Planning/accounting metadata only; cannot satisfy proof or affect verdicts.
   * Legacy authored-case proof-adapter bindings. In semantic-planning V2,
   * allocatedCaseIds are not final runtime-case representation; consumers must
   * use the post-materialization obligationCaseAllocationAudit for that purpose.
   */
  browserObligationBindings?:
    PlannerBrowserObligationBinding[];
  apiCases: ApiTestCase[];
  browserCases: BrowserTestCase[];
  /** Legacy frozen-plan compatibility only; new compiled plans omit this. */
  discoveryBrowserCases?: BrowserTestCase[];
  compiledPlanMetadata?: CompiledPlanMetadata;
  plannerDiagnostics?: PlannerDiagnostics;
  compilationSummary?: PlannerCompilationSummary;
};

export type PlannerDiagnostics = {
  rawSemanticCandidates?: PlannerBrowserSemanticCandidateProposal[];
};

export type PlannerCompilationSummary = {
  version: "V1";
  apiCaseCount: number;
  proposedBrowserCaseCount: number;
  semanticCandidateCount: number;
  rejectedSemanticCandidateCount: number;
  browserCaseCount: number;
  effectiveBrowserRuntimeCaseCount: number;
  effectiveRuntimeUnitCount: number;
};

export type CompiledPlanMetadata = {
  schemaVersion: 1;
  kind: "DETERMINISTIC_COMPILED_TEST_PLAN";
  compilerContract: "PLANNER_PROPOSAL_REQUIRES_DETERMINISTIC_MATERIALIZATION_V1";
};

export type CompiledTestPlan = TestPlan & {
  compiledPlanMetadata: CompiledPlanMetadata;
};
