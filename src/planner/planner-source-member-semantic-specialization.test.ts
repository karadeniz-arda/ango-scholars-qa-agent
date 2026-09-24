import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import {
  specializePlannerSourceMemberSemanticCandidates,
} from "./planner-browser-semantic-allocation.js";
import {
  buildPlannerBrowserSemanticIr,
} from "./planner-browser-semantic-ir.js";
import {
  buildPlannerSourceDerivedObligationMemberLedger,
} from "./planner-source-derived-obligation-members.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
  TestPlan,
} from "./types.js";

function sourceUnit(id: string, text: string): PlannerAcceptanceSourceUnit {
  return { id, sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac", text };
}

function shell(id: string): BrowserTestCase {
  return {
    id, persona: "company_admin", goal: "shell", startRoute: "UNKNOWN",
    successCriteria: "shell", automatedChecks: [], manualChecks: [],
    fixtureRequirements: [], steps: [],
  };
}

function setup(sourceUnits: PlannerAcceptanceSourceUnit[]) {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED", basis: "ACCEPTANCE_CRITERIA", sourceUnits,
  };
  const obligationLedger = buildPlannerAcceptanceObligationLedger(sourceLedger);
  const memberLedger = buildPlannerSourceDerivedObligationMemberLedger({ sourceLedger, obligationLedger });
  const obligations = new Map(obligationLedger.obligations.map((item) => [item.sourceUnitIds[0]!, item]));
  const members = new Map(memberLedger.memberSets.flatMap((set) =>
    set.members.map((member) => [member.canonicalMemberText, member] as const)
  ));
  return { sourceLedger, obligationLedger, memberLedger, obligations, members };
}

function run(args: {
  setup: ReturnType<typeof setup>;
  candidates: Array<{ caseId: string; sourceId: string; target?: string; claims?: string[]; mutation?: string }>;
}) {
  const cases = args.candidates.map((candidate) => shell(candidate.caseId));
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: args.candidates.map((candidate) => ({
      proposedCaseId: candidate.caseId,
      obligationIds: [args.setup.obligations.get(candidate.sourceId)!.id],
      sourceUnitIds: [candidate.sourceId],
      proposedBehavior: "Candidate-only semantic shell.",
      ...(candidate.target ? { proposedTargetSurface: candidate.target } : {}),
      proposedMutationClass: candidate.mutation ?? "READ_ONLY",
      ...(candidate.claims ? { sourceMemberCoverageClaims: candidate.claims } : {}),
      proposedChecks: [], proposedFixtureNeeds: [], proposedRelationshipHints: [],
    })),
    browserCases: cases,
    obligationLedger: args.setup.obligationLedger,
    memberLedger: args.setup.memberLedger,
  });
  const plan: TestPlan = {
    issueKey: "TEST", summary: "Test", apiCases: [], browserCases: cases,
    acceptanceSourceLedger: args.setup.sourceLedger,
    acceptanceObligationLedger: args.setup.obligationLedger,
    sourceDerivedObligationMemberLedger: args.setup.memberLedger,
  };
  specializePlannerSourceMemberSemanticCandidates({
    plan, semanticIr: ir, obligationLedger: args.setup.obligationLedger,
  });
  return { plan, ir };
}

test("AS-1312-like target member claims specialize four shells into six candidates", () => {
  const ctx = setup([
    sourceUnit("compliance", "This should work both for compliance requirements of type compliance document and master service agreement."),
    sourceUnit("background", "For 'background_check' type of requirements, view the status and the issue date."),
    sourceUnit("authorization", "For 'work_authorization' view the readonly work authorization."),
    sourceUnit("setup", "Trolley and Deel can open up their setup models freely."),
  ]);
  const result = run({ setup: ctx, candidates: [
    { caseId: "compliance", sourceId: "compliance", claims: [ctx.members.get("compliance document")!.memberId, ctx.members.get("master service agreement")!.memberId] },
    { caseId: "background", sourceId: "background", claims: [ctx.members.get("background check")!.memberId] },
    { caseId: "authorization", sourceId: "authorization", claims: [ctx.members.get("work authorization")!.memberId] },
    { caseId: "setup", sourceId: "setup", claims: [ctx.members.get("trolley")!.memberId, ctx.members.get("deel")!.memberId] },
  ] });

  assert.equal(result.ir.candidates.length, 6);
  assert.equal(result.plan.browserCases.length, 4);
  const specializations = result.ir.candidates.flatMap((candidate) =>
    candidate.sourceMemberSemanticSpecialization ? [candidate.sourceMemberSemanticSpecialization] : []
  );
  assert.equal(specializations.length, 4);
  assert.deepEqual(specializations.map((item) => item.canonicalMemberText).sort(), [
    "compliance document", "deel", "master service agreement", "trolley",
  ]);
  assert.ok(specializations.every((item) => item.authority === "SOURCE_AUTHORIZED"));
});

test("source-defined surface members specialize without model member claims", () => {
  const surface = setup([sourceUnit("surface", "Add a search bar to the Payments & All Payments page.")]);
  const surfaceResult = run({ setup: surface, candidates: [{
    caseId: "surface", sourceId: "surface",
  }] });
  assert.deepEqual(surfaceResult.ir.candidates.map((candidate) =>
    candidate.sourceMemberSemanticSpecialization?.canonicalMemberText
  ).sort(), ["all payments", "payments"]);

  const target = setup([sourceUnit("target", "This should work both for compliance requirements of type compliance document and master service agreement.")]);
  const partial = run({ setup: target, candidates: [{
    caseId: "target", sourceId: "target", claims: [target.members.get("compliance document")!.memberId],
  }] });
  assert.equal(partial.ir.candidates.length, 2);
});

