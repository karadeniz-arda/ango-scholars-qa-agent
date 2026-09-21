import fs from "node:fs";
import yaml from "yaml";
import { createCustomToken } from "../../auth/firebase.js";
import type {
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";
import {
  detectDesiredJobStatus,
  getCaseText,
} from "./browser-route-semantics.js";
import type {
  BrowserPersona,
  DesiredJobStatus,
} from "./browser-route-semantics.js";

type BrowserExecutionContext =
  RuntimeResourceContext & {
    jobs?: any[] | undefined;
  };

const executionContextCache = new Map<string, Promise<BrowserExecutionContext>>();

function normalizeBaseUrl(url: string) {
  return String(url || "").replace(/\/$/, "");
}

export function extractItems(data: any): any[] {
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

export function pickFirstId(data: any): string | undefined {
  const item = extractItems(data)[0];

  return (
    getJobId(item) ??
    getJobId(data?.data) ??
    getJobId(data)
  );
}

export async function getFirebaseIdToken(persona: BrowserPersona): Promise<string> {
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

export async function apiGet(apiUrl: string, path: string, idToken: string) {
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

export async function getCachedBrowserExecutionContext(
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

export async function resolveJobDetailsRoute(
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
