import fs from "node:fs";
import yaml from "yaml";
import { createCustomToken } from "../../auth/firebase.js";

type BrowserPersona = "company_admin" | "talent";
type DesiredJobStatus = "active" | "closed" | "draft";
type BrowserExecutionContext = {
  companyId?: string | undefined;
  projectId?: string | undefined;
  jobs?: any[] | undefined;
};

const executionContextCache = new Map<string, Promise<BrowserExecutionContext>>();

function normalizeBaseUrl(url: string) {
  return String(url || "").replace(/\/$/, "");
}

function getIssueText(plan: any, testCase: any) {
  return [
    plan.issueKey,
    plan.summary,
    plan.notes,
    testCase.goal,
    testCase.successCriteria,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

function needsJobDetailsRoute(issueText: string) {
  return (
    issueText.includes("job details") ||
    issueText.includes("job status") ||
    issueText.includes("job visibility") ||
    issueText.includes("visibility badge") ||
    issueText.includes("status badge")
  );
}

function detectDesiredJobStatus(testCase: any): DesiredJobStatus | undefined {
  const visibleAssertionTexts = Array.isArray(testCase.steps)
    ? testCase.steps
        .filter((step: any) => step.action === "assertTextVisible")
        .map((step: any) => String(step.text || "").toLowerCase())
    : [];

  const hasVisibleClosed = visibleAssertionTexts.some((text:any) => text === "closed");
  const hasVisibleDraft = visibleAssertionTexts.some((text:any) => text === "draft");
  const hasVisibleActive = visibleAssertionTexts.some((text:any) => text === "active");

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
  return getJobId(item) ?? (data?.id !== undefined ? String(data.id) : undefined);
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
    throw new Error(`Firebase signInWithCustomToken failed: ${response.status} ${body}`);
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
  const idToken = await getFirebaseIdToken(persona);
  const projectId = await resolveProjectId(apiUrl, idToken, companyId);
  if (!projectId) {
    return { companyId };
  }
  const jobs = await resolveJobs(apiUrl, idToken, companyId, projectId);
  return { companyId, projectId, jobs };
}

async function getCachedBrowserExecutionContext(
  persona: BrowserPersona
): Promise<BrowserExecutionContext> {
  const companyId = process.env.QA_COMPANY_ID || "unknown";
  const cacheKey = `${persona}:${companyId}`;
  if (!executionContextCache.has(cacheKey)) {
    executionContextCache.set(cacheKey, resolveBrowserExecutionContext(persona));
  }
  return executionContextCache.get(cacheKey)!;
}

export async function resolveBrowserRoute(plan: any, testCase: any): Promise<string> {
  const currentRoute = String(testCase.startRoute || "").trim();
  if (currentRoute && currentRoute.toUpperCase() !== "UNKNOWN") {
    return currentRoute;
  }
  
  const persona = String(testCase.persona || "") as BrowserPersona;
  const issueText = getIssueText(plan, testCase);
  
  if (issueText.includes("payment") || issueText.includes("payments")) {
    if (persona === "company_admin") return "/company/all-payments";
    if (persona === "talent") return "/talent/payments";
  }

  if (
  issueText.includes("project dropdown") ||
  issueText.includes("project select") ||
  issueText.includes("project select issue")
) {
  if (persona === "company_admin") return "/company/all-jobs";

  console.log(
    ` Browser route resolver: project dropdown route for persona=${persona} is not known yet.`
  );

  return "UNKNOWN";
}
  
  const jobDetailsNeeded = needsJobDetailsRoute(issueText);
  if (jobDetailsNeeded) {
    if (persona !== "company_admin") {
      console.log(
        ` Browser route resolver: job details route for persona=${persona} is not known yet.`
      );
      return "UNKNOWN";
    }
    
    const context = await getCachedBrowserExecutionContext(persona);
    const desiredStatus = detectDesiredJobStatus(testCase);
    const job = pickJob(context.jobs ?? [], desiredStatus);
    const jobId = getJobId(job);
    
    if (context.projectId && jobId) {
      const status = getJobStatus(job) || "unknown";
      const visibility = getJobVisibility(job) || "unknown";
      console.log(
        ` Browser route resolver selected jobId=${jobId} status=${status} visibility=${visibility}`
      );
      return `/company/all-jobs/${jobId}?project=${context.projectId}`;
    }
    
    if (desiredStatus) {
      console.log(
        ` Browser route resolver could not resolve a ${desiredStatus} job details route.`
      );
    } else {
      console.log(" Browser route resolver could not resolve projectId/jobId for job details.");
    }
    return "UNKNOWN";
  }
  
  if (
    issueText.includes("jobs") ||
    issueText.includes("all jobs") ||
    issueText.includes("job list")
  ) {
    if (persona === "company_admin") return "/company/all-jobs";
    if (persona === "talent") return "/talent/jobs";
  }
  
  return "UNKNOWN";
}