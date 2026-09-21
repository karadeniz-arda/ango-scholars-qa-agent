import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserTestCase, PlannerAcceptanceObligationLedger, PlannerAcceptanceSourceLedger } from "../../planner/types.js";
import { deriveBrowserExecutionCheckContract } from "../../planner/browser-execution-check-contract.js";
import type { BrowserObservation } from "./browser-observation.js";
import {
  buildBrowserSourceBoundStructuralControlPresenceRequirements,
  evaluateBrowserSourceBoundStructuralControlPresence,
} from "./browser-source-bound-structural-control-presence-proof.js";

const sourceLedger: PlannerAcceptanceSourceLedger = {
  sourceStatus: "RESOLVED", basis: "ACCEPTANCE_CRITERIA",
  sourceUnits: [{ id: "ac-search", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira:AS-X#acceptance", text: "A search bar is available." }],
};
const ledger: PlannerAcceptanceObligationLedger = {
  sourceStatus: "RESOLVED", derivationStatus: "RESOLVED", unresolvedSourceUnitIds: [],
  obligations: [{ id: "ob-search", sourceUnitIds: ["ac-search"], sourceRole: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", text: "A search bar is available." }],
};
const testCase: BrowserTestCase = {
  id: "case-search", persona: "company_admin", goal: "Planner prose cannot authorize a proof.",
  startRoute: "/company/payments", successCriteria: "Search is available.", acceptanceObligationIds: ["ob-search"],
  executionVerdictScope: { executionObligationIds: ["ob-search"], verdictScopeObligationIds: ["ob-search"], verdictAuthority: "INDEPENDENT" }, steps: [],
};
const observation: BrowserObservation = {
  url: "https://example.test/company/payments", title: "Payments", headings: [], controls: [], surfaces: [], visibleText: [], collections: [], collectionAbstentions: [],
  inputs: [{ label: "", role: "textbox", type: "search", disabled: false, activationSafe: true, expanded: null, required: false, hasValue: false }],
  counts: { headings: 0, controls: 0, inputs: 1, surfaces: 0, visibleText: 0 },
};

test("source-authorized structural search presence builds an exact requirement, evidence, and contract", () => {
  const requirements = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" });
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.control.semanticKind, "SEARCH_INPUT");
  const evidence = evaluateBrowserSourceBoundStructuralControlPresence({ requirement: requirements[0]!, observation, actualPersona: "company_admin", actualRoutePath: "/company/payments", freshObservation: true });
  assert.equal(evidence.result, "CONFIRMED");
  assert.equal(evidence.proofRequirementId, requirements[0]!.requirementId);
  const contract = deriveBrowserExecutionCheckContract({ testCase, structuralControlPresenceRequirements: requirements });
  assert.ok(contract);
  assert.equal(contract!.requiredChecks.length, 1);
  assert.equal(contract!.requiredChecks[0]!.kind, "SOURCE_BOUND_STRUCTURAL_CONTROL_PRESENCE");
});

test("planner prose, missing source authority, route mismatch, and ungrounded inputs cannot confirm", () => {
  assert.deepEqual(buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "The interface works correctly." }] }, acceptedRoutePath: "/company/payments" }), []);
  assert.deepEqual(buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: [], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" }), []);
  const requirement = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" })[0]!;
  assert.equal(evaluateBrowserSourceBoundStructuralControlPresence({ requirement, observation: { ...observation, inputs: [] }, actualPersona: "company_admin", actualRoutePath: "/company/payments", freshObservation: true }).result, "NOT_CONFIRMED");
  assert.equal(evaluateBrowserSourceBoundStructuralControlPresence({ requirement, observation, actualPersona: "company_admin", actualRoutePath: "/wrong", freshObservation: true }).result, "NOT_CONFIRMED");
});

