import fs from "node:fs";
import yaml from "yaml";
import type {
  Page,
} from "playwright";
import type {
  BrowserPersona,
} from "../browser-session-manager.js";
import type {
  DeferredCleanup,
  DeferredCleanupResult,
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

type WorkSetupMutationMethod =
  | "POST"
  | "DELETE";

export type WorkSetupMutationResult = {
  status: number;
  responseBody: unknown;
  responseText: string;
};

export type TalentContractWorkSetupFixtureDependencies = {
  getApiUrl: () => string;

  getToken: (
    persona: BrowserPersona
  ) => Promise<string>;

  getExecutionContext?: (
    persona: BrowserPersona,
    providedContext: any
  ) => Promise<any>;

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
    page: Page
  ) => Promise<boolean>;

  wait: (
    timeoutMs: number
  ) => Promise<void>;
};

export type SafeWorkSetupCandidateSelection =
  | {
      status: "SELECTED";
      workSetupId: string;
      companyCount: number;
      visibleCount: number;
    }
  | {
      status: "BLOCKED";
      reason: string;
      companyCount: number;
      visibleCount: number;
    };

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

function workSetupCandidateIsUsable(
  value: any
): boolean {
  if (
    value?.isActive === false ||
    value?.active === false
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

export function selectSafeWorkSetupCandidate(
  companyData: unknown,
  visibleTalentData: unknown
): SafeWorkSetupCandidateSelection {
  const companyItems =
    extractItems(companyData);

  const visibleItems =
    extractItems(
      visibleTalentData
    );

  const visibleIds =
    new Set<string>();

  let unidentifiedVisibleCount = 0;

  for (
    const item
    of visibleItems
  ) {
    const workSetupId =
      getVisibleTalentWorkSetupId(
        item
      );

    if (workSetupId) {
      visibleIds.add(
        workSetupId
      );
    } else {
      unidentifiedVisibleCount += 1;
    }
  }

  if (
    unidentifiedVisibleCount > 0
  ) {
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

  for (
    const item
    of companyItems
  ) {
    if (
      !workSetupCandidateIsUsable(
        item
      )
    ) {
      continue;
    }

    const workSetupId =
      getCompanyWorkSetupId(
        item
      );

    if (
      workSetupId &&
      !visibleIds.has(
        workSetupId
      )
    ) {
      return {
        status: "SELECTED",
        workSetupId,
        companyCount:
          companyItems.length,
        visibleCount:
          visibleItems.length,
      };
    }
  }

  return {
    status: "BLOCKED",
    reason:
      visibleItems.length > 0
        ? "Every usable company Work Setup is already visible for the selected talent and job."
        : "No usable company Work Setup candidate with an exact ID was available.",
    companyCount:
      companyItems.length,
    visibleCount:
      visibleItems.length,
  };
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
    1200
  );
}

async function verifyTalentContractPopulatedSurface(
  page: Page
): Promise<boolean> {
  const workSetups =
    page.getByText(
      "Work Setups",
      {
        exact: true,
      }
    );

  const sectionVisible =
    await workSetups
      .first()
      .waitFor({
        state: "visible",
        timeout: 10000,
      })
      .then(() => true)
      .catch(() => false);

  if (!sectionVisible) {
    return false;
  }

  const emptyState =
    page.getByText(
      "No work setups are assigned to this job.",
      {
        exact: true,
      }
    );

  const emptyStateVisible =
    await emptyState
      .first()
      .isVisible()
      .catch(() => false);

  return !emptyStateVisible;
}

const defaultDependencies:
  TalentContractWorkSetupFixtureDependencies = {
    getApiUrl:
      resolveApiUrl,

    getToken:
      getFirebaseIdToken,

    getExecutionContext:
      getCachedBrowserExecutionContext,

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

        const visibleBeforeItems =
          extractItems(
            visibleBefore
          );

        if (
          visibleBeforeItems.length >
          0
        ) {
          await dependencies
            .refreshSurface(page);

          const populated =
            await dependencies
              .verifyPopulatedSurface(
                page
              );

          if (!populated) {
            return blockedResult(
              "FIXTURE_PROVISIONING_FAILED",
              "Talent API already exposed Work Setup records, but the populated contract UI surface could not be verified."
            );
          }

          const note =
            `Existing populated Work Setup fixture retained for contractId=${runtimeFixture.contractId}, jobId=${jobId}; no mutation or cleanup was required.`;

          await captureCheckpoint?.({
            phase: "setup",
            label:
              "work-setup-existing",
            note,
            fullPage: true,
          });

          return readyResult(
            note
          );
        }

        const companyData =
          await dependencies
            .getJson(
              apiUrl,
              `/companies/${encodeURIComponent(
                companyId
              )}/work-setups?limit=100&offset=0`,
              companyToken
            );

        const selection =
          selectSafeWorkSetupCandidate(
            companyData,
            visibleBefore
          );

        if (
          selection.status ===
          "BLOCKED"
        ) {
          return blockedResult(
            "FIXTURE_PRECONDITION_UNSAFE",
            `${selection.reason} companyCount=${selection.companyCount}, visibleCount=${selection.visibleCount}.`
          );
        }

        const attachmentPath =
          buildAttachmentPath(
            companyId,
            selection.workSetupId,
            jobId
          );

        let attachmentCreated =
          false;

        const cleanup:
          DeferredCleanup = {
            label:
              `talent contract Work Setup attachment ${selection.workSetupId} -> job ${jobId}`,

            evidenceAction:
              "cleanupBrowserFixture",

            expected:
              "Delete only the exact Work Setup-to-job attachment created by this provider and verify it is no longer visible to the talent",

            notePrefix:
              "Talent contract Work Setup cleanup",

            run:
              async (): Promise<
                DeferredCleanupResult
              > => {
                if (
                  !attachmentCreated
                ) {
                  return {
                    status: "PASS",
                    note:
                      "No provider-owned attachment was created, so cleanup was a verified no-op.",
                  };
                }

                const cleanupMutation =
                  await dependencies
                    .mutate(
                      apiUrl,
                      attachmentPath,
                      "DELETE",
                      companyToken
                    );

                if (
                  cleanupMutation
                    .status !== 200
                ) {
                  return {
                    status: "FAIL",
                    note:
                      `DELETE returned status=${cleanupMutation.status}; exact provider-owned attachment could not be proven removed.`,
                  };
                }

                const absent =
                  await waitForAttachmentState(
                    dependencies,
                    {
                      apiUrl,
                      path:
                        talentWorkSetupsPath,
                      talentToken,
                      workSetupId:
                        selection
                          .workSetupId,
                      expectedPresent:
                        false,
                    }
                  );

                if (!absent) {
                  return {
                    status: "FAIL",
                    note:
                      `DELETE returned 200, but Work Setup ${selection.workSetupId} remained visible for talentId=${runtimeFixture.talentId}, jobId=${jobId}.`,
                  };
                }

                await dependencies
                  .refreshSurface(page);

                await captureCheckpoint?.({
                  phase: "cleanup",
                  label:
                    "work-setup-detached",
                  note:
                    `Removed provider-owned Work Setup ${selection.workSetupId} from job ${jobId} and verified the talent API no longer returns it.`,
                  fullPage: true,
                });

                return {
                  status: "PASS",
                  note:
                    `Removed provider-owned Work Setup ${selection.workSetupId} from job ${jobId}; DELETE returned 200 and the talent API no longer returns the attachment.`,
                };
              },
          };

        registerCleanup?.(
          cleanup
        );

        const setupMutation =
          await dependencies
            .mutate(
              apiUrl,
              attachmentPath,
              "POST",
              companyToken
            );

        if (
          setupMutation.status !==
          201
        ) {
          return blockedResult(
            "FIXTURE_PROVISIONING_FAILED",
            `POST attach returned status=${setupMutation.status}; expected 201 for Work Setup ${selection.workSetupId} and job ${jobId}.`,
            [cleanup]
          );
        }

        attachmentCreated =
          true;

        const persisted =
          await waitForAttachmentState(
            dependencies,
            {
              apiUrl,
              path:
                talentWorkSetupsPath,
              talentToken,
              workSetupId:
                selection
                  .workSetupId,
              expectedPresent:
                true,
            }
          );

        if (!persisted) {
          return blockedResult(
            "FIXTURE_PROVISIONING_FAILED",
            `POST returned 201, but Work Setup ${selection.workSetupId} did not become visible for talentId=${runtimeFixture.talentId}, jobId=${jobId}.`,
            [cleanup]
          );
        }

        await dependencies
          .refreshSurface(page);

        const populated =
          await dependencies
            .verifyPopulatedSurface(
              page
            );

        if (!populated) {
          return blockedResult(
            "FIXTURE_PROVISIONING_FAILED",
            `Work Setup ${selection.workSetupId} persisted through the API, but the populated contract UI surface was not verified.`,
            [cleanup]
          );
        }

        const setupNote =
          `Attached existing Work Setup ${selection.workSetupId} to job ${jobId} for contractId=${runtimeFixture.contractId}; POST returned 201 and talent API/UI persistence checks passed.`;

        await captureCheckpoint?.({
          phase: "setup",
          label:
            "work-setup-attached",
          note:
            setupNote,
          fullPage: true,
        });

        return readyResult(
          setupNote,
          [cleanup]
        );
      },
  };
}

export const talentContractWorkSetupFixtureProvider =
  createTalentContractWorkSetupFixtureProvider();
