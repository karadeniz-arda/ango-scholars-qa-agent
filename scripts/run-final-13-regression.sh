#!/usr/bin/env bash

set -u -o pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"

RUN_DIR="${QA_REGRESSION_RUN_DIR:-qa-results/runs/final-13-regression-$STAMP}"

RESTORE_DIR="$RUN_DIR/.restore"
STATUS_FILE="$RUN_DIR/run-status.tsv"

PLAN_TIMEOUT_SECONDS="${QA_PLAN_TIMEOUT_SECONDS:-600}"

SMOKE_TIMEOUT_SECONDS="${QA_SMOKE_TIMEOUT_SECONDS:-1800}"

RESUME_ENABLED="${QA_REGRESSION_RESUME:-true}"

PLAN_MODE="${QA_REGRESSION_PLAN_MODE:-fresh}"
LEGACY_PLAN_ADMISSION=false
if [[ "$PLAN_MODE" == "canonical" ]]; then
  LEGACY_PLAN_ADMISSION=true
fi
CANONICAL_PLAN_DIR="${QA_REGRESSION_CANONICAL_PLAN_DIR:-fixtures/regression/final-13/plans}"
CANONICAL_HASH_FILE="${QA_REGRESSION_CANONICAL_HASH_FILE:-fixtures/regression/final-13/plans.sha256}"

ISSUES=(
  AS-1028
  AS-1014
  AS-1093
  AS-1190
  AS-1011
  AS-1154
  AS-869
  AS-1196
  AS-1073
  AS-1139
  AS-1133
  AS-1165
  AS-1058
)

mkdir -p "$RUN_DIR" "$RESTORE_DIR"

printf '%s\n' "$RUN_DIR" \
  > qa-results/latest-final-13-regression-dir.txt

if [[ ! -f "$STATUS_FILE" ]]; then
  printf \
    'issue\tplanExit\tsmokeExit\tplanPresent\treportPresent\n' \
    > "$STATUS_FILE"
fi

HAD_PLAN=false
HAD_REPORT=false
HAD_EVIDENCE=false
HAD_VIDEOS=false
HAD_USEFULNESS_SUMMARY=false

if [[ -f qa-results/test-plan.json ]]; then
  cp qa-results/test-plan.json \
    "$RESTORE_DIR/test-plan.json"
  HAD_PLAN=true
fi

if [[ -f qa-results/report.md ]]; then
  cp qa-results/report.md \
    "$RESTORE_DIR/report.md"
  HAD_REPORT=true
fi

if [[ -d qa-results/evidence ]]; then
  cp -R qa-results/evidence \
    "$RESTORE_DIR/evidence"
  HAD_EVIDENCE=true
fi

if [[ -d qa-results/videos ]]; then
  cp -R qa-results/videos \
    "$RESTORE_DIR/videos"
  HAD_VIDEOS=true
fi

if [[ -f qa-results/generic-browser-usefulness-run-summary.json ]]; then
  cp qa-results/generic-browser-usefulness-run-summary.json \
    "$RESTORE_DIR/generic-browser-usefulness-run-summary.json"
  HAD_USEFULNESS_SUMMARY=true
fi

restore_files() {
  if [[ "$HAD_PLAN" == "true" ]]; then
    cp "$RESTORE_DIR/test-plan.json" \
      qa-results/test-plan.json
  else
    rm -f qa-results/test-plan.json
  fi

  if [[ "$HAD_REPORT" == "true" ]]; then
    cp "$RESTORE_DIR/report.md" \
      qa-results/report.md
  else
    rm -f qa-results/report.md
  fi

  rm -rf qa-results/evidence
  rm -rf qa-results/videos

  if [[ "$HAD_EVIDENCE" == "true" ]]; then
    cp -R "$RESTORE_DIR/evidence" \
      qa-results/evidence
  fi

  if [[ "$HAD_VIDEOS" == "true" ]]; then
    cp -R "$RESTORE_DIR/videos" \
      qa-results/videos
  fi

  rm -f qa-results/generic-browser-usefulness-run-summary.json

  if [[ "$HAD_USEFULNESS_SUMMARY" == "true" ]]; then
    cp "$RESTORE_DIR/generic-browser-usefulness-run-summary.json" \
      qa-results/generic-browser-usefulness-run-summary.json
  fi

  rm -rf "$RESTORE_DIR"

  echo
  echo "Aktif plan, rapor ve runtime evidence durumu geri yüklendi."
}

trap restore_files EXIT

run_with_timeout() {
  local timeout_seconds="$1"
  shift

  python3 - "$timeout_seconds" "$@" <<'PY'
import os
import shlex
import signal
import subprocess
import sys

timeout_seconds = float(sys.argv[1])
command = sys.argv[2:]

try:
    process = subprocess.Popen(
        command,
        start_new_session=True,
    )
except Exception as error:
    print(
        f"Command could not start: {error}",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)

try:
    exit_code = process.wait(
        timeout=timeout_seconds
    )
    sys.exit(exit_code)
except subprocess.TimeoutExpired:
    print(
        "\nTIMEOUT after "
        f"{timeout_seconds:g} seconds: "
        f"{shlex.join(command)}",
        file=sys.stderr,
        flush=True,
    )

    try:
        os.killpg(
            process.pid,
            signal.SIGTERM,
        )
    except ProcessLookupError:
        pass

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(
                process.pid,
                signal.SIGKILL,
            )
        except ProcessLookupError:
            pass

        process.wait()

    sys.exit(124)
PY
}

status_row_is_complete() {
  local issue="$1"
  local row
  local saved_issue
  local plan_exit
  local smoke_exit
  local plan_present
  local report_present

  [[ "$RESUME_ENABLED" == "true" ]] \
    || return 1

  [[ -f "$STATUS_FILE" ]] \
    || return 1

  row="$(
    awk -F '\t' -v issue="$issue" '
      NR > 1 && $1 == issue {
        found = $0
      }

      END {
        if (found) {
          print found
        }
      }
    ' "$STATUS_FILE"
  )"

  [[ -n "$row" ]] \
    || return 1

  IFS=$'\t' read -r \
    saved_issue \
    plan_exit \
    smoke_exit \
    plan_present \
    report_present \
    <<< "$row"

  [[ "$plan_exit" == "0" ]] \
    && [[ "$smoke_exit" == "0" ]] \
    && [[ "$plan_present" == "true" ]] \
    && [[ "$report_present" == "true" ]] \
    && [[ -f "$RUN_DIR/$issue/test-plan.json" ]] \
    && [[ -f "$RUN_DIR/$issue/report.md" ]]
}

write_status_row() {
  local issue="$1"
  local plan_exit="$2"
  local smoke_exit="$3"
  local plan_present="$4"
  local report_present="$5"
  local temporary_file="$STATUS_FILE.tmp"

  awk -F '\t' -v issue="$issue" '
    NR == 1 || $1 != issue
  ' "$STATUS_FILE" > "$temporary_file"

  printf \
    '%s\t%s\t%s\t%s\t%s\n' \
    "$issue" \
    "$plan_exit" \
    "$smoke_exit" \
    "$plan_present" \
    "$report_present" \
    >> "$temporary_file"

  mv "$temporary_file" "$STATUS_FILE"
}

echo "===== FINAL 13 PRECHECK ====="

echo "Plan mode: $PLAN_MODE"

case "$PLAN_MODE" in
  fresh|canonical)
    ;;
  *)
    echo "Unsupported QA_REGRESSION_PLAN_MODE: $PLAN_MODE"
    echo "Supported values: fresh, canonical"
    exit 2
    ;;
esac

if [[ "$PLAN_MODE" == "canonical" ]]; then
  if [[ ! -d "$CANONICAL_PLAN_DIR" ]]; then
    echo "Canonical plan directory missing: $CANONICAL_PLAN_DIR"
    exit 2
  fi

  if [[ ! -f "$CANONICAL_HASH_FILE" ]]; then
    echo "Canonical hash manifest missing: $CANONICAL_HASH_FILE"
    exit 2
  fi

  echo "Verifying canonical plan hashes..."

  if ! shasum -a 256 -c "$CANONICAL_HASH_FILE"; then
    echo "Canonical plan hash verification failed."
    exit 2
  fi

  echo "Canonical plan hashes: PASS"
fi

