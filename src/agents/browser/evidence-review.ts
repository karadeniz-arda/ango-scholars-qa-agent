import fs from "node:fs";
import { ollamaClient } from "../../llm/ollama-client.js";

export type EvidenceReviewVerdict =
  | "PRODUCT_BUG"
  | "AUTOMATION_LIMITATION"
  | "TEST_DATA_ISSUE"
  | "WRONG_ROUTE"
  | "INCONCLUSIVE";

export type EvidenceReviewConfidence =
  | "low"
  | "medium"
  | "high";

export type EvidenceReviewResult = {
  verdict: EvidenceReviewVerdict;
  confidence: EvidenceReviewConfidence;
  rationale: string;
  visibleEvidence: string[];
  recommendedStatus:
    | "FAIL"
    | "MANUAL_REQUIRED";
};

type ReviewBrowserEvidenceArgs = {
  testCase: any;
  currentStatus:
    | "FAIL"
    | "MANUAL_REQUIRED";
  currentReasonCategory: string;
  screenshotPath: string;
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
    const imageBase64 = fs
      .readFileSync(args.screenshotPath)
      .toString("base64");

    const systemPrompt = `
You are reviewing evidence produced by a QA browser agent.

Classify why a browser case currently ended as FAIL or MANUAL_REQUIRED.

Allowed verdicts:

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
- Be conservative.
- Do not call something PRODUCT_BUG only because expected text is absent.
- PRODUCT_BUG requires visible evidence that the correct route and UI state were reached.
- A closed modal, unopened dropdown or missing interaction is usually AUTOMATION_LIMITATION.
- An empty list or missing required entity is usually TEST_DATA_ISSUE.
- An unrelated page is WRONG_ROUTE.
Return exactly this JSON structure:

{
  "verdict": "PRODUCT_BUG | AUTOMATION_LIMITATION | TEST_DATA_ISSUE | WRONG_ROUTE | INCONCLUSIVE",
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
      expectedSteps:
        args.testCase.steps ?? [],
      currentStatus: args.currentStatus,
      currentReasonCategory:
        args.currentReasonCategory,
      currentUrl: args.currentUrl,
      runnerNotes: args.notes,
    };

    const response =
    await ollamaClient.chat.completions.create({
        model: visionModel,
        temperature: 0,
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
            content: [
              {
                type: "text",
                text:
                  "Review this browser evidence:\n" +
                  JSON.stringify(
                    reviewContext,
                    null,
                    2
                  ),
              },
              {
                type: "image_url",
                image_url: {
                  url:
                    "data:image/png;base64," +
                    imageBase64,
                },
              },
            ] as any,
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

const verdict = parsed.verdict;

const recommendedStatus:
  | "FAIL"
  | "MANUAL_REQUIRED" =
  verdict === "PRODUCT_BUG" &&
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