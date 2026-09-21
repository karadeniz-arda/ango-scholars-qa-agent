import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import yaml from "yaml";

import {
  extractCardFieldProvenanceFromSource,
  type SourceCardFieldProvenance,
} from "./frontend-card-field-provenance.js";

export type SourceCardCollectionRef = {
  file: string;
  line: number;
  symbol: string;
};

export type SourceCardCollectionCandidate = {
  collectionComponentRef: SourceCardCollectionRef;
  runtimeContainerComponent: string;
  itemComponentName: string;
  itemComponentModule: string;
  iterationKind: "ARRAY_MAP";
  sourceItemExpression: string;
  sourceItemVariable: string;
  sourceItemKeyExpression?: string;
  itemProps: Array<{
    name: string;
    sourceExpression?: string;
  }>;
  sourceRef: string;
};

export type SourceCardCollectionDeclaration = {
  collectionComponentRef: SourceCardCollectionRef;
  itemComponentRef: SourceCardCollectionRef;
  iterationKind: "ARRAY_MAP";
  sourceItemExpression: string;
  sourceItemKey?: {
    expression: string;
    available: true;
  };
  itemProps: SourceCardCollectionCandidate["itemProps"];
  surface: {
    route: string;
    persona: "company_admin" | "talent";
    area: string;
    sourceRef: string;
  };
  runtimeSignature: {
    itemRole: "button";
    focusable: true;
    headingTag: "h3";
    exactHeadingCount: 1;
    minimumNestedActionButtons: 1;
    containerOwnership: "DIRECT_CHILDREN";
    markerAttribute?: string;
    sourceRefs: string[];
  };
  visibleFields: Array<{
    kind: "ITEM_HEADING";
    observationField: "visibleItemName";
    sourceExpression: string;
    sourceRef: string;
  }>;
  cardFields?: SourceCardFieldProvenance[];
  pagination?: {
    sourceRef: string;
  };
  sourceRef: string;
  sourceCommitRef?: string;
  authoritative: true;
};

export type FrontendCardCollectionDiscoveryOptions = {
  clientRoot?: string;
  manifestPath?: string;
  maxFiles?: number;
  maxSourceBytes?: number;
  sourceCommitRef?: string;
};

type SourceFileRecord = {
  file: string;
  absoluteFile: string;
  source: string;
  ast: ts.SourceFile;
  imports: Map<string, string>;
};

type ManifestRoute = {
  path?: string;
  area?: string;
  persona?: string;
  authoritative?: boolean;
  routeKind?: string;
  sourceRef?: string;
};

const DEFAULT_MAX_FILES = 2_500;
const DEFAULT_MAX_SOURCE_BYTES = 512_000;
const MAX_REF_LENGTH = 320;

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

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

function sourceLine(
  sourceFile: ts.SourceFile,
  node: ts.Node
): number {
  return sourceFile
    .getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    ).line + 1;
}

function jsxTagName(
  name: ts.JsxTagNameExpression
): string | undefined {
  return ts.isIdentifier(name)
    ? name.text
    : undefined;
}

function expressionText(
  sourceFile: ts.SourceFile,
  expression: ts.Expression | undefined
): string | undefined {
  if (!expression) return undefined;

  const text = expression
    .getText(sourceFile)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return text || undefined;
}

function jsxAttributeExpression(
  attribute: ts.JsxAttribute
): ts.Expression | undefined {
  const initializer = attribute.initializer;

  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) {
    return initializer;
  }

  return ts.isJsxExpression(initializer)
    ? initializer.expression
    : undefined;
}

function enclosingComponentName(
  node: ts.Node
): string | undefined {
  let current: ts.Node | undefined = node;

  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (
        ts.isArrowFunction(current.initializer) ||
        ts.isFunctionExpression(current.initializer)
      )
    ) {
      return current.name.text;
    }

    if (
      ts.isFunctionDeclaration(current) &&
      current.name
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  return undefined;
}

