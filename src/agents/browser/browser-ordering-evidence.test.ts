import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserOrderingRequirement,
} from "../../planner/types.js";
import {
  buildOrderingRequirements,
} from "../../planner/planner-browser-policy.js";
import type {
  BrowserObservation,
  BrowserObservedCollection,
} from "./browser-observation.js";
import {
  evaluateBrowserOrderingRequirement,
  summarizeBrowserOrderingEvidenceParity,
} from "./browser-ordering-evidence.js";
import type {
  FrontendVisibleFieldProvenance,
} from "../../discovery/frontend-visible-field-provenance.js";
import {
  auditBrowserOrderingEvidenceParity,
  reconcileBrowserResultFromEvidence,
} from "./browser-result-reconciliation.js";

function requirement(
  overrides: Partial<BrowserOrderingRequirement> = {}
): BrowserOrderingRequirement {
  const result: BrowserOrderingRequirement = {
    kind: "ORDERING",
    requirementId: "web-1-ordering-1",
    sourceClaim: "Records are newest first.",
    semanticDimension: "RECENCY",
    direction: "DESC",
    comparisonType: "DATE_TIME",
    collectionHint: "records",
    fieldHint: "createdAt",
    ...overrides,
  };

  if (
    !Object.prototype.hasOwnProperty.call(
      overrides,
      "proofFieldBinding"
    )
  ) {
    const semanticDimension =
      result.semanticDimension ??
      (result.comparisonType === "DATE_TIME"
        ? "RECENCY"
        : result.comparisonType === "NUMERIC"
          ? "NUMERIC_MAGNITUDE"
          : "LEXICAL_ORDER");
    const proposedField =
      result.fieldHint ?? "createdAt";
    result.proofFieldBinding = {
      bindingId:
        `synthetic-binding-${proposedField}`,
      requirementId: result.requirementId,
      semanticDimension,
      proposedField,
      proposalSource: "AC_EXPLICIT",
      authority: "AUTHORITATIVE",
      sourceRef: "jira.acceptanceCriteria#synthetic",
    };
  }

  return result;
}

function collection(
  values: string[],
  overrides: Partial<BrowserObservedCollection> = {},
  visibleLabel = "Created At"
): BrowserObservedCollection {
  const label = overrides.label ?? "Records";
  const collectionId =
    `collection:table:aria_name:${label.toLowerCase()}`;
  const visibleFieldId =
    `${collectionId}:field:${visibleLabel.toLowerCase().replace(/\s+/g, "-")}`;

  return {
    collectionId,
    shape: "TABLE",
    label,
    identity: {
      method: "ARIA_NAME",
      sourceText: label,
    },
    fields: [
      {
        visibleLabel,
        visibleFieldId,
        provenance: {
          method: "NATIVE_TH",
          sourceText: visibleLabel,
        },
      },
    ],
    rows: values.map((rawValue, sequencePosition) => ({
      sequencePosition,
      rowSequenceObserved: true,
      rowIdentityStatus: "UNAVAILABLE",
      rowIdentityReason: "ROW_IDENTITY_UNAVAILABLE",
      cells: [
        {
          visibleFieldId,
          rawValue,
          provenance: { method: "NATIVE_TD" },
        },
      ],
      provenance: { method: "NATIVE_TR" },
    })),
    provenance: {
      method: "NATIVE_TABLE",
      rowSequenceObserved: true,
      rowsTruncated: false,
    },
    ...overrides,
  };
}

function observation(
  collections: BrowserObservedCollection[]
): BrowserObservation {
  return {
    url: "https://example.test/records",
    title: "Records",
    headings: [],
    controls: [],
    inputs: [],
    surfaces: [],
    collections,
    visibleText: [],
    counts: {
      headings: 0,
      controls: 0,
      inputs: 0,
      surfaces: 0,
      collections: collections.length,
      visibleText: 0,
    },
  };
}

function directProvenance(
  visibleLabel: string,
  sourceField: string
): FrontendVisibleFieldProvenance {
  return {
    visibleLabel,
    sourceFields: [sourceField],
    kind: "DIRECT",
    sourceRef: {
      file: "src/components/RecordsTable.tsx",
      line: 10,
      symbol: "columns",
    },
    authoritative: true,
    reason:
      "Synthetic authoritative direct accessor.",
  };
}

