import type { RuntimeResourceContext } from "../../runtime/runtime-context.js";

const DISCOVERY_PATH = "/skills?limit=100&offset=0";

export type SkillsRuntimeRequirements = {
  requiresSelectedSkills: boolean;
  selectedSkillCount: number;
  includeCategory: boolean;
  includeMainDiscipline: boolean;
  limitMatchesSelectedCount: boolean;
  offsetZero: boolean;
};

export type SkillsRuntimeFixture = {
  skillIds: string[];
  skillLabels: string[];
  category?: string;
  mainDiscipline?: string;
};

export type SkillsRuntimeResolution =
  | { status: "READY"; fixture: SkillsRuntimeFixture; discoveryPath: string }
  | { status: "BLOCKED"; reason: string; discoveryPath?: string };

export type SkillsRuntimeQueryResult =
  | { status: "READY"; path: string }
  | { status: "BLOCKED"; reason: string };

type SkillRuntimeCandidate = {
  id: string;
  label: string;
  category?: string;
  mainDiscipline?: string;
};

function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/$/, "");
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalRequirementText(plan: any): string {
  const apiCases = Array.isArray(plan?.apiCases) ? plan.apiCases : [];
  const browserCases = Array.isArray(plan?.browserCases) ? plan.browserCases : [];

  return [
    plan?.summary,
    plan?.notes,
    ...apiCases.flatMap((testCase: any) => [
      testCase?.goal,
      testCase?.successCriteria,
      testCase?.path,
      testCase?.expect?.notes,
      testCase?.expect?.note,
    ]),
    ...browserCases.flatMap((testCase: any) => [
      testCase?.goal,
      testCase?.successCriteria,
      ...(Array.isArray(testCase?.automatedChecks)
        ? testCase.automatedChecks
        : []),
      ...(Array.isArray(testCase?.fixtureRequirements)
        ? testCase.fixtureRequirements
        : []),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function deriveSkillsRuntimeRequirements(plan: any): SkillsRuntimeRequirements {
  const text = canonicalRequirementText(plan);
  const requiresSelectedSkills =
    /\bskills?\b|skillids/.test(text) &&
    [
      /\bselected(?:-|\s)+skills?\b/,
      /\bexisting(?:-|\s)+selected(?:-|\s)+skills?\b/,
      /\bskillids\b[^.]{0,160}\b(?:selected|filter|request|query)\b/,
      /\b(?:request|query|filter)\b[^.]{0,160}\bskillids\b/,
    ].some((pattern) => pattern.test(text));

  const countMatch = text.match(
    /\b(?:exactly\s+|at\s+least\s+)?(\d+)\s+(?:existing\s+)?selected(?:-|\s)+skills?\b/
  );
  const explicitCount = Number(countMatch?.[1]);

  return {
    requiresSelectedSkills,
    selectedSkillCount:
      Number.isInteger(explicitCount) && explicitCount > 0 ? explicitCount : 1,
    includeCategory:
      /category=unknown|category\s+(?:query|filter)|filter(?:ed|ing)?\s+by\s+category/.test(text),
    includeMainDiscipline:
      /maindiscipline=unknown|main\s+discipline\s+(?:query|filter)|filter(?:ed|ing)?\s+by\s+main\s+discipline/.test(text),
    limitMatchesSelectedCount:
      /limit=unknown|limit[^.]{0,100}(?:equal|match)[^.]{0,100}(?:selected|skillids?)[^.]{0,80}(?:count|length)|limit\s+equal\s+to\s+the\s+selected-id\s+count/.test(text),
    offsetZero:
      /offset(?:\s*(?:=|equal(?:s|\s+to)?))?\s*0|offset\s+zero/.test(text),
  };
}

function extractSkillItems(data: unknown): { supported: boolean; items: any[] } {
  if (Array.isArray(data)) return { supported: true, items: data };
  if (!data || typeof data !== "object") return { supported: false, items: [] };

  const value = data as any;
  const candidates = [
    value.items,
    value.results,
    value.rows,
    value.skills,
    value.data,
    value.data?.items,
    value.data?.results,
    value.data?.rows,
    value.data?.skills,
  ];
  const items = candidates.find(Array.isArray);

  return items ? { supported: true, items } : { supported: false, items: [] };
}

function firstScalarString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return undefined;
}

function firstNamedValue(...values: any[]): string | undefined {
  for (const value of values) {
    const direct = firstScalarString(value);
    if (direct) return direct;

    if (value && typeof value === "object") {
      const nested = firstScalarString(
        value.name,
        value.label,
        value.title,
        value.value
      );
      if (nested) return nested;
    }
  }

  return undefined;
}

function getSkillId(item: any): string | undefined {
  const id = firstScalarString(
    item?.id,
    item?.skillId,
    item?.skill_id,
    item?._id,
    item?.skill?.id,
    item?.skill?.skillId
  );
  return id && /^\d+$/.test(id) ? id : undefined;
}

function getSkillLabel(item: any): string | undefined {
  return firstNamedValue(
    item?.name,
    item?.title,
    item?.definition,
    item?.label,
    item?.skillName,
    item?.skill_name,
    item?.skill
  );
}

function getSkillCategory(item: any): string | undefined {
  return firstNamedValue(
    item?.category,
    item?.categoryName,
    item?.category_name,
    item?.skillCategory,
    item?.skill_category,
    item?.skill?.category
  );
}

function getMainDiscipline(item: any): string | undefined {
  return firstNamedValue(
    item?.mainDiscipline,
    item?.main_discipline,
    item?.mainDisciplineName,
    item?.main_discipline_name,
    item?.discipline,
    item?.disciplineName,
    item?.skill?.mainDiscipline
  );
}

function skillIsUsable(item: any): boolean {
  if (
    item?.isActive === false ||
    item?.active === false ||
    item?.isDeleted === true ||
    item?.deleted === true
  ) {
    return false;
  }

  return !["archived", "deleted", "inactive"].includes(
    normalizeText(item?.status)
  );
}

export function skillRuntimeSemanticSortKey(
  candidate: Pick<SkillRuntimeCandidate, "label" | "category" | "mainDiscipline">
): string {
  return [
    normalizeText(candidate.label),
    normalizeText(candidate.category),
    normalizeText(candidate.mainDiscipline),
  ].join("\u0000");
}

export function selectSkillsRuntimeFixture(
  data: unknown,
  requirements: SkillsRuntimeRequirements
): SkillsRuntimeResolution {
  const extracted = extractSkillItems(data);
  if (!extracted.supported) {
    return {
      status: "BLOCKED",
      reason: "Skills runtime discovery returned an unsupported response shape.",
      discoveryPath: DISCOVERY_PATH,
    };
  }

  const unique = new Map<string, SkillRuntimeCandidate>();

  for (const item of extracted.items) {
    const id = getSkillId(item);
    const label = getSkillLabel(item);
    if (!id || !label || !skillIsUsable(item)) continue;

    const category = getSkillCategory(item);
    const mainDiscipline = getMainDiscipline(item);
    const candidate: SkillRuntimeCandidate = {
      id,
      label,
      ...(category ? { category } : {}),
      ...(mainDiscipline ? { mainDiscipline } : {}),
    };
    const existing = unique.get(id);

    if (
      existing &&
      skillRuntimeSemanticSortKey(existing) !== skillRuntimeSemanticSortKey(candidate)
    ) {
      return {
        status: "BLOCKED",
        reason: "Skills runtime discovery returned conflicting records for one identifier.",
        discoveryPath: DISCOVERY_PATH,
      };
    }

    if (!existing) unique.set(id, candidate);
  }

  const ordered = [...unique.values()].sort((left, right) => {
    const semanticOrder = compareText(
      skillRuntimeSemanticSortKey(left),
      skillRuntimeSemanticSortKey(right)
    );
    return semanticOrder || compareText(left.id, right.id);
  });

  if (ordered.length < requirements.selectedSkillCount) {
    return {
      status: "BLOCKED",
      reason:
        "Skills runtime discovery found fewer valid existing records than the canonical requirement needs.",
      discoveryPath: DISCOVERY_PATH,
    };
  }

  const selected = ordered.slice(0, requirements.selectedSkillCount);
  const fixture: SkillsRuntimeFixture = {
    skillIds: selected.map((candidate) => candidate.id),
    skillLabels: selected.map((candidate) => candidate.label),
  };

  const exactOptionalValue = (
    key: "category" | "mainDiscipline",
    required: boolean
  ): string | undefined => {
    if (!required) return undefined;
    const values = new Set(selected.map((candidate) => candidate[key]).filter(Boolean));
    return values.size === 1 ? ([...values][0] as string) : undefined;
  };

  if (requirements.includeCategory) {
    const category = exactOptionalValue("category", true);
    if (!category) {
      return {
        status: "BLOCKED",
        reason: "The selected skill set cannot provide one exact required category.",
        discoveryPath: DISCOVERY_PATH,
      };
    }
    fixture.category = category;
  }

  if (requirements.includeMainDiscipline) {
    const mainDiscipline = exactOptionalValue("mainDiscipline", true);
    if (!mainDiscipline) {
      return {
        status: "BLOCKED",
        reason: "The selected skill set cannot provide one exact required main discipline.",
        discoveryPath: DISCOVERY_PATH,
      };
    }
    fixture.mainDiscipline = mainDiscipline;
  }

  return { status: "READY", fixture, discoveryPath: DISCOVERY_PATH };
}

function normalizedSkillIds(values: string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => String(value).split(","))
        .map((value) => value.trim())
        .filter((value) => /^\d+$/.test(value))
    ),
  ].sort(compareText);
}

