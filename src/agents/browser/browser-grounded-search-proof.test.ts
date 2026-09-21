import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";

import type {
  BrowserCollectionFilterProbe,
  BrowserCollectionFilterRequirement,
  BrowserTestCase,
  PlannerAcceptanceSourceLedger,
} from "../../planner/types.js";
import {
  getBrowserManualAcceptanceCoverageGapReason,
} from "./browser-result-reconciliation.js";
import {
  observeBrowserPage,
  type BrowserObservation,
  type BrowserObservedCollection,
} from "./browser-observation.js";
import {
  buildCollectionFilterRequirements,
  evaluateCollectionFilterProbe,
  executeGroundedCollectionFilterRequirement,
  executeGroundedSearchFilterCapability,
  findGroundedSearchControlCandidate,
  selectOperationalSearchSurface,
  selectSafeRuntimeSearchQuery,
  selectGroundedFilterCollection,
  snapshotGroundedFilterCollection,
  summarizeSearchFilterCapability,
  toSearchFilterCapabilityEvaluation,
} from "./browser-grounded-search-proof.js";
import {
  installProductNonGetGuard,
} from "./browser-local-state-transition-proof.js";

const manualChecks = [
  "Verify that a search input is present on the Payments page.",
  "Using a compatible runtime invoice listed on the Payments page, enter its exact numeric invoice ID and verify that the matching invoice is located.",
  "Using the same compatible runtime invoice, enter its exact invoice number and verify that the matching invoice is located.",
  "Enter a nonmatching search term and verify that no matching invoice is shown.",
];

const sourceLedger: PlannerAcceptanceSourceLedger = {
  sourceStatus: "RESOLVED",
  basis: "SUMMARY_DESCRIPTION_FALLBACK",
  sourceUnits: [
    {
      id: "search-source",
      sourceKind: "DESCRIPTION",
      sourceRef: "jira.description",
      text: "As payment volume grows, we need a general search input for quickly locating invoices.",
    },
    {
      id: "identity-source",
      sourceKind: "DESCRIPTION",
      sourceRef: "jira.description",
      text: "For example, if a user knows an invoice number/ID, they still need to manually scan the table.",
    },
  ],
};

function browserCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  return {
    id: "web-search",
    persona: "company_admin",
    goal: "Search invoices.",
    startRoute: "/payments",
    successCriteria: "Search by invoice ID or invoice number and show no result for a nonmatching query.",
    manualChecks,
    steps: [{ action: "assertTextVisible", text: "Payments" }],
    ...overrides,
  };
}

function requirement(
  overrides: Partial<BrowserCollectionFilterRequirement> = {}
): BrowserCollectionFilterRequirement {
  return {
    kind: "COLLECTION_FILTER",
    requirementId: "filter-1",
    sourceClaim: "Search by invoice number/ID.",
    interactionKind: "TEXT_SEARCH",
    collectionHint: "invoice",
    controlSemantic: "SEARCH",
    authority: "AUTHORITATIVE",
    sourceRef: "jira.description#identity-source",
    probes: [],
    ...overrides,
  };
}

function probe(
  overrides: Partial<BrowserCollectionFilterProbe> = {}
): BrowserCollectionFilterProbe {
  return {
    probeId: "probe-1",
    querySource: "RUNTIME_VISIBLE_FIELD",
    predicate: "CASE_INSENSITIVE_CONTAINS",
    fieldScope: {
      kind: "VISIBLE_FIELD",
      visibleLabel: "Invoice Number",
      proofFieldBinding: {
        bindingId: "binding-1",
        requirementId: "filter-1",
        proposedField: "Invoice Number",
        proposalSource: "AC_EXPLICIT",
        authority: "AUTHORITATIVE",
        sourceRef: "jira.description#identity-source",
      },
    },
    expectation: "MATCHING_ROW_INCLUDED",
    manualCheck: manualChecks[2]!,
    ...overrides,
  };
}

