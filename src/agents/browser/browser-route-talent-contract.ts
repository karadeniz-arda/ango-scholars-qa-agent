import fs from "node:fs";
import yaml from "yaml";
import {
  apiGet,
  extractItems,
  getFirebaseIdToken,
} from "./browser-route-execution-context.js";
import {
  resolveDeepRouteBinding,
  type DeepRouteBindingResult,
  type DeepRouteEntityRequirement,
  type RuntimeEntityIdentity,
} from "./browser-deep-route-binding.js";
import {
  findAuthoritativeUiRouteTemplates,
} from "../../discovery/ui-route-catalog.js";
import {
  setRuntimeDeepRouteBinding,
} from "./browser-deep-route-binding-context.js";
import {
  getCaseText,
} from "./browser-route-semantics.js";
import {
  setRuntimeTalentContractFixture,
  type DesiredTalentContractFixture,
  type RuntimeTalentContractFixture,
} from "./fixtures/talent-contract-fixture-context.js";
import {
  buildContractFixtureRequirementContext,
  discoverVerifiedContractFixtureCandidates,
  selectVerifiedContractFixtureCandidate,
  type VerifiedContractFixtureSelection,
} from "./fixtures/verified-contract-fixture-state.js";
import type {
  BrowserPersona,
} from "./browser-route-semantics.js";
import {
  controlledQaFixtureForCase,
  controlledQaFixtureMatchesCandidate,
} from "./controlled-qa-fixture-manifest.js";
import {
  buildTalentContractHumanResolutionRequest,
  readHumanResolutionSubmission,
} from "./human-execution-context.js";

