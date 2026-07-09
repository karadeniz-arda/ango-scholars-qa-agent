import "dotenv/config";

type GitHubRepo = {
  owner: string;
  repo: string;
  fullName: string;
};

type GitHubCommitSearchItem = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      date?: string;
    };
  };
  repository?: {
    full_name: string;
  };
};

type GitHubCommitFile = {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
};

type GitHubCommitDetails = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
  };
  files?: GitHubCommitFile[];
};

function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is missing in .env");
  }

  return token;
}

function getReposFromEnv(): GitHubRepo[] {
  const rawRepos = process.env.GITHUB_REPOS;

  if (!rawRepos) {
    throw new Error("GITHUB_REPOS is missing in .env");
  }

  return rawRepos.split(",").map((item) => {
    const fullName = item.trim();
    const [owner, repo] = fullName.split("/");

    if (!owner || !repo) {
      throw new Error(`Invalid repo format in GITHUB_REPOS: ${fullName}`);
    }

    return {
      owner,
      repo,
      fullName,
    };
  });
}

async function githubGet<T>(path: string): Promise<T> {
  const token = getGitHubToken();

  const response = await fetch(`https://api.github.com${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
  const body = await response.text();

  if (response.status === 401) {
    throw new Error(
      `GitHub API Error: 401 Unauthorized. Check GITHUB_TOKEN in .env.`
    );
  }

  if (response.status === 403) {
    throw new Error(
      `GitHub API Error: 403 Forbidden. The token may be pending approval, missing SSO authorization, or missing repository permissions.`
    );
  }

  if (response.status === 404) {
    throw new Error(
      `GitHub API Error: 404 Not Found. The repository may be private, misspelled, or not accessible by this token.`
    );
  }

  if (response.status === 422 && body.includes("cannot be searched")) {
    throw new Error(
      `GitHub API Error: 422. The selected repositories cannot be searched. This usually means the token cannot access the org repos yet, often because fine-grained PAT approval is still pending.`
    );
  }

  throw new Error(
    `GitHub API Error: ${response.status} ${response.statusText}\n${body}`
  );
}

  return response.json() as Promise<T>;
}

function trimText(text: string, maxLength = 2500): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... [trimmed]`;
}

async function searchCommitsForIssue(issueId: string, repo: GitHubRepo) {
  const query = `${issueId} repo:${repo.fullName}`;
  const path = `/search/commits?q=${encodeURIComponent(query)}&per_page=10`;

  const data = await githubGet<{
    total_count: number;
    items: GitHubCommitSearchItem[];
  }>(path);

  return data.items;
}

async function getCommitDetails(repo: GitHubRepo, sha: string) {
  return githubGet<GitHubCommitDetails>(
    `/repos/${repo.owner}/${repo.repo}/commits/${sha}`
  );
}

export async function getGithubChangeContext(issueId: string): Promise<string> {
  const repos = getReposFromEnv();

  const sections: string[] = [];

  sections.push(`--- GITHUB CHANGE CONTEXT ---`);
  sections.push(`Issue key searched in GitHub: ${issueId}`);
  sections.push(`Repos: ${repos.map((repo) => repo.fullName).join(", ")}`);

  for (const repo of repos) {
    sections.push(`\n## Repository: ${repo.fullName}`);

    const commits = await searchCommitsForIssue(issueId, repo);

    if (commits.length === 0) {
      sections.push(`No commits found for ${issueId} in ${repo.fullName}.`);
      continue;
    }

    for (const commit of commits) {
      const details = await getCommitDetails(repo, commit.sha);

      sections.push(`\n### Commit ${details.sha.slice(0, 7)}`);
      sections.push(`URL: ${details.html_url}`);
      sections.push(`Message:\n${details.commit.message}`);

      const files = details.files ?? [];

      if (files.length === 0) {
        sections.push(`Changed files: none returned by GitHub.`);
        continue;
      }

      sections.push(`Changed files:`);

      for (const file of files.slice(0, 12)) {
        sections.push(
          `- ${file.status}: ${file.filename} (+${file.additions ?? 0}/-${file.deletions ?? 0})`
        );

        if (file.patch) {
          sections.push(`Patch for ${file.filename}:`);
          sections.push("```diff");
          sections.push(trimText(file.patch));
          sections.push("```");
        }
      }

      if (files.length > 12) {
        sections.push(`... ${files.length - 12} more files omitted.`);
      }
    }
  }

  return sections.join("\n");
}