function enclosingJsxContainer(
  node: ts.Node
): string | undefined {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isJsxElement(current)) {
      return jsxTagName(
        current.openingElement.tagName
      );
    }

    current = current.parent;
  }

  return undefined;
}

function returnedJsx(
  callback: ts.ArrowFunction | ts.FunctionExpression
): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  let body: ts.ConciseBody = callback.body;

  while (
    ts.isParenthesizedExpression(body) ||
    ts.isAsExpression(body) ||
    ts.isTypeAssertionExpression(body) ||
    ts.isNonNullExpression(body) ||
    ts.isSatisfiesExpression(body)
  ) {
    body = body.expression;
  }

  if (
    ts.isJsxElement(body) ||
    ts.isJsxSelfClosingElement(body)
  ) {
    return body;
  }

  if (!ts.isBlock(body)) {
    return undefined;
  }

  const returns = body.statements.filter(
    (statement): statement is ts.ReturnStatement =>
      ts.isReturnStatement(statement) &&
      Boolean(statement.expression)
  );

  if (returns.length !== 1) return undefined;
  let expression = returns[0]!.expression!;

  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  return (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression)
  )
    ? expression
    : undefined;
}

function collectImports(
  sourceFile: ts.SourceFile
): Map<string, string> {
  const imports = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;

    if (statement.importClause.name) {
      imports.set(
        statement.importClause.name.text,
        moduleName
      );
    }

    const bindings =
      statement.importClause.namedBindings;

    if (
      bindings &&
      ts.isNamedImports(bindings)
    ) {
      for (const element of bindings.elements) {
        imports.set(
          element.name.text,
          moduleName
        );
      }
    }
  }

  return imports;
}

/**
 * Extracts only the bounded source form currently supported by card V2:
 * a direct array.map callback returning exactly one imported JSX component.
 */
