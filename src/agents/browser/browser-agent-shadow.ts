import {
  browserMutationsAllowed,
} from "./browser-mutation-policy.js";
import fs from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import {
  observeBrowserPage,
  type BrowserObservation,
} from "./browser-observation.js";
import {
  evaluateBrowserShadowProposal,
  evaluateRuntimeDeferredTargetProposal,
  type BrowserShadowProposalEvaluation,
} from "./browser-agent-shadow-evaluator.js";
import type { PlannerRuntimeTargetGroundingContract } from "../../planner/types.js";
import {
  resolveReadOnlyContextualControl,
} from "./browser-expanded-surface-interaction.js";
import {
  deriveGenericBrowserProgressionContext,
  type GenericBrowserProgressionContext,
  type GenericBrowserProgressionTransition,
} from "./generic-browser-progression-memory.js";

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
  contextText?: string;
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
  executionCheckContract?: unknown;
  runtimeTargetGroundingContract?: PlannerRuntimeTargetGroundingContract;
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
  executedActions: BrowserShadowAction[];
  progressionContext: GenericBrowserProgressionContext;
  browserMutationsAllowed: boolean;
  canonicalDeterministicVerificationAvailable: boolean;
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
  executedActions?: BrowserShadowAction[];
  progressionHistory?: GenericBrowserProgressionTransition[];
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

/*
 * GENERIC_BROWSER_GOAL_OBSERVATION_PROVENANCE_V1
 *
 * Preserve the exact observation snapshot that grounded the
 * model proposal and deterministic evaluation.
 *
 * Downstream proof handoff may consume this snapshot later
 * instead of re-observing a potentially changed transient
 * browser state.
 */
observation: BrowserObservation;
      proposal: BrowserShadowProposal;
      evaluation: BrowserShadowProposalEvaluation;
    }
  | {
      status: "EVALUATED";
      note: string;
      observation: BrowserObservation;
      proposal: BrowserShadowProposal;
      evaluation: BrowserShadowProposalEvaluation;
    }
  | {
      status: "ERROR";
      note: string;
    };

