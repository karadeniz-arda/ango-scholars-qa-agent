import type {
  ApiExecutionContext,
} from "./api-runtime-execution-context.js";

export function isUnknownPathWithOptionalQuery(path: string): boolean {
  const trimmed = String(path || "").trim();

  if (!trimmed) return true;

  const [basePath] = trimmed.split("?");

  return String(basePath || "").trim().toUpperCase() === "UNKNOWN";
}

export function mergeCandidatePathWithOriginalQuery(
  originalPath: string,
  candidatePath: string
): string {
  const queryIndex = String(originalPath || "").indexOf("?");

  if (queryIndex === -1) {
    return candidatePath;
  }

  const query = originalPath.slice(queryIndex);

  if (!query || query === "?") {
    return candidatePath;
  }

  return `${candidatePath}${query}`;
}

function resolveUnknownQueryParams(
  path: string,
  context: ApiExecutionContext
): string {
  if (!path.includes("?")) {
    return path;
  }

  const queryIndex =
    path.indexOf("?");

  const basePath =
    path.slice(0, queryIndex);

  const rawQuery =
    path.slice(queryIndex + 1);

  if (!rawQuery) {
    return basePath;
  }

  const inputParams =
    new URLSearchParams(rawQuery);

  const outputParams =
    new URLSearchParams();

  const contextValues:
    Record<
      string,
      string | undefined
    > = {
      companyId:
        context.companyId,
      projectId:
        context.projectId,
      jobId:
        context.jobId,
      assessmentId:
        context.assessmentId,
      talentId:
        context.talentId,
      workSetupId:
        context.workSetupId,
      familyId:
        context.familyId,
      talentJobWorkSetupId:
        context.talentJobWorkSetupId,
      id:
        context.id ??
        context.workSetupId,
    };

  const hasUnknownSkillIds =
    inputParams
      .getAll("skillIds")
      .some(
        (value) =>
          String(value)
            .toUpperCase() ===
          "UNKNOWN"
      );

  let skillIdsExpanded = false;

  for (
    const [key, value]
    of inputParams.entries()
  ) {
    const isUnknown =
      String(value)
        .toUpperCase() ===
      "UNKNOWN";

    if (!isUnknown) {
      outputParams.append(
        key,
        value
      );

      continue;
    }

    if (key === "skillIds") {
      if (!skillIdsExpanded) {
        for (
          const skillId
          of context.skillIds || []
        ) {
          outputParams.append(
            "skillIds",
            skillId
          );
        }

        skillIdsExpanded = true;
      }

      continue;
    }

    if (
      key === "category" &&
      context.skillCategory
    ) {
      outputParams.append(
        key,
        context.skillCategory
      );

      continue;
    }

    if (
      key === "mainDiscipline" &&
      context.mainDiscipline
    ) {
      outputParams.append(
        key,
        context.mainDiscipline
      );

      continue;
    }

    if (
      key === "limit" &&
      hasUnknownSkillIds &&
      context.skillIds?.length
    ) {
      outputParams.append(
        key,
        String(
          context.skillIds.length
        )
      );

      continue;
    }

    const contextValue =
      contextValues[key];

    if (contextValue) {
      outputParams.append(
        key,
        contextValue
      );
    }

    /*
     * Unknown values without a safe runtime fixture are
     * intentionally omitted.
     */
  }

  const cleanedQuery =
    outputParams.toString();

  return cleanedQuery
    ? `${basePath}?${cleanedQuery}`
    : basePath;
}

