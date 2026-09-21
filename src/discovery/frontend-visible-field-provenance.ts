import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

import type {
  BrowserObservedCollection,
} from "../agents/browser/browser-observation.js";

export type VisibleFieldProvenanceKind =
  | "DIRECT"
  | "FALLBACK"
  | "COMPOSITE"
  | "DERIVED"
  | "UNRESOLVED";

export type VisibleFieldSourceRef = {
  /** Client-root-relative path only; absolute local paths are never persisted. */
  file: string;
  line?: number;
  symbol?: string;
};

export type FrontendVisibleFieldProvenance = {
  visibleLabel: string;
  sourceFields: string[];
  kind: VisibleFieldProvenanceKind;
  sourceRef: VisibleFieldSourceRef;
  /** Source revision inspected; this does not imply deployed-revision parity. */
  sourceCommitRef?: string;
  authoritative: true;
  reason: string;
};

export type VisibleFieldResolutionStatus =
  | "DIRECT_MATCH"
  | "FALLBACK_SOURCE"
  | "COMPOSITE_SOURCE"
  | "DERIVED_SOURCE"
  | "UNRESOLVED_SOURCE"
  | "NO_AUTHORITATIVE_MAPPING"
  | "VISIBLE_FIELD_NOT_GROUNDED"
  | "AMBIGUOUS_MAPPING";

export type VisibleFieldResolution = {
  status: VisibleFieldResolutionStatus;
  requirementField: string;
  visibleField?: string;
  visibleFieldId?: string;
  mappingKind?: VisibleFieldProvenanceKind;
  sourceFields: string[];
  sourceRef?: VisibleFieldSourceRef;
  sourceCommitRef?: string;
  reason: string;
};

export type FrontendFieldProvenanceDiscoveryOptions = {
  clientRoot?: string;
  maxFiles?: number;
  maxEntries?: number;
  maxSourceBytes?: number;
  sourceCommitRef?: string;
};

const DEFAULT_MAX_FILES = 2_500;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_SOURCE_BYTES = 512_000;
const MAX_REASON_LENGTH = 240;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    maximum,
    Math.max(minimum, Math.floor(value!))
  );
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function boundedSourceRefFile(
  value: string
): string {
  const normalized = normalizePath(value);

  if (
    path.isAbsolute(value) ||
    normalized.split("/").includes("..")
  ) {
    return path.basename(value).slice(0, 180);
  }

  return normalized.slice(0, 240);
}

function normalizeVisibleLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function propertyNameText(
  name: ts.PropertyName | undefined
): string {
  if (!name) return "";

  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return "";
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  names: string[]
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) &&
      names.includes(
        propertyNameText(item.name)
      )
  );
}

function literalText(
  expression: ts.Expression | undefined
): string {
  if (!expression) return "";

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text.trim();
  }

  return "";
}

function unwrapExpression(
  expression: ts.Expression
): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function collectMessageLabels(
  sourceFile: ts.SourceFile
): Map<string, string> {
  const labels = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineMessages" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(
        node.arguments[0]
      )
    ) {
      for (const property of
        node.arguments[0].properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          !ts.isObjectLiteralExpression(
            property.initializer
          )
        ) {
          continue;
        }

        const key = propertyNameText(
          property.name
        );
        const defaultMessage =
          objectProperty(
            property.initializer,
            ["defaultMessage"]
          );
        const label = literalText(
          defaultMessage?.initializer
        );

        if (key && label) {
          labels.set(key, label);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return labels;
}

function resolveVisibleLabel(
  expression: ts.Expression,
  messageLabels: Map<string, string>
): string {
  const direct = literalText(expression);
  if (direct) return direct;

  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(
      expression.expression
    ) &&
    expression.expression.name.text ===
      "formatMessage"
  ) {
    const argument = expression.arguments[0];

    if (
      argument &&
      ts.isPropertyAccessExpression(argument) &&
      ts.isIdentifier(argument.expression) &&
      argument.expression.text === "messages"
    ) {
      return (
        messageLabels.get(
          argument.name.text
        ) ?? ""
      );
    }

    if (
      argument &&
      ts.isObjectLiteralExpression(argument)
    ) {
      return literalText(
        objectProperty(
          argument,
          ["defaultMessage"]
        )?.initializer
      );
    }
  }

  return "";
}

