import fs from "node:fs";
import yaml from "yaml";
import {
  apiGet,
  extractItems,
  getFirebaseIdToken,
  pickFirstId,
} from "./browser-route-execution-context.js";
import {
  getCaseText,
} from "./browser-route-semantics.js";
import {
  setRuntimeTalentContractFixture,
  type DesiredTalentContractFixture,
  type RuntimeTalentContractFixture,
} from "./fixtures/talent-contract-fixture-context.js";
import type {
  BrowserPersona,
} from "./browser-route-semantics.js";

type TalentContractFixtureState = {
  desiredFixture:
    DesiredTalentContractFixture;
  matchedState: boolean;
  contractCount: number;
  workSetupCount: number;
  populatedContractCount: number;
  runtimeFixture?:
    RuntimeTalentContractFixture;
};

const talentContractRouteCache =
  new Map<string, Promise<string | undefined>>();

const talentContractFixtureStateCache =
  new Map<string, TalentContractFixtureState>();

function getRuntimeEntityId(
  value: any
): string | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    const normalized = String(value).trim();

    return normalized || undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const id =
    value.id ??
    value.contractId ??
    value.jobId ??
    value._id;

  if (
    id === undefined ||
    id === null ||
    String(id).trim() === ""
  ) {
    return undefined;
  }

  return String(id);
}

function collectSemanticRuntimeIds(
  value: any,
  semantic: "contract" | "job",
  depth = 0,
  ids = new Set<string>()
): Set<string> {
  if (
    value === null ||
    value === undefined ||
    depth > 7
  ) {
    return ids;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSemanticRuntimeIds(
        item,
        semantic,
        depth + 1,
        ids
      );
    }

    return ids;
  }

  if (typeof value !== "object") {
    return ids;
  }

  const semanticIdKey = `${semantic}id`;

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const normalizedKey = key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

    const isSemanticId =
      normalizedKey === semanticIdKey ||
      normalizedKey.endsWith(
        semanticIdKey
      );

    const isSemanticEntity =
      normalizedKey === semantic;

    if (
      isSemanticId ||
      isSemanticEntity
    ) {
      const id =
        getRuntimeEntityId(child);

      if (id) {
        ids.add(id);
      }
    }

    collectSemanticRuntimeIds(
      child,
      semantic,
      depth + 1,
      ids
    );
  }

  return ids;
}

function getContractId(
  contract: any
): string | undefined {
  return getRuntimeEntityId(contract);
}

function getContractJobId(
  contract: any
): string | undefined {
  return (
    getRuntimeEntityId(contract?.job) ??
    getRuntimeEntityId(
      contract?.jobId
    ) ??
    getRuntimeEntityId(
      contract?.offer
        ?.jobApplication
        ?.job
    )
  );
}

function getContractStatus(
  contract: any
): string {
  return String(
    contract?.status ??
      contract?.contractStatus ??
      contract?.state ??
      ""
  )
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
}

function contractIsActiveOrStarted(
  contract: any
): boolean {
  const status =
    getContractStatus(contract);

  return [
    "active",
    "started",
    "inprogress",
    "ongoing",
  ].includes(status);
}

function detectDesiredTalentContractFixture(
  testCase: any
): DesiredTalentContractFixture {
  const caseText =
    getCaseText(testCase)
      .replace(/\s+/g, " ");

  const emptySignals = [
    "no assigned work setups",
    "no work setups are assigned",
    "zero work setups",
    "without work setups",
    "without any work setups",
    "empty state",
  ];

  if (
    emptySignals.some(
      (signal) =>
        caseText.includes(signal)
    )
  ) {
    return "empty-work-setups";
  }

  const populatedSignals = [
    "with assigned work setups",
    "assigned work setups",
    "existing work setup cards",
    "work setup cards",
    "compact work setup cards",
    "document-required indication",
    "complete the following work setups",
  ];

  if (
    populatedSignals.some(
      (signal) =>
        caseText.includes(signal)
    )
  ) {
    return "populated-work-setups";
  }

  if (
    caseText.includes("active contract") ||
    caseText.includes("started contract") ||
    caseText.includes(
      "active or started contract"
    )
  ) {
    return "active-or-started";
  }

  return "any";
}

