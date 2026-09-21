import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserObservedCollection,
} from "../agents/browser/browser-observation.js";
import {
  evaluateBrowserOrderingRequirement,
} from "../agents/browser/browser-ordering-evidence.js";
import {
  extractVisibleFieldProvenanceFromSource,
  resolveVisibleFieldProvenance,
  type FrontendVisibleFieldProvenance,
} from "./frontend-visible-field-provenance.js";

function extract(
  column: string,
  extras = ""
) {
  return extractVisibleFieldProvenanceFromSource({
    file: "src/components/RecordsTable.tsx",
    source: `
      import { defineMessages } from "react-intl";
      ${extras}
      const columns = [${column}];
    `,
  });
}

function provenance(
  overrides:
    Partial<FrontendVisibleFieldProvenance> = {}
): FrontendVisibleFieldProvenance {
  return {
    visibleLabel: "Last updated",
    sourceFields: ["updatedAt"],
    kind: "DIRECT",
    sourceRef: {
      file: "src/components/RecordsTable.tsx",
      line: 10,
      symbol: "columns",
    },
    authoritative: true,
    reason: "Direct accessor.",
    ...overrides,
  };
}

function collection(
  visibleLabel = "Last updated",
  values = ["2026-02-02", "2026-01-01"]
): BrowserObservedCollection {
  const visibleFieldId =
    `collection:records:field:` +
    visibleLabel.toLowerCase().replace(/\s+/g, "-");

  return {
    collectionId: "collection:records",
    shape: "TABLE",
    label: "Records",
    identity: {
      method: "ARIA_NAME",
      sourceText: "Records",
    },
    fields: [{
      visibleLabel,
      visibleFieldId,
      provenance: {
        method: "NATIVE_TH",
        sourceText: visibleLabel,
      },
    }],
    rows: values.map(
      (rawValue, sequencePosition) => ({
        sequencePosition,
        rowSequenceObserved: true,
        rowIdentityStatus:
          "UNAVAILABLE" as const,
        rowIdentityReason:
          "ROW_IDENTITY_UNAVAILABLE" as const,
        cells: [{
          visibleFieldId,
          rawValue,
          provenance: {
            method: "NATIVE_TD" as const,
          },
        }],
        provenance: {
          method: "NATIVE_TR" as const,
        },
      })
    ),
    provenance: {
      method: "NATIVE_TABLE",
      rowSequenceObserved: true,
      rowsTruncated: false,
    },
  };
}

function orderingEvidence(args: {
  comparisonType?: "DATE_TIME" | "NUMERIC" | "LEXICAL";
  values?: string[];
  provenance?: FrontendVisibleFieldProvenance[];
}) {
  return evaluateBrowserOrderingRequirement({
    requirement: {
      kind: "ORDERING",
      requirementId: "ordering-1",
      sourceClaim: "Records are descending.",
      semanticDimension: "RECENCY",
      direction: "DESC",
      comparisonType:
        args.comparisonType ?? "DATE_TIME",
      collectionHint: "records",
      fieldHint: "updatedAt",
      proofFieldBinding: {
        bindingId: "ordering-binding-updatedAt",
        requirementId: "ordering-1",
        semanticDimension: "RECENCY",
        proposedField: "updatedAt",
        proposalSource: "AC_EXPLICIT",
        authority: "AUTHORITATIVE",
      },
    },
    observation: {
      url: "https://example.test/records",
      title: "Records",
      headings: [],
      controls: [],
      inputs: [],
      surfaces: [],
      collections: [
        collection(
          "Last updated",
          args.values
        ),
      ],
      visibleText: [],
      counts: {
        headings: 0,
        controls: 0,
        inputs: 0,
        surfaces: 0,
        collections: 1,
        visibleText: 0,
      },
    },
    visibleFieldProvenance:
      args.provenance ?? [provenance()],
  });
}

test("static dataIndex and visible title extract as DIRECT", () => {
  const result = extract(`{
    title: "Last updated",
    dataIndex: "updatedAt"
  }`);
  assert.equal(result[0]?.kind, "DIRECT");
  assert.deepEqual(result[0]?.sourceFields, ["updatedAt"]);
});

