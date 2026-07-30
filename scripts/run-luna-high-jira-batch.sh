#!/usr/bin/env bash

set -Eeuo pipefail

ISSUES=(
  "AS-1028"
  "AS-1014"
  "AS-1093"
  "AS-1190"
  "AS-1011"
  "AS-1154"
  "AS-869"
  "AS-1196"
)

MODEL="gpt-5.6-luna"
VISION_MODEL="gpt-5.6-luna"
REASONING_EFFORT="high"

STAMP="$(date +%Y%m%d-%H%M%S)"
BATCH_NAME="luna-high-jira-batch-${STAMP}"

BATCH_DIR="qa-results/runs/${BATCH_NAME}"
EXPORT_DIR="qa-results/exports"
ZIP_PATH="${EXPORT_DIR}/${BATCH_NAME}.zip"

PRESERVE_DIR="$(
  mktemp -d "/tmp/ango-qa-preserve.XXXXXX"
)"

RESTORED=0

if [[ ! -f package.json || ! -f src/cli.ts ]]; then
  echo "HATA: Proje kök klasöründe değilsin."
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "HATA: OPENAI_API_KEY bu terminalde tanımlı değil."
  echo "Preflight yaptığın terminalde scripti çalıştır."
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "HATA: zip komutu bulunamadı."
  exit 1
fi

export OLLAMA_API_KEY="$OPENAI_API_KEY"
export OLLAMA_BASE_URL="https://api.openai.com/v1"
export OLLAMA_MODEL="$MODEL"
export OLLAMA_VISION_MODEL="$VISION_MODEL"
export QA_REASONING_EFFORT="$REASONING_EFFORT"

# POST, PUT, PATCH ve DELETE güvenlik nedeniyle BLOCKED kalsın.
unset QA_ALLOW_API_MUTATIONS || true

mkdir -p "$BATCH_DIR"
mkdir -p "$EXPORT_DIR"

preserve_path() {
  local source_path="$1"
  local target_name="$2"

  if [[ -e "$source_path" ]]; then
    mv "$source_path" \
      "${PRESERVE_DIR}/${target_name}"
  fi
}

restore_original_state() {
  if [[ "$RESTORED" -eq 1 ]]; then
    return
  fi

  RESTORED=1

  rm -f qa-results/test-plan.json
  rm -f qa-results/report.md
  rm -rf qa-results/evidence
  rm -rf qa-results/videos

  if [[ -f "${PRESERVE_DIR}/test-plan.json" ]]; then
    mv "${PRESERVE_DIR}/test-plan.json" \
      qa-results/test-plan.json
  fi

  if [[ -f "${PRESERVE_DIR}/report.md" ]]; then
    mv "${PRESERVE_DIR}/report.md" \
      qa-results/report.md
  fi

  if [[ -d "${PRESERVE_DIR}/evidence" ]]; then
    mv "${PRESERVE_DIR}/evidence" \
      qa-results/evidence
  fi

  if [[ -d "${PRESERVE_DIR}/videos" ]]; then
    mv "${PRESERVE_DIR}/videos" \
      qa-results/videos
  fi

  rm -rf "$PRESERVE_DIR"

  echo
  echo "Batch öncesindeki aktif proje durumu geri yüklendi."
}

preserve_path \
  "qa-results/test-plan.json" \
  "test-plan.json"

preserve_path \
  "qa-results/report.md" \
  "report.md"

preserve_path \
  "qa-results/evidence" \
  "evidence"

preserve_path \
  "qa-results/videos" \
  "videos"

trap restore_original_state EXIT INT TERM

printf '%s\n' "${ISSUES[@]}" \
  > "${BATCH_DIR}/issues.txt"

cat > "${BATCH_DIR}/README.md" <<EOF
# Luna High Jira Batch

- Batch: ${BATCH_NAME}
- Planner model: ${MODEL}
- Evidence model: ${VISION_MODEL}
- Reasoning effort: ${REASONING_EFFORT}
- API mutations: blocked
- Generated: $(date '+%Y-%m-%d %H:%M:%S %z')

## Issues

$(printf -- '- %s\n' "${ISSUES[@]}")

Each issue directory contains the available artifacts:

- test-plan.json
- report.md
- plan.log
- smoke.log
- metrics.json
- evidence/
- videos/
- root-artifacts/
EOF

echo "TypeScript kontrolü..."

npx tsc --noEmit