function expressionFieldPath(
  expression: ts.Expression,
  rootName: string
): string | null {
  const parts: string[] = [];
  let current = unwrapExpression(expression);

  while (
    ts.isPropertyAccessExpression(current)
  ) {
    parts.unshift(current.name.text);
    current = unwrapExpression(
      current.expression
    );
  }

  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    ts.isStringLiteral(
      current.argumentExpression
    )
  ) {
    parts.unshift(
      current.argumentExpression.text
    );
    current = unwrapExpression(
      current.expression
    );
  }

  return (
    ts.isIdentifier(current) &&
    current.text === rootName &&
    parts.length > 0
  )
    ? parts.join(".")
    : null;
}

function collectFieldsForRoot(
  node: ts.Node,
  rootName: string
): string[] {
  const fields = new Set<string>();

  const visit = (current: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)
    ) {
      const parent = current.parent;
      const isInnerAccess =
        (
          ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)
        ) && parent.expression === current;

      if (!isInnerAccess) {
        const field = expressionFieldPath(
          current,
          rootName
        );
        if (field) fields.add(field);
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return [...fields].sort();
}

function containsNode(
  node: ts.Node,
  predicate: (candidate: ts.Node) => boolean
): boolean {
  let found = false;

  const visit = (current: ts.Node) => {
    if (found) return;
    if (predicate(current)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
}

function hasFallbackExpression(
  node: ts.Node,
  rowName: string
): boolean {
  return containsNode(node, (candidate) => {
    if (ts.isBinaryExpression(candidate)) {
      const isFallbackOperator =
        candidate.operatorToken.kind ===
          ts.SyntaxKind.QuestionQuestionToken ||
        candidate.operatorToken.kind ===
          ts.SyntaxKind.BarBarToken;

      return isFallbackOperator &&
        collectFieldsForRoot(
          candidate.left,
          rowName
        ).length > 0 &&
        collectFieldsForRoot(
          candidate.right,
          rowName
        ).length > 0;
    }

    if (ts.isConditionalExpression(candidate)) {
      return (
        collectFieldsForRoot(
          candidate.whenTrue,
          rowName
        ).length > 0 &&
        collectFieldsForRoot(
          candidate.whenFalse,
          rowName
        ).length > 0
      );
    }

    return false;
  });
}

function hasCompositeExpression(
  node: ts.Node,
  rowName: string
): boolean {
  return containsNode(node, (candidate) => {
    if (
      ts.isTemplateExpression(candidate) ||
      ts.isTaggedTemplateExpression(candidate)
    ) {
      return collectFieldsForRoot(
        candidate,
        rowName
      ).length > 1;
    }

    return ts.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind ===
        ts.SyntaxKind.PlusToken &&
      collectFieldsForRoot(
        candidate,
        rowName
      ).length > 1;
  });
}

function hasCalculatedExpression(
  node: ts.Node,
  rowName: string
): boolean {
  const calculatedOperators = new Set([
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PercentToken,
  ]);

  return containsNode(node, (candidate) =>
    ts.isBinaryExpression(candidate) &&
    calculatedOperators.has(
      candidate.operatorToken.kind
    ) &&
    collectFieldsForRoot(
      candidate,
      rowName
    ).length > 0
  );
}

function accessorFields(
  expression: ts.Expression | undefined
): string[] {
  if (!expression) return [];
  const direct = literalText(expression);
  if (direct) return [direct];

  if (ts.isArrayLiteralExpression(expression)) {
    const parts = expression.elements
      .map((item) =>
        ts.isExpression(item)
          ? literalText(item)
          : ""
      )
      .filter(Boolean);

    return parts.length ===
      expression.elements.length &&
      parts.length > 0
      ? [parts.join(".")]
      : [];
  }

  return [];
}

function renderFunction(
  expression: ts.Expression | undefined
): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!expression) return null;
  const unwrapped = unwrapExpression(expression);

  return (
    ts.isArrowFunction(unwrapped) ||
    ts.isFunctionExpression(unwrapped)
  )
    ? unwrapped
    : null;
}

function parameterName(
  parameter: ts.ParameterDeclaration | undefined
): string {
  return parameter &&
    ts.isIdentifier(parameter.name)
    ? parameter.name.text
    : "";
}

