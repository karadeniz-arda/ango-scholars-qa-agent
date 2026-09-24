import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildGenericBrowserUsefulnessExecutionProfile,
  compareGenericBrowserUsefulnessExecutionProfiles,
} from "./generic-browser-usefulness-execution-profile.js";

function withTemporaryPlan(
  contents: string,
  callback: (
    planFilePath: string
  ) => void
): void {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "generic-browser-profile-"
      )
    );

  const planFilePath =
    path.join(
      directory,
      "test-plan.json"
    );

  fs.writeFileSync(
    planFilePath,
    contents,
    "utf8"
  );

  try {
    callback(planFilePath);
  } finally {
    fs.rmSync(
      directory,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

test(
  "captures active plan identity and resolved autonomous runtime profile",
  () => {
    const planContents =
      '{"issueKey":"AS-1058"}\n';

    withTemporaryPlan(
      planContents,
      (planFilePath) => {
        const profile =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env: {
              QA_EVIDENCE_REVIEW:
                "true",
              QA_ALLOW_API_MUTATIONS:
                "false",
              QA_ALLOW_BROWSER_MUTATIONS:
                "false",
              QA_ALLOW_BROWSER_EDIT_FLOWS:
                "false",
              QA_ALLOW_BROWSER_FIXTURE_PROVISIONING:
                "false",
              QA_REQUIRE_FIXTURE_CLEANUP:
                "true",
              QA_BROWSER_MUTATION_PREFLIGHT:
                "false",
              QA_GENERIC_BROWSER_SHADOW:
                "true",
              QA_GENERIC_BROWSER_READONLY_EXECUTION:
                "true",
              QA_GENERIC_BROWSER_MODEL:
                "gpt-5.6-luna",
              OLLAMA_MODEL:
                "ignored-model",
            },
          });

        const expectedSha =
          crypto
            .createHash("sha256")
            .update(planContents)
            .digest("hex");

        assert.equal(
          profile.plan
            .activePlanSha256,
          expectedSha
        );

        assert.deepEqual(
          profile.runnerPolicy,
          {
            evidenceReview: true,
            apiMutationsAllowed: false,
            browserMutationsAllowed:
              false,
            browserEditFlowsAllowed:
              false,
            fixtureProvisioningAllowed:
              false,
            requireFixtureCleanup: true,
            browserMutationPreflight:
              false,
          }
        );

        assert.deepEqual(
          profile.autonomousRuntime,
          {
            genericBrowserShadow: true,
            genericBrowserReadOnlyExecution:
              true,
            genericBrowserModel:
              "gpt-5.6-luna",
          }
        );
      }
    );
  }
);

test(
  "uses the same generic browser model precedence as the shadow runner",
  () => {
    const withExplicitModel =
      buildGenericBrowserUsefulnessExecutionProfile({
        planFilePath:
          "__missing-plan__",
        env: {
          QA_GENERIC_BROWSER_MODEL:
            "explicit-model",
          OLLAMA_MODEL:
            "ollama-model",
        },
      });

    assert.equal(
      withExplicitModel
        .autonomousRuntime
        .genericBrowserModel,
      "explicit-model"
    );

    const withOllamaModel =
      buildGenericBrowserUsefulnessExecutionProfile({
        planFilePath:
          "__missing-plan__",
        env: {
          OLLAMA_MODEL:
            "ollama-model",
        },
      });

    assert.equal(
      withOllamaModel
        .autonomousRuntime
        .genericBrowserModel,
      "ollama-model"
    );

    const withDefaultModel =
      buildGenericBrowserUsefulnessExecutionProfile({
        planFilePath:
          "__missing-plan__",
        env: {},
      });

    assert.equal(
      withDefaultModel
        .autonomousRuntime
        .genericBrowserModel,
      "gpt-4o-mini"
    );
  }
);

test(
  "defaults to generic safe execution and evidence review, with explicit disable overrides",
  () => {
    const defaults = buildGenericBrowserUsefulnessExecutionProfile({
      planFilePath: "__missing-plan__",
      env: {},
    });
    assert.equal(defaults.autonomousRuntime.genericBrowserReadOnlyExecution, true);
    assert.equal(defaults.runnerPolicy.evidenceReview, true);
    assert.equal(defaults.autonomousRuntime.genericBrowserShadow, false);
    assert.equal(defaults.runnerPolicy.browserMutationsAllowed, false);
    assert.equal(defaults.runnerPolicy.apiMutationsAllowed, false);

    const disabled = buildGenericBrowserUsefulnessExecutionProfile({
      planFilePath: "__missing-plan__",
      env: {
        QA_GENERIC_BROWSER_READONLY_EXECUTION: "false",
        QA_EVIDENCE_REVIEW: "false",
      },
    });
    assert.equal(disabled.autonomousRuntime.genericBrowserReadOnlyExecution, false);
    assert.equal(disabled.runnerPolicy.evidenceReview, false);
  }
);

