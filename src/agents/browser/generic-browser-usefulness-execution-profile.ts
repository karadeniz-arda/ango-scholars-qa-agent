import crypto from "node:crypto";
import fs from "node:fs";

/*
 * GENERIC_BROWSER_USEFULNESS_EXECUTION_PROFILE_V1
 *
 * Capture the runtime facts that make autonomous usefulness
 * measurements comparable across runs.
 *
 * This is intentionally separate from the frozen Final-13
 * baseline execution-profile implementation.
 *
 * Unlike the outer Final-13 runner, this helper executes
 * inside the application process, so autonomous runtime
 * values can be resolved directly instead of being recorded
 * as not_captured.
 */

export type GenericBrowserUsefulnessExecutionProfile = {
  schemaVersion: 1;

  plan: {
    activePlanSha256: string | null;
  };

  runnerPolicy: {
    evidenceReview: boolean;
    apiMutationsAllowed: boolean;
    browserMutationsAllowed: boolean;
    browserEditFlowsAllowed: boolean;
    fixtureProvisioningAllowed: boolean;
    requireFixtureCleanup: boolean;
    browserMutationPreflight: boolean;
  };

  autonomousRuntime: {
    genericBrowserShadow: boolean;
    genericBrowserReadOnlyExecution: boolean;
    genericBrowserModel: string;
  };
};

export type GenericBrowserUsefulnessProfileComparison =
  | {
      comparable: true;
      classification: "COMPARABLE";
      reasons: [];
    }
  | {
      comparable: false;
      classification:
        | "NON_COMPARABLE_PLAN"
        | "NON_COMPARABLE_EXECUTION_PROFILE";
      reasons: string[];
    };

type BuildProfileOptions = {
  env?: NodeJS.ProcessEnv;
  planFilePath?: string;
};

function exactTrue(
  value: string | undefined
): boolean {
  return value === "true";
}

function caseInsensitiveTrue(
  value: string | undefined
): boolean {
  return (
    String(value || "").toLowerCase() ===
    "true"
  );
}

function sha256File(
  filePath: string
): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath)
    )
    .digest("hex");
}

function resolveGenericBrowserModel(
  env: NodeJS.ProcessEnv
): string {
  /*
   * Keep exact parity with browser-agent-shadow.ts:
   *
   * QA_GENERIC_BROWSER_MODEL
   * -> OLLAMA_MODEL
   * -> gpt-4o-mini
   */
  return (
    env.QA_GENERIC_BROWSER_MODEL ||
    env.OLLAMA_MODEL ||
    "gpt-4o-mini"
  );
}

export function buildGenericBrowserUsefulnessExecutionProfile(
  options: BuildProfileOptions = {}
): GenericBrowserUsefulnessExecutionProfile {
  const env =
    options.env ?? process.env;

  const planFilePath =
    options.planFilePath ??
    "qa-results/test-plan.json";

  return {
    schemaVersion: 1,

    plan: {
      activePlanSha256:
        sha256File(planFilePath),
    },

    runnerPolicy: {
      /*
       * Match the actual consumer semantics rather than
       * applying one generic boolean parser everywhere.
       */
      evidenceReview:
        env.QA_EVIDENCE_REVIEW !== "false",

      apiMutationsAllowed:
        caseInsensitiveTrue(
          env.QA_ALLOW_API_MUTATIONS
        ),

      browserMutationsAllowed:
        caseInsensitiveTrue(
          env.QA_ALLOW_BROWSER_MUTATIONS
        ),

      browserEditFlowsAllowed:
        exactTrue(
          env.QA_ALLOW_BROWSER_EDIT_FLOWS
        ),

      fixtureProvisioningAllowed:
        caseInsensitiveTrue(
          env
            .QA_ALLOW_BROWSER_FIXTURE_PROVISIONING
        ),

      requireFixtureCleanup:
        exactTrue(
          env.QA_REQUIRE_FIXTURE_CLEANUP
        ),

      browserMutationPreflight:
        caseInsensitiveTrue(
          env.QA_BROWSER_MUTATION_PREFLIGHT
        ),
    },

    autonomousRuntime: {
      genericBrowserShadow:
        exactTrue(env.QA_GENERIC_BROWSER_SHADOW),

      genericBrowserReadOnlyExecution:
        env.QA_GENERIC_BROWSER_READONLY_EXECUTION !== "false",

      genericBrowserModel:
        resolveGenericBrowserModel(env),
    },
  };
}

