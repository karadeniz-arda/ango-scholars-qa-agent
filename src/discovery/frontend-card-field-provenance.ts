import { createHash } from "node:crypto";
import path from "node:path";

import ts from "typescript";

import type {
  VisibleFieldProvenanceKind,
  VisibleFieldSourceRef,
} from "./frontend-visible-field-provenance.js";

export type SourceCardFieldValueKind =
  | "TEXT"
  | "ENUM"
  | "DATE_TIME"
  | "NUMERIC";

export type SourceCardFieldRuntimeLocator = {
  method: "EXACT_TAG" | "EXACT_ROLE";
  selector: string;
  exactCount: 1;
};

export type SourceCardFieldProvenance = {
  fieldId: string;
  observationField: string;
  sourceFields: string[];
  kind: VisibleFieldProvenanceKind;
  valueKind: SourceCardFieldValueKind;
  sourceExpression: string;
  sourceRef: VisibleFieldSourceRef;
  sourceCommitRef?: string;
  runtimeLocator?: SourceCardFieldRuntimeLocator;
  visibility: "ALWAYS" | "CONDITIONAL";
  authoritative: true;
  reason: string;
};

export type CardFieldProvenanceExtractionOptions = {
  source: string;
  file: string;
  componentName?: string;
  nativeElementTags?: Record<string, string>;
  sourceCommitRef?: string;
  maxSourceBytes?: number;
  maxFields?: number;
};

const DEFAULT_MAX_SOURCE_BYTES = 512_000;
const DEFAULT_MAX_FIELDS = 40;
const MAX_REF_LENGTH = 240;
const SEMANTIC_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "time",
]);

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

function boundedFile(value: string): string {
  const normalized = value
    .split(path.sep)
    .join("/");

  if (
    path.isAbsolute(value) ||
    normalized.split("/").includes("..")
  ) {
    return path.basename(value).slice(0, 180);
  }

  return normalized.slice(0, MAX_REF_LENGTH);
}

function unwrap(
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

function expressionPath(
  expression: ts.Expression,
  roots: Set<string>
): string | null {
  const parts: string[] = [];
  let current = unwrap(expression);

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = unwrap(current.expression);
  }

  if (
    ts.isIdentifier(current) &&
    roots.has(current.text)
  ) {
    return parts.length > 0
      ? [current.text, ...parts].join(".")
      : current.text;
  }

  return null;
}

function collectSourceFields(
  node: ts.Node,
  roots: Set<string>
): string[] {
  const fields = new Set<string>();

  const visit = (current: ts.Node): void => {
    if (ts.isExpression(current)) {
      const parent = current.parent;
      const nestedAccess =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === current;

      if (!nestedAccess) {
        const field =
          ts.isPropertyAccessExpression(current) &&
          ts.isCallExpression(parent) &&
          parent.expression === current
            ? expressionPath(
                current.expression,
                roots
              )
            : expressionPath(
                current,
                roots
              );
        if (field) fields.add(field);
      }
    }

    ts.forEachChild(current, visit);
  };

  visit(node);
  return [...fields].sort();
}

