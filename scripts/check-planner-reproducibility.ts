import fs from "node:fs";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";

type JsonRecord =
  Record<string, any>;

const ACTIVE_PLAN =
  "qa-results/test-plan.json";

const API_PERSONAS =
  new Set([
    "talent",
    "company_admin",
    "unauthenticated",
  ]);

const BROWSER_PERSONAS =
  new Set([
    "talent",
    "company_admin",
  ]);

const API_METHODS =
  new Set([
    "GET",
    "POST",
    "PATCH",
    "DELETE",
  ]);

const BROWSER_ACTIONS =
  new Set([
    "wait",
    "reload",
    "setViewport",
    "clickTopTab",
    "selectRuntimeTopTab",
    "selectRuntimeFilterOption",
    "createDraftJobAndVerifyRedirect",
    "clickButton",
    "clickText",
    "openMenu",
    "selectOption",
    "assertUrlContains",
    "assertUrlNotContains",
    "assertTextVisible",
    "assertTextNotVisible",
  ]);

const TEXT_ACTIONS =
  new Set([
    "clickTopTab",
    "clickButton",
    "clickText",
    "openMenu",
    "selectOption",
    "assertUrlContains",
    "assertUrlNotContains",
    "assertTextVisible",
    "assertTextNotVisible",
  ]);

const DIRECT_MUTATION_TEXT =
  /^(reject|delete|submit|send|approve|archive|invite|remove|save draft|publish|create)$/i;

function getArg(
  name: string
): string | undefined {
  const args =
    process.argv.slice(2);

  const index =
    args.indexOf(name);

  return index >= 0
    ? args[index + 1]
    : undefined;
}

function cleanJson(
  value: string
): string {
  return value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function normalizeText(
  value: unknown
): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeResource(
  value: unknown
): string {
  const raw =
    String(value ?? "")
      .trim()
      .toLowerCase();

  const [
    rawBase = "",
    rawQuery = "",
  ] = raw.split("?", 2);

  const base = rawBase
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "{id}"
    )
    .replace(
      /\/\d+(?=\/|$)/g,
      "/{id}"
    )
    .replace(/\/+/g, "/");

  if (!rawQuery) {
    return base;
  }

  const queryKeys =
    rawQuery
      .split("&")
      .map(
        (part) =>
          part.split("=", 1)[0] ?? ""
      )
      .map(normalizeText)
      .filter(Boolean)
      .sort();

  if (queryKeys.length === 0) {
    return base;
  }

  return (
    `${base}?` +
    queryKeys
      .map((key) => `${key}=*`)
      .join("&")
  );
}

