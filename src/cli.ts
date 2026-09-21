import "dotenv/config";
import fs from "node:fs";
import { runBrowserCases } from "./agents/browser/run-browser-cases.js";
import { generateTestPlan } from "./planner/plan-from-issue.js";
import { runApiCases } from "./agents/api/run-api-cases.js";
import { writeReport } from "./reporting/write-report.js";
import type { TestPlan } from "./planner/types.js";
import { readExecutionTestPlan } from "./planner/compiled-test-plan.js";
import { discoverAuthenticatedTalentContractCandidates } from "./agents/browser/browser-route-talent-contract.js";
import { buildContractFixtureRequirementContext } from "./agents/browser/fixtures/verified-contract-fixture-state.js";
import { buildHumanResolutionSubmissionFromCandidate, buildTalentContractHumanResolutionCandidates, buildTalentContractHumanResolutionRequest } from "./agents/browser/human-execution-context.js";

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readCurrentPlan(): TestPlan {
  return readExecutionTestPlan().plan;
}

const issueId = getArg("--issue") || getArg("--fixture");

(async () => {
  try {
    if (command === "plan") {
      if (!issueId) {
        console.error("Missing --issue argument. Example:");
        console.error("npm run plan -- --issue AS-1063");
        process.exit(1);
      }

      console.log(`Jira Issue -> ${issueId}`);
      await generateTestPlan(issueId);

    } else if (command === "run") {
      const apiResults = await runApiCases();
      const plan = readCurrentPlan();

      writeReport({
        issueId: issueId || "UNKNOWN",
        plan,
        apiResults,
      });
    } else if (command === "browser") {
        const browserResults = await runBrowserCases();
        const plan = readCurrentPlan();

        writeReport({
          issueId: issueId || "UNKNOWN",
          plan,
          browserResults,
      });
    } else if (command === "smoke") {
      console.log("\nSmoke Test starting...");

      if (command === "smoke") {
        readCurrentPlan();
      }
      const apiResults = await runApiCases();

      const browserResults =
        await runBrowserCases({
          runtimeContexts:
            apiResults.runtimeContexts,
        });

      const plan = readCurrentPlan();

      writeReport({
        issueId: issueId || "UNKNOWN",
        plan,
        apiResults,
        browserResults,
      });
    } else if (command === "rerun-browser-case") {
      const caseId = getArg("--case-id");
      const resolutionContext = getArg("--resolution-context");
      const rerunOf = getArg("--rerun-of");
      const resolutionRequestId = getArg("--resolution-request-id");
      if (!caseId || !resolutionContext || !rerunOf || !resolutionRequestId) {
        console.error("Usage: rerun-browser-case --case-id <id> --resolution-context <file> --rerun-of <artifact> --resolution-request-id <id>");
        process.exit(1);
      }
      process.env.QA_BROWSER_CASE_ID = caseId;
      process.env.QA_HUMAN_RESOLUTION_CONTEXT = resolutionContext;
      process.env.QA_RERUN_OF = rerunOf;
      process.env.QA_HUMAN_RESOLUTION_REQUEST_ID = resolutionRequestId;
      const browserResults = await runBrowserCases();
      const plan = readCurrentPlan();
      writeReport({ issueId: issueId || "UNKNOWN", plan, browserResults });

    } else if (command === "resolve-browser-case") {
      const caseId = getArg("--case-id");
      const selected = getArg("--select");
      const submissionOutput = getArg("--submission-output");
      const planPath = getArg("--plan");
      const rerun = args.includes("--rerun");
      if (!caseId) {
        console.error("Usage: resolve-browser-case --case-id <id> [--plan <saved-plan.json>] [--rescan] [--select <number> --submission-output <file>]");
        process.exit(1);
      }
      const plan = planPath
        ? JSON.parse(fs.readFileSync(planPath, "utf8")) as TestPlan
        : readCurrentPlan();
      const testCase = [...(plan.browserCases ?? []), ...(plan.discoveryBrowserCases ?? [])].find((candidate: any) => candidate?.id === caseId);
      if (!testCase || testCase.persona !== "talent") {
        console.error("This V1 resolver supports an existing Talent Contract browser case only.");
        process.exit(1);
      }
      const requirementContext = buildContractFixtureRequirementContext(testCase);
      if (testCase.runtimeFixturePolicy !== "exact" || requirementContext.requirements.length === 0) {
        console.error("The case has no supported exact Talent Contract fixture requirement.");
        process.exit(1);
      }
      const request = buildTalentContractHumanResolutionRequest({ caseId, fixtureDescription: String(testCase.fixtureRequirements?.join("; ") ?? "exact fixture state") });
      const runtimeDiscovery = await discoverAuthenticatedTalentContractCandidates();
      if (!runtimeDiscovery) {
        console.error("Read-only candidate discovery was unavailable.");
        process.exit(1);
      }
      const view = buildTalentContractHumanResolutionCandidates({ request, requirementContext, candidates: runtimeDiscovery.verifiedCandidates, expectedOwnerId: runtimeDiscovery.talentId });
      console.log(JSON.stringify(view, null, 2));
      if (selected !== undefined) {
        const submission = buildHumanResolutionSubmissionFromCandidate({ discovery: view, candidateIndex: Number(selected) });
        if (!submission || !submissionOutput) {
          console.error("A valid displayed candidate number and --submission-output are required for selection.");
          process.exit(1);
        }
        fs.writeFileSync(submissionOutput, `${JSON.stringify(submission, null, 2)}\n`, "utf8");
        console.log(`Human resolution submission written: ${submissionOutput}`);
        if (rerun) {
          process.env.QA_BROWSER_CASE_ID = caseId;
          process.env.QA_HUMAN_RESOLUTION_CONTEXT = submissionOutput;
          process.env.QA_RERUN_OF = planPath ?? "qa-results/test-plan.json";
          process.env.QA_HUMAN_RESOLUTION_REQUEST_ID = submission.requestId;
          const browserResults = await runBrowserCases(
            planPath ? { planPath } : {}
          );
          writeReport({ issueId: issueId || "UNKNOWN", plan, browserResults });
        }
      }

    } else {
      console.log("invalid command");
    }
  } catch (error) {
  console.error("Error:", error);
  process.exitCode = 1;
}
})();