for ISSUE in "${ISSUES[@]}"; do
  ISSUE_DIR="${BATCH_DIR}/${ISSUE}"
  ROOT_ARTIFACTS_DIR="${ISSUE_DIR}/root-artifacts"
  MARKER_FILE="${PRESERVE_DIR}/${ISSUE}.marker"

  mkdir -p "$ISSUE_DIR"
  mkdir -p "$ROOT_ARTIFACTS_DIR"

  echo
  echo "=================================================="
  echo "Issue: ${ISSUE}"
  echo "Planner: ${MODEL} / ${REASONING_EFFORT}"
  echo "Evidence: ${VISION_MODEL} / ${REASONING_EFFORT}"
  echo "=================================================="

  rm -f qa-results/test-plan.json
  rm -f qa-results/report.md
  rm -rf qa-results/evidence
  rm -rf qa-results/videos

  mkdir -p qa-results/evidence
  mkdir -p qa-results/videos

  touch "$MARKER_FILE"

  PLAN_START=$SECONDS

  set +e

  QA_REASONING_EFFORT="$REASONING_EFFORT" \
    npm run plan -- --issue "$ISSUE" \
    2>&1 | tee "${ISSUE_DIR}/plan.log"

  PLAN_EXIT=${PIPESTATUS[0]}

  set -e

  PLAN_SECONDS=$((SECONDS - PLAN_START))
  PLAN_STATUS="PLAN_FAILED"

  # Key tekrar bozulursa diğer issue'ları boşuna deneme.
  if grep -qiE \
    'invalid_api_key|Incorrect API key|AuthenticationError: 401' \
    "${ISSUE_DIR}/plan.log"
  then
    echo
    echo "HATA: OpenAI authentication başarısız."
    echo "Batch ilk authentication hatasında durduruldu."
    exit 1
  fi

  if [[ "$PLAN_EXIT" -eq 0 &&
        -f qa-results/test-plan.json ]]; then

    cp qa-results/test-plan.json \
      "${ISSUE_DIR}/test-plan.json"

    if EXPECTED_ISSUE="$ISSUE" \
      PLAN_FILE="${ISSUE_DIR}/test-plan.json" \
      node --input-type=module <<'NODE'
import fs from "node:fs";

const expectedIssue =
  process.env.EXPECTED_ISSUE;

const planFile =
  process.env.PLAN_FILE;

const raw = fs
  .readFileSync(planFile, "utf8")
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();

const plan = JSON.parse(raw);

if (plan.issueKey !== expectedIssue) {
  throw new Error(
    `Expected ${expectedIssue}, received ${plan.issueKey}`
  );
}
NODE
    then
      PLAN_STATUS="OK"
    else
      PLAN_STATUS="INVALID_PLAN"
    fi
  elif [[ -f qa-results/test-plan.json ]]; then
    cp qa-results/test-plan.json \
      "${ISSUE_DIR}/test-plan.json"

    PLAN_STATUS="PLAN_CLI_ERROR_WITH_FILE"
  else
    PLAN_STATUS="NO_PLAN"
  fi

  SMOKE_EXIT=0
  SMOKE_SECONDS=0
  SMOKE_STATUS="SKIPPED"

  if [[ "$PLAN_STATUS" == "OK" ]]; then
    SMOKE_START=$SECONDS

    set +e

    QA_REASONING_EFFORT="$REASONING_EFFORT" \
      npm run smoke -- --issue "$ISSUE" \
      2>&1 | tee "${ISSUE_DIR}/smoke.log"

    SMOKE_EXIT=${PIPESTATUS[0]}

    set -e

    SMOKE_SECONDS=$((SECONDS - SMOKE_START))

    if [[ "$SMOKE_EXIT" -eq 0 ]]; then
      SMOKE_STATUS="COMPLETED"
    else
      SMOKE_STATUS="COMPLETED_WITH_CLI_ERROR"
    fi
  else
    echo \
      "Smoke skipped because plan generation failed." \
      > "${ISSUE_DIR}/smoke.log"
  fi

  if [[ -f qa-results/report.md ]]; then
    cp qa-results/report.md \
      "${ISSUE_DIR}/report.md"
  fi

  if [[ -d qa-results/evidence ]]; then
    rm -rf "${ISSUE_DIR}/evidence"

    mv qa-results/evidence \
      "${ISSUE_DIR}/evidence"
  fi

  if [[ -d qa-results/videos ]]; then
    rm -rf "${ISSUE_DIR}/videos"

    mv qa-results/videos \
      "${ISSUE_DIR}/videos"
  fi

  # qa-results kökünde üretilen screenshot,
  # trace, JSON ve diğer artefact'ları taşı.
  while IFS= read -r -d '' ARTIFACT; do
    BASENAME="$(basename "$ARTIFACT")"

    case "$BASENAME" in
      test-plan.json|report.md|latest-*.txt)
        continue
        ;;
    esac

    mv "$ARTIFACT" \
      "${ROOT_ARTIFACTS_DIR}/${BASENAME}"
  done < <(
    find qa-results \
      -maxdepth 1 \
      -type f \
      -newer "$MARKER_FILE" \
      -print0
  )

  PLAN_STATUS="$PLAN_STATUS" \
  SMOKE_STATUS="$SMOKE_STATUS" \
  PLAN_EXIT="$PLAN_EXIT" \
  SMOKE_EXIT="$SMOKE_EXIT" \
  PLAN_SECONDS="$PLAN_SECONDS" \
  SMOKE_SECONDS="$SMOKE_SECONDS" \
  ISSUE="$ISSUE" \
  MODEL="$MODEL" \
  VISION_MODEL="$VISION_MODEL" \
  REASONING_EFFORT="$REASONING_EFFORT" \
  ISSUE_DIR="$ISSUE_DIR" \
  node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const issueDir =
  process.env.ISSUE_DIR;

