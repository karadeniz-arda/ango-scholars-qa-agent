import fs from "node:fs";
import yaml from "yaml";
import type {
  RuntimeResourceContext,
} from "../../../runtime/runtime-context.js";
import {
  apiGet,
  getFirebaseIdToken,
} from "../browser-route-execution-context.js";
import {
  buildTimesheetContractConfigRequirementContext,
  resolveTimesheetContractConfigFixture,
  type TimesheetContractConfigReadiness,
} from "./timesheet-contract-config-fixture.js";

export type RuntimeTimesheetContractConfigFixture = {
  family: "COMPANY_WEEKLY_PAYMENT_SOURCE" | "TALENT_CATEGORY_VISIBILITY_SOURCE";
  status: "READY" | "UNAVAILABLE" | "UNKNOWN";
  reasonCode: TimesheetContractConfigReadiness["reasonCode"];
  candidateCount: number;
  selectedIdentity?: {
    entityKind: "timesheet-week-dataset" | "contract";
    entityId: string;
    contractIds: string[];
  };
  facts: Array<{
    key: string;
    value: string | number | boolean;
    sourceRef?: string;
  }>;
};

type RuntimeDependencies = {
  getToken: (persona: "company_admin" | "talent") => Promise<string>;
  getJson: (apiUrl: string, path: string, token: string) => Promise<unknown>;
  readApiUrl: () => string | undefined;
  now: () => Date;
};

const FAILURE_PREFIX = "Timesheet/contract-config fixture gate blocked";

function defaultApiUrl(): string | undefined {
  const config = yaml.parse(
    fs.readFileSync("config/environments.yaml", "utf8")
  );
  const value = String(
    process.env.QA_API_URL ?? config?.environments?.staging?.api_url ?? ""
  ).replace(/\/$/, "");
  return value || undefined;
}

const defaultDependencies: RuntimeDependencies = {
  getToken: getFirebaseIdToken,
  getJson: apiGet,
  readApiUrl: defaultApiUrl,
  now: () => new Date(),
};

function runtimeFixture(
  family: NonNullable<ReturnType<typeof buildTimesheetContractConfigRequirementContext>["family"]>,
  readiness: TimesheetContractConfigReadiness
): RuntimeTimesheetContractConfigFixture {
  return {
    family,
    status: readiness.status,
    reasonCode: readiness.reasonCode,
    candidateCount: readiness.candidateCount,
    ...(readiness.selected
      ? {
          selectedIdentity: {
            entityKind: readiness.selected.identity.entityKind,
            entityId: readiness.selected.identity.entityId,
            contractIds: [...readiness.selected.identity.contractIds],
          },
        }
      : {}),
    facts: readiness.selected?.facts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      ...(fact.sourceRef ? { sourceRef: fact.sourceRef } : {}),
    })) ?? [],
  };
}

function setResolutionFailure(testCase: any, readiness: TimesheetContractConfigReadiness): void {
  if (readiness.status === "READY") {
    if (String(testCase.runtimeFixtureResolutionFailure ?? "").startsWith(FAILURE_PREFIX)) {
      delete testCase.runtimeFixtureResolutionFailure;
    }
    return;
  }
  testCase.runtimeFixtureResolutionFailure =
    `${FAILURE_PREFIX} ${testCase?.id || "case"}: ` +
    `status=${readiness.status}; reason=${readiness.reasonCode}; ` +
    `candidates=${readiness.candidateCount}.`;
}

export async function prepareTimesheetContractConfigFixture(input: {
  testCase: any;
  persona: "company_admin" | "talent";
  runtimeContext?: RuntimeResourceContext;
  dependencies?: Partial<RuntimeDependencies>;
}): Promise<
  | { status: "NOT_APPLICABLE"; reason: string }
  | TimesheetContractConfigReadiness
> {
  const context = buildTimesheetContractConfigRequirementContext(input.testCase);
  if (context.status === "NOT_APPLICABLE" || !context.family) {
    return { status: "NOT_APPLICABLE", reason: context.reason };
  }

  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const apiUrl = dependencies.readApiUrl();
  if (!apiUrl) {
    const readiness: TimesheetContractConfigReadiness = {
      status: "UNKNOWN",
      reasonCode: "SOURCE_READ_FAILED",
      reason: "The staging API URL is unavailable.",
      candidateCount: 0,
      evaluations: [],
    };
    input.testCase.runtimeTimesheetContractConfigFixture = runtimeFixture(context.family, readiness);
    setResolutionFailure(input.testCase, readiness);
    return readiness;
  }

  if (context.status === "INVALID") {
    const readiness = await resolveTimesheetContractConfigFixture({
      context,
      ownerId: "unresolved",
      getJson: async () => undefined,
      now: dependencies.now(),
    });
    input.testCase.runtimeTimesheetContractConfigFixture = runtimeFixture(context.family, readiness);
    setResolutionFailure(input.testCase, readiness);
    return readiness;
  }

  try {
    const token = await dependencies.getToken(input.persona);
    let ownerId = input.persona === "company_admin"
      ? input.runtimeContext?.companyId ?? process.env.QA_COMPANY_ID
      : input.runtimeContext?.talentId;

    if (!ownerId && input.persona === "talent") {
      const me = await dependencies.getJson(apiUrl, "/talents/me", token);
      const record = me && typeof me === "object" ? me as Record<string, any> : undefined;
      const rawId = record?.id ?? record?.data?.id;
      if (typeof rawId === "string" || typeof rawId === "number") {
        ownerId = String(rawId).trim() || undefined;
      }
    }

    if (!ownerId) {
      const readiness: TimesheetContractConfigReadiness = {
        status: "UNKNOWN",
        reasonCode: "IDENTITY_AUTHORITY_UNAVAILABLE",
        reason: "The authenticated fixture owner identity is unavailable.",
        candidateCount: 0,
        evaluations: [],
      };
      input.testCase.runtimeTimesheetContractConfigFixture = runtimeFixture(context.family, readiness);
      setResolutionFailure(input.testCase, readiness);
      return readiness;
    }

    const readiness = await resolveTimesheetContractConfigFixture({
      context,
      ownerId,
      getJson: (path) => dependencies.getJson(apiUrl, path, token),
      now: dependencies.now(),
    });
    input.testCase.runtimeTimesheetContractConfigFixture = runtimeFixture(context.family, readiness);
    setResolutionFailure(input.testCase, readiness);
    return readiness;
  } catch {
    const readiness: TimesheetContractConfigReadiness = {
      status: "UNKNOWN",
      reasonCode: "SOURCE_READ_FAILED",
      reason: "Authenticated fixture discovery failed.",
      candidateCount: 0,
      evaluations: [],
    };
    input.testCase.runtimeTimesheetContractConfigFixture = runtimeFixture(context.family, readiness);
    setResolutionFailure(input.testCase, readiness);
    return readiness;
  }
}
