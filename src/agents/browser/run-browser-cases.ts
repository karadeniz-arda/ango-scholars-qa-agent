import fs from "node:fs";
import yaml from "yaml";
import { Stagehand } from "@browserbasehq/stagehand";
import type { TestPlan } from "../../planner/types.js";

import { createCustomToken } from "../../auth/firebase.js";

export async function runBrowserCases() {
  console.log("\nSmoke Chrome Test starting...");

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const baseUrl = config.environments.staging.url || "https://scholars-staging.ango.ai";

  const planFile = fs.readFileSync("qa-results/test-plan.json", "utf8");
  const cleanPlanFile = planFile.replace(/```json/g, "").replace(/```/g, "").trim();
  const plan: TestPlan = JSON.parse(cleanPlanFile);

  const stagehand = new Stagehand({
    env: "LOCAL", 
  });

  await stagehand.init();

  const results = [];

  
  for (const testCase of plan.browserCases) {
    console.log(`\nTaking photo: [${testCase.id}] - ${testCase.goal}`);


    try {
      const page = stagehand.context.pages()[0]!;

      const customToken = await createCustomToken(testCase.persona);

      await page.goto(`${baseUrl}/account/login`);

      await page.waitForLoadState("networkidle");

      await page.evaluate(
        async ({ customToken, apiKey, authDomain, projectId }) => {
          // @ts-ignore 
          const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js');
          // @ts-ignore
          const { getAuth, signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js');

          const app = initializeApp({ apiKey, authDomain, projectId });
          await signInWithCustomToken(getAuth(app), customToken);
        },
        {
          customToken,
          apiKey: process.env.VITE_FIREBASE_API_KEY!,
          authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
          projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
        }
      );


      const targetUrl = `${baseUrl}${testCase.startRoute}`;
      
      await page.goto(targetUrl);
      await page.waitForTimeout(2000);

      const screenshotPath = `qa-results/${testCase.id}-screenshot.png`;
      const screenshotBuffer = await page.screenshot();
      fs.writeFileSync(screenshotPath, screenshotBuffer);

      console.log(` Screenshot Taken: ${screenshotPath}`);
      
      results.push({
        id: testCase.id,
        status: "DONE",
        evidence: screenshotPath
      });

    } catch (error: any) {
      console.log(` Error: ${error.message}`);
      results.push({
        id: testCase.id,
        status: "ERROR",
        evidence: error.message
      });
    }
  }

  await stagehand.close();
  console.log("\nTests are completed");
  
  return results;
}