function collection(
  rows: Array<{ id?: string; number: string; email?: string; title?: string }>,
  overrides: Partial<BrowserObservedCollection> = {}
): BrowserObservedCollection {
  const collectionId = overrides.collectionId ?? "collection:table:aria_name:invoices";
  const labels = ["Invoice Number", "Talent Email", "Job Title"];
  const fields = labels.map((visibleLabel) => ({
    visibleLabel,
    visibleFieldId: `${collectionId}:field:${visibleLabel.toLowerCase().replace(/\s+/g, "-")}`,
    provenance: { method: "NATIVE_TH" as const, sourceText: visibleLabel },
  }));
  return {
    collectionId,
    shape: "TABLE",
    label: "Invoices",
    identity: { method: "ARIA_NAME", sourceText: "Invoices" },
    fields,
    rows: rows.map((row, sequencePosition) => ({
      sequencePosition,
      rowSequenceObserved: true,
      ...(row.id ? {
        rowId: `DATA_ROW_KEY:${row.id}`,
        rowIdentity: { method: "DATA_ROW_KEY" as const, sourceText: row.id },
        rowIdentityStatus: "GROUNDED" as const,
      } : {
        rowIdentityStatus: "UNAVAILABLE" as const,
        rowIdentityReason: "ROW_IDENTITY_UNAVAILABLE" as const,
      }),
      cells: [row.number, row.email ?? "", row.title ?? ""].map((rawValue, index) => ({
        visibleFieldId: fields[index]!.visibleFieldId,
        rawValue,
        provenance: { method: "NATIVE_TD" as const },
      })),
      provenance: { method: "NATIVE_TR" as const },
    })),
    provenance: { method: "NATIVE_TABLE", rowSequenceObserved: true, rowsTruncated: false },
    ...overrides,
  };
}

function observation(args: {
  collections?: BrowserObservedCollection[];
  inputs?: BrowserObservation["inputs"];
} = {}): BrowserObservation {
  return {
    url: "https://example.test/payments",
    title: "Payments",
    headings: [], controls: [], surfaces: [], visibleText: [],
    inputs: args.inputs ?? [],
    collections: args.collections ?? [],
    counts: {
      headings: 0, controls: 0, inputs: args.inputs?.length ?? 0,
      surfaces: 0, collections: args.collections?.length ?? 0, visibleText: 0,
    },
  };
}

function reasonOf(value: unknown): string | undefined {
  return value && typeof value === "object" && "reason" in value
    ? String((value as { reason?: unknown }).reason ?? "")
    : undefined;
}

const pre = collection([
  { id: "10", number: "INV-Alpha", email: "one@example.test", title: "Reviewer" },
  { id: "20", number: "INV-Beta", email: "two@example.test", title: "Engineer" },
  { id: "30", number: "Acme-30", email: "acme@example.test", title: "Designer" },
]);

function evaluate(args: {
  activeProbe?: BrowserCollectionFilterProbe;
  post?: BrowserObservedCollection;
  query?: string;
  targetRowId?: string;
  settlementVerified?: boolean;
  activeRequirement?: BrowserCollectionFilterRequirement;
}) {
  return evaluateCollectionFilterProbe({
    requirement: args.activeRequirement ?? requirement(),
    probe: args.activeProbe ?? probe(),
    preCollection: pre,
    postState: { kind: "COLLECTION", collection: args.post ?? collection([{ id: "10", number: "INV-Alpha" }]) },
    query: args.query ?? "inv-alpha",
    targetRowId: args.targetRowId ?? "DATA_ROW_KEY:10",
    settlementVerified: args.settlementVerified ?? true,
  });
}

// A. Requirement and authority.
test("authoritative legacy search contract builds one structured requirement", () => {
  assert.equal(buildCollectionFilterRequirements({ testCase: browserCase(), acceptanceSourceLedger: sourceLedger }).length, 1);
});
test("global nonmatching probe stays GLOBAL_VISIBLE_FIELDS", () => {
  const built = buildCollectionFilterRequirements({ testCase: browserCase(), acceptanceSourceLedger: sourceLedger })[0]!;
  assert.equal(built.probes[2]?.fieldScope.kind, "GLOBAL_VISIBLE_FIELDS");
});
test("unresolved source authority rejects requirement", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase(),
    acceptanceSourceLedger: { ...sourceLedger, sourceStatus: "UNAVAILABLE", basis: "SOURCE_UNAVAILABLE" },
  }), []);
});
test("implementation-only search wording cannot create requirement", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase(),
    acceptanceSourceLedger: { ...sourceLedger, sourceUnits: [] },
  }), []);
});
test("missing numeric ID check keeps requirement ambiguous", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase({ manualChecks: manualChecks.filter((_, index) => index !== 1) }),
    acceptanceSourceLedger: sourceLedger,
  }), []);
});
test("missing invoice-number check keeps requirement ambiguous", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase({ manualChecks: manualChecks.filter((_, index) => index !== 2) }),
    acceptanceSourceLedger: sourceLedger,
  }), []);
});
test("missing nonmatching check does not invent empty semantics", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase({ manualChecks: manualChecks.slice(0, 3) }),
    acceptanceSourceLedger: sourceLedger,
  }), []);
});
test("missing control check does not invent control semantics", () => {
  assert.deepEqual(buildCollectionFilterRequirements({
    testCase: browserCase({ manualChecks: manualChecks.slice(1) }),
    acceptanceSourceLedger: sourceLedger,
  }), []);
});
test("stable requirement IDs do not depend on planner prose spacing", () => {
  const first = buildCollectionFilterRequirements({ testCase: browserCase(), acceptanceSourceLedger: sourceLedger })[0]!;
  const second = buildCollectionFilterRequirements({
    testCase: browserCase({ manualChecks: manualChecks.map((item) => `  ${item}  `) }),
    acceptanceSourceLedger: sourceLedger,
  })[0]!;
  assert.equal(first.requirementId, second.requirementId);
});

