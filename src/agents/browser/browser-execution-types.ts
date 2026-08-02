import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";

export type BrowserStep =
  | { action: "wait"; ms: number }
  | { action: "reload" }
  | { action: "clickTopTab"; text: string }
  | { action: "selectRuntimeTopTab" }
  | {
      action: "openRuntimeControl";
      target: string;
    }
  | {
      action: "selectRuntimeFilterOption";
      queryKey: string;
      hint?: string;
    }
  | {
      action: "createDraftJobAndVerifyRedirect";
      origin: "jobs" | "all-jobs";
    }
  | { action: "clickButton"; text: string }
  | { action: "clickText"; text: string }
  | { action: "openMenu"; text: string }
  | { action: "selectOption"; text: string }
  | { action: "clickProjectDropdown" }
  | { action: "selectLastDropdownOption" }
  | { action: "assertUrlContains"; text: string }
  | { action: "assertUrlNotContains"; text: string }
  | { action: "assertTextVisible"; text: string }
  | { action: "assertTextNotVisible"; text: string }
  | { action: "setViewport"; width: number; height: number };

export type BrowserStepResult = {
  status:
    | "PASS"
    | "FAIL"
    | "BLOCKED"
    | "MANUAL_REQUIRED"
    | "ERROR";
  reasonCategory: string;
  notes: string[];
  deterministicEvidence?:
    BrowserDeterministicEvidence[];
};



export type BrowserCheckpointCaptureArgs = {
  stepIndex: number;
  step: BrowserStep;
  note: string;
};

export type BrowserCheckpointCapture = (
  args: BrowserCheckpointCaptureArgs
) => Promise<void>;

export type BrowserTraceStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "MANUAL_REQUIRED"
  | "ERROR";

export type BrowserTraceStep = {
  index: number;
  action: string;
  status: BrowserTraceStatus;
  note: string;
  url?: string;
};

export type BrowserEvidenceSummary = {
  successSignal: string;
  successSignalReached: boolean;
  authWallDetected: boolean;
  pagesVisited: string[];
  keyVisibleTexts: string[];
};
