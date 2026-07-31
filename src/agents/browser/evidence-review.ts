import fs from "node:fs";
import {
  getVisionModelOptions,
  ollamaClient,
} from "../../llm/ollama-client.js";

export type EvidenceReviewVerdict =
  | "PASS_CONFIRMED"
  | "PRODUCT_BUG"
  | "AUTOMATION_LIMITATION"
  | "TEST_DATA_ISSUE"
  | "WRONG_ROUTE"
  | "INCONCLUSIVE";

export type EvidenceReviewConfidence =
  | "low"
  | "medium"
  | "high";

export type BrowserEvidenceIdentity = {
  entityType: string;
  requestedIdentity: string | null;
  runtimeIdentity: string | null;
  handoffIdentity: string | null;
  substituted: boolean;
  policy: string | null;
  selectionSource:
    | "planner"
    | "api-handoff"
    | "runtime-discovery"
    | "step";
};

export type BrowserEvidenceCheckpoint = {
  stepIndex: number;
  action: string;
  label: string;
  note: string;
  screenshotPath: string;
  url: string;
  identity?: BrowserEvidenceIdentity;
};

/*
 * EXACT_CLEANUP_STRUCTURED_EVIDENCE_V1
 *
 * URL assertions and exact resource cleanup are
 * machine evidence. They prove only their own
 * narrowly defined claim.
 */
export type BrowserDeterministicEvidence = {
  stepIndex: number;
  action:
    | "assertUrlContains"
    | "assertUrlNotContains"
    | "assertTextVisible"
    | "assertTextNotVisible"
    | "openRuntimeControl"
    | "resolveRuntimeInvoiceFixture"
    | "cleanupExactCreatedJob";
  expected: string;
  actualUrl?: string;
  passed: boolean;
  note: string;
};

export type EvidenceReviewResult = {
  verdict: EvidenceReviewVerdict;
  confidence: EvidenceReviewConfidence;
  rationale: string;
  visibleEvidence: string[];
  recommendedStatus:
    | "PASS"
    | "FAIL"
    | "MANUAL_REQUIRED";
};

type ReviewBrowserEvidenceArgs = {
  testCase: any;
  currentStatus:
    | "PASS"
    | "FAIL"
    | "MANUAL_REQUIRED";
  currentReasonCategory: string;
  screenshotPath: string;
  checkpointEvidence?:
    BrowserEvidenceCheckpoint[];
  deterministicEvidence?:
    BrowserDeterministicEvidence[];
  currentUrl: string;
  notes: string[];
};

function evidenceReviewEnabled(): boolean {
  return (
    process.env.QA_EVIDENCE_REVIEW === "true"
  );
}

function cleanJsonOutput(raw: string): string {
  let cleaned = raw.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
    lastBrace !== -1 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1
    );
  }

  return cleaned;
}

function isValidVerdict(
  value: unknown
): value is EvidenceReviewVerdict {
  return [
    "PASS_CONFIRMED",
    "PRODUCT_BUG",
    "AUTOMATION_LIMITATION",
    "TEST_DATA_ISSUE",
    "WRONG_ROUTE",
    "INCONCLUSIVE",
  ].includes(String(value));
}

function isValidConfidence(
  value: unknown
): value is EvidenceReviewConfidence {
  return [
    "low",
    "medium",
    "high",
  ].includes(String(value));
}

