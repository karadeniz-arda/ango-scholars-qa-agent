import fs from "node:fs";
import path from "node:path";

const model =
  process.argv[2] ||
  process.env.OLLAMA_VISION_MODEL;

const issueKey =
  process.argv[3] || "AS-1165";

const caseId =
  process.argv[4] || "web-1";

const explicitVideoPath =
  process.argv[5];

if (!model) {
  throw new Error(
    "Vision model is missing. Pass it as the first argument."
  );
}

process.env.OLLAMA_VISION_MODEL =
  model;

const planPath =
  `qa-results/runs/${issueKey}/test-plan.json`;

if (!fs.existsSync(planPath)) {
  throw new Error(
    `Test plan does not exist: ${planPath}`
  );
}

const plan = JSON.parse(
  fs.readFileSync(planPath, "utf8")
);

const testCase =
  plan.browserCases?.find(
    (item: any) =>
      item.id === caseId
  );

if (!testCase) {
  throw new Error(
    `${caseId} was not found in ${planPath}`
  );
}

const videoPath =
  explicitVideoPath ||
  path.join(
    "qa-results",
    "videos",
    `${issueKey}-${caseId}.webm`
  );

if (!fs.existsSync(videoPath)) {
  throw new Error(
    `Video does not exist: ${videoPath}`
  );
}

const {
  reviewBrowserVideoEvidence,
} = await import(
  "../src/agents/browser/video-evidence-review.js"
);

console.log(
  `Reviewing video evidence for ` +
    `${issueKey} ${caseId}`
);

console.log(`Model: ${model}`);
console.log(`Video: ${videoPath}`);

const finalReview =
  await reviewBrowserVideoEvidence({
    issueKey,
    testCase,
    currentStatus: "FAIL",
    currentReasonCategory:
      "BROWSER_ASSERTION_FAILED",
    notes: [
      "Standalone video fallback verification.",
    ],
    videoPath,
    screenshotReview: {
      verdict: "INCONCLUSIVE",
      confidence: "medium",
      rationale:
        "The screenshot alone did not explain every failed assertion.",
      visibleEvidence: [
        "The screenshot review could not safely determine the cause of all failed assertions.",
      ],
      recommendedStatus:
        "MANUAL_REQUIRED",
    },
  });

console.log(
  "\nFINAL VIDEO REVIEW:\n" +
    JSON.stringify(
      finalReview,
      null,
      2
    )
);
