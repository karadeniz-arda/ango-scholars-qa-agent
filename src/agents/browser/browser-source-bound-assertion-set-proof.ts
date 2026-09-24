import { createHash } from "node:crypto";

import type {
  BrowserStep,
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  PlannerBrowserObligationBinding,
} from "../../planner/types.js";
import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import type {
  BrowserCaseProofReadiness,
  BrowserDeterministicObligationDischarge,
} from "./browser-local-state-obligation-discharge.js";
import {
  auditBrowserCaseProofReadiness,
} from "./browser-local-state-obligation-discharge.js";
import {
  BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS,
  type BrowserObservation,
} from "./browser-observation.js";

export type BrowserSourceBoundAssertionMember = {
  action:
    | "assertUrlContains"
    | "assertTextVisible"
    | "assertTextNotVisible"
    | "assertExactVisibleButton";
  expectedText: string;
  oracleId: string;
};

/**
 * Source-derived control carrier. Its target context is the independently
 * completed generic-browser assertion handoff, never planner prose.
 */
export type BrowserSourceDerivedButtonCarrier = {
  kind: "SOURCE_DERIVED_EXACT_VISIBLE_BUTTON";
  member: string;
  targetContext: "GENERIC_BROWSER_ASSERTION_HANDOFF";
};

export type BrowserSourceDerivedButtonCarrierObservation = {
  requirementId: string;
  oracleId: string;
  member: string;
  targetContextGrounded: boolean;
  matchingButtonCount: number;
  result: "CONFIRMED" | "CONTRADICTED" | "NOT_CONFIRMED";
};

export type BrowserSourceBoundAssertionSetRequirement = {
  schemaVersion: 1;
  kind: "SOURCE_BOUND_ASSERTION_SET_REQUIREMENT";
  requirementId: string;
  obligationId: string;
  sourceUnitIds: string[];
  sourceRefs: string[];
  sourceRole: "ACCEPTANCE" | "TASK";
  proofAuthority: "ACCEPTANCE" | "DIRECT_TASK";
  derivation: "DIRECT_ACCEPTANCE_FIELD" | "DIRECT_DESCRIPTION_SECTION" | "DIRECT_TASK_SECTION";
  sourceSupportedUiRelation?: "BUTTON_LABEL";
  buttonCarrier?: BrowserSourceDerivedButtonCarrier;
  executionCaseId: string;
  persona: "company_admin" | "talent";
  routePath: string;
  semanticFamily:
    | "EXPLICIT_ENUMERATED_PRESENCE"
    | "EXPLICIT_ENUMERATED_ABSENCE"
    | "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1"
    | "SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1";
  memberPolicy: "ALL_REQUIRED";
  members: BrowserSourceBoundAssertionMember[];
};

/**
 * The complete, already-approved case-level authority boundary for this
 * proof family. It deliberately admits no general TASK or EXPECTED_BEHAVIOR
 * prose: TASK is allowed only for the existing direct UI-member shape.
 */
export function hasApprovedCaseLevelSourceBoundAssertionAuthority(
  requirement: BrowserSourceBoundAssertionSetRequirement
): boolean {
  return (
    requirement.sourceRole === "ACCEPTANCE" &&
    requirement.proofAuthority === "ACCEPTANCE"
  ) || (
    requirement.sourceRole === "TASK" &&
    requirement.derivation === "DIRECT_TASK_SECTION" &&
    requirement.proofAuthority === "DIRECT_TASK" &&
    (
      requirement.semanticFamily === "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" ||
      requirement.semanticFamily === "SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1"
    )
  );
}

export type BrowserSourceBoundAssertionSetEvidence = {
  schemaVersion: 1;
  kind: "SOURCE_BOUND_ASSERTION_SET";
  proofRequirementId: string;
  obligationId: string;
  executionCaseId: string;
  sourceUnitIds: string[];
  sourceRefs: string[];
  persona: "company_admin" | "talent";
  routePath: string;
  freshObservation: boolean;
  members: Array<BrowserSourceBoundAssertionMember & {
    result: "CONFIRMED" | "CONTRADICTED" | "NOT_EXECUTED";
  }>;
  result: "CONFIRMED" | "NOT_CONFIRMED";
  note: string;
};

