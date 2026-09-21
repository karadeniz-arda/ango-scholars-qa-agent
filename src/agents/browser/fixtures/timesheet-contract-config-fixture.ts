import {
  normalizeVerifiedFixtureStateFact,
  type VerifiedFixtureStateFact,
} from "./verified-contract-fixture-state.js";

export type TimesheetContractConfigFamily =
  | "COMPANY_WEEKLY_PAYMENT_SOURCE"
  | "TALENT_CATEGORY_VISIBILITY_SOURCE";

export type TimesheetContractConfigRequirement = {
  key: string;
  expected: string | number | boolean;
  mandatory: true;
  sourceRef: string;
};

export type TimesheetContractConfigRequirementContext = {
  status: "NOT_APPLICABLE" | "RESOLVED" | "INVALID";
  family?: TimesheetContractConfigFamily;
  policy?: "exact" | "compatible-state";
  exactEntityId?: string;
  requirements: TimesheetContractConfigRequirement[];
  reason: string;
};

export type TimesheetContractConfigCandidate = {
  identity: {
    entityKind: "timesheet-week-dataset" | "contract";
    entityId: string;
    contractIds: string[];
    ownerId: string;
    persona: "company_admin" | "talent";
    source: "AUTHENTICATED_GET";
    identityVerified: true;
    ownershipVerified: boolean;
  };
  facts: VerifiedFixtureStateFact[];
};

export type TimesheetContractConfigCandidateEvaluation = {
  entityId: string;
  status: "COMPATIBLE" | "INCOMPATIBLE" | "STATE_UNKNOWN";
  reasons: string[];
};

export type TimesheetContractConfigReadiness = {
  status: "READY" | "UNAVAILABLE" | "UNKNOWN";
  reasonCode:
    | "EXACTLY_ONE_COMPATIBLE_ENTITY"
    | "NO_CANDIDATE_ENTITY"
    | "NO_COMPATIBLE_ENTITY"
    | "MANDATORY_STATE_UNOBSERVABLE"
    | "AMBIGUOUS_COMPATIBLE_ENTITY"
    | "IDENTITY_AUTHORITY_UNAVAILABLE"
    | "SOURCE_READ_FAILED"
    | "INVALID_REQUIREMENT";
  reason: string;
  candidateCount: number;
  selected?: TimesheetContractConfigCandidate;
  evaluations: TimesheetContractConfigCandidateEvaluation[];
};

type FixturePersona = "company_admin" | "talent";

