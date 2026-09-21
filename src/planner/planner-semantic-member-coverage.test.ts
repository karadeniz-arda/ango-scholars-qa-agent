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
  PlannerBrowserSemanticIr,
} from "./types.js";

function sourceUnit(id: string, text: string): PlannerAcceptanceSourceUnit {
  return { id, sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac", text };
}

function setup(sourceUnits: PlannerAcceptanceSourceUnit[]) {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "ACCEPTANCE_CRITERIA",
    sourceUnits,
  };
  const obligationLedger = buildPlannerAcceptanceObligationLedger(sourceLedger);
  const memberLedger = buildPlannerSourceDerivedObligationMemberLedger({
    sourceLedger, obligationLedger,
  });
  return { obligationLedger, memberLedger };
}

function caseFor(id: string): BrowserTestCase {
  return {
    id,
    persona: "company_admin",
    goal: "candidate shell",
    startRoute: "UNKNOWN",
    successCriteria: "candidate shell",
    automatedChecks: [], manualChecks: [], fixtureRequirements: [], steps: [],
  };
}

function semanticIr(args: {
  obligationLedger: ReturnType<typeof setup>["obligationLedger"];
  candidates: Array<{ obligationId: string; sourceUnitId: string; caseId: string; target?: string; claims?: string[] }>;
}): PlannerBrowserSemanticIr {
  return buildPlannerBrowserSemanticIr({
    rawCandidates: args.candidates.map((candidate) => ({
      proposedCaseId: candidate.caseId,
      obligationIds: [candidate.obligationId],
      sourceUnitIds: [candidate.sourceUnitId],
      proposedBehavior: "Untrusted model behavior prose is not coverage evidence.",
      ...(candidate.target ? { proposedTargetSurface: candidate.target } : {}),
      // Intentionally ignored: model IDs cannot create or select authority.
      ...(candidate.claims ? { sourceMemberIds: candidate.claims } : {}),
      proposedChecks: [], proposedFixtureNeeds: [], proposedRelationshipHints: [],
    })),
    browserCases: args.candidates.map((candidate) => caseFor(candidate.caseId)),
    obligationLedger: args.obligationLedger,
  });
}

test("Fresh-style AS-1312 records only structured target-surface member coverage", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("compliance", "This should work both for compliance requirements of type compliance document and master service agreement."),
    sourceUnit("background", "For 'background_check' type of requirements, view the status and the issue date of the BGV."),
    sourceUnit("authorization", "For 'work_authorization' view the readonly work authorization that is snapshotted to the contract."),
    sourceUnit("setup", "Trolley and Deel can open up their setup models freely."),
  ]);
  const bySource = new Map(obligationLedger.obligations.map((item) => [item.sourceUnitIds[0]!, item.id]));
  const ir = semanticIr({ obligationLedger, candidates: [
    { obligationId: bySource.get("compliance")!, sourceUnitId: "compliance", caseId: "one", target: "Talent contract details compliance requirements" },
    { obligationId: bySource.get("background")!, sourceUnitId: "background", caseId: "two", target: "Talent contract details background-check compliance requirement" },
    { obligationId: bySource.get("authorization")!, sourceUnitId: "authorization", caseId: "three", target: "Talent contract details work authorization compliance requirement" },
    { obligationId: bySource.get("setup")!, sourceUnitId: "setup", caseId: "four", target: "Talent contract details Trolley and Deel setup requirement models" },
  ] });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.deepEqual(audit.candidateCoverage.map((item) => item.disposition).sort(), [
    "EXACT_MEMBER_COVERAGE", "EXACT_MEMBER_COVERAGE", "MULTI_MEMBER_COVERAGE", "PARENT_ONLY",
  ]);
  assert.equal(audit.memberSetCensus.reduce((sum, item) => sum + item.requiredMemberCount, 0), 6);
  assert.equal(audit.memberSetCensus.reduce((sum, item) => sum + item.coveredMemberCount, 0), 4);
  assert.equal(audit.memberSetCensus.flatMap((item) => item.uncoveredMemberRefs).length, 2);
});