function proofBinding(args: {
  field?: string;
  authority?: "AUTHORITATIVE" | "CANDIDATE";
  proposalSource?:
    | "AC_EXPLICIT"
    | "IMPLEMENTATION_DERIVED"
    | "PLANNER_HEURISTIC";
} = {}) {
  const field = args.field ?? "createdAt";
  const authority = args.authority ?? "AUTHORITATIVE";
  return {
    bindingId: `binding-${field}-${authority}`,
    requirementId: "web-1-ordering-1",
    semanticDimension: "RECENCY" as const,
    proposedField: field,
    proposalSource:
      args.proposalSource ??
      (authority === "AUTHORITATIVE"
        ? "AC_EXPLICIT"
        : "PLANNER_HEURISTIC"),
    authority,
  } as const;
}

function evaluate(
  values: string[],
  requirementOverrides: Partial<BrowserOrderingRequirement> = {},
  collectionOverrides: Partial<BrowserObservedCollection> = {}
) {
  const fieldHint = String(
    requirementOverrides.fieldHint ??
      "createdAt"
  );
  const visibleLabel = fieldHint.replace(
    /([a-z0-9])([A-Z])/g,
    "$1 $2"
  );

  return evaluateBrowserOrderingRequirement({
    requirement: requirement(requirementOverrides),
    observation: observation([
      collection(
        values,
        collectionOverrides,
        visibleLabel
      ),
    ]),
    visibleFieldProvenance: [
      directProvenance(
        visibleLabel,
        fieldHint
      ),
    ],
  });
}

test("one grounded collection and exact field produces evidence", () => {
  assert.equal(
    evaluate(["2026-02-02", "2026-01-01"]).status,
    "CONFIRMED"
  );
});

test("authoritative direct binding permits comparison", () => {
  const result = evaluate(
    ["2026-02-02", "2026-01-01"],
    { proofFieldBinding: proofBinding() }
  );
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.proofFieldAuthority, "AUTHORITATIVE");
});

test("AC-explicit semantic contract reaches direct comparator without verdict authority", () => {
  const claim = "Records are sorted by updatedAt descending.";
  const [contract] = buildOrderingRequirements(
    [claim],
    "web-1",
    {
      acceptanceSourceLedger: {
        sourceStatus: "RESOLVED",
        basis: "ACCEPTANCE_CRITERIA",
        sourceUnits: [{
          id: "jira-req-updated-at",
          sourceKind: "ACCEPTANCE_CRITERIA",
          sourceRef: "jira.acceptanceCriteria[0]",
          text: claim,
        }],
      },
      acceptanceObligationLedger: {
        sourceStatus: "RESOLVED",
        derivationStatus: "RESOLVED",
        obligations: [{
          id: "jira-obligation-updated-at",
          sourceUnitIds: ["jira-req-updated-at"],
          sourceRole: "ACCEPTANCE",
          derivation: "DIRECT_ACCEPTANCE_FIELD",
          text: claim,
        }],
        unresolvedSourceUnitIds: [],
      },
    }
  );
  assert.ok(contract);
  const result = evaluateBrowserOrderingRequirement({
    requirement: contract,
    observation: observation([
      collection(
        ["2026-02-02", "2026-01-01"],
        {},
        "Updated At"
      ),
    ]),
    visibleFieldProvenance: [
      directProvenance("Updated At", "updatedAt"),
    ],
  });
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.proofFieldAuthority, "AUTHORITATIVE");
  assert.equal((result as any).deterministicEvidence, undefined);
  assert.equal((result as any).finalStatus, undefined);
});

test("candidate direct binding blocks comparison before values are read", () => {
  const result = evaluate(
    ["2026-02-02", "2026-01-01"],
    {
      proofFieldBinding: proofBinding({
        authority: "CANDIDATE",
      }),
    }
  );
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
  assert.deepEqual(result.values, []);
});

test("authoritative fallback mapping still blocks comparison", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement({
      fieldHint: "updatedAt",
      proofFieldBinding: proofBinding({ field: "updatedAt" }),
    }),
    observation: observation([
      collection(["2026-02-02", "2026-01-01"], {}, "Last updated"),
    ]),
    visibleFieldProvenance: [
      {
        ...directProvenance("Last updated", "updatedAt"),
        kind: "FALLBACK",
        sourceFields: ["createdAt", "updatedAt"],
      },
    ],
  });
  assert.equal(result.reason, "FIELD_MAPPING_FALLBACK");
  assert.deepEqual(result.values, []);
});

