import { loadFixture } from "./jira/load-fixture.js";

const args = process.argv.slice(2);

const fixtureIndex = args.indexOf("--fixture");

if (fixtureIndex === -1) {
  console.error("Missing --fixture argument");
  process.exit(1);
}

const fixtureId = args[fixtureIndex + 1]!;

const ticket = loadFixture(fixtureId);

console.log(`${ticket.issue.key}: ${ticket.issue.summary}`);