test(
  "preserves exact versus case-insensitive runtime boolean semantics",
  () => {
    const profile =
      buildGenericBrowserUsefulnessExecutionProfile({
        planFilePath:
          "__missing-plan__",
        env: {
          QA_GENERIC_BROWSER_SHADOW:
            "TRUE",
          QA_GENERIC_BROWSER_READONLY_EXECUTION:
            "TRUE",
          QA_EVIDENCE_REVIEW:
            "TRUE",
          QA_ALLOW_BROWSER_EDIT_FLOWS:
            "TRUE",
          QA_REQUIRE_FIXTURE_CLEANUP:
            "TRUE",

          QA_ALLOW_API_MUTATIONS:
            "TRUE",
          QA_ALLOW_BROWSER_MUTATIONS:
            "TRUE",
          QA_ALLOW_BROWSER_FIXTURE_PROVISIONING:
            "TRUE",
          QA_BROWSER_MUTATION_PREFLIGHT:
            "TRUE",
        },
      });

    assert.equal(
      profile.autonomousRuntime
        .genericBrowserShadow,
      false
    );

    assert.equal(
      profile.autonomousRuntime
        .genericBrowserReadOnlyExecution,
      true
    );

    assert.equal(
      profile.runnerPolicy
        .evidenceReview,
      true
    );

    assert.equal(
      profile.runnerPolicy
        .browserEditFlowsAllowed,
      false
    );

    assert.equal(
      profile.runnerPolicy
        .requireFixtureCleanup,
      false
    );

    assert.equal(
      profile.runnerPolicy
        .apiMutationsAllowed,
      true
    );

    assert.equal(
      profile.runnerPolicy
        .browserMutationsAllowed,
      true
    );

    assert.equal(
      profile.runnerPolicy
        .fixtureProvisioningAllowed,
      true
    );

    assert.equal(
      profile.runnerPolicy
        .browserMutationPreflight,
      true
    );
  }
);

test(
  "classifies identical usefulness execution profiles as comparable",
  () => {
    withTemporaryPlan(
      '{"issueKey":"AS-1058"}',
      (planFilePath) => {
        const env = {
          QA_GENERIC_BROWSER_SHADOW:
            "true",
          QA_GENERIC_BROWSER_READONLY_EXECUTION:
            "true",
          QA_GENERIC_BROWSER_MODEL:
            "gpt-5.6-luna",
          QA_EVIDENCE_REVIEW:
            "true",
          QA_REQUIRE_FIXTURE_CLEANUP:
            "true",
        };

        const left =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env,
          });

        const right =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env,
          });

        assert.deepEqual(
          compareGenericBrowserUsefulnessExecutionProfiles(
            left,
            right
          ),
          {
            comparable: true,
            classification:
              "COMPARABLE",
            reasons: [],
          }
        );
      }
    );
  }
);

test(
  "fails closed when active plan fingerprints differ or are unavailable",
  () => {
    let firstProfile:
      ReturnType<
        typeof buildGenericBrowserUsefulnessExecutionProfile
      > | null = null;

    let secondProfile:
      ReturnType<
        typeof buildGenericBrowserUsefulnessExecutionProfile
      > | null = null;

    withTemporaryPlan(
      '{"issueKey":"AS-1058"}',
      (planFilePath) => {
        firstProfile =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env: {},
          });
      }
    );

    withTemporaryPlan(
      '{"issueKey":"AS-1058","changed":true}',
      (planFilePath) => {
        secondProfile =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env: {},
          });
      }
    );

    assert.ok(firstProfile);
    assert.ok(secondProfile);

    const mismatch =
      compareGenericBrowserUsefulnessExecutionProfiles(
        firstProfile,
        secondProfile
      );

    assert.equal(
      mismatch.comparable,
      false
    );

    assert.equal(
      mismatch.classification,
      "NON_COMPARABLE_PLAN"
    );

    const missing =
      buildGenericBrowserUsefulnessExecutionProfile({
        planFilePath:
          "__missing-plan__",
        env: {},
      });

    const missingComparison =
      compareGenericBrowserUsefulnessExecutionProfiles(
        firstProfile,
        missing
      );

    assert.equal(
      missingComparison.comparable,
      false
    );

    assert.equal(
      missingComparison.classification,
      "NON_COMPARABLE_PLAN"
    );
  }
);

test(
  "rejects model or policy differences as execution-profile non-comparability",
  () => {
    withTemporaryPlan(
      '{"issueKey":"AS-1058"}',
      (planFilePath) => {
        const left =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env: {
              QA_GENERIC_BROWSER_SHADOW:
                "true",
              QA_GENERIC_BROWSER_READONLY_EXECUTION:
                "true",
              QA_GENERIC_BROWSER_MODEL:
                "gpt-5.6-luna",
              QA_ALLOW_BROWSER_MUTATIONS:
                "false",
            },
          });

        const right =
          buildGenericBrowserUsefulnessExecutionProfile({
            planFilePath,
            env: {
              QA_GENERIC_BROWSER_SHADOW:
                "true",
              QA_GENERIC_BROWSER_READONLY_EXECUTION:
                "true",
              QA_GENERIC_BROWSER_MODEL:
                "different-model",
              QA_ALLOW_BROWSER_MUTATIONS:
                "true",
            },
          });

        const comparison =
          compareGenericBrowserUsefulnessExecutionProfiles(
            left,
            right
          );

        assert.equal(
          comparison.comparable,
          false
        );

        assert.equal(
          comparison.classification,
          "NON_COMPARABLE_EXECUTION_PROFILE"
        );

        assert.ok(
          comparison.reasons.some(
            (reason) =>
              reason.includes(
                "genericBrowserModel differs"
              )
          )
        );

        assert.ok(
          comparison.reasons.some(
            (reason) =>
              reason.includes(
                "browserMutationsAllowed differs"
              )
          )
        );
      }
    );
  }
);