test("exact source members and the bounded page suffix retain their own shells", () => {
  const ctx = setup([
    sourceUnit("surface", "Add a search bar to the Payments & All Payments page."),
  ]);
  const exact = run({ setup: ctx, candidates: [
    { caseId: "payments", sourceId: "surface", target: "Payments" },
    { caseId: "all-payments", sourceId: "surface", target: "All Payments" },
  ] });
  assert.equal(exact.ir.candidates.length, 2);
  assert.ok(exact.ir.candidates.every((candidate) =>
    candidate.sourceMemberSemanticSpecialization === undefined
  ));

  const page = run({ setup: ctx, candidates: [
    { caseId: "payments", sourceId: "surface", target: "Payments page" },
    { caseId: "all-payments", sourceId: "surface", target: "All Payments page" },
  ] });
  assert.equal(page.ir.candidates.length, 2);
  assert.deepEqual(page.ir.candidates.map((candidate) =>
    candidate.proposedTargetSurface
  ).sort(), ["All Payments page", "Payments page"]);
  assert.ok(page.ir.candidates.every((candidate) =>
    candidate.sourceMemberSemanticSpecialization === undefined
  ));
});

test("MODEL_MEMBER_CLAIM_ABSENCE_CANNOT_ERASE_UNAMBIGUOUS_SOURCE_MEMBER_V1", () => {
  const ctx = setup([sourceUnit(
    "target",
    "This should work both for compliance requirements of type compliance document and master service agreement."
  )]);
  const result = run({ setup: ctx, candidates: [{
    caseId: "target", sourceId: "target",
  }] });

  assert.deepEqual(result.ir.candidates.map((candidate) =>
    candidate.sourceMemberSemanticSpecialization?.canonicalMemberText
  ).sort(), ["compliance document", "master service agreement"]);
  assert.ok(result.ir.candidates.every((candidate) =>
    candidate.validatedSourceMemberCoverageClaims === undefined
  ));
});

test("MODEL_MEMBER_CLAIM_MISMATCH_CANNOT_OVERRIDE_UNAMBIGUOUS_SOURCE_MEMBER_V1", () => {
  const ctx = setup([
    sourceUnit(
      "target-a",
      "This should work both for compliance requirements of type compliance document and master service agreement."
    ),
    sourceUnit(
      "target-b",
      "Trolley and Deel can open up their setup models freely."
    ),
  ]);
  const unrelatedClaim = ctx.members.get("trolley")!.memberId;
  const result = run({ setup: ctx, candidates: [{
    caseId: "target-a", sourceId: "target-a", claims: [unrelatedClaim],
  }] });

  assert.deepEqual(result.ir.candidates.map((candidate) =>
    candidate.sourceMemberSemanticSpecialization?.canonicalMemberText
  ).sort(), ["compliance document", "master service agreement"]);
  assert.deepEqual(result.ir.candidates.flatMap((candidate) =>
    candidate.invalidSourceMemberCoverageClaimIds ?? []
  ), [unrelatedClaim, unrelatedClaim]);
});

test("unsafe shells and invalid claims retain the parent unchanged without inventing steps", () => {
  const ctx = setup([sourceUnit("target", "This should work both for compliance requirements of type compliance document and master service agreement.")]);
  const unsafe = run({ setup: ctx, candidates: [{
    caseId: "target", sourceId: "target", mutation: "PERSISTENT_BROWSER",
    claims: [ctx.members.get("compliance document")!.memberId, ctx.members.get("master service agreement")!.memberId],
  }] });
  assert.equal(unsafe.ir.candidates.length, 1);
  assert.deepEqual(unsafe.plan.browserCases[0]?.steps, []);
});

test("an existing exact member shell is reused instead of duplicated", () => {
  const ctx = setup([sourceUnit("target", "This should work both for compliance requirements of type compliance document and master service agreement.")]);
  const compliance = ctx.members.get("compliance document")!.memberId;
  const master = ctx.members.get("master service agreement")!.memberId;
  const result = run({ setup: ctx, candidates: [
    { caseId: "parent", sourceId: "target", claims: [compliance, master] },
    { caseId: "direct", sourceId: "target", claims: [compliance], target: "compliance document" },
  ] });
  assert.equal(result.ir.candidates.length, 2);
  assert.equal(result.ir.candidates.filter((item) =>
    item.proposedTargetSurface === "compliance document"
  ).length, 1);
  assert.equal(result.ir.candidates.filter((item) =>
    item.sourceMemberSemanticSpecialization?.memberId === master
  ).length, 1);
});

test("candidate ordering preserves specialized identities", () => {
  const ctx = setup([sourceUnit("target", "This should work both for compliance requirements of type compliance document and master service agreement.")]);
  const claims = [ctx.members.get("compliance document")!.memberId, ctx.members.get("master service agreement")!.memberId];
  const first = run({ setup: ctx, candidates: [{ caseId: "first", sourceId: "target", claims }] });
  const second = run({ setup: ctx, candidates: [{ caseId: "first", sourceId: "target", claims: [...claims].reverse() }] });
  assert.deepEqual(
    first.ir.candidates.map((item) => item.candidateId).sort(),
    second.ir.candidates.map((item) => item.candidateId).sort()
  );
});
