import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { Page } from "playwright";

import type { BrowserTestCase } from "../../planner/types.js";
import type { InvoiceInteractionResult } from "./browser-entity-interaction.js";
import {
  dispatchBrowserRuntimeFixtureResolution,
  mergeRuntimeFixturePreparations,
} from "./browser-runtime-fixture-resolution-dispatch.js";
import {
  getBrowserBlockReason,
} from "./browser-case-blocking-policy.js";
import {
  evaluateRuntimeInvoiceFixturePreparation,
} from "./browser-runtime-fixture-preparation.js";

function runtimeCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  const executionCaseId = "case-1";
  return {
    id: "runtime-case-1",
    persona: "company_admin",
    goal: "candidate",
    startRoute: "/company/all-payments",
    successCriteria: "candidate",
    runtimeFixturePolicy: "compatible-state",
    runtimeFixtureResolutionContract: {
      status: "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      policy: "ALL_REQUIRED",
      members: [{
        executionCaseId,
        required: true,
        acceptanceFixtureConstraint: {
          executionCaseId, sourceCaseId: executionCaseId,
          partition: { mode: "ALL_REQUIRED", memberId: "processed", memberCount: 1 },
          fixtureKind: "invoice", semantic: { kind: "STATE", state: "processed" },
          obligationIds: ["obligation-1"],
          sourceUnitRefs: [{ sourceUnitId: "unit-1", sourceRef: "jira.description" }],
          identityPolicy: "compatible-state", authority: "SOURCE_AUTHORIZED",
        },
        fixtureResolutionCapability: {
          executionCaseId, fixtureKind: "invoice", resolverRef: "browser-visible-invoice-row",
          classification: "READ_ONLY_DISCOVERY", persona: "company_admin", supportedState: "processed",
          identityPolicy: "compatible-state", selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
          ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
          provenance: { module: "src/agents/browser/browser-entity-interaction.ts", exportName: "resolveAndOpenInvoiceRow" },
        },
        runtimeFixtureBinding: "NOT_YET_RESOLVED",
      }],
      fixtureReadyForInteraction: false,
      interactionExecutionCaseId: executionCaseId,
    },
    ...overrides,
  };
}

function preparation(testCase: BrowserTestCase, candidates = ["INV-1"]): ReturnType<typeof evaluateRuntimeInvoiceFixturePreparation> {
  return evaluateRuntimeInvoiceFixturePreparation({
    testCase, actualPersona: "company_admin", requiredState: "processed", stateVerified: true,
    candidates: candidates.map(identityRef => ({ identityRef, verifiedState: "processed" as const })),
    preparedAt: "2026-09-07T00:00:00.000Z", evidenceRef: "test:fixture",
  });
}

function opened(testCase: BrowserTestCase, candidates = ["INV-1"]): InvoiceInteractionResult {
  const value = preparation(testCase, candidates);
  if (value.status !== "RESOLVED") {
    return { status: "TEST_DATA_ISSUE", note: value.note, runtimeFixturePreparation: value };
  }
  return {
    status: "OPENED", note: "opened", selectedInvoice: value.selectedIdentity!, requestedInvoice: null,
    handoffInvoice: null, requiredTableView: "processed", selectedTableView: "processed",
    exactInvoiceMatched: false, handoffInvoiceMatched: false, runtimeFixturePolicy: "compatible-state",
    runtimeFixturePreparation: value,
  };
}

async function dispatch(testCase = runtimeCase(), resolver = async () => opened(testCase)) {
  return dispatchBrowserRuntimeFixtureResolution({
    page: {} as Page, testCase, actualPersona: "company_admin", resolveInvoice: resolver,
  });
}

test("no runtime fixture contract is not required", async () => {
  const testCase = runtimeCase();
  delete testCase.runtimeFixtureResolutionContract;
  const result = await dispatch(testCase);
  assert.equal(result.status, "NOT_REQUIRED");
  assert.deepEqual(result.preparations, []);
});

test("one unique source-authorized invoice resolver opens and returns its exact binding", async () => {
  const testCase = runtimeCase();
  let calls = 0;
  const result = await dispatch(testCase, async () => { calls += 1; return opened(testCase); });
  assert.equal(calls, 1);
  assert.equal(result.status, "READY");
  assert.equal(result.preparations[0]?.selectedIdentity, "INV-1");
  assert.equal(result.preparations[0]?.binding?.fixtureIdentityRef, "INV-1");
});

test("typed invoice resolver admission does not require planner invoice row steps", () => {
  const testCase = runtimeCase({
    steps: [],
    fixtureRequirements: ["fixture data unavailable"],
  });
  assert.equal(getBrowserBlockReason(testCase), null);
  testCase.steps = [{ action: "clickTopTab", text: "unrelated" }];
  assert.equal(getBrowserBlockReason(testCase), null);
});

