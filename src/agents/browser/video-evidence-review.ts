import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ollamaClient } from "../../llm/ollama-client.js";
import type {
  EvidenceReviewConfidence,
  EvidenceReviewResult,
  EvidenceReviewVerdict,
} from "./evidence-review.js";

export type VideoEvidenceReviewResult = {
  verdict: EvidenceReviewVerdict;
  confidence: EvidenceReviewConfidence;
  rationale: string;
  visibleEvidence: string[];
  temporalEvidence: string[];
  resolvedFailures: string[];
  unresolvedFailures: string[];
  recommendedStatus:
    | "FAIL"
    | "MANUAL_REQUIRED";
  resolvedByVideo: boolean;
  framePaths: string[];
};

type ReviewBrowserVideoEvidenceArgs = {
  issueKey: string;
  testCase: any;
  currentStatus:
    | "FAIL"
    | "MANUAL_REQUIRED";
  currentReasonCategory: string;
  notes: string[];
  videoPath: string;
  screenshotReview:
    | EvidenceReviewResult
    | null;
};

function cleanJsonOutput(raw: string): string {
  let cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace !== -1 &&
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

function readStringArray(
  value: unknown
): string[] {
  return Array.isArray(value)
    ? value
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readVideoDuration(
  videoPath: string
): number {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    {
      encoding: "utf8",
    }
  ).trim();

  const duration = Number(output);

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error(
      `Invalid video duration: ${output}`
    );
  }

  return duration;
}

function extractVideoFrames(args: {
  issueKey: string;
  caseId: string;
  videoPath: string;
  duration: number;
}) {
  const frameDirectory = path.join(
    "qa-results",
    "evidence",
    "video-fallback",
    args.issueKey,
    args.caseId
  );

  fs.rmSync(frameDirectory, {
    recursive: true,
    force: true,
  });

  fs.mkdirSync(frameDirectory, {
    recursive: true,
  });

  const frameTimes = [
    args.duration * 0.25,
    args.duration * 0.6,
    args.duration * 0.88,
  ];

  const framePaths = frameTimes.map(
    (time, index) => {
      const framePath = path.join(
        frameDirectory,
        `frame-${index + 1}.png`
      );

      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-ss",
          time.toFixed(3),
          "-i",
          args.videoPath,
          "-frames:v",
          "1",
          "-update",
          "1",
          framePath,
        ],
        {
          stdio: "ignore",
        }
      );

      if (!fs.existsSync(framePath)) {
        throw new Error(
          `Video frame was not created: ${framePath}`
        );
      }

      return framePath;
    }
  );

  return {
    framePaths,
    frameTimes,
  };
}

export function shouldRunVideoEvidenceReview(
  screenshotReview:
    | EvidenceReviewResult
    | null
): boolean {
  return Boolean(
    screenshotReview &&
      (
        screenshotReview.verdict ===
          "INCONCLUSIVE" ||
        screenshotReview.confidence ===
          "low"
      )
  );
}

