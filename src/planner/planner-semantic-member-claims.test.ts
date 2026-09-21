import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import {
  buildPlannerBrowserSemanticIr,
} from "./planner-browser-semantic-ir.js";
import {
  buildPlannerSemanticMemberCoverageAudit,
} from "./planner-semantic-member-coverage.js";
import {
  buildPlannerSourceDerivedObligationMemberLedger,
} from "./planner-source-derived-obligation-members.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
} from "./types.js";

function sourceUnit(id: string, text: string): PlannerAcceptanceSourceUnit {
  return { id, sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac", text };
}

function setup() {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "ACCEPTANCE_CRITERIA",
    sourceUnits: [
      sourceUnit("compliance", "This should work both for compliance requirements of type compliance document and master service agreement."),
      sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
    ],
  };
  const obligationLedger = buildPlannerAcceptanceObligationLedger(sourceLedger);
  const memberLedger = buildPlannerSourceDerivedObligationMemberLedger({ sourceLedger, obligationLedger });
  const obligations = new Map(obligationLedger.obligations.map((item) => [item.sourceUnitIds[0]!, item]));
  const members = new Map(memberLedger.memberSets.flatMap((set) =>
    set.members.map((member) => [member.canonicalMemberText, member] as const)
  ));
  return { obligationLedger, memberLedger, obligations, members };
}

function shell(id: string): BrowserTestCase {
  return {
    id, persona: "company_admin", goal: "shell", startRoute: "UNKNOWN",
    successCriteria: "shell", automatedChecks: [], manualChecks: [],
    fixtureRequirements: [], steps: [],
  };
}

function candidate(args: {
  obligationId: string;
  sourceUnitId: string;
  claims?: unknown;
  target?: string;
}) {
  return {
    proposedCaseId: "shell",
    obligationIds: [args.obligationId],
    sourceUnitIds: [args.sourceUnitId],
    proposedBehavior: "Model prose must not create member authority.",
    ...(args.target ? { proposedTargetSurface: args.target } : {}),
    ...(args.claims === undefined ? {} : { sourceMemberCoverageClaims: args.claims }),
    proposedChecks: [], proposedFixtureNeeds: [], proposedRelationshipHints: [],
  };
}

test("valid exact parent/source claims are retained as non-authoritative validated claims", () => {
  const { obligationLedger, memberLedger, obligations, members } = setup();
  const compliance = obligations.get("compliance")!;
  const claimIds = [members.get("compliance document")!.memberId, members.get("master service agreement")!.memberId];
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      obligationId: compliance.id, sourceUnitId: "compliance", claims: claimIds,
      target: "Talent contract details compliance requirements",
    })],
    browserCases: [shell("shell")], obligationLedger, memberLedger,
  });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });
  const complianceCensus = audit.memberSetCensus.find((item) =>
    item.parentObligationId === compliance.id
  );

  assert.deepEqual(
    ir.candidates[0]?.validatedSourceMemberCoverageClaims,
    claimIds.sort().map((memberId) => ({ memberId, provenance: "VALIDATED_MODEL_MEMBER_CLAIM" }))
  );
  assert.equal(complianceCensus?.deterministicallyCoveredMemberCount, 0);
  assert.equal(complianceCensus?.validlyClaimedMemberCount, 2);
  assert.equal(complianceCensus?.claimedButNotDeterministicallyCoveredMemberRefs.length, 2);
});

test("invented, wrong-parent, wrong-source, free-form, and duplicate claim values fail closed", () => {
  const { obligationLedger, memberLedger, obligations, members } = setup();
  const compliance = obligations.get("compliance")!;
  const searchMember = members.get("payments")!.memberId;
  const complianceMember = members.get("compliance document")!.memberId;
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      obligationId: compliance.id,
      sourceUnitId: "compliance",
      claims: ["invented-member", searchMember, "compliance document", complianceMember, complianceMember],
    })],
    browserCases: [shell("shell")], obligationLedger, memberLedger,
  });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.deepEqual(ir.candidates[0]?.validatedSourceMemberCoverageClaims, [{
    memberId: complianceMember,
    provenance: "VALIDATED_MODEL_MEMBER_CLAIM",
  }]);
  assert.deepEqual(ir.candidates[0]?.invalidSourceMemberCoverageClaimIds, [
    "compliance document", "invented-member", searchMember,
  ].sort());
  assert.equal(audit.invalidClaimRefs.length, 3);
});

test("claims are optional and exact target coverage remains independent", () => {
  const { obligationLedger, memberLedger, obligations, members } = setup();
  const search = obligations.get("search")!;
  const payments = members.get("payments")!.memberId;
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      obligationId: search.id, sourceUnitId: "search", target: "Payments page",
    })],
    browserCases: [shell("shell")], obligationLedger, memberLedger,
  });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.equal(ir.candidates[0]?.validatedSourceMemberCoverageClaims, undefined);
  assert.equal(audit.candidateCoverage[0]?.coveredMemberRefs[0]?.memberId, payments);
  assert.deepEqual(audit.candidateCoverage[0]?.validlyClaimedMemberRefs, []);
});

test("claim ordering cannot alter authoritative member identity or candidate count", () => {
  const { obligationLedger, memberLedger, obligations, members } = setup();
  const compliance = obligations.get("compliance")!;
  const claims = [members.get("compliance document")!.memberId, members.get("master service agreement")!.memberId];
  const build = (ordered: string[]) => buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({ obligationId: compliance.id, sourceUnitId: "compliance", claims: ordered })],
    browserCases: [shell("shell")], obligationLedger, memberLedger,
  });

  const first = build(claims);
  const second = build([...claims].reverse());
  assert.equal(first.candidates.length, 1);
  assert.equal(second.candidates.length, 1);
  assert.deepEqual(first.candidates[0]?.validatedSourceMemberCoverageClaims, second.candidates[0]?.validatedSourceMemberCoverageClaims);
});
