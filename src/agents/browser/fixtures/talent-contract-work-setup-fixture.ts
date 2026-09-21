import fs from "node:fs";
import yaml from "yaml";
import type {
  Page,
} from "playwright";
import type {
  BrowserPersona,
} from "../browser-session-manager.js";
import {
  runGenericMutationCore,
} from "../mutation/generic-mutation-core.js";
import type {
  GenericMutationCandidate,
  GenericMutationCleanup,
  GenericMutationJson,
} from "../mutation/generic-mutation-types.js";
import type {
  DeferredCleanup,
} from "../browser-deferred-cleanup.js";
import {
  apiGet,
  extractItems,
  getCachedBrowserExecutionContext,
  getFirebaseIdToken,
} from "../browser-route-execution-context.js";
import type {
  BrowserFixtureProvider,
  BrowserFixtureProviderContext,
  BrowserFixtureProviderResult,
} from "./browser-fixture-types.js";
import {
  getRuntimeTalentContractFixture,
} from "./talent-contract-fixture-context.js";
import {
  normalizeGenericFixtureCandidate,
  runGenericFixtureCandidateSelection,
} from "./generic-fixture-candidate-selector.js";
import type {
  GenericFixtureCandidateEvaluation,
  GenericFixtureCandidateEvaluationStatus,
  GenericFixtureCandidateInput,
  GenericFixtureCandidateProposal,
  GenericFixtureCandidateRequestProposal,
  GenericFixtureCandidateSelectionMode,
  GenericFixtureCandidateSelectionResult,
  GenericFixtureRequirementContext,
  RunGenericFixtureCandidateSelectionArgs,
} from "./generic-fixture-candidate-selector.js";

type WorkSetupMutationMethod =
  | "POST"
  | "DELETE";

export type WorkSetupMutationResult = {
  status: number;
  responseBody: unknown;
  responseText: string;
};

export type WorkSetupUiReadinessObservation = {
  sectionVisible: boolean;
  emptyStateVisible: boolean;
  expectedCardVisible: boolean;
  loadingVisible: boolean;
};

export function isWorkSetupUiReady(
  observation:
    WorkSetupUiReadinessObservation
): boolean {
  return (
    observation.sectionVisible &&
    !observation.emptyStateVisible &&
    observation.expectedCardVisible &&
    !observation.loadingVisible
  );
}

export type TalentContractWorkSetupFixtureDependencies = {
  getApiUrl: () => string;

  getToken: (
    persona: BrowserPersona
  ) => Promise<string>;

  getExecutionContext?: (
    persona: BrowserPersona,
    providedContext: any
  ) => Promise<any>;

  selectCandidate:
    typeof runGenericFixtureCandidateSelection;

  requestCandidateProposal?:
    GenericFixtureCandidateRequestProposal;

  getJson: (
    apiUrl: string,
    path: string,
    token: string
  ) => Promise<unknown>;

  mutate: (
    apiUrl: string,
    path: string,
    method: WorkSetupMutationMethod,
    token: string
  ) => Promise<WorkSetupMutationResult>;

  refreshSurface: (
    page: Page
  ) => Promise<void>;

  verifyPopulatedSurface: (
    page: Page,
    expectedCardText?: string
  ) => Promise<boolean>;

  wait: (
    timeoutMs: number
  ) => Promise<void>;
};

export type WorkSetupRuntimeCandidateAdapterResult =
  | {
      status: "READY";
      candidates:
        GenericFixtureCandidateInput[];
      companyCount: number;
      visibleCount: number;
    }
  | {
      status: "BLOCKED";
      reason: string;
      companyCount: number;
      visibleCount: number;
    };

export type WorkSetupFixtureCandidateDecision =
  | {
      status: "REUSE_EXISTING";
      workSetupId: string;
      workSetupTitle?: string;
      candidateCount: number;
      visibleRecordCount: number;
      proposal:
        GenericFixtureCandidateProposal;
      evaluation:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "ATTACH_NEW";
      workSetupId: string;
      workSetupTitle?: string;
      candidateCount: number;
      visibleRecordCount: number;
      proposal:
        GenericFixtureCandidateProposal;
      evaluation:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "BLOCKED";
      reason: string;
      candidateCount?: number;
      companyRecordCount?: number;
      visibleRecordCount?: number;
      evaluationStatus?:
        GenericFixtureCandidateEvaluationStatus;
      proposal?:
        GenericFixtureCandidateProposal;
      evaluation?:
        GenericFixtureCandidateEvaluation;
    }
  | {
      status: "ERROR";
      reason: string;
    };

export type ResolveWorkSetupFixtureCandidateDecisionArgs = {
  testCase: any;
  companyData: unknown;
  visibleTalentData: unknown;
  selectCandidate:
    typeof runGenericFixtureCandidateSelection;
  requestCandidateProposal?:
    GenericFixtureCandidateRequestProposal;
};

function normalizeWorkSetupFixtureRequirementText(
  value: unknown,
  maxLength: number
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeWorkSetupFixtureRequirementArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen =
    new Set<string>();

  for (const item of value) {
    const normalized =
      normalizeWorkSetupFixtureRequirementText(
        item,
        2000
      );

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);

    if (result.length >= 40) {
      break;
    }
  }

  return result;
}