export type BrowserShadowArtifact = {
  schemaVersion: 2;
  mode: "shadow";
  createdAt: string;
  issueKey: string;
  caseId: string;
  persona: string;
  goal: string;
  successCriteria: string;
  plannedStartRoute: string;
  currentUrl: string;
  observation: BrowserObservation;
  proposal: BrowserShadowProposal;
  evaluation: BrowserShadowProposalEvaluation;
  safety: {
    executed: false;
    affectedTestResult: false;
    mutationRequested: false;
  };
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

  const terminalDecision =
    decision ===
      "GOAL_ALREADY_SATISFIED" ||
    decision ===
      "NO_SAFE_ACTION" ||
    decision ===
      "NEEDS_MORE_CONTEXT";

  const actionRecord =
    isRecord(parsed.action)
      ? parsed.action
      : null;

  const actionIsSemanticallyEmpty =
    actionRecord !== null &&
    !normalizeText(
      actionRecord.kind,
      40
    ) &&
    !normalizeText(
      actionRecord.target,
      500
    ) &&
    !normalizeText(
      actionRecord.value,
      500
    ) &&
    !normalizeText(
      actionRecord.contextText,
      500
    );

  if (
    parsed.action !== undefined &&
    parsed.action !== null &&
    !(
      terminalDecision &&
      actionIsSemanticallyEmpty
    )
  ) {
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

    const contextText =
      normalizeText(
        parsed.action.contextText,
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
      ...(
        contextText
          ? { contextText }
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

function hasCanonicalDeterministicVerification(
  testCase: BrowserShadowTestCase
): boolean {
  const contract =
    testCase.executionCheckContract;

  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract)
  ) {
    return false;
  }

  const requiredChecks =
    (
      contract as {
        requiredChecks?: unknown;
      }
    ).requiredChecks;

  return (
    Array.isArray(requiredChecks) &&
    requiredChecks.length > 0
  );
}

export function buildGenericBrowserShadowModelInput(
  issueKey: string,
  testCase: BrowserShadowTestCase,
  observation: BrowserObservation,
  executedActions: BrowserShadowAction[],
  progressionHistory: GenericBrowserProgressionTransition[]
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
    executedActions:
      executedActions.slice(-6),
    progressionContext:
      deriveGenericBrowserProgressionContext({
        observation,
        history: progressionHistory,
      }),
    browserMutationsAllowed:
      browserMutationsAllowed(),
    canonicalDeterministicVerificationAvailable:
      hasCanonicalDeterministicVerification(
        testCase
      ),
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

  /*
   * GENERIC_BROWSER_MODEL_SAFETY_CONTRACT_PARITY_V1
   *
   * Keep the model-facing safety contract aligned with the
   * deterministic reveal-vs-value-change boundary. The evaluator
   * and executor remain authoritative.
   */
  const systemPrompt = `
You are a browser QA navigation agent running in SHADOW mode.

Inspect the supplied test goal, planned route, current page observation, existing planned steps, executedActions, and progressionContext.

executedActions contains only actions that were already executed during this bounded navigation attempt and produced a verified observable state change.

progressionContext.exhaustedPaths is bounded factual runtime history. Each item means the current semantic state matches the state where that action previously started, later verified actions returned to it, and no goal/proof progression was recorded. Treat this as advisory: choose a different grounded action or NEEDS_MORE_CONTEXT when appropriate. Do not infer a product verdict or target impossibility from it.

Propose only one safe next decision. Never claim that an action was executed.

Return only a JSON object:

{
  "decision": "PROPOSE_ACTION | PROPOSE_ROUTE | GOAL_ALREADY_SATISFIED | NO_SAFE_ACTION | NEEDS_MORE_CONTEXT",
  "action": {
    "kind": "navigate | click | select | fill | assert | observe",
    "target": "an exact visible label, semantic target, route, or assertion target",
    "value": "optional value",
    "contextText": "optional exact semantic container text for disambiguating a click target"
  },
  "expectedStateChange": "the expected visible or structural change",
  "rationale": "brief explanation grounded in the supplied observation",
  "confidence": "low | medium | high"
}

Rules:
- Use only supplied evidence.
- Prefer accessible labels and semantic roles.
- Do not repeat an exact action already listed in executedActions merely to reproduce a state change that is already visible in the current observation.
- Controls with externalPopup=true are currently exposed through an admitted popup; do not reopen a previously activated control just because its underlying form value is still empty.
- When browserMutationsAllowed=false, changing a selected value or filled form value is outside the current execution phase. Do not propose fill, select, an observed option activation, or an externalPopup control activation when such a value change is required.
- Opening or revealing transient UI state is not itself a selected-value or form-value mutation. An exact enabled non-consequential control may be clicked to reveal or expand state, and an observed input with activationSafe=true may be clicked to open or reveal its popup.
- An exact observed role=tab click that only switches the active read-only view is a transient navigation candidate, not a selected form-value change merely because the tab's selected state changes. It may be proposed when browserMutationsAllowed=false, but consequence-bearing, disabled, or ambiguous tab controls remain ineligible and the deterministic evaluator remains authoritative.
- Do not treat a popup becoming visible as mutation-required by itself. The deterministic evaluator and executor remain authoritative and may still reject any proposed action.
- When browserMutationsAllowed=true, you may propose one exact observed externalPopup click as a bounded transient selection when it is necessary for progress. The deterministic evaluator and executor remain authoritative.
- GENERIC_BROWSER_BOUND_OPTION_ACTION_VOCABULARY_V1: When the current observation exposes an exact control with kind="option" and semanticOptionBinding=true, activate that already-observed option with action.kind="click" and the exact observed option label. Do not use action.kind="select" for an already-observed semantic option binding.
- A consequence-bearing word in the label of a proven semanticOptionBinding option does not by itself make that transient option activation a consequential command. The deterministic evaluator still decides whether the exact click is authorized.
- Never use mutation permission to justify an ordinary Save, Submit, Delete, Remove, Create, Publish, Send, Confirm, or other consequential command. This restriction still applies to ordinary buttons and controls that are not proven semantic option bindings.
- For duplicate click labels, include contextText only when that exact contextText appears on the intended observed control.
- For observed input click targets, do not include contextText. Input activation must be grounded by one exact observed input; contextText never disambiguates inputs.
- Never manufacture contextText from the goal, success criteria, or planned steps.
- Use PROPOSE_ROUTE only for a concrete grounded route.
- Use NEEDS_MORE_CONTEXT only when progress truly requires missing external context such as an unresolved route, record identity, permission, or fixture and no observed safe action can reveal more state.
- Do not use NEEDS_MORE_CONTEXT merely because acceptance labels are not visible yet or because an activation-safe observed input currently has hasValue=false.
- When an enabled exact non-consequential control or activation-safe input is observed and can reveal or expand the state needed for verification, prefer one grounded PROPOSE_ACTION before NEEDS_MORE_CONTEXT.
- Use NO_SAFE_ACTION for destructive, irreversible, ambiguous, or unauthorized operations.
- Do not propose an assert action merely to execute a planned deterministic assertion. Canonical deterministic assertions are executed separately after autonomous navigation reaches GOAL_ALREADY_SATISFIED.
- successCriteria and assertion-like plannedSteps describe what later deterministic verification may check; the navigation agent does not need to observe a passing assertion value itself.
- When canonicalDeterministicVerificationAvailable=true and the current observation is already on the semantically relevant surface for the goal, do not leave that surface merely because expected assertion text appears absent.
- In that situation, if no further navigation or interaction is required to reach the relevant verification surface, return GOAL_ALREADY_SATISFIED and let canonical deterministic verification decide PASS or FAIL.
- plannedStartRoute is a starting/navigation hint, not a command to revisit an already executed route after a more relevant goal surface has been reached.
- When no further navigation or interaction is required before canonical deterministic verification can begin, return GOAL_ALREADY_SATISFIED instead of proposing an assert action.
- For GOAL_ALREADY_SATISFIED, NO_SAFE_ACTION, or NEEDS_MORE_CONTEXT, omit action or return action as null. Do not return an empty action object.
- PROPOSE_ACTION and PROPOSE_ROUTE require a complete grounded action.
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

function shadowRecordingEnabled(): boolean {
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
  try {
    const observation =
      await observeBrowserPage(
        args.page
      );

    const modelInput =
      buildGenericBrowserShadowModelInput(
        args.issueKey,
        args.testCase,
        observation,
        args.executedActions || [],
        args.progressionHistory || []
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

    const actionContext =
      proposal.action?.kind ===
        "click"
        ? proposal.action
            .contextText?.trim()
        : undefined;
    const contextResolution =
      actionContext
        ? await resolveReadOnlyContextualControl(
            args.page,
            {
              targetText:
                proposal.action!
                  .target,
              contextText:
                actionContext,
            }
          )
        : undefined;

    const evaluationArgs = {
        proposal,
        observation,
        ...(contextResolution
          ? {
              contextTargetResolution:
                {
                  resolved:
                    Boolean(
                      contextResolution
                        .locator
                    ),
                  reason:
                    contextResolution
                      .note,
                },
            }
          : {}),
      };
    const evaluation = args.testCase.runtimeTargetGroundingContract &&
        (args.testCase.persona === "company_admin" ||
          args.testCase.persona === "talent")
      ? evaluateRuntimeDeferredTargetProposal({
          ...evaluationArgs,
          contract: args.testCase.runtimeTargetGroundingContract,
          actualPersona: args.testCase.persona,
        })
      : evaluateBrowserShadowProposal(evaluationArgs);

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

    const artifact: BrowserShadowArtifact = {
      schemaVersion: 2,
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
      evaluation,
      safety: {
        executed: false,
        affectedTestResult: false,
        mutationRequested: false,
      },
    };

    if (shadowRecordingEnabled()) {
      writeJsonAtomically(artifactPath, artifact);
    }

    if (shadowRecordingEnabled()) {
      return {
        status: "RECORDED",
        note: `Generic browser shadow proposal recorded: ${artifactPath}`,
        artifactPath,
        observation,
        proposal,
        evaluation,
      };
    }
    return {
      status: "EVALUATED",
      note: "Generic browser proposal evaluated without shadow recording.",
      observation,
      proposal,
      evaluation,
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