export async function reviewBrowserEvidence(
  args: ReviewBrowserEvidenceArgs
): Promise<EvidenceReviewResult | null> {
  if (!evidenceReviewEnabled()) {
    return null;
  }

  const visionModel =
    process.env.OLLAMA_VISION_MODEL;

  if (!visionModel) {
    console.log(
      " Evidence review skipped: " +
        "OLLAMA_VISION_MODEL is not configured."
    );

    return null;
  }

  if (!fs.existsSync(args.screenshotPath)) {
    console.log(
      ` Evidence review skipped: screenshot ` +
        `does not exist: ${args.screenshotPath}`
    );

    return null;
  }

  try {
    const deterministicEvidence =
      (args.deterministicEvidence ?? [])
        .slice(0, 20);

    const checkpointEvidence =
      (args.checkpointEvidence ?? [])
        .filter(
          (checkpoint) =>
            fs.existsSync(
              checkpoint.screenshotPath
            )
        )
        .slice(0, 8);

    const evidenceImages = [
      ...checkpointEvidence.map(
        (checkpoint) => ({
          kind: "checkpoint" as const,
          label:
            `Step ${checkpoint.stepIndex}: ` +
            checkpoint.label,
          path:
            checkpoint.screenshotPath,
          url: checkpoint.url,
          identity:
            checkpoint.identity ?? null,
        })
      ),
      {
        kind: "final" as const,
        label: "Final screenshot",
        path: args.screenshotPath,
        url: args.currentUrl,
        identity: null,
      },
    ];

    console.log(
      ` Evidence review using ` +
        `${checkpointEvidence.length} ` +
        `checkpoint screenshot(s) ` +
        `plus the final screenshot.`
    );

    const systemPrompt = `
You are reviewing evidence produced by a QA browser agent.

Audit whether the current browser result is supported by the ordered screenshot evidence and any structured deterministic machine evidence.

The evidence may contain screenshots captured immediately after successful safe browser actions, followed by a final screenshot. Treat the image sequence as chronological evidence from earlier to later.

The current result may be PASS, FAIL or MANUAL_REQUIRED.

Allowed verdicts:

PASS_CONFIRMED:
Use when the ordered screenshots directly show:
- the correct route and feature area;
- the required UI state;
- the acceptance-level visual product behavior described by the case.

A nonvisual agent-safety postcondition such as exact deletion
of the uniquely created test resource may instead be proven by
a passed cleanupExactCreatedJob structured machine assertion.
That cleanup operation does not require screenshot proof.

Multiple screenshots may jointly prove a temporal UI behavior. For example, an earlier checkpoint may show an open menu and its available options, while later checkpoints show each requested option as the selected value.

Do not use PASS_CONFIRMED when:
- a permission or fixture prerequisite is not visibly established;
- only generic page shell text is visible;
- only undefined/null sanity assertions passed;
- the required modal, menu, drawer or filtered state is never visibly reached in any screenshot;
- the ordered screenshots cannot directly support the assertion.

PRODUCT_BUG:
The screenshot clearly shows the correct feature, route and UI state,
but the expected product behavior is visibly missing or incorrect.

AUTOMATION_LIMITATION:
The agent did not reliably open the required modal, menu, tab, panel,
dropdown or nested UI state. The screenshot does not prove a product bug.

TEST_DATA_ISSUE:
The correct feature was reached, but the required staging data is absent,
empty, unsuitable or not configured for this test.

WRONG_ROUTE:
The screenshot or current URL clearly belongs to a different product area
than the browser case goal.

INCONCLUSIVE:
The screenshot alone does not contain enough evidence to classify safely.

Rules:
- Evaluate PASS_CONFIRMED and PRODUCT_BUG only against automatedChecks. If automatedChecks is empty, use successCriteria as the legacy fallback.
- manualChecks are outside the automated verdict scope. A non-empty manualChecks list must not downgrade an otherwise fully proven automated result.
- fixtureRequirements are execution prerequisites, not product assertions.
- When screenshot evidence directly shows that a fixture requirement is missing, empty, unsuitable or incompatible, return TEST_DATA_ISSUE.
- When fixture satisfaction is not visible or deterministically established, do not assume it was satisfied. Return INCONCLUSIVE instead of PRODUCT_BUG.
- Do not return AUTOMATION_LIMITATION or INCONCLUSIVE solely because manualChecks remain unverified.
- Be conservative.
- Runner notes saying PASS are not proof by themselves.
- Checkpoint screenshots are visual evidence; their labels only describe when they were captured and are not proof on their own.
- Structured checkpoint identity metadata records requested, runtime-selected and API-handoff identities for auditability. It is execution context, not visual proof by itself.
- A selectionSource value of api-handoff means the browser preferred an API-resolved entity; confirm the visible entity and state from screenshot evidence before relying on it.
- The currentUrl field alone is context, not proof.
- assertUrlContains and assertUrlNotContains deterministicEvidence entries are direct Playwright URL assertions. Treat them as authoritative only for their exact URL claim.
- assertTextVisible and assertTextNotVisible deterministicEvidence entries are direct Playwright visibility assertions. Treat them as authoritative only for the exact text-presence or text-absence claim recorded in that entry.
- Text visibility machine evidence does not prove route correctness, record identity, table state, permissions, backend contents or that an unopened drawer contains the text.
- Text visibility evidence may support PASS only when screenshot evidence shows the correct feature area and the required drawer, modal, panel or detail surface is visibly open.
- resolveRuntimeInvoiceFixture deterministicEvidence proves only the recorded runtime invoice selection and required table-view selection performed by the specialized resolver.
- A runtime invoice may replace the planner invoice only when runtimeFixturePolicy is explicitly "compatible-state". Without that explicit policy, a requested invoice mismatch remains a fixture/oracle issue.
- cleanupExactCreatedJob deterministicEvidence is an exact runner-owned API cleanup assertion. A passed entry proves only that the uniquely identified created test resource was deleted successfully by the exact cleanup operation recorded in that entry.
- Cleanup machine evidence does not prove the preceding UI creation or redirect behavior. Those claims still require their own screenshot and URL evidence.
- A passed deterministic URL assertion may prove URL query synchronization, preservation, removal, or reload retention only at the step where it was captured.
- Deterministic URL evidence does not prove backend requests, record ordering, permissions, persistence beyond the tested reload, or that a visual control restored correctly. Those claims still need matching screenshot evidence or another supported oracle.
- When screenshots prove the created draft details state and the exact redirect, do not return INCONCLUSIVE solely because successful exact cleanup is not visually shown when a passed cleanupExactCreatedJob assertion is provided.
- A failed deterministic URL assertion must not be dismissed merely because the browser address bar is absent from the screenshot.
- A closed final menu does not invalidate an earlier checkpoint that visibly proves the menu opened and displayed the required options.
- Distinct checkpoints may prove successive option selections when each selected value is visibly shown.
- A selectRuntimeTopTab checkpoint may prove that a visible inactive main-content tab became selected only when the selected state is visually apparent in that checkpoint.
- When a later reload checkpoint is provided, compare the visible selected tab before and after reload before claiming visual tab restoration.
- The runtime-selected tab label in runner notes is context only; the screenshot must visibly support the selected state.
- A selectRuntimeFilterOption checkpoint may prove that a safe visible filter option was selected only when the related filter control or selected value is visibly apparent.
- A runtime filter URL transition plus a passed deterministic query assertion proves only that the grounded query key changed and is present. It does not prove the returned records are correctly filtered.
- When reload evidence is included for a filter case, compare the visible selected filter state before and after reload before claiming visual restoration.
- A key-only deterministic assertion such as "tab=" or "project=" proves query-key presence but not the exact selected-label-to-query-value mapping.
- Do not infer data ordering, backend query parameters, persistence, permissions or network behavior merely from a selected UI label.
- If the case mixes a visually proven interaction with an unproven semantic requirement, do not confirm the whole case; return INCONCLUSIVE or AUTOMATION_LIMITATION as appropriate.
- A negative assertion can be confirmed only when the relevant
  product region and required UI state are visibly present.
- When PASS depends on invisible permissions, seeded data,
  hidden configuration or an unopened UI state, return
  INCONCLUSIVE.
- PASS_CONFIRMED should normally require high confidence.
- Do not call something PRODUCT_BUG only because expected text is absent.
- PRODUCT_BUG requires visible evidence that the correct route and UI state were reached.
- A closed modal, unopened dropdown or missing interaction is usually AUTOMATION_LIMITATION.
- An empty list or missing required entity is usually TEST_DATA_ISSUE.
- An unrelated page is WRONG_ROUTE.
Return exactly this JSON structure:

{
  "verdict": "PASS_CONFIRMED | PRODUCT_BUG | AUTOMATION_LIMITATION | TEST_DATA_ISSUE | WRONG_ROUTE | INCONCLUSIVE",
  "confidence": "low | medium | high",
  "rationale": "A specific explanation grounded in the screenshot",
  "visibleEvidence": [
    "Specific visible fact from the screenshot"
  ]
}

Requirements:
- rationale must not be empty.
- visibleEvidence must contain at least one specific visible fact.
- Do not repeat only the runner notes.
- Describe what is actually visible in the screenshot.
- If the screenshot does not prove the cause, return INCONCLUSIVE.
- Return only valid JSON.

Additional evidence rules:

- TEST_DATA_ISSUE requires direct visible proof that the current
  data state is unsuitable for the assertion.

- Valid TEST_DATA_ISSUE evidence includes an already selected
  value replacing an expected placeholder, an explicit empty-state
  message, zero records, or clearly incompatible seeded data.

- Do not infer missing backend configuration merely because an
  expected UI label is absent.

- The absence of an expected label alone does not prove whether
  the cause is PRODUCT_BUG or TEST_DATA_ISSUE.

- When both PRODUCT_BUG and TEST_DATA_ISSUE are plausible from
  the screenshot, return INCONCLUSIVE.

- Never claim properties of records that are not directly visible
  in the screenshot.
`;

    const reviewContext = {
      caseId: args.testCase.id,
      goal: args.testCase.goal,
successCriteria:
  args.testCase.successCriteria,
automatedChecks:
  args.testCase.automatedChecks ?? [],
manualChecks:
  args.testCase.manualChecks ?? [],
fixtureRequirements:
  args.testCase.fixtureRequirements ?? [],
expectedSteps:
  args.testCase.steps ?? [],
      currentStatus: args.currentStatus,
      currentReasonCategory:
        args.currentReasonCategory,
      currentUrl: args.currentUrl,
      runtimeFixturePolicy:
        args.testCase
          .runtimeFixturePolicy ??
        "exact",
      runtimeInvoiceFixture:
        args.testCase
          .runtimeInvoiceFixture ??
        null,
      runnerNotes: args.notes,
      deterministicEvidence,
      evidenceSequence:
        evidenceImages.map(
          (evidence, index) => ({
            imageNumber: index + 1,
            kind: evidence.kind,
            label: evidence.label,
            url: evidence.url,
            identity:
              evidence.identity,
          })
        ),
    };

    const messageContent: any[] = [
      {
        type: "text",
        text:
          "Review this ordered browser evidence:\n" +
          JSON.stringify(
            reviewContext,
            null,
            2
          ),
      },
    ];

    for (
      let index = 0;
      index < evidenceImages.length;
      index += 1
    ) {
      const evidence =
        evidenceImages[index];

      if (!evidence) {
        continue;
      }

      const imageBase64 = fs
        .readFileSync(evidence.path)
        .toString("base64");

      messageContent.push(
        {
          type: "text",
          text:
            `Image ${index + 1} of ` +
            `${evidenceImages.length}: ` +
            `${evidence.label} ` +
            `(URL: ${evidence.url})`,
        },
        {
          type: "image_url",
          image_url: {
            url:
              "data:image/png;base64," +
              imageBase64,
          },
        }
      );
    }

    const response =
    await ollamaClient.chat.completions.create({
        model: visionModel,
        ...getVisionModelOptions(),
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
            content: messageContent as any,
          },
        ],
      });

    const raw =
      response.choices[0]?.message.content;

    if (!raw) {
      console.log(
        " Evidence review returned no content."
      );

      return null;
    }

    const parsed = JSON.parse(
  cleanJsonOutput(raw)
);

