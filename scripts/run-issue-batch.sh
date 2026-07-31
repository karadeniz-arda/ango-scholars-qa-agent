#!/usr/bin/env bash

set -u
set -o pipefail

if [[ $# -eq 0 ]]; then
  echo "Kullanım:"
  echo "  bash scripts/run-issue-batch.sh AS-1073 AS-1139 ..."
  exit 1
fi

if [[ ! -f "package.json" ]]; then
  echo "HATA: Bu script proje ana klasöründen çalıştırılmalı."
  exit 1
fi

ISSUES=("$@")

for ISSUE in "${ISSUES[@]}"; do
  if [[ ! "$ISSUE" =~ ^AS-[0-9]+$ ]]; then
    echo "HATA: Geçersiz Jira issue ID: $ISSUE"
    echo "Beklenen format: AS-1073"
    echo "AS-XXXX gibi placeholder kullanma."
    exit 1
  fi
done

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BATCH_NAME="${#ISSUES[@]}-issue-regression-${TIMESTAMP}"
BATCH_DIR="qa-results/runs/${BATCH_NAME}"

mkdir -p "$BATCH_DIR"

SUMMARY_TSV="${BATCH_DIR}/summary.tsv"
SUMMARY_MD="${BATCH_DIR}/summary.md"

printf \
  "ISSUE\tPLAN_EXIT\tSMOKE_EXIT\tPASS\tFAIL\tBLOCKED\tMANUAL_REQUIRED\tERROR\tTOTAL\tSTATUS\n" \
  > "$SUMMARY_TSV"

printf "%s\n" "${ISSUES[@]}" \
  > "${BATCH_DIR}/issues.txt"

date +"%Y-%m-%dT%H:%M:%S%z" \
  > "${BATCH_DIR}/started-at.txt"

git rev-parse HEAD \
  > "${BATCH_DIR}/git-commit.txt" \
  2>/dev/null || true

git status --short \
  > "${BATCH_DIR}/git-status-before.txt" \
  2>/dev/null || true

clean_current_results() {
  mkdir -p qa-results

  shopt -s nullglob dotglob

  for item in qa-results/*; do
    base_name="$(basename "$item")"

    if [[ "$base_name" == "runs" ]]; then
      continue
    fi

    if [[ "$base_name" == "archive" ]]; then
      continue
    fi

    rm -rf "$item"
  done

  shopt -u nullglob dotglob
}

copy_current_results() {
  local destination="$1"

  mkdir -p "$destination"

  shopt -s nullglob dotglob

  for item in qa-results/*; do
    base_name="$(basename "$item")"

    if [[ "$base_name" == "runs" ]]; then
      continue
    fi

    if [[ "$base_name" == "archive" ]]; then
      continue
    fi

    cp -R "$item" "$destination/"
  done

  shopt -u nullglob dotglob
}

count_status() {
  local status="$1"
  local log_file="$2"

  if [[ ! -f "$log_file" ]]; then
    echo 0
    return
  fi

  awk -v wanted="$status" '
    /Smoke Chrome Test starting/ {
      browser_started = 1
      next
    }

    browser_started != 1 &&
    $0 ~ "^[[:space:]]*Result: " wanted "([[:space:]]|$| \\()" {
      count += 1
      next
    }

    browser_started == 1 &&
    $0 ~ "^[[:space:]]*Final browser result: \\[[^]]+\\] " wanted "([[:space:]]|$)" {
      count += 1
    }

    END {
      print count + 0
    }
  ' "$log_file"
}

echo
echo "=============================================="
echo "${#ISSUES[@]}-Issue Regression Batch"
echo "Batch: $BATCH_NAME"
echo "Issue sayısı: ${#ISSUES[@]}"
echo "=============================================="
echo

CURRENT_INDEX=0

for ISSUE in "${ISSUES[@]}"; do
  CURRENT_INDEX=$((CURRENT_INDEX + 1))

  ISSUE_DIR="${BATCH_DIR}/${ISSUE}"
  PLAN_LOG="${ISSUE_DIR}/plan.log"
  SMOKE_LOG="${ISSUE_DIR}/smoke.log"
  ARTIFACT_DIR="${ISSUE_DIR}/artifacts"

  mkdir -p "$ISSUE_DIR"

  echo
  echo "=============================================="
  echo "[$CURRENT_INDEX/${#ISSUES[@]}] $ISSUE"
  echo "=============================================="

  clean_current_results

  echo
  echo "[$ISSUE] Plan oluşturuluyor..."
  echo

  npm run plan -- --issue "$ISSUE" \
    2>&1 | tee "$PLAN_LOG"

  PLAN_EXIT="${PIPESTATUS[0]}"

  if [[ "$PLAN_EXIT" -ne 0 ]]; then
    echo
    echo "[$ISSUE] PLAN FAILED — kalan issue'lara devam ediliyor."

    copy_current_results "$ARTIFACT_DIR"

    printf \
      "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$ISSUE" \
      "$PLAN_EXIT" \
      "-" \
      "0" \
      "0" \
      "0" \
      "0" \
      "0" \
      "0" \
      "PLAN_FAILED" \
      >> "$SUMMARY_TSV"

    continue
  fi

  if [[ ! -f "qa-results/test-plan.json" ]]; then
    echo
    echo "[$ISSUE] PLAN FILE MISSING — smoke çalıştırılmayacak."

    copy_current_results "$ARTIFACT_DIR"

    printf \
      "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$ISSUE" \
      "$PLAN_EXIT" \
      "-" \
      "0" \
      "0" \
      "0" \
      "0" \
      "0" \
      "0" \
      "PLAN_FILE_MISSING" \
      >> "$SUMMARY_TSV"

    continue
  fi

  cp qa-results/test-plan.json \
    "${ISSUE_DIR}/test-plan.json"

  echo
  echo "[$ISSUE] Smoke çalıştırılıyor..."
  echo

  npm run smoke -- --issue "$ISSUE" \
    2>&1 | tee "$SMOKE_LOG"

  SMOKE_EXIT="${PIPESTATUS[0]}"

  copy_current_results "$ARTIFACT_DIR"

  if [[ -f "qa-results/report.md" ]]; then
    cp qa-results/report.md \
      "${ISSUE_DIR}/report.md"
  fi

  if [[ -f "qa-results/test-plan.json" ]]; then
    cp qa-results/test-plan.json \
      "${ISSUE_DIR}/test-plan-after-smoke.json"
  fi

  PASS_COUNT="$(count_status "PASS" "$SMOKE_LOG")"
  FAIL_COUNT="$(count_status "FAIL" "$SMOKE_LOG")"
  BLOCKED_COUNT="$(count_status "BLOCKED" "$SMOKE_LOG")"
  MANUAL_COUNT="$(count_status "MANUAL_REQUIRED" "$SMOKE_LOG")"
  ERROR_COUNT="$(count_status "ERROR" "$SMOKE_LOG")"

  TOTAL_COUNT=$((
    PASS_COUNT +
    FAIL_COUNT +
    BLOCKED_COUNT +
    MANUAL_COUNT +
    ERROR_COUNT
  ))

  if [[ "$SMOKE_EXIT" -ne 0 ]]; then
    ISSUE_STATUS="SMOKE_COMMAND_FAILED"
  elif [[ "$ERROR_COUNT" -gt 0 ]]; then
    ISSUE_STATUS="ERROR"
  elif [[ "$FAIL_COUNT" -gt 0 ]]; then
    ISSUE_STATUS="FAIL"
  elif [[ "$MANUAL_COUNT" -gt 0 ]]; then
    ISSUE_STATUS="MANUAL_REQUIRED"
  elif [[ "$BLOCKED_COUNT" -gt 0 ]]; then
    ISSUE_STATUS="COMPLETED_WITH_BLOCKED"
  else
    ISSUE_STATUS="PASS"
  fi

  printf \
    "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$ISSUE" \
    "$PLAN_EXIT" \
    "$SMOKE_EXIT" \
    "$PASS_COUNT" \
    "$FAIL_COUNT" \
    "$BLOCKED_COUNT" \
    "$MANUAL_COUNT" \
    "$ERROR_COUNT" \
    "$TOTAL_COUNT" \
    "$ISSUE_STATUS" \
    >> "$SUMMARY_TSV"

  echo
  echo "[$ISSUE] Tamamlandı:"
  echo "  PASS:            $PASS_COUNT"
  echo "  FAIL:            $FAIL_COUNT"
  echo "  BLOCKED:         $BLOCKED_COUNT"
  echo "  MANUAL_REQUIRED: $MANUAL_COUNT"
  echo "  ERROR:           $ERROR_COUNT"
  echo "  STATUS:          $ISSUE_STATUS"
done

date +"%Y-%m-%dT%H:%M:%S%z" \
  > "${BATCH_DIR}/finished-at.txt"

git status --short \
  > "${BATCH_DIR}/git-status-after.txt" \
  2>/dev/null || true

{
  echo "# ${#ISSUES[@]}-Issue Regression Summary"
  echo
  echo "- Batch: \`$BATCH_NAME\`"
  echo "- Started: \`$(cat "${BATCH_DIR}/started-at.txt")\`"
  echo "- Finished: \`$(cat "${BATCH_DIR}/finished-at.txt")\`"
  echo "- Issue count: \`${#ISSUES[@]}\`"
  echo
  echo "| Issue | Plan | Smoke | PASS | FAIL | BLOCKED | MANUAL | ERROR | Total | Status |"
  echo "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"

  tail -n +2 "$SUMMARY_TSV" |
    while IFS=$'\t' read -r \
      issue \
      plan_exit \
      smoke_exit \
      pass_count \
      fail_count \
      blocked_count \
      manual_count \
      error_count \
      total_count \
      status
    do
      echo "| $issue | $plan_exit | $smoke_exit | $pass_count | $fail_count | $blocked_count | $manual_count | $error_count | $total_count | $status |"
    done
} > "$SUMMARY_MD"

printf '%s\n' "$BATCH_DIR" \
  > qa-results/latest-batch-dir.txt

echo
echo "=============================================="
echo "BATCH TAMAMLANDI"
echo "=============================================="
echo
echo "Klasör:"
echo "  $BATCH_DIR"
echo
echo "Özet:"
echo "  $SUMMARY_MD"
echo

if command -v column >/dev/null 2>&1; then
  column -t -s $'\t' "$SUMMARY_TSV"
else
  cat "$SUMMARY_TSV"
fi
