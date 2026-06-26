import "dotenv/config";
import { runBrowserCases } from "./agents/browser/run-browser-cases.js";
import { loadFixture } from "./jira/load-fixture.js";
import { generateTestPlan } from "./planner/plan-from-fixture.js";
import { runApiCases } from "./agents/api/run-api-cases.js";

const args = process.argv.slice(2);
const command = args[0]; 
const fixtureIndex = args.indexOf("--fixture");

if (fixtureIndex === -1) {
  console.error("Missing --fixture argument");
  process.exit(1);
}

const fixtureId = args[fixtureIndex + 1]!;

(async () => {
  try {
    const ticket = loadFixture(fixtureId);
    console.log(`Ticket -> ${ticket.issue.key}: ${ticket.issue.summary}`);

    if (command === "plan") {
      await generateTestPlan(fixtureId);
    } else if (command === "run") {
      await runApiCases();
    } else if (command === "smoke") {
      console.log("\n Smoke Test starting...");
      await runApiCases();
      await runBrowserCases();
    } else {
      console.log("invalid command");
    }
  } catch (error) {
    console.error("Error:", error);
  }
})();