if (
  process.env.QA_EVIDENCE_REVIEW_DEBUG ===
  "true"
) {
  console.log(
    ` Evidence review raw response: ${raw}`
  );
}

if (
  !isValidVerdict(parsed.verdict) ||
  !isValidConfidence(parsed.confidence)
) {
  console.log(
    " Evidence review returned an invalid verdict."
  );

  return null;
}

const rationale = String(
  parsed.rationale || ""
).trim();

const visibleEvidence = Array.isArray(
  parsed.visibleEvidence
)
  ? parsed.visibleEvidence
      .map(String)
      .map((value: string) => value.trim())
      .filter(Boolean)
  : [];

if (
  !rationale ||
  visibleEvidence.length === 0
) {
  console.log(
    " Evidence review response was incomplete; " +
      "downgrading to INCONCLUSIVE."
  );

  return {
    verdict: "INCONCLUSIVE",
    confidence: "low",
    rationale:
      "The vision model did not provide enough " +
      "screenshot-grounded explanation to make " +
      "a reliable classification.",
    visibleEvidence,
    recommendedStatus:
      "MANUAL_REQUIRED",
  };
}

let verdict: EvidenceReviewVerdict =
  parsed.verdict;

/*
 * EMPTY_FIXTURE_CONTRADICTION_GUARD_V1
 *
 * When a case explicitly requires an empty or zero-data
 * fixture but the screenshot visibly proves a non-empty
 * collection, the execution state is incompatible with
 * the case. This is TEST_DATA_ISSUE, not an automation
 * failure or product assertion failure.
 */