const planPath =
  path.join(issueDir, "test-plan.json");

const smokeLogPath =
  path.join(issueDir, "smoke.log");

let plan = {
  apiCases: [],
  browserCases: [],
};

if (fs.existsSync(planPath)) {
  try {
    const raw = fs
      .readFileSync(planPath, "utf8")
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    plan = JSON.parse(raw);
  } catch {
    // Invalid plan olsa da metrics.json oluştur.
  }
}

const apiCases =
  Array.isArray(plan.apiCases)
    ? plan.apiCases
    : [];

const browserCases =
  Array.isArray(plan.browserCases)
    ? plan.browserCases
    : [];

const mutatingMethods = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const mutatingApi = apiCases.filter(
  (testCase) =>
    mutatingMethods.has(
      String(testCase.method || "")
        .toUpperCase()
    )
).length;

const unknownApi = apiCases.filter(
  (testCase) =>
    String(testCase.path || "")
      .trim()
      .toUpperCase()
      .startsWith("UNKNOWN")
).length;

const unknownBrowser = browserCases.filter(
  (testCase) =>
    String(testCase.startRoute || "")
      .trim()
      .toUpperCase() === "UNKNOWN"
).length;

const smokeLog =
  fs.existsSync(smokeLogPath)
    ? fs.readFileSync(smokeLogPath, "utf8")
    : "";

const results = {
  PASS: 0,
  FAIL: 0,
  BLOCKED: 0,
  MANUAL_REQUIRED: 0,
  ERROR: 0,
};

for (const match of smokeLog.matchAll(
  /\bResult:\s*(PASS|FAIL|BLOCKED|MANUAL_REQUIRED|ERROR)\b/g
)) {
  results[match[1]] += 1;
}

const metrics = {
  issue: process.env.ISSUE,
  model: process.env.MODEL,
  visionModel: process.env.VISION_MODEL,
  reasoningEffort:
    process.env.REASONING_EFFORT,

  planStatus:
    process.env.PLAN_STATUS,

  smokeStatus:
    process.env.SMOKE_STATUS,

  planExitCode:
    Number(process.env.PLAN_EXIT),

  smokeExitCode:
    Number(process.env.SMOKE_EXIT),

  planSeconds:
    Number(process.env.PLAN_SECONDS),

  smokeSeconds:
    Number(process.env.SMOKE_SECONDS),

  apiCases: apiCases.length,
  browserCases: browserCases.length,

  totalCases:
    apiCases.length +
    browserCases.length,

  mutatingApi,
  unknownApi,
  unknownBrowser,
  results,
};

fs.writeFileSync(
  path.join(issueDir, "metrics.json"),
  JSON.stringify(metrics, null, 2) + "\n"
);

console.log("\nIssue metrics:");
console.log(metrics);
NODE

  rm -f qa-results/test-plan.json
  rm -f qa-results/report.md

  echo
  echo "${ISSUE} tamamlandı."
done

BATCH_DIR="$BATCH_DIR" \
BATCH_NAME="$BATCH_NAME" \
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const batchDir =
  process.env.BATCH_DIR;

