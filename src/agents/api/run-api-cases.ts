import fs from "node:fs";
import yaml from "yaml";
//import { MockAuthProvider } from "../../auth/index.js";
import type { TestPlan } from "../../planner/types.js";

import { getIdTokenForPersona } from "../../auth/firebase.js";

export async function runApiCases() {
  console.log("\nAPI Tests starting..");

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const apiUrl = config.environments.staging.api_url;

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");

  const cleanPlanFile = planFile.replace(/```json/g, "").replace(/```/g, "").trim();
  const plan: TestPlan = JSON.parse(cleanPlanFile);

  const results = [];

  for (const testCase of plan.apiCases) {
    console.log(`Testing: [${testCase.id}] ${testCase.method} ${testCase.path} (Rol: ${testCase.persona})`);
    
    let token = "";
    
    if (testCase.persona !== "unauthenticated"){
      token = await getIdTokenForPersona(testCase.persona);
    }

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json"
    };
    
    if (token !== "") {
      requestHeaders["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${apiUrl}${testCase.path}`, {
        method: testCase.method,
        headers: requestHeaders
      });

      if (response.status === testCase.expect.status) {
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