/*
 * GENERIC_BROWSER_USEFULNESS_PROFILE_COMPARABILITY_V1
 *
 * Repeatability comparison fails safe:
 *
 * 1. active plan identity must be known and equal;
 * 2. all captured runner-policy dimensions must match;
 * 3. autonomous activation flags must match;
 * 4. the resolved autonomous model must match.
 *
 * No usefulness metric is interpreted here.
 */
export function compareGenericBrowserUsefulnessExecutionProfiles(
  left: GenericBrowserUsefulnessExecutionProfile,
  right: GenericBrowserUsefulnessExecutionProfile
): GenericBrowserUsefulnessProfileComparison {
  const leftPlan =
    left.plan.activePlanSha256;

  const rightPlan =
    right.plan.activePlanSha256;

  if (!leftPlan || !rightPlan) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_PLAN",
      reasons: [
        "Active plan identity is not known on both sides.",
      ],
    };
  }

  if (leftPlan !== rightPlan) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_PLAN",
      reasons: [
        "Active plan fingerprint differs between usefulness runs.",
      ],
    };
  }

  const reasons: string[] = [];

  if (
    left.schemaVersion !==
    right.schemaVersion
  ) {
    reasons.push(
      `schemaVersion differs: ` +
        `left=${left.schemaVersion}, ` +
        `right=${right.schemaVersion}.`
    );
  }

  const policyKeys = [
    "evidenceReview",
    "apiMutationsAllowed",
    "browserMutationsAllowed",
    "browserEditFlowsAllowed",
    "fixtureProvisioningAllowed",
    "requireFixtureCleanup",
    "browserMutationPreflight",
  ] as const;

  for (const key of policyKeys) {
    const leftValue =
      left.runnerPolicy[key];

    const rightValue =
      right.runnerPolicy[key];

    if (leftValue !== rightValue) {
      reasons.push(
        `${key} differs: ` +
          `left=${leftValue}, ` +
          `right=${rightValue}.`
      );
    }
  }

  if (
    left.autonomousRuntime
      .genericBrowserShadow !==
    right.autonomousRuntime
      .genericBrowserShadow
  ) {
    reasons.push(
      `genericBrowserShadow differs: ` +
        `left=${left.autonomousRuntime.genericBrowserShadow}, ` +
        `right=${right.autonomousRuntime.genericBrowserShadow}.`
    );
  }

  if (
    left.autonomousRuntime
      .genericBrowserReadOnlyExecution !==
    right.autonomousRuntime
      .genericBrowserReadOnlyExecution
  ) {
    reasons.push(
      `genericBrowserReadOnlyExecution differs: ` +
        `left=${left.autonomousRuntime.genericBrowserReadOnlyExecution}, ` +
        `right=${right.autonomousRuntime.genericBrowserReadOnlyExecution}.`
    );
  }

  if (
    left.autonomousRuntime
      .genericBrowserModel !==
    right.autonomousRuntime
      .genericBrowserModel
  ) {
    reasons.push(
      `genericBrowserModel differs: ` +
        `left=${JSON.stringify(
          left.autonomousRuntime
            .genericBrowserModel
        )}, ` +
        `right=${JSON.stringify(
          right.autonomousRuntime
            .genericBrowserModel
        )}.`
    );
  }

  if (reasons.length > 0) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_EXECUTION_PROFILE",
      reasons,
    };
  }

  return {
    comparable: true,
    classification: "COMPARABLE",
    reasons: [],
  };
}