test("static dataIndex with direct JSX render retains one source field", () => {
  const result = extract(`{
    title: "Score",
    dataIndex: "score",
    render: (score) => <span>{score}</span>
  }`);
  assert.deepEqual(result[0]?.sourceFields, ["score"]);
  assert.equal(result[0]?.kind, "DIRECT");
});

test("nested static dataIndex preserves its full structural path", () => {
  const result = extract(`{
    title: "Job",
    dataIndex: ["job", "title"]
  }`);
  assert.deepEqual(result[0]?.sourceFields, ["job.title"]);
});

test("nullish field fallback extracts as FALLBACK", () => {
  const result = extract(`{
    title: "Last updated",
    render: (_, record) => format(record.updatedAt ?? record.createdAt)
  }`);
  assert.equal(result[0]?.kind, "FALLBACK");
  assert.deepEqual(result[0]?.sourceFields, ["createdAt", "updatedAt"]);
});

test("logical-or field fallback extracts as FALLBACK", () => {
  const result = extract(`{
    title: "Last updated",
    render: (_, record) => record.updatedAt || record.createdAt
  }`);
  assert.equal(result[0]?.kind, "FALLBACK");
});

test("ternary field selection extracts as FALLBACK", () => {
  const result = extract(`{
    title: "When",
    render: (_, row) => row.updatedAt ? row.updatedAt : row.createdAt
  }`);
  assert.equal(result[0]?.kind, "FALLBACK");
});

test("two-field template extracts as COMPOSITE", () => {
  const result = extract(`{
    title: "Name",
    render: (_, row) => \`${"${row.firstName} ${row.lastName}"}\`
  }`);
  assert.equal(result[0]?.kind, "COMPOSITE");
  assert.deepEqual(result[0]?.sourceFields, ["firstName", "lastName"]);
});

test("calculated field expression extracts as DERIVED", () => {
  const result = extract(`{
    title: "Duration",
    render: (_, row) => row.endAt - row.startAt
  }`);
  assert.equal(result[0]?.kind, "DERIVED");
});

test("one record field passed through arbitrary helper remains DERIVED", () => {
  const result = extract(`{
    title: "Updated",
    render: (_, row) => arbitrary(row.updatedAt)
  }`);
  assert.equal(result[0]?.kind, "DERIVED");
});

test("external render callback is UNRESOLVED", () => {
  const result = extract(`{
    title: "Updated",
    render: renderUpdated
  }`);
  assert.equal(result[0]?.kind, "UNRESOLVED");
});

test("inline direct record property is DIRECT", () => {
  const result = extract(`{
    title: "Updated",
    render: (_, row) => <span>{row.updatedAt}</span>
  }`);
  assert.equal(result[0]?.kind, "DIRECT");
});

test("formatted static accessor is conservative DERIVED", () => {
  const result = extract(`{
    title: "Updated",
    dataIndex: "updatedAt",
    render: (value) => formatDate(value)
  }`);
  assert.equal(result[0]?.kind, "DERIVED");
});

test("react-intl defaultMessage resolves the authoritative visible label", () => {
  const result = extract(`{
    title: intl.formatMessage(messages.updated),
    dataIndex: "updatedAt"
  }`, `
    const messages = defineMessages({
      updated: { id: "table.updated", defaultMessage: "Last updated" }
    });
  `);
  assert.equal(result[0]?.visibleLabel, "Last updated");
});

test("source reference preserves bounded relative file, line, and symbol", () => {
  const result = extract(`{
    title: "Updated",
    dataIndex: "updatedAt"
  }`);
  assert.equal(result[0]?.sourceRef.file, "src/components/RecordsTable.tsx");
  assert.equal(result[0]?.sourceRef.symbol, "columns");
  assert.equal(typeof result[0]?.sourceRef.line, "number");
});

