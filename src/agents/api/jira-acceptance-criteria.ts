export type JiraFieldMetadata = {
  id?: unknown;
  name?: unknown;
  custom?: unknown;
  schema?: {
    type?: unknown;
    custom?: unknown;
  };
};

export type JiraAcceptanceCriteriaSource = {
  fieldId: string;
  fieldName: string;
  text: string;
};

export type JiraAcceptanceCriteriaDiscovery = {
  status: "RESOLVED" | "UNAVAILABLE";
  candidateFieldCount: number;
  sources: JiraAcceptanceCriteriaSource[];
};

function normalizeFieldName(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:\-]+$/g, "")
    .trim()
    .toLowerCase();
}

export function isAcceptanceCriteriaField(
  field: JiraFieldMetadata
): boolean {
  const normalized =
    normalizeFieldName(field?.name);

  return (
    normalized === "acceptance criteria" ||
    normalized === "acceptance criterion"
  );
}

export function findAcceptanceCriteriaFields(
  fields: JiraFieldMetadata[]
): JiraFieldMetadata[] {
  return Array.isArray(fields)
    ? fields.filter(
        isAcceptanceCriteriaField
      )
    : [];
}

export function jiraFieldValueToText(
  value: unknown
): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value
      .replace(/\s+/g, " ")
      .trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(jiraFieldValueToText)
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  const record =
    value as Record<string, unknown>;

  if (
    record.type === "text" &&
    typeof record.text === "string"
  ) {
    return record.text.trim();
  }

  if (record.type === "hardBreak") {
    return "\n";
  }

  if (Array.isArray(record.content)) {
    const contentText =
      record.content
        .map(jiraFieldValueToText)
        .filter(Boolean)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (contentText) {
      return contentText;
    }
  }

  if (typeof record.value === "string") {
    return record.value
      .replace(/\s+/g, " ")
      .trim();
  }

  if (typeof record.name === "string") {
    return record.name
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

/*
 * JIRA_ACCEPTANCE_SOURCE_DISCOVERY_V1
 *
 * Acceptance Criteria field IDs are Jira-instance metadata,
 * not stable product constants. Resolve them by semantic field
 * name and preserve every populated matching source.
 *
 * Multiple populated fields are intentionally not collapsed or
 * ranked here. Their provenance remains visible so a later
 * acceptance-completeness layer can fail safe on ambiguity.
 */
export function collectAcceptanceCriteriaSources(
  fields: JiraFieldMetadata[],
  issueFields: Record<string, unknown>
): {
  candidateFieldCount: number;
  sources: JiraAcceptanceCriteriaSource[];
} {
  const candidates =
    findAcceptanceCriteriaFields(fields);

  const sources =
    candidates.flatMap((field) => {
      const fieldId =
        String(field?.id ?? "").trim();
      const fieldName =
        String(field?.name ?? "").trim();

      if (!fieldId || !fieldName) {
        return [];
      }

      const text =
        jiraFieldValueToText(
          issueFields?.[fieldId]
        );

      if (!text) {
        return [];
      }

      return [
        {
          fieldId,
          fieldName,
          text,
        },
      ];
    });

  return {
    candidateFieldCount:
      candidates.length,
    sources,
  };
}
