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

import type {
  SourceCardCollectionDeclaration,
} from "../../discovery/frontend-card-collection-provenance.js";
import type {
  SourceCardFieldProvenance,
} from "../../discovery/frontend-card-field-provenance.js";
import type {
  BrowserOrderingRequirement,
} from "../../planner/types.js";
import {
  observeBrowserPage,
  type BrowserObservationOptions,
} from "./browser-observation.js";
import {
  evaluateBrowserOrderingRequirement,
} from "./browser-ordering-evidence.js";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
  });
});

after(async () => {
  await browser?.close();
});

function declaration(
  overrides: Partial<
    SourceCardCollectionDeclaration
  > = {}
): SourceCardCollectionDeclaration {
  return {
    collectionComponentRef: {
      file: "src/RecordsCardView.tsx",
      line: 12,
      symbol: "RecordsCardView",
    },
    itemComponentRef: {
      file: "src/RecordCard.tsx",
      line: 40,
      symbol: "RecordCard",
    },
    iterationKind: "ARRAY_MAP",
    sourceItemExpression: "items",
    sourceItemKey: {
      expression: "item.id",
      available: true,
    },
    itemProps: [{
      name: "record",
      sourceExpression: "item.record",
    }],
    surface: {
      route: "/talent/assessments",
      persona: "talent",
      area: "assessments",
      sourceRef: "src/routes.tsx:10",
    },
    runtimeSignature: {
      itemRole: "button",
      focusable: true,
      headingTag: "h3",
      exactHeadingCount: 1,
      minimumNestedActionButtons: 1,
      containerOwnership: "DIRECT_CHILDREN",
      markerAttribute: "data-has-action",
      sourceRefs: [
        "src/RecordCard.tsx:40",
        "src/InteractiveCard.tsx:20",
      ],
    },
    visibleFields: [{
      kind: "ITEM_HEADING",
      observationField: "visibleItemName",
      sourceExpression: "record.title",
      sourceRef: "src/RecordCard.tsx:45",
    }],
    pagination: {
      sourceRef: "src/RecordsView.tsx#AppPagination",
    },
    sourceRef: "src/RecordsCardView.tsx:12",
    sourceCommitRef:
      "0123456789abcdef0123456789abcdef01234567",
    authoritative: true,
    ...overrides,
  };
}

function card(
  name: string,
  attributes = ""
): string {
  return `
    <div role="button" tabindex="0" data-has-action="true" ${attributes}>
      <h3>${name}</h3>
      <p>arbitrary body text for ${name}</p>
      <button>Start</button>
    </div>
  `;
}

function collection(
  names = ["Alpha", "Beta"]
): string {
  return `<main><div>${names.map((name) => card(name)).join("")}</div></main>`;
}

function cardField(
  overrides: Partial<
    SourceCardFieldProvenance
  > = {}
): SourceCardFieldProvenance {
  return {
    fieldId: "card-field-created-at",
    observationField: "createdAt",
    sourceFields: ["record.createdAt"],
    kind: "DIRECT",
    valueKind: "DATE_TIME",
    sourceExpression: "record.createdAt",
    sourceRef: {
      file: "src/RecordCard.tsx",
      line: 50,
      symbol: "RecordCard",
    },
    sourceCommitRef:
      "0123456789abcdef0123456789abcdef01234567",
    runtimeLocator: {
      method: "EXACT_TAG",
      selector: "time",
      exactCount: 1,
    },
    visibility: "ALWAYS",
    authoritative: true,
    reason: "Synthetic exact source mapping.",
    ...overrides,
  };
}

function fieldCollection(
  values: string[],
  field: SourceCardFieldProvenance =
    cardField()
): {
  html: string;
  options: BrowserObservationOptions;
} {
  return {
    html: `<main><div>${values.map(
      (value, index) => `
        <div role="button" tabindex="0" data-has-action="true">
          <h3>Item ${index + 1}</h3>
          <p>Description ${index + 1}</p>
          <time>${value}</time>
          <button>Start</button>
        </div>
      `
    ).join("")}</div></main>`,
    options: {
      sourceCardCollectionDeclarations: [
        declaration({
          cardFields: [field],
        }),
      ],
    },
  };
}