// B. Search-control grounding from bounded observation.
const searchInput = {
  label: "Search by invoice #, talent email, or job title",
  placeholder: "Search by invoice #, talent email, or job title",
  role: "textbox", type: "search", disabled: false, activationSafe: false,
  expanded: null, required: false, hasValue: false,
};
test("one exact visible search input grounds", () => {
  assert.deepEqual(findGroundedSearchControlCandidate(observation({ inputs: [searchInput] })), {
    label: searchInput.label, role: "textbox",
  });
});
test("duplicate equivalent search inputs abstain", () => {
  assert.equal("reason" in findGroundedSearchControlCandidate(observation({ inputs: [searchInput, searchInput] })), true);
});
test("background input excluded by observation cannot become candidate", () => {
  assert.equal(reasonOf(findGroundedSearchControlCandidate(observation())), "SEARCH_CONTROL_NOT_GROUNDED");
});
test("unrelated project search remains bounded but eligible only as generic search candidate", () => {
  const result = findGroundedSearchControlCandidate(observation({ inputs: [{ ...searchInput, label: "Search project", placeholder: "Search project" }] }));
  assert.equal("label" in result && result.label, "Search project");
});
test("non-search textbox is rejected", () => {
  assert.equal(reasonOf(findGroundedSearchControlCandidate(observation({ inputs: [{ ...searchInput, label: "Invoice", placeholder: "Invoice" }] }))), "SEARCH_CONTROL_NOT_GROUNDED");
});
test("disabled search textbox is rejected", () => {
  assert.equal(reasonOf(findGroundedSearchControlCandidate(observation({ inputs: [{ ...searchInput, disabled: true }] }))), "SEARCH_CONTROL_NOT_GROUNDED");
});
test("combobox labelled search is not silently treated as text search", () => {
  assert.equal(reasonOf(findGroundedSearchControlCandidate(observation({ inputs: [{ ...searchInput, role: "combobox" }] }))), "SEARCH_CONTROL_NOT_GROUNDED");
});
test("model proposal metadata is absent from grounded control result", () => {
  assert.equal("proposal" in findGroundedSearchControlCandidate(observation({ inputs: [searchInput] })), false);
});

test("one Search control and one collection form one operational association", () => {
  const selected = selectOperationalSearchSurface(observation({
    inputs: [searchInput],
    collections: [pre],
  }));
  assert.equal("collection" in selected, true);
  assert.equal(
    "collection" in selected
      ? selected.associationMethod
      : "",
    "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE"
  );
});

test("operational association abstains on duplicate Search controls", () => {
  assert.equal(
    reasonOf(selectOperationalSearchSurface(observation({
      inputs: [searchInput, searchInput],
      collections: [pre],
    }))),
    "CONTROL_AMBIGUOUS"
  );
});

test("operational association abstains on multiple grounded collections", () => {
  assert.equal(
    reasonOf(selectOperationalSearchSurface(observation({
      inputs: [searchInput],
      collections: [pre, {
        ...pre,
        collectionId: "collection:table:aria_name:other",
      }],
    }))),
    "COLLECTION_AMBIGUOUS"
  );
});

test("runtime query derives from all visible rows without row-order identity", () => {
  const first = selectSafeRuntimeSearchQuery(pre);
  const reordered = selectSafeRuntimeSearchQuery({
    ...pre,
    rows: [...pre.rows].reverse(),
  });
  assert.equal("query" in first, true);
  assert.deepEqual(reordered, first);
});

test("one-row collection cannot supply a meaningful operational query", () => {
  assert.deepEqual(
    selectSafeRuntimeSearchQuery(collection([
      { id: "10", number: "INV-Alpha" },
    ])),
    { reason: "QUERY_NOT_SAFE" }
  );
});