if [[ -f .env ]] && \
  grep -q '^OLLAMA_VISION_MODEL=' .env
then
  echo "Vision model configured: yes"
else
  echo "Vision model configured: no"
fi

npx tsc --noEmit
TS_STATUS=$?

if [[ "$TS_STATUS" -eq 0 ]]; then
  echo "TypeScript: PASS"
else
  echo "TypeScript: FAIL"
fi

for ISSUE in "${ISSUES[@]}"; do
  ISSUE_DIR="$RUN_DIR/$ISSUE"

# Controlled Work Setup fixture provisioning is enabled
# only for canonical cases backed by the owned lifecycle.
FIXTURE_PROVISIONING_ENABLED=false

case "$ISSUE" in
AS-1165|AS-1190)
FIXTURE_PROVISIONING_ENABLED=true
;;
esac

  mkdir -p "$ISSUE_DIR"

  if status_row_is_complete "$ISSUE"; then
    echo
    echo "########################################"
    echo "$ISSUE — RESUME SKIP"
    echo "########################################"
    echo "Plan ve report daha önce tamamlanmış."
    continue
  fi

  rm -f qa-results/test-plan.json
  rm -f qa-results/report.md
  rm -rf qa-results/evidence
  rm -rf qa-results/videos
  rm -f qa-results/generic-browser-usefulness-run-summary.json

  PLAN_STATUS=99
  SMOKE_STATUS=99
  PLAN_PRESENT=false
  REPORT_PRESENT=false

  if [[ "$PLAN_MODE" == "canonical" ]]; then
    CANONICAL_PLAN="$CANONICAL_PLAN_DIR/$ISSUE.json"

    echo
    echo "########################################"
    echo "$ISSUE — CANONICAL PLAN"
    echo "########################################"

    {
      echo "Canonical plan source: $CANONICAL_PLAN"
      cp "$CANONICAL_PLAN" qa-results/test-plan.json
    } 2>&1 | tee "$ISSUE_DIR/plan.log"

    PLAN_STATUS=${PIPESTATUS[0]}
  else
    echo
    echo "########################################"
    echo "$ISSUE — FRESH PLAN"
    echo "########################################"

    run_with_timeout \
      "$PLAN_TIMEOUT_SECONDS" \
      npm run plan -- --issue "$ISSUE" \
      2>&1 | tee "$ISSUE_DIR/plan.log"

    PLAN_STATUS=${PIPESTATUS[0]}
  fi

  if [[ "$PLAN_STATUS" -eq 0 ]] \
    && [[ -f qa-results/test-plan.json ]]; then
    PLAN_PRESENT=true

    cp qa-results/test-plan.json \
      "$ISSUE_DIR/test-plan.json"

    echo
    echo "########################################"
    echo "$ISSUE — SMOKE"
    echo "########################################"

    run_with_timeout \
      "$SMOKE_TIMEOUT_SECONDS" \
      env \
        QA_EVIDENCE_REVIEW=true \
        QA_ALLOW_API_MUTATIONS=false \
        QA_ALLOW_BROWSER_MUTATIONS="${QA_ALLOW_BROWSER_MUTATIONS:-false}" \
        QA_ALLOW_BROWSER_EDIT_FLOWS="${QA_ALLOW_BROWSER_EDIT_FLOWS:-false}" \
        QA_ALLOW_BROWSER_FIXTURE_PROVISIONING="$FIXTURE_PROVISIONING_ENABLED" \
        QA_REQUIRE_FIXTURE_CLEANUP=true \
        QA_BROWSER_MUTATION_PREFLIGHT=false \
        QA_ALLOW_LEGACY_UNCOMPILED_PLAN="$LEGACY_PLAN_ADMISSION" \
        npm run smoke -- --issue "$ISSUE" \
      2>&1 | tee "$ISSUE_DIR/smoke.log"

    SMOKE_STATUS=${PIPESTATUS[0]}

    # P4_AUTONOMOUS_USEFULNESS_ARTIFACT_RETENTION_V1
    #
    # Output retention only. This does not participate in
    # proposal generation, safety, execution, proof, or verdict.
    rm -f "$ISSUE_DIR/generic-browser-usefulness-run-summary.json"

    if [[ -f qa-results/generic-browser-usefulness-run-summary.json ]]; then
      cp qa-results/generic-browser-usefulness-run-summary.json \
        "$ISSUE_DIR/generic-browser-usefulness-run-summary.json"
    fi

    rm -rf "$ISSUE_DIR/evidence"
    rm -rf "$ISSUE_DIR/videos"

    if [[ -d qa-results/evidence ]]; then
      cp -R qa-results/evidence \
        "$ISSUE_DIR/evidence"
    fi

    if [[ -d qa-results/videos ]]; then
      cp -R qa-results/videos \
        "$ISSUE_DIR/videos"
    fi

    if [[ -f qa-results/report.md ]]; then
      REPORT_PRESENT=true

      cp qa-results/report.md \
        "$ISSUE_DIR/report.md"
    fi
  fi

  write_status_row \
    "$ISSUE" \
    "$PLAN_STATUS" \
    "$SMOKE_STATUS" \
    "$PLAN_PRESENT" \
    "$REPORT_PRESENT"
done

echo
echo "===== FINAL 13 REGRESSION GUARD ====="

RUN_DIR="$RUN_DIR" \
TS_STATUS="$TS_STATUS" \
REGRESSION_PLAN_MODE="$PLAN_MODE" \
CANONICAL_HASH_FILE="$CANONICAL_HASH_FILE" \
EFFECTIVE_EVIDENCE_REVIEW="true" \
EFFECTIVE_API_MUTATIONS_ALLOWED="false" \
EFFECTIVE_BROWSER_MUTATIONS_ALLOWED="${QA_ALLOW_BROWSER_MUTATIONS:-false}" \
EFFECTIVE_BROWSER_EDIT_FLOWS_ALLOWED="${QA_ALLOW_BROWSER_EDIT_FLOWS:-false}" \
EFFECTIVE_REQUIRE_FIXTURE_CLEANUP="true" \
EFFECTIVE_BROWSER_MUTATION_PREFLIGHT="false" \
FIXTURE_PROVISIONING_ENABLED_ISSUES_CSV="AS-1165,AS-1190" \
GENERIC_BROWSER_SHADOW_RUNNER_OVERRIDE="${QA_GENERIC_BROWSER_SHADOW-}" \
GENERIC_BROWSER_READONLY_RUNNER_OVERRIDE="${QA_GENERIC_BROWSER_READONLY_EXECUTION-}" \
GENERIC_BROWSER_MODEL_RUNNER_OVERRIDE="${QA_GENERIC_BROWSER_MODEL-}" \
OLLAMA_MODEL_RUNNER_OVERRIDE="${OLLAMA_MODEL-}" \
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const runDir = process.env.RUN_DIR;
const tsStatus =
  Number(process.env.TS_STATUS || "1");

/*
 * FINAL_13_EXECUTION_PROFILE_V1
 *
 * Capture only execution facts this runner can prove.
 *
 * Generic-browser/model configuration can also be resolved later
 * inside the smoke process from application environment loading.
 * When this outer runner did not explicitly provide an override,
 * record that value as not captured rather than guessing.
 */
function parseStrictBoolean(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function captureRunnerBooleanOverride(
  value
) {
  const parsed =
    parseStrictBoolean(value);

  return {
    value: parsed,
    resolution:
      parsed === null
        ? "not_captured"
        : "runner_override",
  };
}

function sha256File(filePath) {
  if (
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath)
    )
    .digest("hex");
}

const genericBrowserModelOverride =
  String(
    process.env
      .GENERIC_BROWSER_MODEL_RUNNER_OVERRIDE ||
    ""
  ).trim();

const ollamaModelOverride =
  String(
    process.env
      .OLLAMA_MODEL_RUNNER_OVERRIDE ||
    ""
  ).trim();

