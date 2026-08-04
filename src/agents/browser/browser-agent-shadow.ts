import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import {
  observeBrowserPage,
  type BrowserObservation,
} from "./browser-observation.js";

export type BrowserShadowDecision =
  | "PROPOSE_ACTION"
  | "PROPOSE_ROUTE"
  | "GOAL_ALREADY_SATISFIED"
  | "NO_SAFE_ACTION"
  | "NEEDS_MORE_CONTEXT";

export type BrowserShadowActionKind =
  | "navigate"
  | "click"
  | "select"
  | "fill"
  | "assert"
  | "observe";

export type BrowserShadowConfidence =
  | "low"
  | "medium"
  | "high";

export type BrowserShadowAction = {
  kind: BrowserShadowActionKind;
  target: string;
  value?: string;
};

export type BrowserShadowProposal = {
  decision: BrowserShadowDecision;
  rationale: string;
  confidence: BrowserShadowConfidence;
  action?: BrowserShadowAction;
  expectedStateChange?: string;
};

export type BrowserShadowTestCase = {
  id?: unknown;
  persona?: unknown;
  goal?: unknown;
  startRoute?: unknown;
  successCriteria?: unknown;
  automatedChecks?: unknown;
  manualChecks?: unknown;
  fixtureRequirements?: unknown;
  steps?: unknown;
};

export type BrowserShadowModelInput = {
  issueKey: string;
  caseId: string;
  persona: string;
  goal: string;
  successCriteria: string;
  plannedStartRoute: string;
  currentUrl: string;
  automatedChecks: string[];
  manualChecks: string[];
  fixtureRequirements: string[];
  plannedSteps: unknown[];
  observation: BrowserObservation;
};

export type BrowserShadowRequestProposal = (
  input: BrowserShadowModelInput
) => Promise<unknown>;

export type RunBrowserShadowArgs = {
  page: Page;
  issueKey: string;
  testCase: BrowserShadowTestCase;
  outputRoot?: string;
  requestProposal?: BrowserShadowRequestProposal;
  now?: () => Date;
};

export type BrowserShadowRunResult =
  | {
      status: "SKIPPED";
      note: string;
    }
  | {
      status: "RECORDED";
      note: string;
      artifactPath: string;
      proposal: BrowserShadowProposal;
    }
  | {
      status: "ERROR";
      note: string;
    };

const DECISIONS =
  new Set<BrowserShadowDecision>([
    "PROPOSE_ACTION",
    "PROPOSE_ROUTE",
    "GOAL_ALREADY_SATISFIED",
    "NO_SAFE_ACTION",
    "NEEDS_MORE_CONTEXT",
  ]);

const ACTION_KINDS =
  new Set<BrowserShadowActionKind>([
    "navigate",
    "click",
    "select",
    "fill",
    "assert",
    "observe",
  ]);

