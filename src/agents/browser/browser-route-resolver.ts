import fs from "node:fs";
import yaml from "yaml";
import {
  discoverBrowserRouteCandidates,
  getBestDiscoveredBrowserRoute,
} from "../../discovery/route-candidate-discovery.js";
import { createCustomToken } from "../../auth/firebase.js";
import type {
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";

type BrowserPersona = "company_admin" | "talent";
type DesiredJobStatus =
  | "active"
  | "closed"
  | "draft";

type DesiredTalentContractFixture =
  | "populated-work-setups"
  | "empty-work-setups"
  | "active-or-started"
  | "any";

type TalentContractFixtureState = {
  desiredFixture:
    DesiredTalentContractFixture;
  matchedState: boolean;
  contractCount: number;
  workSetupCount: number;
  populatedContractCount: number;
};

type BrowserExecutionContext =
  RuntimeResourceContext & {
    jobs?: any[] | undefined;
  };

const executionContextCache = new Map<string, Promise<BrowserExecutionContext>>();

const talentContractRouteCache =
  new Map<string, Promise<string | undefined>>();

const talentContractFixtureStateCache =
  new Map<string, TalentContractFixtureState>();

function normalizeBaseUrl(url: string) {
  return String(url || "").replace(/\/$/, "");
}

function isConcreteBrowserRoute(route: string): boolean {
  const normalized = String(route || "").trim();

  if (!normalized || normalized.toUpperCase() === "UNKNOWN") {
    return false;
  }

  if (
    normalized.includes("UNKNOWN") ||
    normalized.includes("{") ||
    normalized.includes("}") ||
    /:[A-Za-z0-9_]+/.test(normalized) ||
    normalized.includes("$")
  ) {
    return false;
  }

  return (
    normalized.startsWith("/company") ||
    normalized.startsWith("/talent") ||
    normalized.startsWith("/admin")
  );
}

function getCaseText(testCase: any) {
  const stepTexts = Array.isArray(testCase.steps)
    ? testCase.steps.map((step: any) => step.text).filter(Boolean).join(" ")
    : "";

  return [testCase.goal, testCase.successCriteria, stepTexts]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getPlanText(plan: any) {
  return [plan.issueKey, plan.summary, plan.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function needsJobDetailsRoute(caseText: string) {
  return (
    caseText.includes("job details") ||
    caseText.includes("hired section") ||
    caseText.includes("hired table") ||
    caseText.includes("applicants") ||
    caseText.includes("review modal") ||
    caseText.includes("pending review") ||
    caseText.includes("approve/reject") ||
    caseText.includes("rejection note") ||
    caseText.includes("job status") ||
    caseText.includes("job visibility") ||
    caseText.includes("visibility badge") ||
    caseText.includes("status badge")
  );
}

function needsJobCreationRoute(
  caseText: string,
  persona: BrowserPersona
) {
  if (persona !== "company_admin") {
    return false;
  }

  const normalized = caseText
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  const directJobCreationIntent =
    [
      "job creation",
      "create job",
      "create a job",
      "creating a job",
      "edit job",
      "editing a job",
      "job creation wizard",
      "job create wizard",
      "job edit wizard",
    ].some((term) =>
      normalized.includes(term)
    ) ||
    (
      normalized.includes("job") &&
      normalized.includes("wizard")
    );

  const projectCreationInsideJobWizard =
    normalized.includes("project selector") &&
    [
      "create project",
      "create a project",
      "creating a project",
      "project creation",
      "newly created project",
    ].some((term) =>
      normalized.includes(term)
    );

  return (
    directJobCreationIntent ||
    projectCreationInsideJobWizard
  );
}

function isDeepTalentContractRoute(caseText: string, persona: BrowserPersona) {
  if (persona !== "talent") return false;

  return (
    caseText.includes("talent contract") ||
    caseText.includes("contract details") ||
    caseText.includes("work setup card") ||
    caseText.includes("submit document") ||
    caseText.includes("pending review") ||
    caseText.includes("rejected") ||
    caseText.includes("reupload") ||
    caseText.includes("no work setups are required")
  );
}

function detectDesiredJobStatus(testCase: any): DesiredJobStatus | undefined {
  const visibleAssertionTexts = Array.isArray(testCase.steps)
    ? testCase.steps
        .filter((step: any) => step.action === "assertTextVisible")
        .map((step: any) => String(step.text || "").toLowerCase())
    : [];

  const hasVisibleClosed = visibleAssertionTexts.some(
    (text: string) => text === "closed"
  );
  const hasVisibleDraft = visibleAssertionTexts.some(
    (text: string) => text === "draft"
  );
  const hasVisibleActive = visibleAssertionTexts.some(
    (text: string) => text === "active"
  );

  if (hasVisibleClosed) return "closed";
  if (hasVisibleDraft) return "draft";
  if (hasVisibleActive) return "active";

  const caseText = getCaseText(testCase);

  if (/\bclosed job\b/.test(caseText)) return "closed";
  if (/\bdraft job\b/.test(caseText)) return "draft";
  if (/\bactive job\b/.test(caseText) || /\bactive public job\b/.test(caseText)) {
    return "active";
  }

  return undefined;
}

function extractItems(data: any): any[] {
  if (!data) return [];

  if (Array.isArray(data)) return data;

  if (data.id !== undefined || data.jobId !== undefined || data._id !== undefined) {
    return [data];
  }

  const possibleArrays = [
    data.items,
    data.results,
    data.data,
    data.projects,
    data.assessments,
    data.contracts,
    data.workSetups,
    data.work_setups,
    data.data?.assessments,
    data.data?.contracts,
    data.data?.workSetups,
    data.data?.work_setups,
    data.jobs,
    data.rows,
    data.data?.items,
    data.data?.results,
    data.data?.jobs,
    data.data?.rows,
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) return arr;
  }

  return [];
}

function getJobId(job: any): string | undefined {
  const id = job?.id ?? job?.jobId ?? job?._id;

  if (id === undefined || id === null) return undefined;

  return String(id);
}

function getJobStatus(job: any): string {
  return String(job?.status ?? job?.jobStatus ?? job?.state ?? "").toLowerCase();
}

function getJobVisibility(job: any): string {
  return String(job?.visibility ?? job?.jobVisibility ?? "").toLowerCase();
}

function jobMatchesDesiredStatus(job: any, desiredStatus: DesiredJobStatus): boolean {
  const status = getJobStatus(job);

  if (desiredStatus === "active") {
    return (
      status === "active" ||
      status.includes("active") ||
      status === "open" ||
      status.includes("open")
    );
  }

  if (desiredStatus === "closed") {
    return status === "closed" || status.includes("closed");
  }

  if (desiredStatus === "draft") {
    return status === "draft" || status.includes("draft");
  }

  return false;
}

function jobIsActiveLike(job: any): boolean {
  const status = getJobStatus(job);

  return (
    status === "active" ||
    status.includes("active") ||
    status === "open" ||
    status.includes("open")
  );
}

function pickJob(jobs: any[], desiredStatus?: DesiredJobStatus): any | undefined {
  const jobsWithId = jobs.filter((job) => getJobId(job));

  if (jobsWithId.length === 0) {
    return undefined;
  }

  if (desiredStatus) {
    const exactStatusMatch = jobsWithId.find((job) =>
      jobMatchesDesiredStatus(job, desiredStatus)
    );

    if (exactStatusMatch) {
      return exactStatusMatch;
    }

    console.log(
      ` Browser route resolver could not find job with status=${desiredStatus}. Available statuses: ${
        [...new Set(jobsWithId.map(getJobStatus).filter(Boolean))].join(", ") ||
        "unknown"
      }`
    );

    return undefined;
  }

  const activePublicJob = jobsWithId.find((job) => {
    const visibility = getJobVisibility(job);

    return (
      jobIsActiveLike(job) &&
      (visibility === "public" || visibility.includes("public"))
    );
  });

  if (activePublicJob) return activePublicJob;

  const activeJob = jobsWithId.find((job) => jobIsActiveLike(job));

  if (activeJob) return activeJob;

  return jobsWithId[0];
}

function pickFirstId(data: any): string | undefined {
  const item = extractItems(data)[0];

  return (
    getJobId(item) ??
    getJobId(data?.data) ??
    getJobId(data)
  );
}

async function getFirebaseIdToken(persona: BrowserPersona): Promise<string> {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing VITE_FIREBASE_API_KEY in env");
  }

  const customToken = await createCustomToken(persona);

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Firebase signInWithCustomToken failed: ${response.status} ${body}`
    );
  }

  const data = await response.json();

  if (!data.idToken) {
    throw new Error("Firebase signInWithCustomToken did not return idToken");
  }

  return data.idToken;
}

async function apiGet(apiUrl: string, path: string, idToken: string) {
  const url = `${normalizeBaseUrl(apiUrl)}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    console.log(` Browser route resolver GET failed ${response.status}: ${path}`);
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getAssessmentId(
  assessment: any
): string | undefined {
  const id =
    assessment?.assessmentId ??
    assessment?.id ??
    assessment?._id;

  if (
    id === undefined ||
    id === null ||
    String(id).trim() === ""
  ) {
    return undefined;
  }

  return String(id);
}

async function resolveAssessmentId(
  apiUrl: string,
  idToken: string,
  companyId: string
): Promise<string | undefined> {
  const candidatePaths = [
    `/companies/${companyId}/assessments?limit=100&offset=0`,
    `/companies/${companyId}/assessments`,
  ];

  for (const path of candidatePaths) {
    const data = await apiGet(
      apiUrl,
      path,
      idToken
    );

    const assessments = extractItems(data);

    const selectedAssessment =
      assessments.find((assessment) => {
        const id = getAssessmentId(assessment);
        const status = String(
          assessment?.status || ""
        ).toLowerCase();

        return (
          Boolean(id) &&
          !["deleted", "archived"].includes(status)
        );
      }) ?? assessments.find(getAssessmentId);

    const assessmentId =
      getAssessmentId(selectedAssessment);

    if (assessmentId) {
      console.log(
        ` Browser route resolver selected assessmentId=${assessmentId} from ${path}`
      );

      return assessmentId;
    }

    console.log(
      ` Browser route resolver found no usable assessmentId from ${path}`
    );
  }

  return undefined;
}

async function resolveProjectId(
  apiUrl: string,
  idToken: string,
  companyId: string
): Promise<string | undefined> {
  const candidates = [
    `/companies/${companyId}/projects?limit=1&offset=0`,
    `/companies/${companyId}/projects`,
    `/projects?companyId=${companyId}&limit=1&offset=0`,
    `/projects?companyId=${companyId}`,
  ];

  for (const path of candidates) {
    const data = await apiGet(apiUrl, path, idToken);
    const id = pickFirstId(data);

    if (id) {
      console.log(` Browser route resolver selected projectId=${id} from ${path}`);
      return id;
    }
  }

  return undefined;
}

async function resolveJobs(
  apiUrl: string,
  idToken: string,
  companyId: string,
  projectId: string
): Promise<any[]> {
  const candidates = [
    `/companies/${companyId}/jobs?projectId=${projectId}&limit=100&offset=0`,
    `/companies/${companyId}/jobs?projectId=${projectId}`,
    `/jobs?companyId=${companyId}&projectId=${projectId}&limit=100&offset=0`,
    `/jobs?companyId=${companyId}&projectId=${projectId}`,
    `/companies/${companyId}/projects/${projectId}/jobs?limit=100&offset=0`,
    `/companies/${companyId}/projects/${projectId}/jobs`,
  ];

  for (const path of candidates) {
    const data = await apiGet(apiUrl, path, idToken);
    const jobs = extractItems(data);

    if (jobs.length > 0) {
      console.log(` Browser route resolver loaded ${jobs.length} job(s) from ${path}`);
      return jobs;
    }
  }

  return [];
}

async function resolveBrowserExecutionContext(
  persona: BrowserPersona
): Promise<BrowserExecutionContext> {
  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);

  const apiUrl = String(
    process.env.QA_API_URL ?? config.environments.staging.api_url
  ).replace(/\/$/, "");

  const companyId = process.env.QA_COMPANY_ID;

  if (!companyId) {
    console.log(" Browser route resolver: QA_COMPANY_ID is missing.");
    return {};
  }

const idToken =
  await getFirebaseIdToken(persona);

const assessmentId =
  await resolveAssessmentId(
    apiUrl,
    idToken,
    companyId
  );

const projectId = await resolveProjectId(
  apiUrl,
  idToken,
  companyId
);

  if (!projectId) {
  return {
    companyId,
    assessmentId,
  };
}

  const jobs = await resolveJobs(apiUrl, idToken, companyId, projectId);

  return {
  companyId,
  projectId,
  assessmentId,
  jobs,
};
}

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

async function resolveTalentContractDetailRoute(
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
      };

    talentContractFixtureStateCache.set(
      cacheKey,
      fixtureState
    );

    applyTalentContractFixtureState(
      testCase,
      fixtureState
    );

    const contractId =
      getContractId(
        selection.selected
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

async function getCachedBrowserExecutionContext(
  persona: BrowserPersona,
  providedContext:
    RuntimeResourceContext = {}
): Promise<BrowserExecutionContext> {
  const companyId =
    providedContext.companyId ||
    process.env.QA_COMPANY_ID ||
    "unknown";

  const cacheKey =
    `${persona}:${companyId}`;

  if (
    !executionContextCache.has(
      cacheKey
    )
  ) {
    executionContextCache.set(
      cacheKey,
      resolveBrowserExecutionContext(
        persona
      )
    );
  }

  const resolvedContext =
    await executionContextCache.get(
      cacheKey
    )!;

  const mergedContext = {
    ...resolvedContext,
    ...providedContext,
  };

  if (
    Object.keys(
      providedContext
    ).length > 0
  ) {
    console.log(
      ` Browser route resolver using API ` +
        `runtime handoff for ${persona}:`,
      providedContext
    );
  }

  return mergedContext;
}

async function resolveJobDetailsRoute(
  testCase: any,
  persona: BrowserPersona
): Promise<string> {
  if (persona !== "company_admin") {
    console.log(
      ` Browser route resolver: job details route for persona=${persona} is not known yet.`
    );

    return "UNKNOWN";
  }

  const context =
    await getCachedBrowserExecutionContext(
      persona,
      testCase
        ?.runtimeResourceContext
    );

  const normalizedJobCaseText =
    getCaseText(testCase)
      .toLowerCase()
      .replace(/[-_]+/g, " ");

  const wantsNonDraftJob =
    normalizedJobCaseText.includes(
      "non draft job"
    ) ||
    normalizedJobCaseText.includes(
      "not in draft"
    ) ||
    normalizedJobCaseText.includes(
      "not draft"
    ) ||
    normalizedJobCaseText.includes(
      "limited to draft jobs"
    );

  const desiredStatus = wantsNonDraftJob
    ? undefined
    : detectDesiredJobStatus(testCase);

  const jobs = context.jobs ?? [];

  const job = wantsNonDraftJob
    ? jobs.find(
        (candidate) =>
          Boolean(getJobId(candidate)) &&
          !jobMatchesDesiredStatus(
            candidate,
            "draft"
          )
      )
    : pickJob(jobs, desiredStatus);

  const jobId =
    getJobId(job) ??
    context.jobId;

  if (context.projectId && jobId) {
    const status =
      getJobStatus(job) ||
      (
        context.jobId === jobId
          ? "api-handoff"
          : "unknown"
      );

    const visibility =
      getJobVisibility(job) ||
      "unknown";

    console.log(
      ` Browser route resolver selected jobId=${jobId} status=${status} visibility=${visibility}`
    );

    return `/company/all-jobs/${jobId}?project=${context.projectId}`;
  }

  if (wantsNonDraftJob) {
    const availableStatuses = [
      ...new Set(
        jobs
          .map(getJobStatus)
          .filter(Boolean)
      ),
    ].join(", ");

    console.log(
      ` Browser route resolver could not resolve a non-draft job details route. ` +
        `Available statuses: ${availableStatuses || "unknown"}`
    );
  } else if (desiredStatus) {
    console.log(
      ` Browser route resolver could not resolve a ${desiredStatus} job details route.`
    );
  } else {
    console.log(
      " Browser route resolver could not resolve projectId/jobId for job details."
    );
  }

  return "UNKNOWN";
}

export async function resolveBrowserRoute(
  plan: any,
  testCase: any
): Promise<string> {
  const currentRoute =
    String(testCase.startRoute || "").trim();

  const persona =
    String(testCase.persona || "") as BrowserPersona;

  const planText = getPlanText(plan);
  const caseText = getCaseText(testCase);

  const normalizedCaseText = caseText
    .toLowerCase()
    .replace(/[-_]+/g, " ");

  if (
    needsJobCreationRoute(
      caseText,
      persona
    )
  ) {
    const mutationStep =
      Array.isArray(testCase?.steps)
        ? testCase.steps.find(
            (step: any) =>
              step?.action ===
              "createDraftJobAndVerifyRedirect"
          )
        : undefined;

    const requestedOrigin =
      mutationStep?.origin === "all-jobs"
        ? "all-jobs"
        : "jobs";

    const creationRoute =
      requestedOrigin === "all-jobs"
        ? "/company/jobs/create?origin=all-jobs"
        : "/company/jobs/create";

    console.log(
      ` Browser route resolver selected job creation route ` +
        `for ${testCase.id}: ` +
        `${currentRoute || "UNKNOWN"} -> ` +
        `${creationRoute} ` +
        `(origin=${requestedOrigin})`
    );

    return creationRoute;
  }

  /*
   * READ_ONLY_JOB_WIZARD_ROUTE_V1
   *
   * Some cases inspect copy or controls inside the
   * job wizard without creating a job. A concrete
   * jobs-list entry route is not sufficient for
   * those cases and may expose a same-named sidebar
   * navigation item.
   *
   * Opening the wizard route is non-mutating. The
   * runner still does not click Save, Create,
   * Publish or any other persistence action.
   */
  const hasDedicatedJobMutationStep =
    Array.isArray(testCase?.steps) &&
    testCase.steps.some(
      (step: any) =>
        step?.action ===
        "createDraftJobAndVerifyRedirect"
    );

  const requiresReadOnlyJobWizardRoute =
    persona === "company_admin" &&
    normalizedCaseText.includes(
      "job wizard"
    ) &&
    !hasDedicatedJobMutationStep;

  if (requiresReadOnlyJobWizardRoute) {
    const readOnlyWizardRoute =
      "/company/jobs/create";

    console.log(
      ` Browser route resolver selected ` +
        `read-only job wizard route for ` +
        `${testCase.id}: ` +
        `${currentRoute || "UNKNOWN"} -> ` +
        `${readOnlyWizardRoute}`
    );

    return readOnlyWizardRoute;
  }

  if (isConcreteBrowserRoute(currentRoute)) {
    return currentRoute;
  }

  const isJobChangeRequestFlow = [
    "job change request",
    "change requests",
    "publish request",
    "field update request",
    "request publish",
    "publish comparison",
  ].some((term) =>
    normalizedCaseText.includes(term)
  );

  /**
   * The word "Assessments" may merely be one field inside
   * a full job comparison. It must not redirect a job
   * change-request case to an assessment details page.
   */
  if (
    normalizedCaseText.includes("assessment") &&
    !isJobChangeRequestFlow
  ) {
  const context =
    await getCachedBrowserExecutionContext(
      persona,
      testCase
        ?.runtimeResourceContext
    );

  if (!context.assessmentId) {
    console.log(
      ` Browser route resolver could not resolve assessmentId for ${testCase.id}.`
    );

    return "UNKNOWN";
  }

  if (persona === "company_admin") {
    return `/company/assessments/${context.assessmentId}`;
  }

  if (persona === "talent") {
    return `/talent/assessments/${context.assessmentId}/prepare`;
  }
}

  /**
   * 1. Deep talent contract flows should NOT be mapped to /talent/jobs.
   * They need a concrete contract detail route and test data.
   */
  if (isDeepTalentContractRoute(caseText, persona)) {
    const contractRoute =
      await resolveTalentContractDetailRoute(
        testCase,
        persona
      );

    if (contractRoute) {
      console.log(
        ` Browser route resolver selected talent contract route ` +
          `for ${testCase.id}: ${contractRoute}`
      );

      return contractRoute;
    }

    console.log(
      ` Browser route resolver could not resolve an accessible ` +
        `talent contract route for ${testCase.id}.`
    );

    return "UNKNOWN";
  }

  /**
   * 2. Job details / hired / applicants / review-modal flows need a real job id.
   */
  /**
   * Change-request comparison/review cases need:
   * - a suitable request fixture;
   * - a specific table row;
   * - nested modal/panel navigation.
   *
   * A generic assessment, jobs or work-setups route
   * must not be guessed for these flows.
   */
  const requiresNestedChangeRequestState = [
    "comparison modal",
    "comparison view",
    "job details comparison",
    "publish comparison",
    "opening a publish request",
    "open a publish request",
    "publish request row",
    "review controls",
    "apply and reject",
    "apply or reject",
    "approve and reject",
    "approve or reject",
    "current and proposed",
    "current versus proposed",
  ].some((term) =>
    normalizedCaseText.includes(term)
  );

  if (requiresNestedChangeRequestState) {
    console.log(
      ` Browser route resolver left ${testCase.id} unresolved: ` +
        `nested change-request state requires a concrete request fixture and row navigation.`
    );

    return "UNKNOWN";
  }

  /**
   * Existing job state cases may be resolved with
   * the runtime job fixture resolver.
   */
  const requiresSpecificJobRoute =
    needsJobDetailsRoute(caseText) ||
    normalizedCaseText.includes("draft job") ||
    normalizedCaseText.includes("non draft job") ||
    normalizedCaseText.includes("active job") ||
    normalizedCaseText.includes("job details page") ||
    normalizedCaseText.includes(
      "job details action area"
    );

  if (requiresSpecificJobRoute) {
    return resolveJobDetailsRoute(
      testCase,
      persona
    );
  }

  /**
   * 3. Let code/context discovery select feature-area routes before broad fallbacks.
   * This is what prevents AS-1165 Work Setups page cases from falling into /company/all-jobs.
   */
  const discoveredRoute = getBestDiscoveredBrowserRoute(plan, testCase);

  if (discoveredRoute) {
    console.log(
      ` Code discovery selected browser route for ${testCase.id}: ${testCase.startRoute} -> ${discoveredRoute.route} (${discoveredRoute.confidence}, ${discoveredRoute.source})`
    );
    console.log(` Route discovery reason: ${discoveredRoute.reason}`);

    return discoveredRoute.route;
  }

  /**
   * 4. Payment fallback.
   */
  if (caseText.includes("payment") || caseText.includes("payments")) {
    if (persona === "company_admin") return "/company/all-payments";
    if (persona === "talent") return "/talent/payments";
  }

  /**
   * 5. Project dropdown fallback.
   */
  if (
    caseText.includes("project dropdown") ||
    caseText.includes("project select") ||
    caseText.includes("project select issue")
  ) {
    if (persona === "company_admin") return "/company/all-jobs";

    console.log(
      ` Browser route resolver: project dropdown route for persona=${persona} is not known yet.`
    );

    return "UNKNOWN";
  }

  /**
   * 6. Broad jobs fallback.
   * Important: this uses caseText, not planText, to avoid AS-1165 plan notes
   * forcing every Work Setups case into /company/all-jobs.
   */
  if (
    caseText.includes("jobs") ||
    caseText.includes("all jobs") ||
    caseText.includes("job list")
  ) {
    if (persona === "company_admin") return "/company/all-jobs";
    if (persona === "talent") return "/talent/jobs";
  }

  /**
   * 7. Last-resort guard for known deep flows.
   */
  if (
    planText.includes("assessment") ||
    caseText.includes("assessment") ||
    caseText.includes("onboarding") ||
    caseText.includes("talent profile") ||
    caseText.includes("talent pool") ||
    caseText.includes("job change request")
  ) {
    console.log(
      ` Browser route resolver: deep/id-dependent route for ${testCase.id} is not known yet.`
    );

    return "UNKNOWN";
  }

  return "UNKNOWN";
}

type RuntimeRouteArea =
  | "assessments"
  | "languages"
  | "skills"
  | "jobs"
  | "work-setups"
  | "payments"
  | "contracts"
  | "offers"
  | "talent-pool"
  | "onboarding"
  | "talent-profile";

function inferRuntimeCaseArea(
  testCase: any
): RuntimeRouteArea | undefined {
  const text = getCaseText(testCase)
    .replace(/[-_]+/g, " ");

  const isChangeRequest =
    text.includes("change request") ||
    text.includes("publish request") ||
    text.includes("field update request") ||
    text.includes("request publish");

  if (isChangeRequest) {
    return "jobs";
  }

  const isJobWizardContext =
    (
      text.includes("job") &&
      text.includes("wizard")
    ) ||
    text.includes("job creation") ||
    text.includes("create job") ||
    text.includes("create a job") ||
    text.includes("edit job") ||
    text.includes("editing a job");

  if (isJobWizardContext) {
    return "jobs";
  }

  const isJobDetailContainer =
    text.includes("job details") ||
    text.includes("job detail") ||
    text.includes("hired area") ||
    text.includes("hired section") ||
    text.includes("hired table") ||
    text.includes("applicants") ||
    text.includes("review modal") ||
    text.includes("job status") ||
    text.includes("job visibility");

  if (isJobDetailContainer) {
    return "jobs";
  }

  if (
    text.includes("payment") ||
    text.includes("invoice") ||
    text.includes("timesheet")
  ) {
    return "payments";
  }

  const isContractDetailContainer =
    text.includes("talent contract") ||
    text.includes("contract details") ||
    text.includes("contract detail") ||
    text.includes("contract page") ||
    text.includes("contract section");

  if (isContractDetailContainer) {
    return "contracts";
  }

  if (
    text.includes("work setup") ||
    text.includes("worksetup")
  ) {
    return "work-setups";
  }

  const isLanguageFeature =
    text.includes("language") ||
    text.includes("proficiency") ||
    text.includes("listening") ||
    text.includes("speaking") ||
    text.includes("writing") ||
    text.includes("reading");

  if (isLanguageFeature) {
    return "languages";
  }

  if (
    text.includes("skill selector") ||
    text.includes("selected skill") ||
    text.includes("skills page") ||
    text.includes("skills taxonomy")
  ) {
    return "skills";
  }

  if (
    text.includes("assessment") &&
    !isChangeRequest
  ) {
    return "assessments";
  }

  const isContractFeature =
    text.includes("talent contract") ||
    text.includes("contract details") ||
    text.includes("contract page") ||
    text.includes("contract section");

  if (isContractFeature) {
    return "contracts";
  }

  if (text.includes("offer")) {
    return "offers";
  }

  if (text.includes("talent pool")) {
    return "talent-pool";
  }

  if (text.includes("onboarding")) {
    return "onboarding";
  }

  if (text.includes("talent profile")) {
    return "talent-profile";
  }

  if (
    text.includes("job") ||
    text.includes("applicant") ||
    text.includes("hired") ||
    isChangeRequest
  ) {
    return "jobs";
  }

  return undefined;
}

function inferRuntimeRouteArea(
  route: string
): RuntimeRouteArea | undefined {
  const normalized =
    String(route || "")
      .split("?")[0]!
      .toLowerCase();

  if (normalized.includes("assessment")) {
    return "assessments";
  }

  if (normalized.includes("work-setup")) {
    return "work-setups";
  }

  if (
    normalized.includes("payment") ||
    normalized.includes("timesheet")
  ) {
    return "payments";
  }

  if (normalized.includes("skill")) {
    return "skills";
  }

  if (normalized.includes("contract")) {
    return "contracts";
  }

  if (normalized.includes("offer")) {
    return "offers";
  }

  if (normalized.includes("talent-pool")) {
    return "talent-pool";
  }

  if (normalized.includes("onboarding")) {
    return "onboarding";
  }

  if (normalized.includes("profile")) {
    return "talent-profile";
  }

  if (normalized.includes("job")) {
    return "jobs";
  }

  return undefined;
}

function areRuntimeRouteAreasCompatible(
  wantedArea: RuntimeRouteArea,
  routeArea: RuntimeRouteArea
): boolean {
  if (wantedArea === routeArea) {
    return true;
  }

  if (wantedArea === "languages") {
    return new Set<RuntimeRouteArea>([
      "talent-profile",
      "onboarding",
      "assessments",
    ]).has(routeArea);
  }

  return false;
}

/**
 * Returns up to three ranked routes for live browser probing.
 *
 * Ranking uses the current route, special runtime fixture
 * resolution and all codebase/catalog discovery candidates.
 * Feature-area agreement is more important than the original
 * confidence label.
 */
export async function resolveBrowserRouteCandidates(
  plan: any,
  testCase: any,
  limit = 3
): Promise<string[]> {
  const wantedArea =
    inferRuntimeCaseArea(testCase);

  const ranked = new Map<
    string,
    {
      route: string;
      score: number;
      reason: string;
    }
  >();

  const addCandidate = (
    routeValue: unknown,
    baseScore: number,
    reason: string
  ) => {
    const route =
      String(routeValue || "").trim();

    if (!isConcreteBrowserRoute(route)) {
      return;
    }

    const routeArea =
      inferRuntimeRouteArea(route);

    let score = baseScore;

    if (
      wantedArea &&
      routeArea &&
      areRuntimeRouteAreasCompatible(
        wantedArea,
        routeArea
      )
    ) {
      score += 100;
    } else if (
      wantedArea &&
      routeArea
    ) {
      score -= 100;
    }

    const existing = ranked.get(route);

    if (
      !existing ||
      score > existing.score
    ) {
      ranked.set(route, {
        route,
        score,
        reason,
      });
    }
  };

  addCandidate(
    testCase?.startRoute,
    25,
    "planner-current-route"
  );

  /*
   * Run existing dynamic fixture resolution using a cloned
   * UNKNOWN route so a planner-selected route cannot short
   * circuit runtime job/assessment resolution.
   */
  const runtimeResolutionCase = {
    ...testCase,
    startRoute: "UNKNOWN",
  };

  const runtimeResolvedRoute =
    await resolveBrowserRoute(
      plan,
      runtimeResolutionCase
    );

  const runtimeFixtureResolutionFailure =
    String(
      runtimeResolutionCase
        .runtimeFixtureResolutionFailure ??
        ""
    ).trim();

  if (runtimeFixtureResolutionFailure) {
    testCase.runtimeFixtureResolutionFailure =
      runtimeFixtureResolutionFailure;
  } else {
    delete testCase
      .runtimeFixtureResolutionFailure;
  }

  addCandidate(
    runtimeResolvedRoute,
    70,
    "runtime-fixture-resolver"
  );

  for (
    const candidate of
    discoverBrowserRouteCandidates(
      plan,
      testCase
    )
  ) {
    const confidenceScore =
      candidate.confidence === "high"
        ? 60
        : candidate.confidence === "medium"
          ? 40
          : 10;

    addCandidate(
      candidate.route,
      confidenceScore,
      `${candidate.source}: ${candidate.reason}`
    );
  }

  const selected = [...ranked.values()]
    .sort(
      (left, right) =>
        right.score - left.score
    )
    .slice(0, Math.max(1, limit));

  console.log(
    ` Runtime route candidates for ` +
      `${testCase?.id ?? "case"}: ` +
      (
        selected
          .map(
            (candidate) =>
              `${candidate.route}(${candidate.score})`
          )
          .join(", ") ||
        "none"
      )
  );

  return selected.map(
    (candidate) => candidate.route
  );
}
