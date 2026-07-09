export type ExecutionContext = {
  companyId?: string;
  projectId?: string;
  jobId?: string;
};

async function fetchMaybeJson(url: string, token: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.log(` Setup resolver skipped ${url} -> ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error: any) {
    console.log(` Setup resolver error for ${url}: ${error.message}`);
    return null;
  }
}

function pickFirstId(data: any): string | undefined {
  if (!data) return undefined;

  if (typeof data.id === "number" || typeof data.id === "string") {
    return String(data.id);
  }

  const candidateArrays = [
    data.items,
    data.results,
    data.data,
    data.projects,
    Array.isArray(data) ? data : undefined,
  ];

  for (const array of candidateArrays) {
    if (!Array.isArray(array)) continue;

    const first = array[0];

    if (!first) continue;

    if (typeof first.id === "number" || typeof first.id === "string") {
      return String(first.id);
    }

    if (typeof first._id === "number" || typeof first._id === "string") {
      return String(first._id);
    }
  }

  return undefined;
}

async function resolveProjectId(
  apiUrl: string,
  token: string,
  companyId: string
): Promise<string | undefined> {
  const candidatePaths = [
    `/companies/${companyId}/projects?limit=1&offset=0`,
    `/companies/${companyId}/projects`,
    `/projects?companyId=${companyId}&limit=1&offset=0`,
    `/projects?companyId=${companyId}`,
  ];

  for (const path of candidatePaths) {
    const url = `${apiUrl}${path}`;
    const data = await fetchMaybeJson(url, token);
    const id = pickFirstId(data);

    if (id) {
      console.log(` Setup resolver selected projectId=${id} from ${path}`);
      return id;
    }
  }

  console.log(" Setup resolver could not resolve projectId from API.");
  return undefined;
}

export async function resolveExecutionContext(
  apiUrl: string,
  companyAdminToken: string
): Promise<ExecutionContext> {
  const context: ExecutionContext = {};

  const companyId = process.env.QA_COMPANY_ID;

  if (!companyId) {
    console.log(" Setup resolver: QA_COMPANY_ID is missing.");
    return context;
  }

  context.companyId = companyId;

  const projectId = await resolveProjectId(apiUrl, companyAdminToken, companyId);

  if (projectId) {
    context.projectId = projectId;
  }

  return context;
}