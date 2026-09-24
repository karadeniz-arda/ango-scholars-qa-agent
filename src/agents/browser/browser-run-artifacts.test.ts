import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  beginBrowserRunArtifacts,
  browserRunCaseEvidenceDirectory,
  writeBrowserRunOperatorArtifacts,
} from "./browser-run-artifacts.js";

test("creates one self-contained run root without using result output as verdict authority", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "browser-run-artifacts-"));
  try {
    const consumedPlanPath = path.join(directory, "active-plan.json");
    const plan = Buffer.from('{"issueKey":"AS-1058","browserCases":[]}\n');
    fs.writeFileSync(consumedPlanPath, plan);
    const context = beginBrowserRunArtifacts({
      issueKey: "AS-1058",
      consumedPlanPath,
      now: new Date("2026-09-23T00:00:00.000Z"),
      outputRoot: path.join(directory, "runs"),
    });
    assert.deepEqual(fs.readFileSync(context.planPath), plan);
    const evidenceDirectory = browserRunCaseEvidenceDirectory(context, "case-1");
    assert.equal(evidenceDirectory.startsWith(context.evidenceDirectory), true);

    const canonicalVerdict = {
      verdict: "BLOCKED",
      reason: "TARGET_VERIFICATION_FAILED",
      requiredCheckIds: ["check-1"],
      passedCheckIds: [],
      failedCheckIds: [],
      missingCheckIds: ["check-1"],
    };
    writeBrowserRunOperatorArtifacts({
      context,
      issueKey: "AS-1058",
      results: [{
        id: "case-1",
        status: "PASS",
        caseVerdict: canonicalVerdict,
        deterministicPassRuntimeContext: { acceptedRoutePath: { status: "AVAILABLE", value: "/company/example" } },
        humanReadableResult: { technical: { reasonCode: "TARGET_VERIFICATION_FAILED" }, reason: { category: "TARGET_GROUNDING", explanation: "Target was not grounded." } },
      }],
      executionProfile: { genericSemanticAgent: true, safeGenericExecution: true, evidenceReview: true, persistentBrowserMutations: false, apiMutations: false, fixtureProvisioning: false },
      caseMetadataById: { "case-1": { persona: "company_admin" } },
    });
    const result = JSON.parse(fs.readFileSync(context.resultPath, "utf8"));
    assert.equal(result.summary.BLOCKED, 1);
    assert.equal(result.summary.PASS, 0);
    assert.equal(result.cases[0].persona, "company_admin");
    assert.equal(result.cases[0].status, "BLOCKED");
    assert.match(fs.readFileSync(context.summaryPath, "utf8"), /TARGET_VERIFICATION_FAILED/);
    assert.equal(fs.existsSync(context.videosDirectory), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