export function extractSourceCardCollectionCandidates(
  input: {
    source: string;
    file: string;
    maxSourceBytes?: number;
  }
): SourceCardCollectionCandidate[] {
  const maxSourceBytes = boundedInteger(
    input.maxSourceBytes,
    DEFAULT_MAX_SOURCE_BYTES,
    1_024,
    2_000_000
  );

  if (
    Buffer.byteLength(input.source, "utf8") >
      maxSourceBytes
  ) {
    return [];
  }

  const file = normalizePath(input.file)
    .slice(0, 240);
  const sourceFile = ts.createSourceFile(
    file,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const imports = collectImports(sourceFile);
  const results: SourceCardCollectionCandidate[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      node.arguments.length === 1 &&
      (
        ts.isArrowFunction(node.arguments[0]!) ||
        ts.isFunctionExpression(node.arguments[0]!)
      )
    ) {
      const callback = node.arguments[0];
      const itemParameter = callback.parameters[0];
      const itemVariable =
        itemParameter &&
        ts.isIdentifier(itemParameter.name)
          ? itemParameter.name.text
          : "";
      const jsx = returnedJsx(callback);
      const opening = jsx
        ? ts.isJsxElement(jsx)
          ? jsx.openingElement
          : jsx
        : undefined;
      const itemComponentName = opening
        ? jsxTagName(opening.tagName)
        : undefined;
      const componentName =
        enclosingComponentName(node);
      const containerName =
        enclosingJsxContainer(node);
      const moduleName = itemComponentName
        ? imports.get(itemComponentName)
        : undefined;

      if (
        itemVariable &&
        opening &&
        itemComponentName &&
        /^[A-Z]/.test(itemComponentName) &&
        componentName &&
        containerName &&
        moduleName
      ) {
        const attributes =
          opening.attributes.properties.filter(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property)
          );
        const keyAttribute = attributes.find(
          (attribute) =>
            attribute.name.getText(sourceFile) ===
            "key"
        );
        const itemProps = attributes
          .filter(
            (attribute) =>
              attribute.name.getText(sourceFile) !==
              "key"
          )
          .map((attribute) => {
            const sourceExpression =
              expressionText(
                sourceFile,
                jsxAttributeExpression(attribute)
              );

            return {
              name: attribute.name.getText(sourceFile),
              ...(sourceExpression
                ? { sourceExpression }
                : {}),
            };
          })
          .slice(0, 30);
        const line = sourceLine(
          sourceFile,
          opening
        );
        const sourceItemKeyExpression =
          keyAttribute
            ? expressionText(
                sourceFile,
                jsxAttributeExpression(keyAttribute)
              )
            : undefined;

        results.push({
          collectionComponentRef: {
            file,
            line,
            symbol: componentName,
          },
          runtimeContainerComponent:
            containerName,
          itemComponentName,
          itemComponentModule: moduleName,
          iterationKind: "ARRAY_MAP",
          sourceItemExpression:
            expressionText(
              sourceFile,
              node.expression.expression
            ) ?? "",
          sourceItemVariable: itemVariable,
          ...(sourceItemKeyExpression
            ? {
                sourceItemKeyExpression,
              }
            : {}),
          itemProps,
          sourceRef:
            `${file}:${line}`.slice(
              0,
              MAX_REF_LENGTH
            ),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return results.sort((left, right) =>
    left.sourceRef.localeCompare(right.sourceRef) ||
    left.itemComponentName.localeCompare(
      right.itemComponentName
    )
  );
}

function walkSourceFiles(
  root: string,
  maxFiles: number
): string[] {
  const files: string[] = [];

  const walk = (directory: string): void => {
    if (files.length >= maxFiles) return;

    for (const entry of fs
      .readdirSync(directory, {
        withFileTypes: true,
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name)
      )) {
      if (files.length >= maxFiles) break;
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue;
      }

      const fullPath = path.join(
        directory,
        entry.name
      );

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        /\.(?:ts|tsx)$/.test(entry.name)
      ) {
        files.push(fullPath);
      }
    }
  };

  walk(root);
  return files;
}

function readSourceRecords(
  clientRoot: string,
  maxFiles: number,
  maxSourceBytes: number
): Map<string, SourceFileRecord> {
  const records = new Map<
    string,
    SourceFileRecord
  >();
  const sourceRoot = path.join(clientRoot, "src");

  if (!fs.existsSync(sourceRoot)) {
    return records;
  }

  for (const absoluteFile of walkSourceFiles(
    sourceRoot,
    maxFiles
  )) {
    let source: string;

    try {
      if (
        fs.statSync(absoluteFile).size >
        maxSourceBytes
      ) {
        continue;
      }
      source = fs.readFileSync(
        absoluteFile,
        "utf8"
      );
    } catch {
      continue;
    }

    const file = normalizePath(
      path.relative(clientRoot, absoluteFile)
    );
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );

    records.set(file, {
      file,
      absoluteFile,
      source,
      ast,
      imports: collectImports(ast),
    });
  }

  return records;
}

function resolveModuleFile(
  records: Map<string, SourceFileRecord>,
  fromFile: string,
  moduleName: string,
  seen = new Set<string>(),
  exportedSymbol?: string
): SourceFileRecord | undefined {
  const base = moduleName.startsWith("@/")
    ? `src/${moduleName.slice(2)}`
    : moduleName.startsWith("@talent/")
      ? `src/modules/talent/${moduleName.slice(8)}`
      : moduleName.startsWith(".")
        ? normalizePath(
            path.posix.join(
              path.posix.dirname(fromFile),
              moduleName
            )
          )
        : "";

  if (!base) return undefined;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  const record = candidates
    .map((candidate) => records.get(candidate))
    .find(Boolean);

  if (!record || seen.has(record.file)) {
    return record;
  }

  if (!/\/index\.(?:ts|tsx)$/.test(record.file)) {
    return record;
  }

  seen.add(record.file);

  if (exportedSymbol) {
    for (const statement of record.ast.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause) ||
        !statement.exportClause.elements.some(
          (element) =>
            element.name.text === exportedSymbol
        )
      ) {
        continue;
      }

      const resolved = resolveModuleFile(
        records,
        record.file,
        statement.moduleSpecifier.text,
        seen
      );

      if (resolved) return resolved;
    }
  }

  for (const statement of record.ast.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const resolved = resolveModuleFile(
      records,
      record.file,
      statement.moduleSpecifier.text,
      seen
    );

    if (resolved) return resolved;
  }

  return record;
}

