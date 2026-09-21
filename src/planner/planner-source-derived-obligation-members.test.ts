import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildPlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import type {
  PlannerAcceptanceSourceLedger,
  PlannerAcceptanceSourceUnit,
} from "./planner-acceptance-source-ledger.js";
import {
  buildPlannerSourceDerivedObligationMemberLedger,
} from "./planner-source-derived-obligation-members.js";

function sourceUnit(id: string, text: string): PlannerAcceptanceSourceUnit {
  return {
    id,
    sourceKind: "ACCEPTANCE_CRITERIA",
    sourceRef: "jira.field:acceptance",
    text,
  };
}

function derive(sourceUnits: PlannerAcceptanceSourceUnit[]) {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "ACCEPTANCE_CRITERIA",
    sourceUnits,
  };
  const obligationLedger = buildPlannerAcceptanceObligationLedger(sourceLedger);
  return buildPlannerSourceDerivedObligationMemberLedger({
    sourceLedger,
    obligationLedger,
  });
}

function members(ledger: ReturnType<typeof derive>): string[] {
  return ledger.memberSets.flatMap((set) =>
    set.members.map((member) => member.exactSourceText)
  ).sort();
}

test("AS-1312-like source retains six target members under four parents", () => {
  const ledger = derive([
    sourceUnit("compliance", "This should work both for compliance requirements of type compliance document and master service agreement."),
    sourceUnit("background", "For 'background_check' type of requirements, view the status and the issue date of the BGV."),
    sourceUnit("authorization", "For 'work_authorization' view the readonly work authorization that is snapshotted to the contract."),
    sourceUnit("setup", "Trolley and Deel can open up their setup models freely."),
  ]);

  assert.deepEqual(members(ledger), [
    "Deel",
    "Trolley",
    "background_check",
    "compliance document",
    "master service agreement",
    "work_authorization",
  ]);
  assert.equal(ledger.memberSets.length, 4);
  assert.ok(ledger.memberSets.every((set) => set.dimension === "TARGET"));
  assert.ok(ledger.memberSets.every((set) => set.policy === "ALL_REQUIRED"));
});

test("AS-1344-like source retains one required surface set", () => {
  const ledger = derive([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);

  assert.equal(ledger.memberSets.length, 1);
  assert.equal(ledger.memberSets[0]?.dimension, "SURFACE");
  assert.deepEqual(members(ledger), ["All Payments", "Payments"]);
});

test("AS-1014-like source retains independent surface and state dimensions", () => {
  const ledger = derive([
    sourceUnit("drawer", "In the payments and all payments table, display approved by info in the “sent for processing” and “processed” tabs. It should be displayed in a details drawer triggered by a click on the invoice number."),
  ]);

  assert.equal(ledger.memberSets.length, 2);
  assert.deepEqual(
    ledger.memberSets.map((set) => set.dimension).sort(),
    ["STATE", "SURFACE"]
  );
  assert.deepEqual(members(ledger), [
    "all payments",
    "payments",
    "processed",
    "sent for processing",
  ]);
  assert.equal(ledger.memberSets.flatMap((set) => set.members).length, 4);
});

test("member identities are stable across repeated derivation and unrelated source ordering", () => {
  const relevant = sourceUnit("search", "Add a search bar to the Payments & All Payments page.");
  const unrelated = sourceUnit("unrelated", "The user should see a welcome message.");
  const first = derive([relevant, unrelated]);
  const second = derive([unrelated, relevant]);
  const identities = (ledger: ReturnType<typeof derive>) => ledger.memberSets
    .flatMap((set) => set.members.map((member) => member.memberId))
    .sort();

  assert.deepEqual(identities(first), identities(second));
  assert.deepEqual(identities(first), identities(derive([relevant, unrelated])));
});

test("member IDs exclude ordinal and any model browser-shell input", () => {
  const ledger = derive([
    sourceUnit("search", "Add a search bar to the Payments & All Payments page."),
  ]);
  const set = ledger.memberSets[0]!;
  const payments = set.members.find((member) => member.canonicalMemberText === "payments")!;
  const expected = createHash("sha256")
    .update([
      set.parentObligationId,
      set.sourceUnitRef.sourceUnitId,
      set.sourceUnitRef.sourceRef,
      "SURFACE",
      "payments",
    ].join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  assert.notEqual(set.members[0]?.memberId, set.members[1]?.memberId);
  assert.equal(payments.memberId, `source-member-${expected}`);
  assert.match(set.members[0]?.memberId ?? "", /^source-member-[a-f0-9]{12}$/);
  assert.equal("browserCases" in ledger, false);
  assert.equal("semanticCandidates" in ledger, false);
});

test("ordinary conjunction prose remains undecomposed", () => {
  const ledger = derive([
    sourceUnit("prose", "The details drawer displays status and issue date."),
  ]);

  assert.deepEqual(ledger.memberSets, []);
  assert.deepEqual(ledger.obligationAudits.map((audit) => audit.reason), [
    "NO_EXPLICIT_MEMBER_STRUCTURE",
  ]);
});

test("duplicate canonical source member identity fails closed", () => {
  const ledger = derive([
    sourceUnit("duplicate", "Add a search bar to the Payments & Payments page."),
  ]);

  assert.deepEqual(ledger.memberSets, []);
  assert.deepEqual(ledger.obligationAudits.map((audit) => audit.reason), [
    "DUPLICATE_MEMBER_IDENTITY",
  ]);
});

test("unavailable source produces no members and a closed audit", () => {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "UNAVAILABLE",
    basis: "SOURCE_UNAVAILABLE",
    sourceUnits: [],
  };
  const obligationLedger = buildPlannerAcceptanceObligationLedger(sourceLedger);
  const ledger = buildPlannerSourceDerivedObligationMemberLedger({
    sourceLedger,
    obligationLedger,
  });

  assert.equal(ledger.sourceStatus, "UNAVAILABLE");
  assert.deepEqual(ledger.memberSets, []);
});

test("ordinary actor conjunctions never become target member sets", () => {
  for (const text of [
    "Managers and talents can view the details.",
    "Payments and invoices can be reviewed.",
    "Company and talent can access the page.",
  ]) {
    const ledger = derive([sourceUnit("actors", text)]);
    assert.deepEqual(ledger.memberSets, [], text);
    assert.equal(ledger.obligationAudits[0]?.reason, "NO_EXPLICIT_MEMBER_STRUCTURE", text);
  }
});