test("a standard textbox with an explicit Search label is a bounded search input", () => {
  const requirement = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" })[0]!;
  const searchTextbox = { ...observation.inputs[0]!, role: "textbox", type: "text", label: "Search by invoice #, talent email, or job title", placeholder: "Search by invoice #, talent email, or job title" };
  const evidence = evaluateBrowserSourceBoundStructuralControlPresence({ requirement, observation: { ...observation, inputs: [searchTextbox] }, actualPersona: "company_admin", actualRoutePath: "/company/payments", freshObservation: true });
  assert.equal(evidence.matchingControlCount, 1);
  assert.equal(evidence.result, "CONFIRMED");
});

test("an ARIA searchbox remains a qualifying search input", () => {
  const requirement = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" })[0]!;
  const evidence = evaluateBrowserSourceBoundStructuralControlPresence({
    requirement,
    observation: { ...observation, inputs: [{ ...observation.inputs[0]!, role: "searchbox", type: "text", label: "", placeholder: "" }] },
    actualPersona: "company_admin",
    actualRoutePath: "/company/payments",
    freshObservation: true,
  });
  assert.equal(evidence.matchingControlCount, 1);
  assert.equal(evidence.result, "CONFIRMED");
});

test("unrelated textbox labels do not become search controls", () => {
  const requirement = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" })[0]!;
  for (const label of ["Invoice number", "Research notes"]) {
    const evidence = evaluateBrowserSourceBoundStructuralControlPresence({
      requirement,
      observation: { ...observation, inputs: [{ ...observation.inputs[0]!, role: "textbox", type: "text", label, placeholder: label }] },
      actualPersona: "company_admin",
      actualRoutePath: "/company/payments",
      freshObservation: true,
    });
    assert.equal(evidence.matchingControlCount, 0, label);
    assert.equal(evidence.result, "NOT_CONFIRMED", label);
  }
});

test("multiple qualifying controls remain observable and preserve AT_LEAST_ONE semantics", () => {
  const requirement = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase, executionObligationIds: ["ob-search"], obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/company/payments" })[0]!;
  const first = { ...observation.inputs[0]!, role: "textbox", type: "text", label: "Search jobs", placeholder: "Search jobs" };
  const second = { ...observation.inputs[0]!, role: "textbox", type: "text", label: "Search candidates", placeholder: "Search candidates" };
  const evidence = evaluateBrowserSourceBoundStructuralControlPresence({ requirement, observation: { ...observation, inputs: [first, second] }, actualPersona: "company_admin", actualRoutePath: "/company/payments", freshObservation: true });
  assert.equal(evidence.matchingControlCount, 2);
  assert.equal(evidence.result, "CONFIRMED");
});

test("only an upstream-approved direct TASK obligation may carry the structural source semantic", () => {
  const taskLedger: PlannerAcceptanceObligationLedger = {
    ...ledger,
    obligations: [{ id: "task-search", sourceUnitIds: ["task-source"], sourceRole: "TASK", derivation: "DIRECT_TASK_SECTION", text: "Add a search bar to the page." }],
  };
  const taskSources: PlannerAcceptanceSourceLedger = {
    ...sourceLedger,
    sourceUnits: [{ id: "task-source", sourceKind: "DESCRIPTION", sourceRef: "jira.description", sectionHeading: "Task", text: "Add a search bar to the page." }],
  };
  const taskCase = { ...testCase, acceptanceObligationIds: ["task-search"], executionVerdictScope: { executionObligationIds: ["task-search"], verdictScopeObligationIds: ["task-search"], verdictAuthority: "INDEPENDENT" as const } };
  assert.deepEqual(buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase: taskCase, executionObligationIds: [], obligationLedger: taskLedger, sourceLedger: taskSources, acceptedRoutePath: "/company/payments" }), []);
  const requirements = buildBrowserSourceBoundStructuralControlPresenceRequirements({ testCase: taskCase, executionObligationIds: ["task-search"], obligationLedger: taskLedger, sourceLedger: taskSources, acceptedRoutePath: "/company/payments" });
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.proofAuthority, "DIRECT_TASK");
  assert.equal(requirements[0]!.sourceRole, "TASK");
});