function styledBases(
  record: SourceFileRecord
): Map<string, {
  kind: "NATIVE" | "COMPONENT";
  base: string;
}> {
  const results = new Map<string, {
    kind: "NATIVE" | "COMPONENT";
    base: string;
  }>();

  for (const statement of record.ast.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of
      statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !declaration.initializer ||
        !ts.isTaggedTemplateExpression(
          declaration.initializer
        )
      ) {
        continue;
      }

      const tag = declaration.initializer.tag;

      if (
        ts.isPropertyAccessExpression(tag) &&
        ts.isIdentifier(tag.expression) &&
        tag.expression.text === "styled"
      ) {
        results.set(declaration.name.text, {
          kind: "NATIVE",
          base: tag.name.text,
        });
      } else if (
        ts.isCallExpression(tag) &&
        ts.isIdentifier(tag.expression) &&
        tag.expression.text === "styled" &&
        tag.arguments.length === 1 &&
        ts.isIdentifier(tag.arguments[0]!)
      ) {
        results.set(declaration.name.text, {
          kind: "COMPONENT",
          base: tag.arguments[0].text,
        });
      }
    }
  }

  return results;
}

function defaultComponentName(
  record: SourceFileRecord
): string | undefined {
  for (const statement of record.ast.statements) {
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      return statement.expression.text;
    }
  }

  return undefined;
}

function componentReturnJsx(
  record: SourceFileRecord,
  componentName: string
): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  const component = componentFunction(
    record,
    componentName
  );

  if (!component || !ts.isBlock(component.body)) {
    return undefined;
  }

  const directReturns =
    component.body.statements.filter(
      (item): item is ts.ReturnStatement =>
        ts.isReturnStatement(item) &&
        Boolean(item.expression)
    );

  if (directReturns.length !== 1) {
    return undefined;
  }

  let expression = directReturns[0]!.expression!;

  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }

  return (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression)
  )
    ? expression
    : undefined;
}

function componentFunction(
  record: SourceFileRecord,
  componentName: string
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  for (const statement of record.ast.statements) {
    if (
      ts.isVariableStatement(statement)
    ) {
      for (const declaration of
        statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== componentName ||
          !declaration.initializer ||
          !(
            ts.isArrowFunction(
              declaration.initializer
            ) ||
            ts.isFunctionExpression(
              declaration.initializer
            )
          )
        ) {
          continue;
        }

        return declaration.initializer;
      }
    }
  }

  return undefined;
}

function rootOpening(
  jsx: ts.JsxElement | ts.JsxSelfClosingElement
): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(jsx)
    ? jsx.openingElement
    : jsx;
}

function deriveRuntimeContract(
  records: Map<string, SourceFileRecord>,
  candidate: SourceCardCollectionCandidate,
  itemRecord: SourceFileRecord
): Pick<
  SourceCardCollectionDeclaration,
  "itemComponentRef" |
  "runtimeSignature" |
  "visibleFields" |
  "cardFields"
