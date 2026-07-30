import type {
  Locator,
  Page,
} from "playwright";
import type {
  DeferredCleanup,
  DeferredCleanupResult,
} from "./browser-deferred-cleanup.js";
import {
  browserMutationsAllowed,
  browserMutationPreflightRequested,
} from "./browser-mutation-policy.js";
import {
  selectTrolleyComplianceRequirements,
} from "./browser-job-compliance-selection.js";
import {
  findCreatedResourceId,
  getResponseRequestHeader,
} from "./browser-created-resource.js";
import {
  evaluateCreatedResourceRedirect,
} from "./browser-created-resource-redirect.js";
import {
  observeMutationResponse,
} from "./browser-mutation-response.js";

/**
 * JOB_CREATION_REDIRECT_V2
 *
 * This module is the only browser capability permitted to
 * persist a job. It creates one uniquely named QA draft,
 * verifies the post-creation route, and then deletes that
 * exact resource through the source-grounded API contract.
 */

export type JobCreationRedirectOrigin =
  | "jobs"
  | "all-jobs";

export type DraftJobCreationResult = {
  status:
    | "PASS"
    | "FAIL"
    | "BLOCKED"
    | "MANUAL_REQUIRED"
    | "ERROR";
  reasonCategory: string;
  note: string;
  createdJobId?: string;
  createdJobTitle?: string;
  companyId?: string;
  projectId?: string;
  finalUrl?: string;
  cleanupStatus?:
    | "PASS"
    | "FAIL"
    | "PENDING"
    | "NOT_NEEDED";
  cleanupNote?: string;
  deferredCleanup?: DeferredCleanup;
};

type DraftEndpointContext = {
  apiOrigin: string;
  companyId: string;
  projectId: string;
};

const JOB_CREATED_RESOURCE_ID_KEYS = [
  "id",
  "jobId",
] as const;

const JOB_CREATED_RESOURCE_WRAPPER_KEYS = [
  "job",
  "createdJob",
  "data",
  "result",
] as const;

function buildRunSafeJobTitle(
  caseId: string
): string {
  const safeCaseId = caseId
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

  return [
    "QA Agent Draft",
    safeCaseId || "browser",
    timestamp,
  ].join(" ");
}

async function firstVisibleOutsideNavigation(
  locators: Locator[]
): Promise<Locator | null> {
  for (const locator of locators) {
    const count = Math.min(
      await locator.count().catch(() => 0),
      20
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const candidate = locator.nth(index);

      const visible = await candidate
        .isVisible({
          timeout: 1500,
        })
        .catch(() => false);

      if (!visible) {
        continue;
      }

      const outsideNavigation = await candidate
        .evaluate((element: Element) => {
          return !element.closest(
            "aside, nav"
          );
        })
        .catch(() => false);

      if (outsideNavigation) {
        return candidate;
      }
    }
  }

  return null;
}

function parseDraftEndpoint(
  rawUrl: string
): DraftEndpointContext | null {
  try {
    const parsed = new URL(rawUrl);

    const match = parsed.pathname.match(
      /\/companies\/([1-9]\d*)\/projects\/([1-9]\d*)\/jobs\/draft\/?$/
    );

    if (!match?.[1] || !match[2]) {
      return null;
    }

    return {
      apiOrigin: parsed.origin,
      companyId: match[1],
      projectId: match[2],
    };
  } catch {
    return null;
  }
}