for (const [label, candidates, reason] of [
  ["zero", [], "NO_COMPATIBLE_CANDIDATE"],
  ["multiple", ["INV-1", "INV-2"], "AMBIGUOUS_COMPATIBLE_CANDIDATES"],
] as const) {
  test(`${label} candidates fail closed before generic execution`, async () => {
    const testCase = runtimeCase();
    const result = await dispatch(testCase, async () => opened(testCase, [...candidates]));
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.preparations[0]?.failureReason, reason);
  });
}

test("persona mismatch and exact identity mismatch fail closed", async () => {
  const personaCase = runtimeCase();
  const persona = preparation(personaCase, ["INV-1"]);
  const personaResult = await dispatch(personaCase, async () => ({
    status: "TEST_DATA_ISSUE", note: persona.note, runtimeFixturePreparation: { ...persona, status: "TEST_DATA_BLOCKED", failureReason: "PERSONA_MISMATCH", fixtureReadyForInteraction: false, binding: null },
  }));
  assert.equal(personaResult.status, "BLOCKED");
  const exactCase = runtimeCase({ runtimeFixturePolicy: "exact" });
  exactCase.runtimeFixtureResolutionContract!.members[0]!.acceptanceFixtureConstraint!.identityPolicy = "exact";
  exactCase.runtimeFixtureResolutionContract!.members[0]!.fixtureResolutionCapability!.identityPolicy = "exact";
  const exact = evaluateRuntimeInvoiceFixturePreparation({ testCase: exactCase, actualPersona: "company_admin", requiredState: "processed", stateVerified: true, candidates: [{ identityRef: "INV-1", verifiedState: "processed" }], preparedAt: "2026-09-07T00:00:00.000Z", evidenceRef: "test:fixture" });
  const exactResult = await dispatch(exactCase, async () => ({ status: "TEST_DATA_ISSUE", note: exact.note, runtimeFixturePreparation: exact }));
  assert.equal(exactResult.status, "BLOCKED");
  assert.equal(exactResult.preparations[0]?.failureReason, "EXACT_IDENTITY_MISMATCH");
});

test("malformed, unsupported, composed, and discovery-only cases never use the invoice adapter", async () => {
  const malformed = runtimeCase();
  malformed.runtimeFixtureResolutionContract!.members = [];
  let calls = 0;
  assert.equal((await dispatch(malformed, async () => { calls += 1; return opened(malformed); })).status, "BLOCKED");
  const talent = runtimeCase();
  talent.runtimeFixtureResolutionContract!.members[0]!.fixtureResolutionCapability = {
    capabilityId: "talent-capability", executionCaseId: "case-1", fixtureKind: "talent-contract",
    resolverRef: "talent-contract-detail-readonly-v1", classification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
    persona: "talent", supportedPredicates: ["contract.accessibleToOwner"], identityPolicy: "compatible-state",
    selectionPolicy: "UNIQUE_COMPATIBLE_ONLY", ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
    identityVerification: "REQUIRED", ownershipVerification: "REQUIRED",
    provenance: { module: "src/agents/browser/fixtures/verified-contract-fixture-state.ts", exportName: "selectVerifiedContractFixtureCandidate" },
  } as never;
  assert.equal((await dispatch(talent, async () => { calls += 1; return opened(talent); })).status, "BLOCKED");
  const discovery = runtimeCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } });
  assert.equal((await dispatch(discovery, async () => { calls += 1; return opened(discovery); })).status, "NOT_REQUIRED");
  assert.equal(calls, 0);
});

test("mismatched opened identity is blocked and preparations merge without duplicates", async () => {
  const testCase = runtimeCase();
  const value = preparation(testCase);
  const result = await dispatch(testCase, async () => ({
    ...opened(testCase), selectedInvoice: "INV-other", runtimeFixturePreparation: value,
  }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(mergeRuntimeFixturePreparations(result.preparations, result.preparations).length, 1);
});

test("dispatcher uses no issue-key behavior or fixture provisioning", () => {
  const source = fs.readFileSync(new URL("./browser-runtime-fixture-resolution-dispatch.ts", import.meta.url), "utf8");
  assert.equal(source.includes("AS-1014"), false);
  assert.equal(source.includes("QA_ALLOW_BROWSER_FIXTURE_PROVISIONING"), false);
  assert.ok(source.includes('case "browser-visible-invoice-row"'));
  assert.ok(source.includes('case "talent-contract-detail-readonly-v1"'));
});

test("runner dispatches before generic runtime and merges preparations before proof", () => {
  const source = fs.readFileSync(new URL("./run-browser-cases.ts", import.meta.url), "utf8");
  const dispatchAt = source.indexOf("dispatchBrowserRuntimeFixtureResolution({");
  const genericAt = source.indexOf("runGenericBrowserRuntimeAttempt({");
  const mergeAt = source.indexOf("mergeRuntimeFixturePreparations(");
  const proofAt = source.indexOf("executeBrowserEvidenceContractProofs({");
  assert.ok(dispatchAt >= 0 && dispatchAt < genericAt);
  assert.ok(mergeAt >= 0 && mergeAt < proofAt);
});
