import "dotenv/config";
import fs from "node:fs";
import yaml from "yaml";
import { chromium } from "playwright";
import { createCustomToken } from "../auth/firebase.js";

type Persona = "company_admin" | "talent";

async function main() {
  const persona = (process.argv[2] || "company_admin") as Persona;
  const route = process.argv[3] || "/";

  if (!["company_admin", "talent"].includes(persona)) {
    throw new Error("Persona must be company_admin or talent");
  }

  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);

  const baseUrl = String(config.environments.staging.url).replace(/\/$/, "");

  const customToken = await createCustomToken(persona);

  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await page.goto(`${baseUrl}/account/login`);
  await page.waitForLoadState("networkidle");

  await page.evaluate(
    async ({ customToken, apiKey, authDomain, projectId }) => {
      // @ts-ignore
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"!
      );

      // @ts-ignore
      const { getAuth, signInWithCustomToken } = await import(
        "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"!
      );

      const app = initializeApp({
        apiKey,
        authDomain,
        projectId,
      });

      await signInWithCustomToken(getAuth(app), customToken);
    },
    {
      customToken,
      apiKey: process.env.VITE_FIREBASE_API_KEY!,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
    }
  );

  await page.goto(`${baseUrl}${route}`);
  await page.waitForLoadState("networkidle");

  console.log(`Logged in as ${persona}.`);
  console.log(`Opened: ${baseUrl}${route}`);
  console.log("Browser will stay open for 15 minutes.");

  await page.waitForTimeout(15 * 60 * 1000);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});