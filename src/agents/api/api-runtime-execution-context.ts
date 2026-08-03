import type {
  RuntimeResourceContext,
} from "../../runtime/runtime-context.js";
import {
  extractItems,
  firstString,
} from "./api-semantic-expectation-evaluator.js";
import type {
  ExecutionContext,
} from "./setup-resolver.js";

export type ApiExecutionContext =
  ExecutionContext &
  RuntimeResourceContext & {
    id?: string | undefined;
  };

export function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/$/, "");
}

function getJobId(job: any): string | undefined {
  return firstString(job?.id, job?.jobId, job?._id);
}

function selectBestJob(jobs: any[]): any | undefined {
  const withId = jobs.filter((job) => getJobId(job));

  if (withId.length === 0) return undefined;

  const preferred = withId.find((job) => {
    const status = String(job?.status || "").toLowerCase();
    const visibility = String(job?.visibility || "").toLowerCase();

    return (
      !["closed", "archived", "deleted"].includes(status) &&
      visibility !== "private"
    );
  });

  return preferred ?? withId[0];
}

async function resolveJobIdFromRuntime(
  apiUrl: string,
  setupToken: string,
  context: ApiExecutionContext
): Promise<string | undefined> {
  if (!context.companyId) return undefined;

  const candidatePaths = [
    context.projectId
      ? `/companies/${context.companyId}/jobs?projectId=${context.projectId}&limit=100&offset=0`
      : undefined,
    `/companies/${context.companyId}/jobs?limit=100&offset=0`,
  ].filter(Boolean) as string[];

  for (const path of candidatePaths) {
    const jobsData = await apiGet(apiUrl, path, setupToken);
    const jobs = extractItems(jobsData);
    const selectedJob = selectBestJob(jobs);
    const jobId = getJobId(selectedJob);

    if (jobId) {
      console.log(`API context resolver selected jobId=${jobId} from ${path}`);
      return jobId;
    }

    console.log(`API context resolver found no usable jobId from ${path}`);
  }

  return undefined;
}

function getAssessmentId(assessment: any): string | undefined {
  return firstString(
    assessment?.id,
    assessment?.assessmentId,
    assessment?._id
  );
}

function getAssessmentLanguages(
  assessment: any
): any[] {
  const candidates = [
    assessment?.languages,
    assessment?.assessment?.languages,
    assessment?.data?.languages,
    assessment?.data?.assessment?.languages,
  ];

  return (
    candidates.find(
      (candidate) =>
        Array.isArray(candidate)
    ) ?? []
  );
}

function selectBestAssessment(
  assessments: any[]
): any | undefined {
  const withId = assessments.filter((assessment) =>
    getAssessmentId(assessment)
  );

  if (withId.length === 0) {
    return undefined;
  }

  const preferred = withId.find((assessment) => {
    const status = String(
      assessment?.status || ""
    ).toLowerCase();

    return !["deleted", "archived"].includes(status);
  });

  return preferred ?? withId[0];
}

async function resolveAssessmentIdFromRuntime(
  apiUrl: string,
  setupToken: string,
  context: ApiExecutionContext
): Promise<string | undefined> {
  if (!context.companyId) {
    return undefined;
  }

  const candidatePaths = [
    `/companies/${context.companyId}/assessments?limit=100&offset=0`,
    `/companies/${context.companyId}/assessments`,
  ];

  for (const path of candidatePaths) {
    const assessmentsData = await apiGet(
      apiUrl,
      path,
      setupToken
    );

    const assessments =
      extractItems(assessmentsData);

    const preferred =
      selectBestAssessment(assessments);

    const orderedAssessments = [
      preferred,
      ...assessments.filter(
        (assessment) =>
          assessment !== preferred
      ),
    ].filter(Boolean);

    const probedIds = new Set<string>();

    for (
      const assessment
      of orderedAssessments
    ) {
      const assessmentId =
        getAssessmentId(assessment);

      if (
        !assessmentId ||
        probedIds.has(assessmentId)
      ) {
        continue;
      }

      probedIds.add(assessmentId);

      const detailPath =
        `/companies/${context.companyId}` +
        `/assessments/${assessmentId}`;

      const detail = await apiGet(
        apiUrl,
        detailPath,
        setupToken
      );

      const languages =
        getAssessmentLanguages(detail);

      console.log(
        `API assessment resolver probed ` +
        `assessmentId=${assessmentId} ` +
        `languages=${languages.length}`
      );

      if (languages.length > 0) {
        console.log(
          `API context resolver selected ` +
          `language-compatible ` +
          `assessmentId=${assessmentId} ` +
          `from ${detailPath}`
        );

        return assessmentId;
      }
    }

    const fallbackId =
      getAssessmentId(preferred);

    if (fallbackId) {
      console.log(
        `API context resolver found no ` +
        `language-compatible assessment; ` +
        `falling back to assessmentId=` +
        `${fallbackId} from ${path}`
      );

      return fallbackId;
    }

    console.log(
      `API context resolver found no usable ` +
      `assessmentId from ${path}`
    );
  }

  return undefined;
}

