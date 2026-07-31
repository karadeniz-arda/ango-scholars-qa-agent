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

grep '^OLLAMA_VISION_MODEL=' .env \
  || echo "Vision model bulunamadı."

npx tsc --noEmit
TS_STATUS=$?

if [[ "$TS_STATUS" -eq 0 ]]; then
  echo "TypeScript: PASS"
else
  echo "TypeScript: FAIL"
fi

for ISSUE in "${ISSUES[@]}"; do
  ISSUE_DIR="$RUN_DIR/$ISSUE"

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
        npm run smoke -- --issue "$ISSUE" \
      2>&1 | tee "$ISSUE_DIR/smoke.log"

    SMOKE_STATUS=${PIPESTATUS[0]}

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
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const runDir = process.env.RUN_DIR;
const tsStatus =
  Number(process.env.TS_STATUS || "1");

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
const agentRegressions = [];
const unclassifiedFailures = [];

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

  if (row.issue === "AS-1073") {
    if (
      getApiCaseStatus(
        apiSection,
        "api-1"
      ) === "PASS"
    ) {
      failures.push(
        "AS-1073: unsupported API PASS"
      );
    }
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
      totals,
      productFindings,
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
