import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { selectRuntimeNavigationCapability } from "../discovery/runtime-navigation-capability-registry.js";
import type {
  PlannerComposedRuntimeResolutionLink,
  PlannerRuntimeFixtureResolutionContract,
  PlannerRuntimeNavigationResolutionContract,
  PlannerTalentContractFixturePredicateKey,
} from "./types.js";

const supportedKeys: ReadonlySet<PlannerTalentContractFixturePredicateKey> = new Set([
  "contract.accessibleToOwner", "contract.hasWorkSetups",
  "contract.documentMetadataPresent", "contract.workAuthorizationSnapshotPresent",
  "compliance.COMPLIANCE_DOCUMENT.present", "compliance.COMPLIANCE_DOCUMENT.signed",
  "compliance.COMPLIANCE_DOCUMENT.signedAtPresent", "compliance.COMPLIANCE_DOCUMENT.agreementVersionPresent",
  "compliance.COMPLIANCE_DOCUMENT.signatureValuePresent",
  "compliance.MASTER_SERVICE_AGREEMENT.present", "compliance.MASTER_SERVICE_AGREEMENT.signed",
  "compliance.MASTER_SERVICE_AGREEMENT.signedAtPresent", "compliance.MASTER_SERVICE_AGREEMENT.agreementVersionPresent",
  "compliance.MASTER_SERVICE_AGREEMENT.signatureValuePresent",
  "compliance.BACKGROUND_CHECK.present", "compliance.BACKGROUND_CHECK.statusPresent",
  "compliance.BACKGROUND_CHECK.issueDatePresent", "compliance.WORK_AUTHORIZATION.present",
  "compliance.TROLLEY_ONBOARDING_SETUP.present", "compliance.TROLLEY_ONBOARDING_SETUP.statusPresent",
  "compliance.DEEL_ONBOARDING_SETUP.present", "compliance.DEEL_ONBOARDING_SETUP.statusPresent",
  "compliance.setup.anyCompleted",
]);