function getPositiveWorkSetupAutomatedChecks(
  testCase: any
): string[] {
  const steps =
    Array.isArray(testCase?.steps)
      ? testCase.steps
      : [];

const positiveStepChecks: string[] =
  steps
    .filter(
      (step: any) =>
        step?.action ===
          "assertTextVisible"
    )
    .map((step: any) =>
      normalizeWorkSetupFixtureRequirementText(
        step?.text,
        2000
      )
    )
    .filter(
      (check: string) =>
        check.length > 0
    );

  if (positiveStepChecks.length > 0) {
    return [
      ...new Set(
        positiveStepChecks
      ),
    ];
  }

  return normalizeWorkSetupFixtureRequirementArray(
    testCase?.automatedChecks
  ).filter(
    (check) =>
      !/\b(?:not visible|not displayed|does not display|must not display|is absent)\b/i.test(
        check
      )
  );
}

export function buildWorkSetupFixtureRequirementContext(
  testCase: any
): GenericFixtureRequirementContext {
  return {
    goal:
      normalizeWorkSetupFixtureRequirementText(
        testCase?.goal,
        2000
      ),

    successCriteria:
      normalizeWorkSetupFixtureRequirementText(
        testCase?.successCriteria,
        4000
      ),

    /*
     * Removed or previous copy in assertTextNotVisible must
     * not become a positive candidate subtype constraint.
     */
    automatedChecks:
      getPositiveWorkSetupAutomatedChecks(
        testCase
      ),

    fixtureRequirements:
      normalizeWorkSetupFixtureRequirementArray(
        testCase?.fixtureRequirements
      ),
  };
}

function getWorkSetupSelectionConstraintText(
  requirements:
    GenericFixtureRequirementContext
): string {
  return [
    ...requirements.automatedChecks,
    ...requirements.fixtureRequirements,
  ]
    .join(" ")
    .toLowerCase();
}

function workSetupRequirementsAllowReusePreference(
  requirements:
    GenericFixtureRequirementContext
): boolean {
  const combined =
    getWorkSetupSelectionConstraintText(
      requirements
    );

  return !(
    /\b(?:subtype|category|type|status)\b/.test(
      combined
    ) ||
    /\b(?:file|document|approval|approved|rejected|pending|completed)\b/.test(
      combined
    )
  );
}

function workSetupCandidateMeetsRequiredSubtype(
  requirements:
    GenericFixtureRequirementContext,
  candidate:
    GenericFixtureCandidateInput
): boolean {
  const automatedSurface =
    getWorkSetupSelectionConstraintText(
      requirements
    );

  if (
    /\bdocument-required indication\b/.test(
      automatedSurface
    ) &&
    candidate
      .semanticCapabilities
      .requiresFileUpload !== true
  ) {
    return false;
  }

  if (
    /\bapproval-required indication\b/.test(
      automatedSurface
    ) &&
    candidate
      .semanticCapabilities
      .requiresApproval !== true
  ) {
    return false;
  }

  return true;
}

