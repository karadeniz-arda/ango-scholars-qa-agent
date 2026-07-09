import "dotenv/config";

type GitHubCodeSearchItem = {
  name: string;
  path: string;
  html_url: string;
  url: string;
  repository: {
    full_name: string;
  };
};

type GitHubContentResponse = {
  content?: string;
  encoding?: string;
  path?: string;
};

function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing in .env");
  }

  return token;
}

async function githubGet<T>(urlOrPath: string): Promise<T> {
  const token = getGitHubToken();

  const url = urlOrPath.startsWith("https://")
    ? urlOrPath
    : `https://api.github.com${urlOrPath}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API Error: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json() as Promise<T>;
}

async function searchCode(query: string): Promise<GitHubCodeSearchItem[]> {
  const path = `/search/code?q=${encodeURIComponent(query)}&per_page=10`;

  const data = await githubGet<{
    total_count: number;
    items: GitHubCodeSearchItem[];
  }>(path);

  console.log(`\nSearch: ${query}`);
  console.log(`Found: ${data.total_count}`);

  return data.items;
}

async function fetchFileContent(item: GitHubCodeSearchItem): Promise<string> {
  const data = await githubGet<GitHubContentResponse>(item.url);

  if (!data.content || data.encoding !== "base64") {
    return "";
  }

  return Buffer.from(data.content, "base64").toString("utf8");
}

function printRelevantLines(content: string, keywords: string[]) {
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const matched = keywords.some((keyword) =>
      line!.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!matched) continue;

    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);

    console.log("\n--- Match context ---");

    for (let i = start; i < end; i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }
  }
}

async function main() {
  const repo = "imerit-io/ango-scholars-client";

  const queries = [
  `repo:${repo} "bulkRejectApplications"`,
  `repo:${repo} "Rejection message"`,
  `repo:${repo} "Share feedback to help the applicant understand this decision"`,
  `repo:${repo} "Please provide a rejection message"`,
  `repo:${repo} "Bulk Actions"`,
  `repo:${repo} "Job Applications"`,
  `repo:${repo} "applications" "Reject"`,
  `repo:${repo} "rejectModal"`,
  `repo:${repo} "job applications"`,
  `repo:${repo} "company" "jobs" "applications"`,
];

  const seen = new Set<string>();

  for (const query of queries) {
    const items = await searchCode(query);

    for (const item of items) {
      const key = `${item.repository.full_name}:${item.path}`;

      if (seen.has(key)) continue;
      seen.add(key);

      console.log(`\nFile: ${item.repository.full_name}/${item.path}`);
      console.log(`URL: ${item.html_url}`);

      const content = await fetchFileContent(item);

      printRelevantLines(content, [
        "@Controller",
        "@Post",
        "@Patch",
        "createJob",
        "updateJob",
        "paymentProvider",
        "complianceRequirementIds",
        "JobComplianceRequirementService",
      ]);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});