const executionProfile = {
  schemaVersion: 1,

  plan: {
    mode:
      String(
        process.env.REGRESSION_PLAN_MODE ||
        ""
      )
        .trim()
        .toLowerCase(),

    canonicalHashFile:
      process.env.CANONICAL_HASH_FILE ||
      null,

    canonicalHashManifestSha256:
      sha256File(
        process.env.CANONICAL_HASH_FILE
      ),
  },

  runnerPolicy: {
    evidenceReview:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_EVIDENCE_REVIEW
      ),

    apiMutationsAllowed:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_API_MUTATIONS_ALLOWED
      ),

    browserMutationsAllowed:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_BROWSER_MUTATIONS_ALLOWED
      ),

    browserEditFlowsAllowed:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_BROWSER_EDIT_FLOWS_ALLOWED
      ),

    requireFixtureCleanup:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_REQUIRE_FIXTURE_CLEANUP
      ),

    browserMutationPreflight:
      parseStrictBoolean(
        process.env
          .EFFECTIVE_BROWSER_MUTATION_PREFLIGHT
      ),

    fixtureProvisioning: {
      mode: "issue_allowlist",

      enabledIssues:
        String(
          process.env
            .FIXTURE_PROVISIONING_ENABLED_ISSUES_CSV ||
          ""
        )
          .split(",")
          .map(
            (value) => value.trim()
          )
          .filter(Boolean),
    },
  },

  runtimeResolvedOutsideRunner: {
    genericBrowserShadow:
      captureRunnerBooleanOverride(
        process.env
          .GENERIC_BROWSER_SHADOW_RUNNER_OVERRIDE
      ),

    genericBrowserReadOnlyExecution:
      captureRunnerBooleanOverride(
        process.env
          .GENERIC_BROWSER_READONLY_RUNNER_OVERRIDE
      ),

    genericBrowserModel: {
      value:
        genericBrowserModelOverride ||
        ollamaModelOverride ||
        null,

      resolution:
        genericBrowserModelOverride
          ? "qa_generic_browser_model_runner_override"
          : ollamaModelOverride
            ? "ollama_model_runner_override"
            : "not_captured",
    },
  },
};

if (!runDir) {
  throw new Error("RUN_DIR eksik.");
}

const statusFile =
  path.join(runDir, "run-status.tsv");

const rows = fs
  .readFileSync(statusFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const [
      issue,
      planExit,
      smokeExit,
      planPresent,
      reportPresent,
    ] = line.split("\t");

    return {
      issue,
      planExit: Number(planExit),
      smokeExit: Number(smokeExit),
      planPresent:
        planPresent === "true",
      reportPresent:
        reportPresent === "true",
    };
  });

const totals = {
  api: {
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    MANUAL_REQUIRED: 0,
    ERROR: 0,
  },
  browser: {
    PASS: 0,
    FAIL: 0,
    BLOCKED: 0,
    MANUAL_REQUIRED: 0,
    ERROR: 0,
  },
  browserBlockedReasons: {
    FIXTURE_UNAVAILABLE: 0,
    RELEVANCE_GATE_REJECTED: 0,
    ROUTE_DISCOVERY_EXHAUSTED: 0,
    MUTATION_SAFETY_GUARD: 0,
    WRONG_ROUTE_EVIDENCE: 0,
    OTHER: 0,
  },
  evidenceReviews: 0,
  passConfirmed: 0,
  evidence404: 0,
};

const failures = [];
const productFindings = [];
const deterministicFindings = [];
const behaviorProofRequirements = [];
const urlTransitionProofParityAudits = [];
const selectedStateProofParityAudits = [];
const agentRegressions = [];
const unclassifiedFailures = [];

/*
 * CANONICAL_BROWSER_PASS_FLOOR_V1
 *
 * Aggregate PASS totals are not a regression oracle.
 *
 * A canonical browser case that previously produced PASS
 * must remain PASS in later canonical runs. A newly gained
 * PASS cannot compensate for losing an established PASS.
 *
 * Keep this migration floor separate from agentRegressions:
 * that existing collection classifies final FAIL findings,
 * while this collection compares per-case verdict history.
 */
const finalBrowserResults = [];
const browserExecutionLogsByIssue = new Map();

const baselinePassPreserved = [];
const baselinePassNonComparable = [];
const baselinePassRegressions = [];
const coverageGains = [];

/*
 * CANONICAL_BROWSER_VERDICT_SNAPSHOT_V1
 *
 * Preserve the complete canonical browser verdict snapshot
 * so non-PASS status movement can be audited separately
 * from the hard historical PASS floor.
 *
 * PASS -> non-PASS remains a regression and is already
 * enforced by the PASS floor.
 *
 * non-PASS -> PASS is a coverage gain.
 *
 * non-PASS -> different non-PASS is informational
 * STATUS_RECLASSIFIED evidence, not automatically a guard
 * failure because safer classification may be intentional.
 */
const baselineUnchangedNonPass = [];
const baselineStatusReclassifications = [];
const baselineVerdictMissing = [];

const canonicalPlanMode =
  String(
    process.env.QA_REGRESSION_PLAN_MODE ||
      ""
  )
    .trim()
    .toLowerCase() === "canonical";

const browserPassBaselinePath =
  path.join(
    "fixtures",
    "regression",
    "final-13",
    "browser-pass-baseline.json"
  );

let browserPassBaseline = null;

if (canonicalPlanMode) {
  try {
    if (
      !fs.existsSync(
        browserPassBaselinePath
      )
    ) {
      throw new Error(
        "baseline manifest is missing"
      );
    }

    const parsedBaseline =
      JSON.parse(
        fs.readFileSync(
          browserPassBaselinePath,
          "utf8"
        )
      );

    if (
      parsedBaseline?.schemaVersion !== 1 ||
      !Array.isArray(
        parsedBaseline?.browserPassCases
      )
    ) {
      throw new Error(
        "baseline manifest has an unsupported shape"
      );
    }

    browserPassBaseline =
      parsedBaseline;
  } catch (error) {
    failures.push(
      `Canonical browser PASS baseline could not be loaded: ` +
        `${String(
          error?.message || error
        )}`
    );
  }
}

/*
 * FINAL_13_CASE_AWARE_COMPARABILITY_V1
 *
 * Historical PASS is a regression oracle only when the
 * dimensions that actually mattered to that historical PASS
 * are comparable.
 *
 * Irrelevant run-profile differences must not discard otherwise
 * valid coverage. Conversely, unknown required dimensions fail
 * closed into NON_COMPARABLE rather than being guessed.
 */
function resolvedHistoricalProfileFact(
  fact
) {
  if (
    !fact ||
    typeof fact !== "object"
  ) {
    return {
      known: false,
      value: null,
      resolution: "missing",
    };
  }

  const resolution =
    String(
      fact.resolution || ""
    ).trim();

  const value = fact.value;

  const known =
    value !== null &&
    value !== undefined &&
    resolution !== "unknown" &&
    resolution !== "not_captured";

  return {
    known,
    value:
      known
        ? value
        : null,
    resolution:
      resolution || "missing",
  };
}

function resolvedCurrentRunnerOverride(
  fact
) {
  if (
    !fact ||
    typeof fact !== "object"
  ) {
    return {
      known: false,
      value: null,
      resolution: "missing",
    };
  }

  const resolution =
    String(
      fact.resolution || ""
    ).trim();

  const known =
    typeof fact.value === "boolean" &&
    resolution === "runner_override";

  return {
    known,
    value:
      known
        ? fact.value
        : null,
    resolution:
      resolution || "missing",
  };
}