async function observe(
  html: string,
  options: BrowserObservationOptions = {}
) {
  const page = await browser.newPage();

  try {
    await page.route(
      "https://example.test/**",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html,
        })
    );
    await page.goto(
      "https://example.test/talent/assessments"
    );
    return await observeBrowserPage(page, {
      sourceCardCollectionDeclarations: [
        declaration(),
      ],
      ...options,
    });
  } finally {
    await page.close();
  }
}

test("source declaration plus matching runtime cards grounds CARD", async () => {
  const result = await observe(collection());

  assert.equal(result.collections?.length, 1);
  assert.equal(result.collections?.[0]?.shape, "CARD");
  assert.equal(
    result.collections?.[0]?.identity.method,
    "SOURCE_COMPONENT_COLLECTION"
  );
});

test("runtime repetition without a source declaration does not ground", async () => {
  const result = await observe(collection(), {
    sourceCardCollectionDeclarations: [],
  });

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.length, 0);
});

test("source declaration without matching runtime structure abstains", async () => {
  const result = await observe(`
    <main><div><div><h3>Alpha</h3></div><div><h3>Beta</h3></div></div></main>
  `);

  assert.equal(result.collections?.length, 0);
  assert.equal(
    result.collectionAbstentions?.[0]?.reason,
    "CARD_ITEM_STRUCTURE_UNVERIFIED"
  );
});

test("class-name repetition alone cannot ground", async () => {
  const result = await observe(`
    <main><div><div class="card"><h3>A</h3><button>Start</button></div><div class="card"><h3>B</h3><button>Start</button></div></div></main>
  `);

  assert.equal(result.collections?.length, 0);
});

test("same-tag sibling repetition alone cannot ground", async () => {
  const result = await observe(`
    <main><div><div>A</div><div>B</div></div></main>
  `);

  assert.equal(result.collections?.length, 0);
});

test("missing focusability fails the source runtime signature", async () => {
  const result = await observe(`
    <main><div>
      <div role="button" data-has-action="true"><h3>A</h3><button>Start</button></div>
      <div role="button" data-has-action="true"><h3>B</h3><button>Start</button></div>
    </div></main>
  `);

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "CARD_ITEM_STRUCTURE_UNVERIFIED");
});

test("missing explicit nested action fails the source signature", async () => {
  const result = await observe(`
    <main><div>
      <div role="button" tabindex="0" data-has-action="true"><h3>A</h3></div>
      <div role="button" tabindex="0" data-has-action="true"><h3>B</h3></div>
    </div></main>
  `);

  assert.equal(result.collections?.length, 0);
});

test("hover-revealed source action grounds structure without becoming an observed control", async () => {
  const result = await observe(`
    <main><div>
      <div role="button" tabindex="0" data-has-action="true">
        <h3>A</h3><button style="opacity: 0; pointer-events: none">Start</button>
      </div>
      <div role="button" tabindex="0" data-has-action="true">
        <h3>B</h3><button style="opacity: 0; pointer-events: none">Start</button>
      </div>
    </div></main>
  `);

  assert.equal(result.collections?.[0]?.shape, "CARD");
  assert.deepEqual(
    result.collections?.[0]?.items?.map((item) => item.controls),
    [[], []]
  );
});

test("two candidate containers fail safe as ambiguous", async () => {
  const result = await observe(`
    <main><div>${card("A")}${card("B")}</div><div>${card("C")}${card("D")}</div></main>
  `);

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "CARD_COLLECTION_AMBIGUOUS");
});

test("competing authoritative declarations fail safe", async () => {
  const result = await observe(collection(), {
    sourceCardCollectionDeclarations: [
      declaration(),
      declaration({
        sourceRef: "src/OtherView.tsx:1",
      }),
    ],
  });

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "CARD_COLLECTION_AMBIGUOUS");
});

test("hidden matching collection is excluded", async () => {
  const result = await observe(`
    <main><div style="display:none">${card("A")}${card("B")}</div></main>
  `);

  assert.equal(result.collections?.length, 0);
});

test("active modal excludes a matching background card collection", async () => {
  const result = await observe(`
    ${collection()}
    <div role="dialog" aria-modal="true" aria-label="Dialog"><button>Close</button></div>
  `);

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "CARD_ITEM_STRUCTURE_UNVERIFIED");
});