function validatePlan(
  plan: JsonRecord,
  issue: string,
  label: string
): string[] {
  const errors: string[] = [];

  if (
    String(plan.issueKey || "")
      .toUpperCase() !== issue
  ) {
    errors.push(
      `${label}: issueKey mismatch`
    );
  }

  if (
    !String(plan.summary || "").trim()
  ) {
    errors.push(
      `${label}: summary is empty`
    );
  }

  const apiCases =
    Array.isArray(plan.apiCases)
      ? plan.apiCases
      : [];

  const browserCases =
    Array.isArray(plan.browserCases)
      ? plan.browserCases
      : [];

  if (!Array.isArray(plan.apiCases)) {
    errors.push(
      `${label}: apiCases is not an array`
    );
  }

  if (
    !Array.isArray(plan.browserCases)
  ) {
    errors.push(
      `${label}: browserCases is not an array`
    );
  }

  if (apiCases.length > 4) {
    errors.push(
      `${label}: API case budget exceeded`
    );
  }

  if (browserCases.length > 4) {
    errors.push(
      `${label}: browser case budget exceeded`
    );
  }

  const total =
    apiCases.length +
    browserCases.length;

  if (total < 1 || total > 8) {
    errors.push(
      `${label}: total case count ` +
      `${total} is outside 1..8`
    );
  }

  const apiIds =
    new Set<string>();

  apiCases.forEach(
    (
      testCase: JsonRecord,
      index: number
    ) => {
      const location =
        `${label}.apiCases[${index}]`;

      const id =
        String(testCase.id || "");

      if (!/^api-\d+$/.test(id)) {
        errors.push(
          `${location}: invalid id "${id}"`
        );
      }

      if (apiIds.has(id)) {
        errors.push(
          `${location}: duplicate id "${id}"`
        );
      }

      apiIds.add(id);

      if (
        !API_PERSONAS.has(
          testCase.persona
        )
      ) {
        errors.push(
          `${location}: unsupported persona`
        );
      }

      if (
        !API_METHODS.has(
          testCase.method
        )
      ) {
        errors.push(
          `${location}: unsupported method`
        );
      }

      if (
        !String(testCase.path || "")
          .trim()
      ) {
        errors.push(
          `${location}: empty path`
        );
      }

      if (
        typeof testCase.expect?.status !==
        "number"
      ) {
        errors.push(
          `${location}: invalid expect.status`
        );
      }
    }
  );

  const browserIds =
    new Set<string>();

  browserCases.forEach(
    (
      testCase: JsonRecord,
      index: number
    ) => {
      const location =
        `${label}.browserCases[${index}]`;

      const id =
        String(testCase.id || "");

      if (!/^web-\d+$/.test(id)) {
        errors.push(
          `${location}: invalid id "${id}"`
        );
      }

      if (browserIds.has(id)) {
        errors.push(
          `${location}: duplicate id "${id}"`
        );
      }

      browserIds.add(id);

      if (
        !BROWSER_PERSONAS.has(
          testCase.persona
        )
      ) {
        errors.push(
          `${location}: unsupported persona`
        );
      }

      if (
        ![
          "exact",
          "compatible-state",
        ].includes(
          testCase.runtimeFixturePolicy
        )
      ) {
        errors.push(
          `${location}: invalid ` +
          `runtimeFixturePolicy`
        );
      }

      if (
        !String(testCase.goal || "")
          .trim()
      ) {
        errors.push(
          `${location}: empty goal`
        );
      }

      if (
        !String(
          testCase.successCriteria || ""
        ).trim()
      ) {
        errors.push(
          `${location}: empty successCriteria`
        );
      }

      if (
        !String(
          testCase.startRoute || ""
        ).trim()
      ) {
        errors.push(
          `${location}: empty startRoute`
        );
      }

      const steps =
        Array.isArray(testCase.steps)
          ? testCase.steps
          : [];

      if (steps.length === 0) {
        errors.push(
          `${location}: empty steps`
        );
      }

      steps.forEach(
        (
          step: JsonRecord,
          stepIndex: number
        ) => {
          const stepLocation =
            `${location}.steps[` +
            `${stepIndex}]`;

          const action =
            String(step.action || "");

          if (
            !BROWSER_ACTIONS.has(action)
          ) {
            errors.push(
              `${stepLocation}: unsupported ` +
              `action "${action}"`
            );

            return;
          }

          if (
            TEXT_ACTIONS.has(action) &&
            !String(step.text || "")
              .trim()
          ) {
            errors.push(
              `${stepLocation}: empty text`
            );
          }

          if (
            [
              "clickButton",
              "clickText",
              "selectOption",
            ].includes(action) &&
            DIRECT_MUTATION_TEXT.test(
              String(step.text || "")
                .trim()
            )
          ) {
            errors.push(
              `${stepLocation}: unsafe direct ` +
              `mutation "${step.text}"`
            );
          }

          if (
            action ===
              "selectRuntimeFilterOption" &&
            !String(
              step.queryKey || ""
            ).trim()
          ) {
            errors.push(
              `${stepLocation}: empty queryKey`
            );
          }

          if (
            action ===
              "createDraftJobAndVerifyRedirect" &&
            ![
              "jobs",
              "all-jobs",
            ].includes(step.origin)
          ) {
            errors.push(
              `${stepLocation}: invalid origin`
            );
          }
        }
      );
    }
  );

  return errors;
}

function fingerprint(
  plan: JsonRecord
): JsonRecord {
  const apiCases =
    Array.isArray(plan.apiCases)
      ? plan.apiCases
      : [];

  const browserCases =
    Array.isArray(plan.browserCases)
      ? plan.browserCases
      : [];

  const api =
    apiCases
      .map(
        (testCase: JsonRecord) =>
          [
            testCase.persona,
            testCase.method,
            normalizeResource(
              testCase.path
            ),
            testCase.expect?.status,
          ].join("|")
      )
      .sort();

  const browser =
    browserCases
      .map(
        (testCase: JsonRecord) => {
          const steps =
            Array.isArray(
              testCase.steps
            )
              ? testCase.steps
              : [];

          const actions =
            steps
              .map(
                (step: JsonRecord) =>
                  String(
                    step.action || ""
                  )
              )
              .sort();

          return [
            testCase.persona,
            testCase
              .runtimeFixturePolicy,
            normalizeResource(
              testCase.startRoute
            ),
            actions.join(","),
          ].join("|");
        }
      )
      .sort();

  const serialized =
    JSON.stringify(plan);

  return {
    api,
    browser,
    unknownCount:
      serialized.match(
        /\bUNKNOWN\b/g
      )?.length ?? 0,
    placeholderCount:
      serialized.match(
        /\{[A-Za-z][A-Za-z0-9]*\}/g
      )?.length ?? 0,
  };
}