/** Closed capability linkage, not selection, readiness, or proof. */
export function linkComposedRuntimeCapabilities(args: {
  executionContainerId: string;
  executionCaseId: string;
  navigation?: PlannerRuntimeNavigationResolutionContract | undefined;
  fixture?: PlannerRuntimeFixtureResolutionContract | undefined;
}): PlannerComposedRuntimeResolutionLink | undefined {
  const nav = args.navigation;
  const fixture = args.fixture;
  if (!nav || !fixture || !args.executionContainerId || !args.executionCaseId ||
    nav.persona !== "talent" || fixture.members.length !== 1 ||
    fixture.status !== "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" ||
    !fixture.fixtureContractId || fixture.fixtureReadyForInteraction !== false ||
    fixture.policy !== "ALL_REQUIRED" ||
    fixture.acceptanceCoverage?.kind !== "TALENT_CONTRACT_PREDICATES") return undefined;

  // Revalidate the closed registry entry, including unresolved identity flags.
  const registered = selectRuntimeNavigationCapability({
    templates: [{ template: nav.template, sourceOrigin: nav.templateSourceOrigin,
      ...(nav.templateSourceRef ? { sourceRef: nav.templateSourceRef } : {}),
      authoritative: true, persona: nav.persona, requiredBindings: nav.parameters }],
    candidatePersona: "talent",
  });
  if (registered.status !== "AVAILABLE" || !isDeepStrictEqual(nav, registered.capability)) {
    return undefined;
  }
  const member = fixture.members[0]!;
  const constraint = member.acceptanceFixtureConstraint;
  const capability = member.fixtureResolutionCapability;
  if (member.executionCaseId !== args.executionCaseId || !member.required ||
    member.runtimeFixtureBinding !== "NOT_YET_RESOLVED" ||
    constraint?.fixtureKind !== "talent-contract" ||
    capability?.fixtureKind !== "talent-contract" ||
    constraint.executionCaseId !== args.executionCaseId ||
    capability.executionCaseId !== args.executionCaseId ||
    constraint.authority !== "SOURCE_AUTHORIZED" ||
    constraint.semantic.kind !== "PREDICATES" ||
    !constraint.constraintId || !capability.capabilityId ||
    capability.resolverRef !== nav.resolverRef || capability.persona !== nav.persona ||
    capability.classification !== "AUTHENTICATED_READ_ONLY_DISCOVERY" ||
    capability.selectionPolicy !== "UNIQUE_COMPATIBLE_ONLY" ||
    capability.ambiguityPolicy !== "BLOCK_TEST_DATA_ISSUE" ||
    capability.identityVerification !== "REQUIRED" || capability.ownershipVerification !== "REQUIRED" ||
    capability.provenance.module !== "src/agents/browser/fixtures/verified-contract-fixture-state.ts" ||
    capability.provenance.exportName !== "selectVerifiedContractFixtureCandidate" ||
    constraint.identityPolicy !== capability.identityPolicy ||
    !["exact", "compatible-state"].includes(constraint.identityPolicy) ||
    (constraint.identityPolicy === "exact" ? !constraint.exactEntityId : constraint.exactEntityId !== undefined)
  ) return undefined;
  const predicates = constraint.semantic.predicates;
  const keys = predicates.map(p => p.key).sort();
  if (!keys.length || new Set(keys).size !== keys.length ||
    !isDeepStrictEqual(keys, [...capability.supportedPredicates].sort()) ||
    !isDeepStrictEqual(keys, [...fixture.acceptanceCoverage.requiredPredicateKeys].sort()) ||
    !isDeepStrictEqual(keys, [...fixture.acceptanceCoverage.plannedPredicateKeys].sort()) ||
    !constraint.obligationIds.length || !constraint.sourceUnitRefs.length ||
    predicates.some(p => !supportedKeys.has(p.key) || typeof p.expected !== "boolean" ||
      p.authority !== "SOURCE_AUTHORIZED" || !p.obligationIds.length || !p.sourceUnitRefs.length ||
      p.obligationIds.some(id => !constraint.obligationIds.includes(id)) ||
      p.sourceUnitRefs.some(ref => !ref.sourceUnitId || !ref.sourceRef || ref.sourceRef === "UNAVAILABLE" ||
        !constraint.sourceUnitRefs.some(r => isDeepStrictEqual(r, ref))))) return undefined;

  const body = {
    schemaVersion: 1 as const,
    executionContainerId: args.executionContainerId, executionCaseId: args.executionCaseId,
    navigationCapabilityId: nav.capabilityId, fixtureCapabilityId: capability.capabilityId,
    fixtureContractId: fixture.fixtureContractId, fixtureConstraintId: constraint.constraintId,
    entityKind: "contract" as const, resolverRef: nav.resolverRef, persona: "talent" as const,
    identityPolicy: constraint.identityPolicy,
    ...(constraint.exactEntityId ? { exactEntityId: constraint.exactEntityId } : {}),
    sourceUnitRefs: [...constraint.sourceUnitRefs].sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId)),
    runtimeIdentity: "NOT_YET_RESOLVED" as const, runtimeReadyForInteraction: false as const,
  };
  return { ...body, linkId: "runtime-entity-link-" + createHash("sha256")
    .update(JSON.stringify(body)).digest("hex").slice(0, 12) };
}

export function composedRuntimeLinkMatches(args: {
  link: PlannerComposedRuntimeResolutionLink;
  navigation?: PlannerRuntimeNavigationResolutionContract | undefined;
  fixture?: PlannerRuntimeFixtureResolutionContract | undefined;
}): boolean {
  return isDeepStrictEqual(args.link, linkComposedRuntimeCapabilities({
    executionContainerId: args.link.executionContainerId,
    executionCaseId: args.link.executionCaseId,
    navigation: args.navigation, fixture: args.fixture,
  }));
}
