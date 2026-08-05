export type DesiredTalentContractFixture =
  | "populated-work-setups"
  | "empty-work-setups"
  | "active-or-started"
  | "any";

export type RuntimeTalentContractFixture = {
  contractId: string;
  talentId: string;
  desiredFixture:
    DesiredTalentContractFixture;
  matchedState: boolean;
  jobId?: string;
};

const desiredFixtures =
  new Set<
    DesiredTalentContractFixture
  >([
    "populated-work-setups",
    "empty-work-setups",
    "active-or-started",
    "any",
  ]);

function normalizeRequiredId(
  value: unknown
): string | undefined {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  return normalized ||
    undefined;
}

export function getRuntimeTalentContractFixture(
  testCase: any
): RuntimeTalentContractFixture |
  undefined {
  const raw =
    testCase
      ?.runtimeTalentContractFixture;

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return undefined;
  }

  const contractId =
    normalizeRequiredId(
      raw.contractId
    );

  const talentId =
    normalizeRequiredId(
      raw.talentId
    );

  const jobId =
    normalizeRequiredId(
      raw.jobId
    );

  const desiredFixture =
    String(
      raw.desiredFixture || ""
    ) as DesiredTalentContractFixture;

  if (
    !contractId ||
    !talentId ||
    !desiredFixtures.has(
      desiredFixture
    ) ||
    typeof raw.matchedState !==
      "boolean"
  ) {
    return undefined;
  }

  return {
    contractId,
    talentId,
    desiredFixture,
    matchedState:
      raw.matchedState,
    ...(
      jobId
        ? {
            jobId,
          }
        : {}
    ),
  };
}

export function setRuntimeTalentContractFixture(
  testCase: any,
  fixture:
    RuntimeTalentContractFixture |
    undefined
): void {
  delete testCase
    .runtimeTalentContractFixture;

  if (!fixture) {
    return;
  }

  testCase.runtimeTalentContractFixture = {
    contractId:
      fixture.contractId,
    talentId:
      fixture.talentId,
    desiredFixture:
      fixture.desiredFixture,
    matchedState:
      fixture.matchedState,
    ...(
      fixture.jobId
        ? {
            jobId:
              fixture.jobId,
          }
        : {}
    ),
  };
}

export function copyRuntimeTalentContractFixture(
  sourceCase: any,
  targetCase: any
): void {
  setRuntimeTalentContractFixture(
    targetCase,
    getRuntimeTalentContractFixture(
      sourceCase
    )
  );
}