const batchName =
  process.env.BATCH_NAME;

const issueOrder = fs
  .readFileSync(
    path.join(batchDir, "issues.txt"),
    "utf8"
  )
  .trim()
  .split("\n")
  .filter(Boolean);

const runs = issueOrder.map((issue) => {
  const metricsPath = path.join(
    batchDir,
    issue,
    "metrics.json"
  );

  return JSON.parse(
    fs.readFileSync(metricsPath, "utf8")
  );
});

const headers = [
  "issue",
  "planStatus",
  "smokeStatus",
  "planSeconds",
  "smokeSeconds",
  "apiCases",
  "browserCases",
  "totalCases",
  "mutatingApi",
  "unknownApi",
  "unknownBrowser",
  "pass",
  "fail",
  "blocked",
  "manualRequired",
  "error",
];

const rows = runs.map((run) => [
  run.issue,
  run.planStatus,
  run.smokeStatus,
  run.planSeconds,
  run.smokeSeconds,
  run.apiCases,
  run.browserCases,
  run.totalCases,
  run.mutatingApi,
  run.unknownApi,
  run.unknownBrowser,
  run.results.PASS,
  run.results.FAIL,
  run.results.BLOCKED,
  run.results.MANUAL_REQUIRED,
  run.results.ERROR,
]);

fs.writeFileSync(
  path.join(batchDir, "summary.tsv"),
  [
    headers.join("\t"),
    ...rows.map((row) => row.join("\t")),
  ].join("\n") + "\n"
);

const totals = runs.reduce(
  (total, run) => {
    total.apiCases += run.apiCases;
    total.browserCases +=
      run.browserCases;
    total.totalCases += run.totalCases;

    total.pass += run.results.PASS;
    total.fail += run.results.FAIL;
    total.blocked += run.results.BLOCKED;

    total.manualRequired +=
      run.results.MANUAL_REQUIRED;

    total.error += run.results.ERROR;

    return total;
  },
  {
    apiCases: 0,
    browserCases: 0,
    totalCases: 0,
    pass: 0,
    fail: 0,
    blocked: 0,
    manualRequired: 0,
    error: 0,
  }
);

const markdown = [
  `# ${batchName}`,
  "",
  "| Issue | Plan | Smoke | API | Browser | PASS | FAIL | BLOCKED | MANUAL | ERROR |",
  "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",

  ...runs.map((run) =>
    [
      `| ${run.issue}`,
      run.planStatus,
      run.smokeStatus,
      run.apiCases,
      run.browserCases,
      run.results.PASS,
      run.results.FAIL,
      run.results.BLOCKED,
      run.results.MANUAL_REQUIRED,
      `${run.results.ERROR} |`,
    ].join(" | ")
  ),

  "",
  "## Totals",
  "",
  `- API cases: ${totals.apiCases}`,
  `- Browser cases: ${totals.browserCases}`,
  `- Total cases: ${totals.totalCases}`,
  `- PASS: ${totals.pass}`,
  `- FAIL: ${totals.fail}`,
  `- BLOCKED: ${totals.blocked}`,
  `- MANUAL_REQUIRED: ${totals.manualRequired}`,
  `- ERROR: ${totals.error}`,
  "",
];

fs.writeFileSync(
  path.join(batchDir, "summary.md"),
  markdown.join("\n")
);

fs.writeFileSync(
  path.join(batchDir, "manifest.json"),
  JSON.stringify(
    {
      batchName,
      generatedAt:
        new Date().toISOString(),
      runs,
      totals,
    },
    null,
    2
  ) + "\n"
);
NODE

printf '%s\n' "$BATCH_DIR" \
  > "qa-results/latest-luna-high-jira-batch.txt"

restore_original_state
trap - EXIT INT TERM

rm -f "$ZIP_PATH"

(
  cd qa-results/runs

  zip -qry \
    "../exports/${BATCH_NAME}.zip" \
    "$BATCH_NAME"
)

echo
echo "================ FINAL SUMMARY ================"

if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' \
    "${BATCH_DIR}/summary.tsv"
else
  cat "${BATCH_DIR}/summary.tsv"
fi

echo
echo "Batch folder:"
echo "$BATCH_DIR"

echo
echo "ZIP file:"
echo "$ZIP_PATH"

echo
echo "ZIP size:"
du -h "$ZIP_PATH"

echo
echo "SHA-256:"
shasum -a 256 "$ZIP_PATH"