// C. Grounded collection selection and snapshots.
test("one matching grounded collection is selected", () => {
  assert.equal("collection" in selectGroundedFilterCollection({ observation: observation({ collections: [pre] }), requirement: requirement() }), true);
});
test("different semantic collection is rejected", () => {
  const jobs = collection([{ id: "1", number: "A" }], { label: "Jobs", identity: { method: "ARIA_NAME", sourceText: "Jobs" }, fields: [] });
  assert.equal(reasonOf(selectGroundedFilterCollection({ observation: observation({ collections: [jobs] }), requirement: requirement() })), "COLLECTION_NOT_GROUNDED");
});
test("two matching grounded collections abstain", () => {
  assert.equal(reasonOf(selectGroundedFilterCollection({ observation: observation({ collections: [pre, { ...pre }] }), requirement: requirement() })), "COLLECTION_AMBIGUOUS");
});
test("snapshot preserves durable row IDs", () => {
  assert.deepEqual(snapshotGroundedFilterCollection(pre).rowIds, ["DATA_ROW_KEY:10", "DATA_ROW_KEY:20", "DATA_ROW_KEY:30"]);
});
test("snapshot never promotes sequence positions to identity", () => {
  const snap = snapshotGroundedFilterCollection(collection([{ number: "A" }]));
  assert.deepEqual(snap.rowIds, []);
});
test("snapshot preserves bounded row count", () => {
  assert.equal(snapshotGroundedFilterCollection(pre).rowCount, 3);
});
test("snapshot preserves truncation disclosure", () => {
  assert.equal(snapshotGroundedFilterCollection({ ...pre, provenance: { ...pre.provenance, rowsTruncated: true } }).rowsTruncated, true);
});
test("snapshot preserves grounded visible labels only", () => {
  assert.deepEqual(snapshotGroundedFilterCollection(pre).visibleFields, ["Invoice Number", "Talent Email", "Job Title"]);
});

// D. Predicate behavior.
test("exact durable row ID predicate confirms exact text", () => {
  const idProbe = probe({ querySource: "RUNTIME_ROW_ID", predicate: "EXACT_TEXT", fieldScope: { kind: "DURABLE_ROW_ID", authority: "AUTHORITATIVE" } });
  assert.equal(evaluate({ activeProbe: idProbe, query: "10" }).status, "CONFIRMED");
});
test("exact predicate rejects a prefix", () => {
  const idProbe = probe({ querySource: "RUNTIME_ROW_ID", predicate: "EXACT_TEXT", fieldScope: { kind: "DURABLE_ROW_ID", authority: "AUTHORITATIVE" } });
  assert.equal(evaluate({ activeProbe: idProbe, query: "1" }).status, "CONTRADICTED");
});
test("case-insensitive contains matches invoice number", () => {
  assert.equal(evaluate({ query: "INV-ALPHA" }).status, "CONFIRMED");
});
test("case-insensitive contains handles Unicode normalization", () => {
  const post = collection([{ id: "10", number: "Cafe\u0301" }]);
  assert.equal(evaluate({ post, query: "CAFÉ" }).status, "CONFIRMED");
});
test("global fields match any eligible grounded cell", () => {
  const globalProbe = probe({ fieldScope: { kind: "GLOBAL_VISIBLE_FIELDS", authority: "AUTHORITATIVE" } });
  const post = collection([{ id: "10", number: "x", email: "Acme@Example.test" }]);
  assert.equal(evaluate({ activeProbe: globalProbe, post, query: "acme" }).status, "CONFIRMED");
});
test("global fields do not inspect arbitrary row innerText", () => {
  const globalProbe = probe({ fieldScope: { kind: "GLOBAL_VISIBLE_FIELDS", authority: "AUTHORITATIVE" } });
  assert.equal(evaluate({ activeProbe: globalProbe, query: "not-in-cells" }).status, "CONTRADICTED");
});
test("candidate-only global field authority abstains", () => {
  const globalProbe = probe({ fieldScope: { kind: "GLOBAL_VISIBLE_FIELDS", authority: "CANDIDATE" } });
  assert.equal(evaluate({ activeProbe: globalProbe }).status, "UNAVAILABLE");
});
test("candidate-only visible field binding abstains", () => {
  const fieldProbe = probe();
  if (fieldProbe.fieldScope.kind === "VISIBLE_FIELD") fieldProbe.fieldScope.proofFieldBinding.authority = "CANDIDATE";
  assert.equal(evaluate({ activeProbe: fieldProbe }).status, "UNAVAILABLE");
});
test("implementation-derived visible field cannot grant acceptance authority", () => {
  const fieldProbe = probe();
  if (fieldProbe.fieldScope.kind === "VISIBLE_FIELD") fieldProbe.fieldScope.proofFieldBinding.proposalSource = "IMPLEMENTATION_DERIVED";
  assert.equal(evaluate({ activeProbe: fieldProbe }).status, "UNAVAILABLE");
});
test("missing visible field abstains", () => {
  const fieldProbe = probe();
  if (fieldProbe.fieldScope.kind === "VISIBLE_FIELD") fieldProbe.fieldScope.visibleLabel = "Missing";
  assert.equal(evaluate({ activeProbe: fieldProbe }).reason, "FIELD_NOT_GROUNDED");
});

