import process from "node:process";
process.loadEnvFile();
import { loadFixture } from "./jira/load-fixture.js";
import { generateTestPlan } from "./planner/plan-from-fixture.js";

const args = process.argv.slice(2);

const fixtureIndex = args.indexOf("--fixture");

if (fixtureIndex === -1) {
  console.error("Missing --fixture argument");
  process.exit(1);
}

const fixtureId = args[fixtureIndex + 1]!;

const ticket = loadFixture(fixtureId);

console.log(`Ticket: ${ticket.issue.key}: ${ticket.issue.summary}`);
(async () => {
  try {
    await generateTestPlan(fixtureId);
  } catch (error) {
    console.error("Error:", error);
  }
})();