import fs from "node:fs";
import yaml from "yaml";
import { MockAuthProvider } from "../../auth/index.js";
import type { TestPlan } from "../../planner/types.js";

export async function runApiCases() {
  console.log("\n🚀 API Tests starting..");

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const apiUrl = config.environments.staging.api_url;

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");

  const cleanPlanFile = planFile.replace(/```json/g, "").replace(/```/g, "").trim();
  const plan: TestPlan = JSON.parse(cleanPlanFile);

  const auth = new MockAuthProvider();
  const results = [];

  for (const testCase of plan.apiCases) {
    console.log(`Test ediliyor: [${testCase.id}] ${testCase.method} ${testCase.path} (Rol: ${testCase.persona})`);
    
    const token = await auth.getIdToken(testCase.persona);

    try {
      const response = await fetch(`${apiUrl}${testCase.path}`, {
        method: testCase.method,
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      if (response.status === 401 || response.status === 403) {
        results.push({
          id: testCase.id,
          status: "BLOCKED",
          notes: `${response.status} — no real login yet`
        });
        console.log(` Result: BLOCKED (${response.status} authocentation problem)`);
      } else if (response.status === testCase.expect.status) {
        results.push({ id: testCase.id, status: "PASS", notes: "" });
        console.log(` Result : PASS`);
      } else {
        results.push({ id: testCase.id, status: "FAIL", notes: `Expected: ${testCase.expect.status}, Given: ${response.status}` });
        console.log(` Result: FAIL (Expected: ${testCase.expect.status}, Given: ${response.status})`);
      }

    } catch (error: any) {
      results.push({ id: testCase.id, status: "FAIL", notes: `Cannot connect to server: ${error.message}` });
      console.log(` Result: FAIL (Connection Problem)`);
    }
  }

  return results;
}