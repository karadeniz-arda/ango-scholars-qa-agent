import { createHash } from "node:crypto";

import type {
  BrowserOrderingProofFieldBinding,
  BrowserOrderingRequirement,
} from "../../planner/types.js";
import type {
  BrowserObservation,
  BrowserObservedCollection,
} from "./browser-observation.js";
import {
  resolveVisibleFieldProvenance,
  type FrontendVisibleFieldProvenance,
  type VisibleFieldResolution,
  type VisibleFieldSourceRef,
} from "../../discovery/frontend-visible-field-provenance.js";

export type BrowserOrderingEvidenceUnavailableReason =
  | "COLLECTION_NOT_GROUNDED"
  | "AMBIGUOUS_COLLECTION"
  | "COLLECTION_EMPTY"
  | "COLLECTION_LOADING"
  | "SCHEMA_NOT_GROUNDED"
  | "FIELD_SCHEMA_AMBIGUOUS"
  | "ROW_STRUCTURE_NOT_GROUNDED"
  | "FIELD_BINDING_NOT_AUTHORITATIVE"
  | "NO_AUTHORITATIVE_FIELD_MAPPING"
  | "VISIBLE_FIELD_NOT_GROUNDED"
  | "FIELD_MAPPING_AMBIGUOUS"
  | "FIELD_MAPPING_FALLBACK"
  | "FIELD_MAPPING_COMPOSITE"
  | "FIELD_MAPPING_DERIVED"
  | "FIELD_MAPPING_UNRESOLVED"
  | "FIELD_NOT_GROUNDED"
  | "AMBIGUOUS_FIELD"
  | "INSUFFICIENT_ROWS"
  | "VALUE_PARSE_FAILED";

export type BrowserOrderingEvidence = {
  kind: "ORDERING";
  requirementId: string;
  sourceClaim: string;
  semanticDimension?:
    BrowserOrderingRequirement["semanticDimension"];
  direction: "ASC" | "DESC";
  comparisonType:
    | "DATE_TIME"
    | "NUMERIC"
    | "LEXICAL";
  status:
    | "CONFIRMED"
    | "FAILED"
    | "UNAVAILABLE";
  passed: boolean | null;
  collectionLabel?: string;
  collectionId?: string;
  collectionShape?: "TABLE" | "GRID" | "CARD";
  collectionIdentityMethod?: string;
  visibleFields?: string[];
  requirementField?: string;
  proofFieldBindingId?: string;
  proofField?: string;
  proofFieldProposalSource?:
    BrowserOrderingProofFieldBinding["proposalSource"];
  proofFieldAuthority?:
    BrowserOrderingProofFieldBinding["authority"];
  proofFieldSourceRef?: string;
  field?: string;
  mappingResolutionStatus?:
    VisibleFieldResolution["status"];
  mappingKind?:
    FrontendVisibleFieldProvenance["kind"];
  mappingSourceFields?: string[];
  mappingSourceRef?: VisibleFieldSourceRef;
  mappingSourceCommitRef?: string;
  values: string[];
  rowCount: number;
  groundedRowIdentityCount?: number;
  rowSequenceObserved?: boolean;
  itemSequenceObserved?: boolean;
  reason?: BrowserOrderingEvidenceUnavailableReason;
  note: string;
  stepIndex?: number;
};

export type BrowserOrderingEvidenceParity = {
  status:
    | "ORDERING_EVIDENCE_CONFIRMED"
    | "ORDERING_EVIDENCE_FAILED"
    | "ORDERING_EVIDENCE_UNAVAILABLE";
  requiredCount: number;
  confirmedCount: number;
  failedCount: number;
  unavailableCount: number;
  missingRequirementIds: string[];
};

const MAX_EVIDENCE_VALUES = 20;