test("matching card collection inside the active modal remains observable", async () => {
  const result = await observe(`
    <main>${collection()}</main>
    <div role="dialog" aria-modal="true" aria-label="Dialog"><div>${card("A")}${card("B")}</div></div>
  `);

  assert.equal(result.collections?.[0]?.shape, "CARD");
  assert.deepEqual(result.collections?.[0]?.items?.map((item) => item.visibleItemName), ["A", "B"]);
});

test("fewer than required items yields explicit multiplicity abstention", async () => {
  const result = await observe(collection(["Only"]));

  assert.equal(result.collections?.length, 0);
  assert.equal(result.collectionAbstentions?.[0]?.reason, "CARD_COLLECTION_EMPTY");
  assert.equal(result.collectionAbstentions?.[0]?.detectedRowCount, 1);
});

test("minimum multiplicity can be lowered explicitly for non-comparison observation", async () => {
  const result = await observe(collection(["Only"]), {
    minimumCardCollectionItems: 1,
  });

  assert.equal(result.collections?.[0]?.items?.length, 1);
});

test("item sequence positions are retained", async () => {
  const result = await observe(collection(["C", "B", "A"]));

  assert.deepEqual(result.collections?.[0]?.items?.map((item) => item.sequencePosition), [0, 1, 2]);
  assert.equal(result.collections?.[0]?.provenance.itemSequenceObserved, true);
});

test("sequence position is never reused as durable item ID", async () => {
  const item = (await observe(collection())).collections?.[0]?.items?.[0];

  assert.equal(item?.sequencePosition, 0);
  assert.equal(item?.durableItemId, undefined);
  assert.equal(item?.durableItemIdentityStatus, "UNAVAILABLE");
});

test("missing durable runtime ID is surfaced without fabrication", async () => {
  const items = (await observe(collection())).collections?.[0]?.items ?? [];

  assert.ok(items.every((item) => item.durableItemIdentityReason === "CARD_ITEM_IDENTITY_UNAVAILABLE"));
});

test("h3 becomes visibleItemName with source provenance", async () => {
  const item = (await observe(collection())).collections?.[0]?.items?.[0];

  assert.equal(item?.visibleItemName, "Alpha");
  assert.equal(item?.fields[0]?.field, "visibleItemName");
  assert.equal(item?.fields[0]?.provenance.method, "SOURCE_BACKED_H3");
});

test("h3 text does not become entity identity", async () => {
  const item = (await observe(collection())).collections?.[0]?.items?.[0];

  assert.equal(item?.visibleItemName, "Alpha");
  assert.equal(item?.durableItemIdentity, undefined);
});

test("duplicate visible names remain duplicate observations", async () => {
  const items = (await observe(collection(["Same", "Same"]))).collections?.[0]?.items ?? [];

  assert.deepEqual(items.map((item) => item.visibleItemName), ["Same", "Same"]);
});

test("source React key is not promoted to runtime item ID", async () => {
  const collectionResult = (await observe(collection())).collections?.[0];

  assert.deepEqual(collectionResult?.sourceItemKey, {
    expression: "item.id",
    available: true,
    runtimeCorrespondence: false,
  });
  assert.equal(collectionResult?.items?.[0]?.durableItemId, undefined);
});

test("explicit runtime data-entity-id may ground durable identity", async () => {
  const result = await observe(`
    <main><div>${card("A", 'data-entity-id="a"')}${card("B", 'data-entity-id="b"')}</div></main>
  `);

  assert.deepEqual(result.collections?.[0]?.items?.map((item) => item.durableItemIdentity?.method), ["DATA_ENTITY_ID", "DATA_ENTITY_ID"]);
});

test("duplicate explicit runtime IDs fail back to unavailable identity", async () => {
  const result = await observe(`
    <main><div>${card("A", 'data-id="same"')}${card("B", 'data-id="same"')}</div></main>
  `);

  assert.ok(result.collections?.[0]?.items?.every((item) => item.durableItemIdentityStatus === "UNAVAILABLE"));
});

test("arbitrary card body text does not become a field", async () => {
  const item = (await observe(collection())).collections?.[0]?.items?.[0];

  assert.deepEqual(item?.fields.map((field) => field.field), ["visibleItemName"]);
  assert.equal(JSON.stringify(item?.fields).includes("arbitrary body"), false);
});

