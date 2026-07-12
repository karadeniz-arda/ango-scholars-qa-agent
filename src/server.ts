import express from "express";
import fs from "node:fs";
import { spawn } from "node:child_process";

type RunMode = "plan" | "api" | "browser" | "smoke";

type QaRunRequest = {
  issueCode?: string;
  mode?: RunMode;
  baseUrl?: string;
  apiUrl?: string;
  skipPlan?: boolean;
};

function normalizeIssueCode(value: unknown): string | undefined {
  if (!value) return undefined;

  const issueCode = String(value).trim().toUpperCase();

  if (!/^[A-Z]+-\d+$/.test(issueCode)) {
    throw new Error(`Invalid issueCode: ${issueCode}`);
  }

  return issueCode;
}

function normalizeMode(value: unknown): RunMode {
  const mode = String(value || "smoke").trim().toLowerCase();

  if (!["plan", "api", "browser", "smoke"].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Use plan, api, browser, or smoke.`);
  }

  return mode as RunMode;
}

function buildEnv(body: QaRunRequest): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };

  if (body.baseUrl) {
    env.QA_BASE_URL = String(body.baseUrl).replace(/\/$/, "");
  }

  if (body.apiUrl) {
    env.QA_API_URL = String(body.apiUrl).replace(/\/$/, "");
  }

  return env;
}

function runNpmScript(
  scriptName: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ command: string; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const command = `npm run ${scriptName} -- ${args.join(" ")}`;

    const child = spawn("npm", ["run", scriptName, "--", ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const result = { command, stdout, stderr };

      if (code === 0) {
        resolve(result);
      } else {
        reject(
          Object.assign(new Error(`Command failed with exit code ${code}: ${command}`), {
            result,
          })
        );
      }
    });
  });
}

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/qa/report", (_req, res) => {
  if (!fs.existsSync("qa-results/report.md")) {
    res.status(404).json({ ok: false, error: "qa-results/report.md not found" });
    return;
  }

  res.type("text/markdown").send(fs.readFileSync("qa-results/report.md", "utf8"));
});

app.post("/qa/run", async (req, res) => {
  const startedAt = new Date().toISOString();

  try {
    const body = req.body as QaRunRequest;

    const issueCode = normalizeIssueCode(body.issueCode);
    const mode = normalizeMode(body.mode);
    const env = buildEnv(body);

    const shouldPlan = Boolean(issueCode) && body.skipPlan !== true;

    if (mode === "plan" && !issueCode) {
      res.status(400).json({
        ok: false,
        error: "issueCode is required when mode is plan.",
      });
      return;
    }

    if (!issueCode && !fs.existsSync("qa-results/test-plan.json")) {
      res.status(400).json({
        ok: false,
        error:
          "issueCode was not provided and qa-results/test-plan.json does not exist. Provide issueCode or create a plan first.",
      });
      return;
    }

    const commands: Array<{ command: string; stdout: string; stderr: string }> = [];

    if (shouldPlan) {
      commands.push(await runNpmScript("plan", ["--issue", issueCode!], env));
    }

    if (mode === "plan") {
      res.json({
        ok: true,
        issueCode,
        mode,
        startedAt,
        finishedAt: new Date().toISOString(),
        reportPath: null,
        commands,
      });
      return;
    }

    const issueArg = issueCode ?? "CURRENT_PLAN";

    if (mode === "api") {
      commands.push(await runNpmScript("run", ["--issue", issueArg], env));
    }

    if (mode === "browser") {
      commands.push(await runNpmScript("browser", ["--issue", issueArg], env));
    }

    if (mode === "smoke") {
      commands.push(await runNpmScript("smoke", ["--issue", issueArg], env));
    }

    res.json({
      ok: true,
      issueCode: issueCode ?? null,
      mode,
      baseUrl: body.baseUrl ?? null,
      apiUrl: body.apiUrl ?? null,
      startedAt,
      finishedAt: new Date().toISOString(),
      reportPath: "qa-results/report.md",
      commands,
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error.message,
      commandResult: error.result ?? null,
    });
  }
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`QA Agent REST API listening on http://localhost:${port}`);
});