test("candidate fallback stops at binding authority gate", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement({
      fieldHint: "updatedAt",
      proofFieldBinding: proofBinding({
        field: "updatedAt",
        authority: "CANDIDATE",
      }),
    }),
    observation: observation([
      collection(["2026-02-02", "2026-01-01"], {}, "Last updated"),
    ]),
    visibleFieldProvenance: [
      {
        ...directProvenance("Last updated", "updatedAt"),
        kind: "FALLBACK",
        sourceFields: ["createdAt", "updatedAt"],
      },
    ],
  });
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
  assert.equal(result.mappingResolutionStatus, undefined);
});

test("collection grounding failure precedes binding evaluation", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement({ proofFieldBinding: proofBinding() }),
    observation: observation([]),
  });
  assert.equal(result.reason, "COLLECTION_NOT_GROUNDED");
});

test("legacy field hint is treated as candidate rather than authority", () => {
  const legacyRequirement = requirement();
  delete legacyRequirement.proofFieldBinding;
  const result = evaluateBrowserOrderingRequirement({
    requirement: legacyRequirement,
    observation: observation([
      collection(["2026-02-02", "2026-01-01"]),
    ]),
    visibleFieldProvenance: [
      directProvenance("Created At", "createdAt"),
    ],
  });
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
  assert.equal(result.proofFieldProposalSource, "PLANNER_HEURISTIC");
  assert.deepEqual(result.values, []);
});

test("implementation-derived proposal cannot pass the authority gate", () => {
  const result = evaluate(
    ["2026-02-02", "2026-01-01"],
    {
      proofFieldBinding: proofBinding({
        authority: "CANDIDATE",
        proposalSource: "IMPLEMENTATION_DERIVED",
      }),
    }
  );
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
  assert.equal(result.proofFieldProposalSource, "IMPLEMENTATION_DERIVED");
});

test("model prose cannot upgrade a candidate binding", () => {
  const result = evaluate(
    ["2026-02-02", "2026-01-01"],
    {
      sourceClaim: "The model says updatedAt is authoritative.",
      proofFieldBinding: proofBinding({ authority: "CANDIDATE" }),
    }
  );
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("binding identity mismatch fails safe", () => {
  const result = evaluate(
    ["2026-02-02", "2026-01-01"],
    {
      proofFieldBinding: {
        ...proofBinding(),
        requirementId: "another-requirement",
      },
    }
  );
  assert.equal(result.reason, "FIELD_BINDING_NOT_AUTHORITATIVE");
});

test("multiple matching collections are ambiguous", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement(),
    observation: observation([
      collection(["2026-02-02", "2026-01-01"]),
      collection(["2026-02-02", "2026-01-01"]),
    ]),
  });
  assert.equal(result.reason, "AMBIGUOUS_COLLECTION");
});

test("fewer than two rows is unavailable", () => {
  assert.equal(
    evaluate(["2026-02-02"]).reason,
    "INSUFFICIENT_ROWS"
  );
});

test("missing field in one row is unavailable", () => {
  const candidate = collection(["2026-02-02", "2026-01-01"]);
  candidate.rows[1]!.cells[0]!.visibleFieldId =
    "missing-field";
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement(),
    observation: observation([candidate]),
    visibleFieldProvenance: [
      directProvenance(
        "Created At",
        "createdAt"
      ),
    ],
  });
  assert.equal(result.reason, "FIELD_NOT_GROUNDED");
});

test("visible field without authoritative source mapping is unavailable", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement({ fieldHint: "updatedAt" }),
    observation: observation([
      collection(
        ["3 days ago", "4 days ago"],
        {},
        "Last updated"
      ),
    ]),
  });

  assert.equal(
    result.reason,
    "NO_AUTHORITATIVE_FIELD_MAPPING"
  );
  assert.equal(result.collectionLabel, "Records");
  assert.deepEqual(result.visibleFields, ["Last updated"]);
  assert.deepEqual(result.values, []);
});

