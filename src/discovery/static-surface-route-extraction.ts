import path from "node:path";
import * as ts from "typescript";

export type StaticSurfaceRouteDerivation =
  | "DIRECT"
  | "NESTED_COMPOSITION";

export type StaticSurfaceRouteKind =
  | "STATIC"
  | "PARAMETERIZED";

export type StaticSurfaceRouteSource = {
  file: string;
  source: string;
};

export type RecoveredStaticSurfaceRoute = {
  route: string;
  origin: "UI_ROUTE_MANIFEST";
  sourceRef: string;
  authoritative: true;
  derivation: StaticSurfaceRouteDerivation;
  routeKind: StaticSurfaceRouteKind;
  childRoute: string;
  /** Imported page components mounted by this route declaration. */
  mountedComponents?: string[];
  /** Exact import targets; component names alone cannot corroborate a surface. */
  mountedComponentSources?: Array<{ componentName: string; file: string }>;
  parentRoute?: string;
  parentSourceRef?: string;
};

type ImportedComponent = {
  localName: string;
  moduleSpecifier: string;
};

type RouteDeclaration = {
  path?: string;
  sourceRef: string;
  mountedComponents: string[];
  children: RouteDeclaration[];
};

type ParsedRouteFile = {
  file: string;
  imports: Map<string, ImportedComponent>;
  routes: RouteDeclaration[];
};

const UI_ROUTE_PREFIX =
  /^\/(?:company|talent|admin)(?:\/|$)/;

function normalizeFile(file: string): string {
  return file.replaceAll(path.sep, "/");
}

function jsxTagName(
  name: ts.JsxTagNameExpression
): string | undefined {
  return ts.isIdentifier(name)
    ? name.text
    : undefined;
}

function stringAttribute(
  attributes: ts.JsxAttributes,
  name: string
): string | undefined {
  const attribute = attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) &&
      property.name.getText() === name
  );

  if (
    !attribute ||
    !ts.isJsxAttribute(attribute) ||
    !attribute.initializer
  ) {
    return undefined;
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text.trim();
  }

  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteralLike(
      attribute.initializer.expression
    )
  ) {
    return attribute.initializer.expression.text.trim();
  }

  return undefined;
}

function collectMountedComponents(
  node: ts.Node,
  imports: Map<string, ImportedComponent>
): string[] {
  const names = new Set<string>();

  function visit(current: ts.Node): void {
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      const name = jsxTagName(current.tagName);

      if (name && imports.has(name)) {
        names.add(name);
      }
    }

    ts.forEachChild(current, visit);
  }

  visit(node);

  return [...names].sort();
}

function routeSourceRef(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  file: string
): string {
  const line =
    sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    ).line + 1;

  return `${normalizeFile(file)}:${line}`;
}

function parseImports(
  sourceFile: ts.SourceFile
): Map<string, ImportedComponent> {
  const imports =
    new Map<string, ImportedComponent>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    ) {
      continue;
    }

    const moduleSpecifier =
      statement.moduleSpecifier.text;
    const defaultImport =
      statement.importClause.name;

    if (defaultImport) {
      imports.set(defaultImport.text, {
        localName: defaultImport.text,
        moduleSpecifier,
      });
    }

    const bindings =
      statement.importClause.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          localName: element.name.text,
          moduleSpecifier,
        });
      }
    }
  }

  return imports;
}