function classifyBaselinePassComparability(
  issue,
  caseId
) {
  const baselineProfile =
    browserPassBaseline
      ?.executionProfile;

  const baselinePlanHash =
    resolvedHistoricalProfileFact(
      baselineProfile
        ?.canonicalPlanManifestSha256
    );

  const currentPlanHash =
    executionProfile
      ?.plan
      ?.canonicalHashManifestSha256 ||
    null;

  if (
    !baselinePlanHash.known ||
    !currentPlanHash
  ) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_PLAN",
      reasons: [
        "Canonical plan identity is not known on both sides.",
      ],
    };
  }

  if (
    baselinePlanHash.value !==
    currentPlanHash
  ) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_PLAN",
      reasons: [
        "Canonical plan manifest fingerprint differs from the historical baseline.",
      ],
    };
  }

  const baselineCase =
    browserPassBaseline
      ?.browserPassCases
      ?.find(
        (candidate) =>
          candidate?.issue === issue &&
          candidate?.caseId === caseId
      );

  const dependencies =
    baselineCase
      ?.comparisonDependencies
      ?.requiredProfileDimensions;

  if (!Array.isArray(dependencies)) {
    return {
      comparable: false,
      classification:
        "NON_COMPARABLE_EXECUTION_PROFILE",
      reasons: [
        "Historical PASS comparison dependency metadata is missing.",
      ],
    };
  }

  const reasons = [];

  for (const dependency of dependencies) {
    if (
      dependency ===
      "browserMutationsAllowed"
    ) {
      const baselineMutationPolicy =
        resolvedHistoricalProfileFact(
          baselineProfile
            ?.browserMutationsAllowed
        );

      const currentMutationPolicy =
        executionProfile
          ?.runnerPolicy
          ?.browserMutationsAllowed;

      if (
        !baselineMutationPolicy.known ||
        typeof currentMutationPolicy !==
          "boolean"
      ) {
        reasons.push(
          "Required browser mutation policy is not known on both sides."
        );

        continue;
      }

      if (
        baselineMutationPolicy.value !==
        currentMutationPolicy
      ) {
        reasons.push(
          `browserMutationsAllowed differs: ` +
            `baseline=${baselineMutationPolicy.value}, ` +
            `current=${currentMutationPolicy}.`
        );
      }

      continue;
    }

    if (
      dependency ===
      "genericBrowserHandoffProfile"
    ) {
      const baselineShadow =
        resolvedHistoricalProfileFact(
          baselineProfile
            ?.genericBrowserShadow
        );

      const baselineReadOnly =
        resolvedHistoricalProfileFact(
          baselineProfile
            ?.genericBrowserReadOnlyExecution
        );

      const currentShadow =
        resolvedCurrentRunnerOverride(
          executionProfile
            ?.runtimeResolvedOutsideRunner
            ?.genericBrowserShadow
        );

      const currentReadOnly =
        resolvedCurrentRunnerOverride(
          executionProfile
            ?.runtimeResolvedOutsideRunner
            ?.genericBrowserReadOnlyExecution
        );

      if (
        !baselineShadow.known ||
        !baselineReadOnly.known ||
        !currentShadow.known ||
        !currentReadOnly.known
      ) {
        reasons.push(
          "Required generic-browser handoff profile is not known on both sides."
        );

        continue;
      }

      if (
        baselineShadow.value !==
          currentShadow.value ||
        baselineReadOnly.value !==
          currentReadOnly.value
      ) {
        reasons.push(
          `genericBrowserHandoffProfile differs: ` +
            `baseline=(shadow=${baselineShadow.value}, ` +
            `readOnly=${baselineReadOnly.value}), ` +
            `current=(shadow=${currentShadow.value}, ` +
            `readOnly=${currentReadOnly.value}).`
        );
      }

      continue;
    }

    reasons.push(
      `Unsupported comparison dependency "${dependency}".`
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

/*
 * FINAL_13_ENVIRONMENT_COMPARABILITY_V1
 *
 * Environment non-comparability is intentionally narrow.
 *
 * A historical PASS is excluded for environment reasons only when:
 *
 * 1. the current final status is BLOCKED,
 * 2. the same case's runtime route-discovery segment contains a
 *    prerequisite GET that failed with HTTP 5xx, and
 * 3. route discovery for that same case was exhausted.
 *
 * Plain route mismatch, fixture unavailability, mutation guards,
 * generic-agent refusal, deterministic FAIL, and product findings
 * are not classified as environment failures here.
 */
function classifyBaselinePassEnvironmentComparability(
  issue,
  caseId,
  currentStatus
) {
  if (currentStatus !== "BLOCKED") {
    return {
      comparable: true,
      classification: "COMPARABLE",
      reasons: [],
    };
  }

  const log =
    browserExecutionLogsByIssue.get(
      issue
    ) || "";

  const caseStartMarker =
    `Browser runtime handoff attached to ` +
    `${caseId} `;

  const start =
    log.indexOf(caseStartMarker);

  if (start < 0) {
    return {
      comparable: true,
      classification: "COMPARABLE",
      reasons: [],
    };
  }

  const possibleEnds = [
    log.indexOf(
      "\nBrowser runtime handoff attached to ",
      start + caseStartMarker.length
    ),

    log.indexOf(
      "\nBrowser execution starts",
      start + caseStartMarker.length
    ),
  ].filter(
    (value) => value >= 0
  );

  const end =
    possibleEnds.length > 0
      ? Math.min(...possibleEnds)
      : log.length;

  const segment =
    log.slice(start, end);

  if (
    !segment.includes(
      `Runtime browser route discovery exhausted ` +
        `for ${caseId}.`
    )
  ) {
    return {
      comparable: true,
      classification: "COMPARABLE",
      reasons: [],
    };
  }

  const upstreamServerFailures =
    Array.from(
      segment.matchAll(
        /Browser route resolver GET failed\s+(\d{3}):\s+([^\s]+)/g
      )
    )
      .map((match) => ({
        status:
          Number(match[1]),
        resource:
          match[2],
      }))
      .filter(
        (failure) =>
          failure.status >= 500 &&
          failure.status <= 599
      );

  if (
    upstreamServerFailures.length === 0
  ) {
    return {
      comparable: true,
      classification: "COMPARABLE",
      reasons: [],
    };
  }

  return {
    comparable: false,
    classification:
      "NON_COMPARABLE_ENVIRONMENT",
    reasons:
      upstreamServerFailures.map(
        (failure) =>
          `Upstream prerequisite GET failed ` +
          `with HTTP ${failure.status}: ` +
          `${failure.resource}`
      ),
  };
}

function increment(bucket, status) {
  if (
    Object.prototype.hasOwnProperty.call(
      bucket,
      status
    )
  ) {
    bucket[status] += 1;
  }
}

function classifyRawBrowserBlocked(block) {
  if (
    block.includes(
      "Browser fixture gate blocked"
    )
  ) {
    return "FIXTURE_UNAVAILABLE";
  }

  if (
    block.includes(
      "Browser relevance gate rejected"
    )
  ) {
    return "RELEVANCE_GATE_REJECTED";
  }

  if (
    block.includes(
      "Runtime browser route discovery exhausted"
    )
  ) {
    return "ROUTE_DISCOVERY_EXHAUSTED";
  }

  if (
    block.includes(
      "MUTATION_SAFETY_GUARD"
    )
  ) {
    return "MUTATION_SAFETY_GUARD";
  }

  return "OTHER";
}

function getApiCaseStatus(
  apiSection,
  caseId
) {
  const escaped =
    caseId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const match =
    apiSection.match(
      new RegExp(
        `Testing:\\s+\\[${escaped}\\]` +
        `[\\s\\S]*?Result:\\s+` +
        `(PASS|FAIL|BLOCKED|` +
        `MANUAL_REQUIRED|ERROR)\\b`
      )
    );

  return match?.[1] || "UNKNOWN";
}

function getRetainedDeterministicFailureCaseIds(
  log
) {
  const retainedCaseIds = new Set();
  let currentReviewCaseId;

  for (const line of log.split(/\r?\n/)) {
    const reviewMatch =
      line.match(
        /Evidence review:\s+\[([^\]]+)\]\s+[A-Z_]+\s+\([^)]+\)/
      );

    if (reviewMatch) {
      currentReviewCaseId =
        reviewMatch[1];
      continue;
    }

    if (
      currentReviewCaseId &&
      /Evidence reconciliation audit:\s+raw=FAIL,\s+final=FAIL,\s+decision=RETAIN_DETERMINISTIC_FAIL\b/.test(
        line
      )
    ) {
      retainedCaseIds.add(
        currentReviewCaseId
      );
    }
  }

  return retainedCaseIds;
}