async function findProjectCombobox(
  page: Page
): Promise<Locator | null> {
  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    const comboboxes =
      page.getByRole("combobox");

    const count = Math.min(
      await comboboxes
        .count()
        .catch(() => 0),
      20
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const candidate =
        comboboxes.nth(index);

      const visible = await candidate
        .isVisible()
        .catch(() => false);

      if (!visible) {
        continue;
      }

      const isProjectControl =
        await candidate
          .evaluate(
            (element: Element) => {
              const formItem =
                element.closest(
                  ".ant-form-item"
                );

              const text = String(
                formItem?.textContent || ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();

              return (
                text.includes(
                  "select a project"
                ) ||
                (
                  text.includes("project") &&
                  text.includes(
                    "this job will be created under"
                  )
                )
              );
            }
          )
          .catch(() => false);

      if (isProjectControl) {
        return candidate;
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function selectRuntimeProject(
  page: Page
): Promise<boolean> {
  const projectCombobox =
    await findProjectCombobox(page);

  if (!projectCombobox) {
    console.log(
      " Runtime project selection failed: " +
        "project combobox was not found."
    );

    return false;
  }

  let currentUrl: URL;

  try {
    currentUrl = new URL(page.url());
  } catch {
    console.log(
      " Runtime project selection failed: " +
        "current browser URL is invalid."
    );

    return false;
  }

  const targetProjectId =
    currentUrl.searchParams.get("project");

  if (
    !targetProjectId ||
    !/^[1-9]\d*$/.test(targetProjectId)
  ) {
    console.log(
      " Runtime project selection failed: " +
        "no concrete project ID exists in the URL."
    );

    return false;
  }

  await projectCombobox.click();
  await page.waitForTimeout(500);

  const listboxId =
    await projectCombobox
      .getAttribute("aria-controls")
      .catch(() => null);

  if (
    !listboxId ||
    !/^[a-zA-Z0-9_-]+$/.test(listboxId)
  ) {
    console.log(
      " Runtime project selection failed: " +
        "Ant Design listbox ID is unavailable."
    );

    return false;
  }

  /*
   * Ant Design maintains a hidden accessible list whose
   * option text contains each option value. For projects,
   * that value is expected to be the concrete project ID.
   */
  const accessibleOptions =
    page.locator(
      `#${listboxId} [role="option"]`
    );

  let accessibleOptionCount = 0;

  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    accessibleOptionCount =
      await accessibleOptions
        .count()
        .catch(() => 0);

    if (accessibleOptionCount > 0) {
      break;
    }

    await page.waitForTimeout(250);
  }

  let targetOptionIndex = -1;

  const accessibleValues:
    string[] = [];

  for (
    let index = 0;
    index < accessibleOptionCount;
    index += 1
  ) {
    const option =
      accessibleOptions.nth(index);

    const text =
      (
        await option
          .textContent()
          .catch(() => "")
      )
        ?.replace(/\s+/g, " ")
        .trim() ?? "";

    const ariaLabel =
      (
        await option
          .getAttribute("aria-label")
          .catch(() => null)
      )
        ?.replace(/\s+/g, " ")
        .trim() ?? "";

    const dataValue =
      (
        await option
          .getAttribute("data-value")
          .catch(() => null)
      )
        ?.trim() ?? "";

    accessibleValues.push(
      [
        text,
        ariaLabel,
        dataValue,
      ]
        .filter(Boolean)
        .join(" | ")
    );

    if (
      text === targetProjectId ||
      ariaLabel === targetProjectId ||
      dataValue === targetProjectId
    ) {
      targetOptionIndex = index;
      break;
    }
  }

  if (targetOptionIndex < 0) {
    console.log(
      ` Runtime project selection failed: ` +
        `projectId=${targetProjectId} was not ` +
        `found in Ant Design option values. ` +
        `Observed=${JSON.stringify(
          accessibleValues.slice(0, 30)
        )}`
    );

    return false;
  }

  const visibleOptions =
    page.locator(
      [
        ".ant-select-dropdown",
        ":not(.ant-select-dropdown-hidden)",
        " .ant-select-item-option",
        ":not(.ant-select-item-option-disabled)",
      ].join("")
    );

  let visibleOptionCount = 0;

  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    visibleOptionCount =
      await visibleOptions
        .count()
        .catch(() => 0);

    if (
      visibleOptionCount >
      targetOptionIndex
    ) {
      break;
    }

    await page.waitForTimeout(250);
  }

  if (
    visibleOptionCount <=
    targetOptionIndex
  ) {
    console.log(
      ` Runtime project selection failed: ` +
        `projectId=${targetProjectId} mapped to ` +
        `option index=${targetOptionIndex}, but only ` +
        `${visibleOptionCount} visible Ant Design ` +
        `option element(s) were found.`
    );

    return false;
  }

  const targetVisibleOption =
    visibleOptions.nth(
      targetOptionIndex
    );

  const targetLabel =
    (
      await targetVisibleOption
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

  await targetVisibleOption
    .scrollIntoViewIfNeeded();

  await targetVisibleOption.click();

  const selectRoot =
    projectCombobox.locator(
      "xpath=ancestor::*[" +
        "contains(" +
          "concat(' ', normalize-space(@class), ' ')," +
          "' ant-select '" +
        ")" +
      "][1]"
    );

  const selectionItem =
    selectRoot
      .locator(
        ".ant-select-selection-item"
      )
      .first();

  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    await page.waitForTimeout(250);

    const selectedText =
      (
        await selectionItem
          .textContent()
          .catch(() => "")
      )
        ?.replace(/\s+/g, " ")
        .trim() ?? "";

    const placeholderVisible =
      await selectRoot
        .locator(
          ".ant-select-selection-placeholder"
        )
        .isVisible()
        .catch(() => false);

    if (
      selectedText &&
      !placeholderVisible
    ) {
      console.log(
        ` Runtime project selected and verified: ` +
          `projectId=${targetProjectId}, ` +
          `label="${selectedText || targetLabel}"`
      );

      return true;
    }
  }

  console.log(
    ` Runtime project click was not reflected ` +
      `in the Ant Design selection display: ` +
      `projectId=${targetProjectId}, ` +
      `label="${targetLabel || "(empty)"}"`
  );

  return false;
}

async function selectTrolleyProvider(
  page: Page
): Promise<boolean> {
  const trolleyCard =
    await firstVisibleOutsideNavigation([
      page.getByRole("button", {
        name: /\bTrolley\b/i,
      }),
    ]);

  if (!trolleyCard) {
    return false;
  }

  const ariaDisabled =
    await trolleyCard
      .getAttribute("aria-disabled")
      .catch(() => null);

  if (ariaDisabled === "true") {
    return false;
  }

  await trolleyCard.click();
  await page.waitForTimeout(400);

  const radio = trolleyCard
    .locator(
      'input[type="radio"]'
    )
    .first();

  if (
    await radio.count().catch(() => 0) < 1
  ) {
    return false;
  }

  return radio
    .isChecked()
    .catch(() => false);
}

async function cleanupCreatedDraft(
  page: Page,
  args: {
    endpoint: DraftEndpointContext;
    createdJobId: string;
    authorization: string | undefined;
    firebaseAppCheck:
      | string
      | undefined;
  }
): Promise<DeferredCleanupResult> {
  const cleanupUrl = new URL(
    `/companies/` +
      `${args.endpoint.companyId}/` +
      `projects/` +
      `${args.endpoint.projectId}/` +
      `jobs/${args.createdJobId}`,
    args.endpoint.apiOrigin
  ).toString();

  const headers: Record<
    string,
    string
  > = {
    accept: "application/json",
  };

  if (args.authorization) {
    headers.authorization =
      args.authorization;
  }

  if (args.firebaseAppCheck) {
    headers["x-firebase-appcheck"] =
      args.firebaseAppCheck;
  }

  try {
    const response =
      await page.request.delete(
        cleanupUrl,
        {
          headers,
          timeout: 30000,
        }
      );

    const status =
      response.status();

    if (
      status >= 200 &&
      status < 300
    ) {
      return {
        status: "PASS",
        note:
          `Exact cleanup succeeded: ` +
          `DELETE jobId=` +
          `${args.createdJobId}, ` +
          `projectId=` +
          `${args.endpoint.projectId}, ` +
          `status=${status}`,
      };
    }

    return {
      status: "FAIL",
      note:
        `Exact cleanup was rejected: ` +
        `jobId=${args.createdJobId}, ` +
        `projectId=` +
        `${args.endpoint.projectId}, ` +
        `status=${status}`,
    };
  } catch (error: unknown) {
    return {
      status: "FAIL",
      note:
        `Exact cleanup failed: ` +
        `jobId=${args.createdJobId}, ` +
        `projectId=` +
        `${args.endpoint.projectId}, ` +
        `reason=` +
        `${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
    };
  }
}

export async function createDraftJobAndVerifyRedirect(
  page: Page,
  args: {
    caseId: string;
    origin: JobCreationRedirectOrigin;
  }
): Promise<DraftJobCreationResult> {
  const preflightOnly =
    browserMutationPreflightRequested();

  if (
    !preflightOnly &&
    !browserMutationsAllowed()
  ) {
    return {
      status: "BLOCKED",
      reasonCategory:
        "MUTATION_SAFETY_GUARD",
      note:
        "Browser draft-job creation is blocked " +
        "by default. Set " +
        "QA_ALLOW_BROWSER_MUTATIONS=true " +
        "only in an approved test environment.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  let initialUrl: URL;

  try {
    initialUrl = new URL(page.url());
  } catch {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "Job creation could not start " +
        `because the current URL is invalid: ` +
        page.url(),
      cleanupStatus: "NOT_NEEDED",
    };
  }

  if (
    initialUrl.pathname !==
    "/company/jobs/create"
  ) {
    return {
      status: "BLOCKED",
      reasonCategory: "WRONG_ROUTE",
      note:
        "The dedicated job creation action " +
        "requires /company/jobs/create, " +
        `but reached ${initialUrl.pathname}.`,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  const actualAllJobsOrigin =
    initialUrl.searchParams.get(
      "origin"
    ) === "all-jobs";

  const expectedAllJobsOrigin =
    args.origin === "all-jobs";

  if (
    actualAllJobsOrigin !==
    expectedAllJobsOrigin
  ) {
    return {
      status: "BLOCKED",
      reasonCategory: "WRONG_ROUTE",
      note:
        "The job wizard origin does not match " +
        `the test action. expected=${args.origin}, ` +
        `url=${initialUrl.toString()}`,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  if (expectedAllJobsOrigin) {
    const projectSelected =
      await selectRuntimeProject(page);

    if (!projectSelected) {
      return {
        status: "MANUAL_REQUIRED",
        reasonCategory:
          "AUTOMATION_LIMITATION",
        note:
          "The all-jobs wizard opened, but no " +
          "safe runtime project option could " +
          "be selected.",
        cleanupStatus: "NOT_NEEDED",
      };
    }
  }

  const jobTitle =
    buildRunSafeJobTitle(args.caseId);

  const titleInput =
    await firstVisibleOutsideNavigation([
      page.getByLabel(
        "Job title",
        { exact: true }
      ),
      page.getByPlaceholder(
        "Enter job title",
        { exact: true }
      ),
    ]);

  if (!titleInput) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The source-grounded Job title " +
        "input was not visible or safely " +
        "accessible.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  await titleInput.fill(jobTitle);

  const paymentStep =
    await firstVisibleOutsideNavigation([
      page.getByRole("tab", {
        name: "Payments",
        exact: true,
      }),
      page.getByRole("button", {
        name: "Payments",
        exact: true,
      }),
      page.getByText(
        "Payments",
        { exact: true }
      ),
    ]);

  if (!paymentStep) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The source-grounded Payments " +
        "wizard step was not visible or " +
        "safely clickable.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  await paymentStep.click();
  await page.waitForTimeout(500);

  const trolleySelected =
    await selectTrolleyProvider(page);

  if (!trolleySelected) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The enabled source-grounded Trolley " +
        "provider card could not be selected " +
        "and verified.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  /*
   * JOB_CREATION_TROLLEY_COMPLIANCE_V2
   *
   * Trolley draft creation requires a
   * source-grounded Master service agreement.
   */
  const complianceSelection =
    await selectTrolleyComplianceRequirements(
      page
    );

  if (
    complianceSelection.status !== "PASS"
  ) {
    return {
      status:
        complianceSelection.status,
      reasonCategory:
        complianceSelection
          .reasonCategory,
      note:
        complianceSelection.note,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  console.log(
    ` Draft job compliance selected: ` +
      `masterServiceAgreement="` +
      `${complianceSelection
        .masterServiceAgreement}"`
  );

  if (
    complianceSelection.workAuthorization
  ) {
    console.log(
      ` Draft job compliance selected: ` +
        `workAuthorization="` +
        `${complianceSelection
          .workAuthorization}"`
    );
  } else {
    console.log(
      " Draft job compliance selection: " +
        "no selectable Work authorization " +
        "was exposed."
    );
  }

  const saveDraftButton =
    page.getByRole("button", {
      name: "Save as Draft",
      exact: true,
    });

  const saveVisible =
    await saveDraftButton
      .first()
      .isVisible()
      .catch(() => false);

  if (!saveVisible) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The source-grounded Save as Draft " +
        "button was not visible. The persona " +
        "may lack draft-save permission.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  const saveEnabled =
    await saveDraftButton
      .first()
      .isEnabled()
      .catch(() => false);

  if (!saveEnabled) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "The source-grounded Save as Draft " +
        "button is visible but disabled.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  if (preflightOnly) {
    return {
      status: "PASS",
      reasonCategory:
        "ASSERTIONS_PASSED",
      note:
        "Draft-job preflight passed: the Job " +
        "title input was filled locally, the " +
        "Payments step opened, the enabled " +
        "Trolley provider and required " +
        "compliance were selected, and Save " +
        "as Draft is visible and enabled. " +
        "No create request was submitted.",
      cleanupStatus: "NOT_NEEDED",
    };
  }

  console.log(
    ` Draft job mutation prepared: ` +
      `title="${jobTitle}", ` +
      `origin=${args.origin}`
  );

  const observedCreate =
    await observeMutationResponse(
      page,
      {
        method: "POST",

        matchesResponse:
          (candidate) =>
            Boolean(
              parseDraftEndpoint(
                candidate.url()
              )
            ),

        trigger: () =>
          saveDraftButton
            .first()
            .click(),

        timeoutMs: 30000,
        responseSummaryLimit: 1600,
      }
    );

  if (!observedCreate) {
    return {
      status: "MANUAL_REQUIRED",
      reasonCategory:
        "AUTOMATION_LIMITATION",
      note:
        "Save as Draft was attempted, but " +
        "the source-grounded draft creation " +
        "request was not observed. No created " +
        "resource ID is available.",
      createdJobTitle: jobTitle,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  const {
    response: createResponse,
    requestBody,
    responseBody,
    responseSummary,
  } = observedCreate;
  
  const endpoint =
    parseDraftEndpoint(
      createResponse.url()
    );

  if (!endpoint) {
    return {
      status: "ERROR",
      reasonCategory:
        "AGENT_RUNTIME_ERROR",
      note:
        "The draft request was observed but " +
        "its company/project endpoint context " +
        "could not be parsed.",
      createdJobTitle: jobTitle,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  /*
   * DRAFT_CREATE_HTTP_DIAGNOSTICS_V1
   *
   * Log only a bounded, non-secret summary of the
   * draft payload and backend validation response.
   */

  const requestRecord =
    requestBody &&
    typeof requestBody === "object" &&
    !Array.isArray(requestBody)
      ? (
          requestBody as
            Record<string, unknown>
        )
      : {};

  const requestSummary = {
    keys:
      Object.keys(requestRecord).sort(),
    title:
      typeof requestRecord.title === "string"
        ? requestRecord.title
        : null,
    status:
      typeof requestRecord.status === "string"
        ? requestRecord.status
        : null,
    paymentProvider:
      typeof requestRecord.paymentProvider ===
      "string"
        ? requestRecord.paymentProvider
        : null,
    targetHeadcount:
      requestRecord.targetHeadcount ?? null,
    hasJobDescription:
      typeof requestRecord.jobDescription ===
        "string" &&
      requestRecord.jobDescription.trim()
        .length > 0,
    hasTimesheetConfig:
      Boolean(requestRecord.timesheetConfig),
  };

  if (!createResponse.ok()) {
    const diagnostic =
      `status=${createResponse.status()}, ` +
      `statusText=${
        createResponse.statusText() ||
        "(empty)"
      }, ` +
      `request=${
        JSON.stringify(requestSummary)
      }, ` +
      `response=${
        responseSummary || "(empty)"
      }`;

    console.log(
      ` Draft create HTTP diagnostic: ` +
        diagnostic
    );

    return {
      status: "BLOCKED",
      reasonCategory:
        "TEST_DATA_ISSUE",
      note:
        "The source-grounded draft endpoint " +
        "rejected creation. " +
        `companyId=${endpoint.companyId}, ` +
        `projectId=${endpoint.projectId}, ` +
        diagnostic,
      createdJobTitle: jobTitle,
      companyId: endpoint.companyId,
      projectId: endpoint.projectId,
      cleanupStatus: "NOT_NEEDED",
    };
  }

  const responseJobId =
    findCreatedResourceId(
      responseBody,
      JOB_CREATED_RESOURCE_ID_KEYS,
      JOB_CREATED_RESOURCE_WRAPPER_KEYS
    );

  const expectedBase =
    args.origin === "all-jobs"
      ? "/company/all-jobs"
      : "/company/jobs";

  const redirectEvaluation =
    await evaluateCreatedResourceRedirect(
      page,
      {
        responseResourceId:
          responseJobId,

        contract: {
          resourceLabel: "job",

          extractPathResourceId:
            (pathname) => {
              const match =
                pathname.match(
                  /^\/company\/(?:all-jobs|jobs)\/([1-9]\d*)$/
                );

              return match?.[1] || null;
            },

          buildExpectedPath:
            (resourceId) =>
              `${expectedBase}/${resourceId}`,

          requiredQueryParams: [
            {
              key: "project",
              value:
                endpoint.projectId,
            },
          ],

          forbiddenQueryParams: [
            {
              key: "jobId",
              note:
                "obsolete jobId query parameter is present",
            },
          ],

          forbiddenUrlValues: [
            {
              value: "undefined",
              note:
                "final URL contains undefined or null",
            },
            {
              value: "null",
              note:
                "final URL contains undefined or null",
            },
          ],
        },
      }
    );

  const {
    finalUrl,
    routeResourceId:
      finalUrlJobId,
    createdResourceId:
      createdJobId,
    assertionFailures,
  } = redirectEvaluation;

  if (!createdJobId) {
    return {
      status: "ERROR",
      reasonCategory:
        "CREATED_RESOURCE_ID_UNAVAILABLE",
      note:
        "The draft endpoint returned success, " +
        "but neither its response nor the final " +
        "URL exposed the created job ID. Manual " +
        `cleanup may be required for title="${jobTitle}".`,
      createdJobTitle: jobTitle,
      companyId: endpoint.companyId,
      projectId: endpoint.projectId,
      finalUrl: finalUrl.toString(),
      cleanupStatus: "FAIL",
      cleanupNote:
        "Cleanup could not run without the " +
        "exact created job ID.",
    };
  }

  /*
   * Keep the resource alive until the runner has
   * captured the checkpoint and final screenshot.
   * The cached promise also guarantees that cleanup
   * cannot delete the same resource twice.
   */
  const cleanupArgs = {
    endpoint,
    createdJobId,
    authorization:
getResponseRequestHeader(
  createResponse,
  "authorization"
),
    firebaseAppCheck:
getResponseRequestHeader(
  createResponse,
  "x-firebase-appcheck"
),
  };

let cleanupPromise:
  Promise<DeferredCleanupResult> | null =
    null;

  const cleanupLabel =
    `draft-job jobId=${createdJobId}, ` +
    `projectId=${endpoint.projectId}`;

const deferredCleanup:
  DeferredCleanup = {
      label: cleanupLabel,
      evidenceAction:
        "cleanupExactCreatedJob",
      expected:
        `Exact cleanup succeeds for ` +
        cleanupLabel,
      notePrefix:
        "Draft job cleanup",
      run: () => {
        if (!cleanupPromise) {
          cleanupPromise =
            cleanupCreatedDraft(
              page,
              cleanupArgs
            );
        }

        return cleanupPromise;
      },
    };

  await page
    .waitForLoadState(
      "domcontentloaded",
      {
        timeout: 5000,
      }
    )
    .catch(() => undefined);

  await page.waitForTimeout(1000);

  const resourceNote =
    `title="${jobTitle}", ` +
    `jobId=${createdJobId}, ` +
    `companyId=${endpoint.companyId}, ` +
    `projectId=${endpoint.projectId}, ` +
    `url=${finalUrl.toString()}, ` +
    `cleanup=PENDING`;

  if (
    assertionFailures.length > 0
  ) {
    return {
      status: "FAIL",
      reasonCategory:
        "PRODUCT_ASSERTION_FAILED",
      note:
        "The draft was created, but the " +
        "post-creation redirect assertion " +
        "failed: " +
        assertionFailures.join("; ") +
        `. ${resourceNote}. Exact cleanup is ` +
        "deferred until browser evidence has " +
        "been captured.",
      createdJobId,
      createdJobTitle: jobTitle,
      companyId: endpoint.companyId,
      projectId: endpoint.projectId,
      finalUrl: finalUrl.toString(),
      cleanupStatus: "PENDING",
      cleanupNote:
        "Exact cleanup is pending browser " +
        "evidence capture.",
      deferredCleanup,
    };
  }

  return {
    status: "PASS",
    reasonCategory:
      "ASSERTIONS_PASSED",
    note:
      "Created one uniquely named QA draft " +
      "and verified the exact post-creation " +
      "redirect. Exact cleanup is deferred " +
      "until browser evidence has been " +
      `captured. ${resourceNote}.`,
    createdJobId,
    createdJobTitle: jobTitle,
    companyId: endpoint.companyId,
    projectId: endpoint.projectId,
    finalUrl: finalUrl.toString(),
    cleanupStatus: "PENDING",
    cleanupNote:
      "Exact cleanup is pending browser " +
      "evidence capture.",
    deferredCleanup,
  };
}