test("duplicate matching fields in one row are ambiguous", () => {
  const candidate = collection(["2026-02-02", "2026-01-01"]);
  candidate.fields.push({
    visibleLabel: "Created At",
    visibleFieldId: "duplicate-created-at",
    provenance: {
      method: "NATIVE_TH",
      sourceText: "Created At",
    },
  });
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement(),
    observation: observation([candidate]),
    visibleFieldProvenance: [
      directProvenance(
        "Created At",
        "createdAt"
      ),
    ],
  });
  assert.equal(
    result.reason,
    "FIELD_MAPPING_AMBIGUOUS"
  );
});

test("duplicate field labels in separate collections are not merged", () => {
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement({ collectionHint: "jobs" }),
    observation: observation([
      collection(["2026-02-02"], { label: "Jobs" }),
      collection(["2026-01-01"], { label: "Archive" }),
    ]),
  });
  assert.equal(result.reason, "INSUFFICIENT_ROWS");
});

test("unlabelled arbitrary page text is never a collection fallback", () => {
  const source = observation([]);
  source.visibleText = ["2026-02-02", "2026-01-01"];
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement(),
    observation: source,
  });
  assert.equal(result.reason, "COLLECTION_NOT_GROUNDED");
});

[
  {
    name: "descending ISO dates confirm",
    values: ["2026-02-02", "2026-01-01"],
    direction: "DESC" as const,
    status: "CONFIRMED",
  },
  {
    name: "ascending ISO dates confirm",
    values: ["2026-01-01", "2026-02-02"],
    direction: "ASC" as const,
    status: "CONFIRMED",
  },
  {
    name: "ascending data fails descending requirement",
    values: ["2026-01-01", "2026-02-02"],
    direction: "DESC" as const,
    status: "FAILED",
  },
  {
    name: "descending data fails ascending requirement",
    values: ["2026-02-02", "2026-01-01"],
    direction: "ASC" as const,
    status: "FAILED",
  },
  {
    name: "equal adjacent dates are allowed",
    values: ["2026-02-02", "2026-02-02"],
    direction: "DESC" as const,
    status: "CONFIRMED",
  },
].forEach((scenario) => {
  test(scenario.name, () => {
    assert.equal(
      evaluate(scenario.values, {
        direction: scenario.direction,
      }).status,
      scenario.status
    );
  });
});

test("invalid calendar date is unavailable", () => {
  assert.equal(
    evaluate(["2026-02-31", "2026-01-01"]).reason,
    "VALUE_PARSE_FAILED"
  );
});

test("invalid English calendar date is unavailable", () => {
  assert.equal(
    evaluate(["February 31, 2026", "January 1, 2026"]).reason,
    "VALUE_PARSE_FAILED"
  );
});

test("ambiguous slash date format is unavailable", () => {
  assert.equal(
    evaluate(["02/03/2026", "01/03/2026"]).reason,
    "VALUE_PARSE_FAILED"
  );
});

test("supported English month dates compare deterministically", () => {
  assert.equal(
    evaluate(["February 2, 2026", "Jan 1, 2026"]).status,
    "CONFIRMED"
  );
});

[
  ["numeric ascending confirms", ["1", "2", "2,000"], "ASC", "CONFIRMED"],
  ["numeric descending confirms", ["2,000", "2", "1"], "DESC", "CONFIRMED"],
  ["incorrect numeric order fails", ["1", "3", "2"], "ASC", "FAILED"],
] .forEach(([name, values, direction, status]) => {
  test(name as string, () => {
    assert.equal(
      evaluate(values as string[], {
        comparisonType: "NUMERIC",
        fieldHint: "score",
        direction: direction as "ASC" | "DESC",
      }).status,
      status
    );
  });
});

test("malformed numeric value is unavailable", () => {
  const result = evaluate(["12", "12 points"], {
    comparisonType: "NUMERIC",
    fieldHint: "score",
  });
  assert.equal(result.reason, "VALUE_PARSE_FAILED");
});

[
  ["lexical ascending confirms", ["Alpha", "beta"], "ASC", "CONFIRMED"],
  ["lexical descending confirms", ["beta", "Alpha"], "DESC", "CONFIRMED"],
  ["lexical normalization handles case and whitespace", ["  ALPHA ", "alpha", " Beta"], "ASC", "CONFIRMED"],
] .forEach(([name, values, direction, status]) => {
  test(name as string, () => {
    const result = evaluate(values as string[], {
      comparisonType: "LEXICAL",
      fieldHint: "name",
      direction: direction as "ASC" | "DESC",
    });
    assert.equal(result.status, status);
  });
});

