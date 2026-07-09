import "dotenv/config";
import { getGithubChangeContext } from "../agents/api/githubFetcher.js";

async function main() {
  const issueId = process.argv[2];

  if (!issueId) {
    console.error("Missing issue id. Example:");
    console.error("npx tsx src/scripts/test-github-fetcher.ts AS-1063");
    process.exit(1);
  }

  const context = await getGithubChangeContext(issueId);

  console.log(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});