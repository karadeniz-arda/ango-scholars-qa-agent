import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { runGenericBrowserSteps } from "./browser-step-executor.js";

test("selecting a matching sort option emits verdict-neutral ordering evidence", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="listbox" aria-label="Sort options">
        <button role="option" aria-selected="false" onclick="
          this.setAttribute('aria-selected', 'true');
          const body = document.querySelector('tbody');
          body.insertBefore(body.children[1], body.children[0]);
        ">Newest</button>
      </div>
      <table aria-label="Records">
        <thead><tr><th>Created At</th></tr></thead>
        <tbody>
          <tr><td>2026-01-01</td></tr>
          <tr><td>2026-02-02</td></tr>
        </tbody>
      </table>
    `);

    const testCase = {
      id: "ordering-runtime",
      goal: "Records are newest first.",
      successCriteria: "Records are newest first.",
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: ["Records are newest first."],
        orderingRequirements: [
          {
            kind: "ORDERING",
            requirementId: "ordering-runtime-ordering-1",
            sourceClaim: "Records are newest first.",
            semanticDimension: "RECENCY",
            direction: "DESC",
            comparisonType: "DATE_TIME",
            collectionHint: "records",
            fieldHint: "createdAt",
            proofFieldBinding: {
              bindingId: "ordering-runtime-binding-createdAt",
              requirementId: "ordering-runtime-ordering-1",
              semanticDimension: "RECENCY",
              proposedField: "createdAt",
              proposalSource: "AC_EXPLICIT",
              authority: "AUTHORITATIVE",
            },
            selectionHint: "Newest",
          },
        ],
      },
      steps: [{ action: "selectOption", text: "Newest" }],
    };
    const result = await runGenericBrowserSteps(
      page,
      testCase,
      undefined,
      undefined,
      {
        visibleFieldProvenance: [{
          visibleLabel: "Created At",
          sourceFields: ["createdAt"],
          kind: "DIRECT",
          sourceRef: {
            file: "src/RecordsTable.tsx",
            line: 1,
          },
          authoritative: true,
          reason:
            "Synthetic direct accessor.",
        }],
      }
    );

    assert.equal(result.orderingEvidence?.[0]?.status, "CONFIRMED");
    assert.deepEqual(
      result.orderingEvidence?.[0]?.values,
      ["2026-02-02", "2026-01-01"]
    );
    assert.equal(
      result.orderingEvidenceParity?.status,
      "ORDERING_EVIDENCE_CONFIRMED"
    );
    assert.notEqual(result.status, "PASS");
  } finally {
    await browser.close();
  }
});

test("successful sort selection without a grounded collection stays unavailable", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="listbox" aria-label="Sort options">
        <button role="option" aria-selected="false"
          onclick="this.setAttribute('aria-selected', 'true')">Newest</button>
      </div>
    `);

    const orderingRequirement = {
      kind: "ORDERING",
      requirementId: "ordering-missing-ordering-1",
      sourceClaim: "Records are newest first.",
      semanticDimension: "RECENCY",
      direction: "DESC",
      comparisonType: "DATE_TIME",
      collectionHint: "records",
      fieldHint: "createdAt",
      proofFieldBinding: {
        bindingId: "ordering-missing-binding-createdAt",
        requirementId: "ordering-missing-ordering-1",
        semanticDimension: "RECENCY",
        proposedField: "createdAt",
        proposalSource: "AC_EXPLICIT",
        authority: "AUTHORITATIVE",
      },
      selectionHint: "Newest",
    };
    const result = await runGenericBrowserSteps(page, {
      id: "ordering-missing",
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [],
        orderingRequirements: [orderingRequirement],
      },
      steps: [{ action: "selectOption", text: "Newest" }],
    });

    assert.equal(
      result.orderingEvidence?.[0]?.reason,
      "COLLECTION_NOT_GROUNDED"
    );
    assert.equal(
      result.orderingEvidenceParity?.status,
      "ORDERING_EVIDENCE_UNAVAILABLE"
    );
    assert.notEqual(result.status, "PASS");
  } finally {
    await browser.close();
  }
});