for (const row of rows) {
  const issueDir =
    path.join(runDir, row.issue);

  const logPath =
    path.join(issueDir, "smoke.log");

  const planPath =
    path.join(issueDir, "test-plan.json");

  const log =
    fs.existsSync(logPath)
      ? fs.readFileSync(logPath, "utf8")
      : "";

browserExecutionLogsByIssue.set(
  row.issue,
  log
);

/*
 * P5_PASS_TRUST_BEHAVIOR_PROOF_AUDIT_WIRING_V1
 *
 * Reporting/observability only. Preserve the structured
 * behavior-proof reconciliation audits already emitted by
 * the browser runner so the final regression summary does
 * not incorrectly imply that no behavior requirements were
 * observed.
 *
 * This does not participate in execution, proof, evidence
 * reconciliation, or final verdict selection.
 */
for (
  const audit of
  getBehaviorProofRequirementAudits(log)
) {
  behaviorProofRequirements.push({
    issue: row.issue,
    ...audit,
  });
}

for (
  const audit of
  getUrlTransitionProofParityAudits(log)
) {
  urlTransitionProofParityAudits.push({
    issue: row.issue,
    ...audit,
  });
}

for (
  const audit of
  getSelectedStateProofParityAudits(log)
) {
  selectedStateProofParityAudits.push({
    issue: row.issue,
    ...audit,
  });
}

  const apiSection =
    log.split(
      "Smoke Chrome Test starting..."
    )[0] || "";

  const apiStatuses =
    Array.from(
      apiSection.matchAll(
        /Result:\s+(PASS|FAIL|BLOCKED|MANUAL_REQUIRED|ERROR)\b/g
      )
    ).map((match) => match[1]);

  const browserFinalResults =
    Array.from(
      log.matchAll(
        /Final browser result:\s+\[([^\]]+)\]\s+(PASS|FAIL|BLOCKED|MANUAL_REQUIRED|ERROR)\b/g
      )
    ).map((match) => ({
      caseId: match[1],
      status: match[2],
    }));

  const browserStatuses =
    browserFinalResults.map(
      (result) => result.status
    );

  for (
    const finalResult of
    browserFinalResults
  ) {
    finalBrowserResults.push({
      issue: row.issue,
      caseId: finalResult.caseId,
      status: finalResult.status,
    });
  }

  const evidenceReviewsByCase =
    new Map();

  for (
    const match of log.matchAll(
      /Evidence review:\s+\[([^\]]+)\]\s+([A-Z_]+)\s+\(([^)]+)\)/g
    )
  ) {
    const caseId = match[1];
    const reviews =
      evidenceReviewsByCase.get(caseId) ?? [];

    reviews.push({
      verdict: match[2],
      confidence: match[3],
    });

    evidenceReviewsByCase.set(
      caseId,
      reviews
    );
  }

  const retainedDeterministicFailureCaseIds =
    getRetainedDeterministicFailureCaseIds(
      log
    );

  const browserCaseBlocks =
    Array.from(
      log.matchAll(
        /Taking photo:\s+\[[^\]]+\][\s\S]*?(?=\nTaking photo:\s+\[|\nBrowser automation completed\.)/g
      )
    ).map((match) => match[0]);

  for (const block of browserCaseBlocks) {
    if (
      !/Result:\s+BLOCKED\b/.test(block)
    ) {
      continue;
    }

    const reason =
      classifyRawBrowserBlocked(block);

    totals.browserBlockedReasons[
      reason
    ] += 1;
  }

  /*
   * Some cases reach the correct feature surface and only
   * become BLOCKED during evidence reconciliation. Count
   * those final evidence-derived reasons in the same
   * taxonomy as directly blocked browser cases.
   */
  totals.browserBlockedReasons
    .FIXTURE_UNAVAILABLE +=
    (
      log.match(
        /Evidence reconciliation:\s+\S+\s+->\s+BLOCKED\s+\((?:screenshot|video):\s+TEST_DATA_ISSUE\)/g
      ) || []
    ).length;

  totals.browserBlockedReasons
    .WRONG_ROUTE_EVIDENCE +=
    (
      log.match(
        /Evidence reconciliation:\s+\S+\s+->\s+BLOCKED\s+\((?:screenshot|video):\s+WRONG_ROUTE\)/g
      ) || []
    ).length;

  for (const status of apiStatuses) {
    increment(totals.api, status);
  }

  for (const status of browserStatuses) {
    increment(totals.browser, status);
  }

  totals.evidenceReviews +=
    (
      log.match(
        /Evidence review:\s+/g
      ) || []
    ).length;

  totals.passConfirmed +=
    (
      log.match(
        /Evidence review:\s+(?:\[[^\]\r\n]+\]\s+)?PASS_CONFIRMED\b/g
      ) || []
    ).length;

  totals.evidence404 +=
    (
      log.match(
        /Evidence review failed safely:\s+404/gi
      ) || []
    ).length;

  console.log(
    `${row.issue}: ` +
    `API P${
      apiStatuses.filter(
        (status) => status === "PASS"
      ).length
    }/B${
      apiStatuses.filter(
        (status) => status === "BLOCKED"
      ).length
    }/M${
      apiStatuses.filter(
        (status) =>
          status === "MANUAL_REQUIRED"
      ).length
    }/F${
      apiStatuses.filter(
        (status) => status === "FAIL"
      ).length
    } | Browser P${
      browserStatuses.filter(
        (status) => status === "PASS"
      ).length
    }/B${
      browserStatuses.filter(
        (status) => status === "BLOCKED"
      ).length
    }/M${
      browserStatuses.filter(
        (status) =>
          status === "MANUAL_REQUIRED"
      ).length
    }/F${
      browserStatuses.filter(
        (status) => status === "FAIL"
      ).length
    }`
  );

  const runComplete =
    row.planExit === 0 &&
    row.smokeExit === 0 &&
    row.planPresent &&
    row.reportPresent;

  if (!runComplete) {
    const failureReason =
      row.planExit !== 0 ||
      !row.planPresent
        ? (
          `plan incomplete ` +
          `(exit=${row.planExit}, ` +
          `present=${row.planPresent})`
        )
        : (
          `smoke incomplete ` +
          `(exit=${row.smokeExit}, ` +
          `report=${row.reportPresent})`
        );

    failures.push(
      `${row.issue}: ${failureReason}`
    );

    continue;
  }

  if (apiStatuses.includes("FAIL")) {
    failures.push(
      `${row.issue}: final API FAIL`
    );
  }

  for (
    const finalResult of
    browserFinalResults.filter(
      (result) => result.status === "FAIL"
    )
  ) {
    const reviews =
      evidenceReviewsByCase.get(
        finalResult.caseId
      ) ?? [];

    const latestReview =
      reviews.at(-1);

    const finding =
      `${row.issue} [${finalResult.caseId}]: ` +
      `final browser FAIL` +
      (
        latestReview
          ? ` with evidence verdict ` +
            `${latestReview.verdict} ` +
            `(${latestReview.confidence})`
          : ` without case-aware ` +
            `evidence verdict`
      );

    if (
      latestReview?.verdict ===
        "PRODUCT_BUG"
    ) {
      productFindings.push(finding);
      continue;
    }

    if (
      retainedDeterministicFailureCaseIds
        .has(finalResult.caseId)
    ) {
      deterministicFindings.push(
        `${finding}; deterministic failure retained`
      );
      continue;
    }

    if (latestReview) {
      agentRegressions.push(finding);
      failures.push(finding);
      continue;
    }

    unclassifiedFailures.push(finding);
    failures.push(finding);
  }

  if (
    apiStatuses.includes("ERROR") ||
    browserStatuses.includes("ERROR")
  ) {
    failures.push(
      `${row.issue}: runtime ERROR`
    );
  }

  if (row.issue === "AS-1196") {
    if (
      getApiCaseStatus(
        apiSection,
        "api-1"
      ) === "PASS"
    ) {
      failures.push(
        "AS-1196: unsupported API PASS"
      );
    }
  }

  /**
   * Case IDs may change between fresh AI plans.
   * Validate every case whose expected status is
   * actually UNKNOWN instead of hardcoding api-2.
   */
  if (fs.existsSync(planPath)) {
    try {
      const storedPlan =
        JSON.parse(
          fs.readFileSync(
            planPath,
            "utf8"
          )
        );

      for (
        const apiCase of
        storedPlan.apiCases ?? []
      ) {
        const expectedStatus =
          String(
            apiCase.expect?.status ?? ""
          )
            .trim()
            .toUpperCase();

        if (
          expectedStatus !== "UNKNOWN"
        ) {
          continue;
        }

        const caseId =
          String(apiCase.id || "");

        const actualStatus =
          getApiCaseStatus(
            apiSection,
            caseId
          );

        if (
          actualStatus !== "BLOCKED"
        ) {
          failures.push(
            `${row.issue}: ${caseId} has ` +
            `UNKNOWN expected status but ` +
            `final status is ${actualStatus}`
          );
        }
      }
    } catch {
      failures.push(
        `${row.issue}: stored plan JSON invalid`
      );
    }
  }
}