test("source-backed field plus exact runtime value grounds", async () => {
  const fixture = fieldCollection(["2026-08-20", "2026-08-19"]);
  const result = await observe(fixture.html, fixture.options);

  assert.equal(
    result.collections?.[0]?.cardFieldSchema?.[0]?.sourceField,
    "createdAt",
    JSON.stringify(result.collections?.[0])
  );
  assert.deepEqual(
    result.collections?.[0]?.items?.map((item) =>
      item.fields.find((field) => field.field === "createdAt")?.rawValue
    ),
    ["2026-08-20", "2026-08-19"]
  );
});

test("runtime timestamp text without source mapping does not become a field", async () => {
  const result = await observe(`
    <main><div>
      <div role="button" tabindex="0" data-has-action="true"><h3>A</h3><time>2026-08-20</time><button>Start</button></div>
      <div role="button" tabindex="0" data-has-action="true"><h3>B</h3><time>2026-08-19</time><button>Start</button></div>
    </div></main>
  `);

  assert.ok(result.collections?.[0]?.items?.every((item) =>
    item.fields.every((field) => field.field !== "createdAt")
  ));
});

test("source mapping without runtime value stays ungrounded", async () => {
  const result = await observe(collection(), {
    sourceCardCollectionDeclarations: [declaration({ cardFields: [cardField()] })],
  });

  assert.equal(result.collections?.[0]?.cardFieldSchema?.length, 1);
  assert.ok(result.collections?.[0]?.items?.every((item) =>
    item.fields.every((field) => field.field !== "createdAt")
  ));
});

test("duplicate runtime field elements fail safe as ambiguous", async () => {
  const fixture = fieldCollection([
    "2026-08-20</time><time>2026-08-18",
    "2026-08-19</time><time>2026-08-17",
  ]);
  const result = await observe(fixture.html, fixture.options);

  assert.ok(result.collections?.[0]?.items?.every((item) =>
    item.fields.every((field) => field.field !== "createdAt")
  ));
});

test("hidden source-backed runtime field is excluded", async () => {
  const result = await observe(`
    <main><div>
      <div role="button" tabindex="0" data-has-action="true"><h3>A</h3><time style="display:none">2026-08-20</time><button>Start</button></div>
      <div role="button" tabindex="0" data-has-action="true"><h3>B</h3><time style="display:none">2026-08-19</time><button>Start</button></div>
    </div></main>
  `, {
    sourceCardCollectionDeclarations: [declaration({ cardFields: [cardField()] })],
  });

  assert.ok(result.collections?.[0]?.items?.every((item) => item.fields.length === 1));
});

test("source-backed field honors active surface scoping", async () => {
  const fixture = fieldCollection(["2026-08-20", "2026-08-19"]);
  const result = await observe(
    `<main><div role="dialog">${fixture.html}</div></main>`,
    fixture.options
  );

  assert.deepEqual(
    result.collections?.[0]?.items?.map((item) =>
      item.fields.find((field) => field.field === "createdAt")?.rawValue
    ),
    ["2026-08-20", "2026-08-19"]
  );
});

test("exact enum status value is retained", async () => {
  const field = cardField({
    fieldId: "card-field-status",
    observationField: "status",
    sourceFields: ["record.status"],
    sourceExpression: "record.status",
    valueKind: "ENUM",
    runtimeLocator: {
      method: "EXACT_ROLE",
      selector: '[role="status"]',
      exactCount: 1,
    },
  });
  const result = await observe(`
    <main><div>
      <div role="button" tabindex="0" data-has-action="true"><h3>A</h3><span role="status">COMPLETED</span><button>Start</button></div>
      <div role="button" tabindex="0" data-has-action="true"><h3>B</h3><span role="status">IN_PROGRESS</span><button>Start</button></div>
    </div></main>
  `, {
    sourceCardCollectionDeclarations: [declaration({ cardFields: [field] })],
  });

  assert.deepEqual(
    result.collections?.[0]?.items?.map((item) =>
      item.fields.find((itemField) => itemField.field === "status")?.rawValue
    ),
    ["COMPLETED", "IN_PROGRESS"]
  );
});

test("source-backed field text bound is enforced", async () => {
  const fixture = fieldCollection([
    "2026-08-20T12:00:00Z".repeat(5),
    "2026-08-19T12:00:00Z".repeat(5),
  ]);
  const result = await observe(fixture.html, {
    ...fixture.options,
    maxTextLength: 40,
  });

  assert.ok(result.collections?.[0]?.items?.every((item) =>
    item.fields.every((field) => field.rawValue.length <= 40)
  ));
});