const CONFIDENCES =
  new Set<BrowserShadowConfidence>([
    "low",
    "medium",
    "high",
  ]);

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function normalizeText(
  value: unknown,
  maxLength = 2000
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeStringArray(
  value: unknown,
  maxItems = 30
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen =
    new Set<string>();

  for (const item of value) {
    const normalized =
      normalizeText(item, 500);

    if (
      !normalized ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function safePathSegment(
  value: unknown,
  fallback: string
): string {
  const normalized =
    normalizeText(value, 120)
      .toLowerCase()
      .replace(
        /[^a-z0-9._-]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  return normalized || fallback;
}

function parseJsonValue(
  value: unknown
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized =
    value
      .trim()
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  return JSON.parse(normalized);
}

function normalizeProposal(
  value: unknown
): BrowserShadowProposal {
  const parsed =
    parseJsonValue(value);

  if (!isRecord(parsed)) {
    throw new Error(
      "Shadow proposal must be a JSON object."
    );
  }

  const decision =
    normalizeText(
      parsed.decision,
      80
    ).toUpperCase() as
      BrowserShadowDecision;

  if (!DECISIONS.has(decision)) {
    throw new Error(
      `Unsupported shadow decision: ` +
        `${decision || "<empty>"}`
    );
  }

  const confidence =
    normalizeText(
      parsed.confidence,
      40
    ).toLowerCase() as
      BrowserShadowConfidence;

  if (!CONFIDENCES.has(confidence)) {
    throw new Error(
      `Unsupported shadow confidence: ` +
        `${confidence || "<empty>"}`
    );
  }

  const rationale =
    normalizeText(
      parsed.rationale,
      2000
    );

  if (!rationale) {
    throw new Error(
      "Shadow proposal rationale is required."
    );
  }

  let action:
    BrowserShadowAction | undefined;

  if (parsed.action !== undefined) {
    if (!isRecord(parsed.action)) {
      throw new Error(
        "Shadow proposal action must be an object."
      );
    }

    const kind =
      normalizeText(
        parsed.action.kind,
        40
      ).toLowerCase() as
        BrowserShadowActionKind;

    if (!ACTION_KINDS.has(kind)) {
      throw new Error(
        `Unsupported shadow action kind: ` +
          `${kind || "<empty>"}`
      );
    }

    const target =
      normalizeText(
        parsed.action.target,
        500
      );

    if (!target) {
      throw new Error(
        "Shadow action target is required."
      );
    }

    const valueText =
      normalizeText(
        parsed.action.value,
        500
      );

    action = {
      kind,
      target,
      ...(
        valueText
          ? { value: valueText }
          : {}
      ),
    };
  }

  const expectedStateChange =
    normalizeText(
      parsed.expectedStateChange,
      1000
    );

  return {
    decision,
    rationale,
    confidence,
    ...(action ? { action } : {}),
    ...(
      expectedStateChange
        ? { expectedStateChange }
        : {}
    ),
  };
}

function buildModelInput(
  issueKey: string,
  testCase: BrowserShadowTestCase,
  observation: BrowserObservation
): BrowserShadowModelInput {
  return {
    issueKey:
      normalizeText(
        issueKey,
        120
      ),
    caseId:
      normalizeText(
        testCase.id,
        120
      ) || "unknown-case",
    persona:
      normalizeText(
        testCase.persona,
        120
      ) || "unknown",
    goal:
      normalizeText(
        testCase.goal,
        3000
      ),
    successCriteria:
      normalizeText(
        testCase.successCriteria,
        3000
      ),
    plannedStartRoute:
      normalizeText(
        testCase.startRoute,
        1000
      ),
    currentUrl:
      observation.url,
    automatedChecks:
      normalizeStringArray(
        testCase.automatedChecks
      ),
    manualChecks:
      normalizeStringArray(
        testCase.manualChecks
      ),
    fixtureRequirements:
      normalizeStringArray(
        testCase.fixtureRequirements
      ),
    plannedSteps:
      Array.isArray(
        testCase.steps
      )
        ? testCase.steps.slice(0, 40)
        : [],
    observation,
  };
}

async function requestModelProposal(
  input: BrowserShadowModelInput
): Promise<unknown> {
  /*
   * Load the model client only when a real shadow request
   * is made. Disabled mode and injected test requesters
   * must not construct a credential-requiring client.
   */
  const {
    getReasoningOptions,
    ollamaClient,
  } = await import(
    "../../llm/ollama-client.js"
  );

  const systemPrompt = `
You are a browser QA navigation agent running in SHADOW mode.

Inspect the supplied test goal, planned route, current page observation, and existing planned steps.

Propose only one safe next decision. Never claim that an action was executed.

Return only a JSON object:

{
  "decision": "PROPOSE_ACTION | PROPOSE_ROUTE | GOAL_ALREADY_SATISFIED | NO_SAFE_ACTION | NEEDS_MORE_CONTEXT",
  "action": {
    "kind": "navigate | click | select | fill | assert | observe",
    "target": "an exact visible label, semantic target, route, or assertion target",
    "value": "optional value"
  },
  "expectedStateChange": "the expected visible or structural change",
  "rationale": "brief explanation grounded in the supplied observation",
  "confidence": "low | medium | high"
}

Rules:
- Use only supplied evidence.
- Prefer accessible labels and semantic roles.
- Use PROPOSE_ROUTE only for a concrete grounded route.
- Use NEEDS_MORE_CONTEXT when route, record, permission, or state cannot be derived.
- Use NO_SAFE_ACTION for destructive, irreversible, ambiguous, or unauthorized operations.
- Do not infer product PASS or FAIL.
- Do not return multiple actions.
- Do not include markdown.
`.trim();

  const response =
    await ollamaClient
      .chat
      .completions
      .create({
        model:
          process.env
            .QA_GENERIC_BROWSER_MODEL ||
          process.env.OLLAMA_MODEL ||
          "gpt-4o-mini",
        ...getReasoningOptions(),
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content:
              JSON.stringify(
                input,
                null,
                2
              ),
          },
        ],
      } as any);

  return (
    response.choices[0]
      ?.message
      .content || "{}"
  );
}

function shadowEnabled(): boolean {
  return (
    process.env
      .QA_GENERIC_BROWSER_SHADOW ===
    "true"
  );
}

function resolveOutputRoot(
  requestedRoot: string | undefined
): string {
  return path.resolve(
    requestedRoot ||
    process.env
      .QA_GENERIC_BROWSER_SHADOW_OUTPUT_DIR ||
    "qa-results/generic-browser-shadow"
  );
}

function writeJsonAtomically(
  artifactPath: string,
  value: unknown
): void {
  const directory =
    path.dirname(artifactPath);

  fs.mkdirSync(
    directory,
    { recursive: true }
  );

  const temporaryPath =
    `${artifactPath}.tmp-` +
    `${process.pid}-` +
    `${Date.now()}`;

  try {
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(
        value,
        null,
        2
      ) + "\n",
      "utf8"
    );

    fs.renameSync(
      temporaryPath,
      artifactPath
    );
  } finally {
    if (
      fs.existsSync(temporaryPath)
    ) {
      fs.rmSync(
        temporaryPath,
        { force: true }
      );
    }
  }
}

export async function runGenericBrowserShadow(
  args: RunBrowserShadowArgs
): Promise<BrowserShadowRunResult> {
  if (!shadowEnabled()) {
    return {
      status: "SKIPPED",
      note:
        "Generic browser shadow mode is disabled.",
    };
  }

  try {
    const observation =
      await observeBrowserPage(
        args.page
      );

    const modelInput =
      buildModelInput(
        args.issueKey,
        args.testCase,
        observation
      );

    const requestProposal =
      args.requestProposal ??
      requestModelProposal;

    const proposal =
      normalizeProposal(
        await requestProposal(
          modelInput
        )
      );

    const now =
      args.now?.() ??
      new Date();

    const timestamp =
      now
        .toISOString()
        .replace(
          /[:.]/g,
          "-"
        );

    const artifactPath =
      path.join(
        resolveOutputRoot(
          args.outputRoot
        ),
        safePathSegment(
          args.issueKey,
          "unknown-issue"
        ),
        `${safePathSegment(
          args.testCase.id,
          "unknown-case"
        )}-${timestamp}.json`
      );

    const artifact = {
      schemaVersion: 1,
      mode: "shadow",
      createdAt:
        now.toISOString(),
      issueKey:
        modelInput.issueKey,
      caseId:
        modelInput.caseId,
      persona:
        modelInput.persona,
      goal:
        modelInput.goal,
      successCriteria:
        modelInput.successCriteria,
      plannedStartRoute:
        modelInput
          .plannedStartRoute,
      currentUrl:
        modelInput.currentUrl,
      observation:
        modelInput.observation,
      proposal,
      safety: {
        executed: false,
        affectedTestResult: false,
        mutationRequested: false,
      },
    };

    writeJsonAtomically(
      artifactPath,
      artifact
    );

    return {
      status: "RECORDED",
      note:
        `Generic browser shadow proposal recorded: ` +
        `${artifactPath}`,
      artifactPath,
      proposal,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      status: "ERROR",
      note:
        `Generic browser shadow proposal was not recorded: ` +
        `${message}`,
    };
  }
}
