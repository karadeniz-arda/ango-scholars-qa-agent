import { createHash } from "node:crypto";
import { linkComposedRuntimeCapabilities } from "./planner-composed-runtime-resolution.js";

import {
  findExactStaticUiRouteBindings,
  resolveExplicitStaticUiRouteBinding,
} from "../discovery/ui-route-catalog.js";
import {
  discoverRuntimeNavigationCapability,
} from "../discovery/runtime-navigation-capability-registry.js";
import {
  bindPlannerBrowserProofCapability,
} from "./planner-browser-proof-binding.js";
import {
  auditPlannerObligationCaseAllocation,
} from "./planner-obligation-case-allocation-audit.js";
import {
  browserCasePageSurfaces,
  sourceBackedPageSurfaces,
  sourceBackedSurfaceMatches,
  sourceBackedSurfaceMemberId,
} from "./planner-browser-obligation-bridge.js";
import {
  classifyGenericBrowserActionSafety,
} from "../agents/browser/generic-browser-action-safety.js";
import {
  buildBrowserSourceBoundAssertionSetRequirements,
  buildBrowserSourceDerivedAssertionCheckCarriers,
  hasApprovedCaseLevelSourceBoundAssertionAuthority,
} from "../agents/browser/browser-source-bound-assertion-set-proof.js";
import {
  deriveBrowserExecutionCheckContract,
} from "./browser-execution-check-contract.js";
import type {
  BrowserExecutionIntentAuthority,
} from "../agents/browser/browser-runtime-execution-binding.js";

import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceVerdictGroup,
  PlannerAcceptanceVerdictGrouping,
  PlannerBrowserProofCapability,
  PlannerBrowserEvidenceContract,
  PlannerBrowserEvidenceContractDisposition,
  PlannerBrowserDeterministicExecutionExpansion,
  PlannerBrowserExecutionContainer,
  PlannerBrowserObligationEvidenceAccounting,
  PlannerBrowserSemanticCandidate,
  PlannerBrowserSemanticIr,
  PlannerBrowserSemanticMutationClass,
  PlannerBrowserSemanticPlanningAudit,
  PlannerBrowserVerdictContract,
  PlannerRuntimeFixtureResolutionContract,
  PlannerRuntimeNavigationResolutionContract,
  PlannerRuntimeTargetGroundingContract,
  PlannerExecutionSurfacePrerequisiteContract,
  PlannerSourceBackedAtomicSurfacePartition,
  PlannerTalentContractFixturePredicate,
  PlannerTalentContractFixturePredicateKey,
  PlannerComposedRuntimeResolutionLink,
  TestPlan,
} from "./types.js";
import {
  sourceBackedInvoiceStates,
  sourceInvoiceCapabilityForObligation,
  type SourceInvoiceState,
} from "./planner-source-invoice-capability.js";

/**
 * The historical browser budget bounds model-authored/direct execution units.
 * Semantic mode deliberately defers this cap until deterministic allocation,
 * so source-backed planner expansion can be accounted for separately.
 */
const MAX_RAW_BROWSER_EXECUTION_UNITS = 4;
/** Finite fuse for planner-owned source-backed derived execution members. */
const MAX_DERIVED_BROWSER_EXECUTION_UNITS = 8;
/** Global sanity fuse across direct and derived execution units. */
const MAX_BROWSER_EXECUTION_UNITS = 10;