const fixtureScopeText = [
  JSON.stringify(
    args.testCase.fixtureRequirements ?? []
  ),
  JSON.stringify(
    args.testCase.automatedChecks ?? []
  ),
  String(
    args.testCase.successCriteria ?? ""
  ),
]
  .join(" ")
  .toLowerCase();

const visibleStateText = [
  rationale,
  ...visibleEvidence,
]
  .join(" ")
  .toLowerCase();

const requiresEmptyOrZeroFixture =
  fixtureScopeText.includes("zero") ||
  fixtureScopeText.includes(
    "empty state"
  ) ||
  fixtureScopeText.includes(
    "empty-state"
  );

const visiblyShowsNonEmptyCollection =
  /\b(?:displaying|showing)\s+[1-9]\d*\s+of\s+[1-9]\d*\b/i.test(
    visibleStateText
  );

if (
  (
    verdict ===
      "AUTOMATION_LIMITATION" ||
    verdict === "INCONCLUSIVE"
  ) &&
  requiresEmptyOrZeroFixture &&
  visiblyShowsNonEmptyCollection
) {
  verdict = "TEST_DATA_ISSUE";

  console.log(
    " Evidence fixture contradiction guard: " +
      "visible non-empty collection conflicts " +
      "with required empty or zero-data state."
  );
}