function contains(
  node: ts.Node,
  predicate: (candidate: ts.Node) => boolean
): boolean {
  let found = false;

  const visit = (current: ts.Node): void => {
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

function classifyExpression(args: {
  expression: ts.Expression;
  roots: Set<string>;
  locals: Map<string, ts.Expression>;
  depth?: number;
}): {
  kind: VisibleFieldProvenanceKind;
  sourceFields: string[];
  expression: ts.Expression;
  reason: string;
} {
  const depth = args.depth ?? 0;
  const expression = unwrap(args.expression);

  if (
    depth < 4 &&
    ts.isIdentifier(expression) &&
    args.locals.has(expression.text)
  ) {
    return classifyExpression({
      ...args,
      expression: args.locals.get(
        expression.text
      )!,
      depth: depth + 1,
    });
  }

  const sourceFields = collectSourceFields(
    expression,
    args.roots
  );
  const fallback = contains(
    expression,
    (candidate) =>
      (
        ts.isBinaryExpression(candidate) &&
        (
          candidate.operatorToken.kind ===
            ts.SyntaxKind.QuestionQuestionToken ||
          candidate.operatorToken.kind ===
            ts.SyntaxKind.BarBarToken
        )
      ) ||
      ts.isConditionalExpression(candidate)
  );
  const composite = contains(
    expression,
    (candidate) =>
      ts.isTemplateExpression(candidate) ||
      (
        ts.isBinaryExpression(candidate) &&
        candidate.operatorToken.kind ===
          ts.SyntaxKind.PlusToken
      )
  );
  const call = contains(
    expression,
    ts.isCallExpression
  );

  if (sourceFields.length === 0) {
    return {
      kind: "UNRESOLVED",
      sourceFields: [],
      expression,
      reason:
        "No supported component-property source reaches this visible expression.",
    };
  }

  if (fallback) {
    return {
      kind: "FALLBACK",
      sourceFields,
      expression,
      reason:
        "The visible expression contains an explicit fallback or conditional branch.",
    };
  }

  if (
    composite ||
    sourceFields.length > 1
  ) {
    return {
      kind: "COMPOSITE",
      sourceFields,
      expression,
      reason:
        "The visible expression combines source values.",
    };
  }

  if (call) {
    return {
      kind: "DERIVED",
      sourceFields,
      expression,
      reason:
        "The visible expression transforms a source value through a function call.",
    };
  }

  return {
    kind: "DIRECT",
    sourceFields,
    expression,
    reason:
      "Exactly one component-property source is rendered without fallback or transformation.",
  };
}

function jsxTagName(
  name: ts.JsxTagNameExpression
): string {
  return ts.isIdentifier(name)
    ? name.text
    : name.getText();
}

function componentFunction(
  sourceFile: ts.SourceFile,
  requestedName: string | undefined
): ts.FunctionLikeDeclaration | undefined {
  let fallback:
    ts.FunctionLikeDeclaration | undefined;

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name
    ) {
      fallback ??= statement;
      if (statement.name.text === requestedName) {
        return statement;
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of
        statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (
            ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)
          )
        ) {
          fallback ??= declaration.initializer;
          if (
            declaration.name.text ===
            requestedName
          ) {
            return declaration.initializer;
          }
        }
      }
    }
  }

  return fallback;
}

function parameterRoots(
  fn: ts.FunctionLikeDeclaration
): Set<string> {
  const roots = new Set<string>();

  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      roots.add(parameter.name.text);
    } else if (
      ts.isObjectBindingPattern(parameter.name)
    ) {
      for (const element of parameter.name.elements) {
        if (ts.isIdentifier(element.name)) {
          roots.add(element.name.text);
        }
      }
    }
  }

  return roots;
}

function localInitializers(
  fn: ts.FunctionLikeDeclaration
): Map<string, ts.Expression> {
  const locals = new Map<string, ts.Expression>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      locals.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };

  visit(fn);
  return locals;
}

function conditionalVisibility(
  node: ts.Node,
  fn: ts.FunctionLikeDeclaration
): "ALWAYS" | "CONDITIONAL" {
  let current: ts.Node | undefined = node.parent;

  while (current && current !== fn) {
    if (
      ts.isConditionalExpression(current) ||
      (
        ts.isBinaryExpression(current) &&
        current.operatorToken.kind ===
          ts.SyntaxKind.AmpersandAmpersandToken
      )
    ) {
      return "CONDITIONAL";
    }
    current = current.parent;
  }

  return "ALWAYS";
}

function valueKindFor(
  field: string
): SourceCardFieldValueKind {
  const normalized = field
    .toLocaleLowerCase("en-US");

  if (
    /(?:at|date|time)$/.test(normalized)
  ) {
    return "DATE_TIME";
  }
  if (normalized.includes("status")) {
    return "ENUM";
  }
  if (
    /(?:score|count|total|amount|number)$/.test(
      normalized
    )
  ) {
    return "NUMERIC";
  }
  return "TEXT";
}

function runtimeLocator(args: {
  opening:
    ts.JsxOpeningElement |
    ts.JsxSelfClosingElement;
  nativeTag: string | undefined;
  sourceFile: ts.SourceFile;
}): SourceCardFieldRuntimeLocator | undefined {
  if (
    args.nativeTag &&
    SEMANTIC_TAGS.has(args.nativeTag)
  ) {
    return {
      method: "EXACT_TAG",
      selector: args.nativeTag,
      exactCount: 1,
    };
  }

  const role = args.opening.attributes.properties.find(
    (item): item is ts.JsxAttribute =>
      ts.isJsxAttribute(item) &&
      item.name.getText(args.sourceFile) === "role"
  );
  const roleValue = role?.initializer &&
    ts.isStringLiteral(role.initializer)
      ? role.initializer.text
      : "";

  if (roleValue === "status") {
    return {
      method: "EXACT_ROLE",
      selector: '[role="status"]',
      exactCount: 1,
    };
  }

  return undefined;
}