test("AS-1344-like structured surfaces bind one candidate per member", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);
  const obligation = obligationLedger.obligations[0]!;
  const ir = semanticIr({ obligationLedger, candidates: [
    { obligationId: obligation.id, sourceUnitId: "search", caseId: "payments", target: "Payments page" },
    { obligationId: obligation.id, sourceUnitId: "search", caseId: "all-payments", target: "All Payments page" },
  ] });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.deepEqual(audit.candidateCoverage.map((item) => item.disposition), [
    "EXACT_MEMBER_COVERAGE", "EXACT_MEMBER_COVERAGE",
  ]);
  assert.deepEqual(audit.memberSetCensus.map((item) => [
    item.requiredMemberCount, item.coveredMemberCount, item.uncoveredMemberRefs.length,
  ]), [[2, 2, 0]]);
});

test("AS-1014-like candidates bind independent surface and state members without a Cartesian identity", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("drawer", "In the payments and all payments table, display approved by info in the “sent for processing” and “processed” tabs."),
  ]);
  const obligation = obligationLedger.obligations[0]!;
  const ir = semanticIr({ obligationLedger, candidates: [
    { obligationId: obligation.id, sourceUnitId: "drawer", caseId: "a", target: "Company payments table, sent for processing tab" },
    { obligationId: obligation.id, sourceUnitId: "drawer", caseId: "b", target: "Company payments table, processed tab" },
    { obligationId: obligation.id, sourceUnitId: "drawer", caseId: "c", target: "Company all payments table, sent for processing tab" },
    { obligationId: obligation.id, sourceUnitId: "drawer", caseId: "d", target: "Company all payments table, processed tab" },
  ] });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.ok(audit.candidateCoverage.every((item) =>
    item.disposition === "MULTI_MEMBER_COVERAGE" && item.coveredMemberRefs.length === 2
  ));
  assert.equal(audit.memberSetCensus.length, 2);
  assert.ok(audit.memberSetCensus.every((item) => item.requiredMemberCount === 2));
  assert.ok(audit.memberSetCensus.every((item) => item.coveredMemberCount === 2));
  assert.ok(audit.memberSetCensus.every((item) => item.multiplyCoveredMemberRefs.length === 2));
});

test("wrong parent, source, and model member-ID claims cannot bind coverage", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);
  const candidate = semanticIr({ obligationLedger, candidates: [{
    obligationId: "wrong-obligation", sourceUnitId: "wrong-source", caseId: "forged",
    target: "Payments page", claims: ["source-member-forged", "source-member-forged"],
  }] });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: candidate, memberLedger });

  assert.equal(candidate.candidates.length, 0);
  assert.deepEqual(audit.candidateCoverage, []);
  assert.equal(audit.memberSetCensus[0]?.coveredMemberCount, 0);
});

test("member IDs in model output are ignored and unsupported structured targets remain parent-only", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);
  const obligation = obligationLedger.obligations[0]!;
  const ir = semanticIr({ obligationLedger, candidates: [{
    obligationId: obligation.id, sourceUnitId: "search", caseId: "one",
    target: "Invoice drawer", claims: ["source-member-nonexistent", "source-member-nonexistent"],
  }] });
  const audit = buildPlannerSemanticMemberCoverageAudit({ semanticIr: ir, memberLedger });

  assert.equal(audit.candidateCoverage[0]?.disposition, "PARENT_ONLY");
  assert.deepEqual(audit.candidateCoverage[0]?.coveredMemberRefs, []);
});

test("coverage identities are independent of model shell ordering", () => {
  const { obligationLedger, memberLedger } = setup([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);
  const obligation = obligationLedger.obligations[0]!;
  const candidates = [
    { obligationId: obligation.id, sourceUnitId: "search", caseId: "payments", target: "Payments page" },
    { obligationId: obligation.id, sourceUnitId: "search", caseId: "all-payments", target: "All Payments page" },
  ];
  const first = buildPlannerSemanticMemberCoverageAudit({
    semanticIr: semanticIr({ obligationLedger, candidates }), memberLedger,
  });
  const second = buildPlannerSemanticMemberCoverageAudit({
    semanticIr: semanticIr({ obligationLedger, candidates: [...candidates].reverse() }), memberLedger,
  });

  assert.deepEqual(first.memberSetCensus, second.memberSetCensus);
});
