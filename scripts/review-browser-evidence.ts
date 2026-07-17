import fs from "node:fs";

const model =
  process.argv[2] ||
  process.env.OLLAMA_VISION_MODEL;

const issueKey =
  process.argv[3] || "AS-1165";

const caseId =
  process.argv[4] || "web-1";

if (!model) {
  throw new Error(
    "Vision model is missing. " +
      "Pass it as the first argument."
  );
}

process.env.QA_EVIDENCE_REVIEW = "true";
process.env.QA_EVIDENCE_REVIEW_DEBUG = "true";
process.env.OLLAMA_VISION_MODEL = model;

const { reviewBrowserEvidence } =
  await import(
    "../src/agents/browser/evidence-review.js"
  );

const planPath =
  `qa-results/runs/${issueKey}/test-plan.json`;

const screenshotPath =
  `qa-results/runs/${issueKey}/evidence/` +
  `${caseId}-screenshot.png`;

const smokeLogPath =
  `qa-results/runs/${issueKey}/logs/smoke.log`;

for (const requiredPath of [
  planPath,
  screenshotPath,
  smokeLogPath,
]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(
      `Required file does not exist: ${requiredPath}`
    );
  }
}

const plan = JSON.parse(
  fs.readFileSync(planPath, "utf8")
);

const testCase =
  plan.browserCases?.find(
    (item: any) => item.id === caseId
  );

if (!testCase) {
  throw new Error(
    `${caseId} was not found in ${planPath}`
  );
}

const smokeLog =
  fs.readFileSync(smokeLogPath, "utf8");

function extractCaseBlock(
  log: string,
  id: string
): string {
  const marker = `Taking photo: [${id}]`;
  const startIndex = log.indexOf(marker);

  if (startIndex === -1) {
    throw new Error(
      `${id} was not found in ${smokeLogPath}`
    );
  }

  const remaining =
    log.slice(startIndex + marker.length);

  const nextCaseIndex =
    remaining.indexOf("\nTaking photo: [");

  return nextCaseIndex === -1
    ? log.slice(startIndex)
    : log.slice(
        startIndex,
        startIndex +
          marker.length +
          nextCaseIndex
      );
}

const caseBlock =
  extractCaseBlock(smokeLog, caseId);

const statusMatch =
  caseBlock.match(
    /Result:\s+(FAIL|MANUAL_REQUIRED)/
  );

if (!statusMatch) {
  throw new Error(
    `${caseId} is not FAIL or MANUAL_REQUIRED.`
  );
}

const currentStatus =
  statusMatch[1] as
    | "FAIL"
    | "MANUAL_REQUIRED";

const notesMatch =
  caseBlock.match(/^ Notes:\s*(.+)$/m);

const notes = notesMatch?.[1]
  ? notesMatch[1]
      .split(" | ")
      .map((note) => note.trim())
      .filter(Boolean)
  : [];

const urlMatch =
  caseBlock.match(
    /Navigated to (https?:\/\/[^\s|]+)/
  );

const currentUrl =
  urlMatch?.[1] ||
  testCase.startRoute ||
  "UNKNOWN";

const currentReasonCategory =
  currentStatus === "FAIL"
    ? "PRODUCT_ASSERTION_FAILED"
    : "AUTOMATION_LIMITATION";

console.log(
  [
    `Reviewing ${issueKey} ${caseId}`,
    `Model: ${model}`,
    `Current status: ${currentStatus}`,
    `Screenshot: ${screenshotPath}`,
    `URL: ${currentUrl}`,
  ].join("\n")
);

const result =
  await reviewBrowserEvidence({
    testCase,
    currentStatus,
    currentReasonCategory,
    screenshotPath,
    currentUrl,
    notes,
  });

console.log(
  "\nFINAL REVIEW:\n" +
    JSON.stringify(result, null, 2)
);