> | undefined {
  const componentName =
    defaultComponentName(itemRecord) ||
    candidate.itemComponentName;
  const itemJsx = componentReturnJsx(
    itemRecord,
    componentName
  );

  if (!itemJsx) return undefined;

  const itemOpening = rootOpening(itemJsx);
  const rootName = jsxTagName(
    itemOpening.tagName
  );
  const rootModule = rootName
    ? itemRecord.imports.get(rootName)
    : undefined;
  const styledRecord = rootModule
    ? resolveModuleFile(
        records,
        itemRecord.file,
        rootModule
      )
    : undefined;

  if (!rootName || !styledRecord) {
    return undefined;
  }

  const bases = styledBases(styledRecord);
  const rootBase = bases.get(rootName);

  if (
    !rootBase ||
    rootBase.kind !== "COMPONENT"
  ) {
    return undefined;
  }

  const interactiveModule =
    styledRecord.imports.get(rootBase.base);
  const interactiveRecord = interactiveModule
    ? resolveModuleFile(
        records,
        styledRecord.file,
        interactiveModule,
        new Set<string>(),
        rootBase.base
      )
    : undefined;
  const interactiveName = interactiveRecord
    ? defaultComponentName(interactiveRecord)
    : undefined;
  const interactiveJsx =
    interactiveRecord && interactiveName
      ? componentReturnJsx(
          interactiveRecord,
          interactiveName
        )
      : undefined;

  if (!interactiveRecord || !interactiveJsx) {
    return undefined;
  }

  const interactiveOpening =
    rootOpening(interactiveJsx);
  const interactiveAttributes =
    interactiveOpening.attributes.properties
      .filter(
        (item): item is ts.JsxAttribute =>
          ts.isJsxAttribute(item)
      );
  const roleAttribute =
    interactiveAttributes.find(
      (item) =>
        item.name.getText(
          interactiveRecord.ast
        ) === "role"
    );
  const tabIndexAttribute =
    interactiveAttributes.find(
      (item) =>
        item.name.getText(
          interactiveRecord.ast
        ) === "tabIndex"
    );
  const markerAttribute =
    interactiveAttributes.find(
      (item) =>
        item.name.getText(
          interactiveRecord.ast
        ) === "data-has-action"
    );
  const roleText = expressionText(
    interactiveRecord.ast,
    roleAttribute
      ? jsxAttributeExpression(roleAttribute)
      : undefined
  );
  const tabIndexText = expressionText(
    interactiveRecord.ast,
    tabIndexAttribute
      ? jsxAttributeExpression(tabIndexAttribute)
      : undefined
  );

  if (
    !roleText?.includes("button") ||
    !tabIndexText?.includes("0")
  ) {
    return undefined;
  }

  const headingMatches: Array<{
    expression: string;
    sourceRef: string;
  }> = [];
  let nestedButtonCount = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node)
    ) {
      const opening = ts.isJsxElement(node)
        ? node.openingElement
        : node;
      const name = jsxTagName(opening.tagName);
      const base = name
        ? bases.get(name)
        : undefined;

      if (
        base?.kind === "NATIVE" &&
        base.base === "h3" &&
        ts.isJsxElement(node)
      ) {
        const expressions = node.children
          .filter(
            (child): child is ts.JsxExpression =>
              ts.isJsxExpression(child) &&
              Boolean(child.expression)
          )
          .map((child) =>
            expressionText(
              itemRecord.ast,
              child.expression
            )
          )
          .filter(
            (value): value is string =>
              Boolean(value)
          );

        if (expressions.length === 1) {
          headingMatches.push({
            expression: expressions[0]!,
            sourceRef:
              `${itemRecord.file}:` +
              sourceLine(
                itemRecord.ast,
                opening
              ),
          });
        }
      }

      if (
        base?.kind === "COMPONENT" &&
        styledRecord.imports
          .get(base.base)
          ?.toLowerCase()
          .includes("button")
      ) {
        nestedButtonCount += 1;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(
    componentFunction(
      itemRecord,
      componentName
    ) ?? itemJsx
  );

  if (
    headingMatches.length !== 1 ||
    nestedButtonCount < 1
  ) {
    return undefined;
  }

  const itemLine = sourceLine(
    itemRecord.ast,
    itemOpening
  );
  const nativeElementTags =
    Object.fromEntries(
      [...bases.entries()]
        .filter(
          (
            entry
          ): entry is [
            string,
            { kind: "NATIVE"; base: string },
          ] => entry[1].kind === "NATIVE"
        )
        .map(([name, base]) => [
          name,
          base.base,
        ])
    );
  const cardFields =
    extractCardFieldProvenanceFromSource({
      source: itemRecord.source,
      file: itemRecord.file,
      componentName,
      nativeElementTags,
    }).map((field) =>
      field.sourceExpression ===
        headingMatches[0]!.expression
        ? {
            ...field,
            observationField:
              "visibleItemName",
          }
        : field
    );

  return {
    itemComponentRef: {
      file: itemRecord.file,
      line: itemLine,
      symbol: componentName,
    },
    runtimeSignature: {
      itemRole: "button",
      focusable: true,
      headingTag: "h3",
      exactHeadingCount: 1,
      minimumNestedActionButtons: 1,
      containerOwnership: "DIRECT_CHILDREN",
      ...(markerAttribute
        ? { markerAttribute: "data-has-action" }
        : {}),
      sourceRefs: [
        `${itemRecord.file}:${itemLine}`,
        `${styledRecord.file}`,
        `${interactiveRecord.file}:` +
          sourceLine(
            interactiveRecord.ast,
            interactiveOpening
          ),
        headingMatches[0]!.sourceRef,
      ].map((item) =>
        item.slice(0, MAX_REF_LENGTH)
      ),
    },
    visibleFields: [{
      kind: "ITEM_HEADING",
      observationField: "visibleItemName",
      sourceExpression:
        headingMatches[0]!.expression,
      sourceRef:
        headingMatches[0]!.sourceRef,
    }],
    ...(cardFields.length > 0
      ? { cardFields }
      : {}),
  };
}

function findPaginationRef(
  records: Map<string, SourceFileRecord>,
  collectionSymbol: string
): string | undefined {
  const refs: string[] = [];

  for (const record of records.values()) {
    if (
      !record.source.includes(
        `<${collectionSymbol}`
      )
    ) {
      continue;
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxOpeningElement(node) ||
        ts.isJsxSelfClosingElement(node)
      ) {
        const name = jsxTagName(node.tagName);
        const moduleName = name
          ? record.imports.get(name)
          : undefined;

        if (
          name &&
          moduleName
            ?.toLowerCase()
            .includes("pagination")
        ) {
          refs.push(
            `${record.file}#${name}`
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(record.ast);
  }

  const unique = [...new Set(refs)].sort();
  return unique.length === 1
    ? unique[0]
    : undefined;
}

let cachedDefaultDeclarations:
  SourceCardCollectionDeclaration[] | undefined;

export function discoverFrontendCardCollectionDeclarations(
  options: FrontendCardCollectionDiscoveryOptions = {}
): SourceCardCollectionDeclaration[] {
  const useDefaultCache =
    Object.keys(options).length === 0;

  if (
    useDefaultCache &&
    cachedDefaultDeclarations
  ) {
    return cachedDefaultDeclarations;
  }

  const clientRoot = path.resolve(
    options.clientRoot ??
      process.env.QA_CLIENT_REPO_PATH ??
      "../ango-scholars-client"
  );
  const manifestPath = path.resolve(
    options.manifestPath ??
      process.env.QA_UI_ROUTES_MANIFEST ??
      "config/ui-routes.manifest.yaml"
  );
  const maxFiles = boundedInteger(
    options.maxFiles,
    DEFAULT_MAX_FILES,
    1,
    10_000
  );
  const maxSourceBytes = boundedInteger(
    options.maxSourceBytes,
    DEFAULT_MAX_SOURCE_BYTES,
    1_024,
    2_000_000
  );

  if (
    !fs.existsSync(clientRoot) ||
    !fs.existsSync(manifestPath)
  ) {
    return [];
  }

  let routes: ManifestRoute[];

  try {
    const manifest = yaml.parse(
      fs.readFileSync(manifestPath, "utf8")
    ) as { routes?: ManifestRoute[] };
    routes = Array.isArray(manifest.routes)
      ? manifest.routes
      : [];
  } catch {
    return [];
  }

  const authoritativeRoutes = routes.filter(
    (route) =>
      route.authoritative === true &&
      route.routeKind === "STATIC" &&
      typeof route.path === "string" &&
      typeof route.area === "string" &&
      (
        route.persona === "company_admin" ||
        route.persona === "talent"
      )
  );
  const records = readSourceRecords(
    clientRoot,
    maxFiles,
    maxSourceBytes
  );
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

  const declarations:
    SourceCardCollectionDeclaration[] = [];

  for (const record of records.values()) {
    const moduleMatch = record.file.match(
      /^src\/modules\/(company|talent)\/([^/]+)\//
    );

    if (!moduleMatch) continue;
    const persona = moduleMatch[1] === "company"
      ? "company_admin" as const
      : "talent" as const;
    const area = moduleMatch[2]!;
    const surfaceMatches =
      authoritativeRoutes.filter(
        (route) =>
          route.persona === persona &&
          route.area === area
      );

    if (surfaceMatches.length !== 1) {
      continue;
    }

    const candidates =
      extractSourceCardCollectionCandidates({
        source: record.source,
        file: record.file,
        maxSourceBytes,
      });

    for (const candidate of candidates) {
      const itemRecord = resolveModuleFile(
        records,
        record.file,
        candidate.itemComponentModule
      );

      if (!itemRecord) continue;
      const contract = deriveRuntimeContract(
        records,
        candidate,
        itemRecord
      );

      if (!contract) continue;
      const route = surfaceMatches[0]!;
      const paginationRef =
        findPaginationRef(
          records,
          candidate.collectionComponentRef.symbol
        );

      declarations.push({
        collectionComponentRef:
          candidate.collectionComponentRef,
        itemComponentRef:
          contract.itemComponentRef,
        iterationKind:
          candidate.iterationKind,
        sourceItemExpression:
          candidate.sourceItemExpression,
        ...(candidate.sourceItemKeyExpression
          ? {
              sourceItemKey: {
                expression:
                  candidate.sourceItemKeyExpression,
                available: true,
              },
            }
          : {}),
        itemProps: candidate.itemProps,
        surface: {
          route: route.path!,
          persona,
          area,
          sourceRef:
            String(route.sourceRef ?? "")
              .slice(0, MAX_REF_LENGTH),
        },
        runtimeSignature:
          contract.runtimeSignature,
        visibleFields:
          contract.visibleFields,
        ...(contract.cardFields
          ? {
              cardFields:
                contract.cardFields.map(
                  (field) => ({
                    ...field,
                    ...(sourceCommitRef
                      ? { sourceCommitRef }
                      : {}),
                  })
                ),
            }
          : {}),
        ...(paginationRef
          ? {
              pagination: {
                sourceRef: paginationRef,
              },
            }
          : {}),
        sourceRef: candidate.sourceRef,
        ...(sourceCommitRef
          ? { sourceCommitRef }
          : {}),
        authoritative: true,
      });
    }
  }

  const unique = new Map<
    string,
    SourceCardCollectionDeclaration
  >();

  for (const declaration of declarations) {
    unique.set(
      JSON.stringify([
        declaration.surface.route,
        declaration.collectionComponentRef,
        declaration.itemComponentRef,
      ]),
      declaration
    );
  }

  const result = [...unique.values()]
    .sort((left, right) =>
      left.surface.route.localeCompare(
        right.surface.route
      ) ||
      left.sourceRef.localeCompare(
        right.sourceRef
      )
    )
    .slice(0, 50);

  if (useDefaultCache) {
    cachedDefaultDeclarations = result;
  }

  return result;
}