/*
 * COMPARISON_VALUE_FALSE_PASS_GUARD_V1
 *
 * Plain text-visibility assertions prove labels only.
 * Until dedicated full comparison-value coverage exists,
 * they cannot confirm CURRENT/PROPOSED value requirements.
 */
const criteriaText = JSON.stringify(
  Array.isArray(
    args.testCase.automatedChecks
  ) &&
    args.testCase.automatedChecks.length > 0
    ? args.testCase.automatedChecks
    : args.testCase.successCriteria ?? ""
).toLowerCase();

const requiresComparisonValues =
  criteriaText.includes("current") &&
  criteriaText.includes("proposed") &&
  criteriaText.includes("value");

if (
  verdict === "PASS_CONFIRMED" &&
  requiresComparisonValues
) {
  return {
    verdict: "INCONCLUSIVE",
    confidence: "high",
    rationale:
      "The case requires current and proposed comparison " +
      "values, but the available structured evidence proves " +
      "only text visibility. PASS cannot be confirmed safely.",
    visibleEvidence,
    recommendedStatus: "MANUAL_REQUIRED",
  };
}

const recommendedStatus:
  | "PASS"
  | "FAIL"
  | "MANUAL_REQUIRED" =
  verdict === "PASS_CONFIRMED" &&
  parsed.confidence === "high"
    ? "PASS"
    : verdict === "PRODUCT_BUG" &&
        parsed.confidence === "high"
      ? "FAIL"
      : "MANUAL_REQUIRED";

return {
  verdict,
  confidence: parsed.confidence,
  rationale,
  visibleEvidence,
  recommendedStatus,
};

    
  } catch (error: any) {
    console.log(
      ` Evidence review failed safely: ` +
        `${error.message}`
    );

    return null;
  }
}