function normalizeId(
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

function getCompanyWorkSetupId(
  value: any
): string | undefined {
  return (
    normalizeId(value?.id) ??
    normalizeId(
      value?.workSetupId
    ) ??
    normalizeId(
      value?.workSetup?.id
    )
  );
}

function getVisibleTalentWorkSetupId(
  value: any
): string | undefined {
  return (
    normalizeId(
      value?.workSetup?.id
    ) ??
    normalizeId(
      value?.workSetupId
    ) ??
    normalizeId(
      value?.workSetupVersion?.id
    ) ??
    normalizeId(
      value?.workSetup?.workSetupId
    )
  );
}

function getWorkSetupTitle(
  value: any
): string | undefined {
  const candidates = [
    value?.title,
    value?.name,
    value?.workSetup?.title,
    value?.workSetup?.name,
    value?.workSetupVersion?.title,
    value?.workSetupVersion?.name,
    value?.latestVersion?.title,
    value?.latestVersion?.name,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate !== "string"
    ) {
      continue;
    }

    const normalized =
      candidate.trim();

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function workSetupCandidateIsUsable(
  value: any
): boolean {
  if (
    value?.isActive === false ||
    value?.active === false ||
    value?.isDeleted === true ||
    value?.deleted === true
  ) {
    return false;
  }

  const status =
    String(
      value?.status || ""
    )
      .trim()
      .toLowerCase();

  return ![
    "archived",
    "deleted",
    "inactive",
  ].includes(status);
}

function getWorkSetupSemanticCapabilities(
  value: any
): Record<
  string,
  string | number | boolean | null
> {
  const capabilities:
    Record<
      string,
      string | number | boolean | null
    > = {};

  const title =
    getWorkSetupTitle(value);

  if (title) {
    capabilities.title = title;
  }

  const approvedStrings = [
    ["description", value?.description],
    ["description", value?.latestVersion?.description],
    ["category", value?.category],
    ["type", value?.type],
    ["status", value?.status],
  ] as const;

  for (
    const [key, raw]
    of approvedStrings
  ) {
    if (
      capabilities[key] !==
        undefined ||
      typeof raw !== "string"
    ) {
      continue;
    }

    const normalized =
      normalizeWorkSetupFixtureRequirementText(
        raw.replace(/<[^>]*>/g, " "),
        240
      );

    if (normalized) {
      capabilities[key] =
        normalized;
    }
  }

  const approvedBooleans = [
    [
      "requiresDocument",
      value?.requiresDocument,
    ],
    [
      "requiresDocument",
      value?.latestVersion
        ?.requiresDocument,
    ],
    [
      "requiresFileUpload",
      value?.requireFileUpload,
    ],
    [
      "requiresFileUpload",
      value?.requiresFileUpload,
    ],
    [
      "requiresFileUpload",
      value?.latestVersion
        ?.requiresFileUpload,
    ],
    [
      "requiresApproval",
      value?.requireApproval,
    ],
    [
      "requiresApproval",
      value?.requiresApproval,
    ],
  ] as const;

  for (
    const [key, raw]
    of approvedBooleans
  ) {
    if (
      capabilities[key] ===
        undefined &&
      typeof raw === "boolean"
    ) {
      capabilities[key] = raw;
    }
  }

  capabilities.hasReferenceDocument =
    [
      value?.documentPath,
      value?.documentUrl,
      value?.latestVersion
        ?.documentPath,
      value?.latestVersion
        ?.documentUrl,
    ].some(
      (candidate) =>
        typeof candidate ===
          "string" &&
        candidate.trim().length > 0
    );

  return capabilities;
}

export function adaptWorkSetupRuntimeCandidates(
  companyData: unknown,
  visibleTalentData: unknown
): WorkSetupRuntimeCandidateAdapterResult {
  const companyItems =
    extractItems(companyData);

  const visibleItems =
    extractItems(
      visibleTalentData
    );

  const visibleIds =
    new Set<string>();

  for (
    const item
    of visibleItems
  ) {
    const workSetupId =
      getVisibleTalentWorkSetupId(
        item
      );

    if (!workSetupId) {
      return {
        status: "BLOCKED",
        reason:
          "Existing talent Work Setup records could not be mapped to exact Work Setup IDs, so candidate ownership is unsafe.",
        companyCount:
          companyItems.length,
        visibleCount:
          visibleItems.length,
      };
    }

    visibleIds.add(
      workSetupId
    );
  }

  const candidateIds =
    new Set<string>();

  const candidates:
    GenericFixtureCandidateInput[] = [];

  let unidentifiedCompanyCount =
    0;

  for (
    const item
    of companyItems
  ) {
    const workSetupId =
      getCompanyWorkSetupId(
        item
      );

    if (!workSetupId) {
      unidentifiedCompanyCount +=
        1;
      continue;
    }

    if (
      candidateIds.has(
        workSetupId
      )
    ) {
      return {
        status: "BLOCKED",
        reason:
          "Duplicate company Work Setup records shared the same exact Work Setup ID, so candidate metadata is ambiguous.",
        companyCount:
          companyItems.length,
        visibleCount:
          visibleItems.length,
      };
    }

    candidateIds.add(
      workSetupId
    );

    const workSetupTitle =
      getWorkSetupTitle(
        item
      );

    candidates.push({
      id: workSetupId,
      ...(
        workSetupTitle
          ? {
              label:
                workSetupTitle,
            }
          : {}
      ),
      usable:
        workSetupCandidateIsUsable(
          item
        ),
      alreadyAttached:
        visibleIds.has(
          workSetupId
        ),
      semanticCapabilities:
        getWorkSetupSemanticCapabilities(
          item
        ),
    });
  }

  if (
    candidates.length === 0
  ) {
    return {
      status: "BLOCKED",
      reason:
        `No company Work Setup candidate with an exact ID could be constructed; unidentifiedCompanyCount=${unidentifiedCompanyCount}.`,
      companyCount:
        companyItems.length,
      visibleCount:
        visibleItems.length,
    };
  }

  return {
    status: "READY",
    candidates,
    companyCount:
      companyItems.length,
    visibleCount:
      visibleItems.length,
  };
}

function workSetupRequirementsAreSubtypeSpecific(
  requirements:
    GenericFixtureRequirementContext
): boolean {
  return /\b(?:file|document|approval|approved|rejected|pending|completed|reference|subtype|category|type|status)\b/.test(
    getWorkSetupSelectionConstraintText(
      requirements
    )
  );
}

function buildDeterministicGenericWorkSetupProposal(
  args:
    RunGenericFixtureCandidateSelectionArgs
): GenericFixtureCandidateProposal | null {
  if (
    workSetupRequirementsAreSubtypeSpecific(
      args.requirements
    )
  ) {
    return null;
  }

  const eligible =
    args.candidates
      .map(
        normalizeGenericFixtureCandidate
      )
      .filter(
        (candidate) =>
          candidate.usable &&
          typeof candidate.label ===
            "string" &&
          candidate.label.trim().length >
            0
      );

  if (eligible.length === 0) {
    return null;
  }

  const reuseAllowed =
    args.selectionPolicy
      ?.allowReusePreference ===
    true;

  const selected =
    [...eligible].sort(
      (left, right) => {
        if (reuseAllowed) {
          const reuseOrder =
            Number(
              right.alreadyAttached
            ) -
            Number(
              left.alreadyAttached
            );

          if (reuseOrder !== 0) {
            return reuseOrder;
          }
        }

        const labelOrder =
          String(left.label).localeCompare(
            String(right.label)
          );

        return labelOrder !== 0
          ? labelOrder
          : left.selectionKey.localeCompare(
              right.selectionKey
            );
      }
    )[0]!;

  const sameTitleMatches =
    eligible.filter(
      (candidate) =>
        candidate.label ===
        selected.label
    );

  if (sameTitleMatches.length !== 1) {
    return null;
  }

  return {
    decision: "SELECT_CANDIDATE",
    selectionMode:
      selected.selectionMode,
    candidateId:
      selected.selectionKey,
    confidence: "high",
    rationale:
      "The case accepts any compatible populated Work Setup; a stable exact-title candidate was selected, preferring safe reuse when available.",
    evidence: [
      {
        path: "title",
        expected:
          selected.label!,
      },
    ],
  };
}

async function selectWorkSetupFixtureCandidate(
  selectCandidate:
    typeof runGenericFixtureCandidateSelection,
  args:
    RunGenericFixtureCandidateSelectionArgs
): Promise<
  GenericFixtureCandidateSelectionResult
> {
  const deterministicProposal =
    buildDeterministicGenericWorkSetupProposal(
      args
    );

  return selectCandidate({
    ...args,
    ...(deterministicProposal
      ? {
          requestProposal:
            async () =>
              deterministicProposal,
        }
      : args.requestProposal
        ? {
            requestProposal:
              args.requestProposal,
          }
        : {}),
  });
}

function isGenericFixtureCandidateSelectionMode(
  value: unknown
): value is
  "REUSE_EXISTING" |
  "ATTACH_NEW" {
  return (
    value === "REUSE_EXISTING" ||
    value === "ATTACH_NEW"
  );
}

export async function resolveWorkSetupFixtureCandidateDecision(
  args:
    ResolveWorkSetupFixtureCandidateDecisionArgs
): Promise<
  WorkSetupFixtureCandidateDecision
> {
  try {
    const requirements =
      buildWorkSetupFixtureRequirementContext(
        args.testCase
      );

    const runtimeCandidates =
      adaptWorkSetupRuntimeCandidates(
        args.companyData,
        args.visibleTalentData
      );

    if (
      runtimeCandidates.status ===
      "BLOCKED"
    ) {
      return {
        status: "BLOCKED",
        reason:
          runtimeCandidates.reason,
        companyRecordCount:
          runtimeCandidates
            .companyCount,
        visibleRecordCount:
          runtimeCandidates
            .visibleCount,
      };
    }

    const selectionResult =
      await selectWorkSetupFixtureCandidate(
        args.selectCandidate,
        {
        requirements,
        candidates:
          runtimeCandidates.candidates
            .map(
              (candidate) => ({
                ...candidate,
                usable:
                  candidate.usable !==
                    false &&
                  workSetupCandidateMeetsRequiredSubtype(
                    requirements,
                    candidate
                  ),
              })
            ),
        selectionPolicy: {
          allowReusePreference:
            workSetupRequirementsAllowReusePreference(
              requirements
            ),
        },
        ...(
          args.requestCandidateProposal
            ? {
                requestProposal:
                  args.requestCandidateProposal,
              }
            : {}
        ),
        }
      );

    if (
      selectionResult.status ===
      "ERROR"
    ) {
      return {
        status: "ERROR",
        reason:
          selectionResult.note,
      };
    }

    if (
      selectionResult.status ===
      "BLOCKED"
    ) {
      return {
        status: "BLOCKED",
        reason:
          selectionResult
            .evaluation.reason,
        candidateCount:
          runtimeCandidates
            .candidates.length,
        visibleRecordCount:
          runtimeCandidates
            .visibleCount,
        evaluationStatus:
          selectionResult
            .evaluation.status,
        proposal:
          selectionResult.proposal,
        evaluation:
          selectionResult.evaluation,
      };
    }

    if (
      selectionResult.evaluation
        .status !==
        "SAFE_TO_SELECT" ||
      selectionResult.evaluation
        .safeToSelect !== true ||
      selectionResult.evaluation
        .grounded !== true
    ) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate did not include a safe grounded selector evaluation.",
      };
    }

    const selectionMode =
      selectionResult
        .proposal.selectionMode;

    if (
      !isGenericFixtureCandidateSelectionMode(
        selectionMode
      )
    ) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate did not include a supported selection mode.",
      };
    }

    const selectedCandidateId =
      selectionResult.candidate.id;

    if (
      !selectedCandidateId ||
      selectionResult
        .proposal.candidateId !==
        selectionResult.candidate
          .selectionKey ||
      (
        selectionResult
          .evaluation.candidate &&
        selectionResult
          .evaluation.candidate.id !==
          selectedCandidateId
      )
    ) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate ID did not match the proposal candidate ID.",
      };
    }

    const adaptedCandidate =
      runtimeCandidates.candidates
        .find(
          (candidate) =>
            candidate.id ===
            selectedCandidateId
        );

    if (!adaptedCandidate) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate ID was not present in the adapted runtime candidate set.",
      };
    }

    if (
      adaptedCandidate.usable ===
        false ||
      selectionResult.candidate
        .usable !== true
    ) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate was not usable.",
      };
    }

    const alreadyAttached =
      adaptedCandidate
        .alreadyAttached === true;

    if (
      selectionResult.candidate
        .alreadyAttached !==
      alreadyAttached
    ) {
      return {
        status: "ERROR",
        reason:
          "Selected Work Setup candidate attachment state did not match adapted runtime state.",
      };
    }

    if (
      selectionMode ===
        "REUSE_EXISTING" &&
      !alreadyAttached
    ) {
      return {
        status: "ERROR",
        reason:
          "REUSE_EXISTING requires an already-attached Work Setup candidate.",
      };
    }

    if (
      selectionMode ===
        "ATTACH_NEW" &&
      alreadyAttached
    ) {
      return {
        status: "ERROR",
        reason:
          "ATTACH_NEW requires an unattached Work Setup candidate.",
      };
    }

    return {
      status: selectionMode,
      workSetupId:
        selectedCandidateId,
      ...(
        adaptedCandidate.label
          ? {
              workSetupTitle:
                adaptedCandidate.label,
            }
          : {}
      ),
      candidateCount:
        runtimeCandidates
          .candidates.length,
      visibleRecordCount:
        runtimeCandidates
          .visibleCount,
      proposal:
        selectionResult.proposal,
      evaluation:
        selectionResult.evaluation,
    };
  } catch (error: unknown) {
    return {
      status: "ERROR",
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function normalizeBaseUrl(
  value: string
): string {
  return value.replace(
    /\/+$/,
    ""
  );
}

function resolveApiUrl(): string {
  const config =
    yaml.parse(
      fs.readFileSync(
        "config/environments.yaml",
        "utf8"
      )
    );

  return String(
    process.env.QA_API_URL ??
      config?.environments
        ?.staging?.api_url ??
      ""
  ).trim();
}

async function mutateWorkSetupAttachment(
  apiUrl: string,
  path: string,
  method:
    WorkSetupMutationMethod,
  token: string
): Promise<WorkSetupMutationResult> {
  const response =
    await fetch(
      `${normalizeBaseUrl(
        apiUrl
      )}${path}`,
      {
        method,
        headers: {
          Accept:
            "application/json",
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

  const responseText =
    await response
      .text()
      .catch(() => "");

  let responseBody:
    unknown = null;

  if (responseText) {
    try {
      responseBody =
        JSON.parse(
          responseText
        );
    } catch {
      responseBody =
        null;
    }
  }

  return {
    status:
      response.status,
    responseBody,
    responseText,
  };
}

async function refreshTalentContractSurface(
  page: Page
): Promise<void> {
  await page.reload({
    waitUntil:
      "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(
    500
  );
}

async function locatorHasVisibleMatch(
  locator: ReturnType<
    Page["locator"]
  >,
  limit = 30
): Promise<boolean> {
  const count =
    Math.min(
      await locator
        .count()
        .catch(() => 0),
      limit
    );

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const visible =
      await locator
        .nth(index)
        .isVisible()
        .catch(() => false);

    if (visible) {
      return true;
    }
  }

  return false;
}

async function verifyTalentContractPopulatedSurface(
  page: Page,
  expectedCardText?: string
): Promise<boolean> {
  const workSetups =
    page.getByText(
      "Work Setups",
      {
        exact: true,
      }
    );

  const emptyState =
    page.getByText(
      "No work setups are assigned to this job.",
      {
        exact: true,
      }
    );

  const visibleLoadingIndicators =
    page.locator(
      '[role="progressbar"]'
    );

  const expectedCard =
    expectedCardText
      ? page.getByText(
          expectedCardText,
          {
            exact: true,
          }
        )
      : page.getByText(
          /Pending|Completed|Approved|Rejected|In Progress/i
        );

  for (
    let attempt = 0;
    attempt < 40;
    attempt += 1
  ) {
    const observation:
      WorkSetupUiReadinessObservation = {
        sectionVisible:
          await locatorHasVisibleMatch(
            workSetups
          ),

        emptyStateVisible:
          await locatorHasVisibleMatch(
            emptyState
          ),

        expectedCardVisible:
          await locatorHasVisibleMatch(
            expectedCard
          ),

        loadingVisible:
          await locatorHasVisibleMatch(
            visibleLoadingIndicators
          ),
      };

    if (
      isWorkSetupUiReady(
        observation
      )
    ) {
      return true;
    }

    await page.waitForTimeout(
      500
    );
  }

  return false;
}

const defaultDependencies:
  TalentContractWorkSetupFixtureDependencies = {
    getApiUrl:
      resolveApiUrl,

    getToken:
      getFirebaseIdToken,

    getExecutionContext:
      getCachedBrowserExecutionContext,

    selectCandidate:
      runGenericFixtureCandidateSelection,

    getJson:
      apiGet,

    mutate:
      mutateWorkSetupAttachment,

    refreshSurface:
      refreshTalentContractSurface,

    verifyPopulatedSurface:
      verifyTalentContractPopulatedSurface,

    wait:
      async (
        timeoutMs: number
      ): Promise<void> => {
        await new Promise<void>(
          (resolve) => {
            setTimeout(
              resolve,
              timeoutMs
            );
          }
        );
      },
  };


/*
 * CONTROLLED_WORK_SETUP_DEFAULT_DEPENDENCY_FACTORY_V1
 *
 * Expose a fresh copy of the production dependency set for
 * controlled lifecycle diagnostics without changing normal
 * fixture selection policy or provider behavior.
 */
export function createDefaultTalentContractWorkSetupFixtureDependencies():
  TalentContractWorkSetupFixtureDependencies {
  return {
    ...defaultDependencies,
  };
}

function buildAttachmentPath(
  companyId: string,
  workSetupId: string,
  jobId: string
): string {
  return (
    `/companies/${encodeURIComponent(
      companyId
    )}/work-setups/${encodeURIComponent(
      workSetupId
    )}/jobs/${encodeURIComponent(
      jobId
    )}`
  );
}

function buildTalentWorkSetupsPath(
  talentId: string,
  jobId: string
): string {
  return (
    `/talents/${encodeURIComponent(
      talentId
    )}/work-setups?jobId=${encodeURIComponent(
      jobId
    )}`
  );
}

function containsExactWorkSetup(
  data: unknown,
  workSetupId: string
): boolean {
  return extractItems(data)
    .some(
      (item) =>
        getVisibleTalentWorkSetupId(
          item
        ) === workSetupId
    );
}

async function waitForAttachmentState(
  dependencies:
    TalentContractWorkSetupFixtureDependencies,
  args: {
    apiUrl: string;
    path: string;
    talentToken: string;
    workSetupId: string;
    expectedPresent: boolean;
    attempts?: number;
  }
): Promise<boolean> {
  const attempts =
    args.attempts ?? 16;

  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const data =
      await dependencies
        .getJson(
          args.apiUrl,
          args.path,
          args.talentToken
        );

    const present =
      containsExactWorkSetup(
        data,
        args.workSetupId
      );

    if (
      present ===
      args.expectedPresent
    ) {
      return true;
    }

    await dependencies.wait(
      250
    );
  }

  return false;
}

function blockedResult(
  reasonCategory: string,
  note: string,
  cleanups:
    DeferredCleanup[] = []
): BrowserFixtureProviderResult {
  return {
    status: "BLOCKED",
    reasonCategory,
    notes: [note],
    deterministicEvidence: [],
    cleanups,
  };
}

function errorResult(
  reasonCategory: string,
  note: string
): BrowserFixtureProviderResult {
  return {
    status: "ERROR",
    reasonCategory,
    notes: [note],
    deterministicEvidence: [],
    cleanups: [],
  };
}

function readyResult(
  note: string,
  cleanups:
    DeferredCleanup[] = []
): BrowserFixtureProviderResult {
  return {
    status: "READY",
    notes: [note],
    deterministicEvidence: [
      {
        stepIndex: 0,
        action:
          "provisionBrowserFixture",
        expected:
          "Provide one exact populated talent-contract Work Setup fixture before canonical assertions",
        passed: true,
        note,
      },
    ],
    cleanups,
  };
}

function providerSupportsCase(
  issueKey: string,
  testCase: any
): boolean {
  const caseId =
    String(
      testCase?.id || ""
    );

  const persona =
    String(
      testCase?.persona || ""
    ).toLowerCase();

  return (
    persona === "talent" &&
    (
      (
        issueKey === "AS-1190" &&
        caseId === "web-1"
      ) ||
      (
        issueKey === "AS-1165" &&
        caseId === "web-3"
      )
    )
  );
}

export function createTalentContractWorkSetupFixtureProvider(
  dependencies:
    TalentContractWorkSetupFixtureDependencies =
      defaultDependencies
): BrowserFixtureProvider {
  return {
    id:
      "talent-contract-work-setup",

    supports: ({
      issueKey,
      testCase,
    }) =>
      providerSupportsCase(
        issueKey,
        testCase
      ),

    prepare:
      async (
        context:
          BrowserFixtureProviderContext
      ): Promise<
        BrowserFixtureProviderResult
      > => {
        const {
          page,
          testCase,
          runtimeResourceContext,
          captureCheckpoint,
          registerCleanup,
        } = context;

        const runtimeFixture =
          getRuntimeTalentContractFixture(
            testCase
          );

        if (!runtimeFixture) {
          return blockedResult(
            "FIXTURE_RUNTIME_CONTEXT_MISSING",
            "The talent contract resolver did not provide exact contract, talent, and fixture-state metadata."
          );
        }

        const providedCompanyId =
          normalizeId(
            runtimeResourceContext
              ?.companyId
          );

        const companyExecutionContext =
          providedCompanyId
            ? undefined
            : await (
                dependencies
                  .getExecutionContext ??
                getCachedBrowserExecutionContext
              )(
                "company_admin",
                runtimeResourceContext ??
                  {}
              );

        const companyId =
          providedCompanyId ??
          normalizeId(
            companyExecutionContext
              ?.companyId
          );

        const jobId =
          normalizeId(
            runtimeFixture.jobId ??
              runtimeResourceContext
                ?.jobId
          );

        if (
          !companyId ||
          !jobId
        ) {
          return blockedResult(
            "FIXTURE_RUNTIME_CONTEXT_MISSING",
            `Work Setup provisioning requires exact companyId and jobId; companyId=${companyId ?? "missing"}, jobId=${jobId ?? "missing"}.`
          );
        }

        const apiUrl =
          dependencies
            .getApiUrl();

        if (!apiUrl) {
          return blockedResult(
            "FIXTURE_RUNTIME_CONTEXT_MISSING",
            "The staging API URL could not be resolved for Work Setup provisioning."
          );
        }

        const companyToken =
          await dependencies
            .getToken(
              "company_admin"
            );

        const talentToken =
          await dependencies
            .getToken(
              "talent"
            );

        const talentWorkSetupsPath =
          buildTalentWorkSetupsPath(
            runtimeFixture.talentId,
            jobId
          );

        const visibleBefore =
          await dependencies
            .getJson(
              apiUrl,
              talentWorkSetupsPath,
              talentToken
            );

        const companyData =
          await dependencies
            .getJson(
              apiUrl,
              `/companies/${encodeURIComponent(
                companyId
              )}/work-setups?limit=100&offset=0`,
              companyToken
            );

        const runtimeCandidates =
          adaptWorkSetupRuntimeCandidates(
            companyData,
            visibleBefore
          );

        if (
          runtimeCandidates.status ===
          "BLOCKED"
        ) {
          return blockedResult(
            "FIXTURE_PRECONDITION_UNSAFE",
            runtimeCandidates.reason
          );
        }

        const requirements =
          buildWorkSetupFixtureRequirementContext(
            testCase
          );

        const mutationCandidates:
          GenericMutationCandidate[] =
          runtimeCandidates.candidates.map(
            (candidate) => {
              const workSetupId =
                candidate.id;
              const workSetupTitle =
                candidate.label;
              const alreadyAttached =
                candidate
                  .alreadyAttached ===
                true;
              const attachmentPath =
                buildAttachmentPath(
                  companyId,
                  workSetupId,
                  jobId
                );
              const executionReference:
                GenericMutationJson = {
                  attachmentPath,
                  talentCollectionPath:
                    talentWorkSetupsPath,
                  resourceId:
                    workSetupId,
                };

              return {
                id: workSetupId,
                ...(workSetupTitle
                  ? {
                      label:
                        workSetupTitle,
                    }
                  : {}),
                transitionKind:
                  alreadyAttached
                    ? "REUSE_EXISTING"
                    : "ATTACH_EXISTING",
                executionReference,
                semanticCapabilities:
                  candidate
                    .semanticCapabilities,
                eligible:
                  candidate.usable !==
                    false &&
                  Boolean(
                    workSetupTitle
                  ) &&
                  workSetupCandidateMeetsRequiredSubtype(
                    requirements,
                    candidate
                  ),
                preconditions: [
                  "The runtime resource has an exact discovered identifier.",
                  "The target attachment state was observed before selection.",
                  "An exact user-visible label is available for post-state verification.",
                ],
                mutationPolicy:
                  alreadyAttached
                    ? {
                        mutates: false,
                        ownership:
                          "PRE_EXISTING",
                        rollbackRequired:
                          false,
                      }
                    : {
                        mutates: true,
                        ownership:
                          "AGENT_OWNED_ON_SUCCESS",
                        rollbackRequired:
                          true,
                      },
                expectedPostState: {
                  apiPresent: true,
                  uiReady: true,
                },
                observePostState:
                  async () => {
                    const apiPresent =
                      await waitForAttachmentState(
                        dependencies,
                        {
                          apiUrl,
                          path:
                            talentWorkSetupsPath,
                          talentToken,
                          workSetupId,
                          expectedPresent:
                            true,
                        }
                      );

                    if (apiPresent) {
                      await dependencies
                        .refreshSurface(
                          page
                        );
                    }

                    const uiReady =
                      apiPresent &&
                      Boolean(
                        workSetupTitle
                      ) &&
                      await dependencies
                        .verifyPopulatedSurface(
                          page,
                          workSetupTitle
                        );

                    return {
                      observedState: {
                        apiPresent,
                        uiReady,
                      },
                      note:
                        `apiPresent=${apiPresent}, uiReady=${uiReady}`,
                    };
                  },
                ...(!alreadyAttached
                  ? {
                      execute:
                        async () => {
                          const mutation =
                            await dependencies
                              .mutate(
                                apiUrl,
                                attachmentPath,
                                "POST",
                                companyToken
                              );

                          return {
                            status:
                              mutation.status ===
                              201
                                ? "APPLIED"
                                : "NOT_APPLIED",
                            executionReference,
                            note:
                              `POST attach status=${mutation.status}; expected 201.`,
                          } as const;
                        },
                      rollback:
                        async () => {
                          const mutation =
                            await dependencies
                              .mutate(
                                apiUrl,
                                attachmentPath,
                                "DELETE",
                                companyToken
                              );

                          return {
                            status:
                              mutation.status ===
                              200
                                ? "ROLLED_BACK"
                                : "FAILED",
                            executionReference,
                            note:
                              `DELETE detach status=${mutation.status}; expected 200.`,
                          } as const;
                        },
                      expectedRollbackState: {
                        apiPresent: false,
                      },
                      observeRollbackState:
                        async () => {
                          const absent =
                            await waitForAttachmentState(
                              dependencies,
                              {
                                apiUrl,
                                path:
                                  talentWorkSetupsPath,
                                talentToken,
                                workSetupId,
                                expectedPresent:
                                  false,
                              }
                            );

                          if (absent) {
                            await dependencies
                              .refreshSurface(
                                page
                              );

                            await captureCheckpoint?.({
                              phase:
                                "cleanup",
                              label:
                                "work-setup-detached",
                              note:
                                `Removed provider-owned Work Setup ${workSetupId} from job ${jobId} and verified the talent API no longer returns it.`,
                              fullPage: true,
                            });
                          }

                          return {
                            observedState: {
                              apiPresent:
                                !absent,
                            },
                            note:
                              absent
                                ? "The exact attachment is absent from the talent API."
                                : "The exact attachment remains present in the talent API.",
                          };
                        },
                    }
                  : {}),
              };
            }
          );

        const cleanupAdapters =
          new Map<
            GenericMutationCleanup,
            DeferredCleanup
          >();

        const adaptCleanup = (
          cleanup:
            GenericMutationCleanup
        ): DeferredCleanup => {
          const existing =
            cleanupAdapters.get(
              cleanup
            );

          if (existing) {
            return existing;
          }

          const adapted:
            DeferredCleanup = {
              label: cleanup.label,
              evidenceAction:
                "cleanupBrowserFixture",
              expected:
                cleanup.expected,
              notePrefix:
                "Talent contract Work Setup cleanup",
              run: cleanup.run,
            };

          cleanupAdapters.set(
            cleanup,
            adapted
          );

          return adapted;
        };

        const mutationResult =
          await runGenericMutationCore({
            requirements,
            candidates:
              mutationCandidates,
            selectCandidate:
              (selectionArgs) =>
                selectWorkSetupFixtureCandidate(
                  dependencies
                    .selectCandidate,
                  selectionArgs
                ),
            selectionPolicy: {
              allowReusePreference:
                workSetupRequirementsAllowReusePreference(
                  requirements
                ),
            },
            ...(dependencies
              .requestCandidateProposal
              ? {
                  requestProposal:
                    dependencies
                      .requestCandidateProposal,
                }
              : {}),
            ...(registerCleanup
              ? {
                  registerCleanup:
                    (cleanup) => {
                      registerCleanup(
                        adaptCleanup(
                          cleanup
                        )
                      );
                    },
                }
              : {}),
          });

        const cleanups =
          mutationResult.cleanups.map(
            adaptCleanup
          );

        if (
          mutationResult.status ===
          "ERROR"
        ) {
          return {
            ...errorResult(
              "FIXTURE_SELECTION_ERROR",
              mutationResult.note
            ),
            cleanups,
          };
        }

        if (
          mutationResult.status ===
          "BLOCKED"
        ) {
          const diagnostic =
            mutationResult.evaluation
              ? ` evaluationStatus=${mutationResult.evaluation.status}.`
              : "";

          return blockedResult(
            mutationResult.reasonCategory ===
              "TRANSITION_SELECTION_BLOCKED"
              ? "FIXTURE_PRECONDITION_UNSAFE"
              : "FIXTURE_PROVISIONING_FAILED",
            `${mutationResult.note}${diagnostic}`,
            cleanups
          );
        }

        const selected =
          mutationResult.candidate;
        const reused =
          selected.transitionKind ===
          "REUSE_EXISTING";
        const setupNote =
          reused
            ? `Reused existing Work Setup ${selected.id} for contractId=${runtimeFixture.contractId}, jobId=${jobId}; exact API/UI state was verified and no cleanup ownership was established.`
            : `Attached existing Work Setup ${selected.id} to job ${jobId} for contractId=${runtimeFixture.contractId}; POST returned 201 and talent API/UI persistence checks passed.`;

        await captureCheckpoint?.({
          phase: "setup",
          label:
            reused
              ? "work-setup-reused"
              : "work-setup-attached",
          note: setupNote,
          fullPage: true,
        });

        return readyResult(
          setupNote,
          cleanups
        );
      },
  };
}

export const talentContractWorkSetupFixtureProvider =
  createTalentContractWorkSetupFixtureProvider();