type TalentContractFixtureState = {
  desiredFixture:
    DesiredTalentContractFixture;
  matchedState: boolean;
  contractCount: number;
  workSetupCount: number;
  populatedContractCount: number;
  runtimeFixture?:
    RuntimeTalentContractFixture;
  deepRouteBinding:
    DeepRouteBindingResult;
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

export function selectTalentContractFixture(
  contractsData: any,
  workSetupsData: any,
  desiredFixture:
    DesiredTalentContractFixture,
  talentId: string,
  testCase: any,
  verifiedSelection?:
    VerifiedContractFixtureSelection
): {
  selected?: any;
  matchedState: boolean;
  contractCount: number;
  workSetupCount: number;
  populatedContractCount: number;
  deepRouteBinding:
    DeepRouteBindingResult;
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

  if (
    verifiedSelection &&
    verifiedSelection.status !==
      "SELECTED"
  ) {
    return {
      selected: undefined,
      matchedState: false,
      contractCount: contracts.length,
      workSetupCount: workSetups.length,
      populatedContractCount:
        populatedContracts.length,
      deepRouteBinding: {
        status:
          verifiedSelection.status ===
          "ENTITY_STATE_UNVERIFIED"
            ? "ENTITY_STATE_UNVERIFIED"
            : verifiedSelection.status,
        reason:
          verifiedSelection.reason,
      },
    };
  }

  if (
    !verifiedSelection &&
    testCase?.runtimeFixturePolicy ===
      "exact"
  ) {
    return {
      selected: undefined,
      matchedState: false,
      contractCount: contracts.length,
      workSetupCount: workSetups.length,
      populatedContractCount:
        populatedContracts.length,
      deepRouteBinding: {
        status: "NO_COMPATIBLE_ENTITY",
        reason:
          "Exact fixture policy supplied no authoritative exact contract identity; substitution is forbidden.",
      },
    };
  }

  const eligibleContracts =
    verifiedSelection?.selected
      ? contracts.filter(
          (contract) =>
            getContractId(contract) ===
            verifiedSelection.selected
              ?.identity.entityId
        )
      : contracts;

  const bindingSlots = [
    {
      param: "contractId",
      entityKind: "contract",
    },
  ];
  const templates =
    findAuthoritativeUiRouteTemplates({
      persona: "talent",
      area: "contracts",
      requiredBindings:
        bindingSlots,
    });
  const requiredState:
    DeepRouteEntityRequirement["requiredState"] =
    verifiedSelection?.selected
      ? undefined
      : desiredFixture ===
          "populated-work-setups"
        ? { hasWorkSetups: true }
        : desiredFixture ===
            "empty-work-setups"
          ? { hasWorkSetups: false }
          : desiredFixture ===
              "active-or-started"
            ? {
                activeOrStarted: true,
              }
            : undefined;
  const requirements:
    DeepRouteEntityRequirement[] = [
      {
        param: "contractId",
        entityKind: "contract",
        persona: "talent",
        ownerId: talentId,
        requiresOwnershipVerification:
          true,
        ...(requiredState
          ? { requiredState }
          : {}),
      },
    ];
  const candidates:
    RuntimeEntityIdentity[] =
    eligibleContracts.flatMap((contract) => {
      const contractId =
        getContractId(contract);

      if (!contractId) return [];

      const jobTitle = String(
        contract?.job?.title ?? ""
      ).trim();

      return [
        {
          entityKind: "contract",
          entityId: contractId,
          source:
            "AUTHENTICATED_GET" as const,
          persona: "talent" as const,
          identityVerified: true,
          ownershipVerified: true,
          ownerId: talentId,
          verifiedState: {
            hasWorkSetups:
              populatedIds.has(
                contractId
              ),
            activeOrStarted:
              contractIsActiveOrStarted(
                contract
              ),
          },
          verifiedStateKeys: [
            "hasWorkSetups",
            "activeOrStarted",
          ],
          ...(jobTitle
            ? {
                targetIdentity: {
                  kind:
                    "EXACT_TEXT" as const,
                  value: jobTitle,
                },
              }
            : {}),
        },
      ];
    });
  const deepRouteBinding =
    templates.length === 1
      ? resolveDeepRouteBinding({
          template: templates[0]!,
          persona: "talent",
          requirements,
          candidates,
        })
      : {
          status:
            "NO_AUTHORITATIVE_TEMPLATE" as const,
          reason:
            templates.length === 0
              ? "No authoritative talent contract route template was available."
              : "Multiple authoritative talent contract route templates matched the same binding slots.",
        };
  const selectedId =
    deepRouteBinding.boundRoute
      ?.bindings.contractId;
  const selected = selectedId
    ? contracts.find(
        (contract) =>
          getContractId(contract) ===
          selectedId
      )
    : undefined;

  return {
    selected,
    matchedState:
      deepRouteBinding.status ===
      "RESOLVED",
    contractCount:
      contracts.length,
    workSetupCount:
      workSetups.length,
    populatedContractCount:
      populatedContracts.length,
    deepRouteBinding,
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
  setRuntimeDeepRouteBinding(
    testCase,
    state
      ? {
          status:
            state.deepRouteBinding
              .status,
          reason:
            state.deepRouteBinding
              .reason,
          ...(state.deepRouteBinding
            .boundRoute
            ? {
                boundRoute:
                  state.deepRouteBinding
                    .boundRoute,
              }
            : {}),
        }
      : undefined
  );

  if (
    !state ||
    state.deepRouteBinding.status ===
      "RESOLVED"
  ) {
    return;
  }

  testCase.runtimeFixtureResolutionFailure =
    `Browser fixture gate blocked ` +
    `${testCase?.id || "case"}: ` +
    `deep-route binding stopped at ` +
    `${state.deepRouteBinding.status}; ` +
    `${state.deepRouteBinding.reason} ` +
    `Requested fixture=` +
    `"${state.desiredFixture}" ` +
    `(contracts=${state.contractCount}, ` +
    `workSetups=${state.workSetupCount}, ` +
    `populatedContracts=` +
    `${state.populatedContractCount}).`;
}

/** One existing authenticated read-only discovery path, shared by route and composition. */
export async function discoverAuthenticatedTalentContractCandidates() {
  const config = yaml.parse(fs.readFileSync("config/environments.yaml", "utf8"));
  const apiUrl = String(process.env.QA_API_URL ?? config?.environments?.staging?.api_url ?? "");
  if (!apiUrl) return undefined;
  const idToken = await getFirebaseIdToken("talent");
  const talentData = await apiGet(apiUrl, "/talents/me", idToken);
  const talentId = getRuntimeEntityId(talentData) ?? getRuntimeEntityId(talentData?.data);
  if (!talentId) return undefined;
  const contractsData = await apiGet(apiUrl, `/talents/${encodeURIComponent(talentId)}/contracts`, idToken);
  if (contractsData === undefined) return undefined;
  const workSetupsData = await apiGet(apiUrl, `/talents/${encodeURIComponent(talentId)}/work-setups`, idToken);
  const workSetups = extractItems(workSetupsData);
  const verifiedCandidates = await discoverVerifiedContractFixtureCandidates({
    contractsData, talentId,
    ...(workSetupsData !== undefined ? {
      workSetupContractIds: collectSemanticRuntimeIds(workSetups, "contract"),
      workSetupJobIds: collectSemanticRuntimeIds(workSetups, "job"),
    } : {}),
    getJson: path => apiGet(apiUrl, path, idToken),
  });
  return { talentId, contractsData, workSetupsData, verifiedCandidates };
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
    `${persona}:${desiredFixture}:` +
    `${
      testCase?.runtimeFixturePolicy ===
      "exact"
        ? "exact"
        : "compatible"
    }:` +
    `${process.env.QA_HUMAN_RESOLUTION_CONTEXT ?? ""}:` +
    JSON.stringify(
      testCase?.fixtureRequirements ?? []
    );

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
    const discovery = await discoverAuthenticatedTalentContractCandidates();
    if (!discovery) return undefined;
    const { talentId, contractsData, workSetupsData, verifiedCandidates } = discovery;
    const controlledFixture = controlledQaFixtureForCase({
      caseId: String(testCase?.id ?? ""),
      ...(process.env.QA_CONTROLLED_FIXTURE_MANIFEST
        ? { manifestPath: process.env.QA_CONTROLLED_FIXTURE_MANIFEST }
        : {}),
    });
    const requirementContext =
      buildContractFixtureRequirementContext(
        testCase
      );
    const humanRequest =
      testCase?.runtimeFixturePolicy === "exact" &&
      requirementContext.requirements.length > 0
        ? buildTalentContractHumanResolutionRequest({
            caseId: String(testCase?.id ?? ""),
            fixtureDescription: String(testCase.fixtureRequirements?.join("; ") ?? "exact fixture state"),
          })
        : undefined;
    const humanContext = humanRequest
      ? readHumanResolutionSubmission({
          request: humanRequest,
          ...(process.env.QA_HUMAN_RESOLUTION_CONTEXT ? { path: process.env.QA_HUMAN_RESOLUTION_CONTEXT } : {}),
        })
      : undefined;
    const humanSelection = humanContext && humanContext.persona === persona
      ? selectVerifiedContractFixtureCandidate(
          verifiedCandidates,
          { ...requirementContext, policy: "exact", exactEntityId: humanContext.entityId },
          talentId
        )
      : undefined;
    const controlledCandidate = controlledFixture &&
      controlledFixture.persona === persona &&
      (!controlledFixture.relationships?.talentId || controlledFixture.relationships.talentId === talentId)
      ? verifiedCandidates.find((candidate) => {
          if (!candidate.identity.entityId || !candidate.identity.ownerId) return false;
          const facts = new Map(candidate.facts.map((fact) => [fact.key, fact.value]));
          return controlledQaFixtureMatchesCandidate({
            fixture: controlledFixture,
            candidate: {
              entityId: candidate.identity.entityId,
              ownerId: candidate.identity.ownerId,
              ownershipVerified: candidate.identity.ownershipVerified === true,
              hasWorkSetups: facts.get("contract.hasWorkSetups") === true,
              status: String(facts.get("contract.status") ?? ""),
            },
            talentId,
          });
        })
      : undefined;
    const verifiedSelection = controlledFixture
      ? controlledCandidate
        ? { status: "SELECTED" as const, reason: "Controlled QA fixture validated by exact ID and read-only facts.", selected: controlledCandidate, selectionBasis: "UNIQUE_COMPATIBLE_CANDIDATE" as const, evaluations: [] }
        : { status: "NO_COMPATIBLE_ENTITY" as const, reason: "Controlled QA fixture failed exact read-only entity/precondition validation.", evaluations: [] }
      : process.env.QA_HUMAN_RESOLUTION_CONTEXT && humanRequest
        ? humanSelection ?? { status: "NO_COMPATIBLE_ENTITY" as const, reason: "Human execution-context submission was missing, malformed, stale, or incompatible with this exact resolution request.", evaluations: [] }
        : selectVerifiedContractFixtureCandidate(verifiedCandidates, requirementContext, talentId);

    const selection =
      selectTalentContractFixture(
        contractsData,
        workSetupsData,
        desiredFixture,
        talentId,
        testCase,
        verifiedSelection
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
            ...(humanSelection?.status === "SELECTED" ? { executionContextProvenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT" as const } : {}),
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
        deepRouteBinding:
          selection.deepRouteBinding,
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

    if (
      !contractId ||
      !selection.deepRouteBinding
        .boundRoute
    ) {
      console.log(
        ` Browser fixture resolver found ` +
          `no safely bound contract route; ` +
          `status=${
            selection.deepRouteBinding
              .status
          }.`
      );

      return undefined;
    }

    console.log(
      ` Browser fixture resolver safely bound ` +
        `one talent-owned contract; ` +
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

    return selection.deepRouteBinding
      .boundRoute.route;
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
