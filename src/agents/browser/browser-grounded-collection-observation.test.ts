import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  after,
  before,
  test,
} from "node:test";
import {
  chromium,
  type Browser,
} from "playwright";

import {
  observeBrowserPage,
  type BrowserObservationOptions,
} from "./browser-observation.js";
import {
  evaluateBrowserOrderingRequirement,
} from "./browser-ordering-evidence.js";

let browser: Browser;

function authoritativeNameBinding() {
  return {
    semanticDimension: "LEXICAL_ORDER" as const,
    proofFieldBinding: {
      bindingId: "ordering-binding-name",
      requirementId: "ordering-1",
      semanticDimension: "LEXICAL_ORDER" as const,
      proposedField: "name",
      proposalSource: "AC_EXPLICIT" as const,
      authority: "AUTHORITATIVE" as const,
    },
  };
}

before(async () => {
  browser = await chromium.launch({
    headless: true,
  });
});

after(async () => {
  await browser.close();
});

async function observe(
  html: string,
  options: BrowserObservationOptions = {}
) {
  const page = await browser.newPage();

  try {
    await page.setContent(html);
    return await observeBrowserPage(
      page,
      options
    );
  } finally {
    await page.close();
  }
}

function nativeTable(args: {
  identity?: string;
  identityKind?: "caption" | "aria-label";
  header?: string;
  values?: string[];
  rowAttributes?: string[];
} = {}): string {
  const identity = args.identity ?? "Records";
  const identityAttribute =
    args.identityKind === "caption"
      ? ""
      : `aria-label="${identity}"`;
  const captionMarkup =
    args.identityKind === "caption"
      ? `<caption>${identity}</caption>`
      : "";
  const values = args.values ?? ["B", "A"];

  return `
    <table ${identityAttribute}>
      ${captionMarkup}
      <thead><tr><th>${args.header ?? "Name"}</th></tr></thead>
      <tbody>
        ${values.map((value, index) =>
          `<tr ${args.rowAttributes?.[index] ?? ""}><td>${value}</td></tr>`
        ).join("")}
      </tbody>
    </table>
  `;
}

const collectionObserverSource = (() => {
  const source = readFileSync(
    new URL("./browser-observation.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf("GROUNDED_COLLECTION_OBSERVATION_V1");
  const end = source.indexOf("const visibleTextRoots", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
})();

test("native table caption grounds collection identity", async () => {
  const result = await observe(nativeTable({ identityKind: "caption" }));
  assert.equal(result.collections?.[0]?.identity.method, "TABLE_CAPTION");
});

test("ARIA table accessible name grounds identity", async () => {
  const result = await observe(`
    <div role="table" aria-label="Records">
      <div role="row"><span role="columnheader">Name</span></div>
      <div role="row"><span role="cell">B</span></div>
      <div role="row"><span role="cell">A</span></div>
    </div>
  `);
  assert.equal(result.collections?.[0]?.identity.method, "ARIA_NAME");
  assert.equal(result.collections?.[0]?.provenance.method, "ARIA_TABLE");
});

test("ARIA grid accessible name grounds identity", async () => {
  const result = await observe(`
    <div role="grid" aria-label="Records">
      <div role="row"><span role="columnheader">Name</span></div>
      <div role="row"><span role="gridcell">B</span></div>
      <div role="row"><span role="gridcell">A</span></div>
    </div>
  `);
  assert.equal(result.collections?.[0]?.shape, "GRID");
  assert.equal(result.collections?.[0]?.provenance.method, "ARIA_GRID");
});

test("table aria-labelledby resolves its exact declared label", async () => {
  const result = await observe(`
    <h2 id="records-label">Records</h2>
    <table aria-labelledby="records-label">
      <tr><th>Name</th></tr><tr><td>A</td></tr>
    </table>
  `);
  assert.equal(result.collections?.[0]?.identity.method, "ARIA_LABELLEDBY");
  assert.equal(result.collections?.[0]?.identity.sourceText, "Records");
});

test("unlabelled table remains explicitly ungrounded", async () => {
  const result = await observe(`
    <table><tr><th>Name</th></tr><tr><td>A</td></tr></table>
  `);
  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_NOT_GROUNDED");
});

test("two equally matching grounded tables remain separate candidates", async () => {
  const result = await observe(nativeTable() + nativeTable());
  assert.equal(result.collections?.length, 2);
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Records are descending.",
      direction: "DESC",
      comparisonType: "LEXICAL",
      collectionHint: "records",
      fieldHint: "name",
      ...authoritativeNameBinding(),
    },
    observation: result,
    visibleFieldProvenance: [{
      visibleLabel: "Name",
      sourceFields: ["name"],
      kind: "DIRECT",
      sourceRef: {
        file: "src/RecordsTable.tsx",
        line: 1,
      },
      authoritative: true,
      reason: "Synthetic direct accessor.",
    }],
  });
  assert.equal(evidence.reason, "AMBIGUOUS_COLLECTION");
});