function normalizeSemanticLabel(value: unknown): string {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectionMatches(
  collection: BrowserObservedCollection,
  hint: string | undefined
): boolean {
  if (!hint) {
    return true;
  }

  const normalizedHint =
    normalizeSemanticLabel(hint);
  const normalizedLabel =
    normalizeSemanticLabel(
      collection.identity.sourceText
    );

  return Boolean(
    normalizedLabel &&
    (
      normalizedLabel === normalizedHint ||
      normalizedLabel
        .split(" ")
        .includes(normalizedHint) ||
      normalizedHint
        .split(" ")
        .includes(normalizedLabel)
    )
  );
}

function findFieldValues(args: {
  collection: BrowserObservedCollection;
  resolution: VisibleFieldResolution;
}):
  | { values: string[]; field: string }
  | { reason: BrowserOrderingEvidenceUnavailableReason } {
  if (
    args.resolution.status !==
      "DIRECT_MATCH" ||
    !args.resolution.visibleFieldId ||
    !args.resolution.visibleField
  ) {
    return { reason: "FIELD_NOT_GROUNDED" };
  }
  const values: string[] = [];

  for (const row of args.collection.rows) {
    const matches = row.cells.filter(
      (cell) =>
        cell.visibleFieldId ===
        args.resolution.visibleFieldId
    );

    if (matches.length === 0) {
      return { reason: "FIELD_NOT_GROUNDED" };
    }

    if (matches.length > 1) {
      return { reason: "AMBIGUOUS_FIELD" };
    }

    const match = matches[0]!;
    values.push(match.rawValue);
  }

  return {
    values,
    field: args.resolution.visibleField,
  };
}

function unavailableReasonForResolution(
  resolution: VisibleFieldResolution
): BrowserOrderingEvidenceUnavailableReason | null {
  switch (resolution.status) {
    case "DIRECT_MATCH":
      return null;
    case "NO_AUTHORITATIVE_MAPPING":
      return "NO_AUTHORITATIVE_FIELD_MAPPING";
    case "VISIBLE_FIELD_NOT_GROUNDED":
      return "VISIBLE_FIELD_NOT_GROUNDED";
    case "AMBIGUOUS_MAPPING":
      return "FIELD_MAPPING_AMBIGUOUS";
    case "FALLBACK_SOURCE":
      return "FIELD_MAPPING_FALLBACK";
    case "COMPOSITE_SOURCE":
      return "FIELD_MAPPING_COMPOSITE";
    case "DERIVED_SOURCE":
      return "FIELD_MAPPING_DERIVED";
    case "UNRESOLVED_SOURCE":
      return "FIELD_MAPPING_UNRESOLVED";
  }
}

function parseDateTime(value: string): number | null {
  const text = value.trim();
  const isoMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  );

  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));

    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }

    const hour = Number(isoMatch[4] ?? 0);
    const minute = Number(isoMatch[5] ?? 0);
    const second = Number(isoMatch[6] ?? 0);

    if (
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }

    const parsed = Date.parse(
      isoMatch[4] &&
      !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
        ? `${text}Z`
        : text
    );
    return Number.isFinite(parsed) ? parsed : null;
  }

  const englishDate = text.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?) (\d{1,2}), (\d{4})$/i
  );

  if (!englishDate) {
    return null;
  }

  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const month = monthNames.indexOf(
    englishDate[1]!.slice(0, 3).toLowerCase()
  );
  const day = Number(englishDate[2]);
  const year = Number(englishDate[3]);
  const probe = new Date(
    Date.UTC(year, month, day)
  );

  if (
    month < 0 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const parsed = probe.getTime();

  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumeric(value: string): number | null {
  const text = value.trim();

  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseComparable(
  value: string,
  comparisonType:
    BrowserOrderingRequirement["comparisonType"]
): number | string | null {
  if (comparisonType === "DATE_TIME") {
    return parseDateTime(value);
  }

  if (comparisonType === "NUMERIC") {
    return parseNumeric(value);
  }

  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

function compareValues(
  left: number | string,
  right: number | string
): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function unavailableEvidence(
  requirement: BrowserOrderingRequirement,
  reason: BrowserOrderingEvidenceUnavailableReason,
  details: Partial<BrowserOrderingEvidence> = {}
): BrowserOrderingEvidence {
  return {
    kind: "ORDERING",
    requirementId: requirement.requirementId,
    sourceClaim: requirement.sourceClaim,
    ...(requirement.semanticDimension
      ? {
          semanticDimension:
            requirement.semanticDimension,
        }
      : {}),
    direction: requirement.direction,
    comparisonType: requirement.comparisonType,
    status: "UNAVAILABLE",
    passed: null,
    values: [],
    rowCount: 0,
    reason,
    note: `Ordering evidence unavailable: ${reason}.`,
    ...details,
  };
}

function requirementBinding(
  requirement: BrowserOrderingRequirement,
  semanticDimension: NonNullable<
    BrowserOrderingRequirement["semanticDimension"]
  >
): BrowserOrderingProofFieldBinding | undefined {
  const legacyField =
    requirement.fieldHint?.trim();

  return requirement.proofFieldBinding ??
    (legacyField
      ? {
          bindingId:
            `ordering-binding-${createHash("sha256")
              .update(
                [
                  requirement.requirementId,
                  semanticDimension,
                  legacyField,
                  "PLANNER_HEURISTIC",
                ].join("\u0000")
              )
              .digest("hex")
              .slice(0, 12)}`,
          requirementId:
            requirement.requirementId,
          semanticDimension,
          proposedField: legacyField,
          proposalSource:
            "PLANNER_HEURISTIC",
          authority: "CANDIDATE",
        }
      : undefined);
}

function authoritativeBinding(
  binding:
    BrowserOrderingProofFieldBinding | undefined,
  requirement: BrowserOrderingRequirement,
  semanticDimension: NonNullable<
    BrowserOrderingRequirement["semanticDimension"]
  >
): binding is BrowserOrderingProofFieldBinding {
  return Boolean(
    binding &&
    binding.authority === "AUTHORITATIVE" &&
    binding.proposalSource === "AC_EXPLICIT" &&
    binding.requirementId ===
      requirement.requirementId &&
    binding.semanticDimension ===
      semanticDimension &&
    binding.proposedField.trim()
  );
}

function orderingPasses(args: {
  values: string[];
  requirement: BrowserOrderingRequirement;
}): boolean | null {
  const parsed = args.values.map(
    (value) =>
      parseComparable(
        value,
        args.requirement.comparisonType
      )
  );

  if (parsed.some((value) => value === null)) {
    return null;
  }

  return parsed.every((value, index) => {
    if (index === parsed.length - 1) {
      return true;
    }

    const comparison = compareValues(
      value as number | string,
      parsed[index + 1] as number | string
    );

    return args.requirement.direction === "ASC"
      ? comparison <= 0
      : comparison >= 0;
  });
}

function evaluateCardOrderingRequirement(args: {
  requirement: BrowserOrderingRequirement;
  collection: BrowserObservedCollection;
  stepIndex?: number;
}): BrowserOrderingEvidence {
  const collection = args.collection;
  const items = collection.items ?? [];
  const schema =
    collection.cardFieldSchema ?? [];
  const semanticDimension =
    args.requirement.semanticDimension ??
    (args.requirement.comparisonType === "DATE_TIME"
      ? "RECENCY"
      : args.requirement.comparisonType === "NUMERIC"
        ? "NUMERIC_MAGNITUDE"
        : "LEXICAL_ORDER");
  const expectedValueKind =
    args.requirement.comparisonType === "DATE_TIME"
      ? "DATE_TIME"
      : args.requirement.comparisonType === "NUMERIC"
        ? "NUMERIC"
        : "TEXT";
  const comparableSchema = schema.filter(
    (field) =>
      field.valueKind === expectedValueKind ||
      (
        expectedValueKind === "TEXT" &&
        field.valueKind === "ENUM"
      )
  );
  const common = {
    semanticDimension,
    collectionLabel: collection.label,
    collectionId: collection.collectionId,
    collectionShape: "CARD" as const,
    collectionIdentityMethod:
      collection.identity.method,
    visibleFields: schema.map(
      (field) => field.observationField
    ),
    rowCount: items.length,
    groundedRowIdentityCount: 0,
    rowSequenceObserved: false,
    itemSequenceObserved:
      collection.provenance
        .itemSequenceObserved === true,
    ...(args.stepIndex === undefined
      ? {}
      : { stepIndex: args.stepIndex }),
  };

  if (comparableSchema.length === 0) {
    return unavailableEvidence(
      args.requirement,
      "SCHEMA_NOT_GROUNDED",
      common
    );
  }

  if (items.length < 2) {
    return unavailableEvidence(
      args.requirement,
      "INSUFFICIENT_ROWS",
      common
    );
  }

  const binding = requirementBinding(
    args.requirement,
    semanticDimension
  );
  const bindingDetails = binding
    ? {
        proofFieldBindingId:
          binding.bindingId,
        proofField:
          binding.proposedField,
        proofFieldProposalSource:
          binding.proposalSource,
        proofFieldAuthority:
          binding.authority,
        ...(binding.sourceRef
          ? {
              proofFieldSourceRef:
                binding.sourceRef,
            }
          : {}),
      }
    : {};

  if (
    !authoritativeBinding(
      binding,
      args.requirement,
      semanticDimension
    )
  ) {
    return unavailableEvidence(
      args.requirement,
      "FIELD_BINDING_NOT_AUTHORITATIVE",
      {
        ...common,
        ...bindingDetails,
      }
    );
  }

  const matchingSchema = comparableSchema.filter(
    (field) =>
      field.sourceField ===
      binding.proposedField
  );

  if (matchingSchema.length !== 1) {
    return unavailableEvidence(
      args.requirement,
      matchingSchema.length > 1
        ? "FIELD_MAPPING_AMBIGUOUS"
        : "NO_AUTHORITATIVE_FIELD_MAPPING",
      {
        ...common,
        requirementField:
          binding.proposedField,
        ...bindingDetails,
      }
    );
  }

  const field = matchingSchema[0]!;
  const mappingReason:
    BrowserOrderingEvidenceUnavailableReason | null =
      field.mappingKind === "DIRECT"
        ? null
        : field.mappingKind === "FALLBACK"
          ? "FIELD_MAPPING_FALLBACK"
          : field.mappingKind === "COMPOSITE"
            ? "FIELD_MAPPING_COMPOSITE"
            : field.mappingKind === "DERIVED"
              ? "FIELD_MAPPING_DERIVED"
              : "FIELD_MAPPING_UNRESOLVED";
  const mappingDetails = {
    requirementField:
      binding.proposedField,
    field: field.observationField,
    mappingResolutionStatus:
      field.mappingKind === "DIRECT"
        ? "DIRECT_MATCH" as const
        : field.mappingKind === "FALLBACK"
          ? "FALLBACK_SOURCE" as const
          : field.mappingKind === "COMPOSITE"
            ? "COMPOSITE_SOURCE" as const
            : field.mappingKind === "DERIVED"
              ? "DERIVED_SOURCE" as const
              : "UNRESOLVED_SOURCE" as const,
    mappingKind: field.mappingKind,
    mappingSourceFields:
      field.sourceFields,
    mappingSourceRef: field.sourceRef,
    ...(field.sourceCommitRef
      ? {
          mappingSourceCommitRef:
            field.sourceCommitRef,
        }
      : {}),
    ...bindingDetails,
  };

  if (mappingReason) {
    return unavailableEvidence(
      args.requirement,
      mappingReason,
      {
        ...common,
        ...mappingDetails,
      }
    );
  }

  const values: string[] = [];

  for (const item of items) {
    const matches = item.fields.filter(
      (candidate) =>
        candidate.visibleFieldId ===
        field.visibleFieldId
    );

    if (matches.length !== 1) {
      return unavailableEvidence(
        args.requirement,
        matches.length > 1
          ? "AMBIGUOUS_FIELD"
          : "FIELD_NOT_GROUNDED",
        {
          ...common,
          ...mappingDetails,
        }
      );
    }

    values.push(matches[0]!.rawValue);
  }

  const passed = orderingPasses({
    values,
    requirement: args.requirement,
  });

  if (passed === null) {
    return unavailableEvidence(
      args.requirement,
      "VALUE_PARSE_FAILED",
      {
        ...common,
        ...mappingDetails,
        values: values.slice(
          0,
          MAX_EVIDENCE_VALUES
        ),
      }
    );
  }

  return {
    kind: "ORDERING",
    requirementId:
      args.requirement.requirementId,
    sourceClaim:
      args.requirement.sourceClaim,
    direction: args.requirement.direction,
    comparisonType:
      args.requirement.comparisonType,
    status: passed
      ? "CONFIRMED"
      : "FAILED",
    passed,
    ...common,
    ...mappingDetails,
    values: values.slice(
      0,
      MAX_EVIDENCE_VALUES
    ),
    note:
      `Compared ${items.length} grounded card-item values ` +
      `${args.requirement.direction} as ` +
      `${args.requirement.comparisonType}: ` +
      `${passed ? "confirmed" : "failed"}.`,
  };
}

export function evaluateBrowserOrderingRequirement(args: {
  requirement: BrowserOrderingRequirement;
  observation: BrowserObservation;
  visibleFieldProvenance?:
    FrontendVisibleFieldProvenance[];
  stepIndex?: number;
}): BrowserOrderingEvidence {
  const candidates =
    (args.observation.collections ?? []).filter(
      (collection) =>
        collectionMatches(
          collection,
          args.requirement.collectionHint
        )
    );

  if (candidates.length === 0) {
    const abstentions =
      args.observation
        .collectionAbstentions ?? [];
    const matchingAbstention =
      abstentions.find((item) => {
        if (!item.identity) {
          return false;
        }

        const syntheticCollection = {
          identity: item.identity,
        } as BrowserObservedCollection;

        return collectionMatches(
          syntheticCollection,
          args.requirement.collectionHint
        );
      });
    const supportedReason:
      BrowserOrderingEvidenceUnavailableReason | null =
      matchingAbstention &&
      matchingAbstention.reason !==
        "COLLECTION_AMBIGUOUS" &&
      matchingAbstention.reason !==
        "ROW_IDENTITY_UNAVAILABLE" &&
      !matchingAbstention.reason
        .startsWith("CARD_")
        ? matchingAbstention.reason as
            BrowserOrderingEvidenceUnavailableReason
        : null;

    return unavailableEvidence(
      args.requirement,
      supportedReason ||
        "COLLECTION_NOT_GROUNDED",
      {
        ...(matchingAbstention?.identity
          ? {
              collectionLabel:
                matchingAbstention
                  .identity.sourceText,
              collectionIdentityMethod:
                matchingAbstention
                  .identity.method,
            }
          : {}),
        ...(matchingAbstention
          ? {
              visibleFields:
                matchingAbstention
                  .visibleSchemaLabels,
              rowCount:
                matchingAbstention
                  .detectedRowCount,
            }
          : {}),
        ...(args.stepIndex === undefined
          ? {}
          : { stepIndex: args.stepIndex }),
      }
    );
  }

  if (candidates.length > 1) {
    return unavailableEvidence(
      args.requirement,
      "AMBIGUOUS_COLLECTION",
      args.stepIndex === undefined
        ? {}
        : { stepIndex: args.stepIndex }
    );
  }

  const collection = candidates[0]!;
  const stepDetails =
    args.stepIndex === undefined
      ? {}
      : { stepIndex: args.stepIndex };

  /*
   * Card V2 exposes bounded item sequence only. It intentionally does not
   * populate the table field/row proof schema, so collection grounding alone
   * cannot create ordering evidence or PASS authority.
   */
  if (collection.shape === "CARD") {
    return evaluateCardOrderingRequirement({
      requirement: args.requirement,
      collection,
      ...(args.stepIndex === undefined
        ? {}
        : { stepIndex: args.stepIndex }),
    });
  }

  if (collection.rows.length < 2) {
    return unavailableEvidence(
      args.requirement,
      "INSUFFICIENT_ROWS",
      {
        collectionLabel: collection.label,
        collectionId:
          collection.collectionId,
        collectionShape:
          collection.shape,
        collectionIdentityMethod:
          collection.identity.method,
        visibleFields:
          collection.fields.map(
            (field) =>
              field.visibleLabel
          ),
        rowCount: collection.rows.length,
        groundedRowIdentityCount:
          collection.rows.filter(
            (row) =>
              row.rowIdentityStatus ===
              "GROUNDED"
          ).length,
        rowSequenceObserved:
          collection.provenance
            .rowSequenceObserved,
        ...stepDetails,
      }
    );
  }

  const semanticDimension =
    args.requirement.semanticDimension ??
    (args.requirement.comparisonType === "DATE_TIME"
      ? "RECENCY"
      : args.requirement.comparisonType === "NUMERIC"
        ? "NUMERIC_MAGNITUDE"
        : "LEXICAL_ORDER");
  const binding = requirementBinding(
    args.requirement,
    semanticDimension
  );
  const bindingDetails = binding
    ? {
        proofFieldBindingId:
          binding.bindingId,
        proofField:
          binding.proposedField,
        proofFieldProposalSource:
          binding.proposalSource,
        proofFieldAuthority:
          binding.authority,
        ...(binding.sourceRef
          ? {
              proofFieldSourceRef:
                binding.sourceRef,
            }
          : {}),
      }
    : {};

  if (
    !authoritativeBinding(
      binding,
      args.requirement,
      semanticDimension
    )
  ) {
    return unavailableEvidence(
      args.requirement,
      "FIELD_BINDING_NOT_AUTHORITATIVE",
      {
        semanticDimension,
        collectionLabel: collection.label,
        collectionId:
          collection.collectionId,
        collectionShape:
          collection.shape,
        collectionIdentityMethod:
          collection.identity.method,
        visibleFields:
          collection.fields.map(
            (field) =>
              field.visibleLabel
          ),
        rowCount: collection.rows.length,
        groundedRowIdentityCount:
          collection.rows.filter(
            (row) =>
              row.rowIdentityStatus ===
              "GROUNDED"
          ).length,
        rowSequenceObserved:
          collection.provenance
            .rowSequenceObserved,
        ...bindingDetails,
        ...stepDetails,
      }
    );
  }

  const fieldResolution =
    resolveVisibleFieldProvenance({
      requirementField:
        binding.proposedField,
      collection,
      provenance:
        args.visibleFieldProvenance ?? [],
    });
  const mappingFailureReason =
    unavailableReasonForResolution(
      fieldResolution
    );
  const mappingDetails = {
    requirementField:
      fieldResolution.requirementField,
    mappingResolutionStatus:
      fieldResolution.status,
    ...(fieldResolution.visibleField
      ? { field: fieldResolution.visibleField }
      : {}),
    ...(fieldResolution.mappingKind
      ? {
          mappingKind:
            fieldResolution.mappingKind,
        }
      : {}),
    mappingSourceFields:
      fieldResolution.sourceFields,
    ...(fieldResolution.sourceRef
      ? {
          mappingSourceRef:
            fieldResolution.sourceRef,
        }
      : {}),
    ...(fieldResolution.sourceCommitRef
      ? {
          mappingSourceCommitRef:
            fieldResolution.sourceCommitRef,
        }
      : {}),
    ...bindingDetails,
  };

  if (mappingFailureReason) {
    return unavailableEvidence(
      args.requirement,
      mappingFailureReason,
      {
        collectionLabel: collection.label,
        collectionId:
          collection.collectionId,
        collectionShape:
          collection.shape,
        collectionIdentityMethod:
          collection.identity.method,
        visibleFields:
          collection.fields.map(
            (field) =>
              field.visibleLabel
          ),
        rowCount: collection.rows.length,
        groundedRowIdentityCount:
          collection.rows.filter(
            (row) =>
              row.rowIdentityStatus ===
              "GROUNDED"
          ).length,
        rowSequenceObserved:
          collection.provenance
            .rowSequenceObserved,
        ...mappingDetails,
        ...stepDetails,
      }
    );
  }

  const extracted = findFieldValues({
    collection,
    resolution: fieldResolution,
  });

  if ("reason" in extracted) {
    return unavailableEvidence(
      args.requirement,
      extracted.reason,
      {
        collectionLabel: collection.label,
        collectionId:
          collection.collectionId,
        collectionShape:
          collection.shape,
        collectionIdentityMethod:
          collection.identity.method,
        visibleFields:
          collection.fields.map(
            (field) =>
              field.visibleLabel
          ),
        rowCount: collection.rows.length,
        groundedRowIdentityCount:
          collection.rows.filter(
            (row) =>
              row.rowIdentityStatus ===
              "GROUNDED"
          ).length,
        rowSequenceObserved:
          collection.provenance
            .rowSequenceObserved,
        ...mappingDetails,
        ...stepDetails,
      }
    );
  }

  const passed = orderingPasses({
    values: extracted.values,
    requirement: args.requirement,
  });

  if (passed === null) {
    return unavailableEvidence(
      args.requirement,
      "VALUE_PARSE_FAILED",
      {
        collectionLabel: collection.label,
        collectionId:
          collection.collectionId,
        collectionShape:
          collection.shape,
        collectionIdentityMethod:
          collection.identity.method,
        visibleFields:
          collection.fields.map(
            (field) =>
              field.visibleLabel
          ),
        field: extracted.field,
        values: extracted.values.slice(
          0,
          MAX_EVIDENCE_VALUES
        ),
        rowCount: collection.rows.length,
        groundedRowIdentityCount:
          collection.rows.filter(
            (row) =>
              row.rowIdentityStatus ===
              "GROUNDED"
          ).length,
        rowSequenceObserved:
          collection.provenance
            .rowSequenceObserved,
        ...mappingDetails,
        ...stepDetails,
      }
    );
  }

  return {
    kind: "ORDERING",
    requirementId: args.requirement.requirementId,
    sourceClaim: args.requirement.sourceClaim,
    semanticDimension,
    direction: args.requirement.direction,
    comparisonType: args.requirement.comparisonType,
    status: passed ? "CONFIRMED" : "FAILED",
    passed,
    collectionLabel: collection.label,
    collectionId: collection.collectionId,
    collectionShape: collection.shape,
    collectionIdentityMethod:
      collection.identity.method,
    visibleFields: collection.fields.map(
      (field) => field.visibleLabel
    ),
    field: extracted.field,
    values: extracted.values.slice(
      0,
      MAX_EVIDENCE_VALUES
    ),
    rowCount: collection.rows.length,
    groundedRowIdentityCount:
      collection.rows.filter(
        (row) =>
          row.rowIdentityStatus ===
          "GROUNDED"
      ).length,
    rowSequenceObserved:
      collection.provenance
        .rowSequenceObserved,
    ...mappingDetails,
    note:
      `Compared ${collection.rows.length} grounded row values ` +
      `${args.requirement.direction} as ${args.requirement.comparisonType}: ` +
      `${passed ? "confirmed" : "failed"}.`,
    ...stepDetails,
  };
}

export function summarizeBrowserOrderingEvidenceParity(args: {
  requirements: BrowserOrderingRequirement[];
  evidence: BrowserOrderingEvidence[];
}): BrowserOrderingEvidenceParity {
  const byRequirement = new Map(
    args.evidence.map((item) => [
      item.requirementId,
      item,
    ])
  );
  const relevant = args.requirements
    .map((requirement) =>
      byRequirement.get(
        requirement.requirementId
      )
    )
    .filter(
      (item): item is BrowserOrderingEvidence =>
        Boolean(item)
    );
  const missingRequirementIds =
    args.requirements
      .map((requirement) =>
        requirement.requirementId
      )
      .filter((id) => !byRequirement.has(id));
  const confirmedCount = relevant.filter(
    (item) => item.status === "CONFIRMED"
  ).length;
  const failedCount = relevant.filter(
    (item) => item.status === "FAILED"
  ).length;
  const unavailableCount =
    relevant.filter(
      (item) => item.status === "UNAVAILABLE"
    ).length + missingRequirementIds.length;

  return {
    status:
      failedCount > 0
        ? "ORDERING_EVIDENCE_FAILED"
        : unavailableCount > 0 ||
            confirmedCount !== args.requirements.length
          ? "ORDERING_EVIDENCE_UNAVAILABLE"
          : "ORDERING_EVIDENCE_CONFIRMED",
    requiredCount: args.requirements.length,
    confirmedCount,
    failedCount,
    unavailableCount,
    missingRequirementIds,
  };
}