// E/F. Confirmation and contradiction by membership.
test("all matching post rows confirm no-false-positive property", () => {
  assert.equal(evaluate({ post: collection([{ id: "10", number: "INV-Alpha" }]) }).passed, true);
});
test("matching subset confirms without claiming unseen completeness", () => {
  const result = evaluate({ post: collection([{ id: "10", number: "INV-Alpha" }]) });
  assert.equal(result.status, "CONFIRMED");
  assert.equal("complete" in result, false);
});
test("row ordering change does not contradict filtering", () => {
  const globalProbe = probe({ fieldScope: { kind: "GLOBAL_VISIBLE_FIELDS", authority: "AUTHORITATIVE" } });
  const post = collection([{ id: "30", number: "Acme-30" }, { id: "10", number: "Acme-10" }]);
  assert.equal(evaluate({ activeProbe: globalProbe, post, query: "acme", targetRowId: "DATA_ROW_KEY:10" }).status, "CONFIRMED");
});
test("stable durable identity correlates target membership", () => {
  assert.equal(evaluate({ targetRowId: "DATA_ROW_KEY:10" }).targetRowId, "DATA_ROW_KEY:10");
});
test("one visible nonmatching post row contradicts", () => {
  const post = collection([{ id: "10", number: "INV-Alpha" }, { id: "20", number: "INV-Beta" }]);
  assert.equal(evaluate({ post }).status, "CONTRADICTED");
});
test("wrong authoritative field contradicts even when another cell matches", () => {
  const post = collection([{ id: "10", number: "wrong", email: "inv-alpha@example.test" }]);
  assert.equal(evaluate({ post }).status, "CONTRADICTED");
});
test("missing target row contradicts matching visible rows", () => {
  const post = collection([{ id: "20", number: "INV-Alpha" }]);
  assert.equal(evaluate({ post }).status, "CONTRADICTED");
});
test("changed state cannot override predicate violation", () => {
  assert.equal(evaluate({ post: collection([{ id: "10", number: "wrong" }]) }).passed, false);
});
test("count decrease alone cannot confirm", () => {
  assert.equal(evaluate({ post: collection([{ id: "10", number: "wrong" }]) }).status, "CONTRADICTED");
});
test("zero rows confirms only explicit empty expectation", () => {
  const emptyProbe = probe({ expectation: "EMPTY_FILTER_RESULT" });
  const result = evaluateCollectionFilterProbe({
    requirement: requirement(), probe: emptyProbe, preCollection: pre,
    postState: { kind: "EMPTY", abstention: { shape: "TABLE", reason: "COLLECTION_EMPTY", identity: pre.identity, visibleSchemaLabels: [], detectedRowCount: 0, note: "empty" } },
    query: "qa-none", settlementVerified: true,
  });
  assert.equal(result.status, "CONFIRMED");
});
test("empty post contradicts a required matching row", () => {
  const result = evaluateCollectionFilterProbe({
    requirement: requirement(), probe: probe(), preCollection: pre,
    postState: { kind: "EMPTY", abstention: { shape: "TABLE", reason: "COLLECTION_EMPTY", identity: pre.identity, visibleSchemaLabels: [], detectedRowCount: 0, note: "empty" } },
    query: "inv-alpha", targetRowId: "DATA_ROW_KEY:10", settlementVerified: true,
  });
  assert.equal(result.status, "CONTRADICTED");
});

// G/H. Abstention and trust boundaries.
test("unverified settlement abstains", () => {
  assert.equal(evaluate({ settlementVerified: false }).reason, "SEARCH_SETTLEMENT_UNVERIFIED");
});
test("different post collection abstains", () => {
  const post = collection([{ id: "10", number: "INV-Alpha" }], { collectionId: "other" });
  assert.equal(evaluate({ post }).reason, "COLLECTION_CHANGED");
});
test("missing post row identity abstains", () => {
  assert.equal(evaluate({ post: collection([{ number: "INV-Alpha" }]) }).reason, "ROW_IDENTITY_UNAVAILABLE");
});
test("candidate-only requirement authority abstains", () => {
  assert.equal(evaluate({ activeRequirement: requirement({ authority: "CANDIDATE" }) }).reason, "SEARCH_REQUIREMENT_NOT_AUTHORITATIVE");
});
test("fixture readiness is not an evaluator input", () => {
  assert.equal("fixture" in evaluate({}), false);
});
test("route success is not an evaluator input", () => {
  assert.equal("route" in evaluate({}), false);
});
test("generic execution status is not an evaluator input", () => {
  assert.equal("executed" in evaluate({}), false);
});
test("stateChanged is not an evaluator input", () => {
  assert.equal("stateChanged" in evaluate({}), false);
});
test("screenshots are not an evaluator input", () => {
  assert.equal("screenshot" in evaluate({}), false);
});
test("LLM output is not an evaluator input", () => {
  assert.equal("model" in evaluate({}), false);
});
test("evidence review cannot alter deterministic contradiction", () => {
  const result = evaluate({ post: collection([{ id: "10", number: "wrong" }]) });
  assert.equal(result.status, "CONTRADICTED");
});
test("production requirement derivation contains no issue key", () => {
  const serialized = JSON.stringify(buildCollectionFilterRequirements({ testCase: browserCase(), acceptanceSourceLedger: sourceLedger }));
  assert.doesNotMatch(serialized, /AS-1344|web-1|web-2/);
});

