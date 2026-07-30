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

type GitHubBranch = {
  name: string;
  commit: {
    sha: string;
  };
};

type GitHubPullRequest = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  merged_at: string | null;
  updated_at: string;
  base: {
    ref: string;
  };
  head: {
    ref: string;
    sha: string;
  };
};

type GitHubPullSearchItem = {
  number: number;
};

type GitHubPullCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      date?: string | null;
    };
  };
};

type GitHubCompareResult = {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits?: GitHubPullCommit[];
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

async function searchBranchesForIssue(
  issueId: string,
  repo: GitHubRepo
): Promise<GitHubBranch[]> {
  const matches: GitHubBranch[] = [];
  const normalizedIssueId = issueId.toLowerCase();

  for (let page = 1; page <= 10; page += 1) {
    const branches = await githubGet<GitHubBranch[]>(
      `/repos/${repo.owner}/${repo.repo}/branches?per_page=100&page=${page}`
    );

    matches.push(
      ...branches.filter((branch) =>
        branch.name.toLowerCase().includes(normalizedIssueId)
      )
    );

    if (branches.length < 100) {
      break;
    }
  }

  return matches.sort((left, right) => {
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    const normalized = issueId.toLowerCase();

    const score = (name: string) => {
      let value = 0;

      if (name === normalized) value += 100;
      if (name.endsWith(`/${normalized}`)) value += 90;
      if (name.includes(`/${normalized}-`)) value += 80;
      if (name.includes(normalized)) value += 50;
      if (name.includes("improvement")) value += 5;

      return value;
    };

    return (
      score(rightName) - score(leftName) ||
      left.name.localeCompare(right.name)
    );
  });
}

async function getPullRequestsForBranch(
  repo: GitHubRepo,
  branchName: string
): Promise<GitHubPullRequest[]> {
  const head = `${repo.owner}:${branchName}`;

  return githubGet<GitHubPullRequest[]>(
    `/repos/${repo.owner}/${repo.repo}/pulls?state=all&head=${encodeURIComponent(
      head
    )}&per_page=100`
  );
}

async function searchPullRequestsForIssue(
  issueId: string,
  repo: GitHubRepo
): Promise<GitHubPullRequest[]> {
  const query = `${issueId} repo:${repo.fullName} is:pr`;

  const searchResult = await githubGet<{
    items: GitHubPullSearchItem[];
  }>(
    `/search/issues?q=${encodeURIComponent(query)}&per_page=20`
  );

  const pullRequests: GitHubPullRequest[] = [];

  for (const item of searchResult.items) {
    pullRequests.push(
      await githubGet<GitHubPullRequest>(
        `/repos/${repo.owner}/${repo.repo}/pulls/${item.number}`
      )
    );
  }

  return pullRequests;
}

async function getPullRequestFiles(
  repo: GitHubRepo,
  pullNumber: number
): Promise<GitHubCommitFile[]> {
  const files: GitHubCommitFile[] = [];

  for (let page = 1; page <= 3; page += 1) {
    const pageFiles = await githubGet<GitHubCommitFile[]>(
      `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`
    );

    files.push(...pageFiles);

    if (pageFiles.length < 100) {
      break;
    }
  }

  return files;
}

async function getPullRequestCommits(
  repo: GitHubRepo,
  pullNumber: number
): Promise<GitHubPullCommit[]> {
  const commits: GitHubPullCommit[] = [];

  for (let page = 1; page <= 3; page += 1) {
    const pageCommits = await githubGet<GitHubPullCommit[]>(
      `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/commits?per_page=100&page=${page}`
    );

    commits.push(...pageCommits);

    if (pageCommits.length < 100) {
      break;
    }
  }

  return commits;
}

async function compareBranchWithBase(
  repo: GitHubRepo,
  baseBranch: string,
  branchSha: string
): Promise<GitHubCompareResult> {
  return githubGet<GitHubCompareResult>(
    `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(
      baseBranch
    )}...${encodeURIComponent(branchSha)}`
  );
}

export async function getGithubChangeContext(
  issueId: string
): Promise<string> {
  const repos = getReposFromEnv();
  const baseBranch =
    process.env.GITHUB_BASE_BRANCH?.trim() || "staging";

  const sections: string[] = [];
  let foundAnyContext = false;

  sections.push(`--- GITHUB CHANGE CONTEXT ---`);
  sections.push(`Issue key searched in GitHub: ${issueId}`);
  sections.push(
    `Repos: ${repos.map((repo) => repo.fullName).join(", ")}`
  );
  sections.push(`Preferred base branch: ${baseBranch}`);

  for (const repo of repos) {
    sections.push(`\n## Repository: ${repo.fullName}`);

    try {
      const [
        directCommitMatches,
        matchingBranches,
        issuePullRequests,
      ] = await Promise.all([
        searchCommitsForIssue(issueId, repo),
        searchBranchesForIssue(issueId, repo),
        searchPullRequestsForIssue(issueId, repo),
      ]);

      const pullRequestsByNumber =
        new Map<number, GitHubPullRequest>();

      for (const pullRequest of issuePullRequests) {
        pullRequestsByNumber.set(
          pullRequest.number,
          pullRequest
        );
      }

      if (matchingBranches.length > 0) {
        foundAnyContext = true;
        sections.push(`Matching branches:`);

        for (const branch of matchingBranches.slice(0, 5)) {
          sections.push(
            `- ${branch.name} (${branch.commit.sha.slice(0, 8)})`
          );

          try {
            const comparison = await compareBranchWithBase(
              repo,
              baseBranch,
              branch.commit.sha
            );

            sections.push(
              `  Compare ${baseBranch}...${branch.name}: ` +
                `status=${comparison.status}, ` +
                `ahead=${comparison.ahead_by}, ` +
                `behind=${comparison.behind_by}`
            );

            if (
              comparison.ahead_by === 0 &&
              comparison.behind_by > 0
            ) {
              sections.push(
                `  Branch tip is already contained in ${baseBranch}; ` +
                  `the branch was likely merged or superseded. ` +
                  `Pull request files are preferred for change discovery.`
              );
            }
          } catch (error: any) {
            sections.push(
              `  Could not compare branch with ${baseBranch}: ${error.message}`
            );
          }

          try {
            const branchPullRequests =
              await getPullRequestsForBranch(
                repo,
                branch.name
              );

            for (const pullRequest of branchPullRequests) {
              pullRequestsByNumber.set(
                pullRequest.number,
                pullRequest
              );
            }
          } catch (error: any) {
            sections.push(
              `  Could not find pull requests for branch: ${error.message}`
            );
          }
        }
      }

      const pullRequests = Array.from(
        pullRequestsByNumber.values()
      )
        .sort((left, right) => {
          const leftBaseScore =
            left.base.ref === baseBranch ? 1 : 0;

          const rightBaseScore =
            right.base.ref === baseBranch ? 1 : 0;

          if (leftBaseScore !== rightBaseScore) {
            return rightBaseScore - leftBaseScore;
          }

          const leftTime = Date.parse(
            left.merged_at || left.updated_at
          );

          const rightTime = Date.parse(
            right.merged_at || right.updated_at
          );

          return rightTime - leftTime;
        })
        .slice(0, 3);

      const pullRequestCommitShas = new Set<string>();

      for (const pullRequest of pullRequests) {
        foundAnyContext = true;

        const [files, commits] = await Promise.all([
          getPullRequestFiles(repo, pullRequest.number),
          getPullRequestCommits(repo, pullRequest.number),
        ]);

        for (const commit of commits) {
          pullRequestCommitShas.add(commit.sha);
        }

        const effectiveState = pullRequest.merged_at
          ? "merged"
          : pullRequest.state;

        sections.push(
          `\n### Pull Request #${pullRequest.number}: ${pullRequest.title}`
        );
        sections.push(`State: ${effectiveState}`);
        sections.push(
          `Base: ${pullRequest.base.ref} | Head: ${pullRequest.head.ref}`
        );
        sections.push(`URL: ${pullRequest.html_url}`);

        if (pullRequest.merged_at) {
          sections.push(
            `Merged at: ${pullRequest.merged_at}`
          );
        }

        if (commits.length > 0) {
          sections.push(`Commits:`);

          for (const commit of commits.slice(0, 12)) {
            sections.push(
              `- ${commit.sha.slice(0, 8)}: ` +
                `${commit.commit.message.split("\n")[0]}`
            );
          }

          if (commits.length > 12) {
            sections.push(
              `... ${commits.length - 12} more commits omitted.`
            );
          }
        }

        if (files.length === 0) {
          sections.push(
            `Changed files: none returned by GitHub.`
          );
          continue;
        }

        sections.push(`Changed files:`);

        for (const file of files.slice(0, 12)) {
          sections.push(
            `- ${file.status}: ${file.filename} ` +
              `(+${file.additions ?? 0}/-${file.deletions ?? 0})`
          );

          if (file.patch) {
            sections.push(`Patch for ${file.filename}:`);
            sections.push("```diff");
            sections.push(trimText(file.patch, 1800));
            sections.push("```");
          }
        }

        if (files.length > 12) {
          sections.push(
            `... ${files.length - 12} more files omitted.`
          );
        }
      }

      const seenDirectCommitShas = new Set<string>();

      for (const commit of directCommitMatches) {
        if (
          pullRequestCommitShas.has(commit.sha) ||
          seenDirectCommitShas.has(commit.sha)
        ) {
          continue;
        }

        seenDirectCommitShas.add(commit.sha);
        foundAnyContext = true;

        const details = await getCommitDetails(
          repo,
          commit.sha
        );

        sections.push(
          `\n### Direct commit ${details.sha.slice(0, 7)}`
        );
        sections.push(`URL: ${details.html_url}`);
        sections.push(
          `Message:\n${details.commit.message}`
        );

        const files = details.files ?? [];

        if (files.length === 0) {
          sections.push(
            `Changed files: none returned by GitHub.`
          );
          continue;
        }

        sections.push(`Changed files:`);

        for (const file of files.slice(0, 12)) {
          sections.push(
            `- ${file.status}: ${file.filename} ` +
              `(+${file.additions ?? 0}/-${file.deletions ?? 0})`
          );

          if (file.patch) {
            sections.push(`Patch for ${file.filename}:`);
            sections.push("```diff");
            sections.push(trimText(file.patch, 1800));
            sections.push("```");
          }
        }

        if (files.length > 12) {
          sections.push(
            `... ${files.length - 12} more files omitted.`
          );
        }
      }

      if (
        directCommitMatches.length === 0 &&
        matchingBranches.length === 0 &&
        pullRequests.length === 0
      ) {
        sections.push(
          `No commits, matching branches, or pull requests found ` +
            `for ${issueId} in ${repo.fullName}.`
        );
      }
    } catch (error: any) {
      sections.push(
        `GitHub discovery error for ${repo.fullName}: ${error.message}`
      );
    }
  }

  if (!foundAnyContext) {
    sections.push(
      `\nNo GitHub changes could be resolved for ${issueId}.`
    );
  }

  return sections.join("\n");
}