test("accessible nested action controls are bounded observations", async () => {
  const item = (await observe(collection())).collections?.[0]?.items?.[0];

  assert.deepEqual(item?.controls, [{
    kind: "ACTION",
    role: "button",
    label: "Start",
  }]);
});

test("accessible pagination controls associate with source-backed surface", async () => {
  const result = await observe(`
    ${collection()}<button aria-label="Previous page"></button><button aria-label="Next page"></button>
  `);

  assert.deepEqual(result.collections?.[0]?.paginationControls?.map((control) => control.kind), ["PREVIOUS", "NEXT"]);
});

test("pagination observation creates no transition proof", async () => {
  const result = await observe(`
    ${collection()}<button aria-label="Previous page"></button><button aria-label="Next page"></button>
  `);
  const serialized = JSON.stringify(result.collections?.[0]?.paginationControls);

  assert.doesNotMatch(serialized, /passed|evidence|transition/i);
});

test("card grounding cannot create ordering confirmation", async () => {
  const observation = await observe(collection(["C", "B", "A"]));
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Cards are newest first.",
      semanticDimension: "RECENCY",
      direction: "DESC",
      comparisonType: "DATE_TIME",
      collectionHint: "/talent/assessments",
      proofFieldBinding: {
        bindingId: "binding-1",
        requirementId: "ordering-1",
        semanticDimension: "RECENCY",
        proposedField: "createdAt",
        proposalSource: "AC_EXPLICIT",
        authority: "AUTHORITATIVE",
      },
    },
    observation,
  });

  assert.equal(evidence.status, "UNAVAILABLE");
  assert.equal(evidence.passed, null);
  assert.equal(evidence.reason, "SCHEMA_NOT_GROUNDED");
  assert.equal(evidence.collectionShape, "CARD");
});

function cardOrderingRequirement(args: {
  authority?: "AUTHORITATIVE" | "CANDIDATE";
  proposalSource?:
    | "AC_EXPLICIT"
    | "IMPLEMENTATION_DERIVED"
    | "PLANNER_HEURISTIC";
  includeBinding?: boolean;
} = {}): BrowserOrderingRequirement {
  const requirement: BrowserOrderingRequirement = {
    kind: "ORDERING",
    requirementId: "card-ordering-1",
    sourceClaim: "Records are newest first.",
    semanticDimension: "RECENCY",
    direction: "DESC",
    comparisonType: "DATE_TIME",
  };

  if (args.includeBinding !== false) {
    requirement.proofFieldBinding = {
      bindingId: "card-binding-1",
      requirementId: "card-ordering-1",
      semanticDimension: "RECENCY",
      proposedField: "createdAt",
      proposalSource:
        args.proposalSource ?? "AC_EXPLICIT",
      authority:
        args.authority ?? "AUTHORITATIVE",
    };
  }

  return requirement;
}

async function cardOrderingEvidence(args: {
  values: string[];
  field?: SourceCardFieldProvenance;
  requirement?: BrowserOrderingRequirement;
}) {
  const fixture = fieldCollection(
    args.values,
    args.field ?? cardField()
  );
  const observation = await observe(
    fixture.html,
    fixture.options
  );

  return evaluateBrowserOrderingRequirement({
    requirement:
      args.requirement ??
      cardOrderingRequirement(),
    observation,
  });
}

test("authoritative direct card timestamps feed existing Ordering V0", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
  });

  assert.equal(evidence.status, "CONFIRMED");
  assert.equal(evidence.passed, true);
  assert.equal(evidence.collectionShape, "CARD");
  assert.equal(evidence.itemSequenceObserved, true);
});

test("malformed card timestamp remains unavailable", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["not-a-date", "2026-08-19"],
  });

  assert.equal(evidence.reason, "VALUE_PARSE_FAILED");
});

test("ambiguous slash date remains unavailable", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["08/09/2026", "07/09/2026"],
  });

  assert.equal(evidence.reason, "VALUE_PARSE_FAILED");
});