export async function reviewBrowserVideoEvidence(
  args: ReviewBrowserVideoEvidenceArgs
): Promise<VideoEvidenceReviewResult | null> {
  const visionModel =
    process.env.OLLAMA_VISION_MODEL;

  if (!visionModel) {
    console.log(
      " Video evidence review skipped: " +
        "OLLAMA_VISION_MODEL is not configured."
    );

    return null;
  }

  if (!fs.existsSync(args.videoPath)) {
    console.log(
      " Video evidence review skipped: " +
        `video does not exist: ${args.videoPath}`
    );

    return null;
  }

  try {
    const duration =
      readVideoDuration(args.videoPath);

    const {
      framePaths,
      frameTimes,
    } = extractVideoFrames({
      issueKey: args.issueKey,
      caseId: String(args.testCase.id),
      videoPath: args.videoPath,
      duration,
    });

    console.log(
      ` Video fallback reviewing: ` +
        `${args.videoPath}`
    );

    console.log(
      ` Video duration: ` +
        `${duration.toFixed(3)} seconds`
    );

    framePaths.forEach(
      (framePath, index) => {
        console.log(
          ` Video frame ${index + 1}: ` +
            `${framePath} at ` +
            `${frameTimes[index]?.toFixed(3)}s`
        );
      }
    );

    const frameContent = framePaths.map(
      (framePath) => ({
        type: "image_url",
        image_url: {
          url:
            "data:image/png;base64," +
            fs
              .readFileSync(framePath)
              .toString("base64"),
        },
      })
    );

    const systemPrompt = `
You review ordered browser-video frames for failed QA cases.

Return exactly this JSON structure:

{
  "resolvedFailures": [
    "A failed assertion that the video directly explains"
  ],
  "unresolvedFailures": [
    "A failed assertion whose cause remains ambiguous"
  ],
  "verdict": "PRODUCT_BUG | AUTOMATION_LIMITATION | TEST_DATA_ISSUE | WRONG_ROUTE | INCONCLUSIVE",
  "confidence": "low | medium | high",
  "rationale": "A specific explanation grounded in the ordered frames",
  "visibleEvidence": [
    "A specific visible fact from the frames"
  ],
  "temporalEvidence": [
    "A visible change or lack of change across the ordered frames"
  ]
}

Rules:

- The images are ordered from earlier to later in the video.
- Evaluate every failed assertion separately.
- Put directly explained failures in resolvedFailures.
- Put failures whose cause remains ambiguous in unresolvedFailures.
- Do not classify the whole case from only one explained failure.
- If any failed assertion remains unexplained, the overall verdict must be INCONCLUSIVE.
- Use the video to determine whether the required page, tab, modal, menu or form was ever reached.
- Do not infer backend configuration or hidden record properties.
- TEST_DATA_ISSUE requires direct visible evidence of unsuitable test data.
- PRODUCT_BUG requires visible evidence that the correct target state was reached and contradicted the expected behavior.
- AUTOMATION_LIMITATION applies when the required nested UI state was never reached.
- WRONG_ROUTE applies when the video visibly remains in an unrelated product area.
- Absence of a label alone cannot distinguish PRODUCT_BUG from TEST_DATA_ISSUE.
- Visible old Screenshot wording only explains a failed assertion about Screenshot wording.
- Visible old Screenshot wording does not explain why Document required or No document labels are absent.
- rationale must not be empty.
- visibleEvidence must contain at least one item.
- temporalEvidence must contain at least one item.
- Return only valid JSON.
`.trim();

    const reviewContext = {
      issueKey: args.issueKey,
      caseId: args.testCase.id,
      goal: args.testCase.goal,
      startRoute:
        args.testCase.startRoute,
      successCriteria:
        args.testCase.successCriteria,
      expectedSteps:
        args.testCase.steps ?? [],
      currentStatus:
        args.currentStatus,
      currentReasonCategory:
        args.currentReasonCategory,
      runnerNotes:
        args.notes,
      screenshotReview:
        args.screenshotReview,
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
                  "Review this browser video evidence:\n" +
                  JSON.stringify(
                    reviewContext,
                    null,
                    2
                  ),
              },
              ...frameContent,
            ] as any,
          },
        ],
      });

    const raw =
      response.choices[0]?.message.content ||
      "";

    if (
      process.env.QA_EVIDENCE_REVIEW_DEBUG ===
      "true"
    ) {
      console.log(
        ` Video evidence raw response: ${raw}`
      );
    }

    let parsed: any;

    try {
      parsed = JSON.parse(
        cleanJsonOutput(raw)
      );
    } catch {
      parsed = null;
    }

    if (
      !parsed ||
      !isValidVerdict(parsed.verdict) ||
      !isValidConfidence(parsed.confidence)
    ) {
      return {
        verdict: "INCONCLUSIVE",
        confidence: "low",
        rationale:
          "The video model did not return a valid structured review.",
        visibleEvidence: [],
        temporalEvidence: [],
        resolvedFailures: [],
        unresolvedFailures: [
          "The video review response could not be parsed safely.",
        ],
        recommendedStatus:
          "MANUAL_REQUIRED",
        resolvedByVideo: false,
        framePaths,
      };
    }

    const rationale = String(
      parsed.rationale || ""
    ).trim();

    const visibleEvidence =
      readStringArray(
        parsed.visibleEvidence
      );

    const temporalEvidence =
      readStringArray(
        parsed.temporalEvidence
      );

    const resolvedFailures =
      readStringArray(
        parsed.resolvedFailures
      );

    const unresolvedFailures =
      readStringArray(
        parsed.unresolvedFailures
      );

    const complete =
      Boolean(rationale) &&
      visibleEvidence.length > 0 &&
      temporalEvidence.length > 0 &&
      (
        resolvedFailures.length +
        unresolvedFailures.length
      ) > 0;

    const hasUnresolvedFailures =
      unresolvedFailures.length > 0;

    const verdict:
      EvidenceReviewVerdict =
      !complete ||
      hasUnresolvedFailures
        ? "INCONCLUSIVE"
        : parsed.verdict;

    const confidence:
      EvidenceReviewConfidence =
      !complete
        ? "low"
        : hasUnresolvedFailures
          ? "medium"
          : parsed.confidence;

    return {
      verdict,
      confidence,
      rationale: complete
        ? rationale
        : "The video review lacked enough grounded temporal evidence.",
      visibleEvidence,
      temporalEvidence,
      resolvedFailures,
      unresolvedFailures,
      recommendedStatus:
        verdict === "PRODUCT_BUG" &&
        confidence === "high"
          ? "FAIL"
          : "MANUAL_REQUIRED",
      resolvedByVideo:
        complete &&
        !hasUnresolvedFailures &&
        verdict !== "INCONCLUSIVE" &&
        confidence !== "low",
      framePaths,
    };
  } catch (error: any) {
    console.log(
      " Video evidence review failed: " +
        `${error.message}`
    );

    return null;
  }
}
