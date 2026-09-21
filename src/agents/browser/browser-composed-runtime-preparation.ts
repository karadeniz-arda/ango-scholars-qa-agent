import { isDeepStrictEqual } from "node:util";
import { composedRuntimeLinkMatches } from "../../planner/planner-composed-runtime-resolution.js";
import type { BrowserTestCase, RuntimeNavigationBinding, RuntimeTalentContractFixtureBinding } from "../../planner/types.js";
import { bindDeepRoute, type DeepRouteEntityRequirement } from "./browser-deep-route-binding.js";
import { createRuntimeNavigationBinding } from "./browser-runtime-navigation-binding.js";
import {
  evaluateRuntimeTalentContractFixturePreparation,
  type RuntimeCandidatePredicateCensus,
  type RuntimeEquivalentCandidateSetResolution,
} from "./browser-runtime-talent-contract-fixture-preparation.js";
import { discoverAuthenticatedTalentContractCandidates } from "./browser-route-talent-contract.js";
import type { VerifiedContractFixtureCandidate } from "./fixtures/verified-contract-fixture-state.js";

export type BrowserComposedRuntimePreparation = {
  status: "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED" | "BLOCKED";
  linkId: string | null;
  caseId: string;
  candidateCount: number;
  runtimeReadyForInteraction: boolean;
  navigationBinding: RuntimeNavigationBinding | null;
  fixtureBinding: RuntimeTalentContractFixtureBinding | null;
  failureReason: string | null;
  candidatePredicateCensus?: RuntimeCandidatePredicateCensus;
  equivalentCandidateSetResolution?:
    RuntimeEquivalentCandidateSetResolution;
};

export function blockedComposedPreparation(
  testCase: BrowserTestCase,
  reason: string,
  candidateCount = 0,
  candidatePredicateCensus?: RuntimeCandidatePredicateCensus
): BrowserComposedRuntimePreparation {
  return { status: "BLOCKED", caseId: testCase.id,
    linkId: testCase.composedRuntimeResolution?.linkId ?? null,
    candidateCount, runtimeReadyForInteraction: false,
    navigationBinding: null, fixtureBinding: null, failureReason: reason,
    ...(candidatePredicateCensus ? { candidatePredicateCensus } : {}) };
}

function validInput(testCase: BrowserTestCase, persona: string | null | undefined): boolean {
  const link = testCase.composedRuntimeResolution;
  try {
  return Boolean(link && persona === "talent" && testCase.persona === persona &&
    testCase.runtimeFixtureResolutionContract?.interactionExecutionCaseId === link.executionCaseId &&
    composedRuntimeLinkMatches({ link, navigation: testCase.runtimeNavigationResolutionContract,
      fixture: testCase.runtimeFixtureResolutionContract }));
  } catch { return false; }
}

/** Select once by the complete fixture contract, then construct both bindings. */
export function evaluateComposedRuntimePreparation(args: {
  testCase: BrowserTestCase;
  actualPersona: string | null | undefined;
  ownerId: string;
  candidates: VerifiedContractFixtureCandidate[];
  preparedAt: string;
  evidenceRef: string;
}): BrowserComposedRuntimePreparation {
  const { testCase } = args;
  if (!validInput(testCase, args.actualPersona)) return blockedComposedPreparation(testCase, "INVALID_COMPOSITION_CONTRACT");
  const link = testCase.composedRuntimeResolution!;
  const nav = testCase.runtimeNavigationResolutionContract!;
  if (new Set(args.candidates.map(candidate => candidate.identity.entityId)).size !== args.candidates.length) {
    return blockedComposedPreparation(testCase, "AMBIGUOUS_IDENTITY_OBSERVATIONS", args.candidates.length);
  }
  const fixture = evaluateRuntimeTalentContractFixturePreparation({
    executionCaseId: link.executionCaseId, contract: testCase.runtimeFixtureResolutionContract,
    actualPersona: args.actualPersona, expectedOwnerId: args.ownerId,
    candidates: args.candidates, preparedAt: args.preparedAt, evidenceRef: args.evidenceRef,
  });
  if (!fixture.binding) return blockedComposedPreparation(
    testCase,
    fixture.failureReason ?? "FIXTURE_UNRESOLVED",
    args.candidates.length,
    fixture.candidatePredicateCensus
  );
  // This retrieves the already selected observation or canonical equivalent
  // representative. It is not a second selection and cannot fall back to a
  // different compatible record.
  const selected = args.candidates.find(candidate => candidate.identity.entityId === fixture.binding!.fixtureIdentityRef)!;
  const param = nav.parameters[0]!;
  const requiredState = Object.fromEntries(fixture.binding.verifiedPredicates.map(p => [p.key, p.expected]));
  const requirement: DeepRouteEntityRequirement = {
    param: param.param, entityKind: param.entityKind, persona: "talent", ownerId: args.ownerId,
    requiresOwnershipVerification: true, requiredState,
  };
  const resolution = bindDeepRoute({
    template: nav.template, sourceOrigin: nav.templateSourceOrigin,
    ...(nav.templateSourceRef ? { sourceRef: nav.templateSourceRef } : {}),
    authoritative: true, persona: "talent", requiredBindings: nav.parameters,
  }, { [param.param]: selected.identity.entityId });
  if (!resolution.boundRoute) return blockedComposedPreparation(testCase, "ROUTE_CONSTRUCTION_FAILED", args.candidates.length);
  resolution.boundRoute.provenance.identities = [{
    param: param.param, entityKind: selected.identity.entityKind,
    entityId: selected.identity.entityId, source: selected.identity.source,
    identityVerified: selected.identity.identityVerified,
    ownershipVerified: selected.identity.ownershipVerified === true,
    verifiedState: requiredState, verifiedStateKeys: Object.keys(requiredState),
  }];
  const navigationBinding = createRuntimeNavigationBinding({
    executionCaseId: link.executionCaseId, capability: nav, resolution,
    requirements: [requirement], resolvedAt: args.preparedAt, evidenceReference: args.evidenceRef,
  });
  if (!navigationBinding) return blockedComposedPreparation(testCase, "NAVIGATION_BINDING_FAILED", args.candidates.length);
  return {
    status: "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED", caseId: testCase.id, linkId: link.linkId,
    candidateCount: args.candidates.length, runtimeReadyForInteraction: true,
    navigationBinding, fixtureBinding: fixture.binding, failureReason: null,
    ...(fixture.candidatePredicateCensus
      ? { candidatePredicateCensus: fixture.candidatePredicateCensus }
      : {}),
    ...(fixture.equivalentCandidateSetResolution
      ? {
          equivalentCandidateSetResolution:
            fixture.equivalentCandidateSetResolution,
        }
      : {}),
  };
}