function selectTalentContractFixture(
  contractsData: any,
  workSetupsData: any,
  desiredFixture:
    DesiredTalentContractFixture
): {
  selected?: any;
  matchedState: boolean;
  contractCount: number;
  workSetupCount: number;
  populatedContractCount: number;
} {
  const contracts =
    extractItems(contractsData)
      .filter(
        (contract) =>
          Boolean(getContractId(contract))
      );

  const workSetups =
    extractItems(workSetupsData);

  const workSetupContractIds =
    collectSemanticRuntimeIds(
      workSetups,
      "contract"
    );

  const workSetupJobIds =
    collectSemanticRuntimeIds(
      workSetups,
      "job"
    );

  const populatedContracts =
    contracts.filter((contract) => {
      const contractId =
        getContractId(contract);

      const jobId =
        getContractJobId(contract);

      return (
        Boolean(
          contractId &&
            workSetupContractIds.has(
              contractId
            )
        ) ||
        Boolean(
          jobId &&
            workSetupJobIds.has(jobId)
        )
      );
    });

  const populatedIds =
    new Set(
      populatedContracts
        .map(getContractId)
        .filter(
          (id): id is string =>
            Boolean(id)
        )
    );

  const emptyContracts =
    contracts.filter((contract) => {
      const contractId =
        getContractId(contract);

      return (
        Boolean(contractId) &&
        !populatedIds.has(contractId!)
      );
    });

  const activeContracts =
    contracts.filter(
      contractIsActiveOrStarted
    );

  let matchingContracts: any[];

  if (
    desiredFixture ===
    "populated-work-setups"
  ) {
    matchingContracts =
      populatedContracts;
  } else if (
    desiredFixture ===
    "empty-work-setups"
  ) {
    matchingContracts =
      emptyContracts;
  } else if (
    desiredFixture ===
    "active-or-started"
  ) {
    matchingContracts =
      activeContracts;
  } else {
    matchingContracts =
      contracts;
  }

  const selected =
    matchingContracts.find(
      contractIsActiveOrStarted
    ) ??
    matchingContracts[0] ??
    activeContracts[0] ??
    contracts[0];

  const matchedState =
    desiredFixture === "any"
      ? Boolean(selected)
      : matchingContracts.length > 0;

  return {
    selected,
    matchedState,
    contractCount:
      contracts.length,
    workSetupCount:
      workSetups.length,
    populatedContractCount:
      populatedContracts.length,
  };
}

function applyTalentContractFixtureState(
  testCase: any,
  state:
    TalentContractFixtureState |
    undefined
): void {
  delete testCase
    .runtimeFixtureResolutionFailure;

  setRuntimeTalentContractFixture(
    testCase,
    state?.runtimeFixture
  );

  if (
    !state ||
    state.desiredFixture === "any" ||
    state.matchedState
  ) {
    return;
  }

  testCase.runtimeFixtureResolutionFailure =
    `Browser fixture gate blocked ` +
    `${testCase?.id || "case"}: ` +
    `runtime fixture resolver found no ` +
    `contract matching requested state ` +
    `"${state.desiredFixture}" ` +
    `(contracts=${state.contractCount}, ` +
    `workSetups=${state.workSetupCount}, ` +
    `populatedContracts=` +
    `${state.populatedContractCount}).`;
}

