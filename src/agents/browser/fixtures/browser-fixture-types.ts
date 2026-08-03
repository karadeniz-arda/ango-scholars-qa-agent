import type {
  Page,
} from "playwright";
import type {
  RuntimeResourceContext,
} from "../../../runtime/runtime-context.js";
import type {
  BrowserPersona,
} from "../browser-session-manager.js";
import type {
  DeferredCleanup,
} from "../browser-deferred-cleanup.js";
import type {
  BrowserDeterministicEvidence,
} from "../evidence-review.js";

export type BrowserFixturePhase =
  | "setup"
  | "cleanup";

export type BrowserFixtureCheckpointArgs = {
  phase: BrowserFixturePhase;
  label: string;
  note: string;
  fullPage?: boolean;
};

export type BrowserFixtureCheckpointCapture = (
  args: BrowserFixtureCheckpointArgs
) => Promise<void>;

export type BrowserFixtureCleanupRegistration = (
  cleanup: DeferredCleanup
) => void;

export type BrowserFixtureMatchContext = {
  issueKey: string;
  testCase: any;
};

export type BrowserFixtureProviderContext =
  BrowserFixtureMatchContext & {
    page: Page;
    persona: BrowserPersona;
    baseUrl: string;
    runtimeResourceContext?:
      RuntimeResourceContext;
    captureCheckpoint?:
      BrowserFixtureCheckpointCapture;
    registerCleanup?:
      BrowserFixtureCleanupRegistration;
  };

export type BrowserFixtureReadyResult = {
  status: "READY";
  notes: string[];
  deterministicEvidence:
    BrowserDeterministicEvidence[];
  cleanups: DeferredCleanup[];
};

export type BrowserFixtureFailureResult = {
  status: "BLOCKED" | "ERROR";
  reasonCategory: string;
  notes: string[];
  deterministicEvidence:
    BrowserDeterministicEvidence[];
  cleanups: DeferredCleanup[];
};

export type BrowserFixtureProviderResult =
  | BrowserFixtureReadyResult
  | BrowserFixtureFailureResult;

export type BrowserFixtureResolvedResult =
  BrowserFixtureProviderResult & {
    providerId: string;
  };

export type BrowserFixtureNotApplicableResult = {
  status: "NOT_APPLICABLE";
  providerId: null;
  notes: string[];
  deterministicEvidence: [];
  cleanups: [];
};

export type BrowserFixturePreparationResult =
  | BrowserFixtureNotApplicableResult
  | BrowserFixtureResolvedResult;

export type BrowserFixtureProvider = {
  id: string;

  supports: (
    context: BrowserFixtureMatchContext
  ) => boolean;

  prepare: (
    context: BrowserFixtureProviderContext
  ) => Promise<BrowserFixtureProviderResult>;
};