test("collection hint filters only already-grounded identities", async () => {
  const result = await observe(
    nativeTable({ identity: "Jobs" }) +
    nativeTable({ identity: "Archive" })
  );
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Jobs are descending.",
      direction: "DESC",
      comparisonType: "LEXICAL",
      collectionHint: "jobs",
      fieldHint: "name",
      ...authoritativeNameBinding(),
    },
    observation: result,
    visibleFieldProvenance: [{
      visibleLabel: "Name",
      sourceFields: ["name"],
      kind: "DIRECT",
      sourceRef: {
        file: "src/RecordsTable.tsx",
        line: 1,
      },
      authoritative: true,
      reason: "Synthetic direct accessor.",
    }],
  });
  assert.equal(evidence.status, "CONFIRMED");
  assert.equal(evidence.collectionLabel, "Jobs");
});

test("collection hint cannot ground an unlabelled table", async () => {
  const result = await observe(`
    <p>Jobs</p><table><tr><th>Name</th></tr><tr><td>A</td></tr></table>
  `);
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Jobs are descending.",
      direction: "DESC",
      comparisonType: "LEXICAL",
      collectionHint: "jobs",
      fieldHint: "name",
      ...authoritativeNameBinding(),
    },
    observation: result,
    visibleFieldProvenance: [{
      visibleLabel: "Name",
      sourceFields: ["name"],
      kind: "DIRECT",
      sourceRef: {
        file: "src/RecordsTable.tsx",
        line: 1,
      },
      authoritative: true,
      reason: "Synthetic direct accessor.",
    }],
  });
  assert.equal(evidence.reason, "COLLECTION_NOT_GROUNDED");
});

test("unrelated page heading cannot ground a table", async () => {
  const result = await observe(`
    <h1>Jobs</h1><div><table><tr><th>Name</th></tr><tr><td>A</td></tr></table></div>
  `);
  assert.equal(result.collections?.length, 0);
});

test("active modal excludes a grounded background table", async () => {
  const result = await observe(`
    ${nativeTable({ identity: "Background" })}
    <div role="dialog" aria-modal="true" aria-label="Dialog" style="position:fixed;inset:0;background:white">
      ${nativeTable({ identity: "Foreground" })}
    </div>
  `);
  assert.deepEqual(result.collections?.map((item) => item.label), ["Foreground"]);
});

test("native th headers create exact visible fields", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>Job</th><th>Last updated</th></tr><tr><td>A</td><td>3 days ago</td></tr></table>
  `);
  assert.deepEqual(result.collections?.[0]?.fields.map((field) => field.visibleLabel), ["Job", "Last updated"]);
});

test("ARIA columnheader creates visible fields", async () => {
  const result = await observe(`
    <div role="table" aria-label="Jobs"><div role="row"><span role="columnheader">Job</span></div><div role="row"><span role="cell">A</span></div></div>
  `);
  assert.equal(result.collections?.[0]?.fields[0]?.provenance.method, "ARIA_COLUMNHEADER");
});

test("duplicate normalized headers fail safe", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>Last updated</th><th>Last  updated</th></tr><tr><td>A</td><td>B</td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "FIELD_SCHEMA_AMBIGUOUS");
});

test("missing structural headers fail safe", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><td>A</td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "SCHEMA_NOT_GROUNDED");
});

test("cell text cannot invent a header", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><td>updatedAt</td></tr><tr><td>2026-01-01</td></tr></table>
  `);
  assert.deepEqual(result.collectionAbstentions?.[0]?.visibleSchemaLabels, []);
});