test("direct mapping alone does not grant binding authority", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
    requirement: cardOrderingRequirement({
      authority: "CANDIDATE",
    }),
  });

  assert.equal(evidence.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("implementation-derived card field remains candidate-only", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
    requirement: cardOrderingRequirement({
      authority: "CANDIDATE",
      proposalSource: "IMPLEMENTATION_DERIVED",
    }),
  });

  assert.equal(evidence.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("semantic RECENCY alone cannot become createdAt", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
    requirement: cardOrderingRequirement({
      includeBinding: false,
    }),
  });

  assert.equal(evidence.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("planner heuristic cannot authorize a card field", async () => {
  const requirement = cardOrderingRequirement({
    includeBinding: false,
  });
  requirement.fieldHint = "createdAt";
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
    requirement,
  });

  assert.equal(evidence.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("fallback card field stops before comparator", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
    field: cardField({ kind: "FALLBACK" }),
  });

  assert.equal(evidence.reason, "FIELD_MAPPING_FALLBACK");
});

test("missing card field value stops before comparator", async () => {
  const fixture = fieldCollection(["2026-08-20", "2026-08-19"]);
  const observation = await observe(
    fixture.html.replace("<time>2026-08-19</time>", ""),
    fixture.options
  );
  const evidence = evaluateBrowserOrderingRequirement({
    requirement: cardOrderingRequirement(),
    observation,
  });

  assert.equal(evidence.reason, "FIELD_NOT_GROUNDED");
});

test("card ordering adapter never promotes sequence to identity", async () => {
  const fixture = fieldCollection(["2026-08-20", "2026-08-19"]);
  const observation = await observe(fixture.html, fixture.options);

  assert.ok(observation.collections?.[0]?.items?.every((item) =>
    item.durableItemIdentityStatus === "UNAVAILABLE" &&
    item.durableItemId === undefined
  ));
});

test("confirmed card ordering is verdict-neutral evidence only", async () => {
  const evidence = await cardOrderingEvidence({
    values: ["2026-08-20", "2026-08-19"],
  });

  assert.doesNotMatch(
    JSON.stringify(evidence),
    /finalStatus|deterministicEvidence|reconciliation/
  );
});

test("card collection grounding inserts no deterministic evidence", async () => {
  const result = await observe(collection());
  const serialized = JSON.stringify(result.collections?.[0]);

  assert.doesNotMatch(serialized, /deterministicEvidence|oracleId|passed/);
});

test("card count bound is enforced and disclosed", async () => {
  const result = await observe(collection(["A", "B", "C", "D"]), {
    maxCollectionRows: 2,
  });

  assert.equal(result.collections?.[0]?.items?.length, 2);
  assert.equal(result.collections?.[0]?.provenance.itemsTruncated, true);
});

test("visible item-name text bound is enforced", async () => {
  const result = await observe(collection(["A".repeat(100), "B".repeat(100)]), {
    maxTextLength: 40,
  });

  assert.equal(result.collections?.[0]?.items?.[0]?.visibleItemName.length, 40);
});

test("identical input produces deterministic card output", async () => {
  const first = await observe(collection());
  const second = await observe(collection());

  assert.deepEqual(first.collections, second.collections);
});

const cardObserverSource = (() => {
  const source = readFileSync(
    new URL("./browser-observation.ts", import.meta.url),
    "utf8"
  );
  const start = source.indexOf(
    "GROUNDED_COLLECTION_OBSERVATION_V2_SOURCE_BACKED_CARDS"
  );
  const end = source.indexOf(
    "const visibleTextRoots",
    start
  );

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
})();

test("card grounding has no nth selector", () => {
  assert.doesNotMatch(cardObserverSource, /nth-(?:child|of-type)/i);
});

test("card grounding has no pixel or coordinate logic", () => {
  assert.doesNotMatch(cardObserverSource, /getBoundingClientRect|offset(?:Top|Left)|client[XY]|pixel|Math\.(?:hypot|sqrt)/i);
});

test("card grounding has no class-name grouping", () => {
  assert.doesNotMatch(cardObserverSource, /className|getAttribute\(['"]class|classList/);
});

test("card grounding has no screenshot OCR or model authority", () => {
  assert.doesNotMatch(cardObserverSource, /screenshot|\bOCR\b|openai|anthropic|languageModel|\bLLM\b/i);
});

test("card grounding has no issue or case-specific production branch", () => {
  assert.doesNotMatch(cardObserverSource, /AS-\d+|web-\d+/i);
});

test("card grounding does not use nearest-text association", () => {
  assert.doesNotMatch(cardObserverSource, /closest\([^)]*h[1-6]|previousElementSibling|nextElementSibling/i);
});