const MAX_TIMESHEETS = 20;
const MAX_DATASET_CANDIDATES = 64;
const LOOKBACK_DAYS = 84;
const CATEGORIES = [
  "project",
  "training",
  "assessment",
  "nonProductive",
  "downtime",
] as const;

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/[’']s\b/g, "")
        .replace(/[_-]+/g, " ")
        .replace(/(?<!\d)\.(?!\d)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function scalarId(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return scalarId(record.id ?? record._id ?? record.contractId ?? record.jobId);
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value).trim();
  if (
    !id ||
    id.length > 200 ||
    id.includes("/") ||
    id.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(id)
  ) {
    return undefined;
  }
  return id;
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "data", "results"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function addFact(
  facts: VerifiedFixtureStateFact[],
  input: Parameters<typeof normalizeVerifiedFixtureStateFact>[0]
): void {
  const fact = normalizeVerifiedFixtureStateFact(input);
  if (fact && !facts.some((current) => current.key === fact.key)) {
    facts.push(fact);
  }
}

function hasOwn(record: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function categoryConfig(
  config: unknown,
  category: typeof CATEGORIES[number]
): Record<string, unknown> | undefined {
  const root = objectRecord(config);
  const entries = objectRecord(root?.entryCategories);
  return objectRecord(entries?.[category]);
}

function configPresent(record: Record<string, unknown>, key: string): boolean | undefined {
  if (!hasOwn(record, key)) return undefined;
  return objectRecord(record[key]) !== undefined;
}

function categoryBooleanSummary(
  config: unknown
): { visible: boolean; hidden: boolean; complete: boolean } | undefined {
  const root = objectRecord(config);
  const entries = objectRecord(root?.entryCategories);
  if (!entries) return undefined;

  let visible = false;
  let hidden = false;
  let observed = 0;
  for (const category of CATEGORIES) {
    const item = objectRecord(entries[category]);
    if (!item || typeof item.talentVisible !== "boolean") continue;
    observed += 1;
    visible ||= item.talentVisible;
    hidden ||= !item.talentVisible;
  }
  return { visible, hidden, complete: observed === CATEGORIES.length };
}

function visibilityDifference(contractConfig: unknown, jobConfig: unknown): boolean | undefined {
  const contractEntries = objectRecord(objectRecord(contractConfig)?.entryCategories);
  const jobEntries = objectRecord(objectRecord(jobConfig)?.entryCategories);
  if (!contractEntries || !jobEntries) return undefined;

  let compared = 0;
  for (const category of CATEGORIES) {
    const contract = objectRecord(contractEntries[category]);
    const job = objectRecord(jobEntries[category]);
    if (
      !contract ||
      !job ||
      typeof contract.talentVisible !== "boolean" ||
      typeof job.talentVisible !== "boolean"
    ) {
      continue;
    }
    compared += 1;
    if (contract.talentVisible !== job.talentVisible) return true;
  }
  return compared === CATEGORIES.length ? false : undefined;
}

function coefficientDifference(contractConfig: unknown, jobConfig: unknown): boolean | undefined {
  const contractEntries = objectRecord(objectRecord(contractConfig)?.entryCategories);
  const jobEntries = objectRecord(objectRecord(jobConfig)?.entryCategories);
  if (!contractEntries || !jobEntries) return undefined;

  let compared = 0;
  for (const category of CATEGORIES) {
    const contract = objectRecord(contractEntries[category]);
    const job = objectRecord(jobEntries[category]);
    if (
      !contract ||
      !job ||
      typeof contract.paymentCoefficient !== "number" ||
      typeof job.paymentCoefficient !== "number"
    ) {
      continue;
    }
    compared += 1;
    if (contract.paymentCoefficient !== job.paymentCoefficient) return true;
  }
  return compared === CATEGORIES.length ? false : undefined;
}

function sourceRef(persona: FixturePersona): string {
  return persona === "company_admin"
    ? "/companies/{companyId}/timesheets"
    : "/talents/{talentId}/timesheets";
}

function relationship(
  timesheet: Record<string, unknown>,
  persona: FixturePersona,
  ownerId: string
): {
  verified: boolean;
  contractId?: string;
  jobId?: string;
  weekStartDate?: string;
  rateType?: string;
  contract?: Record<string, unknown>;
  job?: Record<string, unknown>;
} {
  const contract = objectRecord(timesheet.contract);
  const job = objectRecord(contract?.job);
  const contractId = scalarId(contract);
  const jobId = scalarId(job);
  const timesheetContractId = scalarId(timesheet.contractId ?? timesheet.contract);
  const owner = persona === "company_admin"
    ? scalarId(timesheet.company ?? contract?.company)
    : scalarId(timesheet.talent ?? contract?.talent);
  const weekStartDate = typeof timesheet.weekStartDate === "string"
    ? timesheet.weekStartDate
    : undefined;
  const rateType = typeof contract?.rateType === "string"
    ? contract.rateType.toLowerCase()
    : undefined;

  return {
    verified: Boolean(
      contractId &&
      jobId &&
      timesheetContractId === contractId &&
      owner === ownerId
    ),
    ...(contractId ? { contractId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(weekStartDate ? { weekStartDate } : {}),
    ...(rateType ? { rateType } : {}),
    ...(contract ? { contract } : {}),
    ...(job ? { job } : {}),
  };
}

function hasTrainingEntry(timesheet: Record<string, unknown>, rateType: string): boolean | undefined {
  if (!hasOwn(timesheet, "entries") || !Array.isArray(timesheet.entries)) return undefined;
  return timesheet.entries.some((raw) => {
    const entry = objectRecord(raw);
    if (!entry || entry.deleted === true || entry.category !== "training") return false;
    return rateType === "hourly"
      ? entry.type === "timer" || entry.type === "manual-timer"
      : entry.type === "unit";
  });
}

type NormalizedTimesheet = {
  id: string;
  raw: Record<string, unknown>;
  relation: ReturnType<typeof relationship>;
};

function normalizedTimesheets(
  data: unknown,
  persona: FixturePersona,
  ownerId: string
): NormalizedTimesheet[] {
  return extractItems(data)
    .slice(0, MAX_TIMESHEETS)
    .flatMap((raw): NormalizedTimesheet[] => {
      const record = objectRecord(raw);
      const id = scalarId(record);
      if (!record || !id) return [];
      return [{ id, raw: record, relation: relationship(record, persona, ownerId) }];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildCompanyCandidate(
  hourly: NormalizedTimesheet,
  unit: NormalizedTimesheet,
  ownerId: string
): TimesheetContractConfigCandidate {
  const facts: VerifiedFixtureStateFact[] = [];
  const ref = sourceRef("company_admin");
  const add = (key: string, value: unknown, valueKind?: "boolean" | "number") =>
    addFact(facts, {
      key,
      value,
      ...(valueKind ? { valueKind } : {}),
      verification: "EXACT_RELATED_RESOURCE",
      sourceRef: ref,
    });

  for (const [prefix, timesheet] of [["hourly", hourly], ["unit", unit]] as const) {
    const relation = timesheet.relation;
    const contract = relation.contract;
    const job = relation.job;
    const contractConfig = contract?.timesheetConfig;
    const jobConfig = job?.timesheetConfig;
    const training = categoryConfig(contractConfig, "training");

    add(`dataset.${prefix}TimesheetPresent`, true, "boolean");
    add(`dataset.${prefix}RelationshipVerified`, relation.verified, "boolean");
    add(
      `dataset.${prefix}ContractConfigPresent`,
      contract ? configPresent(contract, "timesheetConfig") : undefined,
      "boolean"
    );
    add(
      `dataset.${prefix}TrainingCoefficient`,
      training?.paymentCoefficient,
      "number"
    );
    add(
      `dataset.${prefix}TrainingEntryPresent`,
      hasTrainingEntry(timesheet.raw, prefix),
      "boolean"
    );
    add(
      `dataset.${prefix}ContractJobCoefficientDifference`,
      coefficientDifference(contractConfig, jobConfig),
      "boolean"
    );
  }

  const contractIds = [hourly.relation.contractId, unit.relation.contractId]
    .filter((id): id is string => Boolean(id))
    .sort();
  return {
    identity: {
      entityKind: "timesheet-week-dataset",
      entityId: `${hourly.id}:${unit.id}`,
      contractIds,
      ownerId,
      persona: "company_admin",
      source: "AUTHENTICATED_GET",
      identityVerified: true,
      ownershipVerified: hourly.relation.verified && unit.relation.verified,
    },
    facts: facts.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function buildTalentCandidate(
  timesheets: NormalizedTimesheet[],
  ownerId: string,
  contractId: string
): TimesheetContractConfigCandidate {
  const representative = timesheets[0]!;
  const relation = representative.relation;
  const contract = relation.contract;
  const job = relation.job;
  const contractConfig = contract?.timesheetConfig;
  const summary = categoryBooleanSummary(contractConfig);
  const facts: VerifiedFixtureStateFact[] = [];
  const ref = sourceRef("talent");
  const add = (key: string, value: unknown) => addFact(facts, {
    key,
    value,
    valueKind: "boolean",
    verification: "EXACT_RELATED_RESOURCE",
    sourceRef: ref,
  });

  add("contract.timesheetBacked", true);
  add("contract.relationshipVerified", timesheets.every((item) => item.relation.verified));
  add(
    "contract.timesheetConfigPresent",
    contract ? configPresent(contract, "timesheetConfig") : undefined
  );
  add("contract.category.visiblePresent", summary?.visible);
  add("contract.category.hiddenPresent", summary?.hidden);
  add(
    "contract.jobTalentVisibilityDifferencePresent",
    visibilityDifference(contractConfig, job?.timesheetConfig)
  );

  return {
    identity: {
      entityKind: "contract",
      entityId: contractId,
      contractIds: [contractId],
      ownerId,
      persona: "talent",
      source: "AUTHENTICATED_GET",
      identityVerified: true,
      ownershipVerified: timesheets.every((item) => item.relation.verified),
    },
    facts: facts.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function buildTimesheetContractConfigRequirementContext(
  testCase: {
    persona?: unknown;
    goal?: unknown;
    successCriteria?: unknown;
    fixtureRequirements?: unknown;
    runtimeFixturePolicy?: unknown;
    fixtureIdentityAuthority?: {
      authority?: unknown;
      entityKind?: unknown;
      entityId?: unknown;
      sourceRef?: unknown;
    };
  }
): TimesheetContractConfigRequirementContext {
  const persona = testCase.persona === "company_admin" || testCase.persona === "talent"
    ? testCase.persona
    : undefined;
  const rawRequirements = Array.isArray(testCase.fixtureRequirements)
    ? testCase.fixtureRequirements.filter((item): item is string => typeof item === "string")
    : [];
  const requirementsText = normalizedText(rawRequirements.join(" "));
  const caseText = normalizedText(
    [testCase.goal, testCase.successCriteria, ...rawRequirements].join(" ")
  );
  const familySignal =
    caseText.includes("contract timesheet config") &&
    caseText.includes("job timesheet config");

  if (!persona || !familySignal) {
    return {
      status: "NOT_APPLICABLE",
      requirements: [],
      reason: "The case is outside the contract-versus-job timesheet-configuration fixture family.",
    };
  }

  const explicitIdentity =
    testCase.fixtureIdentityAuthority?.authority === "EXPLICIT_SOURCE_IDENTITY" &&
    testCase.fixtureIdentityAuthority.entityKind === "contract" &&
    testCase.fixtureIdentityAuthority.sourceRef === "jira.explicitFixtureIdentity"
      ? scalarId(testCase.fixtureIdentityAuthority.entityId)
      : undefined;
  const policy = explicitIdentity ? "exact" : "compatible-state";
  const add = (
    list: TimesheetContractConfigRequirement[],
    key: string,
    expected: string | number | boolean,
    sourceIndex: number
  ) => list.push({ key, expected, mandatory: true, sourceRef: `fixtureRequirements[${sourceIndex}]` });
  const findRef = (pattern: RegExp): number => rawRequirements.findIndex((text) => pattern.test(normalizedText(text)));
  const output: TimesheetContractConfigRequirement[] = [];

  if (persona === "company_admin") {
    const datasetRef = findRef(/both an hourly timesheet and a unit timesheet/);
    const configRef = findRef(/training entry category.*payment coefficient 0\.5/);
    const relationRef = findRef(/verify the selected records.*contract.*job relationship.*persisted timesheet entries/);
    if (datasetRef < 0 || configRef < 0 || relationRef < 0) {
      return {
        status: "INVALID",
        family: "COMPANY_WEEKLY_PAYMENT_SOURCE",
        policy,
        ...(explicitIdentity ? { exactEntityId: explicitIdentity } : {}),
        requirements: [],
        reason: "Mandatory company timesheet dataset, configuration, or relationship requirements were incomplete.",
      };
    }
    for (const prefix of ["hourly", "unit"] as const) {
      add(output, `dataset.${prefix}TimesheetPresent`, true, datasetRef);
      add(output, `dataset.${prefix}RelationshipVerified`, true, relationRef);
      add(output, `dataset.${prefix}ContractConfigPresent`, true, configRef);
      add(output, `dataset.${prefix}TrainingCoefficient`, 0.5, configRef);
      add(output, `dataset.${prefix}TrainingEntryPresent`, true, relationRef);
      add(output, `dataset.${prefix}ContractJobCoefficientDifference`, true, configRef);
    }
    return {
      status: "RESOLVED",
      family: "COMPANY_WEEKLY_PAYMENT_SOURCE",
      policy,
      ...(explicitIdentity ? { exactEntityId: explicitIdentity } : {}),
      requirements: output,
      reason: "The company weekly payment-source fixture contract was deterministically transported.",
    };
  }

  const configRef = findRef(/contract with a non null timesheet config.*at least one visible and one non visible category/);
  const differenceRef = findRef(/job timesheet config must differ.*talent visible/);
  const relationRef = findRef(/verify the contract.*associated job.*ownership.*permission/);
  if (configRef < 0 || differenceRef < 0 || relationRef < 0) {
    return {
      status: "INVALID",
      family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
      policy,
      ...(explicitIdentity ? { exactEntityId: explicitIdentity } : {}),
      requirements: [],
      reason: "Mandatory talent category-visibility, divergence, or relationship requirements were incomplete.",
    };
  }
  add(output, "contract.timesheetBacked", true, relationRef);
  add(output, "contract.relationshipVerified", true, relationRef);
  add(output, "contract.timesheetConfigPresent", true, configRef);
  add(output, "contract.category.visiblePresent", true, configRef);
  add(output, "contract.category.hiddenPresent", true, configRef);
  add(output, "contract.jobTalentVisibilityDifferencePresent", true, differenceRef);
  return {
    status: "RESOLVED",
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    policy,
    ...(explicitIdentity ? { exactEntityId: explicitIdentity } : {}),
    requirements: output,
    reason: "The talent category-visibility-source fixture contract was deterministically transported.",
  };
}

export function adaptTimesheetContractConfigCandidates(input: {
  data: unknown;
  family: TimesheetContractConfigFamily;
  ownerId: string;
}): TimesheetContractConfigCandidate[] {
  const persona: FixturePersona = input.family === "COMPANY_WEEKLY_PAYMENT_SOURCE"
    ? "company_admin"
    : "talent";
  const timesheets = normalizedTimesheets(input.data, persona, input.ownerId);

  if (input.family === "TALENT_CATEGORY_VISIBILITY_SOURCE") {
    const byContract = new Map<string, NormalizedTimesheet[]>();
    for (const timesheet of timesheets) {
      const contractId = timesheet.relation.contractId;
      if (!contractId) continue;
      byContract.set(contractId, [...(byContract.get(contractId) ?? []), timesheet]);
    }
    return [...byContract.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([contractId, records]) => buildTalentCandidate(records, input.ownerId, contractId));
  }

  const hourly = timesheets.filter((item) => item.relation.rateType === "hourly");
  const unit = timesheets.filter((item) => item.relation.rateType === "unit");
  const candidates: TimesheetContractConfigCandidate[] = [];
  for (const hourlyRecord of hourly) {
    for (const unitRecord of unit) {
      if (
        !hourlyRecord.relation.weekStartDate ||
        hourlyRecord.relation.weekStartDate !== unitRecord.relation.weekStartDate
      ) {
        continue;
      }
      candidates.push(buildCompanyCandidate(hourlyRecord, unitRecord, input.ownerId));
      if (candidates.length >= MAX_DATASET_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

export function evaluateTimesheetContractConfigCandidate(
  candidate: TimesheetContractConfigCandidate,
  context: TimesheetContractConfigRequirementContext
): TimesheetContractConfigCandidateEvaluation {
  if (context.status !== "RESOLVED" || !context.family) {
    return { entityId: candidate.identity.entityId, status: "STATE_UNKNOWN", reasons: [context.reason] };
  }
  if (
    !candidate.identity.ownershipVerified ||
    candidate.identity.source !== "AUTHENTICATED_GET" ||
    (context.family === "COMPANY_WEEKLY_PAYMENT_SOURCE" && candidate.identity.persona !== "company_admin") ||
    (context.family === "TALENT_CATEGORY_VISIBILITY_SOURCE" && candidate.identity.persona !== "talent")
  ) {
    return {
      entityId: candidate.identity.entityId,
      status: "INCOMPATIBLE",
      reasons: ["Candidate persona, ownership, or authenticated identity relationship was not verified."],
    };
  }
  if (context.policy === "exact") {
    if (!context.exactEntityId) {
      return {
        entityId: candidate.identity.entityId,
        status: "STATE_UNKNOWN",
        reasons: ["Exact policy has no authoritative contract identity."],
      };
    }
    if (!candidate.identity.contractIds.includes(context.exactEntityId)) {
      return {
        entityId: candidate.identity.entityId,
        status: "INCOMPATIBLE",
        reasons: ["Candidate does not contain the authoritative contract identity."],
      };
    }
  }

  const facts = new Map(candidate.facts.map((fact) => [fact.key, fact.value]));
  const reasons: string[] = [];
  let mismatch = false;
  let unknown = false;
  for (const requirement of context.requirements) {
    if (!facts.has(requirement.key)) {
      unknown = true;
      reasons.push(`Required fact ${requirement.key} is unverified.`);
    } else if (facts.get(requirement.key) !== requirement.expected) {
      mismatch = true;
      reasons.push(`Required fact ${requirement.key} definitively mismatched.`);
    }
  }
  if (mismatch) return { entityId: candidate.identity.entityId, status: "INCOMPATIBLE", reasons };
  if (unknown) return { entityId: candidate.identity.entityId, status: "STATE_UNKNOWN", reasons };
  return {
    entityId: candidate.identity.entityId,
    status: "COMPATIBLE",
    reasons: ["All mandatory timesheet/contract-configuration facts were exactly verified."],
  };
}

export function selectTimesheetContractConfigFixture(
  candidates: TimesheetContractConfigCandidate[],
  context: TimesheetContractConfigRequirementContext
): TimesheetContractConfigReadiness {
  if (context.status !== "RESOLVED") {
    return {
      status: "UNKNOWN",
      reasonCode: "INVALID_REQUIREMENT",
      reason: context.reason,
      candidateCount: candidates.length,
      evaluations: [],
    };
  }
  if (context.policy === "exact" && !context.exactEntityId) {
    return {
      status: "UNKNOWN",
      reasonCode: "IDENTITY_AUTHORITY_UNAVAILABLE",
      reason: "Exact fixture policy has no authoritative contract identity.",
      candidateCount: candidates.length,
      evaluations: [],
    };
  }
  if (
    context.policy === "exact" &&
    context.family === "COMPANY_WEEKLY_PAYMENT_SOURCE"
  ) {
    return {
      status: "UNKNOWN",
      reasonCode: "IDENTITY_AUTHORITY_UNAVAILABLE",
      reason:
        "One authoritative contract identity cannot authorize the second contract required by an hourly/unit dataset.",
      candidateCount: candidates.length,
      evaluations: [],
    };
  }
  if (candidates.length === 0) {
    return {
      status: "UNAVAILABLE",
      reasonCode: "NO_CANDIDATE_ENTITY",
      reason: "The bounded authenticated read returned no candidate entity for this fixture family.",
      candidateCount: 0,
      evaluations: [],
    };
  }
  const evaluations = candidates.map((candidate) =>
    evaluateTimesheetContractConfigCandidate(candidate, context)
  );
  const compatible = evaluations.filter((item) => item.status === "COMPATIBLE");
  if (compatible.length === 1) {
    const selected = candidates.find((item) => item.identity.entityId === compatible[0]!.entityId)!;
    return {
      status: "READY",
      reasonCode: "EXACTLY_ONE_COMPATIBLE_ENTITY",
      reason: "Exactly one source-backed candidate satisfies every mandatory fixture-state fact.",
      candidateCount: candidates.length,
      selected,
      evaluations,
    };
  }
  if (compatible.length > 1) {
    return {
      status: "UNKNOWN",
      reasonCode: "AMBIGUOUS_COMPATIBLE_ENTITY",
      reason: "Multiple source-backed candidates satisfy every mandatory fixture-state fact.",
      candidateCount: candidates.length,
      evaluations,
    };
  }
  if (evaluations.some((item) => item.status === "STATE_UNKNOWN")) {
    return {
      status: "UNKNOWN",
      reasonCode: "MANDATORY_STATE_UNOBSERVABLE",
      reason: "No candidate is proven compatible because a mandatory state fact is unobservable.",
      candidateCount: candidates.length,
      evaluations,
    };
  }
  return {
    status: "UNAVAILABLE",
    reasonCode: "NO_COMPATIBLE_ENTITY",
    reason: "No bounded source-backed candidate satisfies every mandatory fixture-state fact.",
    candidateCount: candidates.length,
    evaluations,
  };
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function resolveTimesheetContractConfigFixture(input: {
  context: TimesheetContractConfigRequirementContext;
  ownerId: string;
  getJson: (path: string) => Promise<unknown>;
  now?: Date;
}): Promise<TimesheetContractConfigReadiness> {
  if (input.context.status !== "RESOLVED" || !input.context.family) {
    return selectTimesheetContractConfigFixture([], input.context);
  }
  const now = input.now ?? new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - LOOKBACK_DAYS);
  const ownerId = encodeURIComponent(input.ownerId);
  const dateQuery = `dateFrom=${utcDateKey(from)}&dateTo=${utcDateKey(now)}`;
  const path = input.context.family === "COMPANY_WEEKLY_PAYMENT_SOURCE"
    ? `/companies/${ownerId}/timesheets?limit=${MAX_TIMESHEETS}&offset=0&${dateQuery}`
    : `/talents/${ownerId}/timesheets?${dateQuery}`;
  try {
    const data = await input.getJson(path);
    if (data === undefined) {
      return {
        status: "UNKNOWN",
        reasonCode: "SOURCE_READ_FAILED",
        reason: "The bounded authenticated timesheet GET did not return a readable response.",
        candidateCount: 0,
        evaluations: [],
      };
    }
    const candidates = adaptTimesheetContractConfigCandidates({
      data,
      family: input.context.family,
      ownerId: input.ownerId,
    });
    return selectTimesheetContractConfigFixture(candidates, input.context);
  } catch {
    return {
      status: "UNKNOWN",
      reasonCode: "SOURCE_READ_FAILED",
      reason: "The bounded authenticated timesheet GET failed.",
      candidateCount: 0,
      evaluations: [],
    };
  }
}

export const timesheetContractConfigFixtureBounds = {
  maxTimesheets: MAX_TIMESHEETS,
  maxDatasetCandidates: MAX_DATASET_CANDIDATES,
  lookbackDays: LOOKBACK_DAYS,
} as const;