// I. Manual-completeness reconciliation boundary.
test("confirmed proof covers only exact declared manual checks", () => {
  const result = {
    collectionFilterEvidence: [{
      kind: "COLLECTION_FILTER", status: "CONFIRMED", proofReady: true,
      coveredManualChecks: manualChecks,
    }],
  };
  assert.equal(getBrowserManualAcceptanceCoverageGapReason(browserCase(), result), null);
});
test("unproved unrelated manual obligation remains guarded", () => {
  const extra = "Verify an unrelated export behavior.";
  const result = {
    collectionFilterEvidence: [{
      kind: "COLLECTION_FILTER", status: "CONFIRMED", proofReady: true,
      coveredManualChecks: manualChecks,
    }],
  };
  assert.match(getBrowserManualAcceptanceCoverageGapReason(browserCase({ manualChecks: [...manualChecks, extra] }), result)!, /1 acceptance check remains/);
});
test("contradicted evidence cannot cover manual checks", () => {
  const result = { collectionFilterEvidence: [{ kind: "COLLECTION_FILTER", status: "CONTRADICTED", proofReady: true, coveredManualChecks: manualChecks }] };
  assert.match(getBrowserManualAcceptanceCoverageGapReason(browserCase(), result)!, /4 acceptance checks remain/);
});
test("unavailable evidence cannot cover manual checks", () => {
  const result = { collectionFilterEvidence: [{ kind: "COLLECTION_FILTER", status: "UNAVAILABLE", proofReady: false, coveredManualChecks: manualChecks }] };
  assert.match(getBrowserManualAcceptanceCoverageGapReason(browserCase(), result)!, /4 acceptance checks remain/);
});
test("partial confirmed coverage keeps exact remainder", () => {
  const result = { collectionFilterEvidence: [{ kind: "COLLECTION_FILTER", status: "CONFIRMED", proofReady: true, coveredManualChecks: manualChecks.slice(0, 2) }] };
  assert.match(getBrowserManualAcceptanceCoverageGapReason(browserCase(), result)!, /2 acceptance checks remain/);
});
test("oracle evidence alone does not manufacture unrelated PASS metadata", () => {
  const result = { collectionFilterEvidence: [{ kind: "COLLECTION_FILTER", status: "CONFIRMED", proofReady: true, coveredManualChecks: manualChecks }] };
  getBrowserManualAcceptanceCoverageGapReason(browserCase(), result);
  assert.equal("status" in result, false);
});

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser.close(); });

