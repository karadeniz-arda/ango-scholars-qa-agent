import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  adaptTimesheetContractConfigCandidates,
  buildTimesheetContractConfigRequirementContext,
  evaluateTimesheetContractConfigCandidate,
  resolveTimesheetContractConfigFixture,
  selectTimesheetContractConfigFixture,
  timesheetContractConfigFixtureBounds,
  type TimesheetContractConfigRequirementContext,
} from "./timesheet-contract-config-fixture.js";
import {
  prepareTimesheetContractConfigFixture,
} from "./timesheet-contract-config-fixture-runtime.js";

const companyRequirements = [
  "A company_admin-accessible company timesheet weekly-view route; the exact browser route was not supplied.",
  "A runtime-resolved dataset containing both an hourly timesheet and a unit timesheet.",
  "For both records, the contract timesheetConfig must contain the TRAINING entry category with paymentCoefficient 0.5, and the associated job timesheetConfig must differ sufficiently to make the configuration source observable.",
  "The runtime resolver must verify the selected records, their contract/job relationship, and the required persisted timesheet entries before execution.",
];

const talentRequirements = [
  "A talent-accessible talent timesheet route; the exact browser route was not supplied.",
  "A runtime-resolved contract with a non-null timesheetConfig and entryCategories containing at least one visible and one non-visible category.",
  "The associated job timesheetConfig must differ in at least one category's talentVisible setting so that the source of the rendered choices is observable.",
  "The runtime resolver must verify the contract, associated job, ownership, and permission state before execution.",
];

function config(
  coefficient = 0.5,
  trainingVisible = false
) {
  return {
    entryCategories: {
      project: { paymentCoefficient: 1, talentVisible: true, billable: true },
      training: { paymentCoefficient: coefficient, talentVisible: trainingVisible, billable: false },
      assessment: { paymentCoefficient: 1, talentVisible: true, billable: true },
      nonProductive: { paymentCoefficient: 0, talentVisible: false, billable: false },
      downtime: { paymentCoefficient: 0, talentVisible: false, billable: false },
    },
  };
}

function timesheet(input: {
  id: number;
  contractId: number;
  jobId?: number;
  rateType: "hourly" | "unit";
  ownerId?: number;
  talentId?: number;
  week?: string;
  contractConfig?: unknown;
  jobConfig?: unknown;
  trainingEntry?: boolean;
  contractIdAlias?: number;
  sensitive?: string;
}) {
  const ownerId = input.ownerId ?? 7;
  const talentId = input.talentId ?? 9;
  return {
    id: input.id,
    ...(input.contractIdAlias ? { contractId: input.contractIdAlias } : {}),
    weekStartDate: input.week ?? "2026-08-23",
    company: { id: ownerId, name: "sensitive-company-name" },
    talent: { id: talentId, email: "sensitive@example.invalid" },
    contract: {
      id: input.contractId,
      company: { id: ownerId },
      talent: { id: talentId },
      status: "active",
      rateType: input.rateType,
      timesheetConfig: input.contractConfig ?? config(),
      job: {
        id: input.jobId ?? input.contractId + 100,
        timesheetConfig: input.jobConfig ?? config(1, true),
      },
    },
    entries: input.trainingEntry === false
      ? []
      : [{
          id: input.id + 1000,
          category: "training",
          type: input.rateType === "hourly" ? "manual-timer" : "unit",
          deleted: false,
        }],
    secret: input.sensitive,
  };
}

function companyCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "web-company",
    persona: "company_admin",
    goal: "Verify company payment calculations use contract timesheetConfig rather than job timesheetConfig.",
    successCriteria: "The weekly view uses contract timesheetConfig and not job timesheetConfig.",
    runtimeFixturePolicy: "exact",
    fixtureRequirements: companyRequirements,
    ...overrides,
  };
}

function talentCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "web-talent",
    persona: "talent",
    goal: "Verify category choices use contract timesheetConfig rather than job timesheetConfig.",
    successCriteria: "Talent visibility follows contract timesheetConfig, not job timesheetConfig.",
    runtimeFixturePolicy: "exact",
    fixtureRequirements: talentRequirements,
    ...overrides,
  };
}

function companyContext() {
  return buildTimesheetContractConfigRequirementContext(companyCase());
}

function talentContext() {
  return buildTimesheetContractConfigRequirementContext(talentCase());
}

function readyCompanyData() {
  return {
    items: [
      timesheet({ id: 1, contractId: 11, rateType: "hourly" }),
      timesheet({ id: 2, contractId: 12, rateType: "unit" }),
    ],
  };
}

function readyTalentData() {
  return [
    timesheet({
      id: 3,
      contractId: 13,
      rateType: "hourly",
      ownerId: 7,
      talentId: 9,
    }),
  ];
}

test("transports every mandatory company payment-source fact", () => {
  const context = companyContext();
  assert.equal(context.status, "RESOLVED");
  assert.equal(context.requirements.length, 12);
  assert.ok(context.requirements.every((item) => item.mandatory));
});

test("keeps company and talent requirement families distinct", () => {
  assert.equal(companyContext().family, "COMPANY_WEEKLY_PAYMENT_SOURCE");
  assert.equal(talentContext().family, "TALENT_CATEGORY_VISIBILITY_SOURCE");
  assert.notDeepEqual(companyContext().requirements, talentContext().requirements);
});

test("does not make a missing company requirement optional", () => {
  const requirements = companyRequirements.slice(0, 3);
  assert.equal(
    buildTimesheetContractConfigRequirementContext(companyCase({ fixtureRequirements: requirements })).status,
    "INVALID"
  );
});

test("does not make a missing talent divergence optional", () => {
  const requirements = talentRequirements.filter((_, index) => index !== 2);
  assert.equal(
    buildTimesheetContractConfigRequirementContext(talentCase({ fixtureRequirements: requirements })).status,
    "INVALID"
  );
});

test("planner exact policy without source identity becomes compatible-state", () => {
  assert.equal(companyContext().policy, "compatible-state");
});

test("candidate-only identity does not become authoritative", () => {
  const context = buildTimesheetContractConfigRequirementContext(talentCase({
    fixtureIdentityAuthority: {
      authority: "CANDIDATE_ONLY",
      entityKind: "contract",
      entityId: "13",
      sourceRef: "runtime",
    },
  }));
  assert.equal(context.policy, "compatible-state");
  assert.equal(context.exactEntityId, undefined);
});

test("explicit Jira identity remains exact", () => {
  const context = buildTimesheetContractConfigRequirementContext(talentCase({
    fixtureIdentityAuthority: {
      authority: "EXPLICIT_SOURCE_IDENTITY",
      entityKind: "contract",
      entityId: "13",
      sourceRef: "jira.explicitFixtureIdentity",
    },
  }));
  assert.equal(context.policy, "exact");
  assert.equal(context.exactEntityId, "13");
});

test("one exact contract identity cannot authorize a two-contract company dataset", () => {
  const context = buildTimesheetContractConfigRequirementContext(companyCase({
    fixtureIdentityAuthority: {
      authority: "EXPLICIT_SOURCE_IDENTITY",
      entityKind: "contract",
      entityId: "11",
      sourceRef: "jira.explicitFixtureIdentity",
    },
  }));
  const candidates = adaptTimesheetContractConfigCandidates({
    data: readyCompanyData(),
    family: "COMPANY_WEEKLY_PAYMENT_SOURCE",
    ownerId: "7",
  });
  assert.equal(
    selectTimesheetContractConfigFixture(candidates, context).reasonCode,
    "IDENTITY_AUTHORITY_UNAVAILABLE"
  );
});