function normalized(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sameIds(left: string[], right: string[]): boolean {
  return [...new Set(left)].sort().join("\u0000") ===
    [...new Set(right)].sort().join("\u0000");
}

function stablePlanningId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${digest}`;
}

function normalizedDisclosureText(value: unknown): string {
  return normalized(value)
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceContainsExactTargetPhrase(source: string, target: string): boolean {
  const haystack = ` ${normalizedDisclosureText(source)} `;
  const needle = normalizedDisclosureText(target);
  return needle.length >= 4 && /[a-z]/.test(needle) &&
    haystack.includes(` ${needle} `);
}

function sourceDefinesExistingDetailDisclosure(value: string): boolean {
  const text = normalizedDisclosureText(value);
  return /\breadonly\b/.test(text) ||
    /\b(?:view|viewing|display|displays|displayed|inspect|inspects)\b/.test(text) ||
    /\b(?:open|opens|opened|opening)(?:\s+up)?\b.{0,120}\b(?:details?|drawer|modal|models?|panel|sheet|snapshot|information|status|version|signature|date)\b/.test(text);
}

function sourceDefinesPersistentInteraction(value: string): boolean {
  return /\b(?:approve|archive|create|delete|edit|publish|reject|remove|save|submit|update|upload)\b/i
    .test(normalizedDisclosureText(value));
}

function sourceDefinesIndependentDisclosureTargets(value: string): boolean {
  return /\b(?:both|each|independently|separately|respectively|freely|any\s+of)\b/i
    .test(normalizedDisclosureText(value));
}

/**
 * Replaces one safe, parent-level candidate with source-member-specific
 * semantic candidates. This is deliberately pre-execution metadata: it does
 * not alter browser steps, routes, fixtures, proof, or readiness rules.
 */
export function specializePlannerSourceMemberSemanticCandidates(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): void {
  const memberLedger = args.plan.sourceDerivedObligationMemberLedger;
  if (memberLedger?.sourceStatus !== "RESOLVED") return;
  const replacements = new Map<string, PlannerBrowserSemanticCandidate[]>();

  for (const candidate of args.semanticIr.candidates) {
    if (
      candidate.obligationIds.length !== 1 ||
      candidate.sourceUnitIds.length !== 1 ||
      !["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(
        String(candidate.proposedMutationClass)
      )
    ) continue;
    const memberSets = memberLedger.memberSets.filter((memberSet) =>
      (memberSet.dimension === "TARGET" || memberSet.dimension === "SURFACE") &&
      memberSet.policy === "ALL_REQUIRED" &&
      memberSet.parentObligationId === candidate.obligationIds[0] &&
      memberSet.sourceUnitRef.sourceUnitId === candidate.sourceUnitIds[0]
    );
    if (memberSets.length !== 1) continue;
    const memberSet = memberSets[0]!;
    const requiredIds = memberSet.members.map((member) => member.memberId).sort();
    if (requiredIds.length < 2) continue;
    // A candidate already bound to one exact source member is a direct
    // execution shell, not a parent that may manufacture another member.
    // The relation is source-ledger-only; model claims never participate.
    if (candidate.proposedTargetSurface !== undefined &&
      memberSet.members.some((member) =>
        normalized(member.canonicalMemberText).toLowerCase() ===
          normalized(candidate.proposedTargetSurface).toLowerCase()
      )) continue;

    const derived = memberSet.members.flatMap((member) => {
      const alreadyRepresented = args.semanticIr.candidates.some((other) =>
        other.candidateId !== candidate.candidateId &&
        other.obligationIds.length === 1 &&
        other.obligationIds[0] === memberSet.parentObligationId &&
        other.sourceUnitIds.length === 1 &&
        other.sourceUnitIds[0] === memberSet.sourceUnitRef.sourceUnitId &&
        (other.sourceMemberSemanticSpecialization?.memberId === member.memberId ||
          (other.proposedTargetSurface !== undefined &&
            normalized(other.proposedTargetSurface).toLowerCase() ===
              normalized(member.canonicalMemberText).toLowerCase()))
      );
      if (alreadyRepresented) return [];
      const candidateId = stablePlanningId("browser-semantic-source-member", [
        candidate.candidateId,
        memberSet.parentObligationId,
        memberSet.sourceUnitRef.sourceUnitId,
        memberSet.memberSetId,
        member.memberId,
      ]);
      return [{
        ...candidate,
        candidateId,
        sourceMemberSemanticSpecialization: {
          schemaVersion: 1 as const,
          kind: "SOURCE_MEMBER_SEMANTIC_SPECIALIZATION_V1" as const,
          parentCandidateId: candidate.candidateId,
          parentCaseId: candidate.proposedCaseId,
          memberSetId: memberSet.memberSetId,
          memberId: member.memberId,
          sourceUnitRef: memberSet.sourceUnitRef,
          exactSourceText: member.exactSourceText,
          canonicalMemberText: member.canonicalMemberText,
          authority: "SOURCE_AUTHORIZED" as const,
        },
      }];
    });
    // Replacing a parent is atomic: every required member must be either
    // represented by an existing exact member candidate or newly derived.
    const representedIds = new Set([
      ...derived.map((item) => item.sourceMemberSemanticSpecialization!.memberId),
      ...args.semanticIr.candidates.flatMap((other) =>
        other.candidateId !== candidate.candidateId &&
        other.obligationIds.length === 1 &&
        other.obligationIds[0] === memberSet.parentObligationId &&
        other.sourceUnitIds.length === 1 &&
        other.sourceUnitIds[0] === memberSet.sourceUnitRef.sourceUnitId &&
        other.sourceMemberSemanticSpecialization?.memberId
          ? [other.sourceMemberSemanticSpecialization.memberId]
          : memberSet.members
            .filter((member) => other.proposedTargetSurface !== undefined &&
              normalized(other.proposedTargetSurface).toLowerCase() ===
                normalized(member.canonicalMemberText).toLowerCase())
            .map((member) => member.memberId)
      ),
    ]);
    if (requiredIds.every((memberId) => representedIds.has(memberId))) {
      replacements.set(candidate.candidateId, derived);
    }
  }

  if (replacements.size > 0) {
    args.semanticIr.candidates = args.semanticIr.candidates.flatMap((candidate) =>
      replacements.get(candidate.candidateId) ?? [candidate]
    );
  }
}

const plannerDisclosureCommandTarget =
  /\b(?:edit|configure|manage)\b/i;

const disclosureObservationActions = new Set([
  "wait", "reload", "setViewport", "clickText",
  "assertUrlContains", "assertUrlNotContains", "assertTextVisible",
  "assertSurfaceControls", "assertTextNotVisible",
]);

function attachSourceBackedReadOnlyDisclosureContracts(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): void {
  for (const testCase of [
    ...args.plan.browserCases,
    ...(args.plan.discoveryBrowserCases ?? []),
  ]) {
    delete testCase.readOnlyDisclosureExecutionContract;
  }
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const sourceById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item])
  );
  const contractsByCaseId = new Map<string, NonNullable<
    BrowserTestCase["readOnlyDisclosureExecutionContract"]
  >[]>();

  for (const candidate of args.semanticIr.candidates) {
    if (candidate.obligationIds.length !== 1) continue;
    const obligation = obligationById.get(candidate.obligationIds[0]!);
    if (
      !obligation ||
      obligation.sourceUnitIds.length !== 1 ||
      !sameIds(candidate.sourceUnitIds, obligation.sourceUnitIds)
    ) continue;
    const source = sourceById.get(obligation.sourceUnitIds[0]!);
    if (
      !source ||
      normalizedDisclosureText(source.text) !==
        normalizedDisclosureText(obligation.text) ||
      !sourceDefinesExistingDetailDisclosure(source.text) ||
      sourceDefinesPersistentInteraction(source.text)
    ) continue;
    const executionCases = candidateExecutionCases(args.plan, candidate);
    if (executionCases.length !== 1) continue;
    const testCase = executionCases[0]!;
    const steps = testCase.steps ?? [];
    const clicks = steps.filter((step) => step.action === "clickText");
    const unsupportedInteraction = steps.some(
      (step) => !disclosureObservationActions.has(step.action)
    );
    if (clicks.length !== 1 || unsupportedInteraction) continue;
    const click = clicks[0]!;
    if (
      !sourceContainsExactTargetPhrase(source.text, click.text) ||
      plannerDisclosureCommandTarget.test(click.text) ||
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: click.text,
      }) !== "TRANSIENT_REVEAL"
    ) continue;
    const contract = {
      schemaVersion: 1 as const,
      contractId: stablePlanningId("readonly-disclosure", [
        candidate.candidateId,
        testCase.id,
        obligation.id,
        source.id,
        normalizedDisclosureText(click.text),
      ]),
      kind: "SOURCE_BACKED_EXISTING_DETAIL_DISCLOSURE" as const,
      authority: "SOURCE_AUTHORIZED" as const,
      obligationId: obligation.id,
      sourceUnitRefs: [{ sourceUnitId: source.id, sourceRef: source.sourceRef }],
      interaction: {
        action: "clickText" as const,
        targetText: click.text,
        ...(click.interactionId ? { interactionId: click.interactionId } : {}),
        targetIdentity: "EXACT_SOURCE_PHRASE" as const,
        runtimeGroundingPolicy: "UNIQUE_EXACT_VISIBLE_TARGET" as const,
      },
      consequence: "TRANSIENT_DETAIL_REVEAL_ONLY" as const,
      proofAuthority: "NONE" as const,
    };
    contractsByCaseId.set(testCase.id, [
      ...(contractsByCaseId.get(testCase.id) ?? []),
      contract,
    ]);
  }

  for (const testCase of args.plan.browserCases) {
    const contracts = contractsByCaseId.get(testCase.id) ?? [];
    if (contracts.length === 1) {
      testCase.readOnlyDisclosureExecutionContract = contracts[0]!;
    }
  }
}

function hasValidReadOnlyDisclosureContract(args: {
  testCase: BrowserTestCase;
  candidate: PlannerBrowserSemanticCandidate | undefined;
  obligations: PlannerAcceptanceObligation[];
}): boolean {
  const contract = args.testCase.readOnlyDisclosureExecutionContract;
  const clicks = (args.testCase.steps ?? []).filter(
    (step) => step.action === "clickText"
  );
  if (!contract || !args.candidate || args.obligations.length !== 1 ||
    clicks.length !== 1) return false;
  const obligation = args.obligations[0]!;
  const click = clicks[0]!;
  return contract.schemaVersion === 1 &&
    contract.kind === "SOURCE_BACKED_EXISTING_DETAIL_DISCLOSURE" &&
    contract.authority === "SOURCE_AUTHORIZED" &&
    contract.proofAuthority === "NONE" &&
    contract.consequence === "TRANSIENT_DETAIL_REVEAL_ONLY" &&
    contract.obligationId === obligation.id &&
    sameIds(args.candidate.obligationIds, [obligation.id]) &&
    sameIds(args.candidate.sourceUnitIds, obligation.sourceUnitIds) &&
    sameIds(
      contract.sourceUnitRefs.map((item) => item.sourceUnitId),
      obligation.sourceUnitIds
    ) &&
    contract.interaction.action === "clickText" &&
    contract.interaction.targetText === click.text &&
    contract.interaction.targetIdentity === "EXACT_SOURCE_PHRASE" &&
    contract.interaction.runtimeGroundingPolicy ===
      "UNIQUE_EXACT_VISIBLE_TARGET" &&
    (args.testCase.steps ?? []).every(
      (step) => disclosureObservationActions.has(step.action)
    );
}

/**
 * Splits an explicitly source-backed multi-disclosure proposal into one
 * execution candidate per independently grounded click. The source remains
 * the authority for target identity; candidate prose only supplies the
 * interaction shell and its assertions.
 */
function expandSourceBackedMultiDisclosureCandidates(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): void {
  type ClickTextStep = Extract<NonNullable<BrowserTestCase["steps"]>[number], {
    action: "clickText";
  }>;
  const sourceById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item])
  );
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const replacements = new Map<string, {
    candidate: PlannerBrowserSemanticCandidate;
    testCase: BrowserTestCase;
  }[]>();

  for (const candidate of args.semanticIr.candidates) {
    if (candidate.obligationIds.length !== 1) continue;
    const obligation = obligationById.get(candidate.obligationIds[0]!);
    if (!obligation || obligation.sourceUnitIds.length !== 1 ||
      !sameIds(candidate.sourceUnitIds, obligation.sourceUnitIds)) continue;
    const source = sourceById.get(obligation.sourceUnitIds[0]!);
    if (!source || normalizedDisclosureText(source.text) !==
      normalizedDisclosureText(obligation.text) ||
      !sourceDefinesExistingDetailDisclosure(source.text) ||
      !sourceDefinesIndependentDisclosureTargets(source.text) ||
      sourceDefinesPersistentInteraction(source.text)) continue;

    const sourceCase = args.plan.browserCases.find(
      (item) => item.id === candidate.proposedCaseId
    );
    const steps = sourceCase?.steps ?? [];
    const clickIndexes = steps.flatMap((step, index) =>
      step.action === "clickText" ? [index] : []
    );
    if (clickIndexes.length < 2) continue;
    if (steps.some((step) => !disclosureObservationActions.has(step.action))) {
      continue;
    }
    const clickTexts = clickIndexes.map((index) => normalizedDisclosureText(
      (steps[index] as ClickTextStep).text
    ));
    if (clickTexts.some((text) => !text) || new Set(clickTexts).size !== clickTexts.length) {
      continue;
    }
    const clicks = clickIndexes.map((index) => steps[index] as ClickTextStep);
    if (clicks.some((click) =>
      !sourceContainsExactTargetPhrase(source.text, click.text) ||
      plannerDisclosureCommandTarget.test(click.text) ||
      classifyGenericBrowserActionSafety({
        actionKind: "click",
        targetSource: "control",
        targetKind: "button",
        label: click.text,
      }) !== "TRANSIENT_REVEAL"
    )) continue;

    const firstClickIndex = clickIndexes[0]!;
    const prelude = steps.slice(0, firstClickIndex);
    const derived = clickIndexes.map((clickIndex, memberIndex) => {
      const nextClickIndex = clickIndexes[memberIndex + 1] ?? steps.length;
      const click = steps[clickIndex] as ClickTextStep;
      const atomicSteps = [
        ...prelude,
        ...steps.slice(clickIndex, nextClickIndex),
      ];
      const memberId = normalizedDisclosureText(click.text);
      const caseId = stablePlanningId("web-disclosure-member", [
        candidate.candidateId,
        obligation.id,
        source.id,
        memberId,
      ]);
      const candidateId = stablePlanningId("browser-semantic-disclosure", [
        candidate.candidateId,
        obligation.id,
        source.id,
        memberId,
      ]);
      const deterministicExecutionExpansion:
        PlannerBrowserDeterministicExecutionExpansion = {
          schemaVersion: 1,
          kind: "SOURCE_BACKED_ATOMIC_MEMBER",
          parentCandidateId: candidate.candidateId,
          parentCaseId: candidate.proposedCaseId,
          memberId,
          memberCount: clickIndexes.length,
          sourceUnitRefs: [{
            sourceUnitId: source.id,
            sourceRef: source.sourceRef,
          }],
          authority: "SOURCE_AUTHORIZED",
        };
      const testCase: BrowserTestCase = {
        ...sourceCase!,
        id: caseId,
        goal: `${sourceCase!.goal} Target: ${click.text}.`,
        steps: atomicSteps,
        deterministicExecutionExpansion,
      };
      const derivedCandidate: PlannerBrowserSemanticCandidate = {
        ...candidate,
        candidateId,
        proposedCaseId: caseId,
        proposedBehavior: `${candidate.proposedBehavior} Target: ${click.text}.`,
        deterministicExecutionExpansion,
      };
      return { candidate: derivedCandidate, testCase };
    });
    replacements.set(candidate.candidateId, derived);
  }

  if (replacements.size === 0) return;
  args.plan.browserCases = args.plan.browserCases.flatMap((testCase) => {
    const candidate = args.semanticIr.candidates.find((item) =>
      item.proposedCaseId === testCase.id
    );
    return candidate && replacements.has(candidate.candidateId)
      ? replacements.get(candidate.candidateId)!.map((item) => item.testCase)
      : [testCase];
  });
  args.semanticIr.candidates = args.semanticIr.candidates.flatMap((candidate) =>
    replacements.get(candidate.candidateId)?.map((item) => item.candidate) ?? [candidate]
  );
}

function candidateExecutionCases(
  plan: TestPlan,
  candidate: PlannerBrowserSemanticCandidate
): BrowserTestCase[] {
  const exact = plan.browserCases.filter(
    (item) => item.id === candidate.proposedCaseId
  );
  const derived = plan.browserCases.filter(
    (item) => item.plannerExecutionShell?.sourceCaseId ===
      candidate.proposedCaseId
  );
  if (exact.length === 1 && derived.length === 0) return exact;
  if (exact.length > 0 || derived.length === 0) return [];

  const partitions = derived.map((item) => item.plannerExecutionShell?.partition);
  const expectedCounts = new Set(partitions.map((item) => item?.memberCount));
  const memberIds = new Set(partitions.map((item) => item?.memberId));
  const complete = partitions.every((item) => item?.mode === "ALL_REQUIRED") &&
    expectedCounts.size === 1 &&
    expectedCounts.has(derived.length) &&
    memberIds.size === derived.length &&
    new Set(derived.map((item) => item.id)).size === derived.length;
  return complete
    ? [...derived].sort((left, right) => left.id.localeCompare(right.id))
    : [];
}

type BrowserExecutionBudgetClass = "RAW_MODEL" | "DERIVED_SOURCE_BACKED";

function validDeterministicExecutionExpansion(args: {
  candidate: PlannerBrowserSemanticCandidate;
  testCase: BrowserTestCase | undefined;
  container: PlannerBrowserExecutionContainer;
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceRefById: Map<string, string>;
  sourceUnit: { id: string; sourceRef: string; text: string };
}): boolean {
  const expansion = args.candidate.deterministicExecutionExpansion;
  const obligation = args.candidate.obligationIds.length === 1
    ? args.obligationLedger.obligations.find(
        (item) => item.id === args.candidate.obligationIds[0]
      )
    : undefined;
  if (!expansion || !obligation || !args.testCase) return false;
  if (
    expansion.schemaVersion !== 1 ||
    expansion.kind !== "SOURCE_BACKED_ATOMIC_MEMBER" ||
    expansion.authority !== "SOURCE_AUTHORIZED" ||
    expansion.parentCandidateId === args.candidate.candidateId ||
    !Number.isInteger(expansion.memberCount) ||
    expansion.memberCount < 1 ||
    expansion.memberCount > MAX_DERIVED_BROWSER_EXECUTION_UNITS ||
    !sameIds(expansion.sourceUnitRefs.map((item) => item.sourceUnitId),
      obligation.sourceUnitIds) ||
    expansion.sourceUnitRefs.some((item) =>
      args.sourceRefById.get(item.sourceUnitId) !== item.sourceRef
    ) ||
    !sameIds(args.candidate.sourceUnitIds, obligation.sourceUnitIds)
  ) return false;

  const source = args.sourceUnit;

  const contract = args.testCase.readOnlyDisclosureExecutionContract;
  const clicks = (args.testCase.steps ?? []).filter(
    (step) => step.action === "clickText"
  );
  if (
    args.container.mutationClass !== "READ_ONLY" ||
    args.container.target.sourceScope.status !== "AUTHORITATIVE" ||
    args.container.target.constraint.status !== "COMPATIBLE" ||
    args.container.executionCaseIds.length === 0 ||
    new Set(args.container.executionCaseIds).size !==
      args.container.executionCaseIds.length ||
    !contract ||
    clicks.length !== 1 ||
    normalizedDisclosureText(expansion.memberId) !==
      normalizedDisclosureText(contract.interaction.targetText) ||
    !hasValidReadOnlyDisclosureContract({
      testCase: args.testCase,
      candidate: args.candidate,
      obligations: [obligation],
    }) ||
    !sourceContainsExactTargetPhrase(source.text, contract.interaction.targetText) ||
    !sourceDefinesExistingDetailDisclosure(source.text) ||
    !sourceDefinesIndependentDisclosureTargets(source.text) ||
    sourceDefinesPersistentInteraction(source.text)
  ) return false;

  const memberId = normalizedDisclosureText(contract.interaction.targetText);
  const expectedCandidateId = stablePlanningId("browser-semantic-disclosure", [
    expansion.parentCandidateId,
    obligation.id,
    source.id,
    memberId,
  ]);
  const expectedCaseId = stablePlanningId("web-disclosure-member", [
    expansion.parentCandidateId,
    obligation.id,
    source.id,
    memberId,
  ]);
  return args.candidate.candidateId === expectedCandidateId &&
    args.candidate.proposedCaseId === expectedCaseId &&
    args.testCase.id === expectedCaseId;
}

function validSourceMemberSemanticSpecialization(args: {
  candidate: PlannerBrowserSemanticCandidate;
  plan: TestPlan;
}): boolean {
  const specialization = args.candidate.sourceMemberSemanticSpecialization;
  const ledger = args.plan.sourceDerivedObligationMemberLedger;
  if (!specialization || ledger?.sourceStatus !== "RESOLVED") return false;
  if (
    specialization.schemaVersion !== 1 ||
    specialization.kind !== "SOURCE_MEMBER_SEMANTIC_SPECIALIZATION_V1" ||
    specialization.authority !== "SOURCE_AUTHORIZED" ||
    specialization.parentCandidateId === args.candidate.candidateId ||
    args.candidate.obligationIds.length !== 1 ||
    args.candidate.obligationIds[0] === undefined ||
    args.candidate.sourceUnitIds.length !== 1 ||
    args.candidate.sourceUnitIds[0] !== specialization.sourceUnitRef.sourceUnitId
  ) return false;
  const memberSet = ledger.memberSets.find((item) =>
    item.memberSetId === specialization.memberSetId &&
    item.parentObligationId === args.candidate.obligationIds[0] &&
    item.sourceUnitRef.sourceUnitId === specialization.sourceUnitRef.sourceUnitId &&
    item.sourceUnitRef.sourceRef === specialization.sourceUnitRef.sourceRef &&
    item.dimension === "TARGET" &&
    item.policy === "ALL_REQUIRED"
  );
  const member = memberSet?.members.find((item) => item.memberId === specialization.memberId);
  return Boolean(member && member.required &&
    member.exactSourceText === specialization.exactSourceText &&
    member.canonicalMemberText === specialization.canonicalMemberText);
}

/**
 * Resolve the source unit used to validate planner-owned expansion metadata.
 * Kept separate from candidate text so a model proposal cannot manufacture
 * derived execution capacity.
 */
function sourceUnitForExpansion(args: {
  obligation: PlannerAcceptanceObligation;
  plan: TestPlan;
}): { id: string; sourceRef: string; text: string } | undefined {
  if (args.obligation.sourceUnitIds.length !== 1) return undefined;
  const source = args.plan.acceptanceSourceLedger?.sourceUnits.find(
    (item) => item.id === args.obligation.sourceUnitIds[0]
  );
  return source
    ? { id: source.id, sourceRef: source.sourceRef, text: source.text }
    : undefined;
}

function executionBudgetClass(args: {
  candidate: PlannerBrowserSemanticCandidate | undefined;
  testCase: BrowserTestCase | undefined;
  container: PlannerBrowserExecutionContainer;
  plan: TestPlan;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): BrowserExecutionBudgetClass {
  if (!args.candidate) return "RAW_MODEL";
  const sourceRefById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceRef])
  );
  const obligation = args.candidate.obligationIds.length === 1
    ? args.obligationLedger.obligations.find(
        (item) => item.id === args.candidate!.obligationIds[0]
      )
    : undefined;
  const source = obligation && sourceUnitForExpansion({
    obligation,
    plan: args.plan,
  });
  // The helper below performs the full source/contract/identity validation.
  // Its source text is supplied through the plan-local ledger, never candidate
  // prose. Missing source units therefore remain raw and keep the conservative
  // direct budget.
  if (!source) return "RAW_MODEL";
  if (validSourceMemberSemanticSpecialization({
    candidate: args.candidate,
    plan: args.plan,
  })) return "DERIVED_SOURCE_BACKED";
  return validDeterministicExecutionExpansion({
    candidate: args.candidate,
    testCase: args.testCase,
    container: args.container,
    obligationLedger: args.obligationLedger,
    sourceRefById,
    sourceUnit: source,
  }) ? "DERIVED_SOURCE_BACKED" : "RAW_MODEL";
}

function retainBoundedExecutionContainers(args: {
  containers: PlannerBrowserExecutionContainer[];
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): {
  retained: PlannerBrowserExecutionContainer[];
  rejected: Map<PlannerBrowserExecutionContainer, string>;
} {
  const candidatesById = new Map(
    args.semanticIr.candidates.map((item) => [item.candidateId, item])
  );
  const sourceCasesById = new Map(
    args.plan.browserCases.map((item) => [item.id, item])
  );
  const retained: PlannerBrowserExecutionContainer[] = [];
  const rejected = new Map<PlannerBrowserExecutionContainer, string>();
  const seenIdentities = new Set<string>();
  let rawCount = 0;
  let derivedCount = 0;

  for (const container of [...args.containers].sort((left, right) =>
    left.executionContainerId.localeCompare(right.executionContainerId)
  )) {
    const candidate = candidatesById.get(container.semanticCandidateId);
    const testCase = candidate
      ? sourceCasesById.get(candidate.proposedCaseId)
      : undefined;
    const budgetClass = executionBudgetClass({
      candidate,
      testCase,
      container,
      plan: args.plan,
      obligationLedger: args.obligationLedger,
    });
    const identity = budgetClass === "DERIVED_SOURCE_BACKED" && candidate
      ? [
          budgetClass,
          ...candidate.obligationIds.slice().sort(),
          candidate.deterministicExecutionExpansion?.memberId ??
            candidate.sourceMemberSemanticSpecialization!.memberId,
          container.route.value ?? "UNRESOLVED",
          container.persona.value ?? "UNRESOLVED",
        ].join("\u0000")
      : [
          budgetClass,
          container.executionContainerId,
          ...container.executionCaseIds,
        ].join("\u0000");
    if (seenIdentities.has(identity)) {
      rejected.set(
        container,
        "The effective execution identity duplicated an already-retained container; the duplicate was rejected without consuming budget."
      );
      continue;
    }
    seenIdentities.add(identity);

    if (retained.length >= MAX_BROWSER_EXECUTION_UNITS) {
      rejected.set(
        container,
        "The global browser execution sanity ceiling was reached; no additional execution unit was materialized."
      );
      continue;
    }
    if (
      budgetClass === "RAW_MODEL" &&
      rawCount >= MAX_RAW_BROWSER_EXECUTION_UNITS
    ) {
      rejected.set(
        container,
        "The raw model execution budget retained at most four direct execution units; deterministic expansion does not bypass this ceiling."
      );
      continue;
    }
    if (
      budgetClass === "DERIVED_SOURCE_BACKED" &&
      derivedCount >= MAX_DERIVED_BROWSER_EXECUTION_UNITS
    ) {
      rejected.set(
        container,
        "The deterministic source-backed expansion exceeded its bounded derived execution ceiling."
      );
      continue;
    }
    retained.push(container);
    if (budgetClass === "RAW_MODEL") rawCount += 1;
    else derivedCount += 1;
  }

  return { retained, rejected };
}

function retainBoundedBrowserCases(args: {
  cases: BrowserTestCase[];
}): BrowserTestCase[] {
  const retained: BrowserTestCase[] = [];
  const seenIds = new Set<string>();
  const seenDerivedIdentities = new Set<string>();
  let rawCount = 0;
  let derivedCount = 0;
  for (const testCase of args.cases) {
    if (seenIds.has(testCase.id)) continue;
    const expansion = testCase.deterministicExecutionExpansion;
    const disclosure = testCase.readOnlyDisclosureExecutionContract;
    const isDerived = expansion?.schemaVersion === 1 &&
      expansion.kind === "SOURCE_BACKED_ATOMIC_MEMBER" &&
      expansion.authority === "SOURCE_AUTHORIZED" &&
      Number.isInteger(expansion.memberCount) &&
      expansion.memberCount >= 1 &&
      expansion.memberCount <= MAX_DERIVED_BROWSER_EXECUTION_UNITS &&
      disclosure?.authority === "SOURCE_AUTHORIZED" &&
      disclosure.proofAuthority === "NONE" &&
      disclosure.consequence === "TRANSIENT_DETAIL_REVEAL_ONLY" &&
      (testCase.steps ?? []).filter((step) => step.action === "clickText")
        .length === 1;
    if (isDerived) {
      const identity = [
        "DERIVED_SOURCE_BACKED",
        ...((testCase.acceptanceObligationIds ?? []).slice().sort()),
        expansion.memberId,
        testCase.startRoute,
        testCase.persona,
      ].join("\u0000");
      if (seenDerivedIdentities.has(identity)) continue;
      if (derivedCount >= MAX_DERIVED_BROWSER_EXECUTION_UNITS) continue;
      seenDerivedIdentities.add(identity);
      derivedCount += 1;
    } else {
      if (rawCount >= MAX_RAW_BROWSER_EXECUTION_UNITS) continue;
      rawCount += 1;
    }
    seenIds.add(testCase.id);
    if (retained.length >= MAX_BROWSER_EXECUTION_UNITS) break;
    retained.push(testCase);
  }
  return retained;
}

/*
 * SPECIALIZED_INVOICE_RESOLVER_EXECUTION_SAFETY_V1
 *
 * The browser step executor does not execute every invoice-shaped clickText
 * as a generic lexical click. A bounded invoice-row request is delegated to
 * resolveAndOpenInvoiceRow(), which probes a finite candidate set, verifies
 * drawer state, and fails closed when the required state cannot be grounded.
 *
 * Planner mutation classification mirrors only that narrow execution
 * capability. Ordinary clickText remains UNKNOWN. This helper grants no
 * fixture, proof, acceptance, or verdict authority.
 */
function hasBoundedRuntimeInvoiceResolverClick(
  testCase: BrowserTestCase
): boolean {
  if (testCase.runtimeFixturePolicy !== "compatible-state") {
    return false;
  }

  const caseText = [
    testCase.goal,
    testCase.successCriteria,
    JSON.stringify(testCase.steps ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  if (!caseText.includes("invoice")) {
    return false;
  }

  const clickTextSteps = (testCase.steps ?? []).filter(
    (step) => step.action === "clickText"
  );

  if (clickTextSteps.length !== 1) {
    return false;
  }

  const requestedText = String(
    clickTextSteps[0]?.text || ""
  )
    .trim()
    .toLowerCase();

  return (
    /^inv[-\s]/i.test(requestedText) ||
    requestedText.includes("invoice number") ||
    requestedText.includes("invoice from fixture") ||
    requestedText.includes("invoice fixture")
  );
}

function actualMutationClass(
  testCase: BrowserTestCase,
  context?: {
    candidate: PlannerBrowserSemanticCandidate | undefined;
    obligations: PlannerAcceptanceObligation[];
  }
): PlannerBrowserSemanticMutationClass {
  const actions = (testCase.steps ?? []).map((step) => step.action);
  if (actions.includes("createDraftJobAndVerifyRedirect")) {
    return "PERSISTENT_BROWSER";
  }
  if (actions.some((action) =>
    ["clickButton", "clickText", "selectOption"].includes(action)
  )) {
    if (
      actions.every((action) =>
        action !== "clickButton" &&
        action !== "selectOption"
      ) &&
      hasBoundedRuntimeInvoiceResolverClick(testCase)
    ) {
      return "READ_ONLY";
    }

    if (context && actions.every((action) => action !== "clickButton" &&
      action !== "selectOption") && hasValidReadOnlyDisclosureContract({
        testCase,
        candidate: context.candidate,
        obligations: context.obligations,
      })) {
      return "READ_ONLY";
    }
    return "UNKNOWN";
  }
  if (actions.some((action) => [
    "clickTopTab", "selectRuntimeTopTab", "openRuntimeControl",
    "openMenu", "selectRuntimeFilterOption",
  ].includes(action))) {
    return "TRANSIENT_REVERSIBLE";
  }
  return "READ_ONLY";
}

/*
 * SOURCE_AUTHORIZED_OBSERVATION_PROJECTION_V1
 *
 * A model-authored interaction may be broader than the source-authorized
 * deterministic proof. This projection is deliberately narrow: it exists
 * only when typed source authority yields a non-empty assertion-only check
 * contract. It may remove candidate interactions from an execution shell; it
 * never promotes those interactions, creates proof authority, or widens the
 * verdict scope.
 */
function sourceAuthorizedObservationOnlyProjection(args: {
  testCase: BrowserTestCase;
  obligations: PlannerAcceptanceObligation[];
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): {
  testCase: BrowserTestCase;
  executionObligationIds: string[];
} | null {
  const candidateObligationIds = [...new Set(args.obligations
    .filter((obligation) =>
      ["ACCEPTANCE", "TASK"].includes(obligation.sourceRole)
    )
    .map((obligation) => obligation.id))].sort();

  if (candidateObligationIds.length === 0) return null;

  const requirementCase: BrowserTestCase = {
    ...args.testCase,
    acceptanceObligationIds: candidateObligationIds,
    startRoute: "/__runtime-binding-pending__",
  };

  const requirements = buildBrowserSourceBoundAssertionSetRequirements({
    testCase: requirementCase,
    obligationLedger: args.obligationLedger,
    sourceLedger: args.sourceLedger,
    acceptedRoutePath: requirementCase.startRoute,
  });

  const approvedDirectTaskObligationIds = new Set(
    requirements
      .filter(hasApprovedCaseLevelSourceBoundAssertionAuthority)
      .filter((requirement) =>
        requirement.proofAuthority === "DIRECT_TASK"
      )
      .map((requirement) => requirement.obligationId)
  );

  const executionObligationIds = candidateObligationIds.filter(
    (obligationId) => {
      const role = args.obligations.find(
        (item) => item.id === obligationId
      )?.sourceRole;

      return role === "ACCEPTANCE" ||
        approvedDirectTaskObligationIds.has(obligationId);
    }
  );

  if (executionObligationIds.length === 0) return null;

  const projectedPendingCase: BrowserTestCase = {
    ...requirementCase,
    acceptanceObligationIds: executionObligationIds,
    steps: (args.testCase.steps ?? []).filter((step) =>
      step.action === "wait" ||
      step.action === "assertTextVisible" ||
      step.action === "assertTextNotVisible"
    ),
  };

  const projectedRequirements =
    buildBrowserSourceBoundAssertionSetRequirements({
      testCase: projectedPendingCase,
      obligationLedger: args.obligationLedger,
      sourceLedger: args.sourceLedger,
      acceptedRoutePath: projectedPendingCase.startRoute,
    });
  const sourceDerivedCheckCarriers =
    buildBrowserSourceDerivedAssertionCheckCarriers({
      testCase: projectedPendingCase,
      requirements: projectedRequirements,
    });
  const projectedCaseWithSourceDerivedCheckCarriers: BrowserTestCase =
    sourceDerivedCheckCarriers.length > 0
      ? {
          ...projectedPendingCase,
          steps: [
            ...(projectedPendingCase.steps ?? []),
            ...sourceDerivedCheckCarriers,
          ],
        }
      : projectedPendingCase;

  const executionCheckContract = deriveBrowserExecutionCheckContract({
    testCase: projectedCaseWithSourceDerivedCheckCarriers,
    sourceBoundAssertionSetRequirements: projectedRequirements,
  });

  if (
    !executionCheckContract ||
    executionCheckContract.requiredChecks.length === 0 ||
    executionCheckContract.requiredChecks.some(
      (check) => check.kind !== "SOURCE_BOUND_ASSERTION_MEMBER"
    )
  ) {
    return null;
  }

  return {
    testCase: {
      ...projectedCaseWithSourceDerivedCheckCarriers,
      startRoute: args.testCase.startRoute,
    },
    executionObligationIds,
  };
}

function proofCapability(
  obligation: PlannerAcceptanceObligation,
  plan: TestPlan
): PlannerBrowserProofCapability {
  const binding = plan.browserObligationBindings?.find(
    (item) => item.obligationId === obligation.id
  );
  if (!binding) {
    return {
      obligationId: obligation.id,
      state: "UNKNOWN",
      requirementIds: [],
      reason: "No deterministic proof-capability binding exists.",
    };
  }
  const state = binding.state === "SUPPORTED_AND_BOUND"
    ? "SUPPORTED_AND_BOUND"
    : binding.state === "SUPPORTED_BUT_UNBOUND"
      ? "SUPPORTED_BUT_UNBOUND"
      : binding.state === "MANUAL_BY_NATURE"
        ? "MANUAL_BY_NATURE"
        : binding.state === "UNSUPPORTED_AUTOMATION_SEMANTIC"
          ? "UNSUPPORTED_AUTOMATION_SEMANTIC"
          : "UNKNOWN";
  return {
    obligationId: obligation.id,
    state,
    requirementIds: [...new Set(binding.emittedRequirementIds ?? [])].sort(),
    reason: binding.reason,
  };
}

function targetContract(testCase: BrowserTestCase | undefined) {
  if (!testCase) {
    return {
      status: "UNRESOLVED" as const,
      basis: "UNAVAILABLE" as const,
    };
  }
  const selected = testCase.routeResolution?.candidates.filter(
    (item) => item.disposition === "SELECTED"
  ) ?? [];
  const authoritative = selected.filter((item) => item.authoritative === true);
  if (authoritative.length > 1) {
    return {
      status: "CONFLICT" as const,
      basis: "UNAVAILABLE" as const,
    };
  }
  if (authoritative.length === 1) {
    const item = authoritative[0]!;
    return {
      status: "AUTHORITATIVE" as const,
      route: item.route,
      ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
      basis: item.origin === "JIRA_EXPLICIT_ROUTE"
        ? "SOURCE_ROUTE" as const
        : "ROUTE_MANIFEST" as const,
    };
  }
  const repositoryValidated = selected.filter((item) =>
    item.confidence === "high" &&
    (
      (item.origin === "GITHUB_ROUTER_MAPPING" &&
        ["VALIDATED", "RESOLVED", "REPLACED"].includes(
          String(testCase.routeResolution?.status)
        )) ||
      (["UI_ROUTE_MANIFEST", "UI_ROUTE_CATALOG"].includes(
        String(item.origin)
      ) && testCase.routeResolution?.status === "VALIDATED")
    )
  );
  if (repositoryValidated.length === 1) {
    const item = repositoryValidated[0]!;
    return {
      status: "AUTHORITATIVE" as const,
      route: item.route,
      ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
      basis: "ROUTE_MANIFEST" as const,
    };
  }
  if (testCase.startRoute && testCase.startRoute !== "UNKNOWN") {
    return {
      status: "CANDIDATE" as const,
      route: testCase.startRoute,
      basis: "PLANNER_CANDIDATE" as const,
    };
  }
  return {
    status: "UNRESOLVED" as const,
    basis: "UNAVAILABLE" as const,
  };
}

function sourceActorObligations(
  obligations: PlannerAcceptanceObligation[]
) {
  return {
    company: obligations.filter((item) =>
      /\b(?:company users?|company admins?|client users?)\b/i.test(item.text)
    ),
    talent: obligations.filter((item) =>
      /\b(?:talents?|scholars?)\s+(?:users?\s+)?(?:can|must|should|see|view|edit|complete|upload)\b/i
        .test(item.text)
    ),
  };
}

function sourceActors(obligations: PlannerAcceptanceObligation[]) {
  const matches = sourceActorObligations(obligations);
  return {
    company: matches.company.length > 0,
    talent: matches.talent.length > 0,
  };
}

function sourceUnitRefs(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
}) {
  return [...new Set(args.obligations.flatMap((item) => item.sourceUnitIds))]
    .sort()
    .flatMap((sourceUnitId) => {
      const sourceRef = args.sourceRefById.get(sourceUnitId);
      const sourceKind = args.sourceKindById.get(sourceUnitId);
      return sourceRef && sourceKind !== "SUMMARY"
        ? [{ sourceUnitId, sourceRef }]
        : [];
    });
}

const targetLexicalStopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for",
  "from", "has", "have", "in", "is", "it", "its", "of", "on", "or",
  "that", "the", "their", "this", "to", "using", "when", "where", "with",
]);

const nonDiscriminativeTargetTokens = new Set([
  "able", "action", "add", "all", "also", "any", "area", "based", "before",
  "between", "button", "can", "client", "control", "correctly", "could", "data",
  "details", "display", "displayed", "existing", "field", "fields", "flow",
  "full", "job", "longer", "modal", "must", "new", "no", "not", "now",
  "once", "page", "profile", "remains", "request", "section", "shown", "should",
  "state", "status", "statuses", "surface", "table", "text", "there", "those",
  "unchanged", "updated", "uses", "using", "view", "visible", "when", "where",
  "who", "will", "won",
]);

function targetLexicalTokens(text: string): string[] {
  return normalized(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((item) => item && !targetLexicalStopwords.has(item));
}

function targetLexicalAnchors(text: string): string[] {
  const tokens = targetLexicalTokens(text);
  const anchors = new Set(tokens.filter(
    (item) => item.length > 2 && !nonDiscriminativeTargetTokens.has(item)
  ));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const phrase = tokens.slice(index, index + 2);
    if (phrase.some((item) =>
      item.length > 2 && !nonDiscriminativeTargetTokens.has(item)
    )) {
      anchors.add(phrase.join(" "));
    }
  }
  return [...anchors].sort();
}

function hasStrongTargetAnchorSet(anchors: string[]): boolean {
  return anchors.some((item) => item.includes(" ")) ||
    anchors.filter((item) => !item.includes(" ")).length >= 2;
}

function obligationTargetConstraint(args: {
  obligation: PlannerAcceptanceObligation;
  candidateSurface?: string | undefined;
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
  /** Exact source-authored page/table members, separate from behavior prose. */
  sourceSurfaceMembers?: string[];
}): PlannerBrowserExecutionContainer["target"]["constraint"]["obligations"][number] {
  const refs = sourceUnitRefs({
    obligations: [args.obligation],
    sourceRefById: args.sourceRefById,
    sourceKindById: args.sourceKindById,
  });
  const sourceAnchors = targetLexicalAnchors(args.obligation.text);
  const candidateAnchors = args.candidateSurface
    ? targetLexicalAnchors(args.candidateSurface)
    : [];
  const matchedAnchors = sourceAnchors.filter((item) =>
    candidateAnchors.includes(item)
  );
  const sourceSurfaceIdentityMatches = args.candidateSurface
    ? sourceBackedSurfaceMatches(
        args.candidateSurface,
        args.sourceSurfaceMembers ?? []
      )
    : [];
  /* A source member is an exact identity, never a generic lexical overlap. */
  const exactSourceSurfaceIdentityMatch =
    sourceSurfaceIdentityMatches.length === 1 &&
    normalized(sourceSurfaceIdentityMatches[0]).toLowerCase() ===
      normalized(args.candidateSurface).toLowerCase();
  const hasSourceSurfaceIdentity =
    (args.sourceSurfaceMembers ?? []).length > 0;
  const strongPhraseMatch = matchedAnchors.some((item) => item.includes(" "));
  const strongTokenMatch = matchedAnchors
    .filter((item) => !item.includes(" ")).length >= 2;
  let basis: PlannerBrowserExecutionContainer["target"]["constraint"]["basis"];
  if (refs.length !== new Set(args.obligation.sourceUnitIds).size) {
    basis = "SOURCE_SCOPE_UNRESOLVED";
  } else if (!args.candidateSurface) {
    basis = "CANDIDATE_SURFACE_UNAVAILABLE";
  } else if (hasSourceSurfaceIdentity) {
    // Typed source member identity supersedes lexical anchors from the whole
    // obligation, which can include the behavior being proved.
    basis = exactSourceSurfaceIdentityMatch
      ? "SOURCE_ANCHOR_MATCH"
      : "NO_STRONG_SOURCE_ANCHOR_MATCH";
  } else if (!hasStrongTargetAnchorSet(sourceAnchors)) {
    basis = "INSUFFICIENT_SOURCE_ANCHORS";
  } else if (strongPhraseMatch || strongTokenMatch) {
    basis = "SOURCE_ANCHOR_MATCH";
  } else {
    basis = "NO_STRONG_SOURCE_ANCHOR_MATCH";
  }
  return {
    obligationId: args.obligation.id,
    status: basis === "SOURCE_ANCHOR_MATCH" ? "COMPATIBLE" : "UNRESOLVED",
    basis,
    sourceAnchors,
    candidateAnchors,
    matchedAnchors,
    sourceUnitRefs: refs,
  };
}

function executionTargetContract(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
  candidateSurface?: string | undefined;
  sourceSurfaceMembers?: string[];
}): PlannerBrowserExecutionContainer["target"] {
  const refs = sourceUnitRefs(args);
  const sourceUnitCount = new Set(
    args.obligations.flatMap((item) => item.sourceUnitIds)
  ).size;
  const sourceScope = (
    args.obligations.length > 0 &&
    refs.length === sourceUnitCount
  )
    ? {
      status: "AUTHORITATIVE",
      surface: [...args.obligations]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => normalized(item.text))
        .join(" "),
      basis: "SOURCE_OBLIGATION",
      sourceUnitRefs: refs,
    } as const
    : { status: "UNRESOLVED", basis: "UNAVAILABLE" } as const;
  const obligations = [...args.obligations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((obligation) => obligationTargetConstraint({
      obligation,
      candidateSurface: args.candidateSurface,
      sourceRefById: args.sourceRefById,
      sourceKindById: args.sourceKindById,
      ...(args.sourceSurfaceMembers
        ? { sourceSurfaceMembers: args.sourceSurfaceMembers }
        : {}),
    }));
  const status = obligations.length > 0 && obligations.every(
    (item) => item.status === "COMPATIBLE"
  ) ? "COMPATIBLE" as const : "UNRESOLVED" as const;
  const basis = status === "COMPATIBLE"
    ? "SOURCE_ANCHOR_MATCH" as const
    : obligations.find((item) => item.status !== "COMPATIBLE")?.basis ??
      "SOURCE_SCOPE_UNRESOLVED" as const;
  return {
    sourceScope,
    ...(args.candidateSurface ? { candidateSurface: args.candidateSurface } : {}),
    constraint: {
      status,
      policy: "ALL_REQUIRED",
      basis,
      obligations,
    },
  };
}

function sourceAuthorizedSurfaceMembers(args: {
  candidate: PlannerBrowserSemanticCandidate | undefined;
  obligations: PlannerAcceptanceObligation[];
  plan: TestPlan;
}): string[] {
  const obligationIds = new Set(args.obligations.map((item) => item.id));
  const candidate = args.candidate;
  if (!candidate || candidate.sourceUnitIds.length !== 1) return [];
  return [...new Set((args.plan.sourceDerivedObligationMemberLedger?.memberSets ?? [])
    .filter((set) => (set.dimension === "SURFACE" || set.dimension === "TARGET") &&
      obligationIds.has(set.parentObligationId) &&
      set.sourceUnitRef.sourceUnitId === candidate.sourceUnitIds[0])
    .flatMap((set) => {
      const specialized = candidate.sourceMemberSemanticSpecialization;
      if (specialized?.memberSetId === set.memberSetId) {
        return set.members.filter((member) => member.memberId === specialized.memberId)
          .map((member) => member.canonicalMemberText);
      }
      // Preserve the whole authoritative set. The target-contract consumer
      // must see that a source surface relation exists before it can reject a
      // behavior-word or partial-overlap candidate without falling back to
      // lexical obligation prose.
      return set.members.map((member) => member.canonicalMemberText);
    }))].sort();
}

/**
 * Select a target only from the source-member ledger. For one member that
 * relation is self-contained; for an ALL_REQUIRED surface set, an existing
 * execution shell may be associated with exactly one member through the
 * already-authoritative static route manifest. Planner target prose is never
 * read here.
 */
function canonicalSourceTargetSurface(args: {
  candidate: PlannerBrowserSemanticCandidate | undefined;
  obligations: PlannerAcceptanceObligation[];
  plan: TestPlan;
  executionCases: BrowserTestCase[];
  knownRoutes?: string[];
}): string | undefined {
  const candidate = args.candidate;
  if (!candidate || candidate.sourceUnitIds.length !== 1) return undefined;
  const obligationIds = new Set(args.obligations.map((item) => item.id));
  const memberSets = (args.plan.sourceDerivedObligationMemberLedger?.memberSets ?? [])
    .filter((set) =>
      (set.dimension === "SURFACE" || set.dimension === "TARGET") &&
      set.policy === "ALL_REQUIRED" &&
      obligationIds.has(set.parentObligationId) &&
      set.sourceUnitRef.sourceUnitId === candidate.sourceUnitIds[0]
    );
  if (memberSets.length !== 1) return undefined;
  const members = memberSets[0]!.members;
  const canonicalMembers = [...new Set(members.map((member) =>
    normalized(member.canonicalMemberText).toLowerCase()
  ).filter(Boolean))];
  if (canonicalMembers.length === 1) return members[0]!.canonicalMemberText;

  const routeBoundMembers = members.filter((member) => {
    const memberRoutes = args.executionCases.flatMap((testCase) => {
      if (testCase.startRoute === "UNKNOWN" ||
        (testCase.persona !== "company_admin" && testCase.persona !== "talent")) {
        return [];
      }
      const resolution = resolveExplicitStaticUiRouteBinding({
        plan: args.plan,
        persona: testCase.persona,
        surface: member.canonicalMemberText,
      });
      return resolution.kind === "UNIQUE_EXACT_BINDING" &&
        resolution.binding.route === testCase.startRoute
        ? [testCase.id]
        : [];
    });
    const knownRouteMatches = (args.knownRoutes ?? []).flatMap((route) =>
      (["company_admin", "talent"] as const).flatMap((persona) => {
        const resolution = resolveExplicitStaticUiRouteBinding({
          plan: args.plan,
          persona,
          // The route catalog requires a surface qualifier. This is used only
          // to compare an already-known route with a source-owned member.
          surface: `${member.canonicalMemberText} page`,
        });
        return resolution.kind === "UNIQUE_EXACT_BINDING" &&
          resolution.binding.route === route
          ? [`${persona}:${route}`]
          : [];
      })
    );
    const selectedRouteIdentityMatches = args.executionCases.flatMap((testCase) =>
      (testCase.routeResolution?.candidates ?? [])
        .filter((item) => item.disposition === "SELECTED")
        .flatMap((item) => item.surfaceIdentity?.canonicalSurface
          ? [item.surfaceIdentity.canonicalSurface]
          : [])
        .filter((surface) =>
          normalized(surface).toLowerCase() ===
            normalized(member.canonicalMemberText).toLowerCase()
        )
    );
    return memberRoutes.length === 1 || selectedRouteIdentityMatches.length === 1 ||
      knownRouteMatches.length === 1;
  });
  return routeBoundMembers.length === 1
    ? routeBoundMembers[0]!.canonicalMemberText
    : undefined;
}

/**
 * A static route manifest is deterministic execution context, not planner
 * persona prose. It may resolve a persona only when every supplied concrete
 * route has one exact manifest persona and they all agree.
 */
function canonicalRuntimeRoutePersona(args: {
  plan: TestPlan;
  sourceSurface?: string | undefined;
  executionCases: BrowserTestCase[];
  knownRoutes?: string[];
}): "company_admin" | "talent" | undefined {
  if (!args.sourceSurface) return undefined;
  const routes = [...new Set([
    ...args.executionCases.map((testCase) => testCase.startRoute),
    ...(args.knownRoutes ?? []),
  ].filter((route): route is string => Boolean(route && route !== "UNKNOWN")))];
  if (routes.length === 0) return undefined;
  const personas = routes.flatMap((route) => {
    const bindings = findExactStaticUiRouteBindings(route);
    const routePersonas = [...new Set(bindings.map((binding) => binding.persona))];
    if (routePersonas.length !== 1) return [];
    const persona = routePersonas[0]!;
    const surfaceBindings = [
      args.sourceSurface!,
      `${args.sourceSurface} page`,
      `${args.sourceSurface} table`,
    ].map((surface) => resolveExplicitStaticUiRouteBinding({
      plan: args.plan,
      persona,
      surface,
    })).filter((resolution) =>
      resolution.kind === "UNIQUE_EXACT_BINDING" &&
      resolution.binding.route === route
    );
    return surfaceBindings.length > 0
      ? [persona]
      : [];
  });
  if (personas.length !== routes.length) return undefined;
  const unique = [...new Set(personas)];
  return unique.length === 1 ? unique[0] : undefined;
}

function executionPersonaContract(args: {
  candidatePersona?: "company_admin" | "talent" | "unknown" | undefined;
  candidateConflict?: boolean | undefined;
  runtimeRoutePersona?: "company_admin" | "talent" | undefined;
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
}): PlannerBrowserExecutionContainer["persona"] {
  const matches = sourceActorObligations(args.obligations);
  if (matches.company.length > 0 && matches.talent.length > 0) {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  const sourcePersona = matches.company.length > 0
    ? "company_admin" as const
    : matches.talent.length > 0
      ? "talent" as const
      : undefined;
  if (sourcePersona) {
    const actorObligations = sourcePersona === "company_admin"
      ? matches.company
      : matches.talent;
    const refs = sourceUnitRefs({
      obligations: actorObligations,
      sourceRefById: args.sourceRefById,
      sourceKindById: args.sourceKindById,
    });
    if (refs.length === 0) {
      return {
        status: "CANDIDATE",
        value: sourcePersona,
        basis: "PLANNER_CANDIDATE",
      };
    }
    return {
      status: "AUTHORITATIVE",
      value: sourcePersona,
      basis: "SOURCE_ACTOR",
      sourceUnitRefs: refs,
    };
  }
  if (args.runtimeRoutePersona) {
    return {
      status: "AUTHORITATIVE",
      value: args.runtimeRoutePersona,
      basis: "PERSONA_SURFACE_BINDING",
    };
  }
  if (args.candidateConflict) {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  if (
    args.candidatePersona === "company_admin" ||
    args.candidatePersona === "talent"
  ) {
    return {
      status: "CANDIDATE",
      value: args.candidatePersona,
      basis: "PLANNER_CANDIDATE",
    };
  }
  return { status: "UNRESOLVED", basis: "UNAVAILABLE" };
}

function executionRouteContract(
  cases: BrowserTestCase[]
): PlannerBrowserExecutionContainer["route"] {
  if (cases.length === 0) {
    return { status: "UNRESOLVED", basis: "UNAVAILABLE" };
  }
  const routes = cases.map(targetContract);
  const signatures = new Set(routes.map((item) => JSON.stringify(item)));
  if (signatures.size !== 1) {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  const route = routes[0]!;
  if (route.status === "AUTHORITATIVE" && route.route) {
    return {
      status: "AUTHORITATIVE",
      value: route.route,
      basis: route.basis,
      ...(route.sourceRef ? { sourceRef: route.sourceRef } : {}),
    };
  }
  if (route.status === "CANDIDATE" && route.route) {
    return {
      status: "CANDIDATE",
      value: route.route,
      basis: "PLANNER_CANDIDATE",
    };
  }
  return { status: route.status, basis: "UNAVAILABLE" };
}

function compatibleExecutionRoute(
  route: PlannerBrowserExecutionContainer["route"],
  target: PlannerBrowserExecutionContainer["target"]
): PlannerBrowserExecutionContainer["route"] {
  if (
    route.status === "AUTHORITATIVE" &&
    route.basis === "SOURCE_ROUTE" &&
    route.sourceRef &&
    !(target.sourceScope.sourceUnitRefs ?? []).some(
      (item) => item.sourceRef === route.sourceRef
    )
  ) {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  return route;
}

function recoverExactStaticExecutionRoute(args: {
  plan: TestPlan;
  persona?: "company_admin" | "talent";
  target: PlannerBrowserExecutionContainer["target"];
  route: PlannerBrowserExecutionContainer["route"];
}): PlannerBrowserExecutionContainer["route"] {
  if (
    args.route.status === "AUTHORITATIVE" ||
    args.target.constraint.status !== "COMPATIBLE" ||
    !args.target.candidateSurface ||
    !args.persona
  ) {
    return args.route;
  }
  const resolution = resolveExplicitStaticUiRouteBinding({
    plan: args.plan,
    persona: args.persona,
    surface: args.target.candidateSurface,
  });
  if (resolution.kind === "NO_BINDING") {
    return args.route;
  }
  if (resolution.kind === "AMBIGUOUS_BINDING") {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  const binding = resolution.binding;
  if (args.route.value === binding.route) {
    return args.route;
  }
  return {
    status: "AUTHORITATIVE",
    value: binding.route,
    basis: "ROUTE_MANIFEST",
    ...(binding.sourceRefs[0] ? { sourceRef: binding.sourceRefs[0] } : {}),
  };
}

function acceptanceActorConstraint(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
}): PlannerBrowserExecutionContainer["acceptanceActorConstraint"] {
  const obligations = [...args.obligations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((obligation) => {
      const refs = sourceUnitRefs({
        obligations: [obligation],
        sourceRefById: args.sourceRefById,
        sourceKindById: args.sourceKindById,
      });
      if (refs.length !== new Set(obligation.sourceUnitIds).size) {
        return {
          obligationId: obligation.id,
          status: "UNRESOLVED" as const,
          basis: "SOURCE_SCOPE_UNRESOLVED" as const,
          sourceUnitRefs: refs,
        };
      }
      const actors = sourceActors([obligation]);
      const actor = actors.company && !actors.talent
        ? "company_admin" as const
        : actors.talent && !actors.company
          ? "talent" as const
          : undefined;
      if (/\bpermission\b/i.test(obligation.text)) {
        return {
          obligationId: obligation.id,
          status: "PRESENT" as const,
          basis: "SOURCE_PERMISSION" as const,
          ...(actor ? { actor } : {}),
          requiredPermissionText: normalized(obligation.text),
          sourceUnitRefs: refs,
        };
      }
      if (actor) {
        return {
          obligationId: obligation.id,
          status: "PRESENT" as const,
          basis: "SOURCE_ACTOR" as const,
          actor,
          sourceUnitRefs: refs,
        };
      }
      return {
        obligationId: obligation.id,
        status: "NONE" as const,
        basis: "NO_SOURCE_CONSTRAINT" as const,
        sourceUnitRefs: refs,
      };
    });
  return {
    status: obligations.some((item) => item.status === "UNRESOLVED")
      ? "UNRESOLVED"
      : obligations.some((item) => item.status === "PRESENT")
        ? "PRESENT"
        : "NONE",
    policy: "ALL_REQUIRED",
    obligations,
  };
}

function acceptanceRouteConstraint(args: {
  obligations: PlannerAcceptanceObligation[];
  route: PlannerBrowserExecutionContainer["route"];
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
}): PlannerBrowserExecutionContainer["acceptanceRouteConstraint"] {
  const obligations = [...args.obligations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((obligation) => {
      const refs = sourceUnitRefs({
        obligations: [obligation],
        sourceRefById: args.sourceRefById,
        sourceKindById: args.sourceKindById,
      });
      if (refs.length !== new Set(obligation.sourceUnitIds).size) {
        return {
          obligationId: obligation.id,
          status: "UNRESOLVED" as const,
          basis: "SOURCE_SCOPE_UNRESOLVED" as const,
          sourceUnitRefs: refs,
        };
      }
      if (
        args.route.status === "AUTHORITATIVE" &&
        args.route.basis === "SOURCE_ROUTE" &&
        args.route.value &&
        args.route.sourceRef &&
        refs.some((item) => item.sourceRef === args.route.sourceRef)
      ) {
        return {
          obligationId: obligation.id,
          status: "PRESENT" as const,
          basis: "SOURCE_ROUTE" as const,
          route: args.route.value,
          sourceUnitRefs: refs,
        };
      }
      return {
        obligationId: obligation.id,
        status: "NONE" as const,
        basis: "NO_SOURCE_CONSTRAINT" as const,
        sourceUnitRefs: refs,
      };
    });
  return {
    status: obligations.some((item) => item.status === "UNRESOLVED")
      ? "UNRESOLVED"
      : obligations.some((item) => item.status === "PRESENT")
        ? "PRESENT"
        : "NONE",
    policy: "ALL_REQUIRED",
    obligations,
  };
}

function executionNavigationBinding(
  route: PlannerBrowserExecutionContainer["route"],
  target: PlannerBrowserExecutionContainer["target"],
  runtimeTargetGrounding?: PlannerRuntimeTargetGroundingContract
): PlannerBrowserExecutionContainer["executionNavigationBinding"] {
  if (
    target.constraint.status !== "COMPATIBLE" && !runtimeTargetGrounding ||
    !route.value
  ) {
    return { status: "UNRESOLVED", basis: "UNAVAILABLE" };
  }
  const exact = findExactStaticUiRouteBindings(route.value);
  const personas = [...new Set(exact.map((item) => item.persona))];
  if (exact.length > 0 && personas.length === 1) {
    return {
      status: "BOUND",
      route: route.value,
      persona: personas[0]!,
      basis: "UI_ROUTE_MANIFEST",
      sourceRefs: [...new Set(exact.map((item) => item.sourceRef))].sort(),
    };
  }
  if (route.status === "AUTHORITATIVE" && route.basis === "SOURCE_ROUTE") {
    return {
      status: "BOUND",
      route: route.value,
      basis: "SOURCE_ROUTE",
      ...(route.sourceRef ? { sourceRefs: [route.sourceRef] } : {}),
    };
  }
  return route.status === "CANDIDATE"
    ? { status: "CANDIDATE", route: route.value, basis: "PLANNER_CANDIDATE" }
    : { status: "UNRESOLVED", basis: "UNAVAILABLE" };
}

function runtimeTargetGroundingContract(args: {
  obligations: PlannerAcceptanceObligation[];
  target: PlannerBrowserExecutionContainer["target"];
  route: PlannerBrowserExecutionContainer["route"];
  persona: PlannerBrowserExecutionContainer["persona"];
  fixture: PlannerBrowserExecutionContainer["fixture"];
  mutationClass: PlannerBrowserSemanticMutationClass;
  sourceRefById: Map<string, string>;
  sourceKindById: Map<string, "ACCEPTANCE_CRITERIA" | "SUMMARY" | "DESCRIPTION">;
  plan: TestPlan;
}): PlannerRuntimeTargetGroundingContract | undefined {
  const targetObligations = args.target.constraint.obligations;
  const hasDeferredTargetMember = targetObligations.some(
    (item) =>
      item.status === "UNRESOLVED" &&
      item.basis === "NO_STRONG_SOURCE_ANCHOR_MATCH"
  );
  const allTargetMembersSourceBoundOrDeferred = targetObligations.every(
    (item) =>
      (
        item.status === "COMPATIBLE" &&
        item.basis === "SOURCE_ANCHOR_MATCH"
      ) ||
      (
        item.status === "UNRESOLVED" &&
        item.basis === "NO_STRONG_SOURCE_ANCHOR_MATCH"
      )
  );

  /*
   * PLANNER_HINTS_NEVER_VETO_RUNTIME_RESOLUTION_V1
   *
   * Planner-time target/route candidates may accelerate runtime resolution,
   * but failure to establish complete lexical compatibility does not by itself
   * veto a source-authoritative, bounded runtime target attempt.
   *
   * Route authority is still established below by deterministic source-route
   * or exact UI-route-manifest metadata; planner provenance never becomes
   * route, target, proof, or verdict authority.
   */
  if (
    args.target.sourceScope.status !== "AUTHORITATIVE" ||
    !args.target.sourceScope.surface ||
    args.target.constraint.status === "COMPATIBLE" ||
    targetObligations.length === 0 ||
    !hasDeferredTargetMember ||
    !allTargetMembersSourceBoundOrDeferred ||
    !args.route.value ||
    args.route.status === "CONFLICT" ||
    !["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(args.mutationClass)
  ) return undefined;

  const bindings = findExactStaticUiRouteBindings(args.route.value);
  const personas = [...new Set(bindings.map((item) => item.persona))];
  const sourceAnchors = new Set(args.target.constraint.obligations.flatMap(
    (item) => item.sourceAnchors
  ));
  if (
    bindings.length === 0 ||
    personas.length !== 1 ||
    !bindings.some((item) => sourceAnchors.has(item.area)) ||
    !args.persona.value ||
    personas[0] !== args.persona.value ||
    args.persona.status === "CONFLICT"
  ) return undefined;

  const authorizedSourceUnitRefs = sourceUnitRefs({
    obligations: args.obligations,
    sourceRefById: args.sourceRefById,
    sourceKindById: args.sourceKindById,
  });
  const obligationIds = args.obligations.map((item) => item.id).sort();
  if (
    authorizedSourceUnitRefs.length !== new Set(
      args.obligations.flatMap((item) => item.sourceUnitIds)
    ).size
  ) return undefined;

  const routeSourceRefs = [...new Set([
    ...bindings.map((item) => item.sourceRef),
    ...(
      args.route.status === "AUTHORITATIVE" &&
      args.route.basis === "SOURCE_ROUTE" &&
      args.route.sourceRef
        ? [args.route.sourceRef]
        : []
    ),
  ])].sort();
  const proofExpectations = args.obligations.map((obligation) => {
    const capabilityState = proofCapability(obligation, args.plan).state;
    return {
      obligationId: obligation.id,
      capabilityState,
      proofAuthority: capabilityState === "SUPPORTED_AND_BOUND"
        ? "DETERMINISTIC_ONLY" as const
        : "NONE" as const,
    };
  }).sort((left, right) => left.obligationId.localeCompare(right.obligationId));
  const allowedInteractionClasses = [
    "OBSERVE",
    "ASSERT_VISIBLE",
    "INTERNAL_NAVIGATION",
    "TRANSIENT_REVEAL",
    ...(args.mutationClass === "TRANSIENT_REVERSIBLE"
      ? ["EXISTING_SEMANTIC_OPTION_SELECTION" as const]
      : []),
  ] as PlannerRuntimeTargetGroundingContract["allowedInteractionClasses"];

  return {
    schemaVersion: 1,
    contractId: stablePlanningId("runtime-target-grounding", [
      ...obligationIds,
      args.route.value,
      args.persona.value,
    ]),
    status: "RUNTIME_TARGET_GROUNDING_REQUIRED",
    authority: "SOURCE_AUTHORIZED",
    obligationIds,
    sourceUnitRefs: authorizedSourceUnitRefs,
    coarseEnvelope: {
      routeKind: "STATIC",
      route: args.route.value,
      routeAuthority:
        args.route.status === "AUTHORITATIVE" &&
        args.route.basis === "SOURCE_ROUTE"
          ? "SOURCE_ROUTE"
          : "UI_ROUTE_MANIFEST",
      routeSourceRefs,
      sourceSurface: args.target.sourceScope.surface,
    },
    persona: {
      value: args.persona.value,
      authority: args.persona.status === "AUTHORITATIVE"
        ? "SOURCE_ACTOR"
        : "ROUTE_ENVELOPE",
    },
    fixtureRequirements: args.fixture.requirements
      .filter((item) => item.authority === "SOURCE_AUTHORIZED")
      .map((item) => ({ ...item, authority: "SOURCE_AUTHORIZED" as const })),
    allowedInteractionClasses,
    forbiddenConsequenceClasses: [
      "PERSISTED_OR_CONSEQUENTIAL_CHANGE",
      "UNKNOWN_CONSEQUENCE",
      "EXTERNAL_NAVIGATION",
    ],
    proofExpectations,
    selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY",
    ambiguityPolicy: "NO_SAFE_ACTION",
    unavailablePolicy: "BLOCK_TARGET_GROUNDING_UNAVAILABLE",
    runtimeBinding: "NOT_YET_RESOLVED",
    targetReadyForInteraction: false,
  };
}

function runtimeNavigationResolutionContract(args: {
  target: PlannerBrowserExecutionContainer["target"];
  route: PlannerBrowserExecutionContainer["route"];
  navigation: PlannerBrowserExecutionContainer["executionNavigationBinding"];
  persona: PlannerBrowserExecutionContainer["persona"];
  runtimeTargetGrounding?: PlannerRuntimeTargetGroundingContract | undefined;
}): PlannerRuntimeNavigationResolutionContract | undefined {
  if (
    (args.target.constraint.status !== "COMPATIBLE" &&
      !args.runtimeTargetGrounding) ||
    !args.target.candidateSurface ||
    args.navigation.status === "BOUND" ||
    args.route.status === "CONFLICT" ||
    args.persona.status === "CONFLICT"
  ) {
    return undefined;
  }
  const discovery = discoverRuntimeNavigationCapability({
    targetSurface: args.target.candidateSurface,
    ...(args.persona.status === "AUTHORITATIVE" && args.persona.value
      ? { sourcePersona: args.persona.value }
      : {}),
    ...(args.persona.value ? { candidatePersona: args.persona.value } : {}),
  });
  return discovery.status === "AVAILABLE"
    ? discovery.capability
    : undefined;
}

function runtimeSessionConfigured(persona: "company_admin" | "talent"): boolean {
  const personaIdentity = persona === "company_admin"
    ? process.env.QA_COMPANY_EMAIL
    : process.env.QA_TALENT_EMAIL;
  return Boolean(
    personaIdentity &&
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY &&
    process.env.VITE_FIREBASE_API_KEY &&
    process.env.VITE_FIREBASE_AUTH_DOMAIN &&
    process.env.VITE_FIREBASE_PROJECT_ID
  );
}

function executionSessionBinding(args: {
  navigation: PlannerBrowserExecutionContainer["executionNavigationBinding"];
  runtimeNavigation?: PlannerRuntimeNavigationResolutionContract | undefined;
  candidatePersona?: "company_admin" | "talent";
}): PlannerBrowserExecutionContainer["executionSessionBinding"] {
  if (args.navigation.status === "BOUND" && args.navigation.persona) {
    return runtimeSessionConfigured(args.navigation.persona)
      ? {
          status: "BOUND",
          persona: args.navigation.persona,
          basis: "RUNTIME_SESSION_CONFIG",
        }
      : { status: "UNRESOLVED", basis: "UNAVAILABLE" };
  }
  if (args.runtimeNavigation) {
    return runtimeSessionConfigured(args.runtimeNavigation.persona)
      ? {
          status: "BOUND",
          persona: args.runtimeNavigation.persona,
          basis: "RUNTIME_SESSION_CONFIG",
          personaSource: "PARAMETERIZED_RUNTIME_NAVIGATION_CAPABILITY",
        }
      : { status: "UNRESOLVED", basis: "UNAVAILABLE" };
  }
  return args.candidatePersona
    ? {
        status: "CANDIDATE",
        persona: args.candidatePersona,
        basis: "PLANNER_CANDIDATE",
      }
    : { status: "UNRESOLVED", basis: "UNAVAILABLE" };
}

function actorCompatibility(args: {
  constraint: PlannerBrowserExecutionContainer["acceptanceActorConstraint"];
  session: PlannerBrowserExecutionContainer["executionSessionBinding"];
}): PlannerBrowserExecutionContainer["actorCompatibility"] {
  const obligations = args.constraint.obligations.map((item) => {
    if (item.status === "NONE") {
      return {
        obligationId: item.obligationId,
        status: "NO_CONSTRAINT" as const,
        reason: "The authoritative source imposes no actor constraint.",
      };
    }
    if (item.status === "UNRESOLVED" || args.session.status !== "BOUND") {
      return {
        obligationId: item.obligationId,
        status: "UNRESOLVED" as const,
        reason: "The source actor constraint or execution session is unresolved.",
      };
    }
    if (item.basis === "SOURCE_PERMISSION") {
      return {
        obligationId: item.obligationId,
        status: "UNRESOLVED" as const,
        reason: "Configured runtime session metadata does not prove the named source permission.",
      };
    }
    const satisfied = item.actor === args.session.persona;
    return {
      obligationId: item.obligationId,
      status: satisfied ? "SATISFIED" as const : "UNSATISFIED" as const,
      reason: satisfied
        ? "The bound runtime session satisfies the explicit source actor constraint."
        : "The bound runtime session conflicts with the explicit source actor constraint.",
    };
  });
  const statuses = new Set(obligations.map((item) => item.status));
  return {
    status: statuses.has("UNSATISFIED")
      ? "UNSATISFIED"
      : statuses.has("UNRESOLVED")
        ? "UNRESOLVED"
        : statuses.has("SATISFIED")
          ? "SATISFIED"
          : "NO_CONSTRAINT",
    policy: "ALL_REQUIRED",
    obligations,
  };
}

function composedLink(args: {
  executionContainerId: string;
  executionCaseIds: string[];
  target: PlannerBrowserExecutionContainer["target"];
  route: PlannerBrowserExecutionContainer["route"];
  session: PlannerBrowserExecutionContainer["executionSessionBinding"];
  actor: PlannerBrowserExecutionContainer["actorCompatibility"];
  navigation?: PlannerRuntimeNavigationResolutionContract | undefined;
  fixture?: PlannerRuntimeFixtureResolutionContract | undefined;
}): PlannerComposedRuntimeResolutionLink | undefined {
  if (args.executionCaseIds.length !== 1 || args.target.constraint.status !== "COMPATIBLE" ||
    args.route.status === "CONFLICT" || args.session.status !== "BOUND" ||
    args.session.basis !== "RUNTIME_SESSION_CONFIG" || args.session.persona !== "talent" ||
    !["NO_CONSTRAINT", "SATISFIED"].includes(args.actor.status)) return undefined;
  return linkComposedRuntimeCapabilities({
    executionContainerId: args.executionContainerId,
    executionCaseId: args.executionCaseIds[0]!,
    navigation: args.navigation, fixture: args.fixture,
  });
}

function executionReadiness(args: {
  executionCaseCount: number;
  target: PlannerBrowserExecutionContainer["target"];
  route: PlannerBrowserExecutionContainer["route"];
  navigation: PlannerBrowserExecutionContainer["executionNavigationBinding"];
  session: PlannerBrowserExecutionContainer["executionSessionBinding"];
  actorCompatibility: PlannerBrowserExecutionContainer["actorCompatibility"];
  fixture: PlannerBrowserExecutionContainer["fixture"];
  runtimeNavigation?: PlannerRuntimeNavigationResolutionContract | undefined;
  runtimeFixtureResolution?: PlannerRuntimeFixtureResolutionContract | undefined;
  composedRuntimeResolution?: PlannerComposedRuntimeResolutionLink | undefined;
  runtimeTargetGrounding?: PlannerRuntimeTargetGroundingContract | undefined;
  mutationClass: PlannerBrowserSemanticMutationClass;
}): Pick<PlannerBrowserExecutionContainer, "readiness" | "reason"> {
  if (args.executionCaseCount === 0) {
    return {
      readiness: "CANDIDATE_UNAVAILABLE",
      reason: "No exact or complete required execution-shell binding exists for the accepted semantic candidate.",
    };
  }
  if (args.target.constraint.status !== "COMPATIBLE" &&
    !args.runtimeTargetGrounding) {
    return {
      readiness: "TARGET_UNRESOLVED",
      reason: "Target candidate lacks an ALL_REQUIRED source-anchored semantic constraint match.",
    };
  }
  if (args.navigation.status !== "BOUND" && !args.runtimeNavigation) {
    return {
      readiness: "NAVIGATION_UNRESOLVED",
      reason: "No exact deterministic execution navigation binding exists for the compatible target.",
    };
  }
  if (args.session.status !== "BOUND") {
    return {
      readiness: "SESSION_UNRESOLVED",
      reason: "No configured runtime session is bound through deterministic navigation metadata.",
    };
  }
  if (!["NO_CONSTRAINT", "SATISFIED"].includes(args.actorCompatibility.status)) {
    return {
      readiness: "ACTOR_CONSTRAINT_UNRESOLVED",
      reason: "The bound runtime session does not prove every explicit source actor or permission constraint.",
    };
  }
  if (
    args.runtimeNavigation &&
    args.runtimeFixtureResolution?.status ===
      "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
  ) {
    if (args.composedRuntimeResolution && !["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(args.mutationClass)) {
      return { readiness: "POLICY_BLOCKED", reason: "Composed preparation does not authorize persistent or unknown interaction semantics." };
    }
    return {
      readiness: args.composedRuntimeResolution
        ? "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
        : "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED",
      reason: "A unique authoritative parameterized route and registered read-only resolver are available, but both runtime navigation identity and runtime fixture identity remain unresolved.",
    };
  }
  if (
    args.runtimeFixtureResolution?.status ===
      "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
  ) {
    return {
      readiness: "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION",
      reason: "Every required execution-shell fixture member has a source-backed constraint and a read-only fail-closed resolver capability; current runtime bindings remain unresolved.",
    };
  }
  /*
   * Candidate-only planner fixture hints are useful planning context, not an
   * execution veto. When the source-authorized runtime target contract carries
   * no fixture prerequisite, bounded read-only/transient grounding may proceed.
   *
   * Source-authorized fixture requirements still use the existing fail-closed
   * runtime fixture-resolution path above.
   */
  if (
    args.runtimeTargetGrounding &&
    args.runtimeTargetGrounding.fixtureRequirements.length === 0
  ) {
    if (![
      "READ_ONLY",
      "TRANSIENT_REVERSIBLE",
    ].includes(args.mutationClass)) {
      return {
        readiness: "POLICY_BLOCKED",
        reason:
          "Runtime target grounding does not authorize persistent or unknown interaction semantics.",
      };
    }

    return {
      readiness: "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING",
      reason:
        "Authoritative source intent and a deterministic route/persona envelope permit bounded runtime target grounding; candidate-only planner fixture hints do not create an execution veto.",
    };
  }

  if (args.fixture.status !== "READY") {
    return { readiness: "FIXTURE_UNAVAILABLE", reason: args.fixture.reason };
  }
  if (args.runtimeNavigation) {
    return {
      readiness: "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED",
      reason: "A unique authoritative parameterized route and registered read-only resolver are available; the concrete runtime identity and navigation binding remain unresolved.",
    };
  }
  if (![
    "READ_ONLY", "TRANSIENT_REVERSIBLE",
  ].includes(args.mutationClass)) {
    return {
      readiness: "POLICY_BLOCKED",
      reason: "The execution shell is not read-only or activation-safe under current planner policy.",
    };
  }
  if (args.runtimeTargetGrounding) {
    return {
      readiness: "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING",
      reason: "The exact live target is unresolved, but authoritative obligations, a unique coarse route/persona envelope, fixture policy, interaction limits, and proof expectations are preserved for fail-closed runtime grounding.",
    };
  }
  return {
    readiness: "READY",
    reason: "The accepted semantic candidate has a complete, authority-safe execution shell.",
  };
}

function discoveryOnlyEligible(args: {
  target: PlannerBrowserExecutionContainer["target"];
  persona: PlannerBrowserExecutionContainer["persona"];
  actorConstraint: PlannerBrowserExecutionContainer["acceptanceActorConstraint"];
  mutationClass: PlannerBrowserSemanticMutationClass;
  readiness: PlannerBrowserExecutionContainer["readiness"];
}): boolean {
  const targetMembers = args.target.constraint.obligations;

  const targetMembersSourceBoundOrDeferred =
    targetMembers.length > 0 &&
    targetMembers.every((item) =>
      item.sourceUnitRefs.length > 0 &&
      (
        (
          item.status === "COMPATIBLE" &&
          item.basis === "SOURCE_ANCHOR_MATCH"
        ) ||
        (
          item.status === "UNRESOLVED" &&
          item.basis === "NO_STRONG_SOURCE_ANCHOR_MATCH"
        )
      )
    );

  const targetShapeIsDiscoverySafe =
    (
      args.target.constraint.status === "COMPATIBLE" &&
      args.target.constraint.basis === "SOURCE_ANCHOR_MATCH"
    ) ||
    (
      args.target.constraint.status === "UNRESOLVED" &&
      args.target.constraint.basis === "NO_STRONG_SOURCE_ANCHOR_MATCH"
    );

  /*
   * SOURCE_AUTHORIZED_DEFERRED_TARGET_DISCOVERY_V1
   *
   * Lexical target grounding is an optimization, not a prerequisite for
   * bounded read-only discovery. Source-authoritative obligations with only
   * source-bound or explicitly deferred target members may enter the existing
   * DISCOVERY_ONLY lane.
   *
   * This grants execution reach only. It does not promote target, route,
   * fixture, proof, acceptance, or verdict authority.
   */
  return [
    "TARGET_UNRESOLVED",
    "NAVIGATION_UNRESOLVED",
    "FIXTURE_UNAVAILABLE",
  ].includes(args.readiness) &&
    args.target.sourceScope.status === "AUTHORITATIVE" &&
    args.target.sourceScope.basis === "SOURCE_OBLIGATION" &&
    Boolean(args.target.candidateSurface) &&
    targetShapeIsDiscoverySafe &&
    targetMembersSourceBoundOrDeferred &&
    args.mutationClass === "READ_ONLY" &&
    (args.persona.value === "company_admin" || args.persona.value === "talent") &&
    args.persona.status !== "CONFLICT" &&
    args.actorConstraint.status !== "UNRESOLVED";
}

function personaContract(args: {
  testCase?: BrowserTestCase | undefined;
  obligations: PlannerAcceptanceObligation[];
}) {
  const actors = sourceActors(args.obligations);
  if (actors.company && actors.talent) {
    return { status: "CONFLICT" as const, basis: "UNAVAILABLE" as const };
  }
  const sourcePersona = actors.company
    ? "company_admin" as const
    : actors.talent
      ? "talent" as const
      : undefined;
  if (sourcePersona) {
    return args.testCase?.persona === sourcePersona
      ? {
          status: "AUTHORITATIVE" as const,
          value: sourcePersona,
          basis: "SOURCE_ACTOR" as const,
        }
      : { status: "CONFLICT" as const, basis: "UNAVAILABLE" as const };
  }
  if (args.testCase?.persona === "company_admin" || args.testCase?.persona === "talent") {
    return {
      status: "CANDIDATE" as const,
      value: args.testCase.persona,
      basis: "PLANNER_CANDIDATE" as const,
    };
  }
  return { status: "UNRESOLVED" as const, basis: "UNAVAILABLE" as const };
}

function fixtureContract(args: {
  candidate?: PlannerBrowserSemanticCandidate | undefined;
  testCase?: BrowserTestCase | undefined;
  obligations: PlannerAcceptanceObligation[];
}) {
  const proposed = args.candidate?.proposedFixtureNeeds ?? [];
  const sourceText = new Map(
    args.obligations.map((item) => [item.id, normalized(item.text).toLowerCase()])
  );
  const requirements = proposed.map((item) => {
    const grounded = item.obligationIds.every((id) =>
      sourceText.get(id)?.includes(normalized(item.text).toLowerCase())
    );
    return {
      text: item.text,
      obligationIds: item.obligationIds,
      authority: grounded
        ? "SOURCE_AUTHORIZED" as const
        : "CANDIDATE_ONLY" as const,
    };
  });
  const rawRequirements = args.testCase?.fixtureRequirements ?? [];
  if (requirements.length === 0 && rawRequirements.length === 0) {
    return {
      status: "READY" as const,
      requirements,
      reason: "The verdict contract requires no runtime fixture state.",
    };
  }
  const allGrounded = requirements.length > 0 &&
    requirements.every((item) => item.authority === "SOURCE_AUTHORIZED");
  const identity = args.testCase?.fixtureIdentityAuthority?.authority;
  const resolverReady =
    identity === "EXPLICIT_SOURCE_IDENTITY" ||
    (identity === "NONE" &&
      args.testCase?.runtimeFixturePolicy === "compatible-state");
  if (allGrounded && resolverReady) {
    return {
      status: "READY" as const,
      requirements,
      reason: "Every fixture need is obligation-traceable and an existing identity policy can resolve it.",
    };
  }
  return {
    status: identity === "SOURCE_UNAVAILABLE"
      ? "UNAVAILABLE" as const
      : "UNKNOWN" as const,
    requirements,
    reason: "Fixture needs are speculative, untraceable, ambiguous, or lack an existing resolver authority.",
  };
}

type FixtureShellInput = {
  executionCaseId: string;
  sourceCaseId: string;
  partition: {
    mode: "ALL_REQUIRED";
    memberId: string;
    memberCount: number;
  };
  runtimeFixturePolicy?: "exact" | "compatible-state";
  plannerInvoiceState?: unknown;
};

function canonicalInvoiceState(value: unknown):
  | "processed"
  | "sent-for-processing"
  | undefined {
  const state = normalized(value).toLowerCase().replace(/\s+/g, "-");
  return state === "processed" || state === "sent-for-processing"
    ? state
    : undefined;
}

function sourceContainsInvoiceState(
  text: string,
  state: "processed" | "sent-for-processing"
): boolean {
  const value = normalized(text).toLowerCase();
  return value.includes("invoice") && (
    state === "processed"
      ? /\bprocessed\b/.test(value)
      : /\bsent[\s-]+for[\s-]+processing\b/.test(value)
  );
}

function invoiceStatesInText(
  text: string
): Array<"processed" | "sent-for-processing"> {
  const value = normalized(text).toLowerCase();
  if (!value.includes("invoice")) return [];
  return [
    ...(/\bprocessed\b/.test(value)
      ? ["processed" as const]
      : []),
    ...(/\bsent[\s-]+for[\s-]+processing\b/.test(value)
      ? ["sent-for-processing" as const]
      : []),
  ];
}

/**
 * The practical BrowserTestCase author proposes an execution unit only. An
 * atomic state becomes a fixture member solely when the exact same state is
 * present in an authoritative obligation. This makes combined and atomic
 * authoring equivalent without promoting model fixture prose to authority.
 */
function practicalAtomicFixtureShell(
  testCase: BrowserTestCase,
  obligations: PlannerAcceptanceObligation[]
): FixtureShellInput | undefined {
  const sourceCapability = obligations.length === 1
    ? sourceInvoiceCapabilityForObligation(obligations[0]!)
    : undefined;
  if (sourceCapability) {
    const shellState = String(
      testCase.plannerExecutionShell?.partition?.memberId ?? ""
    ).toLowerCase();
    const modelStates = invoiceStatesInText([
      testCase.goal,
      testCase.successCriteria,
      JSON.stringify(testCase.steps ?? []),
    ].join(" "));
    const modelState = modelStates.length === 1
      ? modelStates[0]
      : undefined;
    if (modelState && !sourceCapability.requiredStates.includes(modelState)) {
      return undefined;
    }
    const state: SourceInvoiceState | undefined =
      sourceCapability.requiredStates.length === 1
        ? sourceCapability.requiredStates[0]
        : sourceCapability.requiredStates.find((item) =>
          item === shellState || item === modelState
        );
    if (!state) return undefined;
    return {
      executionCaseId: testCase.id,
      sourceCaseId: testCase.plannerExecutionShell?.sourceCaseId ?? testCase.id,
      partition: {
        mode: "ALL_REQUIRED",
        memberId: state,
        memberCount: 1,
      },
      ...(testCase.runtimeFixturePolicy
        ? { runtimeFixturePolicy: testCase.runtimeFixturePolicy }
        : {}),
      plannerInvoiceState: state,
    };
  }
  return undefined;
}

/**
 * Expands only a complete source-defined surface set crossed with an existing
 * source-backed atomic fixture dimension. The model candidate supplies the
 * interaction proposal; source text supplies every derived member identity.
 * This creates execution proposals only and grants no proof or verdict
 * authority.
 */
function expandSourceBackedMultiSurfaceAtomicExecutionProposals(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  verdictGrouping: PlannerAcceptanceVerdictGrouping;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): void {
  const sourceRefById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceRef])
  );
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const replacementCases = new Map<string, BrowserTestCase[]>();
  const replacementCandidates = new Map<
    string,
    PlannerBrowserSemanticCandidate[]
  >();

  for (const group of args.verdictGrouping.groups) {
    if (
      group.relationship !== "ATOMIC" ||
      group.authority.status !== "AUTHORITATIVE" ||
      group.obligationIds.length !== 1
    ) continue;

    const obligation = obligationById.get(group.obligationIds[0]!);
    if (!obligation) continue;
    const surfaces = sourceBackedPageSurfaces(obligation.text);
    if (surfaces.length < 2) continue;
    if (
      obligation.sourceUnitIds.some((id) => !sourceRefById.has(id)) ||
      new Set(surfaces.map(sourceBackedSurfaceMemberId)).size !== surfaces.length
    ) continue;

    const requiredStates = sourceBackedInvoiceStates([obligation]);
    if (requiredStates.length < 2) continue;
    const candidates = args.semanticIr.candidates.filter((candidate) =>
      sameIds(candidate.obligationIds, [obligation.id])
    );
    if (candidates.length !== requiredStates.length) continue;

    const atomic = candidates.flatMap((candidate) => {
      if (!sameIds(candidate.sourceUnitIds, obligation.sourceUnitIds)) return [];
      const candidateSurfaces = sourceBackedPageSurfaces(
        candidate.proposedTargetSurface ?? ""
      );
      if (!sameIds(candidateSurfaces, surfaces)) return [];
      const executionCases = candidateExecutionCases(args.plan, candidate);
      if (executionCases.length !== 1) return [];
      const shell = practicalAtomicFixtureShell(executionCases[0]!, [obligation]);
      const state = shell && canonicalInvoiceState(shell.partition.memberId);
      return state ? [{ candidate, testCase: executionCases[0]!, state }] : [];
    });
    if (
      atomic.length !== candidates.length ||
      !sameIds(atomic.map((item) => item.state), requiredStates)
    ) continue;

    const derived = atomic.flatMap(({ candidate, testCase, state }) =>
      surfaces.flatMap((surface) => {
        const actors = sourceActors([obligation]);
        const persona = actors.company && !actors.talent
          ? "company_admin" as const
          : actors.talent && !actors.company
            ? "talent" as const
            : !actors.company && !actors.talent
              ? candidate.proposedPersona
              : undefined;
        if (persona !== "company_admin" && persona !== "talent") return [];
        const resolution = resolveExplicitStaticUiRouteBinding({
          plan: args.plan,
          persona,
          surface: `${surface} table`,
        });
        if (resolution.kind !== "UNIQUE_EXACT_BINDING") return [];
        const binding = resolution.binding;
        const surfaceMemberId = sourceBackedSurfaceMemberId(surface);
        const caseId = stablePlanningId("web-surface-member", [
          testCase.id,
          obligation.id,
          surfaceMemberId,
          state,
        ]);
        const candidateId = stablePlanningId("browser-semantic-surface", [
          candidate.candidateId,
          obligation.id,
          surfaceMemberId,
          state,
        ]);
        const derivedCase: BrowserTestCase = {
          ...testCase,
          id: caseId,
          startRoute: binding.route,
          routeResolution: {
            status: "VALIDATED",
            originalRoute: testCase.startRoute,
            selectedRoute: binding.route,
            confidence: "high",
            totalCandidateCount: 1,
            candidates: [{
              route: binding.route,
              confidence: "high",
              source: "ui-route-catalog",
              origin: "UI_ROUTE_MANIFEST",
              authoritative: false,
              ...(binding.sourceRefs[0]
                ? { sourceRef: binding.sourceRefs[0] }
                : {}),
              reason: "Exact source-defined execution surface matched one static route binding.",
              evidence: ["EXPLICIT_CASE_SURFACE_REFERENCE"],
              disposition: "SELECTED",
            }],
          },
          plannerExecutionShell: {
            sourceCaseId: testCase.id,
            partition: {
              mode: "ALL_REQUIRED",
              memberId: state,
              memberCount: 1,
            },
          },
        };
        const derivedCandidate: PlannerBrowserSemanticCandidate = {
          ...candidate,
          candidateId,
          proposedCaseId: caseId,
          proposedTargetSurface: `${surface} table`,
        };
        return [{
          sourceCaseId: testCase.id,
          sourceCandidateId: candidate.candidateId,
          testCase: derivedCase,
          candidate: derivedCandidate,
        }];
      })
    );
    if (derived.length !== atomic.length * surfaces.length) continue;

    for (const item of derived) {
      replacementCases.set(item.sourceCaseId, [
        ...(replacementCases.get(item.sourceCaseId) ?? []),
        item.testCase,
      ]);
      replacementCandidates.set(item.sourceCandidateId, [
        ...(replacementCandidates.get(item.sourceCandidateId) ?? []),
        item.candidate,
      ]);
    }
  }

  if (replacementCandidates.size === 0) return;
  args.plan.browserCases = args.plan.browserCases.flatMap((testCase) =>
    replacementCases.get(testCase.id) ?? [testCase]
  ).sort((left, right) => left.id.localeCompare(right.id));
  args.semanticIr.candidates = args.semanticIr.candidates.flatMap((candidate) =>
    replacementCandidates.get(candidate.candidateId) ?? [candidate]
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function freshFixtureShells(
  executionCases: BrowserTestCase[],
  obligations: PlannerAcceptanceObligation[]
): FixtureShellInput[] {
  return executionCases.flatMap((testCase) => {
    const shell = testCase.plannerExecutionShell;
    if (!shell || shell.partition.mode !== "ALL_REQUIRED") {
      const atomic = practicalAtomicFixtureShell(testCase, obligations);
      return atomic ? [atomic] : [];
    }
    const plannerInvoiceState = (testCase as BrowserTestCase & {
      __plannerInvoiceState?: unknown;
    }).__plannerInvoiceState;
    return [{
      executionCaseId: testCase.id,
      sourceCaseId: shell.sourceCaseId,
      partition: shell.partition,
      ...(testCase.runtimeFixturePolicy
        ? { runtimeFixturePolicy: testCase.runtimeFixturePolicy }
        : {}),
      plannerInvoiceState,
    }];
  });
}

/**
 * Compatibility decoder for archived V2 audits written before typed fixture
 * members were serialized. It recognizes only identities emitted by the
 * canonical two-member invoice split; arbitrary case IDs carry no authority.
 */
function archivedFixtureShells(
  container: PlannerBrowserExecutionContainer
): FixtureShellInput[] {
  if (container.requiredExecutionCaseIds.length !== 2) return [];
  const known = [
    { suffix: "-processed", memberId: "processed" },
    { suffix: "-sent", memberId: "sent-for-processing" },
  ] as const;
  return container.requiredExecutionCaseIds.flatMap((executionCaseId) => {
    const match = known.find((item) =>
      executionCaseId === `${container.sourceCaseId}${item.suffix}`
    );
    return match ? [{
      executionCaseId,
      sourceCaseId: container.sourceCaseId,
      partition: {
        mode: "ALL_REQUIRED" as const,
        memberId: match.memberId,
        memberCount: 2,
      },
      runtimeFixturePolicy: "compatible-state" as const,
      plannerInvoiceState: match.memberId,
    }] : [];
  });
}

function invoiceRuntimeFixtureResolutionContract(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  persona?: string | undefined;
  executionCases?: BrowserTestCase[] | undefined;
  archivedContainer?: PlannerBrowserExecutionContainer | undefined;
}): PlannerRuntimeFixtureResolutionContract | undefined {
  const shells = args.executionCases
    ? freshFixtureShells(args.executionCases, args.obligations)
    : args.archivedContainer
      ? archivedFixtureShells(args.archivedContainer)
      : [];
  if (shells.length === 0) return undefined;

  const expectedMemberCount = new Set(
    shells.map((item) => item.partition.memberCount)
  );
  const complete = expectedMemberCount.size === 1 &&
    expectedMemberCount.has(shells.length) &&
    new Set(shells.map((item) => item.partition.memberId)).size === shells.length;

  const members: PlannerRuntimeFixtureResolutionContract["members"] =
    shells.map((shell) => {
    const state = canonicalInvoiceState(shell.partition.memberId);
    const plannerState = canonicalInvoiceState(shell.plannerInvoiceState);
    const stateMetadataConsistent = Boolean(
      state && (!plannerState || plannerState === state)
    );
    const supporting = state && stateMetadataConsistent
      ? args.obligations.filter((item) => sourceContainsInvoiceState(item.text, state))
      : [];
    const sourceHasExactIdentity = supporting.some((item) =>
      /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/i.test(item.text) ||
      /\binvoice(?:[ _-]*id|Id)\s*(?::|=|#)/i.test(item.text)
    );
    const compatible = complete && state && stateMetadataConsistent &&
      supporting.length > 0 &&
      args.persona === "company_admin" &&
      shell.runtimeFixturePolicy === "compatible-state" &&
      !sourceHasExactIdentity;
    const sourceUnitRefs = [...new Set(supporting.flatMap(
      (item) => item.sourceUnitIds
    ))].sort().map((sourceUnitId) => ({
      sourceUnitId,
      sourceRef: args.sourceRefById.get(sourceUnitId) ?? "UNAVAILABLE",
    }));
    return {
      executionCaseId: shell.executionCaseId,
      required: true,
      ...(compatible ? {
        acceptanceFixtureConstraint: {
          executionCaseId: shell.executionCaseId,
          sourceCaseId: shell.sourceCaseId,
          partition: shell.partition,
          fixtureKind: "invoice" as const,
          semantic: { kind: "STATE" as const, state },
          obligationIds: supporting.map((item) => item.id).sort(),
          sourceUnitRefs,
          identityPolicy: "compatible-state" as const,
          authority: "SOURCE_AUTHORIZED" as const,
        },
        fixtureResolutionCapability: {
          executionCaseId: shell.executionCaseId,
          fixtureKind: "invoice" as const,
          resolverRef: "browser-visible-invoice-row" as const,
          classification: "READ_ONLY_DISCOVERY" as const,
          persona: "company_admin" as const,
          supportedState: state,
          identityPolicy: "compatible-state" as const,
          selectionPolicy: "UNIQUE_COMPATIBLE_ONLY" as const,
          ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE" as const,
          provenance: {
            module: "src/agents/browser/browser-entity-interaction.ts" as const,
            exportName: "resolveAndOpenInvoiceRow" as const,
          },
        },
      } : {
        unavailableReason: !complete
          ? "The ALL_REQUIRED execution-shell partition is incomplete or ambiguous."
          : !state || !stateMetadataConsistent
            ? "Canonical execution-shell state metadata is missing or inconsistent."
            : supporting.length === 0
              ? "No authoritative source obligation requires this fixture state."
              : args.persona !== "company_admin"
                ? "The existing invoice resolver capability is not compatible with the bound persona."
                : shell.runtimeFixturePolicy !== "compatible-state"
                  ? "The existing policy does not authorize compatible-state resolution."
                  : "An exact authoritative fixture identity forbids compatible-state substitution.",
      }),
      runtimeFixtureBinding: "NOT_YET_RESOLVED" as const,
    };
    }).sort((left, right) =>
      left.executionCaseId.localeCompare(right.executionCaseId)
    );

  const allCapable = complete && members.every((item) =>
    item.acceptanceFixtureConstraint && item.fixtureResolutionCapability
  );
  const plannedMemberIds = [...new Set(members.flatMap((item) => {
    const constraint = item.acceptanceFixtureConstraint;
    const state = constraint?.fixtureKind === "invoice"
      ? constraint.semantic.state
      : undefined;
    return state ? [state] : [];
  }))].sort();
  return {
    status: allCapable
      ? "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
      : "UNAVAILABLE",
    policy: "ALL_REQUIRED",
    members,
    acceptanceCoverage: {
      kind: "INVOICE_STATE",
      policy: "ALL_REQUIRED",
      requiredMemberIds: sourceBackedInvoiceStates(args.obligations),
      plannedMemberIds,
    },
    fixtureReadyForInteraction: false,
  };
}

type TalentContractFixtureShellInput = {
  executionCaseId: string;
  sourceCaseId: string;
  partition: {
    mode: "ALL_REQUIRED";
    memberId: string;
    memberCount: number;
  };
};

function talentContractFixtureShells(args: {
  executionCases?: BrowserTestCase[] | undefined;
  archivedContainer?: PlannerBrowserExecutionContainer | undefined;
}): TalentContractFixtureShellInput[] {
  if (args.executionCases) {
    return args.executionCases.map((testCase) => ({
      executionCaseId: testCase.id,
      sourceCaseId:
        testCase.plannerExecutionShell?.sourceCaseId ?? testCase.id,
      partition: testCase.plannerExecutionShell?.partition ?? {
        mode: "ALL_REQUIRED" as const,
        memberId: testCase.id,
        memberCount: args.executionCases!.length,
      },
    }));
  }

  const archived = args.archivedContainer;
  if (!archived || archived.executionCaseIds.length === 0) return [];
  return archived.executionCaseIds.map((executionCaseId) => ({
    executionCaseId,
    sourceCaseId: archived.sourceCaseId,
    partition: {
      mode: "ALL_REQUIRED" as const,
      memberId: executionCaseId,
      memberCount: archived.executionCaseIds.length,
    },
  }));
}

function explicitContractIdentity(
  obligations: PlannerAcceptanceObligation[]
): { status: "NONE" | "EXACT" | "AMBIGUOUS"; entityId?: string } {
  const identities = [...new Set(obligations.flatMap((obligation) =>
    [...obligation.text.matchAll(
      /\bcontract(?:[ _-]*id|Id)\s*(?::|=|#)\s*["']?([A-Za-z0-9][A-Za-z0-9._-]{0,199})["']?/gi
    )].map((match) => match[1]!)
  ))].sort();
  return identities.length === 0
    ? { status: "NONE" }
    : identities.length === 1
      ? { status: "EXACT", entityId: identities[0]! }
      : { status: "AMBIGUOUS" };
}

function talentContractPredicateKeys(
  obligation: PlannerAcceptanceObligation
): PlannerTalentContractFixturePredicateKey[] | undefined {
  const text = normalized(obligation.text).toLowerCase();
  if (
    text.includes("compliance requirements") &&
    /\b(?:unchanged|same|baseline)\b/.test(text)
  ) {
    return undefined;
  }
  if (
    /\b(?:active|cancelled|draft|started|terminated)\s+contract\b/.test(text) ||
    /\bcontract\s+(?:provider|status)\b/.test(text)
  ) {
    return undefined;
  }

  const keys = new Set<PlannerTalentContractFixturePredicateKey>();
  const contractScoped =
    text.includes("contract") ||
    text.includes("work setup") ||
    /\bbackground[_ -]check\b/.test(text) ||
    /\bwork[_ -]authorization\b/.test(text) ||
    text.includes("trolley") ||
    text.includes("deel");
  if (!contractScoped) return undefined;
  keys.add("contract.accessibleToOwner");

  if (
    text.includes("work setup") &&
    /\b(?:assigned|card|cards|existing|populated|status|statuses|empty|without|none|zero)\b/.test(text)
  ) {
    keys.add("contract.hasWorkSetups");
  }
  if (
    (text.includes("pdf") || text.includes("document metadata")) &&
    /\b(?:attached|generated|metadata|fetch|fetched)\b/.test(text)
  ) {
    keys.add("contract.documentMetadataPresent");
  }
  if (
    text.includes("compliance document") &&
    text.includes("signed")
  ) {
    keys.add("compliance.COMPLIANCE_DOCUMENT.present");
    keys.add("compliance.COMPLIANCE_DOCUMENT.signed");
    keys.add("compliance.COMPLIANCE_DOCUMENT.signedAtPresent");
    keys.add("compliance.COMPLIANCE_DOCUMENT.agreementVersionPresent");
    keys.add("compliance.COMPLIANCE_DOCUMENT.signatureValuePresent");
  }
  if (
    text.includes("master service agreement") &&
    text.includes("signed")
  ) {
    keys.add("compliance.MASTER_SERVICE_AGREEMENT.present");
    keys.add("compliance.MASTER_SERVICE_AGREEMENT.signed");
    keys.add("compliance.MASTER_SERVICE_AGREEMENT.signedAtPresent");
    keys.add("compliance.MASTER_SERVICE_AGREEMENT.agreementVersionPresent");
    keys.add("compliance.MASTER_SERVICE_AGREEMENT.signatureValuePresent");
  }
  if (/\bbackground[_ -]check\b/.test(text)) {
    keys.add("compliance.BACKGROUND_CHECK.present");
    if (text.includes("status")) {
      keys.add("compliance.BACKGROUND_CHECK.statusPresent");
    }
    if (/\b(?:date|issued|issue date)\b/.test(text)) {
      keys.add("compliance.BACKGROUND_CHECK.issueDatePresent");
    }
  }
  if (/\bwork[_ -]authorization\b/.test(text)) {
    keys.add("compliance.WORK_AUTHORIZATION.present");
    if (text.includes("snapshot")) {
      keys.add("contract.workAuthorizationSnapshotPresent");
    }
  }
  if (text.includes("trolley")) {
    keys.add("compliance.TROLLEY_ONBOARDING_SETUP.present");
    if (text.includes("status")) {
      keys.add("compliance.TROLLEY_ONBOARDING_SETUP.statusPresent");
    }
  }
  if (text.includes("deel")) {
    keys.add("compliance.DEEL_ONBOARDING_SETUP.present");
    if (text.includes("status")) {
      keys.add("compliance.DEEL_ONBOARDING_SETUP.statusPresent");
    }
  }
  if (
    text.includes("setup") &&
    text.includes("completed")
  ) {
    keys.add("compliance.setup.anyCompleted");
  }

  return [...keys].sort();
}

function talentContractRuntimeFixtureResolutionContract(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  persona?: string | undefined;
  executionCases?: BrowserTestCase[] | undefined;
  archivedContainer?: PlannerBrowserExecutionContainer | undefined;
  runtimeNavigation?: PlannerRuntimeNavigationResolutionContract | undefined;
}): PlannerRuntimeFixtureResolutionContract | undefined {
  if (
    args.persona !== "talent" ||
    args.runtimeNavigation?.resolverRef !== "talent-contract-detail-readonly-v1"
  ) {
    return undefined;
  }

  const derived = args.obligations.map((obligation) => ({
    obligation,
    keys: talentContractPredicateKeys(obligation),
  }));
  if (derived.some((item) => !item.keys || item.keys.length === 0)) {
    return undefined;
  }
  const identity = explicitContractIdentity(args.obligations);
  if (identity.status === "AMBIGUOUS") return undefined;
  const shells = talentContractFixtureShells(args);
  if (shells.length === 0) return undefined;
  const expectedCounts = new Set(shells.map((item) => item.partition.memberCount));
  const complete = expectedCounts.size === 1 &&
    expectedCounts.has(shells.length) &&
    new Set(shells.map((item) => item.partition.memberId)).size === shells.length;
  if (!complete) return undefined;

  const predicateByKey = new Map<
    PlannerTalentContractFixturePredicateKey,
    PlannerTalentContractFixturePredicate
  >();
  for (const item of derived) {
    for (const key of item.keys!) {
      const existing = predicateByKey.get(key);
      const sourceUnitRefs = item.obligation.sourceUnitIds.map((sourceUnitId) => ({
        sourceUnitId,
        sourceRef: args.sourceRefById.get(sourceUnitId) ?? "UNAVAILABLE",
      }));
      predicateByKey.set(key, {
        key,
        expected: key === "contract.hasWorkSetups" &&
          /\b(?:no|without|empty|none|zero)\s+(?:assigned\s+)?work\s+setups?\b/.test(
            normalized(item.obligation.text).toLowerCase()
          )
          ? false
          : true,
        obligationIds: [...new Set([
          ...(existing?.obligationIds ?? []),
          item.obligation.id,
        ])].sort(),
        sourceUnitRefs: [...new Map([
          ...(existing?.sourceUnitRefs ?? []),
          ...sourceUnitRefs,
        ].map((ref) => [ref.sourceUnitId, ref])).values()].sort((left, right) =>
          left.sourceUnitId.localeCompare(right.sourceUnitId)
        ),
        authority: "SOURCE_AUTHORIZED",
      });
    }
  }
  const predicates = [...predicateByKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  const identityPolicy = identity.status === "EXACT"
    ? "exact" as const
    : "compatible-state" as const;
  const obligationIds = args.obligations.map((item) => item.id).sort();
  const sourceUnitRefs = [...new Map(predicates.flatMap((item) =>
    item.sourceUnitRefs
  ).map((ref) => [ref.sourceUnitId, ref])).values()].sort((left, right) =>
    left.sourceUnitId.localeCompare(right.sourceUnitId)
  );

  const members = shells.map((shell) => {
    const constraintId = stablePlanningId("talent-contract-fixture-constraint", [
      shell.executionCaseId,
      ...obligationIds,
      ...predicates.map((item) => item.key),
      identityPolicy,
      identity.entityId ?? "",
    ]);
    const capabilityId = stablePlanningId("talent-contract-fixture-capability", [
      constraintId,
      "talent-contract-detail-readonly-v1",
    ]);
    return {
      executionCaseId: shell.executionCaseId,
      required: true,
      acceptanceFixtureConstraint: {
        constraintId,
        executionCaseId: shell.executionCaseId,
        sourceCaseId: shell.sourceCaseId,
        partition: shell.partition,
        fixtureKind: "talent-contract" as const,
        semantic: {
          kind: "PREDICATES" as const,
          predicates,
        },
        obligationIds,
        sourceUnitRefs,
        identityPolicy,
        ...(identity.entityId ? { exactEntityId: identity.entityId } : {}),
        authority: "SOURCE_AUTHORIZED" as const,
      },
      fixtureResolutionCapability: {
        capabilityId,
        executionCaseId: shell.executionCaseId,
        fixtureKind: "talent-contract" as const,
        resolverRef: "talent-contract-detail-readonly-v1" as const,
        classification: "AUTHENTICATED_READ_ONLY_DISCOVERY" as const,
        persona: "talent" as const,
        supportedPredicates: predicates.map((item) => item.key),
        identityPolicy,
        selectionPolicy: "UNIQUE_COMPATIBLE_ONLY" as const,
        ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE" as const,
        identityVerification: "REQUIRED" as const,
        ownershipVerification: "REQUIRED" as const,
        provenance: {
          module: "src/agents/browser/fixtures/verified-contract-fixture-state.ts" as const,
          exportName: "selectVerifiedContractFixtureCandidate" as const,
        },
      },
      runtimeFixtureBinding: "NOT_YET_RESOLVED" as const,
    };
  }).sort((left, right) => left.executionCaseId.localeCompare(right.executionCaseId));
  const fixtureContractId = stablePlanningId("talent-contract-fixture-contract", [
    ...members.map((member) => member.acceptanceFixtureConstraint.constraintId),
  ]);

  return {
    fixtureContractId,
    status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
    policy: "ALL_REQUIRED",
    members,
    acceptanceCoverage: {
      kind: "TALENT_CONTRACT_PREDICATES",
      policy: "ALL_REQUIRED",
      requiredPredicateKeys: predicates.map((item) => item.key),
      plannedPredicateKeys: predicates.map((item) => item.key),
    },
    fixtureReadyForInteraction: false,
  };
}

function runtimeFixtureResolutionContract(args: {
  obligations: PlannerAcceptanceObligation[];
  sourceRefById: Map<string, string>;
  persona?: string | undefined;
  executionCases?: BrowserTestCase[] | undefined;
  archivedContainer?: PlannerBrowserExecutionContainer | undefined;
  runtimeNavigation?: PlannerRuntimeNavigationResolutionContract | undefined;
}): PlannerRuntimeFixtureResolutionContract | undefined {
  return invoiceRuntimeFixtureResolutionContract(args) ??
    talentContractRuntimeFixtureResolutionContract(args);
}

function checkRoles(args: {
  candidate?: PlannerBrowserSemanticCandidate | undefined;
  obligations: PlannerAcceptanceObligation[];
  proofs: PlannerBrowserProofCapability[];
}): PlannerBrowserVerdictContract["acceptanceChecks"] {
  const obligationById = new Map(args.obligations.map((item) => [item.id, item]));
  const proofById = new Map(args.proofs.map((item) => [item.obligationId, item]));
  return (args.candidate?.proposedChecks ?? []).map((check) => {
    const sourceAuthorized = check.obligationIds.every((id) =>
      normalized(obligationById.get(id)?.text).toLowerCase() ===
        normalized(check.text).toLowerCase()
    );
    const proofBound = check.obligationIds.every((id) =>
      proofById.get(id)?.state === "SUPPORTED_AND_BOUND"
    );
    const sanity = /\b(?:undefined|null)\b.*\b(?:not|isn'?t)\b|\bpage\s+(?:loads?|is visible)\b/i
      .test(check.text);
    return {
      text: check.text,
      obligationIds: check.obligationIds,
      role: sanity
        ? "SUPPLEMENTAL_SANITY" as const
        : sourceAuthorized && proofBound && check.proposedRole === "ACCEPTANCE_PROOF"
          ? "ACCEPTANCE_PROOF" as const
          : check.proposedRole === "PRECONDITION"
            ? "PRECONDITION" as const
            : "STRUCTURAL_SUPPORT" as const,
      authority: sourceAuthorized
        ? "SOURCE_AUTHORIZED" as const
        : "CANDIDATE_ONLY" as const,
    };
  });
}

function groupCandidates(
  group: PlannerAcceptanceVerdictGroup,
  ir: PlannerBrowserSemanticIr
): PlannerBrowserSemanticCandidate[] {
  return ir.candidates.filter((candidate) =>
    sameIds(candidate.obligationIds, group.obligationIds)
  );
}

/**
 * UNKNOWN verdict grouping means the complete group cannot receive an
 * independent case verdict. It does not erase a uniquely source-anchored,
 * bounded candidate inside that group. This deliberately returns only proper
 * subsets; whole-group candidates continue through the ordinary contract path.
 */
function groupOnlyCandidates(args: {
  group: Pick<PlannerAcceptanceVerdictGroup, "obligationIds" | "relationship">;
  ir: PlannerBrowserSemanticIr;
  obligationById: Map<string, PlannerAcceptanceObligation>;
}): PlannerBrowserSemanticCandidate[] {
  if (args.group.relationship !== "UNKNOWN") return [];
  const groupIds = new Set(args.group.obligationIds);
  const candidates = args.ir.candidates.filter((candidate) => {
    const executionIds = candidate.obligationIds;
    if (executionIds.length === 0 || new Set(executionIds).size !== executionIds.length) {
      return false;
    }
    if (executionIds.length >= groupIds.size ||
      !executionIds.every((id) => groupIds.has(id))) {
      return false;
    }
    const authoritativeSourceUnitIds = executionIds.flatMap((id) =>
      args.obligationById.get(id)?.sourceUnitIds ?? []
    ).sort();
    return sameIds(candidate.sourceUnitIds, authoritativeSourceUnitIds);
  });

  const candidateCountByObligationId = new Map<string, number>();
  for (const candidate of candidates) {
    for (const obligationId of candidate.obligationIds) {
      candidateCountByObligationId.set(
        obligationId,
        (candidateCountByObligationId.get(obligationId) ?? 0) + 1
      );
    }
  }
  return candidates.filter((candidate) =>
    candidate.obligationIds.every((id) =>
      candidateCountByObligationId.get(id) === 1
    )
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function buildContract(args: {
  group: PlannerAcceptanceVerdictGroup;
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationById: Map<string, PlannerAcceptanceObligation>;
}): PlannerBrowserVerdictContract {
  const obligations = args.group.obligationIds.flatMap((id) => {
    const item = args.obligationById.get(id);
    return item ? [item] : [];
  });
  const exactCandidates = groupCandidates(args.group, args.semanticIr);
  const candidate = exactCandidates.length === 1
    ? exactCandidates[0]
    : undefined;
  const executionCases = candidate
    ? candidateExecutionCases(args.plan, candidate)
    : [];
  const testCase = executionCases.length === 1
    ? executionCases[0]
    : undefined;
  const targetBase = targetContract(testCase);
  const target = candidate?.proposedTargetSurface
    ? { ...targetBase, surface: candidate.proposedTargetSurface }
    : targetBase;
  const persona = personaContract({ testCase, obligations });
  const fixture = fixtureContract({ candidate, testCase, obligations });
  const proofs = obligations.map((item) => proofCapability(item, args.plan));
  const mutationClass = testCase
    ? actualMutationClass(testCase, { candidate, obligations })
    : "UNKNOWN";
  const allBound = proofs.length > 0 && proofs.every(
    (item) => item.state === "SUPPORTED_AND_BOUND"
  );
  const anyBound = proofs.some((item) => item.state === "SUPPORTED_AND_BOUND");
  const anyManual = proofs.some((item) => item.state === "MANUAL_BY_NATURE");
  const checks = checkRoles({ candidate, obligations, proofs });
  const acceptanceProofIds = new Set(checks
    .filter((item) => item.role === "ACCEPTANCE_PROOF" && item.authority === "SOURCE_AUTHORIZED")
    .flatMap((item) => item.obligationIds));
  const allAcceptanceChecksCovered = args.group.obligationIds.every(
    (id) => acceptanceProofIds.has(id)
  );

  let disposition: PlannerBrowserVerdictContract["disposition"];
  let reason: string;
  if (!candidate || !testCase) {
    disposition = candidate && executionCases.length > 1
      ? "CANDIDATE_UNAVAILABLE"
      : args.group.relationship === "UNKNOWN"
        ? "UNKNOWN_GROUPING"
        : "CANDIDATE_UNAVAILABLE";
    reason = candidate && executionCases.length > 1
      ? "The candidate maps to a complete required execution-shell partition; it cannot be represented truthfully as one verdict-group case."
      : exactCandidates.length > 1
      ? `${exactCandidates.length} source-anchored candidates reference the entire verdict group, but source authority does not establish whether they are alternatives or required subcoverage.`
      : "No single source-anchored candidate represents the entire verdict group.";
  } else if (target.status !== "AUTHORITATIVE" || persona.status !== "AUTHORITATIVE") {
    disposition = "TARGET_UNRESOLVED";
    reason = "Target surface or persona lacks non-conflicting deterministic authority.";
  } else if (fixture.status !== "READY") {
    disposition = "FIXTURE_UNAVAILABLE";
    reason = fixture.reason;
  } else if (!["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(mutationClass)) {
    disposition = "POLICY_BLOCKED";
    reason = "The interaction candidate is not read-only or activation-safe under current planner policy.";
  } else if (allBound && allAcceptanceChecksCovered) {
    disposition = "AUTOMATED_ALLOCATED";
    reason = "Every coupled obligation has source-authorized acceptance checks and a bound proof capability.";
  } else if (anyBound) {
    disposition = "ALLOCATED_MANUAL";
    reason = "The coherent group has partial automation, so unresolved obligations remain case-level manual blockers.";
  } else if (anyManual) {
    disposition = "MANUAL_BY_NATURE";
    reason = "The authoritative group requires human judgment and has no deterministic acceptance proof.";
  } else {
    disposition = "UNSUPPORTED_AUTOMATION";
    reason = "No exact bound runtime proof covers the authoritative acceptance group.";
  }

  return {
    verdictGroupId: args.group.verdictGroupId,
    obligationIds: args.group.obligationIds,
    sourceUnitIds: [...new Set(obligations.flatMap((item) => item.sourceUnitIds))].sort(),
    relationship: args.group.relationship,
    relationshipAuthority: args.group.authority.status === "AUTHORITATIVE"
      ? "AUTHORITATIVE"
      : "UNRESOLVED",
    dependencyVerdictGroupIds: args.group.dependencyVerdictGroupIds,
    candidateIds: candidate ? [candidate.candidateId] : [],
    disposition,
    mutationClass,
    proofCapabilities: proofs,
    acceptanceChecks: checks,
    target,
    persona,
    fixture,
    reason,
  };
}

function materializeCase(args: {
  index: number;
  contract: PlannerBrowserVerdictContract;
  candidate: PlannerBrowserSemanticCandidate;
  candidateCase: BrowserTestCase;
  obligationById: Map<string, PlannerAcceptanceObligation>;
  executionObligationIds?: string[];
  verdictAuthority?: "INDEPENDENT" | "GROUP_ONLY";
}): BrowserTestCase {
  const executionObligationIds = args.executionObligationIds ??
    args.contract.obligationIds;
  const obligations = executionObligationIds.map(
    (id) => args.obligationById.get(id)!
  );
  const proofById = new Map(args.contract.proofCapabilities.map(
    (item) => [item.obligationId, item]
  ));
  const acceptedCheckIds = new Set(
    args.contract.acceptanceChecks
      .filter((item) =>
        item.role === "ACCEPTANCE_PROOF" &&
        item.authority === "SOURCE_AUTHORIZED"
      )
      .flatMap((item) => item.obligationIds)
  );
  const automatedChecks = obligations
    .filter((item) =>
      proofById.get(item.id)?.state === "SUPPORTED_AND_BOUND" &&
      acceptedCheckIds.has(item.id)
    )
    .map((item) => item.text);
  const manualChecks = obligations
    .filter((item) =>
      proofById.get(item.id)?.state !== "SUPPORTED_AND_BOUND" ||
      !acceptedCheckIds.has(item.id)
    )
    .map((item) => item.text);
  const successCriteria = obligations.map((item) => item.text).join(" ");
  return {
    ...args.candidateCase,
    id: `web-${args.index + 1}`,
    persona: args.contract.persona.value!,
    goal: `Verify the source-backed acceptance contract: ${successCriteria}`,
    startRoute: args.contract.target.route!,
    successCriteria,
    acceptanceObligationIds: executionObligationIds,
    executionVerdictScope: {
      executionObligationIds,
      verdictScopeObligationIds: args.contract.obligationIds,
      verdictAuthority: args.verdictAuthority ?? "INDEPENDENT",
    },
    semanticVerdictContract: {
      verdictGroupId: args.contract.verdictGroupId,
      obligationIds: args.contract.obligationIds,
      sourceUnitIds: args.contract.sourceUnitIds,
      relationship: args.contract.relationship,
      dependencyVerdictGroupIds:
        args.contract.dependencyVerdictGroupIds,
      disposition: args.contract.disposition as
        "AUTOMATED_ALLOCATED" | "ALLOCATED_MANUAL",
    },
    automatedChecks,
    manualChecks,
    fixtureRequirements: args.contract.fixture.requirements
      .filter((item) => item.authority === "SOURCE_AUTHORIZED")
      .map((item) => item.text),
  };
}

function materializeGroupOnlyCases(args: {
  contracts: PlannerBrowserVerdictContract[];
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  obligationById: Map<string, PlannerAcceptanceObligation>;
  startIndex: number;
  budget: number;
}): BrowserTestCase[] {
  if (args.budget <= 0) return [];
  const cases: BrowserTestCase[] = [];
  for (const baseContract of args.contracts
    .filter((contract) => contract.relationship === "UNKNOWN")
    .sort((left, right) => left.verdictGroupId.localeCompare(right.verdictGroupId))) {
    const group = {
      obligationIds: baseContract.obligationIds,
      relationship: baseContract.relationship,
    };
    for (const candidate of groupOnlyCandidates({
      group,
      ir: args.semanticIr,
      obligationById: args.obligationById,
    })) {
      if (cases.length >= args.budget) return cases;
      const executionCases = candidateExecutionCases(args.plan, candidate);
      if (executionCases.length !== 1) continue;
      const candidateCase = executionCases[0]!;
      const obligations = candidate.obligationIds.flatMap((id) => {
        const obligation = args.obligationById.get(id);
        return obligation ? [obligation] : [];
      });
      if (obligations.length !== candidate.obligationIds.length) continue;
      const targetBase = targetContract(candidateCase);
      const target = candidate.proposedTargetSurface
        ? { ...targetBase, surface: candidate.proposedTargetSurface }
        : targetBase;
      const persona = personaContract({ testCase: candidateCase, obligations });
      const fixture = fixtureContract({ candidate, testCase: candidateCase, obligations });
      const mutationClass = actualMutationClass(candidateCase, {
        candidate,
        obligations,
      });
      const proofs = obligations.map((item) => proofCapability(item, args.plan));
      const checks = checkRoles({ candidate, obligations, proofs });
      const acceptanceProofIds = new Set(checks
        .filter((item) =>
          item.role === "ACCEPTANCE_PROOF" &&
          item.authority === "SOURCE_AUTHORIZED"
        )
        .flatMap((item) => item.obligationIds));
      const anyBound = proofs.some((item) =>
        item.state === "SUPPORTED_AND_BOUND"
      );
      const allAcceptanceChecksCovered = candidate.obligationIds.every((id) =>
        acceptanceProofIds.has(id)
      );
      if (target.status !== "AUTHORITATIVE" ||
        persona.status !== "AUTHORITATIVE" ||
        fixture.status !== "READY" ||
        !["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(mutationClass) ||
        !anyBound || !allAcceptanceChecksCovered) {
        continue;
      }
      const executionContract: PlannerBrowserVerdictContract = {
        ...baseContract,
        candidateIds: [candidate.candidateId],
        disposition: "ALLOCATED_MANUAL",
        mutationClass,
        proofCapabilities: proofs,
        acceptanceChecks: checks,
        target,
        persona,
        fixture,
        reason:
          "A uniquely source-anchored proper subset is materialized only for bounded execution and proof collection; the UNKNOWN verdict group remains the final verdict scope.",
      };
      cases.push(materializeCase({
        index: args.startIndex + cases.length,
        contract: executionContract,
        candidate,
        candidateCase,
        obligationById: args.obligationById,
        executionObligationIds: candidate.obligationIds,
        verdictAuthority: "GROUP_ONLY",
      }));
    }
  }
  return cases;
}

function materializeRuntimeFixtureCases(args: {
  containers: PlannerBrowserExecutionContainer[];
  evidenceContracts: PlannerBrowserEvidenceContract[];
  verdictContracts: PlannerBrowserVerdictContract[];
  sourceCases: BrowserTestCase[];
  obligationById: Map<string, PlannerAcceptanceObligation>;
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): BrowserTestCase[] {
  const sourceCaseById = new Map(
    args.sourceCases.map((testCase) => [testCase.id, testCase])
  );
  return args.containers
    .filter((container) =>
      ["CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION",
        "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"].includes(container.readiness) &&
      container.runtimeFixtureResolution?.status ===
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
    )
    .flatMap((container) => {
      const obligationIds = [...new Set(
        container.runtimeFixtureResolution!.members.flatMap((member) =>
          member.acceptanceFixtureConstraint?.obligationIds ?? []
        )
      )].sort();
      const manualChecks = obligationIds.flatMap((id) => {
        const obligation = args.obligationById.get(id);
        return obligation ? [obligation.text] : [];
      });
      return container.runtimeFixtureResolution!.members.flatMap((member) => {
        const sourceCase = sourceCaseById.get(member.executionCaseId);
        if (!sourceCase || !member.acceptanceFixtureConstraint ||
          !member.fixtureResolutionCapability) return [];
        const deterministicProofBindings = container.evidenceContractIds
          .flatMap((id) => args.evidenceContracts.find(
            (item) => item.evidenceContractId === id
          )?.proofCapability.bindings ?? [])
          .filter((binding) =>
            binding.executionCaseId === member.executionCaseId
          );
        const authoredCase = { ...sourceCase };
        if (container.composedRuntimeResolution) {
          delete authoredCase.routeResolution;
          delete authoredCase.fixtureIdentityAuthority;
        }
        const runtimeCaseId = stablePlanningId("web-runtime-fixture", [
          container.executionContainerId,
          member.executionCaseId,
        ]);
        const runtimeCase: BrowserTestCase = {
          ...authoredCase,
          id: runtimeCaseId,
          persona: container.executionSessionBinding.persona!,
          startRoute: container.composedRuntimeResolution
            ? "UNKNOWN" : container.executionNavigationBinding.route!,
          ...(container.composedRuntimeResolution ? {
            runtimeNavigationResolutionContract: container.runtimeNavigationResolution!,
            composedRuntimeResolution: container.composedRuntimeResolution,
          } : {}),
          manualChecks: [...new Set([
            ...(sourceCase.manualChecks ?? []),
            ...manualChecks,
          ])],
          runtimeFixturePolicy:
            member.acceptanceFixtureConstraint.identityPolicy,
          runtimeFixtureResolutionContract: {
            ...container.runtimeFixtureResolution!,
            interactionExecutionCaseId: member.executionCaseId,
          },
          ...(deterministicProofBindings.length > 0
            ? { deterministicProofBindings }
            : {}),
        };

        /*
         * RUNTIME_FIXTURE_SOURCE_AUTHORITY_PROPAGATION_V1
         *
         * Fixture setup selects HOW execution reaches a compatible entity.
         * It must not erase already typed source WHAT authority. Only
         * obligation-local, target-compatible source members are considered.
         */
        const candidateObligationIds =
          member.acceptanceFixtureConstraint.obligationIds
            .filter((obligationId) =>
              container.target.constraint.obligations.some(
                (constraint) =>
                  constraint.obligationId === obligationId &&
                  constraint.status === "COMPATIBLE"
              )
            )
            .sort();

        const observationProjection =
          container.mutationClass === "READ_ONLY"
            ? sourceAuthorizedObservationOnlyProjection({
                testCase: runtimeCase,
                obligations: candidateObligationIds.flatMap(
                  (obligationId) => {
                    const obligation =
                      args.obligationById.get(obligationId);
                    return obligation ? [obligation] : [];
                  }
                ),
                obligationLedger: args.obligationLedger,
                sourceLedger: args.sourceLedger,
              })
            : null;

        const authority = sourceBackedRuntimeReadOnlyAuthority({
          container,
          testCase:
            observationProjection?.testCase ?? runtimeCase,
          candidateObligationIds,
          verdictContracts: args.verdictContracts,
          obligationById: args.obligationById,
          obligationLedger: args.obligationLedger,
          sourceLedger: args.sourceLedger,
        });

        return [{
          ...authority.testCase,
          acceptanceObligationIds: authority.executionObligationIds,
          ...(authority.executionIntentAuthority
            ? {
                executionVerdictScope:
                  authority.executionIntentAuthority.executionVerdictScope,
                executionIntentAuthority: authority.executionIntentAuthority,
                ...(authority.executionIntentAuthority.executionCheckContract
                  ? {
                      executionCheckContract:
                        authority.executionIntentAuthority.executionCheckContract,
                    }
                  : {}),
              }
            : {}),
        }];
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

const surfaceExecutionEligibleReadiness = new Set<
  PlannerBrowserExecutionContainer["readiness"]
>([
  "READY",
  "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION",
  "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION",
  "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION",
]);

/**
 * Source text creates surface members; candidate and case text can only bind
 * execution shells to those members. This is planning metadata, not proof or
 * verdict authority.
 */
export function buildPlannerSourceBackedAtomicSurfacePartitions(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  verdictGrouping: PlannerAcceptanceVerdictGrouping;
  obligationLedger: PlannerAcceptanceObligationLedger;
  executionContainers: PlannerBrowserExecutionContainer[];
}): PlannerSourceBackedAtomicSurfacePartition[] {
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const sourceRefById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceRef])
  );
  const containerByCandidate = new Map(
    args.executionContainers.map((item) => [item.semanticCandidateId, item])
  );

  return args.verdictGrouping.groups.flatMap((group) => {
    if (
      group.relationship !== "ATOMIC" ||
      group.authority.status !== "AUTHORITATIVE" ||
      group.obligationIds.length !== 1
    ) return [];

    const obligation = obligationById.get(group.obligationIds[0]!);
    if (!obligation) return [];
    if (sourceBackedInvoiceStates([obligation]).length > 1) return [];
    const surfaces = sourceBackedPageSurfaces(obligation.text);
    if (surfaces.length < 2) return [];

    const requiredMemberIds = surfaces
      .map(sourceBackedSurfaceMemberId)
      .sort();
    if (new Set(requiredMemberIds).size !== surfaces.length) return [];

    const sourceUnitRefs = obligation.sourceUnitIds.flatMap((sourceUnitId) => {
      const sourceRef = sourceRefById.get(sourceUnitId);
      return sourceRef ? [{ sourceUnitId, sourceRef }] : [];
    }).sort((left, right) => left.sourceUnitId.localeCompare(right.sourceUnitId));
    const relatedCandidates = args.semanticIr.candidates.filter((candidate) =>
      sameIds(candidate.obligationIds, [obligation.id])
    );
    const rejectedCandidateIds = new Set<string>();
    const ambiguousCandidateIds = new Set<string>();
    const candidatesByMemberId = new Map<string, PlannerBrowserSemanticCandidate[]>();

    for (const candidate of relatedCandidates) {
      if (!sameIds(candidate.sourceUnitIds, obligation.sourceUnitIds)) {
        rejectedCandidateIds.add(candidate.candidateId);
        continue;
      }
      const executionCases = candidateExecutionCases(args.plan, candidate);
      const archivedContainer = containerByCandidate.get(candidate.candidateId);
      const executionCaseCount = executionCases.length > 0
        ? executionCases.length
        : archivedContainer?.executionCaseIds.length ?? 0;
      if (executionCaseCount > 1) {
        ambiguousCandidateIds.add(candidate.candidateId);
        continue;
      }
      const candidateSurfaceMatches = sourceBackedSurfaceMatches(
        candidate.proposedTargetSurface ?? "",
        surfaces
      );
      /*
       * An exact candidate-to-source surface binding is already bounded by
       * the source member set. Do not let the parent obligation prose carried
       * by an authored case re-expand that binding into every sibling surface.
       */
      const matchedSurfaces = new Set(candidateSurfaceMatches.length === 1
        ? candidateSurfaceMatches
        : [
        ...executionCases.flatMap(browserCasePageSurfaces)
          .filter((surface) => surfaces.includes(surface)),
        ...executionCases.flatMap((testCase) =>
          (testCase.routeResolution?.candidates ?? [])
            .filter((item) => item.disposition === "SELECTED")
            .flatMap((item) => item.surfaceIdentity?.canonicalSurface
              ? [item.surfaceIdentity.canonicalSurface]
              : [])
            .filter((surface) => surfaces.some((sourceSurface) =>
              normalized(surface).toLowerCase() ===
                normalized(sourceSurface).toLowerCase()
            ))
        ),
        ...(archivedContainer?.target.candidateSurface &&
          surfaces.some((surface) =>
            normalized(surface).toLowerCase() ===
              normalized(archivedContainer.target.candidateSurface).toLowerCase()
          )
          ? [archivedContainer.target.candidateSurface]
          : []),
      ]);
      if (matchedSurfaces.size === 0) {
        rejectedCandidateIds.add(candidate.candidateId);
        continue;
      }
      if (matchedSurfaces.size !== 1) {
        ambiguousCandidateIds.add(candidate.candidateId);
        continue;
      }
      const memberId = sourceBackedSurfaceMemberId(
        [...matchedSurfaces][0]!
      );
      candidatesByMemberId.set(memberId, [
        ...(candidatesByMemberId.get(memberId) ?? []),
        candidate,
      ]);
    }

    const duplicateMemberIds = requiredMemberIds.filter(
      (memberId) => (candidatesByMemberId.get(memberId)?.length ?? 0) > 1
    );
    const missingMemberIds = requiredMemberIds.filter(
      (memberId) => (candidatesByMemberId.get(memberId)?.length ?? 0) === 0
    );
    const status = sourceUnitRefs.length !== obligation.sourceUnitIds.length ||
        rejectedCandidateIds.size > 0
      ? "REJECTED" as const
      : ambiguousCandidateIds.size > 0 || duplicateMemberIds.length > 0
        ? "AMBIGUOUS" as const
        : missingMemberIds.length > 0
          ? "INCOMPLETE" as const
          : "VALIDATED" as const;

    const members = surfaces.map((surface) => {
      const memberId = sourceBackedSurfaceMemberId(surface);
      const candidates = candidatesByMemberId.get(memberId) ?? [];
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      const container = candidate
        ? containerByCandidate.get(candidate.candidateId)
        : undefined;
      const eligible = status === "VALIDATED" && Boolean(
        container && surfaceExecutionEligibleReadiness.has(container.readiness)
      );
      return {
        memberId,
        surface,
        ...(candidate ? { semanticCandidateId: candidate.candidateId } : {}),
        ...(container ? { executionContainerId: container.executionContainerId } : {}),
        executionCaseIds: container?.executionCaseIds ?? [],
        ...(container ? { executionReadiness: container.readiness } : {}),
        status: eligible
          ? "EXECUTION_ELIGIBLE" as const
          : candidate
            ? "EXECUTION_BLOCKED" as const
            : "BINDING_UNRESOLVED" as const,
        reason: eligible
          ? "The uniquely source-bound surface member has an execution-eligible container."
          : container
            ? container.reason
            : candidate
              ? "The uniquely source-bound candidate has no execution container."
              : "No unique source-provenanced candidate binds this required surface member.",
      };
    }).sort((left, right) => left.memberId.localeCompare(right.memberId));
    const plannedMemberIds = status === "VALIDATED"
      ? members.filter((item) => item.status === "EXECUTION_ELIGIBLE")
          .map((item) => item.memberId).sort()
      : [];

    return [{
      partitionId: stablePlanningId("surface-partition", [
        group.verdictGroupId,
        obligation.id,
        ...requiredMemberIds,
      ]),
      verdictGroupId: group.verdictGroupId,
      obligationId: obligation.id,
      authority: "SOURCE_AUTHORIZED" as const,
      policy: "ALL_REQUIRED" as const,
      status,
      sourceUnitRefs,
      requiredMemberIds,
      plannedMemberIds,
      members,
      rejectedCandidateIds: [...new Set([
        ...rejectedCandidateIds,
        ...ambiguousCandidateIds,
      ])].sort(),
      reason: status === "VALIDATED"
        ? "Every authoritative surface has exactly one source-provenanced candidate binding; only execution-eligible members are planned."
        : status === "INCOMPLETE"
          ? `Required surface members remain unbound: ${missingMemberIds.join(", ")}.`
          : status === "AMBIGUOUS"
            ? "At least one candidate or required surface has ambiguous execution membership."
            : "Source provenance is incomplete or candidate text does not bind exclusively to source-defined surfaces.",
    }];
  }).sort((left, right) => left.partitionId.localeCompare(right.partitionId));
}

function sourceSurfacePrerequisiteKind(
  text: string
): PlannerExecutionSurfacePrerequisiteContract["kind"] | undefined {
  const value = normalized(text).toLowerCase();
  if (/\bsearch\s+(?:bar|box|field|input|control)\b/.test(value)) {
    return "SEARCH_INPUT";
  }
  if (/\btab\b/.test(value) && /\bfilters?\b/.test(value)) {
    return "TAB_OR_FILTER_CONTROL";
  }
  return undefined;
}

/**
 * Reclassifies only candidate-only fixture prose for validated source surface
 * members. Target, navigation and session authority must already be complete.
 */
export function attachPlannerExecutionSurfacePrerequisites(args: {
  obligationLedger: PlannerAcceptanceObligationLedger;
  semanticIr: PlannerBrowserSemanticIr;
  partitions: PlannerSourceBackedAtomicSurfacePartition[];
  executionContainers: PlannerBrowserExecutionContainer[];
  evidenceContracts: PlannerBrowserEvidenceContract[];
  accounting: PlannerBrowserObligationEvidenceAccounting[];
}): PlannerExecutionSurfacePrerequisiteContract[] {
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const candidateById = new Map(
    args.semanticIr.candidates.map((item) => [item.candidateId, item])
  );
  const containerById = new Map(
    args.executionContainers.map((item) => [item.executionContainerId, item])
  );
  const contracts: PlannerExecutionSurfacePrerequisiteContract[] = [];

  for (const partition of args.partitions) {
    const obligation = obligationById.get(partition.obligationId);
    const kind = obligation
      ? sourceSurfacePrerequisiteKind(obligation.text)
      : undefined;
    if (partition.status !== "VALIDATED" || !obligation || !kind) continue;

    const eligible = partition.members.flatMap((member) => {
      const container = member.executionContainerId
        ? containerById.get(member.executionContainerId)
        : undefined;
      const candidate = member.semanticCandidateId
        ? candidateById.get(member.semanticCandidateId)
        : undefined;
      const candidateOnlyFixture = Boolean(
        container?.fixture.requirements.length &&
        container.fixture.requirements.every((item) =>
          item.authority === "CANDIDATE_ONLY"
        )
      );
      const completeContext =
        container?.readiness === "FIXTURE_UNAVAILABLE" &&
        container.target.constraint.status === "COMPATIBLE" &&
        container.executionNavigationBinding.status === "BOUND" &&
        Boolean(container.executionNavigationBinding.route) &&
        container.executionSessionBinding.status === "BOUND" &&
        Boolean(container.executionSessionBinding.persona) &&
        container.executionCaseIds.length === 1 &&
        ["READ_ONLY", "TRANSIENT_REVERSIBLE"].includes(
          container.mutationClass
        );
      return container && candidate && candidateOnlyFixture && completeContext
        ? [{ member, container, candidate }]
        : [];
    });
    const plannedMemberIds = eligible.map((item) => item.member.memberId).sort();

    for (const { member, container, candidate } of eligible) {
      const executionCaseId = container.executionCaseIds[0]!;
      const contract: PlannerExecutionSurfacePrerequisiteContract = {
        schemaVersion: 1,
        prerequisiteId: stablePlanningId("surface-prerequisite", [
          partition.partitionId,
          member.memberId,
          candidate.candidateId,
          container.executionContainerId,
          executionCaseId,
          container.executionNavigationBinding.route!,
          container.executionSessionBinding.persona!,
        ]),
        status: "SURFACE_RUNTIME_RESOLUTION_REQUIRED",
        kind,
        authority: "SOURCE_AUTHORIZED",
        sourceUnitRefs: partition.sourceUnitRefs,
        surfacePartition: {
          partitionId: partition.partitionId,
          verdictGroupId: partition.verdictGroupId,
          obligationId: partition.obligationId,
          memberId: member.memberId,
          surface: member.surface,
        },
        executionContext: {
          executionContainerId: container.executionContainerId,
          semanticCandidateId: candidate.candidateId,
          executionCaseId,
          route: container.executionNavigationBinding.route!,
          persona: container.executionSessionBinding.persona!,
        },
        acceptanceCoverage: {
          policy: "ALL_REQUIRED",
          requiredMemberIds: partition.requiredMemberIds,
          plannedMemberIds,
          memberId: member.memberId,
        },
        selectionPolicy:
          kind === "SEARCH_INPUT"
            ? "UNIQUE_GROUNDED_CONTROL_ONLY"
            : "GROUNDED_CONTROL_SURFACE_PRESENT",
        ambiguityPolicy:
          kind === "SEARCH_INPUT"
            ? "BLOCK_SURFACE_UNAVAILABLE"
            : "ALLOW_MULTIPLE_GROUNDED_CONTROLS",
        runtimeBinding: "NOT_YET_RESOLVED",
        surfaceReadyForInteraction: false,
      };
      container.executionSurfacePrerequisite = contract;
      container.readiness =
        "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION";
      container.reason =
        "The source-backed member has complete target, navigation and session authority; a fresh runtime observation must uniquely ground its interaction surface.";

      /*
       * RUNTIME_SURFACE_PROMOTION_CLEARS_DISCOVERY_V1
       *
       * discoveryAdmission is derived before source-surface prerequisite
       * promotion. Once this container has a typed runtime surface contract,
       * the same authored case must not also materialize in DISCOVERY_ONLY.
       *
       * This changes execution-lane ownership only. It does not promote
       * target, fixture, proof, acceptance, or verdict authority.
       */
      delete container.discoveryAdmission;

      for (const evidence of args.evidenceContracts) {
        if (evidence.executionContainerId !== container.executionContainerId) continue;
        evidence.disposition = "SURFACE_RUNTIME_RESOLUTION_REQUIRED";
        evidence.reason = container.reason;
      }
      contracts.push(contract);
    }

    if (eligible.length > 0) {
      const accounting = args.accounting.find(
        (item) => item.obligationId === partition.obligationId
      );
      if (accounting) {
        accounting.disposition = "EVIDENCE_CONTRACT_ALLOCATED";
        accounting.reason =
          "At least one validated source-surface member is materializable with fail-closed runtime surface resolution; acceptance proof remains unresolved.";
      }
    }
  }
  return contracts.sort((left, right) =>
    left.prerequisiteId.localeCompare(right.prerequisiteId)
  );
}

function materializeRuntimeSurfaceCases(args: {
  containers: PlannerBrowserExecutionContainer[];
  evidenceContracts: PlannerBrowserEvidenceContract[];
  semanticIr: PlannerBrowserSemanticIr;
  sourceCases: BrowserTestCase[];
  obligationById: Map<string, PlannerAcceptanceObligation>;
  verdictContracts: PlannerBrowserVerdictContract[];
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): BrowserTestCase[] {
  const sourceCaseById = new Map(
    args.sourceCases.map((testCase) => [testCase.id, testCase])
  );
  const candidateById = new Map(
    args.semanticIr.candidates.map((item) => [item.candidateId, item])
  );
  return args.containers.flatMap((container) => {
    const contract = container.executionSurfacePrerequisite;
    if (
      container.readiness !==
        "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION" ||
      !contract
    ) return [];
    const candidate = candidateById.get(container.semanticCandidateId);
    const obligation = args.obligationById.get(
      contract.surfacePartition.obligationId
    );
    if (!candidate || !obligation) return [];
    const sourceCase = sourceCaseById.get(contract.executionContext.executionCaseId);
    const authoredCase: BrowserTestCase = sourceCase
      ? { ...sourceCase }
      : {
          id: contract.executionContext.executionCaseId,
          persona: contract.executionContext.persona,
          goal: candidate.proposedBehavior,
          startRoute: contract.executionContext.route,
          successCriteria: obligation.text,
          automatedChecks: [],
          manualChecks: [obligation.text],
          fixtureRequirements: [],
          steps: [],
        };
    delete authoredCase.runtimeFixtureResolutionContract;
    delete authoredCase.composedRuntimeResolution;
    delete authoredCase.fixtureIdentityAuthority;
    const deterministicProofBindings = container.evidenceContractIds
      .flatMap((id) => args.evidenceContracts.find(
        (item) => item.evidenceContractId === id
      )?.proofCapability.bindings ?? [])
      .filter((binding) =>
        binding.executionCaseId === contract.executionContext.executionCaseId
      );
    const runtimeCase: BrowserTestCase = {
      ...authoredCase,
      id: stablePlanningId("web-runtime-surface", [
        container.executionContainerId,
        contract.executionContext.executionCaseId,
      ]),
      persona: contract.executionContext.persona,
      startRoute: contract.executionContext.route,
      successCriteria: obligation.text,
      acceptanceObligationIds: [obligation.id],
      automatedChecks: [],
      manualChecks: [...new Set([
        ...(authoredCase.manualChecks ?? []),
        obligation.text,
      ])],
      fixtureRequirements: [],
      executionSurfacePrerequisiteContract: contract,
      ...(deterministicProofBindings.length > 0
        ? { deterministicProofBindings }
        : {}),
    };
    const upstreamApprovedDirectTaskObligationIds = deterministicProofBindings
      .filter((binding) =>
        binding.authority === "SOURCE_AUTHORIZED" &&
        binding.obligationId === obligation.id &&
        binding.executionCaseId === contract.executionContext.executionCaseId &&
        binding.capabilityKind === "SEARCH_INPUT_PRESENT" &&
        obligation.sourceRole === "TASK" &&
        obligation.derivation === "DIRECT_TASK_SECTION" &&
        binding.prerequisite.sourceUnitRefs.length > 0 &&
        binding.prerequisite.sourceUnitRefs.every((ref) =>
          obligation.sourceUnitIds.includes(ref.sourceUnitId) &&
          args.sourceLedger?.sourceUnits.some((source) =>
            source.id === ref.sourceUnitId && source.sourceRef === ref.sourceRef
          )
        )
      )
      .map((binding) => binding.obligationId);
    const authority = sourceBackedRuntimeReadOnlyAuthority({
      container,
      testCase: runtimeCase,
      candidateObligationIds: [obligation.id],
      ...(upstreamApprovedDirectTaskObligationIds.length > 0
        ? { upstreamApprovedDirectTaskObligationIds }
        : {}),
      verdictContracts: args.verdictContracts,
      obligationById: args.obligationById,
      obligationLedger: args.obligationLedger,
      sourceLedger: args.sourceLedger,
    });
    const canonicalContract = authority.executionIntentAuthority
      ?.executionCheckContract;
    const contractConflict = Boolean(
      runtimeCase.executionCheckContract && canonicalContract &&
      JSON.stringify(runtimeCase.executionCheckContract) !==
        JSON.stringify(canonicalContract)
    );
    if (!authority.executionIntentAuthority || contractConflict) {
      return [runtimeCase];
    }
    return [{
      ...authority.testCase,
      acceptanceObligationIds: authority.executionObligationIds,
      executionVerdictScope:
        authority.executionIntentAuthority.executionVerdictScope,
      executionIntentAuthority: authority.executionIntentAuthority,
      ...(canonicalContract ? { executionCheckContract: canonicalContract } : {}),
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function materializeRuntimeTargetGroundingCases(args: {
  containers: PlannerBrowserExecutionContainer[];
  evidenceContracts: PlannerBrowserEvidenceContract[];
  sourceCases: BrowserTestCase[];
  obligationById: Map<string, PlannerAcceptanceObligation>;
}): BrowserTestCase[] {
  const sourceCaseById = new Map(
    args.sourceCases.map((testCase) => [testCase.id, testCase])
  );
  return args.containers.flatMap((container) => {
    const contract = container.runtimeTargetGrounding;
    if (
      container.readiness !==
        "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING" ||
      !contract ||
      container.executionCaseIds.length !== 1
    ) return [];
    // A runtime target handoff is execution eligibility, never an exemption
    // from authoritative verdict-group allocation. UNKNOWN grouping remains
    // evidence-only even when a coarse route is safe to observe.
    if (!container.evidenceContractIds.every((id) =>
      args.evidenceContracts.some((item) =>
        item.evidenceContractId === id &&
        item.disposition === "RUNTIME_TARGET_GROUNDING_REQUIRED"
      )
    )) return [];
    const executionCaseId = container.executionCaseIds[0]!;
    const sourceCase = sourceCaseById.get(executionCaseId);
    if (!sourceCase) return [];
    const manualChecks = contract.obligationIds.flatMap((id) => {
      const obligation = args.obligationById.get(id);
      return obligation ? [obligation.text] : [];
    });
    return [{
      ...sourceCase,
      id: stablePlanningId("web-runtime-target", [
        container.executionContainerId,
        executionCaseId,
      ]),
      persona: contract.persona.value,
      startRoute: contract.coarseEnvelope.routeKind === "STATIC"
        ? contract.coarseEnvelope.route
        : "UNKNOWN",
      acceptanceObligationIds: contract.obligationIds,
      automatedChecks: [],
      manualChecks: [...new Set([
        ...(sourceCase.manualChecks ?? []),
        ...manualChecks,
      ])],
      fixtureRequirements: contract.fixtureRequirements.map((item) => item.text),
      steps: [],
      runtimeTargetGroundingContract: contract,
      ...(container.runtimeNavigationResolution
        ? { runtimeNavigationResolutionContract: container.runtimeNavigationResolution }
        : {}),
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

/*
 * PATCH_B_RUNTIME_EXECUTION_INTENT_V1
 *
 * This derives only immutable source-backed WHAT for an already-admitted
 * bounded source-backed read-only runtime shell. It rejects an absent
 * source-backed WHAT, unsafe mutation, and incomplete source ledgers. A
 * source-silent configured persona and ambiguous ticket coverage are runtime
 * configuration/coverage metadata, not source-authority admission vetoes.
 */
function runtimeBindableReadOnlyIntent(args: {
  container: PlannerBrowserExecutionContainer;
  testCase: BrowserTestCase;
  executionObligationIds: string[];
  verdictContracts: PlannerBrowserVerdictContract[];
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): BrowserExecutionIntentAuthority | null {
  if (
    args.executionObligationIds.length === 0 ||
    args.container.mutationClass !== "READ_ONLY" ||
    args.container.target.sourceScope.status !== "AUTHORITATIVE" ||
    !args.container.target.sourceScope.surface ||
    !args.container.target.sourceScope.sourceUnitRefs?.length ||
    args.obligationLedger.sourceStatus !== "RESOLVED" ||
    args.obligationLedger.derivationStatus !== "RESOLVED" ||
    args.sourceLedger?.sourceStatus !== "RESOLVED"
  ) return null;

  const personaPolicy = args.container.persona.status === "AUTHORITATIVE" &&
    args.container.persona.value
    ? {
        kind: "EXACT_PERSONA" as const,
        persona: args.container.persona.value,
        authority: "SOURCE_ACTOR" as const,
      }
    : args.container.executionNavigationBinding.status === "BOUND" &&
        args.container.executionNavigationBinding.persona &&
        args.container.persona.value === args.container.executionNavigationBinding.persona
      ? {
          kind: "EXACT_PERSONA" as const,
          persona: args.container.executionNavigationBinding.persona,
          authority: "ROUTE_ENVELOPE" as const,
        }
    : (args.testCase.persona === "company_admin" ||
          args.testCase.persona === "talent") &&
          args.container.acceptanceActorConstraint.status === "NONE"
        ? {
            kind: "CONFIGURED_EXECUTION_PERSONA" as const,
            /*
             * The source is silent about the actor. The case's supported
             * configured persona selects execution; a planner candidate
             * persona is merely a hint and must not veto bounded execution.
             */
            persona: args.testCase.persona,
          }
        : null;
  if (!personaPolicy || personaPolicy.persona !== args.testCase.persona) return null;

  const matchingVerdictContracts = args.verdictContracts.filter((contract) =>
    args.executionObligationIds.every((id) => contract.obligationIds.includes(id))
  );
  /*
   * Verdict contracts describe ticket coverage, not whether this bounded
   * source-backed read-only unit may execute. A unique contract can retain
   * its scope; absent or ambiguous coverage stays GROUP_ONLY and never gives
   * this unit independent ticket-verdict authority.
   */
  const verdictContract = matchingVerdictContracts.length === 1
    ? matchingVerdictContracts[0]
    : undefined;
  const targetRefs = args.container.target.sourceScope.sourceUnitRefs;
  const routePolicy = args.container.executionNavigationBinding.status === "BOUND" &&
    args.container.executionNavigationBinding.route &&
    args.container.executionNavigationBinding.sourceRefs?.length
    ? {
        kind: "PREBOUND_EXACT" as const,
        route: args.container.executionNavigationBinding.route,
        authority: args.container.executionNavigationBinding.basis === "SOURCE_ROUTE"
          ? "SOURCE_ROUTE" as const
          : "UI_ROUTE_MANIFEST" as const,
        sourceRefs: args.container.executionNavigationBinding.sourceRefs,
      }
    : {
        kind: "RUNTIME_DISCOVERABLE" as const,
        sourceUnitRefs: targetRefs,
      };

  /*
   * A prebound route is already deterministic execution authority and must
   * be used for the canonical contract identity. Runtime-discoverable cases
   * retain the pending sentinel so no planner route becomes proof authority.
   */
  const contractRoute = routePolicy.kind === "PREBOUND_EXACT"
    ? args.testCase.startRoute
    : "/__runtime-binding-pending__";
  const checkSourceCase: BrowserTestCase = {
    ...args.testCase,
    acceptanceObligationIds: args.executionObligationIds,
    startRoute: contractRoute,
  };
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({
    testCase: checkSourceCase,
    obligationLedger: args.obligationLedger,
    sourceLedger: args.sourceLedger,
    acceptedRoutePath: checkSourceCase.startRoute,
  });
  const executionVerdictScope = {
    executionObligationIds: args.executionObligationIds,
    verdictScopeObligationIds: verdictContract?.obligationIds ?? args.executionObligationIds,
    /*
     * A missing final ticket-verdict contract cannot erase a bounded,
     * source-backed execution intent. It remains GROUP_ONLY so this fallback
     * grants neither independent ticket authority nor raw coverage PASS.
     */
    verdictAuthority: verdictContract && sameIds(args.executionObligationIds, verdictContract.obligationIds)
      ? "INDEPENDENT" as const
      : "GROUP_ONLY" as const,
  };
  checkSourceCase.executionVerdictScope = executionVerdictScope;
  const executionCheckContract = deriveBrowserExecutionCheckContract({
    testCase: checkSourceCase,
    sourceBoundAssertionSetRequirements: requirements,
  });
  const sourceUnitRefs = targetRefs;
  const fixtureRequirementRefs = args.container.fixture.requirements
    .filter((item) => item.authority === "SOURCE_AUTHORIZED")
    .flatMap((item) => args.container.target.constraint.obligations
      .filter((obligation) => item.obligationIds.includes(obligation.obligationId))
      .flatMap((obligation) => obligation.sourceUnitRefs));
  return {
    schemaVersion: 1,
    caseId: args.testCase.id,
    executionObligationIds: args.executionObligationIds,
    executionVerdictScope,
    sourceUnitRefs,
    personaPolicy,
    executionSafety: {
      allowedMutationClasses: ["READ_ONLY"],
      allowedInteractionClasses: ["OBSERVE", "ASSERT_VISIBLE"],
    },
    fixtureRequirementRefs: [...new Map(
      fixtureRequirementRefs.map((ref) => [`${ref.sourceUnitId}\u0000${ref.sourceRef}`, ref])
    ).values()],
    ...(executionCheckContract ? { executionCheckContract } : {}),
    sourceTargetEnvelope: {
      semanticIdentity: args.container.target.sourceScope.surface,
      sourceSurface: args.container.target.sourceScope.surface,
      sourceUnitRefs,
      compatibleTargetSources: ["surface", "heading", "visibleText"],
      routePolicy,
    },
  };
}

function sourceBackedRuntimeReadOnlyAuthority(args: {
  container: PlannerBrowserExecutionContainer;
  testCase: BrowserTestCase;
  candidateObligationIds: string[];
  /**
   * A source-authorized deterministic binding can approve a bounded direct
   * TASK only after the planner has already attached it to this exact shell.
   * This is transport input, never case-derived authority.
   */
  upstreamApprovedDirectTaskObligationIds?: string[];
  verdictContracts: PlannerBrowserVerdictContract[];
  obligationById: Map<string, PlannerAcceptanceObligation>;
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): {
  testCase: BrowserTestCase;
  executionObligationIds: string[];
  executionIntentAuthority: BrowserExecutionIntentAuthority | null;
} {
  const candidateObligationIds = [...new Set(args.candidateObligationIds)]
    .filter((obligationId) =>
      ["ACCEPTANCE", "TASK"].includes(
        args.obligationById.get(obligationId)?.sourceRole ?? ""
      )
    )
    .sort();

  const candidateRequirementCase: BrowserTestCase = {
    ...args.testCase,
    acceptanceObligationIds: candidateObligationIds,
    startRoute: "/__runtime-binding-pending__",
  };

  const candidateRequirements =
    buildBrowserSourceBoundAssertionSetRequirements({
      testCase: candidateRequirementCase,
      obligationLedger: args.obligationLedger,
      sourceLedger: args.sourceLedger,
      acceptedRoutePath: candidateRequirementCase.startRoute,
    });

  const approvedDirectTaskObligationIds = new Set(
    [
      ...candidateRequirements
        .filter(hasApprovedCaseLevelSourceBoundAssertionAuthority)
        .filter((requirement) => requirement.proofAuthority === "DIRECT_TASK")
        .map((requirement) => requirement.obligationId),
      ...(args.upstreamApprovedDirectTaskObligationIds ?? []),
    ]
  );

  const sourceDerivedCheckCarriers =
    buildBrowserSourceDerivedAssertionCheckCarriers({
      testCase: candidateRequirementCase,
      requirements: candidateRequirements,
    });

  const testCaseWithSourceDerivedCheckCarriers: BrowserTestCase =
    sourceDerivedCheckCarriers.length > 0
      ? {
          ...args.testCase,
          steps: [
            ...(args.testCase.steps ?? []),
            ...sourceDerivedCheckCarriers,
          ],
        }
      : args.testCase;

  const executionObligationIds = candidateObligationIds.filter(
    (obligationId) =>
      args.obligationById.get(obligationId)?.sourceRole === "ACCEPTANCE" ||
      approvedDirectTaskObligationIds.has(obligationId)
  );

  const executionIntentAuthority = runtimeBindableReadOnlyIntent({
    container: args.container,
    testCase: testCaseWithSourceDerivedCheckCarriers,
    executionObligationIds,
    verdictContracts: args.verdictContracts,
    obligationLedger: args.obligationLedger,
    sourceLedger: args.sourceLedger,
  });

  return {
    testCase: testCaseWithSourceDerivedCheckCarriers,
    executionObligationIds,
    executionIntentAuthority,
  };
}

function materializeRuntimeNavigationDiscoveryCases(args: {
  containers: PlannerBrowserExecutionContainer[];
  evidenceContracts: PlannerBrowserEvidenceContract[];
  verdictContracts: PlannerBrowserVerdictContract[];
  sourceCases: BrowserTestCase[];
  obligationById: Map<string, PlannerAcceptanceObligation>;
  obligationLedger: PlannerAcceptanceObligationLedger;
  sourceLedger: TestPlan["acceptanceSourceLedger"];
}): BrowserTestCase[] {
  const sourceCaseById = new Map(
    args.sourceCases.map((testCase) => [testCase.id, testCase])
  );
  return args.containers.flatMap((container) => {
    if (
      container.discoveryAdmission?.status !== "ELIGIBLE" ||
      container.executionCaseIds.length !== 1 ||
      container.mutationClass !== "READ_ONLY" ||
      !["company_admin", "talent"].includes(
        String(container.persona.value ?? "")
      )
    ) return [];
    const executionCaseId = container.executionCaseIds[0]!;
    const sourceCase = sourceCaseById.get(executionCaseId);
    if (!sourceCase) return [];
    const runtimeCaseId = stablePlanningId("web-runtime-navigation-discovery", [
      container.executionContainerId,
      executionCaseId,
    ]);
    const candidateObligationIds = container.target.constraint.obligations
      .map((item) => item.obligationId)
      .sort();

    const runtimeCase: BrowserTestCase = {
      ...sourceCase,
      id: runtimeCaseId,
      persona: container.persona.value!,
      // Preserve an unresolved route for the runner's existing candidate
      // discovery and authenticated probe; this is execution reach only.
      startRoute:
        container.executionNavigationBinding.status === "BOUND" &&
        container.executionNavigationBinding.route
          ? container.executionNavigationBinding.route
          : "UNKNOWN",
      executionPolicy: { lane: "DISCOVERY_ONLY" as const },
      // Discovery observations cannot inherit canonical proof ownership.
      deterministicProofBindings: [],
    };

    const authority = sourceBackedRuntimeReadOnlyAuthority({
      container,
      testCase: runtimeCase,
      candidateObligationIds,
      verdictContracts: args.verdictContracts,
      obligationById: args.obligationById,
      obligationLedger: args.obligationLedger,
      sourceLedger: args.sourceLedger,
    });

    return [{
      ...authority.testCase,
      acceptanceObligationIds: authority.executionObligationIds,
      ...(authority.executionIntentAuthority
        ? {
            executionVerdictScope:
              authority.executionIntentAuthority.executionVerdictScope,
            executionIntentAuthority: authority.executionIntentAuthority,
            ...(authority.executionIntentAuthority.executionCheckContract
              ? {
                  executionCheckContract:
                    authority.executionIntentAuthority.executionCheckContract,
                }
              : {}),
          }
        : {}),
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function idsFor(
  contracts: PlannerBrowserVerdictContract[],
  dispositions: PlannerBrowserVerdictContract["disposition"][]
): string[] {
  return [...new Set(contracts
    .filter((item) => dispositions.includes(item.disposition))
    .flatMap((item) => item.obligationIds))].sort();
}

function manualIds(
  contracts: PlannerBrowserVerdictContract[]
): string[] {
  return [...new Set(contracts.flatMap((contract) => {
    if (contract.disposition === "MANUAL_BY_NATURE") {
      return contract.obligationIds;
    }
    if (contract.disposition !== "ALLOCATED_MANUAL") return [];
    const accepted = new Set(contract.acceptanceChecks
      .filter((item) =>
        item.role === "ACCEPTANCE_PROOF" &&
        item.authority === "SOURCE_AUTHORIZED"
      )
      .flatMap((item) => item.obligationIds));
    const proofById = new Map(contract.proofCapabilities.map(
      (item) => [item.obligationId, item.state]
    ));
    return contract.obligationIds.filter((id) =>
      !accepted.has(id) || proofById.get(id) !== "SUPPORTED_AND_BOUND"
    );
  }))].sort();
}

function commonTarget(
  cases: BrowserTestCase[],
  surface?: string
): PlannerBrowserVerdictContract["target"] {
  if (cases.length === 0) {
    return { status: "UNRESOLVED", basis: "UNAVAILABLE" };
  }
  const targets = cases.map(targetContract);
  const signatures = new Set(targets.map((item) => JSON.stringify(item)));
  if (signatures.size !== 1) {
    return { status: "CONFLICT", basis: "UNAVAILABLE" };
  }
  return surface ? { ...targets[0]!, surface } : targets[0]!;
}

export function buildPlannerBrowserEvidencePlanning(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  verdictGrouping: PlannerAcceptanceVerdictGrouping;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): {
  evidenceContracts: PlannerBrowserEvidenceContract[];
  executionContainers: PlannerBrowserExecutionContainer[];
  accounting: PlannerBrowserObligationEvidenceAccounting[];
} {
  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const sourceRefById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceRef])
  );
  const sourceKindById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceKind])
  );
  const groupsByObligation = new Map<string, PlannerAcceptanceVerdictGroup[]>();
  for (const group of args.verdictGrouping.groups) {
    for (const obligationId of group.obligationIds) {
      groupsByObligation.set(obligationId, [
        ...(groupsByObligation.get(obligationId) ?? []),
        group,
      ]);
    }
  }

  const evidenceContracts: PlannerBrowserEvidenceContract[] = [];
  const executionContainers: PlannerBrowserExecutionContainer[] = [];
  const contractIds = new Set<string>();

  for (const candidate of [...args.semanticIr.candidates]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))) {
    const obligations = candidate.obligationIds.flatMap((id) => {
      const obligation = obligationById.get(id);
      return obligation ? [obligation] : [];
    });
    if (obligations.length === 0) continue;
    const requiredSourceUnitIds = [...new Set(obligations.flatMap(
      (item) => item.sourceUnitIds
    ))].sort();
    if (!sameIds(candidate.sourceUnitIds, requiredSourceUnitIds)) continue;

    const executionCases = candidateExecutionCases(args.plan, candidate);
    const sourceTargetMembers = sourceAuthorizedSurfaceMembers({
      candidate,
      obligations,
      plan: args.plan,
    });
    const canonicalSourceTarget = canonicalSourceTargetSurface({
      candidate,
      obligations,
      plan: args.plan,
      executionCases,
    });
    const target = executionTargetContract({
      obligations,
      sourceRefById,
      sourceKindById,
      sourceSurfaceMembers: sourceTargetMembers,
      ...(canonicalSourceTarget
        ? { candidateSurface: canonicalSourceTarget }
        : sourceTargetMembers.length === 0 && candidate.proposedTargetSurface
          ? { candidateSurface: candidate.proposedTargetSurface }
        : {}),
    });
    const representative = executionCases[0];
    const personaCandidates = new Set([
      candidate.proposedPersona,
      ...executionCases.map((item) => item.persona),
    ].filter((item): item is "company_admin" | "talent" =>
      item === "company_admin" || item === "talent"
    ));
    const persona = executionPersonaContract({
      candidatePersona: personaCandidates.size === 1
        ? [...personaCandidates][0]
        : undefined,
      candidateConflict: personaCandidates.size > 1,
      ...(canonicalRuntimeRoutePersona({
        plan: args.plan,
        sourceSurface: canonicalSourceTarget,
        executionCases,
      })
        ? {
            runtimeRoutePersona: canonicalRuntimeRoutePersona({
              plan: args.plan,
              sourceSurface: canonicalSourceTarget,
              executionCases,
            }),
          }
        : {}),
      obligations,
      sourceRefById,
      sourceKindById,
    });
    const route = recoverExactStaticExecutionRoute({
      plan: args.plan,
      ...(persona.value ? { persona: persona.value } : {}),
      target,
      route: compatibleExecutionRoute(
        executionRouteContract(executionCases),
        target
      ),
    });
    const actorConstraint = acceptanceActorConstraint({
      obligations,
      sourceRefById,
      sourceKindById,
    });
    const routeConstraint = acceptanceRouteConstraint({
      obligations,
      route,
      sourceRefById,
      sourceKindById,
    });
    const fixture = fixtureContract({
      candidate,
      testCase: representative,
      obligations,
    });
    const candidateMutationClasses = new Set(
      executionCases.map((testCase) => actualMutationClass(testCase, {
        candidate,
        obligations,
      }))
    );
    const candidateMutationClass = candidateMutationClasses.size === 1
      ? [...candidateMutationClasses][0]!
      : "UNKNOWN";
    const deferredTarget = runtimeTargetGroundingContract({
      obligations,
      target,
      route,
      persona,
      fixture,
      mutationClass: candidateMutationClass,
      sourceRefById,
      sourceKindById,
      plan: args.plan,
    });
    const navigation = executionNavigationBinding(route, target, deferredTarget);
    const runtimeNavigation = runtimeNavigationResolutionContract({
      target,
      route,
      navigation,
      persona,
      ...(deferredTarget ? { runtimeTargetGrounding: deferredTarget } : {}),
    });
    const session = executionSessionBinding({
      navigation,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
      ...(persona.value ? { candidatePersona: persona.value } : {}),
    });
    const actorCheck = actorCompatibility({
      constraint: actorConstraint,
      session,
    });
    const runtimeFixtureResolution = runtimeFixtureResolutionContract({
      obligations,
      sourceRefById,
      persona: persona.value,
      executionCases,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
    });
    const planningFixture = runtimeFixtureResolution?.status ===
      "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
      ? {
          ...fixture,
          status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" as const,
          reason: "Canonical per-shell fixture constraints are complete and an existing read-only resolver capability can attempt runtime PREPARE; no current fixture binding exists.",
        }
      : fixture;
    const executionContainerId = executionCases.length > 0
      ? stablePlanningId("execution-container", [
          candidate.candidateId,
          candidate.proposedCaseId,
          ...executionCases.map((item) => item.id).sort(),
        ])
      : undefined;
    const composition = executionContainerId ? composedLink({
      executionContainerId, executionCaseIds: executionCases.map(item => item.id),
      target, route, session, actor: actorCheck,
      navigation: runtimeNavigation, fixture: runtimeFixtureResolution,
    }) : undefined;

    const sourceObservationProjectionEligible =
      candidateMutationClass === "UNKNOWN" &&
      Boolean(composition) &&
      runtimeFixtureResolution?.status ===
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" &&
      executionCases.length > 0 &&
      executionCases.every((testCase) =>
        sourceAuthorizedObservationOnlyProjection({
          testCase,
          obligations,
          obligationLedger: args.obligationLedger,
          sourceLedger: args.plan.acceptanceSourceLedger,
        }) !== null
      );

    const mutationClass = sourceObservationProjectionEligible
      ? "READ_ONLY" as const
      : candidateMutationClass;

    const baseReadiness = executionReadiness({
      executionCaseCount: executionCases.length,
      target,
      route,
      navigation,
      session,
      actorCompatibility: actorCheck,
      fixture: planningFixture,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
      runtimeFixtureResolution,
      composedRuntimeResolution: composition,
      ...(deferredTarget ? { runtimeTargetGrounding: deferredTarget } : {}),
      mutationClass,
    });
    const discoveryEligible = discoveryOnlyEligible({
      target, persona, actorConstraint, mutationClass,
      readiness: baseReadiness.readiness,
    });
    const readiness = baseReadiness.readiness;
    const reason = baseReadiness.reason;
    const candidateContracts: PlannerBrowserEvidenceContract[] = [];
    for (const obligation of obligations) {
      const groups = groupsByObligation.get(obligation.id) ?? [];
      if (groups.length !== 1) continue;
      const evidenceContractId = stablePlanningId("evidence-contract", [
        obligation.id,
        candidate.candidateId,
      ]);
      if (contractIds.has(evidenceContractId)) continue;
      contractIds.add(evidenceContractId);
      const baseProofCapability = proofCapability(obligation, args.plan);
      candidateContracts.push({
        evidenceContractId,
        obligationId: obligation.id,
        verdictGroupId: groups[0]!.verdictGroupId,
        semanticCandidateId: candidate.candidateId,
        sourceUnitRefs: [...obligation.sourceUnitIds].sort()
          .map((sourceUnitId) => ({
            sourceUnitId,
            sourceRef: sourceRefById.get(sourceUnitId) ?? "UNAVAILABLE",
          })),
        ...(executionContainerId ? { executionContainerId } : {}),
        targetConstraint: target.constraint.obligations.find(
          (item) => item.obligationId === obligation.id
        )!,
        actorConstraint: actorConstraint.obligations.find(
          (item) => item.obligationId === obligation.id
        )!,
        routeConstraint: routeConstraint.obligations.find(
          (item) => item.obligationId === obligation.id
        )!,
        proofCapability: bindPlannerBrowserProofCapability({
          plan: args.plan,
          obligation,
          evidenceContractId,
          executionCases,
          targetCompatible:
            target.constraint.obligations.find(
              (item) => item.obligationId === obligation.id
            )?.status === "COMPATIBLE",
          ...(runtimeFixtureResolution
            ? { runtimeFixtureResolution }
            : {}),
          baseCapability: baseProofCapability,
        }),
        disposition: readiness === "READY"
          ? "PLANNED"
          : readiness === "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION"
            ? "SURFACE_RUNTIME_RESOLUTION_REQUIRED"
          : readiness === "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
            ? "COMPOSED_RUNTIME_RESOLUTION_REQUIRED"
          : readiness === "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
            ? "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
          : readiness === "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING"
            ? "RUNTIME_TARGET_GROUNDING_REQUIRED"
          : readiness,
        reason,
      });
    }
    evidenceContracts.push(...candidateContracts);
    if (executionContainerId && candidateContracts.length > 0) {
      executionContainers.push({
        executionContainerId,
        evidenceContractIds: candidateContracts
          .map((item) => item.evidenceContractId).sort(),
        semanticCandidateId: candidate.candidateId,
        sourceCaseId: candidate.proposedCaseId,
        executionCaseIds: executionCases.map((item) => item.id).sort(),
        requiredExecutionCaseIds: runtimeFixtureResolution
          ? runtimeFixtureResolution.members
              .filter((item) => item.required)
              .map((item) => item.executionCaseId).sort()
          : executionCases
              .filter((item) =>
                item.plannerExecutionShell?.partition.mode === "ALL_REQUIRED"
              )
              .map((item) => item.id).sort(),
        target,
        acceptanceActorConstraint: actorConstraint,
        acceptanceRouteConstraint: routeConstraint,
        executionNavigationBinding: navigation,
        ...(composition ? { composedRuntimeResolution: composition } : {}),
        ...(runtimeNavigation ? { runtimeNavigationResolution: runtimeNavigation } : {}),
        executionSessionBinding: session,
        actorCompatibility: actorCheck,
        route,
        persona,
        fixture: planningFixture,
        ...(runtimeFixtureResolution ? { runtimeFixtureResolution } : {}),
        ...(deferredTarget ? { runtimeTargetGrounding: deferredTarget } : {}),
        mutationClass,
        readiness,
        reason,
        ...(discoveryEligible ? {
          discoveryAdmission: {
            status: "ELIGIBLE" as const,
            reason: "Source-authoritative read-only shell admitted only for bounded runtime discovery; unresolved lexical target members remain non-authoritative until independently grounded at runtime.",
          },
        } : {}),
      });
    }
  }

  const executionReadyContainers = executionContainers.filter(
    (item) => [
      "READY",
      "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION",
      "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION",
      "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING",
    ].includes(item.readiness)
  );
  const boundedContainers = retainBoundedExecutionContainers({
    containers: executionReadyContainers,
    plan: args.plan,
    semanticIr: args.semanticIr,
    obligationLedger: args.obligationLedger,
  });
  const retainedContainers = boundedContainers.retained;
  const retainedObjects = new Set(retainedContainers);
  for (const container of executionReadyContainers) {
    if (retainedObjects.has(container)) continue;
    container.readiness = "UNALLOCATED_BUDGET";
    container.reason = boundedContainers.rejected.get(container) ??
      "The bounded browser execution budget rejected this container; no evidence contracts were merged or silently dropped.";
    for (const contract of evidenceContracts) {
      if (contract.executionContainerId !== container.executionContainerId) continue;
      contract.disposition = "UNALLOCATED_BUDGET";
      contract.reason = container.reason;
    }
  }

  const accounting = args.obligationLedger.obligations
    .map((obligation): PlannerBrowserObligationEvidenceAccounting => {
      const own = evidenceContracts.filter(
        (item) => item.obligationId === obligation.id
      );
      const binding = proofCapability(obligation, args.plan);
      if (own.length === 0) {
        if (binding.state === "MANUAL_BY_NATURE") {
          return {
            obligationId: obligation.id,
            disposition: "MANUAL",
            evidenceContractIds: [],
            reason: binding.reason,
          };
        }
        if (binding.state === "UNSUPPORTED_AUTOMATION_SEMANTIC") {
          return {
            obligationId: obligation.id,
            disposition: "UNSUPPORTED_AUTOMATION",
            evidenceContractIds: [],
            reason: binding.reason,
          };
        }
        return {
          obligationId: obligation.id,
          disposition: "UNALLOCATED",
          evidenceContractIds: [],
          reason: "No accepted semantic candidate covers this authoritative obligation.",
        };
      }
      const ids = own.map((item) => item.evidenceContractId).sort();
      if (binding.state === "MANUAL_BY_NATURE") {
        return {
          obligationId: obligation.id,
          disposition: "MANUAL",
          evidenceContractIds: ids,
          reason: binding.reason,
        };
      }
      if (binding.state === "UNSUPPORTED_AUTOMATION_SEMANTIC") {
        return {
          obligationId: obligation.id,
          disposition: "UNSUPPORTED_AUTOMATION",
          evidenceContractIds: ids,
          reason: binding.reason,
        };
      }
      if (own.some((item) => [
        "PLANNED", "SURFACE_RUNTIME_RESOLUTION_REQUIRED",
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED", "COMPOSED_RUNTIME_RESOLUTION_REQUIRED",
        "RUNTIME_TARGET_GROUNDING_REQUIRED",
      ].includes(item.disposition))) {
        return {
          obligationId: obligation.id,
          disposition: "EVIDENCE_CONTRACT_ALLOCATED",
          evidenceContractIds: ids,
          reason: binding.state === "SUPPORTED_AND_BOUND"
            ? "At least one materializable evidence contract has a resolved proof capability."
            : "At least one materializable evidence contract is planned with proof capability explicitly unresolved.",
        };
      }
      if (own.some((item) => [
        "TARGET_UNRESOLVED", "NAVIGATION_UNRESOLVED",
        "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED", "SESSION_UNRESOLVED",
        "ACTOR_CONSTRAINT_UNRESOLVED", "PERSONA_UNRESOLVED", "ROUTE_UNRESOLVED",
        "FIXTURE_UNAVAILABLE", "POLICY_BLOCKED",
      ].includes(item.disposition))) {
        return {
          obligationId: obligation.id,
          disposition: "BLOCKED",
          evidenceContractIds: ids,
          reason: "Evidence planning exists, but execution authority or safety prerequisites remain unresolved.",
        };
      }
      return {
        obligationId: obligation.id,
        disposition: own.some((item) => item.disposition === "UNALLOCATED_BUDGET")
          ? "UNALLOCATED"
          : "UNRESOLVED",
        evidenceContractIds: ids,
        reason: "Evidence planning exists, but no execution container is currently ready.",
      };
    })
    .sort((left, right) => left.obligationId.localeCompare(right.obligationId));

  return {
    evidenceContracts: evidenceContracts.sort((left, right) =>
      left.evidenceContractId.localeCompare(right.evidenceContractId)
    ),
    executionContainers: executionContainers.sort((left, right) =>
      left.executionContainerId.localeCompare(right.executionContainerId)
    ),
    accounting,
  };
}

/**
 * Re-applies only deterministic V2 authority transport to an already-built
 * planning audit. This supports identity-stable archived-plan validation without
 * reconstructing execution shells or asking a model to reinterpret source.
 */
export function transportPlannerBrowserExecutionAuthority(args: {
  plan: TestPlan;
  obligationLedger: PlannerAcceptanceObligationLedger;
  /** Exact archived authored cases, never regenerated from semantic prose. */
  sourceCases?: BrowserTestCase[];
}): TestPlan {
  const audit = args.plan.browserSemanticPlanningAudit;
  const semanticIr = args.plan.browserSemanticIr;
  if (
    audit?.version !== "V2" ||
    !audit.evidenceContracts ||
    !audit.executionContainers ||
    !audit.obligationEvidenceAccounting ||
    !semanticIr
  ) {
    return args.plan;
  }

  const obligationById = new Map(
    args.obligationLedger.obligations.map((item) => [item.id, item])
  );
  const candidateById = new Map(
    semanticIr.candidates.map((item) => [item.candidateId, item])
  );
  const evidenceById = new Map(
    audit.evidenceContracts.map((item) => [item.evidenceContractId, item])
  );
  const sourceRefById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceRef])
  );
  const sourceKindById = new Map(
    (args.plan.acceptanceSourceLedger?.sourceUnits ?? [])
      .map((item) => [item.id, item.sourceKind])
  );

  for (const container of audit.executionContainers) {
    const candidate = candidateById.get(container.semanticCandidateId);
    const obligations = [...new Set(container.evidenceContractIds.flatMap(
      (id) => {
        const obligationId = evidenceById.get(id)?.obligationId;
        return obligationId ? [obligationId] : [];
      }
    ))].sort().flatMap((id) => {
      const obligation = obligationById.get(id);
      return obligation ? [obligation] : [];
    });
    const prior = container as PlannerBrowserExecutionContainer & {
      route?: PlannerBrowserExecutionContainer["route"];
      target: PlannerBrowserExecutionContainer["target"] & {
        status?: "AUTHORITATIVE" | "CANDIDATE" | "UNRESOLVED" | "CONFLICT";
        surface?: string;
        basis?: "SOURCE_OBLIGATION" | "PLANNER_CANDIDATE" | "UNAVAILABLE";
        route?: string;
        sourceRef?: string;
      };
    };
    const routeBase = prior.route ?? (
      prior.target.route
        ? {
            status: prior.target.status ?? "UNRESOLVED",
            value: prior.target.route,
            basis: prior.target.basis === "PLANNER_CANDIDATE"
              ? "PLANNER_CANDIDATE" as const
              : prior.target.basis === "UNAVAILABLE"
                ? "UNAVAILABLE" as const
                : prior.target.basis,
            ...(prior.target.sourceRef
              ? { sourceRef: prior.target.sourceRef }
              : {}),
          }
        : { status: "UNRESOLVED" as const, basis: "UNAVAILABLE" as const }
    );
    const executionCases = [
      ...args.plan.browserCases,
      ...(args.plan.discoveryBrowserCases ?? []),
    ].filter((testCase) => container.executionCaseIds.includes(testCase.id));
    const sourceTargetMembers = sourceAuthorizedSurfaceMembers({
      candidate,
      obligations,
      plan: args.plan,
    });
    const canonicalSourceTarget = canonicalSourceTargetSurface({
      candidate,
      obligations,
      plan: args.plan,
      executionCases,
      knownRoutes: routeBase.value ? [routeBase.value] : [],
    });
    const target = executionTargetContract({
      obligations,
      sourceRefById,
      sourceKindById,
      sourceSurfaceMembers: sourceTargetMembers,
      ...(canonicalSourceTarget ||
        (sourceTargetMembers.length === 0 &&
          (candidate?.proposedTargetSurface || prior.target.candidateSurface))
        ? {
            candidateSurface:
              canonicalSourceTarget ||
              candidate?.proposedTargetSurface ||
              prior.target.candidateSurface,
          }
        : {}),
    });
    const replayPersonas = new Set([
      candidate?.proposedPersona,
      prior.persona.value,
    ].filter((item): item is "company_admin" | "talent" =>
      item === "company_admin" || item === "talent"
    ));
    const persona = executionPersonaContract({
      candidatePersona: replayPersonas.size === 1
        ? [...replayPersonas][0]
        : undefined,
      candidateConflict: replayPersonas.size > 1,
      ...(canonicalRuntimeRoutePersona({
        plan: args.plan,
        sourceSurface: canonicalSourceTarget,
        executionCases,
        knownRoutes: routeBase.value ? [routeBase.value] : [],
      })
        ? {
            runtimeRoutePersona: canonicalRuntimeRoutePersona({
              plan: args.plan,
              sourceSurface: canonicalSourceTarget,
              executionCases,
              knownRoutes: routeBase.value ? [routeBase.value] : [],
            }),
          }
        : {}),
      obligations,
      sourceRefById,
      sourceKindById,
    });
    const route = candidate
      ? recoverExactStaticExecutionRoute({
          plan: args.plan,
          ...(persona.value ? { persona: persona.value } : {}),
          target,
          route: compatibleExecutionRoute(routeBase, target),
        })
      : compatibleExecutionRoute(routeBase, target);
    const actorConstraint = acceptanceActorConstraint({
      obligations,
      sourceRefById,
      sourceKindById,
    });
    const routeConstraint = acceptanceRouteConstraint({
      obligations,
      route,
      sourceRefById,
      sourceKindById,
    });
    const deferredTarget = runtimeTargetGroundingContract({
      obligations,
      target,
      route,
      persona,
      fixture: container.fixture,
      mutationClass: container.mutationClass,
      sourceRefById,
      sourceKindById,
      plan: args.plan,
    });
    const navigation = executionNavigationBinding(route, target, deferredTarget);
    const runtimeNavigation = runtimeNavigationResolutionContract({
      target,
      route,
      navigation,
      persona,
      ...(deferredTarget ? { runtimeTargetGrounding: deferredTarget } : {}),
    });
    const session = executionSessionBinding({
      navigation,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
      ...(persona.value ? { candidatePersona: persona.value } : {}),
    });
    const actorCheck = actorCompatibility({
      constraint: actorConstraint,
      session,
    });
    const runtimeFixtureResolution = runtimeFixtureResolutionContract({
      obligations,
      sourceRefById,
      persona: persona.value,
      archivedContainer: container,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
    });
    if (runtimeFixtureResolution) {
      container.runtimeFixtureResolution = runtimeFixtureResolution;
      if (runtimeFixtureResolution.status ===
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED") {
        container.fixture = {
          ...container.fixture,
          status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
          reason: "Canonical per-shell fixture constraints are complete and an existing read-only resolver capability can attempt runtime PREPARE; no current fixture binding exists.",
        };
      } else if (container.fixture.status ===
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED") {
        container.fixture = {
          ...container.fixture,
          status: "UNKNOWN",
          reason: "The serialized runtime fixture capability contract is no longer complete; fixture resolution remains unavailable.",
        };
      }
    }
    const composition = composedLink({
      executionContainerId: container.executionContainerId,
      executionCaseIds: container.executionCaseIds,
      target, route, session, actor: actorCheck,
      navigation: runtimeNavigation, fixture: container.runtimeFixtureResolution,
    });
    if (composition) container.composedRuntimeResolution = composition;
    else delete container.composedRuntimeResolution;
    const baseState = executionReadiness({
      executionCaseCount: container.executionCaseIds.length,
      target,
      route,
      navigation,
      session,
      actorCompatibility: actorCheck,
      fixture: container.fixture,
      ...(runtimeNavigation ? { runtimeNavigation } : {}),
      runtimeFixtureResolution: container.runtimeFixtureResolution,
      composedRuntimeResolution: composition,
      ...(deferredTarget ? { runtimeTargetGrounding: deferredTarget } : {}),
      mutationClass: container.mutationClass,
    });
    const discoveryEligible = discoveryOnlyEligible({
      target, persona, actorConstraint, mutationClass: container.mutationClass,
      readiness: baseState.readiness,
    });
    const state = baseState;
    container.target = target;
    if (deferredTarget) container.runtimeTargetGrounding = deferredTarget;
    else delete container.runtimeTargetGrounding;
    container.acceptanceActorConstraint = actorConstraint;
    container.acceptanceRouteConstraint = routeConstraint;
    container.executionNavigationBinding = navigation;
    if (runtimeNavigation) {
      container.runtimeNavigationResolution = runtimeNavigation;
    } else {
      delete container.runtimeNavigationResolution;
    }
    container.executionSessionBinding = session;
    container.actorCompatibility = actorCheck;
    container.route = route;
    container.persona = persona;
    container.readiness = state.readiness;
    container.reason = state.reason;
    if (discoveryEligible) {
      container.discoveryAdmission = {
        status: "ELIGIBLE",
        reason: "Source-authoritative read-only shell admitted only for bounded runtime discovery; unresolved lexical target members remain non-authoritative until independently grounded at runtime.",
      };
    } else {
      delete container.discoveryAdmission;
    }
    for (const id of container.evidenceContractIds) {
      const evidence = evidenceById.get(id);
      if (!evidence) continue;
      const obligation = obligationById.get(evidence.obligationId);
      const targetConstraint = target.constraint.obligations.find(
        (item) => item.obligationId === evidence.obligationId
      );
      if (targetConstraint) evidence.targetConstraint = targetConstraint;
      else delete evidence.targetConstraint;
      const actorConstraintItem = actorConstraint.obligations.find(
        (item) => item.obligationId === evidence.obligationId
      );
      if (actorConstraintItem) evidence.actorConstraint = actorConstraintItem;
      else delete evidence.actorConstraint;
      const routeConstraintItem = routeConstraint.obligations.find(
        (item) => item.obligationId === evidence.obligationId
      );
      if (routeConstraintItem) evidence.routeConstraint = routeConstraintItem;
      else delete evidence.routeConstraint;
      evidence.disposition = state.readiness === "READY"
        ? "PLANNED"
        : state.readiness === "CASE_MATERIALIZABLE_WITH_RUNTIME_TARGET_GROUNDING"
          ? "RUNTIME_TARGET_GROUNDING_REQUIRED"
        : state.readiness === "CASE_MATERIALIZABLE_WITH_RUNTIME_SURFACE_RESOLUTION"
          ? "SURFACE_RUNTIME_RESOLUTION_REQUIRED"
        : state.readiness === "CASE_MATERIALIZABLE_WITH_COMPOSED_RUNTIME_ENTITY_RESOLUTION"
          ? "COMPOSED_RUNTIME_RESOLUTION_REQUIRED"
        : state.readiness ===
            "CASE_MATERIALIZABLE_WITH_RUNTIME_FIXTURE_RESOLUTION"
          ? "RUNTIME_FIXTURE_RESOLUTION_REQUIRED"
          : state.readiness;
      evidence.reason = state.reason;
      if (obligation) {
        const executionCases = args.plan.browserCases.filter((testCase) => {
          const executionCaseId =
            testCase.runtimeFixtureResolutionContract
              ?.interactionExecutionCaseId ?? testCase.id;
          return container.executionCaseIds.includes(executionCaseId);
        });
        evidence.proofCapability = bindPlannerBrowserProofCapability({
          plan: args.plan,
          obligation,
          evidenceContractId: evidence.evidenceContractId,
          executionCases,
          targetCompatible:
            targetConstraint?.status === "COMPATIBLE",
          ...(container.runtimeFixtureResolution
            ? {
                runtimeFixtureResolution:
                  container.runtimeFixtureResolution,
              }
            : {}),
          baseCapability: proofCapability(obligation, args.plan),
        });
      }
    }
  }

  if (args.plan.acceptanceVerdictGrouping) {
    const preliminaryPartitions =
      buildPlannerSourceBackedAtomicSurfacePartitions({
        plan: args.plan,
        semanticIr,
        verdictGrouping: args.plan.acceptanceVerdictGrouping,
        obligationLedger: args.obligationLedger,
        executionContainers: audit.executionContainers,
      });
    attachPlannerExecutionSurfacePrerequisites({
      obligationLedger: args.obligationLedger,
      semanticIr,
      partitions: preliminaryPartitions,
      executionContainers: audit.executionContainers,
      evidenceContracts: audit.evidenceContracts,
      accounting: audit.obligationEvidenceAccounting,
    });
    for (const container of audit.executionContainers) {
      const prerequisite = container.executionSurfacePrerequisite;
      if (!prerequisite) continue;
      for (const evidenceContractId of container.evidenceContractIds) {
        const evidence = evidenceById.get(evidenceContractId);
        const obligation = evidence && obligationById.get(evidence.obligationId);
        if (!evidence || !obligation ||
          prerequisite.surfacePartition.obligationId !== obligation.id) continue;
        evidence.proofCapability = bindPlannerBrowserProofCapability({
          plan: args.plan,
          obligation,
          evidenceContractId: evidence.evidenceContractId,
          executionCases: [],
          executionSurfacePrerequisites: [prerequisite],
          targetCompatible: true,
          baseCapability: evidence.proofCapability,
        });
      }
    }
  }

  if (args.sourceCases) {
    const serialized = materializeRuntimeFixtureCases({
      // Mirror initial V2 materialization: the helper itself admits both
      // runtime-fixture and composed-runtime eligible containers.
      containers: audit.executionContainers,
      evidenceContracts: audit.evidenceContracts,
      verdictContracts: audit.contracts,
      sourceCases: args.sourceCases,
      obligationById,
      obligationLedger: args.obligationLedger,
      sourceLedger: args.plan.acceptanceSourceLedger,
    });
    for (const testCase of serialized) {
      const existingIndex = args.plan.browserCases.findIndex(
        (existing) => existing.id === testCase.id
      );
      if (existingIndex >= 0) {
        // Stable generated case identity may already exist in an archived plan.
        // Refresh only the final execution route derived from current deterministic
        // authority transport while preserving archived authoring/discovery provenance.
        args.plan.browserCases[existingIndex] = {
          ...args.plan.browserCases[existingIndex]!,
          startRoute: testCase.startRoute,
        };
        continue;
      }
      if (args.plan.browserCases.length >= MAX_BROWSER_EXECUTION_UNITS) break;
      args.plan.browserCases.push(testCase);
    }
    audit.allocatedCaseCount = args.plan.browserCases.length;
  }

  const surfaceCases = materializeRuntimeSurfaceCases({
    containers: audit.executionContainers,
    evidenceContracts: audit.evidenceContracts,
    semanticIr,
    sourceCases: args.sourceCases ?? [],
    obligationById,
    verdictContracts: audit.contracts,
    obligationLedger: args.obligationLedger,
    sourceLedger: args.plan.acceptanceSourceLedger,
  });
  for (const testCase of surfaceCases) {
    const existingIndex = args.plan.browserCases.findIndex(
      (existing) => existing.id === testCase.id
    );
    if (existingIndex >= 0) {
      const existing = args.plan.browserCases[existingIndex]!;
      const canonicalContract = testCase.executionIntentAuthority
        ?.executionCheckContract;
      const contractConflict = Boolean(
        existing.executionCheckContract && canonicalContract &&
        JSON.stringify(existing.executionCheckContract) !==
          JSON.stringify(canonicalContract)
      );
      if (!contractConflict) {
        /*
         * Stable runtime-surface IDs survive archived replay. Reconcile the
         * already-derived canonical authority instead of retaining the
         * earlier authority-free shell.
         */
        args.plan.browserCases[existingIndex] = {
          ...existing,
          startRoute: testCase.startRoute,
          ...(testCase.acceptanceObligationIds
            ? { acceptanceObligationIds: testCase.acceptanceObligationIds }
            : {}),
          ...(testCase.executionVerdictScope
            ? { executionVerdictScope: testCase.executionVerdictScope }
            : {}),
          ...(testCase.executionIntentAuthority
            ? { executionIntentAuthority: testCase.executionIntentAuthority }
            : {}),
          ...(canonicalContract
            ? { executionCheckContract: canonicalContract }
            : {}),
        };
      }
      continue;
    }
    if (args.plan.browserCases.length >= MAX_BROWSER_EXECUTION_UNITS) break;
    args.plan.browserCases.push(testCase);
  }
  const runtimeTargetCases = materializeRuntimeTargetGroundingCases({
    containers: audit.executionContainers,
    evidenceContracts: audit.evidenceContracts,
    sourceCases: args.sourceCases ?? [],
    obligationById,
  });
  for (const testCase of runtimeTargetCases) {
    if (args.plan.browserCases.some(existing => existing.id === testCase.id)) continue;
    if (args.plan.browserCases.length >= MAX_BROWSER_EXECUTION_UNITS) break;
    args.plan.browserCases.push(testCase);
  }
  const runtimeNavigationDiscoveryCases = materializeRuntimeNavigationDiscoveryCases({
    containers: audit.executionContainers,
    evidenceContracts: audit.evidenceContracts,
    verdictContracts: audit.contracts,
    sourceCases: args.sourceCases ?? [],
    obligationById,
    obligationLedger: args.obligationLedger,
    sourceLedger: args.plan.acceptanceSourceLedger,
  });
  args.plan.discoveryBrowserCases = retainBoundedBrowserCases({
    cases: runtimeNavigationDiscoveryCases,
  });
  audit.allocatedCaseCount = args.plan.browserCases.length;

  args.plan.browserCases = retainBoundedBrowserCases({
    cases: args.plan.browserCases,
  });
  audit.allocatedCaseCount = args.plan.browserCases.length;

  for (const testCase of args.plan.browserCases) {
    const executionCaseId =
      testCase.runtimeFixtureResolutionContract
        ?.interactionExecutionCaseId ??
      testCase.executionSurfacePrerequisiteContract
        ?.executionContext.executionCaseId ??
      testCase.id;
    const bindings = audit.evidenceContracts
      .flatMap((item) => item.proofCapability.bindings ?? [])
      .filter((item) => item.executionCaseId === executionCaseId);
    const uniqueBindings = [...new Map(
      bindings.map((item) => [item.bindingId, item])
    ).values()].sort((left, right) =>
      left.bindingId.localeCompare(right.bindingId)
    );
    if (uniqueBindings.length > 0) {
      testCase.deterministicProofBindings = uniqueBindings;
    } else {
      delete testCase.deterministicProofBindings;
    }

    const sourceDerivedBindingCarriers = uniqueBindings.flatMap((binding) => {
      if (binding.capabilityKind !== "VISIBLE_TEXT_IN_EXPANDED_SURFACE") {
        return [];
      }
      const assertion = binding.assertion;
      const alreadyCarried = (testCase.steps ?? []).some((step) =>
        step.action === assertion.action &&
        step.oracleId === assertion.oracleId &&
        step.text === assertion.expectedText
      );
      return alreadyCarried ? [] : [{
        action: assertion.action,
        text: assertion.expectedText,
        oracleId: assertion.oracleId,
      }];
    });
    if (sourceDerivedBindingCarriers.length > 0) {
      testCase.steps = [
        ...(testCase.steps ?? []),
        ...sourceDerivedBindingCarriers,
      ];
    }

    const sourceBoundAssertionSetRequirements =
      testCase.startRoute === "UNKNOWN"
        ? []
        : buildBrowserSourceBoundAssertionSetRequirements({
            testCase,
            obligationLedger: args.obligationLedger,
            sourceLedger: args.plan.acceptanceSourceLedger,
            acceptedRoutePath: testCase.startRoute,
          });
    const sourceDerivedCheckCarriers =
      buildBrowserSourceDerivedAssertionCheckCarriers({
        testCase,
        requirements: sourceBoundAssertionSetRequirements,
      });
    if (sourceDerivedCheckCarriers.length > 0) {
      testCase.steps = [
        ...(testCase.steps ?? []),
        ...sourceDerivedCheckCarriers,
      ];
    }
    const executionCheckContract = deriveBrowserExecutionCheckContract({
      testCase,
      sourceBoundAssertionSetRequirements,
    });
    if (executionCheckContract) {
      testCase.executionCheckContract = executionCheckContract;
    } else {
      delete testCase.executionCheckContract;
    }
  }

  if (args.plan.acceptanceVerdictGrouping) {
    audit.sourceBackedAtomicSurfacePartitions =
      buildPlannerSourceBackedAtomicSurfacePartitions({
        plan: args.plan,
        semanticIr,
        verdictGrouping: args.plan.acceptanceVerdictGrouping,
        obligationLedger: args.obligationLedger,
        executionContainers: audit.executionContainers,
      });
  }

  const unresolvedIds = (disposition: PlannerBrowserEvidenceContractDisposition) =>
    [...new Set(audit.evidenceContracts!
      .filter((item) => item.disposition === disposition)
      .map((item) => item.obligationId))].sort();
  audit.targetUnresolvedObligationIds = unresolvedIds("TARGET_UNRESOLVED");
  audit.runtimeTargetGroundingRequiredObligationIds = unresolvedIds(
    "RUNTIME_TARGET_GROUNDING_REQUIRED"
  );
  audit.navigationUnresolvedObligationIds = unresolvedIds("NAVIGATION_UNRESOLVED");
  audit.navigationRuntimeResolutionRequiredObligationIds = unresolvedIds(
    "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED"
  );
  audit.sessionUnresolvedObligationIds = unresolvedIds("SESSION_UNRESOLVED");
  audit.actorConstraintUnresolvedObligationIds = unresolvedIds(
    "ACTOR_CONSTRAINT_UNRESOLVED"
  );
  audit.personaUnresolvedObligationIds = unresolvedIds("PERSONA_UNRESOLVED");
  audit.routeUnresolvedObligationIds = unresolvedIds("ROUTE_UNRESOLVED");

  for (const row of audit.obligationEvidenceAccounting) {
    if (["MANUAL", "UNSUPPORTED_AUTOMATION", "UNALLOCATED"].includes(
      row.disposition
    )) continue;
    const own = row.evidenceContractIds.flatMap((id) => {
      const evidence = evidenceById.get(id);
      return evidence ? [evidence] : [];
    });
    if (own.some((item) => [
      "PLANNED", "SURFACE_RUNTIME_RESOLUTION_REQUIRED",
      "RUNTIME_FIXTURE_RESOLUTION_REQUIRED", "COMPOSED_RUNTIME_RESOLUTION_REQUIRED",
      "RUNTIME_TARGET_GROUNDING_REQUIRED",
    ].includes(item.disposition))) {
      row.disposition = "EVIDENCE_CONTRACT_ALLOCATED";
      row.reason = own.some(item => item.disposition === "COMPOSED_RUNTIME_RESOLUTION_REQUIRED")
        ? "A composed case is materializable; runtime preparation and proof authority remain independently unresolved."
        : "At least one execution-ready evidence contract is planned; proof authority remains independently represented by the contract.";
    } else if (own.length > 0) {
      row.disposition = "BLOCKED";
      row.reason = "Evidence planning exists, but execution authority or safety prerequisites remain unresolved.";
    }
  }
  // Archived deterministic transport can materialize stable runtime fixture/surface
  // case IDs after the original plan-level allocation audit was recorded. Refresh
  // only this derived audit from the final serialized case set so downstream
  // consumers never observe stale pre-materialization representation metadata.
  args.plan.obligationCaseAllocationAudit =
    auditPlannerObligationCaseAllocation(
      args.plan,
      args.obligationLedger
    );

  return args.plan;
}

export function applyPlannerBrowserSemanticAllocation(args: {
  plan: TestPlan;
  semanticIr: PlannerBrowserSemanticIr;
  verdictGrouping: PlannerAcceptanceVerdictGrouping;
  obligationLedger: PlannerAcceptanceObligationLedger;
}): TestPlan {
  const { plan, semanticIr, verdictGrouping, obligationLedger } = args;
  if (
    plan.browserSemanticIr?.version === "V1" &&
    ["V1", "V2"].includes(
      String(plan.browserSemanticPlanningAudit?.version)
    )
  ) {
    return plan;
  }
  specializePlannerSourceMemberSemanticCandidates({
    plan,
    semanticIr,
    obligationLedger,
  });
  expandSourceBackedMultiDisclosureCandidates({
    plan,
    semanticIr,
    obligationLedger,
  });
  expandSourceBackedMultiSurfaceAtomicExecutionProposals({
    plan,
    semanticIr,
    verdictGrouping,
    obligationLedger,
  });
  attachSourceBackedReadOnlyDisclosureContracts({
    plan,
    semanticIr,
    obligationLedger,
  });
  plan.browserSemanticIr = semanticIr;
  if (semanticIr.status === "LEGACY_INPUT") {
    plan.browserSemanticPlanningAudit = {
      version: "V1",
      status: "LEGACY_COMPATIBILITY",
      authoritativeObligationCount: obligationLedger.obligations.length,
      accountedObligationIds: [],
      unaccountedObligationIds: obligationLedger.obligations.map((item) => item.id).sort(),
      verdictGroupCount: 0,
      authoritativeGroupCount: 0,
      unknownGroupCount: 0,
      allocatedCaseCount: plan.browserCases.length,
      ticketManualObligationIds: [],
      policyBlockedObligationIds: [],
      unsupportedObligationIds: [],
      targetUnresolvedObligationIds: [],
      fixtureUnavailableObligationIds: [],
      unallocatedBudgetObligationIds: [],
      manualCouplingViolationCount: 0,
      duplicateObligationCoverageCount: 0,
      hallucinatedAuthorityCount: 0,
      contracts: [],
    };
    return plan;
  }

  const obligationById = new Map(
    obligationLedger.obligations.map((item) => [item.id, item])
  );
  const sourceExecutionCases = [...plan.browserCases];
  const evidencePlanning = buildPlannerBrowserEvidencePlanning({
    plan,
    semanticIr,
    verdictGrouping,
    obligationLedger,
  });
  let sourceBackedAtomicSurfacePartitions =
    buildPlannerSourceBackedAtomicSurfacePartitions({
      plan,
      semanticIr,
      verdictGrouping,
      obligationLedger,
      executionContainers: evidencePlanning.executionContainers,
    });
  attachPlannerExecutionSurfacePrerequisites({
    obligationLedger,
    semanticIr,
    partitions: sourceBackedAtomicSurfacePartitions,
    executionContainers: evidencePlanning.executionContainers,
    evidenceContracts: evidencePlanning.evidenceContracts,
    accounting: evidencePlanning.accounting,
  });
  /*
   * Surface prerequisites are attached after the initial evidence pass. Bind
   * their already source-authorized SEARCH_INPUT capability immediately,
   * rather than requiring planner-authored steps or a later runtime rebuild.
   */
  for (const container of evidencePlanning.executionContainers) {
    const prerequisite = container.executionSurfacePrerequisite;
    if (!prerequisite) continue;
    for (const evidenceContractId of container.evidenceContractIds) {
      const evidence = evidencePlanning.evidenceContracts.find((item) =>
        item.evidenceContractId === evidenceContractId
      );
      const obligation = evidence && obligationById.get(evidence.obligationId);
      if (!evidence || !obligation ||
        prerequisite.surfacePartition.obligationId !== obligation.id) continue;
      evidence.proofCapability = bindPlannerBrowserProofCapability({
        plan,
        obligation,
        evidenceContractId: evidence.evidenceContractId,
        executionCases: [],
        executionSurfacePrerequisites: [prerequisite],
        targetCompatible: true,
        baseCapability: evidence.proofCapability,
      });
    }
  }
  sourceBackedAtomicSurfacePartitions =
    buildPlannerSourceBackedAtomicSurfacePartitions({
      plan,
      semanticIr,
      verdictGrouping,
      obligationLedger,
      executionContainers: evidencePlanning.executionContainers,
    });
  const contracts = verdictGrouping.groups.map((group) =>
    buildContract({ group, plan, semanticIr, obligationById })
  );
  const contractById = new Map(
    contracts.map((item) => [item.verdictGroupId, item])
  );
  for (const contract of contracts) {
    if (contract.dependencyVerdictGroupIds.length === 0) continue;
    const unavailable = contract.dependencyVerdictGroupIds.filter((id) => {
      const dependency = contractById.get(id);
      return !dependency || ![
        "AUTOMATED_ALLOCATED",
        "ALLOCATED_MANUAL",
      ].includes(dependency.disposition);
    });
    if (unavailable.length > 0 && [
      "AUTOMATED_ALLOCATED",
      "ALLOCATED_MANUAL",
    ].includes(contract.disposition)) {
      contract.disposition = "CANDIDATE_UNAVAILABLE";
      contract.reason =
        "A required dependency group has no allocated coherent case; no runtime state carry-over is assumed.";
    }
  }
  const allocatable = contracts
    .filter((item) => ["AUTOMATED_ALLOCATED", "ALLOCATED_MANUAL"]
      .includes(item.disposition))
    .sort((left, right) =>
      left.dependencyVerdictGroupIds.length - right.dependencyVerdictGroupIds.length ||
      (left.disposition === right.disposition
        ? left.verdictGroupId.localeCompare(right.verdictGroupId)
        : left.disposition === "AUTOMATED_ALLOCATED" ? -1 : 1)
    );
  const selectedIds = new Set<string>();
  const allocated: PlannerBrowserVerdictContract[] = [];
  for (const contract of allocatable) {
    const dependenciesSelected = contract.dependencyVerdictGroupIds.every(
      (id) => selectedIds.has(id)
    );
    if (!dependenciesSelected) {
      contract.disposition = "UNALLOCATED_BUDGET";
      contract.reason =
        "A dependency group was not retained within the bounded case set; the dependent group was not materialized.";
      continue;
    }
    if (allocated.length >= MAX_RAW_BROWSER_EXECUTION_UNITS) {
      contract.disposition = "UNALLOCATED_BUDGET";
      contract.reason =
        "The authoritative verdict groups exceeded the four-case raw execution budget; it was not merged or dropped from ticket accounting.";
      continue;
    }
    allocated.push(contract);
    selectedIds.add(contract.verdictGroupId);
  }
  const verdictCases = allocated.map((contract, index) => {
    const candidate = semanticIr.candidates.find(
      (item) => item.candidateId === contract.candidateIds[0]
    )!;
    const candidateCase = candidateExecutionCases(plan, candidate)[0]!;
    const result = materializeCase({
      index, contract, candidate, candidateCase, obligationById,
    });
    contract.allocatedCaseId = result.id;
    return result;
  });
  const groupOnlyCases = materializeGroupOnlyCases({
    contracts,
    plan,
    semanticIr,
    obligationById,
    startIndex: verdictCases.length,
    budget: Math.max(0, MAX_RAW_BROWSER_EXECUTION_UNITS - verdictCases.length),
  });
  const runtimeFixtureCases = materializeRuntimeFixtureCases({
    containers: evidencePlanning.executionContainers,
    evidenceContracts: evidencePlanning.evidenceContracts,
    verdictContracts: contracts,
    sourceCases: sourceExecutionCases,
    obligationById,
    obligationLedger,
    sourceLedger: plan.acceptanceSourceLedger,
  });
  const runtimeSurfaceCases = materializeRuntimeSurfaceCases({
    containers: evidencePlanning.executionContainers,
    evidenceContracts: evidencePlanning.evidenceContracts,
    semanticIr,
    sourceCases: sourceExecutionCases,
    obligationById,
    verdictContracts: contracts,
    obligationLedger,
    sourceLedger: plan.acceptanceSourceLedger,
  });
  const runtimeTargetCases = materializeRuntimeTargetGroundingCases({
    containers: evidencePlanning.executionContainers,
    evidenceContracts: evidencePlanning.evidenceContracts,
    sourceCases: sourceExecutionCases,
    obligationById,
  });
  const runtimeNavigationDiscoveryCases = materializeRuntimeNavigationDiscoveryCases({
    containers: evidencePlanning.executionContainers,
    evidenceContracts: evidencePlanning.evidenceContracts,
    verdictContracts: contracts,
    sourceCases: sourceExecutionCases,
    obligationById,
    obligationLedger,
    sourceLedger: plan.acceptanceSourceLedger,
  });
  const cases = retainBoundedBrowserCases({ cases: [
    ...verdictCases,
    ...groupOnlyCases,
    ...runtimeFixtureCases,
    ...runtimeSurfaceCases,
    ...runtimeTargetCases,
  ] });
  plan.browserCases = cases;
  plan.discoveryBrowserCases = retainBoundedBrowserCases({
    cases: runtimeNavigationDiscoveryCases,
  });

  const authoritativeIds = obligationLedger.obligations.map((item) => item.id).sort();
  const accountedIds = [...new Set(contracts.flatMap((item) => item.obligationIds))].sort();
  const coverageCounts = new Map<string, number>();
  for (const testCase of cases) {
    for (const id of testCase.acceptanceObligationIds ?? []) {
      coverageCounts.set(id, (coverageCounts.get(id) ?? 0) + 1);
    }
  }
  const audit: PlannerBrowserSemanticPlanningAudit = {
    version: "V2",
    status:
      semanticIr.status === "ACTIVE" &&
      authoritativeIds.every((id) => accountedIds.includes(id))
        ? "APPLIED"
        : "FAIL_CLOSED",
    authoritativeObligationCount: authoritativeIds.length,
    accountedObligationIds: accountedIds,
    unaccountedObligationIds: authoritativeIds.filter((id) => !accountedIds.includes(id)),
    verdictGroupCount: contracts.length,
    authoritativeGroupCount: contracts.filter(
      (item) => item.relationshipAuthority === "AUTHORITATIVE"
    ).length,
    unknownGroupCount: contracts.filter((item) => item.relationship === "UNKNOWN").length,
    allocatedCaseCount: cases.length,
    ticketManualObligationIds: manualIds(contracts),
    policyBlockedObligationIds: idsFor(contracts, ["POLICY_BLOCKED"]),
    unsupportedObligationIds: idsFor(contracts, ["UNSUPPORTED_AUTOMATION"]),
    targetUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "TARGET_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    runtimeTargetGroundingRequiredObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition ===
          "RUNTIME_TARGET_GROUNDING_REQUIRED")
        .map((item) => item.obligationId)
    )].sort(),
    navigationUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "NAVIGATION_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    navigationRuntimeResolutionRequiredObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) =>
          item.disposition === "NAVIGATION_RUNTIME_RESOLUTION_REQUIRED"
        )
        .map((item) => item.obligationId)
    )].sort(),
    sessionUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "SESSION_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    actorConstraintUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "ACTOR_CONSTRAINT_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    personaUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "PERSONA_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    routeUnresolvedObligationIds: [...new Set(
      evidencePlanning.evidenceContracts
        .filter((item) => item.disposition === "ROUTE_UNRESOLVED")
        .map((item) => item.obligationId)
    )].sort(),
    fixtureUnavailableObligationIds: idsFor(contracts, ["FIXTURE_UNAVAILABLE"]),
    unallocatedBudgetObligationIds: idsFor(contracts, ["UNALLOCATED_BUDGET"]),
    manualCouplingViolationCount: cases.filter((testCase) => {
      const own = new Set(testCase.acceptanceObligationIds ?? []);
      const allowed = new Set(obligationLedger.obligations
        .filter((item) => own.has(item.id)).map((item) => normalized(item.text)));
      return (testCase.manualChecks ?? []).some((item) => !allowed.has(normalized(item)));
    }).length,
    duplicateObligationCoverageCount: [...coverageCounts.values()]
      .filter((count) => count > 1).length,
    hallucinatedAuthorityCount: contracts.filter((item) =>
      item.acceptanceChecks.some((check) =>
        check.authority === "CANDIDATE_ONLY" && check.role === "ACCEPTANCE_PROOF"
      )
    ).length,
    contracts,
    evidenceContracts: evidencePlanning.evidenceContracts,
    executionContainers: evidencePlanning.executionContainers,
    sourceBackedAtomicSurfacePartitions,
    obligationEvidenceAccounting: evidencePlanning.accounting,
  };
  plan.browserSemanticPlanningAudit = audit;
  return plan;
}
