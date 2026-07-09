import "dotenv/config";
import fs from "node:fs";
import yaml from "yaml";
import { getIdTokenForPersona } from "../auth/firebase.js";

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(normalized, "base64").toString("utf8");

  return JSON.parse(json);
}

async function fetchJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();

  console.log(`\nGET ${url}`);
  console.log(`Status: ${response.status}`);

  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
}

async function main() {
  const envFile = fs.readFileSync("config/environments.yaml", "utf8");
  const config = yaml.parse(envFile);
  const apiUrl = String(config.environments.staging.api_url).replace(/\/$/, "");

  const token = await getIdTokenForPersona("company_admin");

  console.log("\nDecoded Firebase ID token payload:");
  console.log(JSON.stringify(decodeJwtPayload(token), null, 2));

  const candidateEndpoints = [
    "/auth/me",
    "/me",
    "/users/me",
    "/companies/me",
    "/company/me",
    "/companies",
  ];

  for (const path of candidateEndpoints) {
    await fetchJson(`${apiUrl}${path}`, token).catch((error) => {
      console.log(`\nGET ${apiUrl}${path}`);
      console.log(`Error: ${error.message}`);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});