test("absolute local paths are not persisted in source references", () => {
  const result = extractVisibleFieldProvenanceFromSource({
    source: `const columns = [{ title: "Updated", dataIndex: "updatedAt" }];`,
    file: "/private/local/user/project/RecordsTable.tsx",
  });
  assert.equal(
    result[0]?.sourceRef.file,
    "RecordsTable.tsx"
  );
});

test("extraction output is deterministic", () => {
  const column = `{
    title: "Updated",
    dataIndex: "updatedAt"
  }`;
  assert.deepEqual(extract(column), extract(column));
});

test("bounded source commit reference is preserved without deployment claims", () => {
  const sourceCommitRef = "a".repeat(40);
  const [entry] = extractVisibleFieldProvenanceFromSource({
    source: `const columns = [{ title: "Created", dataIndex: "createdAt" }];`,
    file: "src/RecordsTable.tsx",
    sourceCommitRef,
  });
  assert.equal(entry?.sourceCommitRef, sourceCommitRef);
  assert.equal(JSON.stringify(entry).includes("deployed"), false);
});

test("unsupported dynamic label fails safe", () => {
  assert.deepEqual(extract(`{
    title: getTitle(),
    dataIndex: "updatedAt"
  }`), []);
});

test("column key alone is not treated as a source accessor", () => {
  const result = extract(`{
    title: "Updated",
    key: "updatedAt",
    render: renderUpdated
  }`);
  assert.equal(result[0]?.kind, "UNRESOLVED");
  assert.deepEqual(result[0]?.sourceFields, []);
});

test("ordinary non-column arrays produce no provenance", () => {
  const result = extractVisibleFieldProvenanceFromSource({
    source: `const labels = [{ title: "Updated", value: "updatedAt" }];`,
    file: "src/Labels.ts",
  });
  assert.deepEqual(result, []);
});

test("malformed source fails safe", () => {
  assert.deepEqual(
    extractVisibleFieldProvenanceFromSource({
      source: "const columns = [{ title: '",
      file: "src/Broken.tsx",
    }),
    []
  );
});

test("source byte bound is enforced", () => {
  assert.deepEqual(
    extractVisibleFieldProvenanceFromSource({
      source: "x".repeat(2_000),
      file: "src/Large.tsx",
      maxSourceBytes: 1_024,
    }),
    []
  );
});

test("entry count bound is enforced", () => {
  const result = extractVisibleFieldProvenanceFromSource({
    source: `const columns = [
      { title: "A", dataIndex: "a" },
      { title: "B", dataIndex: "b" }
    ];`,
    file: "src/Bounded.tsx",
    maxEntries: 1,
  });
  assert.equal(result.length, 1);
});

test("persisted metadata contains no source blob", () => {
  const sentinel = "SENSITIVE_SOURCE_SENTINEL";
  const result = extract(`{
    title: "Updated",
    dataIndex: "updatedAt"
  }`, `const unused = "${sentinel}";`);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test("DIRECT provenance resolves an exact source field to grounded label", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection(),
    provenance: [provenance()],
  });
  assert.equal(result.status, "DIRECT_MATCH");
  assert.equal(result.visibleField, "Last updated");
});

for (const [kind, status] of [
  ["FALLBACK", "FALLBACK_SOURCE"],
  ["COMPOSITE", "COMPOSITE_SOURCE"],
  ["DERIVED", "DERIVED_SOURCE"],
  ["UNRESOLVED", "UNRESOLVED_SOURCE"],
] as const) {
  test(`${kind} provenance does not resolve as direct proof`, () => {
    const result = resolveVisibleFieldProvenance({
      requirementField: "updatedAt",
      collection: collection(),
      provenance: [provenance({ kind })],
    });
    assert.equal(result.status, status);
  });
}