/*
 * Evaluate the historical canonical PASS floor only after
 * all issue logs have been parsed.
 */
if (
  canonicalPlanMode &&
  browserPassBaseline
) {
  const currentByKey =
    new Map();

  for (
    const result of
    finalBrowserResults
  ) {
    currentByKey.set(
      `${result.issue}::${result.caseId}`,
      result.status
    );
  }

  const baselineKeys =
    new Set();

  for (
    const baselineCase of
    browserPassBaseline.browserPassCases
  ) {
    const issue =
      String(
        baselineCase?.issue || ""
      ).trim();

    const caseId =
      String(
        baselineCase?.caseId || ""
      ).trim();

    if (!issue || !caseId) {
      failures.push(
        "Canonical browser PASS baseline contains " +
          "an entry without issue/caseId"
      );
      continue;
    }

    const key =
      `${issue}::${caseId}`;

    if (baselineKeys.has(key)) {
      failures.push(
        `Canonical browser PASS baseline contains ` +
          `duplicate entry ${issue} [${caseId}]`
      );
      continue;
    }

    baselineKeys.add(key);

    const currentStatus =
      currentByKey.get(key) ||
      "MISSING";

    const audit = {
      issue,
      caseId,
      baselineStatus: "PASS",
      currentStatus,
    };

    const comparability =
      classifyBaselinePassComparability(
        issue,
        caseId
      );

    if (!comparability.comparable) {
      baselinePassNonComparable.push({
        ...audit,
        classification:
          comparability.classification,
        reasons:
          comparability.reasons,
      });

      continue;
    }

    const environmentComparability =
      classifyBaselinePassEnvironmentComparability(
        issue,
        caseId,
        currentStatus
      );

    if (!environmentComparability.comparable) {
      baselinePassNonComparable.push({
        ...audit,
        classification:
          environmentComparability
            .classification,
        reasons:
          environmentComparability
            .reasons,
      });

      continue;
    }

    if (currentStatus === "PASS") {
      baselinePassPreserved.push({
        ...audit,
        classification: "PRESERVED",
      });

      continue;
    }

    baselinePassRegressions.push({
      ...audit,
      classification: "REGRESSION",
    });

    failures.push(
      `Baseline PASS regression: ` +
        `${issue} [${caseId}] ` +
        `PASS -> ${currentStatus}`
    );
  }

  for (
    const result of
    finalBrowserResults
  ) {
    if (result.status !== "PASS") {
      continue;
    }

    const key =
      `${result.issue}::${result.caseId}`;

    if (baselineKeys.has(key)) {
      continue;
    }

    coverageGains.push({
      issue: result.issue,
      caseId: result.caseId,
      baselineStatus: null,
      currentStatus: "PASS",
      classification: "GAIN",
    });
  }
}

/*
 * Audit non-PASS baseline movement independently from the
 * hard PASS regression floor.
 */
if (
  canonicalPlanMode &&
  browserPassBaseline
) {
  const allowedStatuses =
    new Set([
      "PASS",
      "FAIL",
      "BLOCKED",
      "MANUAL_REQUIRED",
      "ERROR",
    ]);

  const baselineCaseStatuses =
    browserPassBaseline
      .browserCaseStatuses;

  if (
    !Array.isArray(
      baselineCaseStatuses
    )
  ) {
    failures.push(
      "Canonical browser verdict snapshot is missing " +
        "browserCaseStatuses"
    );
  } else {
    const currentByKey =
      new Map();

    for (
      const result of
      finalBrowserResults
    ) {
      currentByKey.set(
        `${result.issue}::${result.caseId}`,
        result.status
      );
    }

    const snapshotByKey =
      new Map();

    for (
      const baselineCase of
      baselineCaseStatuses
    ) {
      const issue =
        String(
          baselineCase?.issue || ""
        ).trim();

      const caseId =
        String(
          baselineCase?.caseId || ""
        ).trim();

      const baselineStatus =
        String(
          baselineCase?.status || ""
        )
          .trim()
          .toUpperCase();

      if (
        !issue ||
        !caseId ||
        !allowedStatuses.has(
          baselineStatus
        )
      ) {
        failures.push(
          "Canonical browser verdict snapshot " +
            "contains an invalid entry"
        );

        continue;
      }

      const key =
        `${issue}::${caseId}`;

      if (snapshotByKey.has(key)) {
        failures.push(
          `Canonical browser verdict snapshot ` +
            `contains duplicate entry ` +
            `${issue} [${caseId}]`
        );

        continue;
      }

      snapshotByKey.set(
        key,
        baselineStatus
      );

      /*
       * Historical PASS cases are evaluated by the stronger
       * PASS-floor guard above. Avoid double-classifying
       * those cases here.
       */
      if (baselineStatus === "PASS") {
        continue;
      }

      const currentStatus =
        currentByKey.get(key) ||
        "MISSING";

      const audit = {
        issue,
        caseId,
        baselineStatus,
        currentStatus,
      };

      if (currentStatus === "MISSING") {
        baselineVerdictMissing.push({
          ...audit,
          classification: "MISSING",
        });

        failures.push(
          `Baseline browser verdict missing: ` +
            `${issue} [${caseId}] ` +
            `expected ${baselineStatus}`
        );

        continue;
      }

      /*
       * A non-PASS baseline becoming PASS is already
       * represented by coverageGains.
       */
      if (currentStatus === "PASS") {
        continue;
      }

      if (
        currentStatus ===
        baselineStatus
      ) {
        baselineUnchangedNonPass.push({
          ...audit,
          classification: "UNCHANGED",
        });

        continue;
      }

      baselineStatusReclassifications.push({
        ...audit,
        classification:
          "STATUS_RECLASSIFIED",
      });
    }

    /*
     * The explicit PASS floor and the complete verdict
     * snapshot must agree about every historical PASS.
     */
    for (
      const passCase of
      browserPassBaseline
        .browserPassCases
    ) {
      const issue =
        String(
          passCase?.issue || ""
        ).trim();

      const caseId =
        String(
          passCase?.caseId || ""
        ).trim();

      const snapshotStatus =
        snapshotByKey.get(
          `${issue}::${caseId}`
        );

      if (snapshotStatus !== "PASS") {
        failures.push(
          `Canonical browser baseline disagreement: ` +
            `${issue} [${caseId}] is PASS in the ` +
            `PASS floor but ${snapshotStatus || "MISSING"} ` +
            `in the verdict snapshot`
        );
      }
    }
  }
}


function getBehaviorProofRequirementAudits(
  log
) {
  const audits = [];

  for (const line of log.split(/\r?\n/)) {
    if (
      !line.includes(
        "decision=BEHAVIOR_PROOF_REQUIREMENT_PRESENT"
      )
    ) {
      continue;
    }

    const caseMatch =
      line.match(
        /\bcaseId=([^,]+)/
      );

    const claimsMatch =
      line.match(
        /behaviorClaims=(\[.*\]),\s+legacyAcceptanceCoverageGapDetected=/
      );

    const legacyGapMatch =
      line.match(
        /legacyAcceptanceCoverageGapDetected=(true|false)\b/
      );

    if (
      !caseMatch ||
      !claimsMatch ||
      !legacyGapMatch
    ) {
      continue;
    }

    let behaviorClaims = [];

    try {
      const parsed =
        JSON.parse(claimsMatch[1]);

      behaviorClaims =
        Array.isArray(parsed)
          ? parsed
          : [];
    } catch {
      behaviorClaims = [];
    }

    audits.push({
      caseId: caseMatch[1].trim(),
      behaviorClaims,
      legacyAcceptanceCoverageGapDetected:
        legacyGapMatch[1] === "true",
    });
  }

  return audits;
}