async function apiGet(
  apiUrl: string,
  path: string,
  token: string
): Promise<any | undefined> {
  const url = `${normalizeBaseUrl(apiUrl)}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    console.log(` API context resolver GET failed ${response.status}: ${path}`);
    return undefined;
  }

  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function firstId(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function extractOwnTalentId(data: any): string | undefined {
  const directId = firstId(
    data?.talentId,
    data?.talent?.id,
    data?.talent?.talentId,
    data?.profile?.talentId,
    data?.profile?.id,
    data?.user?.talentId,
    data?.user?.talent?.id,
    data?.id
  );

  if (directId) {
    return directId;
  }

  const items = extractItems(data);

  for (const item of items) {
    const itemId = firstId(
      item?.talentId,
      item?.talent?.id,
      item?.talent?.talentId,
      item?.profile?.talentId,
      item?.id
    );

    if (itemId) {
      return itemId;
    }
  }

  return undefined;
}

export async function resolveOwnTalentIdFromRuntime(
  apiUrl: string,
  talentToken: string
): Promise<string | undefined> {
  const candidatePaths = [
    "/talents/me",
    "/talent/me",
    "/talents/profile",
    "/talent/profile",
    "/users/me",
    "/auth/me",
    "/me",
  ];

  for (const path of candidatePaths) {
    const data = await apiGet(apiUrl, path, talentToken);
    const talentId = extractOwnTalentId(data);

    if (talentId) {
      console.log(
        `API context resolver selected own talentId=${talentId} from ${path}`
      );
      return talentId;
    }
  }

  console.log(
    "API context resolver could not resolve own talentId for talent persona"
  );

  return undefined;
}

export async function enrichExecutionContext(
  apiUrl: string,
  setupToken: string,
  baseContext: ExecutionContext
): Promise<ApiExecutionContext> {
  const context: ApiExecutionContext = { ...baseContext };

  if (!context.companyId) {
    return context;
  }

  /**
   * Work Setups list resolver.
   * This lets us resolve:
   * - {id}
   * - {workSetupId}
   * - {familyId}
   */
  const workSetupsData = await apiGet(
    apiUrl,
    `/companies/${context.companyId}/work-setups`,
    setupToken
  );

  const firstWorkSetup = extractItems(workSetupsData)[0];

  if (firstWorkSetup) {
    context.workSetupId = firstString(
      firstWorkSetup.id,
      firstWorkSetup.workSetupId,
      firstWorkSetup._id
    );

    context.familyId = firstString(
      firstWorkSetup.familyId,
      firstWorkSetup.family?.id,
      firstWorkSetup.family?.familyId,
      firstWorkSetup.workSetupFamilyId
    );

    context.id = context.workSetupId;

    console.log("API context resolver selected work setup:", {
      workSetupId: context.workSetupId,
      familyId: context.familyId,
    });
  } else {
    console.log("API context resolver did not find any work setup item.");
  }

  /**
   * Company talent work setup progress resolver.
   * This lets us resolve:
   * - {talentJobWorkSetupId}
   * - sometimes {talentId}
   * - sometimes {workSetupId}
   */
  const talentWorkSetupsData = await apiGet(
    apiUrl,
    `/companies/${context.companyId}/talent-job-work-setups`,
    setupToken
  );

  const firstTalentWorkSetup = extractItems(talentWorkSetupsData)[0];

  if (firstTalentWorkSetup) {
    context.talentJobWorkSetupId = firstString(
      firstTalentWorkSetup.id,
      firstTalentWorkSetup.talentJobWorkSetupId,
      firstTalentWorkSetup._id
    );

    context.talentId = firstString(
      firstTalentWorkSetup.talentId,
      firstTalentWorkSetup.talent?.id,
      firstTalentWorkSetup.contract?.talentId,
      firstTalentWorkSetup.talentJob?.talentId,
      context.talentId
    );

    context.workSetupId = firstString(
      context.workSetupId,
      firstTalentWorkSetup.workSetupId,
      firstTalentWorkSetup.workSetup?.id,
      firstTalentWorkSetup.jobWorkSetup?.workSetupId,
      firstTalentWorkSetup.jobWorkSetup?.workSetup?.id
    );

    context.id = context.id ?? context.workSetupId;

    console.log("API context resolver selected talent work setup:", {
      talentJobWorkSetupId: context.talentJobWorkSetupId,
      talentId: context.talentId,
      workSetupId: context.workSetupId,
    });
  } else {
    console.log("API context resolver did not find any talent-job-work-setup item.");
  }

if (!context.jobId) {
  const resolvedJobId =
    await resolveJobIdFromRuntime(
      apiUrl,
      setupToken,
      context
    );

  if (resolvedJobId) {
    context.jobId = resolvedJobId;
  }
}

if (!context.assessmentId) {
  context.assessmentId =
    await resolveAssessmentIdFromRuntime(
      apiUrl,
      setupToken,
      context
    );
}

  return context;
}
