import fs from "node:fs";
import type { JiraFixture } from "./types.js";

export function loadFixture(fixtureId: string): JiraFixture {
  const filePath = `fixtures/jira/${fixtureId}.json`;

  const rawData = fs.readFileSync(filePath, "utf-8");

  return JSON.parse(rawData);
}