test("evidence retains exact compared visible values", () => {
  const values = ["2026-02-02", "2026-01-01"];
  assert.deepEqual(evaluate(values).values, values);
});

test("evidence values are bounded to twenty rows", () => {
  const values = Array.from({ length: 25 }, (_, index) =>
    `2026-01-${String(25 - index).padStart(2, "0")}`
  );
  assert.equal(evaluate(values).values.length, 20);
});

test("evidence does not serialize page-wide visible text", () => {
  const source = observation([
    collection(["2026-02-02", "2026-01-01"]),
  ]);
  source.visibleText = ["SECRET PAGE-WIDE SENTINEL"];
  const result = evaluateBrowserOrderingRequirement({
    requirement: requirement(),
    observation: source,
  });
  assert.equal(JSON.stringify(result).includes("SENTINEL"), false);
});

test("ordering evidence output is deterministic", () => {
  assert.deepEqual(
    evaluate(["2026-02-02", "2026-01-01"]),
    evaluate(["2026-02-02", "2026-01-01"])
  );
});

test("missing evidence produces unavailable parity", () => {
  assert.equal(
    summarizeBrowserOrderingEvidenceParity({
      requirements: [requirement()],
      evidence: [],
    }).status,
    "ORDERING_EVIDENCE_UNAVAILABLE"
  );
});

test("selected-state evidence alone cannot confirm ordering", () => {
  assert.equal(
    auditBrowserOrderingEvidenceParity({
      testCase: { acceptanceScope: { orderingRequirements: [requirement()] } },
      currentResult: { deterministicEvidence: [{ action: "selectOption", passed: true }] },
    })?.status,
    "ORDERING_EVIDENCE_UNAVAILABLE"
  );
});

for (const source of ["screenshot", "URL", "navigation"]) {
  test(`${source} evidence cannot confirm ordering`, () => {
    assert.equal(
      auditBrowserOrderingEvidenceParity({
        testCase: { acceptanceScope: { orderingRequirements: [requirement()] } },
        currentResult: { [source]: true },
      })?.status,
      "ORDERING_EVIDENCE_UNAVAILABLE"
    );
  });
}

test("confirmed evidence produces confirmed observational parity", () => {
  const evidence = evaluate(["2026-02-02", "2026-01-01"]);
  assert.equal(
    summarizeBrowserOrderingEvidenceParity({
      requirements: [requirement()],
      evidence: [evidence],
    }).status,
    "ORDERING_EVIDENCE_CONFIRMED"
  );
});

test("failed evidence produces failed observational parity", () => {
  const evidence = evaluate(["2026-01-01", "2026-02-02"]);
  assert.equal(
    summarizeBrowserOrderingEvidenceParity({
      requirements: [requirement()],
      evidence: [evidence],
    }).status,
    "ORDERING_EVIDENCE_FAILED"
  );
});

test("confirmed ordering cannot upgrade MANUAL_REQUIRED to PASS", () => {
  const currentResult: any = {
    status: "MANUAL_REQUIRED",
    reasonCategory: "AUTOMATION_LIMITATION",
    successSignalReached: false,
    orderingEvidence: [
      evaluate(["2026-02-02", "2026-01-01"]),
    ],
  };
  reconcileBrowserResultFromEvidence({
    currentResult,
    testCase: {
      goal: "Records are newest first.",
      successCriteria: "Records are newest first.",
      manualChecks: ["Verify resulting order."],
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [],
        orderingRequirements: [requirement()],
      },
    },
    review: { verdict: "PASS_CONFIRMED", confidence: "high" },
    source: "screenshot",
  });
  assert.equal(currentResult.status, "MANUAL_REQUIRED");
  assert.equal(
    currentResult.orderingEvidenceParity.status,
    "ORDERING_EVIDENCE_CONFIRMED"
  );
});

test("failed ordering remains outside deterministic assertion failure routing", () => {
  const failed = evaluate(["2026-01-01", "2026-02-02"]);
  assert.equal(failed.status, "FAILED");
  assert.equal((failed as any).action, undefined);
});
