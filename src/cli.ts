import "dotenv/config";
import fs from "node:fs";
import { runBrowserCases } from "./agents/browser/run-browser-cases.js";
import { generateTestPlan } from "./planner/plan-from-issue.js";
import { runApiCases } from "./agents/api/run-api-cases.js";
import { writeReport } from "./reporting/write-report.js";
import type { TestPlan } from "./planner/types.js";

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readCurrentPlan(): TestPlan {
  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const cleanPlanFile = planFile
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleanPlanFile);
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

      const apiResults = await runApiCases();
      const browserResults = await runBrowserCases();
      const plan = readCurrentPlan();

      writeReport({
        issueId: issueId || "UNKNOWN",
        plan,
        apiResults,
        browserResults,
      });

    } else {
      console.log("invalid command");
    }
  } catch (error) {
    console.error("Error:", error);
  }
})();