function classifyColumnSource(args: {
  column: ts.ObjectLiteralExpression;
}): {
  kind: VisibleFieldProvenanceKind;
  sourceFields: string[];
  reason: string;
} {
  const dataProperty = objectProperty(
    args.column,
    ["dataIndex"]
  );
  const dataFields = accessorFields(
    dataProperty?.initializer
  );
  const renderProperty = objectProperty(
    args.column,
    ["render"]
  );

  if (!renderProperty) {
    return dataFields.length === 1
      ? {
          kind: "DIRECT",
          sourceFields: dataFields,
          reason:
            "A static column accessor directly declares one source field.",
        }
      : {
          kind: "UNRESOLVED",
          sourceFields: [],
          reason:
            "No supported static accessor or render expression declares the visible value source.",
        };
  }

  const render = renderFunction(
    renderProperty.initializer
  );

  if (!render) {
    return {
      kind: "UNRESOLVED",
      sourceFields: dataFields,
      reason:
        "The column render callback is not an inline function supported by V0.",
    };
  }

  const rowName = parameterName(
    render.parameters[1]
  );
  const valueName = parameterName(
    render.parameters[0]
  );
  const rowFields = rowName
    ? collectFieldsForRoot(
        render.body,
        rowName
      )
    : [];

  if (rowName && rowFields.length > 0) {
    if (
      hasFallbackExpression(
        render.body,
        rowName
      )
    ) {
      return {
        kind: "FALLBACK",
        sourceFields: rowFields,
        reason:
          "The inline render expression chooses among multiple record fields with an explicit fallback branch.",
      };
    }

    if (
      hasCalculatedExpression(
        render.body,
        rowName
      )
    ) {
      return {
        kind: "DERIVED",
        sourceFields: rowFields,
        reason:
          "The inline render expression calculates one visible value from record fields.",
      };
    }

    if (
      hasCompositeExpression(
        render.body,
        rowName
      ) || rowFields.length > 1
    ) {
      return {
        kind: "COMPOSITE",
        sourceFields: rowFields,
        reason:
          "The inline render expression combines multiple record fields into one visible value.",
      };
    }

    const hasCall = containsNode(
      render.body,
      ts.isCallExpression
    );
    return hasCall
      ? {
          kind: "DERIVED",
          sourceFields: rowFields,
          reason:
            "The inline render expression transforms one record field through a calculation or function call.",
        }
      : {
          kind: "DIRECT",
          sourceFields: rowFields,
          reason:
            "The inline render expression exposes exactly one record field without a fallback or calculation.",
        };
  }

  if (dataFields.length === 1) {
    const valueUsed = valueName
      ? containsNode(
          render.body,
          (node) =>
            ts.isIdentifier(node) &&
            node.text === valueName
        )
      : false;
    const transformsValue = valueUsed &&
      containsNode(
        render.body,
        ts.isCallExpression
      );

    return transformsValue
      ? {
          kind: "DERIVED",
          sourceFields: dataFields,
          reason:
            "The static accessor value is transformed by an inline function call; V0 does not assume semantic preservation.",
        }
      : {
          kind: "DIRECT",
          sourceFields: dataFields,
          reason:
            "A static column accessor declares one source field and the render does not select another record field.",
        };
  }

  return {
    kind: "UNRESOLVED",
    sourceFields: [],
    reason:
      "The inline render callback has no supported static record-field source.",
  };
}

function containingSymbol(
  array: ts.ArrayLiteralExpression
): string | undefined {
  let current: ts.Node | undefined =
    array.parent;

  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    current = current.parent;
  }

  return undefined;
}