function getUrlTransitionProofParityAudits(
  log
) {
  /*
   * Screenshot + video reconciliation may audit
   * the same case more than once.
   *
   * Keep one parity observation per case so
   * regression metrics count cases, not reviewers.
   */
  const auditsByCase = new Map();

  for (const line of log.split(/\r?\n/)) {
    if (
      !line.includes(
        "decision=URL_TRANSITION_PROOF_PARITY"
      )
    ) {
      continue;
    }

    const caseMatch =
      line.match(
        /\bcaseId=([^,]+)/
      );

    const requirementCountMatch =
      line.match(
        /\burlTransitionRequirementCount=(\d+)\b/
      );

    const satisfiedCountMatch =
      line.match(
        /\burlTransitionSatisfiedCount=(\d+)\b/
      );

    const unsatisfiedCountMatch =
      line.match(
        /\burlTransitionUnsatisfiedCount=(\d+)\b/
      );

    const allSatisfiedMatch =
      line.match(
        /\burlTransitionAllSatisfied=(true|false)\b/
      );

    const legacyGapMatch =
      line.match(
        /\blegacyAcceptanceCoverageGapDetected=(true|false)\b/
      );

    if (
      !caseMatch ||
      !requirementCountMatch ||
      !satisfiedCountMatch ||
      !unsatisfiedCountMatch ||
      !allSatisfiedMatch ||
      !legacyGapMatch
    ) {
      continue;
    }

    const caseId =
      caseMatch[1].trim();

    auditsByCase.set(
      caseId,
      {
        caseId,
        urlTransitionRequirementCount:
          Number(
            requirementCountMatch[1]
          ),
        urlTransitionSatisfiedCount:
          Number(
            satisfiedCountMatch[1]
          ),
        urlTransitionUnsatisfiedCount:
          Number(
            unsatisfiedCountMatch[1]
          ),
        urlTransitionAllSatisfied:
          allSatisfiedMatch[1] ===
          "true",
        legacyAcceptanceCoverageGapDetected:
          legacyGapMatch[1] ===
          "true",
      }
    );
  }

  return [
    ...auditsByCase.values(),
  ];
}

function getSelectedStateProofParityAudits(
  log
) {
  /* Deduplicate screenshot/video audits by case. */
  const auditsByCase = new Map();

  for (const line of log.split(/\r?\n/)) {
    if (
      !line.includes(
        "decision=SELECTED_STATE_PROOF_PARITY"
      )
    ) {
      continue;
    }

    const caseMatch =
      line.match(/\bcaseId=([^,]+)/);
    const requirementCountMatch =
      line.match(
        /\bselectedStateRequirementCount=(\d+)\b/
      );
    const satisfiedCountMatch =
      line.match(
        /\bselectedStateSatisfiedCount=(\d+)\b/
      );
    const unsatisfiedCountMatch =
      line.match(
        /\bselectedStateUnsatisfiedCount=(\d+)\b/
      );
    const allSatisfiedMatch =
      line.match(
        /\bselectedStateAllSatisfied=(true|false)\b/
      );

    if (
      !caseMatch ||
      !requirementCountMatch ||
      !satisfiedCountMatch ||
      !unsatisfiedCountMatch ||
      !allSatisfiedMatch
    ) {
      continue;
    }

    const caseId =
      caseMatch[1].trim();

    auditsByCase.set(caseId, {
      caseId,
      selectedStateRequirementCount:
        Number(requirementCountMatch[1]),
      selectedStateSatisfiedCount:
        Number(satisfiedCountMatch[1]),
      selectedStateUnsatisfiedCount:
        Number(unsatisfiedCountMatch[1]),
      selectedStateAllSatisfied:
        allSatisfiedMatch[1] === "true",
    });
  }

  return [...auditsByCase.values()];
}

const completedIssues =
  rows.filter(
    (row) =>
      row.planExit === 0 &&
      row.smokeExit === 0 &&
      row.planPresent &&
      row.reportPresent
  ).length;

if (tsStatus !== 0) {
  failures.push("TypeScript failed");
}

if (rows.length !== 13) {
  failures.push(
    `Expected 13 issues, found ${rows.length}`
  );
}

if (totals.evidence404 > 0) {
  failures.push(
    `Evidence review 404: ${totals.evidence404}`
  );
}

const browserBlockedReasonTotal =
  Object.values(
    totals.browserBlockedReasons
  ).reduce(
    (sum, count) => sum + count,
    0
  );

if (
  browserBlockedReasonTotal !==
  totals.browser.BLOCKED
) {
  failures.push(
    `Browser BLOCKED taxonomy mismatch: ` +
    `${browserBlockedReasonTotal}/` +
    `${totals.browser.BLOCKED}`
  );
}

console.log();
console.log("===== FINAL TOTALS =====");

console.log(
  `API: PASS=${totals.api.PASS}, ` +
  `FAIL=${totals.api.FAIL}, ` +
  `BLOCKED=${totals.api.BLOCKED}, ` +
  `MANUAL_REQUIRED=${
    totals.api.MANUAL_REQUIRED
  }, ` +
  `ERROR=${totals.api.ERROR}`
);

console.log(
  `Browser: PASS=${totals.browser.PASS}, ` +
  `FAIL=${totals.browser.FAIL}, ` +
  `BLOCKED=${totals.browser.BLOCKED}, ` +
`MANUAL_REQUIRED=${
  totals.browser.MANUAL_REQUIRED
}, ` +
  `ERROR=${totals.browser.ERROR}`
);

console.log("Browser BLOCKED reasons:");

for (
  const [reason, count]
  of Object.entries(
    totals.browserBlockedReasons
  )
) {
  console.log(
    ` - ${reason}: ${count}`
  );
}

console.log(
  `Browser BLOCKED reason coverage: ` +
  `${browserBlockedReasonTotal}/` +
  `${totals.browser.BLOCKED}`
);

console.log(
  `Evidence reviews: ${totals.evidenceReviews}`
);

console.log(
  `Evidence PASS_CONFIRMED: ${totals.passConfirmed}`
);

console.log(
  `Evidence review 404: ${totals.evidence404}`
);

console.log(
  `Issues completed: ${completedIssues}/13`
);

console.log(
  `Product findings: ${productFindings.length}`
);

for (const finding of productFindings) {
  console.log(` - ${finding}`);
}

console.log(
  `Deterministic findings: ${deterministicFindings.length}`
);

for (const finding of deterministicFindings) {
  console.log(` - ${finding}`);
}

const behaviorProofLegacyAgreements =
  behaviorProofRequirements.filter(
    (audit) =>
      audit
        .legacyAcceptanceCoverageGapDetected
  );

const structuredOnlyBehaviorRequirements =
  behaviorProofRequirements.filter(
    (audit) =>
      !audit
        .legacyAcceptanceCoverageGapDetected
  );

const urlTransitionRequirementCount =
  urlTransitionProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.urlTransitionRequirementCount,
    0
  );

const urlTransitionSatisfiedCount =
  urlTransitionProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.urlTransitionSatisfiedCount,
    0
  );

const urlTransitionUnsatisfiedCount =
  urlTransitionProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.urlTransitionUnsatisfiedCount,
    0
  );

const urlTransitionParityDisagreements =
  urlTransitionProofParityAudits.filter(
    (audit) => {
      const structuredGapDetected =
        !audit.urlTransitionAllSatisfied;

      return (
        structuredGapDetected !==
        audit
          .legacyAcceptanceCoverageGapDetected
      );
    }
  );

const selectedStateRequirementCount =
  selectedStateProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.selectedStateRequirementCount,
    0
  );

const selectedStateSatisfiedCount =
  selectedStateProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.selectedStateSatisfiedCount,
    0
  );

const selectedStateUnsatisfiedCount =
  selectedStateProofParityAudits.reduce(
    (sum, audit) =>
      sum +
      audit.selectedStateUnsatisfiedCount,
    0
  );

console.log(
  `Behavior-proof requirements: ` +
    `${behaviorProofRequirements.length}`
);

console.log(
  `URL transition requirements: ` +
    `${urlTransitionRequirementCount}`
);

console.log(
  `URL transitions structured satisfied: ` +
    `${urlTransitionSatisfiedCount}`
);

console.log(
  `URL transitions structured unsatisfied: ` +
    `${urlTransitionUnsatisfiedCount}`
);

console.log(
  `URL transition legacy/structured disagreements: ` +
    `${urlTransitionParityDisagreements.length}`
);

for (
  const audit of
  urlTransitionParityDisagreements
) {
  console.log(
    ` - ${audit.issue} [${audit.caseId}]: ` +
      `structuredAllSatisfied=` +
      `${audit.urlTransitionAllSatisfied}, ` +
      `legacyGap=` +
      `${audit.legacyAcceptanceCoverageGapDetected}`
  );
}