export function extractCardFieldProvenanceFromSource(
  options: CardFieldProvenanceExtractionOptions
): SourceCardFieldProvenance[] {
  const maxSourceBytes = boundedInteger(
    options.maxSourceBytes,
    DEFAULT_MAX_SOURCE_BYTES,
    1_024,
    2_000_000
  );
  const maxFields = boundedInteger(
    options.maxFields,
    DEFAULT_MAX_FIELDS,
    1,
    200
  );

  if (
    Buffer.byteLength(options.source, "utf8") >
      maxSourceBytes
  ) {
    return [];
  }

  const file = boundedFile(options.file);
  const sourceFile = ts.createSourceFile(
    file,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics ?? [];

  if (diagnostics.length > 0) return [];
  const fn = componentFunction(
    sourceFile,
    options.componentName
  );
  if (!fn) return [];
  const roots = parameterRoots(fn);
  const locals = localInitializers(fn);
  const results: SourceCardFieldProvenance[] = [];

  const visit = (node: ts.Node): void => {
    if (results.length >= maxFields) return;

    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const name = jsxTagName(opening.tagName);
      const nativeTag = /^[a-z]/.test(name)
        ? name
        : options.nativeElementTags?.[name];
      const expressions = node.children.filter(
        (child): child is ts.JsxExpression =>
          ts.isJsxExpression(child) &&
          Boolean(child.expression)
      );
      const hasNestedValueContainer =
        node.children.some(
          (child) =>
            ts.isJsxElement(child) ||
            ts.isJsxFragment(child)
        );

      if (
        expressions.length === 1 &&
        !hasNestedValueContainer
      ) {
        const expression = expressions[0]!
          .expression!;
        const rendersNestedValueTree = contains(
          expression,
          (candidate) =>
            ts.isJsxElement(candidate) ||
            ts.isJsxSelfClosingElement(candidate)
        );

        if (rendersNestedValueTree) {
          ts.forEachChild(node, visit);
          return;
        }
        const classification =
          classifyExpression({
            expression,
            roots,
            locals,
          });

        if (
          classification.sourceFields.length > 0
        ) {
          const sourceField =
            classification.sourceFields[0]!;
          const observationField = sourceField
            .split(".")
            .at(-1)!;
          const line = sourceFile
            .getLineAndCharacterOfPosition(
              opening.getStart(sourceFile)
            ).line + 1;
          const locator = runtimeLocator({
            opening,
            nativeTag,
            sourceFile,
          });
          const sourceExpression =
            classification.expression
              .getText(sourceFile)
              .replace(/\s+/g, " ")
              .slice(0, 240);
          const fieldId =
            `card-field-${createHash("sha256")
              .update(
                [
                  file,
                  line,
                  observationField,
                  classification.kind,
                ].join("\u0000")
              )
              .digest("hex")
              .slice(0, 12)}`;

          results.push({
            fieldId,
            observationField,
            sourceFields:
              classification.sourceFields,
            kind: classification.kind,
            valueKind: valueKindFor(
              observationField
            ),
            sourceExpression,
            sourceRef: {
              file,
              line,
              ...(options.componentName
                ? {
                    symbol:
                      options.componentName,
                  }
                : {}),
            },
            ...(options.sourceCommitRef &&
            /^[0-9a-f]{7,40}$/i.test(
              options.sourceCommitRef
            )
              ? {
                  sourceCommitRef:
                    options.sourceCommitRef
                      .slice(0, 40),
                }
              : {}),
            ...(locator
              ? { runtimeLocator: locator }
              : {}),
            visibility:
              conditionalVisibility(node, fn),
            authoritative: true,
            reason:
              classification.reason.slice(
                0,
                240
              ),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(fn);

  return results
    .sort((left, right) =>
      (left.sourceRef.line ?? 0) -
        (right.sourceRef.line ?? 0) ||
      left.fieldId.localeCompare(right.fieldId)
    )
    .slice(0, maxFields);
}