function parseRouteFile(
  input: StaticSurfaceRouteSource
): ParsedRouteFile {
  const sourceFile = ts.createSourceFile(
    input.file,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    input.file.endsWith("x")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );
  const imports = parseImports(sourceFile);

  function parseRouteNode(
    node: ts.JsxElement | ts.JsxSelfClosingElement
  ): RouteDeclaration {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : node;
    const elementAttribute =
      opening.attributes.properties.find(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.getText() === "element"
      );
    const children: RouteDeclaration[] = [];
    const declaredPath = stringAttribute(
      opening.attributes,
      "path"
    );

    if (ts.isJsxElement(node)) {
      for (const child of node.children) {
        collectRoutes(child, children);
      }
    }

    return {
      ...(declaredPath
        ? { path: declaredPath }
        : {}),
      sourceRef: routeSourceRef(
        sourceFile,
        opening,
        input.file
      ),
      mountedComponents:
        elementAttribute &&
        ts.isJsxAttribute(elementAttribute) &&
        elementAttribute.initializer
          ? collectMountedComponents(
              elementAttribute.initializer,
              imports
            )
          : [],
      children,
    };
  }

  function collectRoutes(
    node: ts.Node,
    output: RouteDeclaration[]
  ): void {
    if (
      ts.isJsxElement(node) &&
      jsxTagName(node.openingElement.tagName) ===
        "Route"
    ) {
      output.push(parseRouteNode(node));
      return;
    }

    if (
      ts.isJsxSelfClosingElement(node) &&
      jsxTagName(node.tagName) === "Route"
    ) {
      output.push(parseRouteNode(node));
      return;
    }

    ts.forEachChild(node, (child) =>
      collectRoutes(child, output)
    );
  }

  const routes: RouteDeclaration[] = [];
  collectRoutes(sourceFile, routes);

  return {
    file: normalizeFile(input.file),
    imports,
    routes,
  };
}

function stripMountWildcard(route: string): string {
  return route
    .replace(/\/\*$/, "")
    .replace(/\/+$/, "") || "/";
}

function composeRoute(
  parent: string | undefined,
  child: string
): string | undefined {
  const normalizedChild = child.trim();

  if (
    !normalizedChild ||
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(
      normalizedChild
    ) ||
    normalizedChild.startsWith("/api/") ||
    normalizedChild.startsWith("/companies/") ||
    normalizedChild.startsWith("/talents/")
  ) {
    return undefined;
  }

  if (normalizedChild.startsWith("/")) {
    return normalizedChild;
  }

  if (!parent) return undefined;

  const base = stripMountWildcard(parent);

  return `${base === "/" ? "" : base}/${normalizedChild}`
    .replace(/\/{2,}/g, "/");
}

function isParameterized(route: string): boolean {
  return (
    /:[A-Za-z0-9_]+/.test(route) ||
    /\{[A-Za-z0-9_]+\}/.test(route) ||
    /\$[A-Za-z0-9_]+/.test(route)
  );
}

function resolveImportedFile(
  currentFile: string,
  moduleSpecifier: string,
  files: Map<string, ParsedRouteFile>
): string | undefined {
  if (
    !moduleSpecifier.startsWith(".") &&
    !moduleSpecifier.startsWith("@/")
  ) {
    return undefined;
  }

  const base = moduleSpecifier.startsWith("@/")
    ? `src/${moduleSpecifier.slice(2)}`
    : normalizeFile(
        path.posix.join(
          path.posix.dirname(currentFile),
          moduleSpecifier
        )
      );
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx"].map(
      (extension) => `${base}${extension}`
    ),
    ...[".ts", ".tsx", ".js", ".jsx"].map(
      (extension) =>
        `${base}/index${extension}`
    ),
  ];

  return candidates.find((candidate) =>
    files.has(candidate)
  );
}

