import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrderingProofFieldBinding,
  buildOrderingRequirements,
  type BrowserOrderingAuthorityContext,
} from "./planner-browser-policy.js";

function authorityContext(
  text: string,
  sourceStatus: "RESOLVED" | "UNAVAILABLE" = "RESOLVED"
): BrowserOrderingAuthorityContext {
  if (sourceStatus === "UNAVAILABLE") {
    return {
      acceptanceSourceLedger: {
        sourceStatus: "UNAVAILABLE",
        basis: "SOURCE_UNAVAILABLE",
        sourceUnits: [],
      },
      acceptanceObligationLedger: {
        sourceStatus: "UNAVAILABLE",
        derivationStatus: "SOURCE_UNAVAILABLE",
        obligations: [],
        unresolvedSourceUnitIds: [],
      },
    };
  }

  return {
    acceptanceSourceLedger: {
      sourceStatus: "RESOLVED",
      basis: "ACCEPTANCE_CRITERIA",
      sourceUnits: [
        {
          id: "jira-req-exact",
          sourceKind: "ACCEPTANCE_CRITERIA",
          sourceRef: "jira.acceptanceCriteria[0]",
          text,
        },
      ],
    },
    acceptanceObligationLedger: {
      sourceStatus: "RESOLVED",
      derivationStatus: "RESOLVED",
      obligations: [
        {
          id: "jira-obligation-exact",
          sourceUnitIds: ["jira-req-exact"],
          sourceRole: "ACCEPTANCE",
          derivation: "DIRECT_ACCEPTANCE_FIELD",
          text,
        },
      ],
      unresolvedSourceUnitIds: [],
    },
  };
}

test("newest first is RECENCY DESC without a proof field", () => {
  const item = buildOrderingRequirements(["Records are newest first."])[0]!;
  assert.equal(item.semanticDimension, "RECENCY");
  assert.equal(item.direction, "DESC");
  assert.equal(item.proofFieldBinding, undefined);
});

test("latest first is RECENCY DESC", () => {
  const item = buildOrderingRequirements(["Records are latest first."])[0]!;
  assert.equal(item.semanticDimension, "RECENCY");
  assert.equal(item.direction, "DESC");
});

test("oldest first is RECENCY ASC", () => {
  const item = buildOrderingRequirements(["Records are oldest first."])[0]!;
  assert.equal(item.semanticDimension, "RECENCY");
  assert.equal(item.direction, "ASC");
});

test("generic sort availability creates no semantic requirement", () => {
  assert.deepEqual(buildOrderingRequirements(["Sorting is available."]), []);
});

test("semantic requirement can exist without a concrete field", () => {
  const item = buildOrderingRequirements(["Items are most recent first."])[0]!;
  assert.equal(item.semanticDimension, "RECENCY");
  assert.equal(item.fieldHint, undefined);
  assert.equal(item.proofFieldBinding, undefined);
});

test("same source produces the same requirement identity", () => {
  assert.equal(
    buildOrderingRequirements(["Records are newest first."], "web-1")[0]!.requirementId,
    buildOrderingRequirements(["Records are newest first."], "web-1")[0]!.requirementId
  );
});

test("field proposal is separate from semantic requirement", () => {
  const item = buildOrderingRequirements([
    "Records are sorted by createdAt descending.",
  ])[0]!;
  assert.equal(item.semanticDimension, "RECENCY");
  assert.equal(item.proofFieldBinding?.proposedField, "createdAt");
});

test("planner field proposal is candidate-only", () => {
  const item = buildOrderingRequirements([
    "Records are sorted by createdAt descending.",
  ])[0]!;
  assert.equal(item.proofFieldBinding?.proposalSource, "PLANNER_HEURISTIC");
  assert.equal(item.proofFieldBinding?.authority, "CANDIDATE");
});

test("exact field in exact authoritative acceptance source authorizes binding", () => {
  const claim = "Records are sorted by updatedAt descending.";
  const item = buildOrderingRequirements(
    [claim],
    "web-1",
    authorityContext(claim)
  )[0]!;
  assert.equal(item.proofFieldBinding?.proposalSource, "AC_EXPLICIT");
  assert.equal(item.proofFieldBinding?.authority, "AUTHORITATIVE");
});

test("implementation-only proposal remains candidate", () => {
  const binding = buildOrderingProofFieldBinding({
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY",
    proposedField: "updatedAt",
    sourceClaim: "Newest first.",
    proposalSource: "IMPLEMENTATION_DERIVED",
    sourceRef: "src/RecordsTable.tsx:10",
  });
  assert.equal(binding.authority, "CANDIDATE");
  assert.equal(binding.proposalSource, "IMPLEMENTATION_DERIVED");
});

test("planner-derived proposal remains candidate", () => {
  const binding = buildOrderingProofFieldBinding({
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY",
    proposedField: "createdAt",
    sourceClaim: "Newest first.",
  });
  assert.equal(binding.authority, "CANDIDATE");
});

test("unavailable acceptance source cannot authorize", () => {
  const claim = "Records are sorted by updatedAt descending.";
  const item = buildOrderingRequirements(
    [claim],
    "web-1",
    authorityContext(claim, "UNAVAILABLE")
  )[0]!;
  assert.equal(item.proofFieldBinding?.authority, "CANDIDATE");
});

test("similar visible language cannot authorize a technical field", () => {
  const claim = "Records are sorted by updatedAt descending.";
  const item = buildOrderingRequirements(
    [claim],
    "web-1",
    authorityContext("Records are sorted by Last updated descending.")
  )[0]!;
  assert.equal(item.proofFieldBinding?.authority, "CANDIDATE");
});

test("exact identifier token detection authorizes", () => {
  const claim = "Sort updatedAt descending.";
  assert.equal(
    buildOrderingRequirements([claim], "web-1", authorityContext(claim))[0]!
      .proofFieldBinding?.authority,
    "AUTHORITATIVE"
  );
});

test("identifier substring collision does not authorize", () => {
  const plannerClaim = "Sort updatedAt descending.";
  const context = authorityContext(plannerClaim);
  context.acceptanceSourceLedger!.sourceUnits[0]!.text =
    "Sort updatedAtLegacy descending.";
  assert.equal(
    buildOrderingRequirements([plannerClaim], "web-1", context)[0]!
      .proofFieldBinding?.authority,
    "CANDIDATE"
  );
});

test("binding identity is deterministic", () => {
  const args = {
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY" as const,
    proposedField: "updatedAt",
    sourceClaim: "Newest first.",
  };
  assert.equal(
    buildOrderingProofFieldBinding(args).bindingId,
    buildOrderingProofFieldBinding(args).bindingId
  );
});

test("different proposed fields produce different binding identities", () => {
  const common = {
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY" as const,
    sourceClaim: "Newest first.",
  };
  assert.notEqual(
    buildOrderingProofFieldBinding({ ...common, proposedField: "createdAt" }).bindingId,
    buildOrderingProofFieldBinding({ ...common, proposedField: "updatedAt" }).bindingId
  );
});

test("implementation source reference is retained without granting authority", () => {
  const binding = buildOrderingProofFieldBinding({
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY",
    proposedField: "updatedAt",
    sourceClaim: "Newest first.",
    proposalSource: "IMPLEMENTATION_DERIVED",
    sourceRef: "src/RecordsTable.tsx:10",
  });
  assert.equal(binding.sourceRef, "src/RecordsTable.tsx:10");
  assert.equal(binding.authority, "CANDIDATE");
});
