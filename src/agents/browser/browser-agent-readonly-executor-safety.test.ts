import assert from "node:assert/strict";
import fs from "node:fs";
import {
  after,
  before,
  test,
} from "node:test";

import {
  chromium,
  type Browser,
  type Page,
} from "playwright";

import {
  executeBrowserReadOnlyProposal,
} from "./browser-agent-readonly-executor.js";

let browser: Browser;

const previousReadOnlyExecution =
  process.env
    .QA_GENERIC_BROWSER_READONLY_EXECUTION;

const previousBrowserMutations =
  process.env
    .QA_ALLOW_BROWSER_MUTATIONS;

before(async () => {
  process.env
    .QA_GENERIC_BROWSER_READONLY_EXECUTION =
    "true";

  browser = await chromium.launch({
    headless: true,
  });
});

after(async () => {
  await browser.close();

  if (
    previousReadOnlyExecution ===
    undefined
  ) {
    delete process.env
      .QA_GENERIC_BROWSER_READONLY_EXECUTION;
  } else {
    process.env
      .QA_GENERIC_BROWSER_READONLY_EXECUTION =
      previousReadOnlyExecution;
  }

  if (
    previousBrowserMutations ===
    undefined
  ) {
    delete process.env
      .QA_ALLOW_BROWSER_MUTATIONS;
  } else {
    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      previousBrowserMutations;
  }
});

async function withPage(
  html: string,
  run: (page: Page) => Promise<void>
): Promise<void> {
  const page =
    await browser.newPage();

  try {
    await page.setContent(html);
    await run(page);
  } finally {
    await page.close();
  }
}

function safeEvaluation(
  label: string,
  kind: string,
  extra: Record<string, unknown> = {}
): any {
  return {
    status: "SAFE_TO_EXECUTE",
    safeToExecute: true,
    grounded: true,
    reason:
      "Synthetic evaluator result for independent executor safety testing.",
    matchedTarget: {
      source: "control",
      label,
      kind,
      ...extra,
    },
  };
}

function clickProposal(
  target: string
): any {
  return {
    decision: "PROPOSE_ACTION",
    rationale:
      "Synthetic executor safety test.",
    confidence: "high",
    action: {
      kind: "click",
      target,
    },
  };
}

test(
  "executor uses the shared deterministic safety classifier",
  () => {
    const source =
      fs.readFileSync(
        "src/agents/browser/browser-agent-readonly-executor.ts",
        "utf8"
      );

    assert.match(
      source,
      /GENERIC_BROWSER_DETERMINISTIC_SAFETY_EXECUTOR_V1/
    );

    assert.match(
      source,
      /classifyGenericBrowserActionSafety/
    );

    assert.match(
      source,
      /liveInputSafetyClass/
    );

    assert.equal(
      source.includes(
        "CONSEQUENCE_RISK_LABEL"
      ),
      false
    );
  }
);

test(
  "executor blocks an ordinary option even when evaluator safety is fabricated and mutation permission is enabled",
  async () => {
    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    await withPage(
      `
        <div
          role="option"
          onclick="
            document.body.dataset.clicked =
              'true';
          "
        >
          Choice A
        </div>
      `,
      async (page) => {
        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              clickProposal(
                "Choice A"
              ),
            evaluation:
              safeEvaluation(
                "Choice A",
                "option"
              ),
          });

        assert.equal(
          execution.status,
          "BLOCKED"
        );

        assert.equal(
          execution.executed,
          false
        );

        assert.equal(
          await page
            .locator("body")
            .getAttribute(
              "data-clicked"
            ),
          null
        );

        assert.match(
          execution.note,
          /ordinary option/i
        );
      }
    );
  }
);

test(
  "executor blocks a consequential command even when evaluator safety is fabricated and mutation permission is enabled",
  async () => {
    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    await withPage(
      `
        <button
          onclick="
            document.body.dataset.saved =
              'true';
          "
        >
          Save
        </button>
      `,
      async (page) => {
        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              clickProposal("Save"),
            evaluation:
              safeEvaluation(
                "Save",
                "button"
              ),
          });

        assert.equal(
          execution.status,
          "BLOCKED"
        );

        assert.equal(
          execution.executed,
          false
        );

        assert.equal(
          await page
            .locator("body")
            .getAttribute(
              "data-saved"
            ),
          null
        );

        assert.match(
          execution.note,
          /persisted|consequential/i
        );
      }
    );
  }
);