export type BrowserRuntimeSourceAssertionAllocation = {
  obligationId: string;
  sourceUnitIds: string[];
  semanticFamily:
    | "EXPLICIT_ENUMERATED_PRESENCE"
    | "EXPLICIT_ENUMERATED_ABSENCE"
    | "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1"
    | "SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1"
    | "OTHER";
  state:
    | "SUPPORTED_AND_BOUND"
    | "AMBIGUOUS_CASE_ALLOCATION"
    | "UNSUPPORTED_AUTOMATION_SEMANTIC";
  allocatedCaseIds: string[];
  reason: string;
  emittedRequirementIds?: string[];
};

export type BrowserSourceBoundAssertionSetTelemetry = {
  requirements: BrowserSourceBoundAssertionSetRequirement[];
  evidence: BrowserSourceBoundAssertionSetEvidence[];
  allocations: BrowserRuntimeSourceAssertionAllocation[];
  discharges: BrowserDeterministicObligationDischarge[];
  caseProofReadiness: BrowserCaseProofReadiness;
};

export const SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_MARKER =
  "SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_V1";

/** Bounded, stable diagnostic projection; it deliberately excludes source prose and notes. */
export function summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry(args: {
  caseId: string;
  persona: string | null | undefined;
  acceptedRoutePath: string | null;
  telemetry: BrowserSourceBoundAssertionSetTelemetry;
}): Record<string, unknown> {
  const { telemetry } = args;
  return {
    caseId: args.caseId,
    persona: args.persona ?? null,
    acceptedRoutePath: args.acceptedRoutePath,
    requirementCount: telemetry.requirements.length,
    requirements: telemetry.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      obligationId: requirement.obligationId,
      sourceUnitIds: requirement.sourceUnitIds,
      sourceRefs: requirement.sourceRefs,
      executionCaseId: requirement.executionCaseId,
      persona: requirement.persona,
      routePath: requirement.routePath,
      semanticFamily: requirement.semanticFamily,
      memberPolicy: requirement.memberPolicy,
      members: requirement.members.map((member) => ({
        action: member.action,
        expectedText: member.expectedText,
        oracleId: member.oracleId,
      })),
    })),
    evidenceCount: telemetry.evidence.length,
    evidence: telemetry.evidence.map((evidence) => ({
      proofRequirementId: evidence.proofRequirementId,
      obligationId: evidence.obligationId,
      executionCaseId: evidence.executionCaseId,
      sourceUnitIds: evidence.sourceUnitIds,
      sourceRefs: evidence.sourceRefs,
      persona: evidence.persona,
      routePath: evidence.routePath,
      freshObservation: evidence.freshObservation,
      result: evidence.result,
      members: evidence.members.map((member) => ({
        action: member.action,
        expectedText: member.expectedText,
        oracleId: member.oracleId,
        result: member.result,
      })),
    })),
    allocationCount: telemetry.allocations.length,
    allocations: telemetry.allocations.map((allocation) => ({
      obligationId: allocation.obligationId,
      sourceUnitIds: allocation.sourceUnitIds,
      semanticFamily: allocation.semanticFamily,
      state: allocation.state,
      allocatedCaseIds: allocation.allocatedCaseIds,
      emittedRequirementIds: allocation.emittedRequirementIds ?? [],
    })),
    dischargeCount: telemetry.discharges.length,
    discharges: telemetry.discharges.map((discharge) => ({
      obligationId: discharge.obligationId,
      sourceId: discharge.sourceId,
      proofRequirementId: discharge.proofRequirementId,
      proofKind: discharge.proofKind,
      evidenceResult: discharge.evidenceResult,
    })),
    caseProofReadiness: {
      status: telemetry.caseProofReadiness.status,
      allocatedObligationIds: telemetry.caseProofReadiness.allocatedObligationIds,
      provedObligationIds: telemetry.caseProofReadiness.provedObligationIds,
      remainingObligationIds: telemetry.caseProofReadiness.remainingObligationIds,
      blockingBindingStates: telemetry.caseProofReadiness.blockingBindingStates,
    },
  };
}

