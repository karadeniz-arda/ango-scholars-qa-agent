import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./run-browser-cases.ts", import.meta.url),
  "utf8"
);

test("runner applies CASE_VERDICT before recording non-authoritative raw-PASS coverage metadata", () => {
  const caseVerdict = source.indexOf("const caseVerdict = deriveBrowserCaseVerdict({");
  const canonicalApply = source.indexOf("applyBrowserCaseVerdict(stepResult, caseVerdict);");
  const rawAttempt = source.indexOf("attemptDeterministicBrowserPass({", canonicalApply);
  assert.ok(rawAttempt >= 0);
  assert.ok(caseVerdict >= 0);
  assert.ok(canonicalApply > caseVerdict);
  assert.ok(rawAttempt > canonicalApply);
  assert.match(source, /caseVerdict: stepResult\.caseVerdict/);
  assert.match(source, /caseVerdict: discoveryResult\.caseVerdict/);
  assert.match(source, /runtimeExecutionBinding: discoveryResult\.runtimeExecutionBinding/);
  assert.match(source, /runnerStatus: "ERROR"/);
  assert.doesNotMatch(source, /caseVerdict\s*===\s*["']PASS["'][\s\S]{0,120}status\s*=\s*["']PASS["']/);
  const discoveryContractMaterialization =
    source.indexOf(
      "const discoveryVerdictContract ="
    );
  const discoveryVerdict =
    source.indexOf(
      "const discoveryCaseVerdict =",
      discoveryContractMaterialization
    );
  const discoveryResultPush =
    source.indexOf(
      "results.push({",
      discoveryVerdict
    );

  assert.ok(
    discoveryContractMaterialization >= 0
  );
  assert.ok(
    discoveryVerdict >
      discoveryContractMaterialization
  );
  assert.ok(
    discoveryResultPush >
      discoveryVerdict
  );

  const discoveryVerdictCall =
    source.slice(
      discoveryContractMaterialization,
      discoveryResultPush
    );

  assert.match(
    discoveryVerdictCall,
    /materializeBrowserRuntimeExecutionContract\(/
  );
  assert.match(
    discoveryVerdictCall,
    /deriveBrowserCaseVerdict\(\{/
  );
  assert.match(
    discoveryVerdictCall,
    /applyBrowserCaseVerdict\(discoveryResult, discoveryCaseVerdict\)/
  );
  assert.doesNotMatch(
    discoveryVerdictCall,
    /runtimeExecutionBinding/
  );
});

test("runner preserves canonical CASE_VERDICT when screenshot review is unavailable", () => {
  const unavailableReviewStart =
    source.indexOf(
      "if (!evidenceReview) {"
    );

  const availableReviewStart =
    source.indexOf(
      "currentResult.evidenceReview =",
      unavailableReviewStart
    );

  assert.ok(
    unavailableReviewStart >= 0
  );
  assert.ok(
    availableReviewStart >
      unavailableReviewStart
  );

  const unavailableReviewBranch =
    source.slice(
      unavailableReviewStart,
      availableReviewStart
    );

  const canonicalGuard =
    unavailableReviewBranch.indexOf(
      "if (currentResult.caseVerdict)"
    );

  const canonicalReconciliation =
    unavailableReviewBranch.indexOf(
      "reconcileBrowserResultFromEvidence({",
      canonicalGuard
    );

  const legacyPassDowngrade =
    unavailableReviewBranch.indexOf(
      '"PASS_EVIDENCE_UNAVAILABLE"'
    );

  assert.ok(canonicalGuard >= 0);

  assert.ok(
    canonicalReconciliation >
      canonicalGuard
  );

  assert.ok(
    legacyPassDowngrade >
      canonicalReconciliation
  );

  assert.match(
    unavailableReviewBranch,
    /review:\s*null/
  );
});
