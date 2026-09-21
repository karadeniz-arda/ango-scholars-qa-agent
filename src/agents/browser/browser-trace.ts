import type {
  BrowserEvidenceCheckpoint,
} from "./evidence-review.js";
import type {
  BrowserTraceStatus,
  BrowserTraceStep,
} from "./browser-execution-types.js";

export function buildSuccessSignal(testCase: any): string {
  const successCriteria = String(testCase.successCriteria || "").trim();
  const goal = String(testCase.goal || "").trim();

  if (successCriteria) return successCriteria;
  if (goal) return goal;

  return "Expected browser assertions pass without blocked execution.";
}

export function statusFromNote(note: string): BrowserTraceStatus {
  const lower = note.toLowerCase();

  const structuredPrefix = lower.match(
    /^(pass|fail|blocked|manual_required|error):/
  )?.[1];

  if (structuredPrefix === "pass") {
    return "PASS";
  }

  if (structuredPrefix === "fail") {
    return "FAIL";
  }

  if (structuredPrefix === "blocked") {
    return "BLOCKED";
  }

  if (
    structuredPrefix ===
    "manual_required"
  ) {
    return "MANUAL_REQUIRED";
  }

  if (structuredPrefix === "error") {
    return "ERROR";
  }

  const manualRequiredSignals = [
    "manual required",
    "not visible or not safely clickable",
    "could not click",
    "could not open",
    "could not find",
    "could not resolve",
    "could not be resolved",
    "no safe unselected option",
    "could not be verified",
    "was not safely clickable",
    "fallback after",
    "clicked likely panel/item trigger",
  ];

  if (
    manualRequiredSignals.some(
      (signal) => lower.includes(signal)
    )
  ) {
    return "MANUAL_REQUIRED";
  }

  const explicitStatus =
    lower.match(
      /:\s*(pass|fail|blocked|error)\b/
    );

  if (
    explicitStatus?.[1] === "pass"
  ) {
    return "PASS";
  }

  if (
    explicitStatus?.[1] === "fail"
  ) {
    return "FAIL";
  }

  if (
    explicitStatus?.[1] === "blocked"
  ) {
    return "BLOCKED";
  }

  if (
    explicitStatus?.[1] === "error"
  ) {
    return "ERROR";
  }

  if (/^blocked\b/.test(lower)) {
    return "BLOCKED";
  }

  if (/^error\b/.test(lower)) {
    return "ERROR";
  }

  return "PASS";
}

export function buildTraceFromBrowserRun(args: {
  targetUrl: string;
  finalUrl: string;
  notes: string[];
  screenshotPath?: string;
  checkpointEvidence?:
    BrowserEvidenceCheckpoint[];
  finalStatus: BrowserTraceStatus;
}): BrowserTraceStep[] {
  const trace: BrowserTraceStep[] = [];

  trace.push({
    index: trace.length + 1,
    action: "navigate",
    status: "PASS",
    note: `Navigated to ${args.targetUrl}`,
    url: args.targetUrl,
  });

  for (const note of args.notes) {
    trace.push({
      index: trace.length + 1,
      action: "browser-step",
      status: statusFromNote(note),
      note,
      url: args.finalUrl,
    });
  }

  for (
    const checkpoint
    of args.checkpointEvidence ?? []
  ) {
    trace.push({
      index: trace.length + 1,
      action: "evidence-checkpoint",
      status: "PASS",
      note:
        `Checkpoint captured after step ` +
        `${checkpoint.stepIndex}: ` +
        `${checkpoint.label} -> ` +
        `${checkpoint.screenshotPath}`,
      url: checkpoint.url,
    });
  }

  if (args.screenshotPath) {
    trace.push({
      index: trace.length + 1,
      action: "screenshot",
      status: "PASS",
      note: `Screenshot captured: ${args.screenshotPath}`,
      url: args.finalUrl,
    });
  }

  trace.push({
    index: trace.length + 1,
    action: "final-status",
    status: args.finalStatus,
    note: `Final browser case status: ${args.finalStatus}`,
    url: args.finalUrl,
  });

  return trace;
}

export function formatTrace(trace: BrowserTraceStep[]): string {
  return trace
    .map((step) => {
      const index = String(step.index).padStart(2, "0");
      return `${index}. ${step.action} ${step.status} - ${step.note}`;
    })
    .join(" || ");
}