export function extractVisibleFieldProvenanceFromSource(args: {
  source: string;
  file: string;
  maxSourceBytes?: number;
  maxEntries?: number;
  sourceCommitRef?: string;
}): FrontendVisibleFieldProvenance[] {
  const maxSourceBytes = boundedInteger(
    args.maxSourceBytes,
    DEFAULT_MAX_SOURCE_BYTES,
    1_024,
    2_000_000
  );
  const maxEntries = boundedInteger(
    args.maxEntries,
    DEFAULT_MAX_ENTRIES,
    1,
    2_000
  );

  if (
    Buffer.byteLength(args.source, "utf8") >
      maxSourceBytes
  ) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    args.file,
    args.source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/i.test(args.file)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics?:
        readonly ts.Diagnostic[];
    }
  ).parseDiagnostics ?? [];

  if (parseDiagnostics.length > 0) {
    return [];
  }

  const messageLabels =
    collectMessageLabels(sourceFile);
  const results:
    FrontendVisibleFieldProvenance[] = [];

  const visit = (node: ts.Node) => {
    if (
      results.length >= maxEntries
    ) {
      return;
    }

    if (ts.isArrayLiteralExpression(node)) {
      const columns = node.elements.filter(
        (element): element is ts.ObjectLiteralExpression =>
          ts.isObjectLiteralExpression(element) &&
          Boolean(
            objectProperty(
              element,
              ["title"]
            )
          ) &&
          Boolean(
            objectProperty(
              element,
              [
                "dataIndex",
                "render",
              ]
            )
          )
      );

      for (const column of columns) {
        if (results.length >= maxEntries) break;
        const labelProperty = objectProperty(
          column,
          ["title"]
        );
        const visibleLabel = labelProperty
          ? resolveVisibleLabel(
              labelProperty.initializer,
              messageLabels
            )
          : "";

        if (!visibleLabel) continue;
        const classification =
          classifyColumnSource({ column });
        const line = sourceFile
          .getLineAndCharacterOfPosition(
            column.getStart(sourceFile)
          ).line + 1;

        const symbol = containingSymbol(node);

        results.push({
          visibleLabel,
          sourceFields:
            classification.sourceFields,
          kind: classification.kind,
          sourceRef: {
            file: boundedSourceRefFile(
              args.file
            ),
            line,
            ...(symbol
              ? { symbol }
              : {}),
          },
          authoritative: true,
          ...(args.sourceCommitRef &&
          /^[0-9a-f]{7,40}$/i.test(
            args.sourceCommitRef
          )
            ? {
                sourceCommitRef:
                  args.sourceCommitRef.slice(0, 40),
              }
            : {}),
          reason: classification.reason.slice(
            0,
            MAX_REASON_LENGTH
          ),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return results
    .sort((left, right) =>
      left.sourceRef.line! -
        right.sourceRef.line! ||
      left.visibleLabel.localeCompare(
        right.visibleLabel
      )
    )
    .slice(0, maxEntries);
}

function walkSourceFiles(
  root: string,
  limit: number
): string[] {
  const files: string[] = [];
  const pending = [root];

  while (
    pending.length > 0 &&
    files.length < limit
  ) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(
        current,
        { withFileTypes: true }
      );
    } catch {
      continue;
    }

    for (const entry of entries
      .sort((left, right) =>
        left.name.localeCompare(right.name)
      )
      .reverse()) {
      const fullPath = path.join(
        current,
        entry.name
      );

      if (entry.isDirectory()) {
        if (
          ![
            "node_modules",
            ".git",
            "dist",
            "build",
            ".next",
            "coverage",
          ].includes(entry.name)
        ) {
          pending.push(fullPath);
        }
        continue;
      }

      if (
        entry.isFile() &&
        /\.[jt]sx?$/.test(entry.name)
      ) {
        files.push(fullPath);
        if (files.length >= limit) break;
      }
    }
  }

  return files.sort();
}

export function discoverFrontendVisibleFieldProvenance(
  options:
    FrontendFieldProvenanceDiscoveryOptions = {}
): FrontendVisibleFieldProvenance[] {
  const clientRoot = path.resolve(
    options.clientRoot ||
      process.env.QA_CLIENT_REPO_PATH ||
      "../ango-scholars-client"
  );
  const sourceRoot = path.join(
    clientRoot,
    "src"
  );

  if (!fs.existsSync(sourceRoot)) {
    return [];
  }

  const maxFiles = boundedInteger(
    options.maxFiles,
    DEFAULT_MAX_FILES,
    1,
    10_000
  );
  const maxEntries = boundedInteger(
    options.maxEntries,
    DEFAULT_MAX_ENTRIES,
    1,
    2_000
  );
  const maxSourceBytes = boundedInteger(
    options.maxSourceBytes,
    DEFAULT_MAX_SOURCE_BYTES,
    1_024,
    2_000_000
  );
  const results:
    FrontendVisibleFieldProvenance[] = [];
  let sourceCommitRef =
    options.sourceCommitRef;

  if (!sourceCommitRef) {
    try {
      const candidate = execFileSync(
        "git",
        ["-C", clientRoot, "rev-parse", "HEAD"],
        {
          encoding: "utf8",
          timeout: 2_000,
          stdio: ["ignore", "pipe", "ignore"],
        }
      ).trim();

      if (/^[0-9a-f]{40}$/i.test(candidate)) {
        sourceCommitRef = candidate;
      }
    } catch {
      sourceCommitRef = undefined;
    }
  }

  for (const file of walkSourceFiles(
    sourceRoot,
    maxFiles
  )) {
    if (results.length >= maxEntries) break;
    let source: string;

    try {
      const stats = fs.statSync(file);
      if (stats.size > maxSourceBytes) {
        continue;
      }
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (
      !/\b(?:dataIndex|ColumnsType|columns)\b/.test(
        source
      )
    ) {
      continue;
    }

    results.push(
      ...extractVisibleFieldProvenanceFromSource({
        source,
        file: normalizePath(
          path.relative(clientRoot, file)
        ),
        maxEntries:
          maxEntries - results.length,
        maxSourceBytes,
        ...(sourceCommitRef
          ? { sourceCommitRef }
          : {}),
      })
    );
  }

  const unique = new Map<
    string,
    FrontendVisibleFieldProvenance
  >();

  for (const item of results) {
    const key = JSON.stringify([
      item.visibleLabel,
      item.kind,
      item.sourceFields,
      item.sourceRef,
    ]);
    unique.set(key, item);
  }

  return [...unique.values()]
    .sort((left, right) =>
      left.sourceRef.file.localeCompare(
        right.sourceRef.file
      ) ||
      (left.sourceRef.line ?? 0) -
        (right.sourceRef.line ?? 0) ||
      left.visibleLabel.localeCompare(
        right.visibleLabel
      )
    )
    .slice(0, maxEntries);
}

export function resolveVisibleFieldProvenance(args: {
  requirementField: string | undefined;
  collection: BrowserObservedCollection;
  provenance: FrontendVisibleFieldProvenance[];
}): VisibleFieldResolution {
  const requirementField = String(
    args.requirementField ?? ""
  ).trim();

  if (!requirementField) {
    return {
      status: "NO_AUTHORITATIVE_MAPPING",
      requirementField,
      sourceFields: [],
      reason:
        "The ordering requirement has no exact source-field key.",
    };
  }

  const fieldMappings = args.provenance.filter(
    (item) =>
      item.authoritative === true &&
      item.sourceFields.includes(
        requirementField
      )
  );

  if (fieldMappings.length === 0) {
    return {
      status: "NO_AUTHORITATIVE_MAPPING",
      requirementField,
      sourceFields: [],
      reason:
        "No authoritative frontend column declaration references the exact requirement field.",
    };
  }

  const visibleFieldsByLabel = new Map(
    args.collection.fields.map((field) => [
      normalizeVisibleLabel(
        field.visibleLabel
      ),
      field,
    ])
  );
  const visibleMappings = fieldMappings.filter(
    (item) =>
      visibleFieldsByLabel.has(
        normalizeVisibleLabel(
          item.visibleLabel
        )
      )
  );

  if (visibleMappings.length === 0) {
    return {
      status: "VISIBLE_FIELD_NOT_GROUNDED",
      requirementField,
      sourceFields: [requirementField],
      reason:
        "Authoritative source mappings exist, but none of their exact visible labels are present in the grounded collection schema.",
    };
  }

  if (visibleMappings.length !== 1) {
    return {
      status: "AMBIGUOUS_MAPPING",
      requirementField,
      sourceFields: [
        ...new Set(
          visibleMappings.flatMap(
            (item) => item.sourceFields
          )
        ),
      ].sort(),
      reason:
        "Multiple authoritative source declarations compete for the grounded visible field.",
    };
  }

  const mapping = visibleMappings[0]!;
  const groundedVisibleFields =
    args.collection.fields.filter(
      (field) =>
        normalizeVisibleLabel(
          field.visibleLabel
        ) ===
        normalizeVisibleLabel(
          mapping.visibleLabel
        )
    );

  if (groundedVisibleFields.length !== 1) {
    return {
      status: "AMBIGUOUS_MAPPING",
      requirementField,
      sourceFields: mapping.sourceFields,
      reason:
        "The authoritative visible label does not identify exactly one grounded collection field.",
    };
  }

  const visibleField =
    groundedVisibleFields[0]!;
  const statusByKind: Record<
    VisibleFieldProvenanceKind,
    VisibleFieldResolutionStatus
  > = {
    DIRECT: "DIRECT_MATCH",
    FALLBACK: "FALLBACK_SOURCE",
    COMPOSITE: "COMPOSITE_SOURCE",
    DERIVED: "DERIVED_SOURCE",
    UNRESOLVED: "UNRESOLVED_SOURCE",
  };

  return {
    status: statusByKind[mapping.kind],
    requirementField,
    visibleField: visibleField.visibleLabel,
    visibleFieldId:
      visibleField.visibleFieldId,
    mappingKind: mapping.kind,
    sourceFields: mapping.sourceFields,
    sourceRef: mapping.sourceRef,
    ...(mapping.sourceCommitRef
      ? {
          sourceCommitRef:
            mapping.sourceCommitRef,
        }
      : {}),
    reason: mapping.reason,
  };
}
