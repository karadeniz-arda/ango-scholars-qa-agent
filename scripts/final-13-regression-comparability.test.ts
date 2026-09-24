import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const SCRIPT_PATH =
  "scripts/run-final-13-regression.sh";

type ComparabilityResult = {
  comparable: boolean;
  classification: string;
  reasons: string[];
};

type ProductionComparabilityHelpers = {
  classifyBaselinePassComparability: (
    issue: string,
    caseId: string
  ) => ComparabilityResult;

  classifyBaselinePassEnvironmentComparability: (
    issue: string,
    caseId: string,
    currentStatus: string
  ) => ComparabilityResult;
};

function loadProductionComparabilityHelpers(
  browserPassBaseline: any,
  executionProfile: any,
  browserExecutionLogsByIssue:
    Map<string, string> = new Map()
): ProductionComparabilityHelpers {
  const source =
    fs.readFileSync(
      SCRIPT_PATH,
      "utf8"
    );

  const start =
    source.indexOf(
      "function resolvedHistoricalProfileFact("
    );

  const end =
    source.indexOf(
      "function increment(bucket, status)",
      start
    );

  assert.notEqual(
    start,
    -1,
    "historical profile helper missing"
  );

  assert.notEqual(
    end,
    -1,
    "comparability helper boundary missing"
  );

  assert.ok(
    end > start,
    "invalid comparability helper range"
  );

  const helperSource =
    source.slice(
      start,
      end
    );

  const buildHelpers =
    Function(
      `"use strict";
return function (
  browserPassBaseline,
  executionProfile,
  browserExecutionLogsByIssue
) {
${helperSource}

return {
  classifyBaselinePassComparability,
  classifyBaselinePassEnvironmentComparability,
};
};`
    )() as (
      baseline: any,
      current: any,
      logs: Map<string, string>
    ) => ProductionComparabilityHelpers;

  return buildHelpers(
    browserPassBaseline,
    executionProfile,
    browserExecutionLogsByIssue
  );
}

function makeBaseline(
  dependency: string[] = []
): any {
  return {
    executionProfile: {
      canonicalPlanManifestSha256: {
        value: "hash-a",
        resolution:
          "verified_from_archived_plan_parity",
      },

      browserMutationsAllowed: {
        value: true,
        resolution:
          "inferred_from_executed_behavior",
      },

      genericBrowserShadow: {
        value: true,
        resolution:
          "verified_from_runtime_logs",
      },

      genericBrowserReadOnlyExecution: {
        value: true,
        resolution:
          "verified_from_runtime_logs",
      },
    },

    browserPassCases: [
      {
        issue: "TEST-1",
        caseId: "web-1",

        comparisonDependencies: {
          requiredProfileDimensions:
            dependency,
        },
      },
    ],
  };
}

function makeCurrent(
  overrides: {
    planHash?: string | null;
    mutations?: boolean;
    shadow?: boolean | null;
    shadowResolution?: string;
    readOnly?: boolean | null;
    readOnlyResolution?: string;
  } = {}
): any {
  return {
    plan: {
      canonicalHashManifestSha256:
        overrides.planHash === undefined
          ? "hash-a"
          : overrides.planHash,
    },

    runnerPolicy: {
      browserMutationsAllowed:
        overrides.mutations ??
        false,
    },

    runtimeResolvedOutsideRunner: {
      genericBrowserShadow: {
        value:
          overrides.shadow ??
          null,

        resolution:
          overrides.shadowResolution ??
          "not_captured",
      },

      genericBrowserReadOnlyExecution: {
        value:
          overrides.readOnly ??
          null,

        resolution:
          overrides.readOnlyResolution ??
          "not_captured",
      },
    },
  };
}

test(
  "ignores irrelevant execution-profile differences",
  () => {
    const helpers =
      loadProductionComparabilityHelpers(
        makeBaseline([]),
        makeCurrent({
          mutations: false,
        })
      );

    assert.deepEqual(
      helpers
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        ),
      {
        comparable: true,
        classification: "COMPARABLE",
        reasons: [],
      }
    );
  }
);

test(
  "excludes a mutation-sensitive historical PASS when mutation policy differs",
  () => {
    const helpers =
      loadProductionComparabilityHelpers(
        makeBaseline([
          "browserMutationsAllowed",
        ]),
        makeCurrent({
          mutations: false,
        })
      );

    const result =
      helpers
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        );

    assert.equal(
      result.comparable,
      false
    );

    assert.equal(
      result.classification,
      "NON_COMPARABLE_EXECUTION_PROFILE"
    );

    assert.match(
      result.reasons.join(" "),
      /browserMutationsAllowed differs/
    );
  }
);

test(
  "keeps a mutation-sensitive historical PASS comparable when mutation policy matches",
  () => {
    const helpers =
      loadProductionComparabilityHelpers(
        makeBaseline([
          "browserMutationsAllowed",
        ]),
        makeCurrent({
          mutations: true,
        })
      );

    assert.deepEqual(
      helpers
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        ),
      {
        comparable: true,
        classification: "COMPARABLE",
        reasons: [],
      }
    );
  }
);