export async function resolveTalentContractDetailRoute(
  testCase: any,
  persona: BrowserPersona
): Promise<string | undefined> {
  if (persona !== "talent") {
    return undefined;
  }

  const desiredFixture =
    detectDesiredTalentContractFixture(
      testCase
    );

  const cacheKey =
    `${persona}:${desiredFixture}`;

  const cached =
    talentContractRouteCache.get(
      cacheKey
    );

  if (cached) {
    const cachedRoute =
      await cached;

    applyTalentContractFixtureState(
      testCase,
      talentContractFixtureStateCache.get(
        cacheKey
      )
    );

    return cachedRoute;
  }

  const resolution = (async () => {
    const config = yaml.parse(
      fs.readFileSync(
        "config/environments.yaml",
        "utf8"
      )
    );

    const apiUrl = String(
      process.env.QA_API_URL ??
        config?.environments
          ?.staging?.api_url ??
        ""
    );

    if (!apiUrl) {
      console.log(
        " Browser fixture resolver could not resolve API URL for talent contracts."
      );

      return undefined;
    }

    const idToken =
      await getFirebaseIdToken(
        persona
      );

    const talentData =
      await apiGet(
        apiUrl,
        "/talents/me",
        idToken
      );

    const talentId =
      pickFirstId(talentData);

    if (!talentId) {
      console.log(
        " Browser fixture resolver could not resolve own talentId."
      );

      return undefined;
    }

    const contractsData =
      await apiGet(
        apiUrl,
        `/talents/${
          encodeURIComponent(talentId)
        }/contracts`,
        idToken
      );

    const workSetupsData =
      await apiGet(
        apiUrl,
        `/talents/${
          encodeURIComponent(talentId)
        }/work-setups`,
        idToken
      );

    const selection =
      selectTalentContractFixture(
        contractsData,
        workSetupsData,
        desiredFixture
      );

    const contractId =
      getContractId(
        selection.selected
      );

    const contractJobId =
      getContractJobId(
        selection.selected
      );

    const runtimeFixture:
      RuntimeTalentContractFixture |
      undefined =
      contractId
        ? {
            contractId,
            talentId,
            desiredFixture,
            matchedState:
              selection.matchedState,
            ...(
              contractJobId
                ? {
                    jobId:
                      contractJobId,
                  }
                : {}
            ),
          }
        : undefined;

    const fixtureState:
      TalentContractFixtureState = {
        desiredFixture,
        matchedState:
          selection.matchedState,
        contractCount:
          selection.contractCount,
        workSetupCount:
          selection.workSetupCount,
        populatedContractCount:
          selection
            .populatedContractCount,
        ...(
          runtimeFixture
            ? {
                runtimeFixture,
              }
            : {}
        ),
      };

    talentContractFixtureStateCache.set(
      cacheKey,
      fixtureState
    );

    applyTalentContractFixtureState(
      testCase,
      fixtureState
    );

    if (!contractId) {
      console.log(
        ` Browser fixture resolver found ` +
          `no accessible contract for ` +
          `talentId=${talentId}.`
      );

      return undefined;
    }

    console.log(
      ` Browser fixture resolver selected ` +
        `contractId=${contractId}; ` +
        `talentId=${talentId}; ` +
        `desired=${desiredFixture}; ` +
        `matchedState=${
          selection.matchedState
        }; contracts=${
          selection.contractCount
        }; workSetups=${
          selection.workSetupCount
        }; populatedContracts=${
          selection
            .populatedContractCount
        }.`
    );

    if (
      !selection.matchedState &&
      desiredFixture !== "any"
    ) {
      console.log(
        ` Browser fixture resolver could not ` +
          `find the exact requested contract ` +
          `state "${desiredFixture}". ` +
          `The active accessible contract route ` +
          `is retained for route verification, ` +
          `but case execution will be blocked ` +
          `deterministically as TEST_DATA_ISSUE.`
      );
    }

    return (
      `/talent/contracts/` +
      encodeURIComponent(
        contractId
      )
    );
  })().catch(
    (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.log(
        ` Browser fixture resolver contract ` +
          `discovery failed: ${message}`
      );

      return undefined;
    }
  );

  talentContractRouteCache.set(
    cacheKey,
    resolution
  );

  return resolution;
}