function resolveGenericPathId(
  path: string,
  context: ApiExecutionContext
): string | undefined {
  const normalizedPath =
    String(path || "").toLowerCase();

  const hasGenericIdAfter = (
    resource: string
  ): boolean =>
    normalizedPath.includes(
      `/${resource}/{id}`
    ) ||
    normalizedPath.includes(
      `/${resource}/:id`
    );

  /*
   * A generic {id} must be resolved from the
   * resource segment that owns it.
   *
   * Never fall back to context.id here because
   * context.id may belong to an unrelated entity.
   */
  if (
    hasGenericIdAfter("assessments")
  ) {
    return context.assessmentId;
  }

  if (
    hasGenericIdAfter(
      "talent-job-work-setups"
    )
  ) {
    return context.talentJobWorkSetupId;
  }

  if (
    hasGenericIdAfter("work-setups")
  ) {
    return context.workSetupId;
  }

    if (
    hasGenericIdAfter("invoices")
  ) {
    return context.invoiceId;
  }

  if (
    hasGenericIdAfter("jobs")
  ) {
    return context.jobId;
  }

  if (
    hasGenericIdAfter("projects")
  ) {
    return context.projectId;
  }

  if (
    hasGenericIdAfter("talents")
  ) {
    return context.talentId;
  }

  /*
   * Unknown ownership stays unresolved so the
   * existing unresolved-path guard returns BLOCKED
   * instead of sending a request with a guessed ID.
   */
  return undefined;
}

function resolvePath(path: string, context: ApiExecutionContext): string {
  let resolvedPath = String(path || "").trim();

  const replacements: Record<string, string | undefined> = {
    companyId: context.companyId,
    projectId: context.projectId,
    assessmentId: context.assessmentId,
    jobId: context.jobId,
    invoiceId: context.invoiceId,
    id: resolveGenericPathId(
      resolvedPath,
      context
    ),
    workSetupId: context.workSetupId,
    familyId: context.familyId,
    talentId: context.talentId,
    talentJobWorkSetupId: context.talentJobWorkSetupId,
  };

  for (const [key, value] of Object.entries(replacements)) {
    if (!value) continue;

    resolvedPath = resolvedPath.replaceAll(`{${key}}`, value);
    resolvedPath = resolvedPath.replaceAll(`:${key}`, value);
  }

  if (context.companyId) {
    resolvedPath = resolvedPath.replaceAll(
      "/companies/UNKNOWN",
      `/companies/${context.companyId}`
    );
  }

  if (context.projectId) {
    resolvedPath = resolvedPath.replaceAll(
      "/projects/UNKNOWN",
      `/projects/${context.projectId}`
    );
  }

  if (context.jobId) {
    resolvedPath = resolvedPath.replaceAll(
      "/jobs/UNKNOWN",
      `/jobs/${context.jobId}`
    );
  }

  if (context.talentId) {
    resolvedPath = resolvedPath.replaceAll(
      "/talents/UNKNOWN",
      `/talents/${context.talentId}`
    );
  }

  resolvedPath = resolveUnknownQueryParams(resolvedPath, context);

  return resolvedPath;
}

function resolveBodyValue(value: any, context: ApiExecutionContext): any {
  if (Array.isArray(value)) {
    return value.map((item) => resolveBodyValue(item, context));
  }

  if (value && typeof value === "object") {
    const next: Record<string, any> = {};

    for (const [key, childValue] of Object.entries(value)) {
      next[key] = resolveBodyValue(childValue, context);
    }

    return next;
  }

  if (typeof value !== "string") {
    return value;
  }

  let resolved = value;

  const replacements: Record<string, string | undefined> = {
    companyId: context.companyId,
    projectId: context.projectId,
    jobId: context.jobId,
    assessmentId: context.assessmentId,
    invoiceId: context.invoiceId,
    id: context.id ?? context.workSetupId,
    workSetupId: context.workSetupId,
    familyId: context.familyId,
    talentId: context.talentId,
    talentJobWorkSetupId: context.talentJobWorkSetupId,
  };

  for (const [key, replacement] of Object.entries(replacements)) {
    if (!replacement) continue;

    resolved = resolved.replaceAll(`{${key}}`, replacement);

    if (resolved.toUpperCase() === "UNKNOWN") {
      resolved = replacement;
    }
  }

  return resolved;
}

export function resolveTestCase(testCase: any, context: ApiExecutionContext): any {
  return {
    ...testCase,
    path: resolvePath(testCase.path, context),
    body:
      testCase.body === undefined
        ? undefined
        : resolveBodyValue(testCase.body, context),
  };
}

export function hasUnresolvedPathValue(path: string): boolean {
  return (
    !path ||
    path.toUpperCase().includes("UNKNOWN") ||
    /{[^}]+}/.test(path) ||
    /:[A-Za-z0-9_]+/.test(path)
  );
}