console.log(
  `Selected-state requirements: ` +
    `${selectedStateRequirementCount}`
);

console.log(
  `Selected-state structured satisfied: ` +
    `${selectedStateSatisfiedCount}`
);

console.log(
  `Selected-state structured unsatisfied: ` +
    `${selectedStateUnsatisfiedCount}`
);

console.log(
  `Legacy guard agrees: ` +
    `${behaviorProofLegacyAgreements.length}`
);

console.log(
  `Structured-only requirements: ` +
    `${structuredOnlyBehaviorRequirements.length}`
);

for (
  const audit of
  structuredOnlyBehaviorRequirements
) {
  console.log(
    ` - ${audit.issue} [${audit.caseId}]: ` +
      (
        audit.behaviorClaims.length > 0
          ? audit.behaviorClaims.join(" | ")
          : "behavior claim unavailable"
      )
  );
}

/*
 * FINAL_13_BASELINE_COMPARISON_SUMMARY_V1
 *
 * Do not report historical PASS preservation against the full
 * baseline denominator when some historical PASS cases were not
 * comparable under the current plan/profile/environment.
 */
const baselinePassNonComparableByClassification =
  baselinePassNonComparable.reduce(
    (counts, audit) => {
      const classification =
        String(
          audit?.classification || "UNKNOWN"
        );

      counts[classification] =
        (counts[classification] || 0) + 1;

      return counts;
    },
    {}
  );

const historicalBaselinePassCount =
  canonicalPlanMode &&
  browserPassBaseline &&
  Array.isArray(
    browserPassBaseline.browserPassCases
  )
    ? browserPassBaseline.browserPassCases.length
    : 0;

const baselinePassComparisonSummary = {
  historicalBaselinePassCount,

  comparableCount:
    baselinePassPreserved.length +
    baselinePassRegressions.length,

  preservedCount:
    baselinePassPreserved.length,

  regressionCount:
    baselinePassRegressions.length,

  nonComparableCount:
    baselinePassNonComparable.length,

  nonComparableByClassification:
    baselinePassNonComparableByClassification,
};

console.log(
  `Baseline PASS floor: ` +
    `${
      canonicalPlanMode
        ? "ENFORCED"
        : "SKIPPED_NON_CANONICAL"
    }`
);

if (
  canonicalPlanMode &&
  browserPassBaseline
) {
  console.log(
    `Historical baseline PASS: ` +
      `${baselinePassComparisonSummary.historicalBaselinePassCount}`
  );

  console.log(
    `Comparable historical PASS: ` +
      `${baselinePassComparisonSummary.comparableCount}`
  );

  console.log(
    ` - Preserved: ` +
      `${baselinePassComparisonSummary.preservedCount}`
  );

  console.log(
    ` - Regressions: ` +
      `${baselinePassComparisonSummary.regressionCount}`
  );

  console.log(
    `Non-comparable historical PASS: ` +
      `${baselinePassComparisonSummary.nonComparableCount}`
  );

  console.log(
    ` - Execution profile: ` +
      `${
        baselinePassNonComparableByClassification[
          "NON_COMPARABLE_EXECUTION_PROFILE"
        ] || 0
      }`
  );

  console.log(
    ` - Plan: ` +
      `${
        baselinePassNonComparableByClassification[
          "NON_COMPARABLE_PLAN"
        ] || 0
      }`
  );

  console.log(
    ` - Environment: ` +
      `${
        baselinePassNonComparableByClassification[
          "NON_COMPARABLE_ENVIRONMENT"
        ] || 0
      }`
  );

  for (
    const regression of
    baselinePassRegressions
  ) {
    console.log(
      `- ${regression.issue}` +
        `[${regression.caseId}]: ` +
        `PASS -> ${regression.currentStatus}`
    );
  }

  for (
    const audit of
    baselinePassNonComparable
  ) {
    console.log(
      `- ${audit.issue}` +
        `[${audit.caseId}]: ` +
        `${audit.classification}` +
        (
          Array.isArray(audit.reasons) &&
          audit.reasons.length > 0
            ? ` — ${audit.reasons.join(" | ")}`
            : ""
        )
    );
  }

  console.log(
    `Coverage gains over baseline: ` +
      `${coverageGains.length}`
  );

  for (const gain of coverageGains) {
    console.log(
      ` - ${gain.issue} ` +
        `[${gain.caseId}]: ` +
        `new PASS`
    );
  }
}

if (
  canonicalPlanMode &&
  browserPassBaseline &&
  Array.isArray(
    browserPassBaseline
      .browserCaseStatuses
  )
) {
  const expectedNonPassCount =
    browserPassBaseline
      .browserCaseStatuses
      .filter(
        (entry) =>
          String(
            entry?.status || ""
          )
            .trim()
            .toUpperCase() !== "PASS"
      )
      .length;

  console.log(
    `Baseline non-PASS unchanged: ` +
      `${baselineUnchangedNonPass.length}/` +
      `${expectedNonPassCount}`
  );

  console.log(
    `Status reclassifications: ` +
      `${baselineStatusReclassifications.length}`
  );

  for (
    const reclassification of
    baselineStatusReclassifications
  ) {
    console.log(
      ` - ${reclassification.issue} ` +
        `[${reclassification.caseId}]: ` +
        `${reclassification.baselineStatus} -> ` +
        `${reclassification.currentStatus}`
    );
  }

  console.log(
    `Baseline verdicts missing: ` +
      `${baselineVerdictMissing.length}`
  );
}

console.log(
  `Agent regressions: ${agentRegressions.length}`
);

for (const regression of agentRegressions) {
  console.log(` - ${regression}`);
}

console.log(
  `Unclassified failures: ${unclassifiedFailures.length}`
);

for (const failure of unclassifiedFailures) {
  console.log(` - ${failure}`);
}

console.log(
  `Guard failures: ${failures.length}`
);

for (const failure of failures) {
  console.log(` - ${failure}`);
}

const ok =
  rows.length === 13 &&
  completedIssues === 13 &&
  failures.length === 0 &&
  totals.api.FAIL === 0 &&
  totals.api.ERROR === 0 &&
  totals.browser.ERROR === 0 &&
  totals.evidence404 === 0;

console.log();

console.log(
  ok
    ? "FINAL_13_REGRESSION_OK"
    : "FINAL_13_REGRESSION_REVIEW_REQUIRED"
);

fs.writeFileSync(
  path.join(
    runDir,
    "regression-summary.json"
  ),
  JSON.stringify(
    {
      runDir,
executionProfile,
      totals,
      productFindings,
      deterministicFindings,
behaviorProofRequirements,
behaviorProofLegacyAgreements,
structuredOnlyBehaviorRequirements,

urlTransitionProofParityAudits,
urlTransitionRequirementCount,
urlTransitionSatisfiedCount,
urlTransitionUnsatisfiedCount,
urlTransitionParityDisagreements,

selectedStateProofParityAudits,
selectedStateRequirementCount,
selectedStateSatisfiedCount,
selectedStateUnsatisfiedCount,

baselinePassFloor: {
comparisonSummary:
baselinePassComparisonSummary,
  enabled: canonicalPlanMode,
  baselinePath:
    browserPassBaselinePath,
  sourceRunDir:
    browserPassBaseline?.sourceRunDir ??
    null,
  expectedPassCount:
    browserPassBaseline
      ?.browserPassCases
      ?.length ?? 0,
  preserved:
    baselinePassPreserved,
nonComparable:
baselinePassNonComparable,
  regressions:
    baselinePassRegressions,
  gains:
    coverageGains,
},

baselineVerdictAudit: {
  expectedCaseCount:
    browserPassBaseline
      ?.browserCaseStatuses
      ?.length ?? 0,
  unchangedNonPass:
    baselineUnchangedNonPass,
  statusReclassifications:
    baselineStatusReclassifications,
  missing:
    baselineVerdictMissing,
},

agentRegressions,
      unclassifiedFailures,
      failures,
      rows,
      result:
        ok ? "OK" : "REVIEW_REQUIRED",
    },
    null,
    2
  )
);
NODE



echo
echo "Run klasörü:"
echo "$RUN_DIR"

echo
echo "Özet:"
echo "$RUN_DIR/regression-summary.json"
