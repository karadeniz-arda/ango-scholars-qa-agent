import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discoverFrontendCardCollectionDeclarations,
  extractSourceCardCollectionCandidates,
} from "./frontend-card-collection-provenance.js";

const supportedSource = `
  import ItemCard from "./ItemCard";
  import { Grid } from "./Grid";
  export const RecordsView = ({ items }) => (
    <Grid>
      {items.map((item) => (
        <ItemCard
          key={item.id}
          record={item.record}
          status={item.status}
        />
      ))}
    </Grid>
  );
`;

test("direct map to one imported item component yields a source candidate", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: supportedSource,
      file: "src/modules/talent/records/RecordsView.tsx",
    });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.iterationKind, "ARRAY_MAP");
  assert.equal(result[0]?.itemComponentName, "ItemCard");
  assert.equal(result[0]?.runtimeContainerComponent, "Grid");
});

test("source item expression and props are retained without source blobs", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: supportedSource,
      file: "src/modules/talent/records/RecordsView.tsx",
    })[0]!;

  assert.equal(result.sourceItemExpression, "items");
  assert.deepEqual(result.itemProps, [
    { name: "record", sourceExpression: "item.record" },
    { name: "status", sourceExpression: "item.status" },
  ]);
  assert.equal(JSON.stringify(result).includes(supportedSource), false);
});

test("React source key is retained as source provenance", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: supportedSource,
      file: "src/modules/talent/records/RecordsView.tsx",
    })[0]!;

  assert.equal(result.sourceItemKeyExpression, "item.id");
});

test("sourceRef is bounded and line-addressable", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: supportedSource,
      file: "src/modules/talent/records/RecordsView.tsx",
    })[0]!;

  assert.match(result.sourceRef, /RecordsView\.tsx:\d+$/);
  assert.ok(result.sourceRef.length < 320);
});

test("native repeated JSX does not create a source card declaration", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: `const View = ({items}) => <div>{items.map(item => <div>{item.name}</div>)}</div>;`,
      file: "src/View.tsx",
    });

  assert.deepEqual(result, []);
});

test("dynamic render callback fails safe", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: `const View = ({items}) => <Grid>{items.map(item => renderItem(item))}</Grid>;`,
      file: "src/View.tsx",
    });

  assert.deepEqual(result, []);
});

test("fragment and multi-item map return fails safe", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: `import Card from "./Card"; const View = ({items}) => <Grid>{items.map(item => <><Card/><Card/></>)}</Grid>;`,
      file: "src/View.tsx",
    });

  assert.deepEqual(result, []);
});

test("unrelated card label string cannot create a declaration", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: `const text = "ItemCard items.map role button h3";`,
      file: "src/View.tsx",
    });

  assert.deepEqual(result, []);
});

test("oversized source fails safe", () => {
  const result =
    extractSourceCardCollectionCandidates({
      source: supportedSource + "x".repeat(5_000),
      file: "src/View.tsx",
      maxSourceBytes: 1_024,
    });

  assert.deepEqual(result, []);
});

test("candidate extraction is deterministic", () => {
  const input = {
    source: supportedSource,
    file: "src/modules/talent/records/RecordsView.tsx",
  };

  assert.deepEqual(
    extractSourceCardCollectionCandidates(input),
    extractSourceCardCollectionCandidates(input)
  );
});

test("actual Scholars assessment map resolves one authoritative declaration", () => {
  const declarations =
    discoverFrontendCardCollectionDeclarations();
  const assessmentDeclarations =
    declarations.filter(
      (item) =>
        item.surface.route ===
        "/talent/assessments"
    );

  assert.equal(assessmentDeclarations.length, 1);
  assert.equal(assessmentDeclarations[0]?.authoritative, true);
  assert.equal(
    assessmentDeclarations[0]?.iterationKind,
    "ARRAY_MAP"
  );
});

test("actual declaration retains collection and item component refs", () => {
  const declaration =
    discoverFrontendCardCollectionDeclarations()
      .find(
        (item) =>
          item.surface.route ===
          "/talent/assessments"
      )!;

  assert.equal(
    declaration.collectionComponentRef.symbol,
    "TalentAssessmentsCardView"
  );
  assert.equal(
    declaration.itemComponentRef.symbol,
    "TalentAssessmentCard"
  );
});

test("actual declaration keeps source key distinct from runtime identity", () => {
  const declaration =
    discoverFrontendCardCollectionDeclarations()[0]!;

  assert.deepEqual(declaration.sourceItemKey, {
    expression: "item.id",
    available: true,
  });
  assert.equal(
    "runtimeIdentity" in declaration.sourceItemKey!,
    false
  );
});

test("actual declaration derives the runtime signature from component source", () => {
  const signature =
    discoverFrontendCardCollectionDeclarations()[0]!
      .runtimeSignature;

  assert.deepEqual(
    {
      role: signature.itemRole,
      focusable: signature.focusable,
      heading: signature.headingTag,
      headingCount: signature.exactHeadingCount,
      actionButtons: signature.minimumNestedActionButtons,
      ownership: signature.containerOwnership,
    },
    {
      role: "button",
      focusable: true,
      heading: "h3",
      headingCount: 1,
      actionButtons: 1,
      ownership: "DIRECT_CHILDREN",
    }
  );
  assert.ok(signature.sourceRefs.length >= 4);
});

test("only the source-backed h3 field is declared", () => {
  const fields =
    discoverFrontendCardCollectionDeclarations()[0]!
      .visibleFields;

  assert.deepEqual(fields.map((item) => item.observationField), [
    "visibleItemName",
  ]);
  assert.equal(fields[0]?.sourceExpression, "assessment.title");
});

test("pagination association retains source component provenance only", () => {
  const pagination =
    discoverFrontendCardCollectionDeclarations()[0]!
      .pagination;

  assert.match(
    pagination?.sourceRef ?? "",
    /TalentAssessmentsView\.tsx#AppPagination$/
  );
});

test("source commit ref is bounded when the client checkout provides one", () => {
  const sourceCommitRef =
    discoverFrontendCardCollectionDeclarations()[0]!
      .sourceCommitRef;

  assert.match(sourceCommitRef ?? "", /^[0-9a-f]{40}$/);
});