test("unrelated cases are not applicable", () => {
  assert.equal(
    buildTimesheetContractConfigRequirementContext({
      persona: "talent",
      goal: "View a contract",
      fixtureRequirements: ["An active contract"],
    }).status,
    "NOT_APPLICABLE"
  );
});

test("bounds timesheet enumeration", () => {
  const data = { items: Array.from({ length: 30 }, (_, index) =>
    timesheet({ id: index + 1, contractId: index + 101, rateType: index % 2 ? "unit" : "hourly" })) };
  const candidates = adaptTimesheetContractConfigCandidates({
    data,
    family: "COMPANY_WEEKLY_PAYMENT_SOURCE",
    ownerId: "7",
  });
  assert.ok(candidates.length <= timesheetContractConfigFixtureBounds.maxDatasetCandidates);
});

test("retains exact timesheet-contract-job identities", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyCompanyData(),
    family: "COMPANY_WEEKLY_PAYMENT_SOURCE",
    ownerId: "7",
  });
  assert.deepEqual(candidate?.identity.contractIds, ["11", "12"]);
});

test("state facts are source-backed", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(),
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    ownerId: "9",
  });
  assert.ok(candidate?.facts.every((fact) => fact.sourceRef === "/talents/{talentId}/timesheets"));
});

test("raw sensitive fields are not transported", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: [timesheet({ id: 3, contractId: 13, rateType: "hourly", talentId: 9, sensitive: "do-not-copy" })],
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    ownerId: "9",
  });
  assert.equal(JSON.stringify(candidate).includes("do-not-copy"), false);
  assert.equal(JSON.stringify(candidate).includes("sensitive@example.invalid"), false);
});

test("read exception resolves UNKNOWN", async () => {
  const result = await resolveTimesheetContractConfigFixture({
    context: talentContext(),
    ownerId: "9",
    getJson: async () => { throw new Error("read failed"); },
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reasonCode, "SOURCE_READ_FAILED");
});

test("undefined read response resolves UNKNOWN", async () => {
  const result = await resolveTimesheetContractConfigFixture({
    context: talentContext(),
    ownerId: "9",
    getJson: async () => undefined,
  });
  assert.equal(result.reasonCode, "SOURCE_READ_FAILED");
});

test("missing mandatory field produces STATE_UNKNOWN", () => {
  const record = timesheet({ id: 3, contractId: 13, rateType: "hourly", talentId: 9 });
  delete (record.contract.job as any).timesheetConfig;
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: [record],
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    ownerId: "9",
  });
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, talentContext()).status, "STATE_UNKNOWN");
});

test("all mandatory company facts match COMPATIBLE", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyCompanyData(), family: "COMPANY_WEEKLY_PAYMENT_SOURCE", ownerId: "7",
  });
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, companyContext()).status, "COMPATIBLE");
});

test("one explicit coefficient mismatch is INCOMPATIBLE", () => {
  const data = readyCompanyData();
  (data.items[0]!.contract.timesheetConfig as any).entryCategories.training.paymentCoefficient = 1;
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data, family: "COMPANY_WEEKLY_PAYMENT_SOURCE", ownerId: "7",
  });
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, companyContext()).status, "INCOMPATIBLE");
});

test("unobservable mandatory fact is STATE_UNKNOWN", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
  });
  const context: TimesheetContractConfigRequirementContext = {
    ...talentContext(),
    requirements: [...talentContext().requirements, {
      key: "contract.unobservedState", expected: true, mandatory: true, sourceRef: "fixtureRequirements[4]",
    }],
  };
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, context).status, "STATE_UNKNOWN");
});

test("zero candidates is UNAVAILABLE", () => {
  assert.equal(selectTimesheetContractConfigFixture([], talentContext()).status, "UNAVAILABLE");
});

test("one compatible candidate is READY", () => {
  const candidates = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
  });
  assert.equal(selectTimesheetContractConfigFixture(candidates, talentContext()).status, "READY");
});