test("native tr data rows are captured", async () => {
  const result = await observe(nativeTable());
  assert.equal(result.collections?.[0]?.rows.length, 2);
  assert.equal(result.collections?.[0]?.rows[0]?.provenance.method, "NATIVE_TR");
});

test("ARIA rows are captured", async () => {
  const result = await observe(`
    <div role="grid" aria-label="Records"><div role="row"><span role="columnheader">Name</span></div><div role="row"><span role="gridcell">A</span></div></div>
  `);
  assert.equal(result.collections?.[0]?.rows[0]?.provenance.method, "ARIA_ROW");
});

test("structural header row is excluded from data", async () => {
  const result = await observe(nativeTable({ values: ["A"] }));
  assert.equal(result.collections?.[0]?.rows.length, 1);
  assert.equal(result.collections?.[0]?.rows[0]?.cells[0]?.rawValue, "A");
});

test("arbitrary repeated divs are not rows or collections", async () => {
  const result = await observe(`<div aria-label="Records"><div>A</div><div>B</div></div>`);
  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.length, 0);
});

test("structural row sequence is preserved", async () => {
  const result = await observe(nativeTable({ values: ["C", "B", "A"] }));
  assert.deepEqual(result.collections?.[0]?.rows.map((row) => row.sequencePosition), [0, 1, 2]);
  assert.deepEqual(result.collections?.[0]?.rows.map((row) => row.cells[0]?.rawValue), ["C", "B", "A"]);
});

test("row sequence position is not reused as semantic rowId", async () => {
  const result = await observe(nativeTable());
  assert.equal(result.collections?.[0]?.rows[0]?.rowId, undefined);
  assert.equal(result.collections?.[0]?.rows[0]?.sequencePosition, 0);
});

test("explicit data-row-key provides stable row identity", async () => {
  const result = await observe(nativeTable({ rowAttributes: ['data-row-key="job-a"', 'data-row-key="job-b"'] }));
  assert.equal(result.collections?.[0]?.rows[0]?.rowIdentity?.method, "DATA_ROW_KEY");
  assert.equal(result.collections?.[0]?.rows[0]?.rowId, "DATA_ROW_KEY:job-a");
});

test("missing durable row identity is explicitly surfaced", async () => {
  const result = await observe(nativeTable());
  assert.equal(result.collections?.[0]?.rows[0]?.rowIdentityStatus, "UNAVAILABLE");
  assert.equal(result.collections?.[0]?.rows[0]?.rowIdentityReason, "ROW_IDENTITY_UNAVAILABLE");
});

test("same-observation ordering uses structural sequence without durable row IDs", async () => {
  const result = await observe(nativeTable());
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Records are descending.",
      direction: "DESC",
      comparisonType: "LEXICAL",
      collectionHint: "records",
      fieldHint: "name",
      ...authoritativeNameBinding(),
    },
    observation: result,
    visibleFieldProvenance: [{
      visibleLabel: "Name",
      sourceFields: ["name"],
      kind: "DIRECT",
      sourceRef: {
        file: "src/RecordsTable.tsx",
        line: 1,
      },
      authoritative: true,
      reason: "Synthetic direct accessor.",
    }],
  });
  assert.equal(evidence.status, "CONFIRMED");
  assert.equal(evidence.groundedRowIdentityCount, 0);
  assert.equal(evidence.rowSequenceObserved, true);
});

test("cell associates through stable visibleFieldId", async () => {
  const result = await observe(nativeTable());
  assert.equal(result.collections?.[0]?.rows[0]?.cells[0]?.visibleFieldId, result.collections?.[0]?.fields[0]?.visibleFieldId);
});