test(
  "fails closed when a required generic-browser handoff profile is unknown or mismatched",
  () => {
    const baseline =
      makeBaseline([
        "genericBrowserHandoffProfile",
      ]);

    const unknown =
      loadProductionComparabilityHelpers(
        baseline,
        makeCurrent()
      )
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        );

    assert.equal(
      unknown.comparable,
      false
    );

    assert.equal(
      unknown.classification,
      "NON_COMPARABLE_EXECUTION_PROFILE"
    );

    const mismatched =
      loadProductionComparabilityHelpers(
        baseline,
        makeCurrent({
          shadow: false,
          shadowResolution:
            "runner_override",

          readOnly: true,
          readOnlyResolution:
            "runner_override",
        })
      )
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        );

    assert.equal(
      mismatched.comparable,
      false
    );

    assert.equal(
      mismatched.classification,
      "NON_COMPARABLE_EXECUTION_PROFILE"
    );

    const matching =
      loadProductionComparabilityHelpers(
        baseline,
        makeCurrent({
          shadow: true,
          shadowResolution:
            "runner_override",

          readOnly: true,
          readOnlyResolution:
            "runner_override",
        })
      )
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        );

    assert.equal(
      matching.comparable,
      true
    );
  }
);

test(
  "classifies canonical plan fingerprint mismatch as non-comparable plan",
  () => {
    const helpers =
      loadProductionComparabilityHelpers(
        makeBaseline([]),
        makeCurrent({
          planHash: "hash-b",
        })
      );

    const result =
      helpers
        .classifyBaselinePassComparability(
          "TEST-1",
          "web-1"
        );

    assert.equal(
      result.comparable,
      false
    );

    assert.equal(
      result.classification,
      "NON_COMPARABLE_PLAN"
    );
  }
);

test(
  "classifies only same-case prerequisite HTTP 5xx route exhaustion as environment non-comparability",
  () => {
    const logs =
      new Map<string, string>();

    logs.set(
      "TEST-1",
      [
        "Browser runtime handoff attached to web-1 (talent): {",
        "}",
        "Browser route resolver GET failed 500: /talents/659/contracts",
        "Runtime browser route discovery exhausted for web-1.",
        "Browser runtime handoff attached to web-2 (talent): {",
        "}",
        "Runtime browser route discovery exhausted for web-2.",
        "Browser execution starts with authenticated persona: talent",
      ].join("\n")
    );

    const helpers =
      loadProductionComparabilityHelpers(
        makeBaseline([]),
        makeCurrent(),
        logs
      );

    const web1 =
      helpers
        .classifyBaselinePassEnvironmentComparability(
          "TEST-1",
          "web-1",
          "BLOCKED"
        );

    assert.equal(
      web1.comparable,
      false
    );

    assert.equal(
      web1.classification,
      "NON_COMPARABLE_ENVIRONMENT"
    );

    assert.match(
      web1.reasons.join(" "),
      /HTTP 500.*\/talents\/659\/contracts/
    );

    const web2 =
      helpers
        .classifyBaselinePassEnvironmentComparability(
          "TEST-1",
          "web-2",
          "BLOCKED"
        );

    assert.deepEqual(
      web2,
      {
        comparable: true,
        classification: "COMPARABLE",
        reasons: [],
      }
    );
  }
);

test(
  "keeps PASS-floor ordering fail-safe and leaves historical non-PASS audit separate",
  () => {
    const source =
      fs.readFileSync(
        SCRIPT_PATH,
        "utf8"
      );

    const profileGate =
      source.indexOf(
        "const comparability ="
      );

    const environmentGate =
      source.indexOf(
        "const environmentComparability =",
        profileGate
      );

    const passBranch =
      source.indexOf(
        'if (currentStatus === "PASS") {',
        environmentGate
      );

    const regressionPush =
      source.indexOf(
        "baselinePassRegressions.push({",
        passBranch
      );

    const nonPassAudit =
      source.indexOf(
        "Audit non-PASS baseline movement independently"
      );

    assert.ok(
      profileGate >= 0,
      "profile comparability gate missing"
    );

    assert.ok(
      environmentGate > profileGate,
      "environment gate must follow profile gate"
    );

    assert.ok(
      passBranch > environmentGate,
      "status classification must follow comparability gates"
    );

    assert.ok(
      regressionPush > passBranch,
      "regression push must follow comparable PASS branch"
    );

    assert.ok(
      nonPassAudit > regressionPush,
      "historical non-PASS audit must remain a separate later path"
    );

    const passFloorSegment =
      source.slice(
        profileGate,
        regressionPush +
          "baselinePassRegressions.push({".length
      );

    assert.match(
      passFloorSegment,
      /if \(!comparability\.comparable\)[\s\S]*?continue;/
    );

    assert.match(
      passFloorSegment,
      /if \(!environmentComparability\.comparable\)[\s\S]*?continue;/
    );
  }
);
