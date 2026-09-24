import fs from "node:fs";
import path from "node:path";

export type BrowserRunArtifactContext = {
  runRoot: string;
  planPath: string;
  resultPath: string;
  summaryPath: string;
  reportPath: string;
  evidenceDirectory: string;
  videosDirectory: string;
};

let activeContext: BrowserRunArtifactContext | null = null;

function runName(issueKey: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  const safeIssueKey = issueKey.replace(/[^a-z0-9_-]+/gi, "-") || "unknown-issue";
  return `${timestamp}-${safeIssueKey}`;
}

export function beginBrowserRunArtifacts(args: { issueKey: string; consumedPlanPath: string; now?: Date; outputRoot?: string }): BrowserRunArtifactContext {
  const baseName = runName(args.issueKey, args.now ?? new Date());
  const outputRoot = args.outputRoot ?? path.join("qa-results", "runs");
  let runRoot = path.join(outputRoot, baseName);
  let suffix = 1;
  while (fs.existsSync(runRoot)) {
    runRoot = path.join(outputRoot, `${baseName}-${suffix}`);
    suffix += 1;
  }
  const context: BrowserRunArtifactContext = {
    runRoot,
    planPath: path.join(runRoot, "test-plan.json"),
    resultPath: path.join(runRoot, "result.json"),
    summaryPath: path.join(runRoot, "summary.md"),
    reportPath: path.join(runRoot, "report.md"),
    evidenceDirectory: path.join(runRoot, "evidence"),
    videosDirectory: path.join(runRoot, "videos"),
  };
  fs.mkdirSync(context.evidenceDirectory, { recursive: true });
  fs.mkdirSync(context.videosDirectory, { recursive: true });
  fs.copyFileSync(args.consumedPlanPath, context.planPath);
  activeContext = context;
  return context;
}

export function getActiveBrowserRunArtifacts(): BrowserRunArtifactContext | null {
  return activeContext;
}

export function browserRunCaseEvidenceDirectory(context: BrowserRunArtifactContext, caseId: string): string {
  const directory = path.join(context.evidenceDirectory, caseId);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function canonicalStatus(result: any): string { return result.caseVerdict?.verdict ?? result.status ?? "ERROR"; }
function acceptedRoute(result: any): string | null {
  const route = result.deterministicPassRuntimeContext?.acceptedRoutePath;
  return route?.status === "AVAILABLE" ? route.value : null;
}
function checkCounts(result: any) {
  const verdict = result.caseVerdict;
  return { required: verdict?.requiredCheckIds?.length ?? 0, passed: verdict?.passedCheckIds?.length ?? 0, failed: verdict?.failedCheckIds?.length ?? 0, missing: verdict?.missingCheckIds?.length ?? 0 };
}
function evidencePaths(result: any): string[] {
  return [...new Set([result.screenshotPath, ...(result.checkpointEvidence ?? []).map((item: any) => item.screenshotPath)].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

export function writeBrowserRunOperatorArtifacts(args: {
  context: BrowserRunArtifactContext;
  issueKey: string;
  results: any[];
  caseMetadataById?: Record<string, { persona?: string }>;
  executionProfile: { genericSemanticAgent: boolean; safeGenericExecution: boolean; evidenceReview: boolean; persistentBrowserMutations: boolean; apiMutations: boolean; fixtureProvisioning: boolean };
}): void {
  const statuses = ["PASS", "FAIL", "BLOCKED", "MANUAL_REQUIRED", "ERROR"] as const;
  const cases = args.results.map((result) => {
    const status = canonicalStatus(result);
    const readable = result.humanReadableResult;
    const reason = readable?.technical?.reasonCode ?? result.caseVerdict?.blockerDiagnostic ?? result.caseVerdict?.reason ?? result.reasonCategory ?? "not recorded";
    return {
      id: String(result.id ?? "unknown-case"),
      ...((result.persona ?? args.caseMetadataById?.[String(result.id ?? "")]?.persona)
        ? { persona: result.persona ?? args.caseMetadataById?.[String(result.id ?? "")]?.persona }
        : {}),
      ...(acceptedRoute(result) ? { acceptedRoute: acceptedRoute(result) } : {}),
      status,
      technicalReason: reason,
      firstBlocker: { stage: readable?.reason?.category ?? "EXECUTION_CONTEXT", code: reason, explanation: readable?.reason?.explanation ?? "No presentation-safe deterministic explanation was recorded." },
      checks: checkCounts(result),
      evidencePaths: evidencePaths(result),
      ...(result.videoPath ? { videoPath: result.videoPath } : {}),
    };
  });
  const summary = Object.fromEntries(statuses.map((status) => [status, cases.filter((item) => item.status === status).length]));
  fs.writeFileSync(args.context.resultPath, `${JSON.stringify({ issueKey: args.issueKey, generatedAt: new Date().toISOString(), runRoot: args.context.runRoot, executionProfile: args.executionProfile, summary: { caseCount: cases.length, ...summary }, cases }, null, 2)}\n`, "utf8");
  const sections = cases.map((item) => [
    `## ${item.id}`, "", `Status: ${item.status}`,
    ...(item.persona ? [`Persona: ${item.persona}`] : []),
    ...(item.acceptedRoute ? [`Route: ${item.acceptedRoute}`] : []),
    `Checks: ${item.checks.passed} passed / ${item.checks.failed} failed / ${item.checks.missing} missing`,
    `Result: ${item.technicalReason}`,
    ...(item.status === "BLOCKED" ? [`Blocked at: ${item.firstBlocker.stage}`, `Reason: ${item.firstBlocker.explanation}`] : []),
    ...(item.evidencePaths.length ? [`Evidence: ${item.evidencePaths.join(", ")}`] : []),
    ...(item.videoPath ? [`Video: ${item.videoPath}`] : []),
  ].join("\n"));
  fs.writeFileSync(args.context.summaryPath, [`# ${args.issueKey} Browser Run`, "", ...statuses.map((status) => `${status}: ${summary[status]}`), "", ...sections, ""].join("\n"), "utf8");
}