export function mergeSkillsRuntimeQuery(
  path: string,
  fixture: SkillsRuntimeFixture,
  requirements: SkillsRuntimeRequirements
): SkillsRuntimeQueryResult {
  if (!requirements.requiresSelectedSkills) return { status: "READY", path };

  const [pathAndQuery = "", fragment] = String(path || "").split("#", 2);
  const queryIndex = pathAndQuery.indexOf("?");
  const basePath = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  if (!basePath.trim()) {
    return {
      status: "BLOCKED",
      reason: "Selected-skill query context cannot be attached to an empty route or endpoint.",
    };
  }

  const params = new URLSearchParams(
    queryIndex === -1 ? "" : pathAndQuery.slice(queryIndex + 1)
  );
  const expectedIds = normalizedSkillIds(fixture.skillIds);

  if (expectedIds.length === 0 || expectedIds.length !== fixture.skillIds.length) {
    return {
      status: "BLOCKED",
      reason: "Selected-skill runtime context contains malformed or duplicate identifiers.",
    };
  }

  const existingIds = normalizedSkillIds(
    params
      .getAll("skillIds")
      .filter((value) => value.trim().toUpperCase() !== "UNKNOWN")
  );
  if (existingIds.length > 0 && JSON.stringify(existingIds) !== JSON.stringify(expectedIds)) {
    return {
      status: "BLOCKED",
      reason: "Existing selected-skill query values disagree with the shared runtime fixture.",
    };
  }

  params.delete("skillIds");
  fixture.skillIds.forEach((id) => params.append("skillIds", id));

  const setRequiredValue = (
    key: string,
    value: string,
    mismatchReason: string
  ): string | undefined => {
    const existing = params.get(key);
    if (existing && existing.toUpperCase() !== "UNKNOWN" && normalizeText(existing) !== normalizeText(value)) {
      return mismatchReason;
    }
    params.set(key, value);
    return undefined;
  };

  const requiredValues: Array<[boolean, string, string | undefined, string]> = [
    [
      requirements.limitMatchesSelectedCount,
      "limit",
      String(fixture.skillIds.length),
      "Existing limit query value disagrees with the selected-skill count requirement.",
    ],
    [
      requirements.offsetZero,
      "offset",
      "0",
      "Existing offset query value disagrees with the required initial offset.",
    ],
    [
      requirements.includeCategory,
      "category",
      fixture.category,
      "Existing category query value disagrees with the selected runtime record.",
    ],
    [
      requirements.includeMainDiscipline,
      "mainDiscipline",
      fixture.mainDiscipline,
      "Existing mainDiscipline query value disagrees with the selected runtime record.",
    ],
  ];

  for (const [required, key, value, mismatchReason] of requiredValues) {
    if (!required) continue;
    if (!value) {
      return {
        status: "BLOCKED",
        reason: `Selected-skill runtime context is missing required ${key}.`,
      };
    }
    const mismatch = setRequiredValue(key, value, mismatchReason);
    if (mismatch) return { status: "BLOCKED", reason: mismatch };
  }

  const query = params.toString();
  const merged = query ? `${basePath}?${query}` : basePath;
  return { status: "READY", path: fragment ? `${merged}#${fragment}` : merged };
}

export function copySkillsRuntimeFixture(
  context: RuntimeResourceContext,
  fixture: SkillsRuntimeFixture
): void {
  context.skillIds = [...fixture.skillIds];
  context.skillLabels = [...fixture.skillLabels];
  context.skillCategory = fixture.category;
  context.mainDiscipline = fixture.mainDiscipline;
}

export async function resolveSkillsRuntimeFixture(
  apiUrl: string,
  token: string,
  requirements: SkillsRuntimeRequirements
): Promise<SkillsRuntimeResolution> {
  try {
    const response = await fetch(`${normalizeBaseUrl(apiUrl)}${DISCOVERY_PATH}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        status: "BLOCKED",
        reason: `Skills runtime discovery GET returned status ${response.status}.`,
        discoveryPath: DISCOVERY_PATH,
      };
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      return {
        status: "BLOCKED",
        reason: "Skills runtime discovery returned non-JSON data.",
        discoveryPath: DISCOVERY_PATH,
      };
    }

    return selectSkillsRuntimeFixture(data, requirements);
  } catch (error: unknown) {
    return {
      status: "BLOCKED",
      reason: `Skills runtime discovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      discoveryPath: DISCOVERY_PATH,
    };
  }
}