test("local end-to-end proof grounds, types, settles, and confirms three probes", async () => {
  const page = await browser.newPage();
  try {
    await page.route("https://search.test/filter**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "{}",
      });
    });
    await page.setContent(`
      <label>Search invoices <input type="search" placeholder="Search by invoice #, talent email, or job title"></label>
      <h2 id="invoice-table-label">Invoices</h2>
      <div class="ant-spin-nested-loading">
        <div><div class="loading-indicator">Loading</div></div>
        <table aria-labelledby="invoice-table-label">
          <thead><tr><th>Invoice Number</th><th>Talent Email</th><th>Job Title</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <script>
        const rows = [
          { id: '10', number: 'INV-Alpha', email: 'one@example.test', title: 'Reviewer' },
          { id: '20', number: 'INV-Beta', email: 'two@example.test', title: 'Engineer' },
          { id: '30', number: 'Acme-30', email: 'acme@example.test', title: 'Designer' },
        ];
        const tbody = document.querySelector('tbody');
        const input = document.querySelector('input');
        const render = (query = '') => {
          const folded = query.trim().toLowerCase();
          const filtered = !folded ? rows : rows.filter((row) =>
            (/^\\d+$/.test(folded) && row.id === folded) ||
            [row.number, row.email, row.title].some((value) => value.toLowerCase().includes(folded))
          );
          tbody.innerHTML = filtered.map((row) =>
            '<tr data-row-key="' + row.id + '"><td>' + row.number + '</td><td>' + row.email + '</td><td>' + row.title + '</td></tr>'
          ).join('');
        };
        let timer;
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            document.querySelector('.loading-indicator').className = 'loading-indicator ant-spin-spinning';
            tbody.innerHTML = '<tr><td colspan="3">No data</td></tr>';
            const query = input.value;
            await fetch(
              'https://search.test/filter?searchText=' +
              encodeURIComponent(query)
            );
            render(query);
            document.querySelector('.loading-indicator').className = 'loading-indicator';
          }, 320);
        });
        render();
      </script>
    `);
    const built = buildCollectionFilterRequirements({ testCase: browserCase(), acceptanceSourceLedger: sourceLedger })[0]!;
    const result = await executeGroundedCollectionFilterRequirement({ page, requirement: built });
    assert.equal(result.evidence.status, "CONFIRMED");
    assert.equal(result.evidence.proofReady, true);
    assert.equal(result.evidence.probes.length, 3);
    assert.equal(result.deterministicEvidence.length, 3);
    assert.equal(result.stateChanged, true);
    assert.equal(result.evidence.coveredManualChecks.length, 4);
  } finally {
    await page.close();
  }
});

test("multiple active dialogs fail safe in the observer before control execution", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <div role="dialog"><input placeholder="Search one"></div>
      <div role="dialog"><input placeholder="Search two"></div>
    `);
    const observed = await observeBrowserPage(page);
    assert.equal(observed.inputs.length, 0);
    assert.equal(reasonOf(findGroundedSearchControlCandidate(observed)), "SEARCH_CONTROL_NOT_GROUNDED");
  } finally {
    await page.close();
  }
});

async function operationalPage(
  behavior: "FILTER_AND_RESTORE" | "NO_CHANGE" | "UNSETTLED" | "RESTORE_FAIL" | "NON_GET",
  routePath = "/records"
) {
  const page = await browser.newPage();
  const html = `
    <label>Search records <input type="search" placeholder="Search records"></label>
    <table aria-label="Records">
      <thead><tr><th>Name</th><th>Category</th></tr></thead>
      <tbody></tbody>
    </table>
    <script>
      const rows = [
        { id: '1', name: 'Alpha record', category: 'First group' },
        { id: '2', name: 'Beta record', category: 'Second group' },
        { id: '3', name: 'Gamma record', category: 'Third group' },
      ];
      const tbody = document.querySelector('tbody');
      const input = document.querySelector('input');
      let filtered = false;
      let ticker;
      const render = (items) => {
        tbody.innerHTML = items.map((row) =>
          '<tr data-row-key="' + row.id + '"><td>' + row.name + '</td><td>' + row.category + '</td></tr>'
        ).join('');
      };
      input.addEventListener('input', () => {
        const value = input.value.toLowerCase();
        if (${JSON.stringify(behavior)} === 'NO_CHANGE') return;
        if (${JSON.stringify(behavior)} === 'NON_GET') {
          fetch('/search', { method: 'POST', body: value }).catch(() => {});
        }
        if (${JSON.stringify(behavior)} === 'UNSETTLED' && value) {
          clearInterval(ticker);
          let counter = 0;
          ticker = setInterval(() => {
            counter += 1;
            render([{ id: String(counter), name: 'Changing ' + counter, category: 'Live' }]);
          }, 1);
          return;
        }
        clearInterval(ticker);
        if (!value) {
          if (${JSON.stringify(behavior)} !== 'RESTORE_FAIL' || !filtered) render(rows);
          return;
        }
        filtered = true;
        render(rows.filter((row) =>
          [row.name, row.category].some((item) => item.toLowerCase().includes(value))
        ));
      });
      render(rows);
    </script>
  `;
  await page.route("https://capability.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: html,
    });
  });
  await page.goto(`https://capability.test${routePath}`);
  const guard = await installProductNonGetGuard(
    page,
    "https://capability.test"
  );
  return { page, guard };
}

test("operational capability changes, settles, and exactly restores without proof", async () => {
  const { page, guard } = await operationalPage("FILTER_AND_RESTORE");
  try {
    const result = await executeGroundedSearchFilterCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls: 12, pollMs: 20 },
    });
    assert.equal(result.status, "EXECUTED_VERIFIED");
    assert.equal(result.stateChanged, true);
    assert.equal(result.settled, true);
    assert.equal(result.restoration.restored, true);
    assert.equal(result.transportSafety.safe, true);
    assert.equal(result.acceptanceProof.attempted, false);
    assert.equal("deterministicEvidence" in result, false);
    assert.equal("verdict" in result, false);
    assert.equal("screenshot" in result, false);
  } finally {
    await guard.stop();
    await page.close();
  }
});