function normalizeRecoveredRoute(
  route: string
): string | undefined {
  const normalized = route
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");

  if (
    normalized.includes("*") ||
    !UI_ROUTE_PREFIX.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

/**
 * Recovers browser routes only from explicit React Router structure.
 * Text, comments, planner output, and feature names are not inputs.
 */
export function recoverStaticSurfaceRoutes(
  sources: StaticSurfaceRouteSource[]
): RecoveredStaticSurfaceRoute[] {
  const files = new Map(
    sources
      .map(parseRouteFile)
      .map((parsed) => [parsed.file, parsed] as const)
  );
  const recovered: RecoveredStaticSurfaceRoute[] = [];
  const visitedMounts = new Set<string>();
  const activeFiles = new Set<string>();

  function visitFile(
    file: ParsedRouteFile,
    baseRoute?: string,
    parentSourceRef?: string
  ): void {
    const visitKey = `${file.file}\u0000${baseRoute ?? ""}`;

    if (
      visitedMounts.has(visitKey) ||
      activeFiles.has(file.file)
    ) {
      return;
    }
    visitedMounts.add(visitKey);
    activeFiles.add(file.file);

    for (const declaration of file.routes) {
      visitDeclaration(
        file,
        declaration,
        baseRoute,
        parentSourceRef
      );
    }

    activeFiles.delete(file.file);
  }

  function visitDeclaration(
    file: ParsedRouteFile,
    declaration: RouteDeclaration,
    parentRoute?: string,
    parentSourceRef?: string
  ): void {
    const declaredPath = declaration.path;
    const composed = declaredPath
      ? composeRoute(parentRoute, declaredPath)
      : parentRoute;
    const directAbsolute = Boolean(
      declaredPath?.startsWith("/")
    );
    const normalized = composed
      ? normalizeRecoveredRoute(composed)
      : undefined;

    if (normalized && declaredPath) {
      const mountedComponentSources = declaration.mountedComponents.flatMap((componentName) => {
        const imported = file.imports.get(componentName);
        const targetFile = imported
          ? resolveImportedFile(file.file, imported.moduleSpecifier, files)
          : undefined;
        return targetFile ? [{ componentName, file: targetFile }] : [];
      });
      recovered.push({
        route: normalized,
        origin: "UI_ROUTE_MANIFEST",
        sourceRef: declaration.sourceRef,
        authoritative: true,
        derivation:
          directAbsolute && !parentRoute
            ? "DIRECT"
            : "NESTED_COMPOSITION",
        routeKind: isParameterized(normalized)
          ? "PARAMETERIZED"
          : "STATIC",
        childRoute: declaredPath,
        ...(declaration.mountedComponents.length > 0
          ? { mountedComponents: declaration.mountedComponents }
          : {}),
        ...(mountedComponentSources.length > 0
          ? { mountedComponentSources }
          : {}),
        ...(!directAbsolute && parentRoute
          ? { parentRoute }
          : {}),
        ...(!directAbsolute && parentSourceRef
          ? { parentSourceRef }
          : {}),
      });
    }

    const routeForChildren = composed ?? parentRoute;
    const relationshipSourceRef = declaredPath
      ? declaration.sourceRef
      : parentSourceRef;

    for (const child of declaration.children) {
      visitDeclaration(
        file,
        child,
        routeForChildren,
        relationshipSourceRef
      );
    }

    if (!routeForChildren) return;

    for (const componentName of declaration.mountedComponents) {
      const imported = file.imports.get(componentName);
      const targetFile = imported
        ? resolveImportedFile(
            file.file,
            imported.moduleSpecifier,
            files
          )
        : undefined;

      if (!targetFile) continue;

      visitFile(
        files.get(targetFile)!,
        stripMountWildcard(routeForChildren),
        declaration.sourceRef
      );
    }
  }

  for (const file of files.values()) {
    visitFile(file);
  }

  const byRoute =
    new Map<string, RecoveredStaticSurfaceRoute>();

  for (const candidate of recovered.sort(
    (left, right) =>
      left.route.localeCompare(right.route) ||
      (
        left.derivation === "DIRECT" ? 0 : 1
      ) -
        (
          right.derivation === "DIRECT" ? 0 : 1
        ) ||
      left.sourceRef.localeCompare(right.sourceRef)
  )) {
    if (!byRoute.has(candidate.route)) {
      byRoute.set(candidate.route, candidate);
    }
  }

  return [...byRoute.values()];
}
