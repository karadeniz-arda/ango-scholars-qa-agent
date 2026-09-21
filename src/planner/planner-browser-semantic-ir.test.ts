import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerBrowserSemanticIr,
  verdictGroupCandidatesFromSemanticIr,
} from "./planner-browser-semantic-ir.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
} from "./types.js";

const sourceLedger: PlannerAcceptanceSourceLedger = {
  sourceStatus: "RESOLVED",
  basis: "ACCEPTANCE_CRITERIA",
  sourceUnits: [
    { id: "source-a", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac", text: "Company users can search records." },
    { id: "source-b", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira.ac", text: "The selected filter remains visible." },
  ],
};
const obligationLedger: PlannerAcceptanceObligationLedger = {
  sourceStatus: "RESOLVED",
  derivationStatus: "RESOLVED",
  obligations: [
    { id: "obligation-a", sourceUnitIds: ["source-a"], sourceRole: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", text: "Company users can search records." },
    { id: "obligation-b", sourceUnitIds: ["source-b"], sourceRole: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", text: "The selected filter remains visible." },
  ],
  unresolvedSourceUnitIds: [],
};
const cases: BrowserTestCase[] = [{
  id: "candidate-a",
  persona: "company_admin",
  goal: "candidate",
  startRoute: "/company/records",
  successCriteria: "candidate",
  automatedChecks: [],
  manualChecks: [],
  fixtureRequirements: [],
  steps: [],
}];

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "model-id",
    proposedCaseId: "candidate-a",
    obligationIds: ["obligation-a"],
    sourceUnitIds: ["source-a"],
    proposedBehavior: "Search records",
    proposedPersona: "company_admin",
    proposedTargetSurface: "records",
    proposedMutationClass: "READ_ONLY",
    proposedChecks: [{
      text: "Company users can search records.",
      obligationIds: ["obligation-a"],
      proposedRole: "ACCEPTANCE_PROOF",
    }],
    proposedFixtureNeeds: [],
    proposedRelationshipHints: [],
    ...overrides,
  };
}

test("valid semantic candidates retain exact source anchors and remain candidate-only", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate()], browserCases: cases, obligationLedger,
  });
  assert.equal(ir.status, "ACTIVE");
  assert.equal(ir.candidates[0]?.authority, "CANDIDATE");
  assert.deepEqual(ir.candidates[0]?.obligationIds, ["obligation-a"]);
  assert.deepEqual(ir.candidates[0]?.sourceUnitIds, ["source-a"]);
});

test("unknown obligation anchors are rejected", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({ obligationIds: ["forged"] })],
    browserCases: cases,
    obligationLedger,
  });
  assert.equal(ir.status, "NO_GROUNDED_CANDIDATES");
  assert.equal(ir.rejectedCandidates[0]?.reason, "UNKNOWN_OBLIGATION");
});

test("mismatched source-unit anchors are rejected", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({ sourceUnitIds: ["source-b"] })],
    browserCases: cases,
    obligationLedger,
  });
  assert.equal(ir.rejectedCandidates[0]?.reason, "SOURCE_ANCHOR_MISMATCH");
});

test("missing interaction shell is rejected", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({ proposedCaseId: "missing" })],
    browserCases: cases,
    obligationLedger,
  });
  assert.equal(ir.rejectedCandidates[0]?.reason, "MISSING_CASE_CANDIDATE");
});

test("duplicate obligation coverage produces one candidate", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate(), candidate({ id: "duplicate" })],
    browserCases: cases,
    obligationLedger,
  });
  assert.equal(ir.candidates.length, 1);
  assert.equal(ir.rejectedCandidates[0]?.reason, "DUPLICATE_CANDIDATE");
});

test("model relationship hints remain candidate proposals after serialization", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      obligationIds: ["obligation-a", "obligation-b"],
      sourceUnitIds: ["source-a", "source-b"],
      proposedRelationshipHints: [{
        relationship: "INDEPENDENT",
        obligationIds: ["obligation-a", "obligation-b"],
        dependsOnObligationIds: [],
        reason: "The model thinks they are separate.",
      }],
    })],
    browserCases: cases,
    obligationLedger,
  });
  const reloaded = JSON.parse(JSON.stringify(ir));
  const proposals = verdictGroupCandidatesFromSemanticIr({
    semanticIr: reloaded,
    sourceLedger,
    obligationLedger,
  });
  assert.equal(proposals.length, 1);
  assert.equal(ir.candidates[0]?.authority, "CANDIDATE");
  assert.equal(proposals[0]?.relationship, "INDEPENDENT");
});

test("exact string relationship labels normalize as candidate-only hints", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      proposedRelationshipHints: ["INDEPENDENT"],
    })],
    browserCases: cases,
    obligationLedger,
  });

  assert.deepEqual(
    ir.candidates[0]?.proposedRelationshipHints,
    [{
      relationship: "INDEPENDENT",
      obligationIds: ["obligation-a"],
      dependsOnObligationIds: [],
      reason:
        "Exact model-supplied relationship label retained as a candidate-only hint.",
    }]
  );
  assert.equal(ir.candidates[0]?.authority, "CANDIDATE");
});

test("ambiguous or incomplete string relationship hints fail closed", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      proposedRelationshipHints: [
        "These look independent.",
        "MANUAL_REVIEW",
        "DEPENDS_ON",
      ],
    })],
    browserCases: cases,
    obligationLedger,
  });

  assert.deepEqual(
    ir.candidates[0]?.proposedRelationshipHints,
    []
  );
});

test("invalid check roles are dropped and never become acceptance proof", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      proposedChecks: [
        {
          text: "Company users can search records.",
          obligationIds: ["obligation-a"],
          proposedRole: "MANUAL_REVIEW",
        },
        {
          text: "Company users can search records.",
          obligationIds: ["obligation-a"],
          proposedRole: "MANUAL_VERIFICATION",
        },
      ],
    })],
    browserCases: cases,
    obligationLedger,
  });

  assert.deepEqual(ir.candidates[0]?.proposedChecks, []);
});

test("fixture strings normalize to minimal candidate-scoped records only", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      proposedFixtureNeeds: [
        "An existing searchable record.",
      ],
    })],
    browserCases: cases,
    obligationLedger,
  });

  assert.deepEqual(
    ir.candidates[0]?.proposedFixtureNeeds,
    [{
      text: "An existing searchable record.",
      obligationIds: ["obligation-a"],
    }]
  );
  assert.equal(ir.candidates[0]?.authority, "CANDIDATE");
});

test("nested normalization is idempotent and survives serialization", () => {
  const once = buildPlannerBrowserSemanticIr({
    rawCandidates: [candidate({
      proposedFixtureNeeds: ["An existing searchable record."],
      proposedRelationshipHints: ["ATOMIC"],
    })],
    browserCases: cases,
    obligationLedger,
  });
  const twice = buildPlannerBrowserSemanticIr({
    rawCandidates: JSON.parse(JSON.stringify(once.candidates)),
    browserCases: cases,
    obligationLedger,
  });

  assert.deepEqual(twice.candidates, once.candidates);
});

test("missing semantic section is explicit legacy compatibility", () => {
  const ir = buildPlannerBrowserSemanticIr({
    rawCandidates: undefined, browserCases: cases, obligationLedger,
  });
  assert.equal(ir.status, "LEGACY_INPUT");
  assert.deepEqual(ir.candidates, []);
});