test("input-only success cannot satisfy operational state change", async () => {
  const { page, guard } = await operationalPage("NO_CHANGE");
  try {
    const result = await executeGroundedSearchFilterCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls: 4, pollMs: 10 },
    });
    assert.equal(result.status, "ABSTAINED");
    assert.equal(result.reason, "STATE_DID_NOT_CHANGE");
    assert.equal(result.restoration.restored, true);
  } finally {
    await guard.stop();
    await page.close();
  }
});

test("changed but continuously moving collection does not count as settled", async () => {
  const { page, guard } = await operationalPage("UNSETTLED");
  try {
    const result = await executeGroundedSearchFilterCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls: 8, pollMs: 10 },
    });
    assert.equal(result.status, "ABSTAINED");
    assert.equal(result.reason, "STATE_DID_NOT_SETTLE");
  } finally {
    await guard.stop();
    await page.close();
  }
});

test("failed exact restoration prevents operational success", async () => {
  const { page, guard } = await operationalPage("RESTORE_FAIL");
  try {
    const result = await executeGroundedSearchFilterCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls: 6, pollMs: 10 },
    });
    assert.equal(result.status, "ABSTAINED");
    assert.equal(result.reason, "RESTORATION_FAILED");
    assert.equal(result.restoration.restored, false);
  } finally {
    await guard.stop();
    await page.close();
  }
});

test("product non-GET attempt is blocked and invalidates operational success", async () => {
  const { page, guard } = await operationalPage("NON_GET");
  try {
    const result = await executeGroundedSearchFilterCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls: 12, pollMs: 20 },
    });
    assert.equal(result.status, "ABSTAINED");
    assert.equal(result.reason, "NON_GET_REQUEST_ATTEMPTED");
    assert.equal(result.transportSafety.safe, false);
    assert.equal(result.transportSafety.productNonGetAttemptCount, 2);
  } finally {
    await guard.stop();
    await page.close();
  }
});

test("capability telemetry counts reuse without creating proof", () => {
  const base = {
    kind: "SEARCH_FILTER_OPERATIONAL_CAPABILITY" as const,
    status: "EXECUTED_VERIFIED" as const,
    reason: "EXECUTED_VERIFIED" as const,
    attempted: true as const,
    executed: true,
    stateChanged: true,
    settled: true,
    control: { label: "Search", role: "textbox" },
    query: {
      source: "RUNTIME_VISIBLE_COLLECTION_CONTENT" as const,
      fingerprint: "query-hash",
      length: 8,
    },
    restoration: { attempted: true, settled: true, restored: true },
    transportSafety: {
      guardActive: true,
      productNonGetAttemptCount: 0,
      safe: true,
    },
    acceptanceProof: {
      attempted: false as const,
      reason: "OPERATIONAL_EVALUATION_ONLY" as const,
    },
    note: "verified",
  };
  const summary = summarizeSearchFilterCapability([
    {
      ...base,
      surface: {
        routePath: "/one",
        collectionId: "collection-one",
        collectionLabel: "One",
        collectionShape: "TABLE" as const,
        associationMethod: "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE" as const,
      },
    },
    {
      ...base,
      surface: {
        routePath: "/two",
        collectionId: "collection-two",
        collectionLabel: "Two",
        collectionShape: "CARD" as const,
        associationMethod: "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE" as const,
      },
    },
  ]);
  assert.equal(summary.capabilityAttemptCount, 2);
  assert.equal(summary.capabilityExecutionCount, 2);
  assert.equal(summary.verifiedStateChangeCount, 2);
  assert.equal(summary.capabilityReuseAcrossDistinctSurfaces, 2);
  assert.equal(summary.surfaces.every((surface) =>
    surface.acceptanceProof.attempted === false
  ), true);
  const adapted = toSearchFilterCapabilityEvaluation({
    ...base,
    surface: {
      routePath: "/one",
      collectionId: "collection-one",
      collectionLabel: "One",
      collectionShape: "TABLE" as const,
      associationMethod: "SINGLE_SEARCH_CONTROL_SINGLE_COLLECTION_IN_ACTIVE_SURFACE" as const,
    },
  });
  assert.equal(adapted.verifiedStateChange, true);
  assert.equal(adapted.restorationRequired, true);
  assert.equal(adapted.transportSafe, true);
  assert.equal(adapted.acceptanceProof.attempted, false);
});