test("visible-label similarity alone creates no authority", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection("Updated timestamp"),
    provenance: [],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("Created label does not automatically resolve createdAt", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "createdAt",
    collection: collection("Created"),
    provenance: [],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("planner fieldHint cannot create field authority", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection(),
    provenance: [],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("non-authoritative metadata is ignored at runtime", () => {
  const untrusted = {
    ...provenance(),
    authoritative: false,
  } as unknown as FrontendVisibleFieldProvenance;
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection(),
    provenance: [untrusted],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("nested source field does not collapse to a similar leaf key", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection(),
    provenance: [provenance({
      sourceFields: ["metadata.updatedAt"],
    })],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("duplicate grounded visible labels make direct resolution ambiguous", () => {
  const target = collection();
  target.fields.push({
    ...target.fields[0]!,
    visibleFieldId: "duplicate-visible-field",
  });
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: target,
    provenance: [provenance()],
  });
  assert.equal(result.status, "AMBIGUOUS_MAPPING");
});

test("source mapping whose visible field is absent abstains", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection("Status"),
    provenance: [provenance()],
  });
  assert.equal(result.status, "VISIBLE_FIELD_NOT_GROUNDED");
});

test("competing authoritative mappings abstain", () => {
  const result = resolveVisibleFieldProvenance({
    requirementField: "updatedAt",
    collection: collection(),
    provenance: [
      provenance(),
      provenance({
        sourceRef: {
          file: "src/components/OtherTable.tsx",
          line: 20,
        },
      }),
    ],
  });
  assert.equal(result.status, "AMBIGUOUS_MAPPING");
});

test("column order cannot create a mapping", () => {
  const target = collection("Unrelated");
  target.fields.unshift({
    visibleLabel: "Last updated",
    visibleFieldId: "unrelated-first-field",
    provenance: {
      method: "NATIVE_TH",
      sourceText: "Last updated",
    },
  });
  const result = resolveVisibleFieldProvenance({
    requirementField: "createdAt",
    collection: target,
    provenance: [provenance()],
  });
  assert.equal(result.status, "NO_AUTHORITATIVE_MAPPING");
});

test("direct mapping supplies bounded raw values to Ordering V0", () => {
  const result = orderingEvidence({});
  assert.equal(result.status, "CONFIRMED");
  assert.deepEqual(result.values, ["2026-02-02", "2026-01-01"]);
});

test("fallback mapping supplies no values to Ordering V0", () => {
  const result = orderingEvidence({
    provenance: [provenance({
      kind: "FALLBACK",
      sourceFields: ["createdAt", "updatedAt"],
    })],
  });
  assert.equal(result.reason, "FIELD_MAPPING_FALLBACK");
  assert.deepEqual(result.values, []);
});

test("composite mapping supplies no values to Ordering V0", () => {
  const result = orderingEvidence({
    provenance: [provenance({ kind: "COMPOSITE" })],
  });
  assert.equal(result.reason, "FIELD_MAPPING_COMPOSITE");
  assert.deepEqual(result.values, []);
});

test("direct numeric mapping compares deterministically", () => {
  assert.equal(orderingEvidence({
    comparisonType: "NUMERIC",
    values: ["20", "10"],
  }).status, "CONFIRMED");
});

test("direct lexical mapping compares deterministically", () => {
  assert.equal(orderingEvidence({
    comparisonType: "LEXICAL",
    values: ["Zulu", "Alpha"],
  }).status, "CONFIRMED");
});

test("ordering evidence carries bounded mapping provenance", () => {
  const result = orderingEvidence({});
  assert.equal(result.requirementField, "updatedAt");
  assert.equal(result.field, "Last updated");
  assert.equal(result.mappingKind, "DIRECT");
  assert.equal(result.mappingResolutionStatus, "DIRECT_MATCH");
  assert.deepEqual(result.mappingSourceFields, ["updatedAt"]);
  assert.equal(result.mappingSourceRef?.file, "src/components/RecordsTable.tsx");
});

test("ordering provenance remains outside deterministicEvidence shape", () => {
  const result = orderingEvidence({});
  assert.equal((result as any).action, undefined);
  assert.equal((result as any).deterministicEvidence, undefined);
});

test("identical provenance inputs produce identical ordering output", () => {
  assert.deepEqual(orderingEvidence({}), orderingEvidence({}));
});