test("missing cell fails row structure grounding", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>A</th><th>B</th></tr><tr><td>one</td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "ROW_STRUCTURE_NOT_GROUNDED");
});

test("excess cell fails row structure grounding", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>A</th></tr><tr><td>one</td><td>two</td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "ROW_STRUCTURE_NOT_GROUNDED");
});

test("raw visible cell values are preserved", async () => {
  const result = await observe(nativeTable({ values: ["  3   days ago  "] }));
  assert.equal(result.collections?.[0]?.rows[0]?.cells[0]?.rawValue, "3 days ago");
});

test("observer does not parse date-looking values", async () => {
  const result = await observe(nativeTable({ values: ["2026-01-02"] }));
  assert.equal(typeof result.collections?.[0]?.rows[0]?.cells[0]?.rawValue, "string");
  assert.equal(result.collections?.[0]?.rows[0]?.cells[0]?.rawValue, "2026-01-02");
});

test("observer does not map visible Last updated to updatedAt", async () => {
  const result = await observe(nativeTable({ header: "Last updated" }));
  assert.equal(JSON.stringify(result.collections).includes("updatedAt"), false);
});

test("aria-busy table produces typed loading abstention", async () => {
  const result = await observe(`
    <table aria-label="Jobs" aria-busy="true"><tr><th>Name</th></tr><tr><td>A</td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_LOADING");
});

test("visible progressbar produces typed loading abstention", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>Name</th></tr><tr><td><span role="progressbar">Loading</span></td></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_LOADING");
});

test("visible Ant Design spinning state produces typed loading abstention", async () => {
  const result = await observe(`
    <div class="ant-spin-nested-loading">
      <div><div class="ant-spin-spinning">Loading</div></div>
      <table aria-label="Jobs">
        <tr><th>Name</th></tr>
        <tr><td>Reviewer</td></tr>
      </table>
    </div>
  `);
  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_LOADING");
});

test("unrelated Ant Design spinner does not suppress grounded collection", async () => {
  const result = await observe(`
    <div class="ant-spin-spinning">Loading another surface</div>
    <table aria-label="Jobs">
      <tr><th>Name</th></tr>
      <tr><td>Reviewer</td></tr>
    </table>
  `);
  assert.equal(result.collections?.length, 1);
  assert.equal(result.collectionAbstentions?.length, 0);
});

test("empty grounded table produces typed empty abstention", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>Name</th></tr></table>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_EMPTY");
});

test("explicit full-span empty result row produces typed empty abstention", async () => {
  const result = await observe(`
    <table aria-label="Jobs">
      <thead><tr><th>Name</th><th>Status</th></tr></thead>
      <tbody><tr><td colspan="2">No data</td></tr></tbody>
    </table>
  `);
  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_EMPTY");
  assert.equal(result.collectionAbstentions?.[0]?.detectedRowCount, 0);
});

test("full-span loading or error rows are not accepted as empty results", async () => {
  for (const text of ["Loading", "Unable to load data"]) {
    const result = await observe(`
      <table aria-label="Jobs">
        <thead><tr><th>Name</th><th>Status</th></tr></thead>
        <tbody><tr><td colspan="2">${text}</td></tr></tbody>
      </table>
    `);
    assert.equal(result.collections?.length, 0);
    assert.equal(
      result.collectionAbstentions?.[0]?.reason,
      "ROW_STRUCTURE_NOT_GROUNDED"
    );
  }
});

test("labelled tabpanel is an explicit structural collection identity", async () => {
  const result = await observe(`
    <button role="tab" id="tab-jobs">Jobs</button>
    <div role="tabpanel" aria-labelledby="tab-jobs">${nativeTable({ identity: "", identityKind: "aria-label" }).replace('aria-label=""', '')}</div>
  `);
  assert.equal(result.collections?.[0]?.identity.method, "STRUCTURAL_HEADING_RELATION");
  assert.equal(result.collections?.[0]?.identity.sourceText, "Jobs");
});

test("competing labelled semantic ancestors fail safe", async () => {
  const result = await observe(`
    <div role="region" aria-label="Outer"><section aria-label="Inner">${nativeTable({ identity: "", identityKind: "aria-label" }).replace('aria-label=""', '')}</section></div>
  `);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "COLLECTION_AMBIGUOUS");
});

test("duplicate explicit row identities become unavailable", async () => {
  const result = await observe(nativeTable({ rowAttributes: ['data-row-key="same"', 'data-row-key="same"'] }));
  assert.deepEqual(result.collections?.[0]?.rows.map((row) => row.rowIdentityStatus), ["UNAVAILABLE", "UNAVAILABLE"]);
});

test("ARIA row name provides durable row identity", async () => {
  const result = await observe(`
    <div role="table" aria-label="Records"><div role="row"><span role="columnheader">Name</span></div><div role="row" aria-label="Record A"><span role="cell">A</span></div></div>
  `);
  assert.equal(result.collections?.[0]?.rows[0]?.rowIdentity?.method, "ARIA_NAME");
});

test("ARIA row labelledby provides durable row identity", async () => {
  const result = await observe(`
    <span id="row-a">Record A</span><div role="table" aria-label="Records"><div role="row"><span role="columnheader">Name</span></div><div role="row" aria-labelledby="row-a"><span role="cell">A</span></div></div>
  `);
  assert.equal(result.collections?.[0]?.rows[0]?.rowIdentity?.method, "ARIA_LABELLEDBY");
});

test("output is deterministic for identical table markup", async () => {
  const first = await observe(nativeTable());
  const second = await observe(nativeTable());
  assert.deepEqual(first.collections, second.collections);
});

test("collection grounding does not use nth selectors", () => {
  assert.doesNotMatch(collectionObserverSource, /nth-(?:child|of-type)/i);
});

test("collection grounding does not read coordinates", () => {
  assert.doesNotMatch(collectionObserverSource, /getBoundingClientRect|offset(?:Top|Left)|client[XY]/);
});

test("collection grounding does not calculate pixel distance", () => {
  assert.doesNotMatch(collectionObserverSource, /Math\.(?:hypot|sqrt)|euclidean|pixelDistance/i);
});

test("collection grounding does not query headings as proximity labels", () => {
  assert.doesNotMatch(collectionObserverSource, /querySelector(?:All)?\([^)]*["'][^"']*h[1-6]/i);
});

test("collection grounding does not walk sibling proximity", () => {
  assert.doesNotMatch(collectionObserverSource, /previousElementSibling|nextElementSibling/);
});

test("collection grounding has no screenshot or OCR fallback", () => {
  assert.doesNotMatch(collectionObserverSource, /screenshot|optical character|\bOCR\b/i);
});

test("collection grounding has no LLM semantic fallback", () => {
  assert.doesNotMatch(collectionObserverSource, /openai|anthropic|languageModel|\bLLM\b/i);
});

test("row observation limit is enforced and disclosed", async () => {
  const result = await observe(nativeTable({ values: ["E", "D", "C", "B", "A"] }), { maxCollectionRows: 2 });
  assert.equal(result.collections?.[0]?.rows.length, 2);
  assert.equal(result.collections?.[0]?.provenance.rowsTruncated, true);
});

test("field observation limit fails safe instead of truncating schema", async () => {
  const result = await observe(`
    <table aria-label="Jobs"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
  `, { maxCollectionFields: 1 });
  assert.equal(result.collectionAbstentions?.[0]?.reason, "SCHEMA_NOT_GROUNDED");
});

test("cell text bound is enforced", async () => {
  const result = await observe(nativeTable({ values: ["x".repeat(100)] }), { maxTextLength: 40 });
  assert.equal(result.collections?.[0]?.rows[0]?.cells[0]?.rawValue.length, 40);
});

test("total collection bound is enforced", async () => {
  const result = await observe(nativeTable({ identity: "One" }) + nativeTable({ identity: "Two" }), { maxCollections: 1 });
  assert.equal((result.collections?.length ?? 0) + (result.collectionAbstentions?.length ?? 0), 1);
});