test("multiple compatible candidates are ambiguous", () => {
  const candidates = adaptTimesheetContractConfigCandidates({
    data: [
      ...readyTalentData(),
      timesheet({ id: 4, contractId: 14, rateType: "hourly", talentId: 9 }),
    ],
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    ownerId: "9",
  });
  const result = selectTimesheetContractConfigFixture(candidates, talentContext());
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reasonCode, "AMBIGUOUS_COMPATIBLE_ENTITY");
});

test("first compatible record is never selected from an ambiguous set", () => {
  const candidates = adaptTimesheetContractConfigCandidates({
    data: [
      timesheet({ id: 4, contractId: 14, rateType: "hourly", talentId: 9 }),
      ...readyTalentData(),
    ],
    family: "TALENT_CATEGORY_VISIBILITY_SOURCE",
    ownerId: "9",
  });
  assert.equal(selectTimesheetContractConfigFixture(candidates, talentContext()).selected, undefined);
});

test("company ownership relation is preserved", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyCompanyData(), family: "COMPANY_WEEKLY_PAYMENT_SOURCE", ownerId: "7",
  });
  assert.equal(candidate?.identity.ownerId, "7");
  assert.equal(candidate?.identity.persona, "company_admin");
});

test("talent ownership relation is preserved", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
  });
  assert.equal(candidate?.identity.ownerId, "9");
  assert.equal(candidate?.identity.ownershipVerified, true);
});

test("unrelated owner is rejected", () => {
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "99",
  });
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, talentContext()).status, "INCOMPATIBLE");
});

test("wrong timesheet-contract relationship is rejected", () => {
  const data = [timesheet({ id: 3, contractId: 13, contractIdAlias: 999, rateType: "hourly", talentId: 9 })];
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data, family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
  });
  assert.equal(evaluateTimesheetContractConfigCandidate(candidate!, talentContext()).status, "INCOMPATIBLE");
});

test("inactive state is not invented when not required", () => {
  const record = timesheet({ id: 3, contractId: 13, rateType: "hourly", talentId: 9 });
  record.contract.status = "ended";
  const [candidate] = adaptTimesheetContractConfigCandidates({
    data: [record], family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
  });
  assert.equal(candidate?.facts.some((fact) => fact.key === "contract.active"), false);
});

test("resolver issues only one bounded company GET", async () => {
  const paths: string[] = [];
  await resolveTimesheetContractConfigFixture({
    context: companyContext(), ownerId: "7", now: new Date("2026-08-27T00:00:00Z"),
    getJson: async (path) => { paths.push(path); return readyCompanyData(); },
  });
  assert.equal(paths.length, 1);
  assert.match(paths[0]!, /^\/companies\/7\/timesheets\?limit=20&offset=0&dateFrom=/);
});

test("resolver issues only one bounded talent GET", async () => {
  const paths: string[] = [];
  await resolveTimesheetContractConfigFixture({
    context: talentContext(), ownerId: "9", now: new Date("2026-08-27T00:00:00Z"),
    getJson: async (path) => { paths.push(path); return readyTalentData(); },
  });
  assert.deepEqual(paths, ["/talents/9/timesheets?dateFrom=2026-06-04&dateTo=2026-08-27"]);
});

test("no provisioning flag is read by the adapter", () => {
  const source = fs.readFileSync(new URL("./timesheet-contract-config-fixture.ts", import.meta.url), "utf8");
  assert.equal(source.includes("QA_ALLOW_BROWSER_FIXTURE_PROVISIONING"), false);
});

test("production adapter contains no issue or case identity branch", () => {
  const source = fs.readFileSync(new URL("./timesheet-contract-config-fixture.ts", import.meta.url), "utf8");
  assert.equal(/AS-\d+|web-\d+/.test(source), false);
});

test("screenshot input cannot influence readiness", () => {
  const candidates = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
    screenshot: "fabricated-pass",
  } as any);
  assert.equal(selectTimesheetContractConfigFixture(candidates, talentContext()).status, "READY");
});

