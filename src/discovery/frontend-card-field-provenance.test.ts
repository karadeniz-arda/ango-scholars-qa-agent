import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  discoverFrontendCardCollectionDeclarations,
} from "./frontend-card-collection-provenance.js";
import {
  extractCardFieldProvenanceFromSource,
} from "./frontend-card-field-provenance.js";

function extract(
  expression: string,
  tag = "time"
) {
  return extractCardFieldProvenanceFromSource({
    file: "src/Card.tsx",
    componentName: "Card",
    source: `
      const Card = ({ record }) => (
        <article><${tag}>${expression}</${tag}></article>
      );
    `,
  });
}

test("direct source field to visible element maps DIRECT", () => {
  const field = extract("{record.createdAt}")[0]!;

  assert.equal(field.kind, "DIRECT");
  assert.deepEqual(field.sourceFields, [
    "record.createdAt",
  ]);
  assert.equal(field.valueKind, "DATE_TIME");
  assert.equal(
    field.runtimeLocator?.selector,
    "time"
  );
});

test("fallback expression maps FALLBACK", () => {
  const field = extract(
    "{record.createdAt ?? record.updatedAt}"
  )[0]!;

  assert.equal(field.kind, "FALLBACK");
  assert.deepEqual(field.sourceFields, [
    "record.createdAt",
    "record.updatedAt",
  ]);
});

test("composite expression maps COMPOSITE", () => {
  const field = extract(
    "{`${record.startedAt} / ${record.completedAt}`}"
  )[0]!;

  assert.equal(field.kind, "COMPOSITE");
});

test("derived helper result maps DERIVED", () => {
  const field = extract(
    "{formatDate(record.createdAt)}"
  )[0]!;

  assert.equal(field.kind, "DERIVED");
  assert.deepEqual(field.sourceFields, [
    "record.createdAt",
  ]);
});

test("local fallback initializer retains its source field", () => {
  const fields =
    extractCardFieldProvenanceFromSource({
      file: "src/Card.tsx",
      componentName: "Card",
      source: `
        const Card = ({ record }) => {
          const description = record.description?.trim() || "None";
          return <p>{description}</p>;
        };
      `,
    });

  assert.equal(fields[0]?.kind, "FALLBACK");
  assert.deepEqual(fields[0]?.sourceFields, [
    "record.description",
  ]);
});

test("unrelated literal property is not emitted", () => {
  assert.deepEqual(
    extract("Static card copy"),
    []
  );
});

test("bounded source provenance is retained", () => {
  const field = extract("{record.createdAt}")[0]!;

  assert.deepEqual(field.sourceRef, {
    file: "src/Card.tsx",
    line: 3,
    symbol: "Card",
  });
  assert.ok(field.sourceExpression.length < 240);
});

test("source commit reference is bounded", () => {
  const field =
    extractCardFieldProvenanceFromSource({
      file: "src/Card.tsx",
      componentName: "Card",
      sourceCommitRef:
        "0123456789abcdef0123456789abcdef01234567",
      source:
        "const Card=({record})=><time>{record.createdAt}</time>",
    })[0]!;

  assert.equal(
    field.sourceCommitRef,
    "0123456789abcdef0123456789abcdef01234567"
  );
});

test("same source produces deterministic provenance", () => {
  assert.deepEqual(
    extract("{record.createdAt}"),
    extract("{record.createdAt}")
  );
});

test("unsupported ordinary span has no runtime locator", () => {
  const field = extract(
    "{record.createdAt}",
    "span"
  )[0]!;

  assert.equal(field.runtimeLocator, undefined);
});

test("exact semantic status role supplies a bounded locator", () => {
  const field =
    extractCardFieldProvenanceFromSource({
      file: "src/Card.tsx",
      componentName: "Card",
      source:
        'const Card=({status})=><span role="status">{status}</span>',
    })[0]!;

  assert.equal(field.valueKind, "ENUM");
  assert.equal(
    field.runtimeLocator?.selector,
    '[role="status"]'
  );
});

test("conditional field visibility is retained", () => {
  const field =
    extractCardFieldProvenanceFromSource({
      file: "src/Card.tsx",
      componentName: "Card",
      source:
        "const Card=({record,show})=><div>{show && <time>{record.createdAt}</time>}</div>",
    })[0]!;

  assert.equal(field.visibility, "CONDITIONAL");
});

test("source byte bound fails safe", () => {
  assert.deepEqual(
    extractCardFieldProvenanceFromSource({
      file: "src/Card.tsx",
      source: " ".repeat(2_000),
      maxSourceBytes: 1_024,
    }),
    []
  );
});

test("actual card exposes title and description runtime mappings only", () => {
  const declaration =
    discoverFrontendCardCollectionDeclarations()[0]!;
  const runtimeFields =
    declaration.cardFields?.filter(
      (field) => field.runtimeLocator
    ) ?? [];

  assert.deepEqual(
    runtimeFields.map((field) => ({
      field: field.observationField,
      kind: field.kind,
      selector: field.runtimeLocator?.selector,
    })),
    [
      {
        field: "visibleItemName",
        kind: "DIRECT",
        selector: "h3",
      },
      {
        field: "description",
        kind: "FALLBACK",
        selector: "p",
      },
    ]
  );
});

test("actual card has no runtime-groundable recency or proctoring field", () => {
  const fields =
    discoverFrontendCardCollectionDeclarations()[0]!
      .cardFields ?? [];

  assert.equal(
    fields.some(
      (field) =>
        field.valueKind === "DATE_TIME" &&
        Boolean(field.runtimeLocator)
    ),
    false
  );
  assert.equal(
    fields.some(
      (field) =>
        /proctor/i.test(
          field.sourceFields.join(" ")
        ) && Boolean(field.runtimeLocator)
    ),
    false
  );
});

test("extractor implementation has no external evidence authority", () => {
  const source = readFileSync(
    new URL(
      "./frontend-card-field-provenance.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /screenshot|llm|backend.?id|AS-1398/i
  );
});