function normalized(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

function pathOf(value: string): string | null {
  try { return new URL(value, "https://runtime.invalid").pathname.replace(/\/$/, "") || "/"; }
  catch { return null; }
}

function sourceSupportsMember(sourceText: string, member: BrowserSourceBoundAssertionMember): boolean {
  const source = normalized(sourceText);
  const expected = normalized(member.expectedText);
  if (!expected || !source.includes(expected)) return false;
  return member.action !== "assertTextNotVisible" || /\b(?:no longer shown|not shown|not visible|absent|removed from (?:the )?ui|does not display)\b/.test(source);
}

/**
 * SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1
 *
 * Browser query authority is intentionally narrower than generic URL prose:
 * the source must name both URL state and the exact query parameter. Runtime,
 * API, and network observations never participate in this derivation.
 */
function sourceBrowserQueryPresenceKey(sourceText: string): string | null {
  const source = normalized(sourceText);
  if (!/\burl\b/.test(source) || !/\b(?:track|tracked|tracking|reflect|reflected|synchroni[sz]e|update)\b/.test(source)) return null;
  const match = source.match(/\b([a-z][a-z0-9_.-]*)\s+(?:query\s+)?(?:parameter|param|key)\b/);
  return match?.[1] ?? null;
}

function sourceEnumeratedMembers(args: {
  sourceText: string;
  action: "assertTextVisible" | "assertTextNotVisible";
  obligationId: string;
  sourceUnitId: string;
}): BrowserSourceBoundAssertionMember[] {
  const source = String(args.sourceText ?? "").replace(/\s+/g, " ").trim();
  const list = args.action === "assertTextVisible"
    ? source.match(/\b(?:uses?|contains?|includes?|displays?|shows?|exposes?|presents?)\s+(.+?)(?:[.!?]|$)/i)?.[1]
    : source.match(/^\s*(.+?)\s+(?:are|is)\s+(?:no longer shown|not shown|not visible|absent|removed from (?:the )?ui|does not display)\b/i)?.[1];
  if (!list) return [];
  const members = list
    .split(/\s*,\s*|\s+(?:and|&)\s+/i)
    .map((member) => member.replace(/^(?:the|a|an|and)\s+/i, "").trim())
    .filter((member) => member.length > 0 && member.length <= 80)
    .filter((member) => /^[\p{L}\p{N}][\p{L}\p{N} ._\-/()&]+$/u.test(member));
  if (members.length < 2 || new Set(members.map(normalized)).size !== members.length) {
    return [];
  }
  return members.map((expectedText) => ({
    action: args.action,
    expectedText,
    oracleId: sourceDerivedMemberOracleId({
      obligationId: args.obligationId,
      sourceUnitId: args.sourceUnitId,
      member: `${args.action}:${expectedText}`,
    }),
  }));
}

function deterministicEvidenceMatchesMember(
  evidence: BrowserDeterministicEvidence,
  member: BrowserSourceBoundAssertionMember
): boolean {
  if (member.action === "assertExactVisibleButton") return false;
  const expected = normalized(evidence.expected);
  const canonicalExpected = normalized(member.expectedText);
  const executorExpected = member.action === "assertTextVisible"
    ? normalized(`Text is visible: ${member.expectedText}`)
    : normalized(`Text is not visible: ${member.expectedText}`);
  return evidence.oracleId === member.oracleId &&
    evidence.action === member.action &&
    (expected === canonicalExpected || expected === executorExpected);
}

/**
 * Bounded structural observation for source-authorized BUTTON_LABEL only.
 * It never scans page text: an exact visible button-role control is required.
 */
export function observeBrowserSourceDerivedButtonCarriers(args: {
  requirements: BrowserSourceBoundAssertionSetRequirement[];
  observation: BrowserObservation;
  targetContextGrounded: boolean;
}): BrowserSourceDerivedButtonCarrierObservation[] {
  return args.requirements.flatMap((requirement) => {
    const carrier = requirement.buttonCarrier;
    if (!carrier) return [];
    const member = requirement.members.find(
      (candidate) => candidate.action === "assertExactVisibleButton"
    );
    if (!member) return [];
    const matchingButtonCount = args.observation.controls.filter(
      (control) =>
        control.kind === "button" &&
        normalized(control.role) === "button" &&
        normalized(control.label) === normalized(carrier.member)
    ).length;

    /*
     * SOURCE_DERIVED_BUTTON_ABSENCE_CONTRADICTION_V1
     *
     * Zero matches may contradict an exact source-authored BUTTON_LABEL only
     * when the target is independently grounded and the bounded observation
     * did not hit its control cap or narrow itself to an active modal.
     *
     * Duplicate matches, truncated observations, active-modal observations,
     * and ungrounded targets remain fail-safe / non-confirming.
     */
    const completeButtonAbsenceObservation =
      args.targetContextGrounded &&
      args.observation.controls.length <
        BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS &&
      !args.observation.surfaces.some(
        (surface) => surface.modal
      );

    return [{
      requirementId: requirement.requirementId,
      oracleId: member.oracleId,
      member: carrier.member,
      targetContextGrounded: args.targetContextGrounded,
      matchingButtonCount,
      result: !args.targetContextGrounded
        ? "NOT_CONFIRMED"
        : matchingButtonCount === 1
          ? "CONFIRMED"
          : matchingButtonCount === 0 &&
              completeButtonAbsenceObservation
            ? "CONTRADICTED"
            : "NOT_CONFIRMED",
    }];
  });
}

const UNSUPPORTED_ASSERTION_SET_SEMANTICS =
  /\b(?:migration|no data loss|persist(?:ence|ent)?|create|update|filter|sort(?:ing)?|navigat(?:e|ion)|api|works? correctly|display(?:s)? .* correctly)\b/;
const EXPLICIT_POSITIVE_ENUMERATION =
  /\b(?:uses?|contains?|includes?|displays?|shows?|exposes?|presents?)\b/;
const EXPLICIT_NEGATIVE_ENUMERATION =
  /\b(?:no longer shown|not shown|not visible|absent|removed from (?:the )?ui|does not display)\b/;

function semanticFamilyForSourceText(
  sourceText: string
): BrowserSourceBoundAssertionSetRequirement["semanticFamily"] | null {
  const source = normalized(sourceText);
  if (UNSUPPORTED_ASSERTION_SET_SEMANTICS.test(source)) return null;
  const presence = EXPLICIT_POSITIVE_ENUMERATION.test(source);
  const absence = EXPLICIT_NEGATIVE_ENUMERATION.test(source);
  /* V1 has no typed mixed requirement: coupled source semantics stay closed. */
  if (presence === absence) return null;
  if (presence) return "EXPLICIT_ENUMERATED_PRESENCE";
  if (absence) return "EXPLICIT_ENUMERATED_ABSENCE";
  return null;
}

function directUiMemberPresence(sourceText: string): {
  member: string;
  relation: "BUTTON_LABEL";
} | undefined {
  const source = normalized(sourceText);

  /*
   * EXACT_SOURCE_UI_MEMBER_AUTHORITY_V2
   *
   * "Description/helper text should mention X" expresses semantic UI
   * meaning, not an exact copy contract. It must not be promoted into
   * assertTextVisible(X).
   *
   * Exact source-derived authority is retained only for source shapes that
   * explicitly name quoted UI labels, such as button text.
   */
  const says = source.match(/\bbutton\s+(?:should\s+)?(?:instead\s+)?say\s+[“"]([^”"]+)[”"]/i);
  if (says?.[1]) return { member: normalized(says[1]), relation: "BUTTON_LABEL" };
  const namedButton = source.match(/\b(?:display|add)\s+(?:a\s+)?[“"]([^”"]+)[”"]\s+button\b/i);
  if (namedButton?.[1]) return { member: normalized(namedButton[1]), relation: "BUTTON_LABEL" };
  return undefined;
}

function canonicalAssertions(testCase: BrowserTestCase): BrowserSourceBoundAssertionMember[] {
  const seen = new Set<string>();
  const members: BrowserSourceBoundAssertionMember[] = [];
  for (const step of testCase.steps ?? []) {
    if ((step.action !== "assertTextVisible" && step.action !== "assertTextNotVisible" && step.action !== "assertUrlContains") || !step.oracleId) continue;
    const member = { action: step.action, expectedText: String(step.text || "").trim(), oracleId: step.oracleId } as BrowserSourceBoundAssertionMember;
    const key = [member.action, normalized(member.expectedText), member.oracleId].join("|");
    if (member.expectedText && !seen.has(key)) { seen.add(key); members.push(member); }
  }
  return members;
}

function sourceDerivedMemberOracleId(args: {
  obligationId: string;
  sourceUnitId: string;
  member: string;
}): string {
  return `source-member-${stableId([
    args.obligationId,
    args.sourceUnitId,
    normalized(args.member),
  ])}`;
}

/**
 * Produces only the execution carrier for an already-authorized direct source
 * member. The member, source refs, and requirement identity remain the sole
 * authority; planner wording is neither copied nor promoted.
 */
export function buildBrowserSourceDerivedAssertionCheckCarriers(args: {
  testCase: BrowserTestCase;
  requirements: BrowserSourceBoundAssertionSetRequirement[];
}): BrowserStep[] {
  const existing = args.testCase.steps ?? [];
  const seen = new Set<string>();
  return args.requirements.flatMap((requirement) => {
    if (requirement.buttonCarrier) return [];
    return requirement.members.flatMap((member) => {
      if (member.action !== "assertTextVisible" &&
        member.action !== "assertTextNotVisible") return [];
      const alreadyCarried = existing.some((step) =>
        step.action === member.action &&
        normalized(step.text) === normalized(member.expectedText) &&
        step.oracleId === member.oracleId
      );
      const key = [member.action, normalized(member.expectedText), member.oracleId].join("\u0000");
      if (alreadyCarried || seen.has(key)) return [];
      seen.add(key);
      return [{
        action: member.action,
        text: member.expectedText,
        oracleId: member.oracleId,
      }];
    });
  });
}

/** Builds requirements only from the authoritative source chain, never case prose. */
export function buildBrowserSourceBoundAssertionSetRequirements(args: {
  testCase: BrowserTestCase;
  /** Canonical assertions only; this case never supplies execution authority. */
  assertionSourceCase?: BrowserTestCase;
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  sourceLedger: PlannerAcceptanceSourceLedger | undefined;
  acceptedRoutePath: string | null;
}): BrowserSourceBoundAssertionSetRequirement[] {
  if (args.obligationLedger?.sourceStatus !== "RESOLVED" || args.obligationLedger.derivationStatus !== "RESOLVED" || args.sourceLedger?.sourceStatus !== "RESOLVED" || !args.acceptedRoutePath) return [];
  /* Assertion carrier != authority/execution owner. */
  const assertions = canonicalAssertions(
    args.assertionSourceCase ?? args.testCase
  );
  const sourceById = new Map(args.sourceLedger.sourceUnits.map(unit => [unit.id, unit]));
  const requirements: BrowserSourceBoundAssertionSetRequirement[] = [];
  for (const obligationId of [...new Set(args.testCase.acceptanceObligationIds ?? [])]) {
    const obligation = args.obligationLedger.obligations.find(item => item.id === obligationId);
    if (!obligation || (obligation.sourceRole !== "ACCEPTANCE" && obligation.sourceRole !== "TASK")) continue;
    const candidates = obligation.sourceUnitIds
      .map((id) => sourceById.get(id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .flatMap((source) => {
        const directMember = directUiMemberPresence(source.text);
        const directTask = obligation.sourceRole === "TASK" &&
          obligation.derivation === "DIRECT_TASK_SECTION";
        const queryKey = sourceBrowserQueryPresenceKey(source.text);
        if (obligation.sourceRole === "TASK" && (!directTask || (!directMember && !queryKey))) return [];
        const sourceBoundUrlMembers = queryKey
          ? assertions.filter((member) =>
              member.action === "assertUrlContains" &&
              normalized(member.expectedText) === `${queryKey}=`
            )
          : [];
        const semanticFamily = sourceBoundUrlMembers.length === 1
          ? "SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1" as const
          : directMember &&
          (obligation.sourceRole === "ACCEPTANCE" || directTask)
          ? "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" as const
          : semanticFamilyForSourceText(source.text);
        if (!semanticFamily) return [];
        const compatibleAction = semanticFamily === "EXPLICIT_ENUMERATED_PRESENCE"
          ? "assertTextVisible"
          : semanticFamily === "EXPLICIT_ENUMERATED_ABSENCE"
            ? "assertTextNotVisible"
            : "assertTextVisible";
        const buttonCarrier = semanticFamily === "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" &&
          directMember?.relation === "BUTTON_LABEL"
          ? {
              kind: "SOURCE_DERIVED_EXACT_VISIBLE_BUTTON" as const,
              member: directMember.member,
              targetContext: "GENERIC_BROWSER_ASSERTION_HANDOFF" as const,
            }
          : undefined;
        const exactSourceMemberAssertions = semanticFamily ===
          "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1"
          ? assertions.filter(
              (member) =>
                member.action === "assertTextVisible" &&
                normalized(member.expectedText) === normalized(directMember!.member)
            )
          : [];
        const sourceDerivedMembers = semanticFamily === "EXPLICIT_ENUMERATED_PRESENCE"
          ? sourceEnumeratedMembers({
              sourceText: source.text,
              action: "assertTextVisible",
              obligationId: obligation.id,
              sourceUnitId: source.id,
            })
          : semanticFamily === "EXPLICIT_ENUMERATED_ABSENCE"
            ? sourceEnumeratedMembers({
                sourceText: source.text,
                action: "assertTextNotVisible",
                obligationId: obligation.id,
                sourceUnitId: source.id,
              })
            : [];
        const members = semanticFamily === "SOURCE_BOUND_BROWSER_QUERY_PRESENCE_V1"
          ? sourceBoundUrlMembers
          : buttonCarrier
          ? [{
              action: "assertExactVisibleButton" as const,
              expectedText: directMember!.member,
              oracleId: `source-button-${stableId([obligation.id, source.id, directMember!.member])}`,
            }]
          : semanticFamily === "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1"
            ? exactSourceMemberAssertions.length > 0
              ? exactSourceMemberAssertions
              : [{
                  action: "assertTextVisible" as const,
                  expectedText: directMember!.member,
                  oracleId: sourceDerivedMemberOracleId({
                    obligationId: obligation.id,
                    sourceUnitId: source.id,
                    member: directMember!.member,
                  }),
                }]
            : sourceDerivedMembers;
        const minimumMembers = semanticFamily === "EXPLICIT_ENUMERATED_PRESENCE"
          ? 2
          : 1;
        return members.length >= minimumMembers
          ? [{ source, semanticFamily, members, ...(directMember ? { directMember } : {}), ...(buttonCarrier ? { buttonCarrier } : {}) }]
          : [];
      });
    if (candidates.length !== 1) continue;
    const { source, semanticFamily, members, directMember, buttonCarrier } = candidates[0]!;
    if (args.testCase.persona !== "company_admin" && args.testCase.persona !== "talent") continue;
    const requirement: BrowserSourceBoundAssertionSetRequirement = { schemaVersion: 1, kind: "SOURCE_BOUND_ASSERTION_SET_REQUIREMENT",
      requirementId: `source-assertion-set-${stableId([obligation.id, args.testCase.id, args.acceptedRoutePath, ...members.map(member => member.oracleId)])}`,
      obligationId: obligation.id, sourceUnitIds: [source.id], sourceRefs: [source.sourceRef], sourceRole: obligation.sourceRole, proofAuthority: obligation.sourceRole === "TASK" ? "DIRECT_TASK" : "ACCEPTANCE", derivation: obligation.derivation,
      ...(semanticFamily === "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1" ? { sourceSupportedUiRelation: directMember!.relation } : {}),
      ...(buttonCarrier ? { buttonCarrier } : {}),
      executionCaseId: args.testCase.id, persona: args.testCase.persona, routePath: args.acceptedRoutePath,
      semanticFamily, memberPolicy: "ALL_REQUIRED", members };
    if (hasApprovedCaseLevelSourceBoundAssertionAuthority(requirement)) {
      requirements.push(requirement);
    }
  }
  return requirements;
}

export function evaluateBrowserSourceBoundAssertionSet(args: {
  requirement: BrowserSourceBoundAssertionSetRequirement;
  deterministicEvidence: BrowserDeterministicEvidence[];
  actualPersona: string | null | undefined;
  actualRoutePath: string | null;
  freshObservation: boolean;
  buttonCarrierObservations?: BrowserSourceDerivedButtonCarrierObservation[];
}): BrowserSourceBoundAssertionSetEvidence {
  const members = args.requirement.members.map(member => {
    if (member.action === "assertExactVisibleButton") {
      const matches = (args.buttonCarrierObservations ?? []).filter(
        (observation) =>
          observation.requirementId === args.requirement.requirementId &&
          observation.oracleId === member.oracleId &&
          normalized(observation.member) === normalized(member.expectedText)
      );
      const observation =
        matches.length === 1
          ? matches[0]!
          : null;

      return {
        ...member,
        result:
          observation?.result === "CONFIRMED"
            ? "CONFIRMED" as const
            : observation?.result === "CONTRADICTED"
              ? "CONTRADICTED" as const
              : "NOT_EXECUTED" as const,
      };
    }
    const matches = args.deterministicEvidence.filter(
      (evidence) => deterministicEvidenceMatchesMember(evidence, member)
    );
    return { ...member, result: matches.length !== 1 ? "NOT_EXECUTED" as const : matches[0]!.passed === true ? "CONFIRMED" as const : "CONTRADICTED" as const };
  });
  const confirmed = args.freshObservation && args.actualPersona === args.requirement.persona && args.actualRoutePath === args.requirement.routePath && members.every(member => member.result === "CONFIRMED");
  return { schemaVersion: 1, kind: "SOURCE_BOUND_ASSERTION_SET", proofRequirementId: args.requirement.requirementId,
    obligationId: args.requirement.obligationId, executionCaseId: args.requirement.executionCaseId,
    sourceUnitIds: args.requirement.sourceUnitIds, sourceRefs: args.requirement.sourceRefs, persona: args.requirement.persona,
    routePath: args.requirement.routePath, freshObservation: args.freshObservation, members,
    result: confirmed ? "CONFIRMED" : "NOT_CONFIRMED",
    note: confirmed ? "Every exact source-bound assertion member was freshly confirmed." : "Source-bound assertion-set confirmation was incomplete or context-mismatched." };
}

export function allocateBrowserRuntimeSourceAssertions(args: {
  currentCase: BrowserTestCase;
  allCases: BrowserTestCase[];
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  requirements: BrowserSourceBoundAssertionSetRequirement[];
}): BrowserRuntimeSourceAssertionAllocation[] {
  if (args.obligationLedger?.sourceStatus !== "RESOLVED" || args.obligationLedger.derivationStatus !== "RESOLVED") return [];
  return [...new Set(args.currentCase.acceptanceObligationIds ?? [])].map(obligationId => {
    const obligation = args.obligationLedger!.obligations.find(item => item.id === obligationId);
    const cases = args.allCases.filter(testCase => testCase.acceptanceObligationIds?.includes(obligationId)).map(testCase => testCase.id).sort();
    const requirement = args.requirements.filter(item => item.obligationId === obligationId);
    const directTask = obligation?.sourceRole === "TASK" && obligation.derivation === "DIRECT_TASK_SECTION";
    if (!obligation || (obligation.sourceRole !== "ACCEPTANCE" && !directTask) || requirement.length !== 1) return { obligationId, sourceUnitIds: obligation?.sourceUnitIds ?? [], semanticFamily: "OTHER", state: "UNSUPPORTED_AUTOMATION_SEMANTIC", allocatedCaseIds: cases, reason: "No unique supported source-bound assertion requirement exists." };
    if (cases.length !== 1 || cases[0] !== args.currentCase.id) return { obligationId, sourceUnitIds: obligation.sourceUnitIds, semanticFamily: requirement[0]!.semanticFamily, state: "AMBIGUOUS_CASE_ALLOCATION", allocatedCaseIds: cases, reason: "The authoritative obligation occurs in multiple runtime cases; no case ownership was inferred." };
    return { obligationId, sourceUnitIds: obligation.sourceUnitIds, semanticFamily: requirement[0]!.semanticFamily, state: "SUPPORTED_AND_BOUND", allocatedCaseIds: cases, emittedRequirementIds: [requirement[0]!.requirementId], reason: "One exact source-bound assertion requirement is uniquely allocated to this runtime case." };
  });
}

export function evaluateBrowserSourceBoundAssertionSetDischarge(args: {
  testCase: BrowserTestCase;
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  allocation: BrowserRuntimeSourceAssertionAllocation | undefined;
  requirement: BrowserSourceBoundAssertionSetRequirement;
  evidence: BrowserSourceBoundAssertionSetEvidence;
}): { status: "DETERMINISTIC_OBLIGATION_PROVED"; discharge: BrowserDeterministicObligationDischarge } | { status: "NOT_PROVED"; note: string } {
  const obligation = args.obligationLedger?.sourceStatus === "RESOLVED" && args.obligationLedger.derivationStatus === "RESOLVED" ? args.obligationLedger.obligations.find(item => item.id === args.requirement.obligationId) : undefined;
  const exactMembers = args.requirement.members.length === args.evidence.members.length && args.requirement.members.every(member => args.evidence.members.filter(item => item.oracleId === member.oracleId && item.action === member.action && normalized(item.expectedText) === normalized(member.expectedText)).length === 1);
  const directTask = obligation?.sourceRole === "TASK" && obligation.derivation === "DIRECT_TASK_SECTION" && args.requirement.sourceRole === "TASK" && args.requirement.proofAuthority === "DIRECT_TASK" && args.requirement.semanticFamily === "SOURCE_DERIVED_UI_MEMBER_PRESENCE_V1";
  const acceptance = obligation?.sourceRole === "ACCEPTANCE" && args.requirement.sourceRole === "ACCEPTANCE" && args.requirement.proofAuthority === "ACCEPTANCE";
  if (!obligation || (!acceptance && !directTask) || !args.requirement.sourceUnitIds.every(id => obligation.sourceUnitIds.includes(id)) || !args.allocation || args.allocation.state !== "SUPPORTED_AND_BOUND" || args.allocation.allocatedCaseIds.length !== 1 || args.allocation.allocatedCaseIds[0] !== args.testCase.id || args.evidence.proofRequirementId !== args.requirement.requirementId || args.evidence.obligationId !== args.requirement.obligationId || args.evidence.executionCaseId !== args.testCase.id || args.evidence.persona !== args.requirement.persona || args.evidence.routePath !== args.requirement.routePath || !args.evidence.freshObservation || args.evidence.result !== "CONFIRMED" || !exactMembers || !args.evidence.members.every(member => member.result === "CONFIRMED")) return { status: "NOT_PROVED", note: "Source-bound assertion evidence did not satisfy exact authority, allocation, identity, freshness, or ALL_REQUIRED checks." };
  return { status: "DETERMINISTIC_OBLIGATION_PROVED", discharge: { kind: "DETERMINISTIC_OBLIGATION_PROVED", obligationId: args.requirement.obligationId, sourceId: args.requirement.sourceUnitIds[0]!, proofRequirementId: args.requirement.requirementId, proofKind: "SOURCE_BOUND_ASSERTION_SET", evidenceResult: "CONFIRMED", note: "The exact uniquely allocated acceptance obligation was freshly proved by a source-bound canonical assertion set." } };
}

/**
 * Composes existing source-bound requirement, evidence, allocation, discharge,
 * and readiness helpers into verdict-neutral runtime telemetry.  Callers own
 * status transitions; this function can never create PASS.
 */
export function collectBrowserSourceBoundAssertionSetTelemetry(args: {
  testCase: BrowserTestCase;
  /** Optional carrier of canonical assertions; testCase remains the authority owner. */
  assertionSourceCase?: BrowserTestCase;
  allCases: BrowserTestCase[];
  obligationLedger: PlannerAcceptanceObligationLedger | undefined;
  sourceLedger: PlannerAcceptanceSourceLedger | undefined;
  browserObligationBindings: PlannerBrowserObligationBinding[] | undefined;
  acceptedRoutePath: string | null;
  deterministicEvidence: BrowserDeterministicEvidence[];
  actualPersona: string | null | undefined;
  freshObservation: boolean;
  buttonCarrierObservations?: BrowserSourceDerivedButtonCarrierObservation[];
  existingDischarges?: BrowserDeterministicObligationDischarge[];
}): BrowserSourceBoundAssertionSetTelemetry {
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({
    testCase: args.testCase,
    ...(args.assertionSourceCase
      ? { assertionSourceCase: args.assertionSourceCase }
      : {}),
    obligationLedger: args.obligationLedger,
    sourceLedger: args.sourceLedger,
    acceptedRoutePath: args.acceptedRoutePath,
  });
  const allocations = allocateBrowserRuntimeSourceAssertions({
    currentCase: args.testCase,
    allCases: args.allCases,
    obligationLedger: args.obligationLedger,
    requirements,
  });
  const evidence = requirements.map((requirement) =>
    evaluateBrowserSourceBoundAssertionSet({
      requirement,
      deterministicEvidence: args.deterministicEvidence,
      actualPersona: args.actualPersona,
      actualRoutePath: args.acceptedRoutePath,
      freshObservation: args.freshObservation,
      ...(args.buttonCarrierObservations
        ? { buttonCarrierObservations: args.buttonCarrierObservations }
        : {}),
    })
  );
  const discharges = requirements.flatMap((requirement, index) => {
    const decision = evaluateBrowserSourceBoundAssertionSetDischarge({
      testCase: args.testCase,
      obligationLedger: args.obligationLedger,
      allocation: allocations.find(
        (allocation) => allocation.obligationId === requirement.obligationId
      ),
      requirement,
      evidence: evidence[index]!,
    });
    return decision.status === "DETERMINISTIC_OBLIGATION_PROVED"
      ? [decision.discharge]
      : [];
  });
  const allDischarges = [
    ...(args.existingDischarges ?? []),
    ...discharges,
  ];
  return {
    requirements,
    evidence,
    allocations,
    discharges,
    caseProofReadiness: auditBrowserCaseProofReadiness({
      testCase: args.testCase,
      discharges: allDischarges,
      browserObligationBindings: args.browserObligationBindings,
    }),
  };
}

export { pathOf as browserSourceBoundAssertionPathOf };