test("model proposal cannot influence readiness", () => {
  const candidates = adaptTimesheetContractConfigCandidates({
    data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
    modelChoice: "first",
  } as any);
  assert.equal(candidates[0]?.identity.source, "AUTHENTICATED_GET");
});

test("fixture READY carries no acceptance result", () => {
  const result = selectTimesheetContractConfigFixture(
    adaptTimesheetContractConfigCandidates({
      data: readyTalentData(), family: "TALENT_CATEGORY_VISIBILITY_SOURCE", ownerId: "9",
    }),
    talentContext()
  );
  assert.equal("passed" in result, false);
  assert.equal("evidence" in result, false);
  assert.equal("finalStatus" in result, false);
});

test("runtime READY feeds existing fixture gate without changing the case oracle", async () => {
  const testCase: any = { ...talentCase(), automatedChecks: ["Verify null is not visible."], manualChecks: ["Manual acceptance"] };
  const result = await prepareTimesheetContractConfigFixture({
    testCase,
    persona: "talent",
    runtimeContext: { talentId: "9" },
    dependencies: {
      readApiUrl: () => "https://example.invalid",
      getToken: async () => "redacted",
      getJson: async (_url, path) => path.includes("/timesheets?") ? readyTalentData() : undefined,
      now: () => new Date("2026-08-27T00:00:00Z"),
    },
  });
  assert.equal(result.status, "READY");
  assert.equal(testCase.runtimeFixtureResolutionFailure, undefined);
  assert.deepEqual(testCase.automatedChecks, ["Verify null is not visible."]);
  assert.deepEqual(testCase.manualChecks, ["Manual acceptance"]);
});

test("runtime UNAVAILABLE blocks safely", async () => {
  const testCase: any = talentCase();
  const result = await prepareTimesheetContractConfigFixture({
    testCase,
    persona: "talent",
    runtimeContext: { talentId: "9" },
    dependencies: {
      readApiUrl: () => "https://example.invalid",
      getToken: async () => "redacted",
      getJson: async () => [],
    },
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.match(testCase.runtimeFixtureResolutionFailure, /status=UNAVAILABLE/);
});

test("runtime UNKNOWN abstains safely", async () => {
  const testCase: any = talentCase();
  const result = await prepareTimesheetContractConfigFixture({
    testCase,
    persona: "talent",
    runtimeContext: { talentId: "9" },
    dependencies: {
      readApiUrl: () => "https://example.invalid",
      getToken: async () => "redacted",
      getJson: async () => { throw new Error("read"); },
    },
  });
  assert.equal(result.status, "UNKNOWN");
  assert.match(testCase.runtimeFixtureResolutionFailure, /status=UNKNOWN/);
});

test("runtime preparation never calls a mutating method", async () => {
  const calls: string[] = [];
  const testCase: any = companyCase();
  await prepareTimesheetContractConfigFixture({
    testCase,
    persona: "company_admin",
    runtimeContext: { companyId: "7" },
    dependencies: {
      readApiUrl: () => "https://example.invalid",
      getToken: async () => "redacted",
      getJson: async (_url, path) => { calls.push(path); return readyCompanyData(); },
    },
  });
  assert.ok(calls.every((path) => path.includes("/timesheets?")));
});

test("manual completeness and reconciliation fields remain absent", async () => {
  const testCase: any = { ...talentCase(), manualChecks: ["Compare rendered choices."] };
  await prepareTimesheetContractConfigFixture({
    testCase,
    persona: "talent",
    runtimeContext: { talentId: "9" },
    dependencies: {
      readApiUrl: () => "https://example.invalid",
      getToken: async () => "redacted",
      getJson: async () => readyTalentData(),
    },
  });
  assert.deepEqual(testCase.manualChecks, ["Compare rendered choices."]);
  assert.equal(testCase.deterministicEvidence, undefined);
  assert.equal(testCase.status, undefined);
});