export function composedPreparationAllowsInteraction(
  testCase: BrowserTestCase, result: BrowserComposedRuntimePreparation | undefined,
  actualPersona: string | null | undefined
): boolean {
  if (!validInput(testCase, actualPersona) || !result ||
    result.status !== "COMPOSED_RUNTIME_RESOLUTION_CONFIRMED" || !result.runtimeReadyForInteraction ||
    result.caseId !== testCase.id || result.linkId !== testCase.composedRuntimeResolution?.linkId ||
    result.failureReason !== null) return false;
  const nav = result.navigationBinding;
  const fixture = result.fixtureBinding;
  const link = testCase.composedRuntimeResolution!;
  const capability = testCase.runtimeNavigationResolutionContract!;
  const constraint = testCase.runtimeFixtureResolutionContract!.members[0]!.acceptanceFixtureConstraint!;
  if (!fixture || constraint.semantic.kind !== "PREDICATES") return false;
  const expectedRoute = bindDeepRoute({
    template: capability.template, sourceOrigin: capability.templateSourceOrigin,
    authoritative: true, persona: capability.persona, requiredBindings: capability.parameters,
  }, { [capability.parameters[0]!.param]: fixture.fixtureIdentityRef }).boundRoute?.route;
  return Boolean(nav?.navigationReadyForExecution && fixture?.status === "RESOLVED" &&
    nav.status === "RESOLVED" && expectedRoute && nav.concreteRoute === expectedRoute &&
    nav.template === capability.template && nav.resolverRef === link.resolverRef &&
    fixture.resolverProvenance.resolverRef === link.resolverRef &&
    fixture.identityPolicy === link.identityPolicy && fixture.ownerIdentityRef &&
    (link.identityPolicy !== "exact" || fixture.fixtureIdentityRef === link.exactEntityId) &&
    isDeepStrictEqual(fixture.verifiedPredicates, constraint.semantic.predicates.map(p => ({ key: p.key, expected: p.expected }))) &&
    nav.executionCaseId === link.executionCaseId && fixture.executionCaseId === link.executionCaseId &&
    nav.persona === "talent" && fixture.ownerPersonaRef === "talent" &&
    fixture.fixtureContractId === link.fixtureContractId &&
    nav.selectedIdentityReferences.length === 1 &&
    nav.selectedIdentityReferences[0]?.identityRef === fixture.fixtureIdentityRef &&
    nav.ownershipVerification === "VERIFIED" && nav.stateVerification === "VERIFIED" &&
    fixture.ownershipVerification === "VERIFIED" && fixture.predicateVerification === "VERIFIED");
}

export async function prepareComposedRuntimeCase(args: {
  testCase: BrowserTestCase;
  actualPersona: string | null | undefined;
  discover?: () => Promise<{ talentId: string; verifiedCandidates: VerifiedContractFixtureCandidate[] } | undefined>;
}): Promise<BrowserComposedRuntimePreparation> {
  if (!validInput(args.testCase, args.actualPersona)) return blockedComposedPreparation(args.testCase, "INVALID_COMPOSITION_CONTRACT");
  try {
    const discovery = await (args.discover ?? discoverAuthenticatedTalentContractCandidates)();
    if (!discovery) return blockedComposedPreparation(args.testCase, "AUTHENTICATED_DISCOVERY_UNAVAILABLE");
    return evaluateComposedRuntimePreparation({
      testCase: args.testCase, actualPersona: args.actualPersona,
      ownerId: discovery.talentId, candidates: discovery.verifiedCandidates,
      preparedAt: new Date().toISOString(), evidenceRef: `composed-prepare:${args.testCase.composedRuntimeResolution!.linkId}`,
    });
  } catch {
    // Do not serialize provider errors, credentials, URLs, or response bodies.
    return blockedComposedPreparation(args.testCase, "AUTHENTICATED_DISCOVERY_FAILED");
  }
}