function runPlanner(
  issue: string
): void {
  const result =
    spawnSync(
      "npm",
      [
        "run",
        "plan",
        "--",
        "--issue",
        issue,
      ],
      {
        stdio: "inherit",
        env: process.env,
      }
    );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Planner exited with status ` +
      `${result.status}`
    );
  }

  if (!fs.existsSync(ACTIVE_PLAN)) {
    throw new Error(
      `${ACTIVE_PLAN} was not created`
    );
  }
}

function readPlan(): JsonRecord {
  return JSON.parse(
    cleanJson(
      fs.readFileSync(
        ACTIVE_PLAN,
        "utf8"
      )
    )
  );
}

function main(): void {
  const issueArgument =
    getArg("--issue");

  if (!issueArgument) {
    throw new Error(
      "Missing --issue argument"
    );
  }

  if (
    !/^[A-Z][A-Z0-9]+-\d+$/i.test(
      issueArgument
    )
  ) {
    throw new Error(
      `Invalid issue key ` +
      `"${issueArgument}"`
    );
  }

  const issue =
    issueArgument.toUpperCase();

  const stamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  const resultDirectory =
    path.join(
      "qa-results",
      "planner-reproducibility",
      `${issue}-${stamp}`
    );

  fs.mkdirSync(
    resultDirectory,
    {
      recursive: true,
    }
  );

  const hadActivePlan =
    fs.existsSync(ACTIVE_PLAN);

  const activePlanBackup =
    hadActivePlan
      ? fs.readFileSync(ACTIVE_PLAN)
      : null;

  const fingerprints:
    JsonRecord[] = [];

  try {
    for (
      let runIndex = 1;
      runIndex <= 2;
      runIndex += 1
    ) {
      console.log(
        `\n===== PLANNER RUN ` +
        `${runIndex}/2 =====`
      );

      runPlanner(issue);

      const plan =
        readPlan();

      const errors =
        validatePlan(
          plan,
          issue,
          `run-${runIndex}`
        );

      if (errors.length > 0) {
        throw new Error(
          errors
            .map(
              (error) =>
                ` - ${error}`
            )
            .join("\n")
        );
      }

      const snapshotPath =
        path.join(
          resultDirectory,
          `plan-${runIndex}.json`
        );

      fs.copyFileSync(
        ACTIVE_PLAN,
        snapshotPath
      );

      fingerprints.push(
        fingerprint(plan)
      );

      console.log(
        ` Planner run ${runIndex} ` +
        `contract: PASS`
      );
    }

    const first =
      fingerprints[0];

    const second =
      fingerprints[1];

    if (!first || !second) {
      throw new Error(
        "Planner fingerprints missing"
      );
    }

    fs.writeFileSync(
      path.join(
        resultDirectory,
        "fingerprints.json"
      ),
      JSON.stringify(
        {
          issueKey: issue,
          first,
          second,
        },
        null,
        2
      ) + "\n"
    );

    console.log(
      "\n===== REPRODUCIBILITY RESULT ====="
    );

    console.log(
      "Planner contract validation: " +
      "2/2 PASS"
    );

    if (
      JSON.stringify(first) !==
      JSON.stringify(second)
    ) {
      console.log(
        "Planner structural signatures: DRIFT"
      );

      console.log(
        "PLANNER_REPRODUCIBILITY_DRIFT"
      );

      console.log(
        `Result folder: ` +
        `${resultDirectory}`
      );

      return;
    }

    console.log(
      "Planner structural signatures: MATCH"
    );

    console.log(
      "PLANNER_REPRODUCIBILITY_OK"
    );

    console.log(
      `Result folder: ` +
      `${resultDirectory}`
    );
  } finally {
    if (
      hadActivePlan &&
      activePlanBackup
    ) {
      fs.writeFileSync(
        ACTIVE_PLAN,
        activePlanBackup
      );
    } else {
      fs.rmSync(
        ACTIVE_PLAN,
        {
          force: true,
        }
      );
    }

    console.log(
      "Active test plan restored."
    );
  }
}

try {
  main();
} catch (error: any) {
  console.error(
    "Planner reproducibility check failed:",
    error?.message || error
  );

  process.exitCode = 1;
}
