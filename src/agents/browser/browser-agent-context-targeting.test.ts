import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import {
  observeBrowserPage,
} from "./browser-observation.js";
import {
  runGenericBrowserShadow,
  type BrowserShadowProposal,
} from "./browser-agent-shadow.js";

let browser: Browser;
let outputRoot: string;
let caseSequence = 0;

const previousShadow =
  process.env
    .QA_GENERIC_BROWSER_SHADOW;
const previousReadOnlyExecution =
  process.env
    .QA_GENERIC_BROWSER_READONLY_EXECUTION;

before(async () => {
  process.env
    .QA_GENERIC_BROWSER_SHADOW =
    "true";
  process.env
    .QA_GENERIC_BROWSER_READONLY_EXECUTION =
    "true";
  outputRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "browser-context-targeting-"
      )
    );
  browser = await chromium.launch({
    headless: true,
  });
});

after(async () => {
  await browser.close();
  fs.rmSync(outputRoot, {
    recursive: true,
    force: true,
  });

  if (previousShadow === undefined) {
    delete process.env
      .QA_GENERIC_BROWSER_SHADOW;
  } else {
    process.env
      .QA_GENERIC_BROWSER_SHADOW =
      previousShadow;
  }

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
});

async function withPage(
  html: string,
  run: (page: Page) => Promise<void>
): Promise<void> {
  const page = await browser.newPage();

  try {
    await page.setContent(html);
    await run(page);
  } finally {
    await page.close();
  }
}

async function propose(
  page: Page,
  action: BrowserShadowProposal["action"]
) {
  caseSequence += 1;

  const result =
    await runGenericBrowserShadow({
      page,
      issueKey: "SYNTHETIC",
      testCase: {
        id: `context-${caseSequence}`,
        goal:
          "Open the requested read-only surface.",
      },
      outputRoot,
      requestProposal: async () => ({
        decision: "PROPOSE_ACTION",
        rationale:
          "The exact observed control is the next safe action.",
        confidence: "high",
        action,
      }),
    });

  if (result.status !== "RECORDED") {
    throw new Error(
      `Expected RECORDED, received ${result.status}: ${result.note}`
    );
  }

  return result;
}

test(
  "preserves duplicate exact controls in the observation",
  async () => {
    await withPage(
      `
        <button>Preview</button>
        <button>Preview</button>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);
        const previews =
          observation.controls.filter(
            (control) =>
              control.label ===
              "Preview"
          );

        assert.equal(
          previews.length,
          2
        );
      }
    );
  }
);

test(
  "preserves full-page observation when no modal is active",
  async () => {
    await withPage(
      `
        <main>
          <h1>Page heading</h1>
          <button>Background action</button>
          <label>Query <input /></label>
        </main>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.deepEqual(
          observation.headings,
          ["Page heading"]
        );
        assert.equal(
          observation.controls[0]
            ?.label,
          "Background action"
        );
        assert.equal(
          observation.inputs[0]?.label,
          "Query"
        );
      }
    );
  }
);

test(
  "scopes controls and inputs to one active modal",
  async () => {
    await withPage(
      `
        <main>
          <button>Background action</button>
          <label>Background query <input /></label>
        </main>
        <section role="dialog" aria-modal="true" aria-label="Settings">
          <button>Modal action</button>
          <label>Modal query <input /></label>
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.deepEqual(
          observation.controls.map(
            (control) => control.label
          ),
          ["Modal action"]
        );
        assert.deepEqual(
          observation.inputs.map(
            (input) => input.label
          ),
          ["Modal query"]
        );

        const backgroundProposal =
          await propose(page, {
            kind: "click",
            target:
              "Background action",
          });

        assert.equal(
          backgroundProposal.evaluation
            .status,
          "TARGET_NOT_GROUNDED"
        );
      }
    );
  }
);

test(
  "retains active modal metadata and scoped semantic content",
  async () => {
    await withPage(
      `
        <main>
          <p>Background content</p>
        </main>
        <section role="dialog" aria-modal="true" aria-label="Settings">
          <h2>Modal heading</h2>
          <p>Modal content</p>
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.deepEqual(
          observation.headings,
          ["Modal heading"]
        );
        assert.deepEqual(
          observation.visibleText,
          [
            "Modal heading",
            "Modal content",
          ]
        );
        assert.equal(
          observation.surfaces[0]?.kind,
          "dialog"
        );
        assert.equal(
          observation.surfaces[0]?.label,
          "Settings"
        );
      }
    );
  }
);

test(
  "fails safe for multiple competing active modals",
  async () => {
    await withPage(
      `
        <section role="dialog" aria-modal="true" aria-label="First dialog">
          <button>First action</button>
        </section>
        <section role="dialog" aria-modal="true" aria-label="Second dialog">
          <button>Second action</button>
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.deepEqual(
          observation.controls,
          []
        );
        assert.deepEqual(
          observation.inputs,
          []
        );
        assert.deepEqual(
          observation.surfaces.map(
            (surface) => surface.label
          ),
          ["First dialog", "Second dialog"]
        );
      }
    );
  }
);

test(
  "observes distinct semantic contexts for duplicate controls",
  async () => {
    await withPage(
      `
        <section>
          <h2>Language Requirements</h2>
          <button>Configure</button>
        </section>
        <section>
          <h2>Skills</h2>
          <button>Configure</button>
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);
        const contexts =
          observation.controls
            .filter(
              (control) =>
                control.label ===
                "Configure"
            )
            .map(
              (control) =>
                control.contextText
            );

        assert.deepEqual(contexts, [
          "Language Requirements",
          "Skills",
        ]);
      }
    );
  }
);

test(
  "keeps a unique uncontextualized control backwards compatible",
  async () => {
    await withPage(
      `<button>Preview</button>`,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls.length,
          1
        );
        assert.equal(
          observation.controls[0]
            ?.label,
          "Preview"
        );
        assert.equal(
          observation.controls[0]
            ?.contextText,
          undefined
        );
      }
    );
  }
);

test(
  "does not promote arbitrary nearby text to semantic context",
  async () => {
    await withPage(
      `
        <div>
          <p>Nearby description</p>
          <button>Preview</button>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls[0]
            ?.contextText,
          undefined
        );
      }
    );
  }
);

test(
  "executes one unique exact target without context",
  async () => {
    await withPage(
      `
        <button onclick="document.querySelector('#details').hidden = false">View details</button>
        <section id="details" role="dialog" hidden>Details</section>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "View details",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
      }
    );
  }
);

test(
  "uses unique semantic context to ground one duplicate exact target",
  async () => {
    await withPage(
      `
        <main>
          <section>
            <h2>Language Requirements</h2>
            <button onclick="document.querySelector('#language').hidden = false">Configure</button>
          </section>
          <section>
            <h2>Skills</h2>
            <button>Configure</button>
          </section>
        </main>
        <section id="language" role="dialog" hidden>Language options</section>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Configure",
            contextText:
              "Language Requirements",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );
        assert.equal(
          shadow.evaluation
            .matchedTarget
            ?.contextText,
          "Language Requirements"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
        assert.equal(
          await page
            .locator("#language")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "fails safe when duplicate targets share the same semantic context",
  async () => {
    await withPage(
      `
        <section>
          <h2>Language Requirements</h2>
          <button>Configure</button>
          <button>Configure</button>
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.deepEqual(
          observation.controls.map(
            (control) =>
              control.contextText
          ),
          [undefined, undefined]
        );

        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Configure",
            contextText:
              "Language Requirements",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "TARGET_NOT_GROUNDED"
        );
        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );
        assert.match(
          shadow.evaluation.reason,
          /did not uniquely match context exposed/
        );
      }
    );
  }
);

test(
  "fails safe when context has no valid semantic relationship",
  async () => {
    await withPage(
      `<button>Configure</button>`,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Configure",
            contextText:
              "Language Requirements",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "TARGET_NOT_GROUNDED"
        );
        assert.equal(
          shadow.evaluation.grounded,
          false
        );
      }
    );
  }
);

test(
  "keeps a consequence-bearing contextual control rejected",
  async () => {
    await withPage(
      `
        <section>
          <h2>Profile</h2>
          <button onclick="this.dataset.clicked = 'true'">Save</button>
        </section>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Save",
            contextText: "Profile",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "MUTATION_RISK"
        );
        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );
        assert.equal(
          await page
            .getByRole("button")
            .getAttribute(
              "data-clicked"
            ),
          null
        );
      }
    );
  }
);

test(
  "fails safe during evaluation when a context-free exact target is duplicated",
  async () => {
    await withPage(
      `
        <button>Preview</button>
        <button>Preview</button>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Preview",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "TARGET_NOT_GROUNDED"
        );

        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );

        assert.equal(
          shadow.evaluation.grounded,
          false
        );

        assert.match(
          shadow.evaluation.reason,
          /exactly one exact observed semantic control/
        );
      }
    );
  }
);

test(
  "grounds and executes one activation-safe input that opens a listbox",
  async () => {
    await withPage(
      `
        <input
          aria-label="Picker"
          aria-haspopup="listbox"
          aria-expanded="false"
          onclick="
            this.setAttribute('aria-expanded', 'true');
            document.querySelector('#choices').hidden = false;
          "
        />
        <div id="choices" role="listbox" hidden>
          <div role="option">Choice</div>
        </div>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );
        assert.equal(
          shadow.evaluation
            .matchedTarget?.source,
          "input"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
        assert.equal(
          execution.stateChanged,
          true
        );
        assert.equal(
          await page
            .getByRole("listbox")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "verifies an activation-safe modal input when its listbox is portaled outside the modal",
  async () => {
    await withPage(
      `
        <div role="dialog" aria-modal="true" aria-label="Picker dialog">
          <input
            aria-label="Picker"
            aria-haspopup="listbox"
            aria-expanded="false"
            onclick="
              this.setAttribute('aria-expanded', 'true');
              document.querySelector('#portal-choices').hidden = false;
            "
          />
        </div>
        <div id="portal-choices" role="listbox" hidden>
          <div role="option">Choice</div>
        </div>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        const before =
          await observeBrowserPage(page);

        assert.equal(
          before.surfaces.some(
            (surface) =>
              surface.kind === "listbox"
          ),
          false
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
        assert.equal(
          execution.stateChanged,
          true
        );
        assert.equal(
          execution.afterObservation
            ?.surfaces.some(
              (surface) =>
                surface.kind ===
                "listbox"
            ),
          true
        );
        assert.equal(
          await page
            .getByRole("listbox")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "does not accept focus-only input activation as successful navigation",
  async () => {
    await withPage(
      `
        <input
          aria-label="Picker"
          aria-haspopup="listbox"
        />
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
          }
        );
        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "VERIFICATION_FAILED"
        );
        assert.equal(
          execution.stateChanged,
          false
        );
      }
    );
  }
);

test(
  "rejects a disabled exact activation input",
  async () => {
    await withPage(
      `
        <input
          aria-label="Picker"
          aria-haspopup="listbox"
          disabled
        />
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "TARGET_DISABLED"
        );
      }
    );
  }
);

test(
  "rejects duplicate exact enabled activation inputs",
  async () => {
    await withPage(
      `
        <input aria-label="Picker" aria-haspopup="listbox" />
        <input aria-label="Picker" aria-haspopup="listbox" />
      `,
      async (page) => {
        for (const contextText of [
          undefined,
          "Picker dialog",
        ]) {
          const shadow = await propose(
            page,
            {
              kind: "click",
              target: "Picker",
              ...(
                contextText
                  ? { contextText }
                  : {}
              ),
            }
          );

          assert.equal(
            shadow.evaluation.status,
            "TARGET_NOT_GROUNDED"
          );
        }
      }
    );
  }
);

test(
  "ignores redundant contextText for one unique exact activation input",
  async () => {
    await withPage(
      `
        <section role="dialog" aria-modal="true" aria-label="Picker dialog">
          <input
            aria-label="Picker"
            aria-haspopup="listbox"
            aria-expanded="false"
            onclick="
              this.setAttribute('aria-expanded', 'true');
              document.querySelector('#choices').hidden = false;
            "
          />
          <div id="choices" role="listbox" hidden>
            <div role="option">Choice</div>
          </div>
        </section>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
            contextText:
              "Redundant model-supplied context",
          }
        );

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
        assert.equal(
          execution.stateChanged,
          true
        );
      }
    );
  }
);

test(
  "excludes a same-label background input from active-modal grounding",
  async () => {
    await withPage(
      `
        <input
          id="background-picker"
          aria-label="Picker"
          aria-haspopup="listbox"
          aria-expanded="false"
        />
        <section role="dialog" aria-modal="true" aria-label="Dialog">
          <input
            id="modal-picker"
            aria-label="Picker"
            aria-haspopup="listbox"
            aria-expanded="false"
            onclick="
              this.setAttribute('aria-expanded', 'true');
              document.querySelector('#modal-choices').hidden = false;
            "
          />
          <div id="modal-choices" role="listbox" hidden>
            <div role="option">Choice</div>
          </div>
        </section>
      `,
      async (page) => {
        const shadow = await propose(
          page,
          {
            kind: "click",
            target: "Picker",
          }
        );
        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal: shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );
        assert.equal(
          await page
            .locator("#modal-picker")
            .getAttribute(
              "aria-expanded"
            ),
          "true"
        );
        assert.equal(
          await page
            .locator("#background-picker")
            .getAttribute(
              "aria-expanded"
            ),
          "false"
        );
      }
    );
  }
);

test(
  "rejects inappropriate and consequence-bearing input activation",
  async () => {
    await withPage(
      `
        <input type="checkbox" aria-label="Subscribe" />
        <input type="radio" aria-label="Plan" />
        <input type="file" aria-label="Attachment" />
        <input type="submit" aria-label="Continue" />
        <input type="button" aria-label="Proceed" />
        <input aria-label="Save" aria-haspopup="listbox" />
      `,
      async (page) => {
        for (const target of [
          "Subscribe",
          "Plan",
          "Attachment",
          "Continue",
          "Proceed",
          "Save",
        ]) {
          const shadow = await propose(
            page,
            {
              kind: "click",
              target,
            }
          );

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );
        }
      }
    );
  }
);

test(
  "context metadata does not create verdict or oracle semantics",
  async () => {
    await withPage(
      `<h2>Ready</h2>`,
      async (page) => {
        const withoutContext =
          await propose(page, {
            kind: "assert",
            target: "Ready",
          });
        const withContext =
          await propose(page, {
            kind: "assert",
            target: "Ready",
            contextText: "Ignored context",
          });

        assert.deepEqual(
          withContext.evaluation,
          withoutContext.evaluation
        );

        const artifact = JSON.parse(
          fs.readFileSync(
            withContext.artifactPath,
            "utf8"
          )
        ) as {
          proposal: {
            action?: Record<
              string,
              unknown
            >;
          };
          safety: {
            affectedTestResult: boolean;
          };
        };

        assert.equal(
          artifact.safety
            .affectedTestResult,
          false
        );
        assert.equal(
          artifact.proposal.action
            ?.contextText,
          "Ignored context"
        );
        assert.equal(
          "oracleId" in
            (artifact.proposal.action ||
              {}),
          false
        );
        assert.equal(
          "verdict" in artifact,
          false
        );
      }
    );
  }
);


test(
  "includes only an aria-associated portaled popup with one active modal",
  async () => {
    await withPage(
      `
        <button id="background">Background action</button>
        <section role="dialog" aria-modal="true" aria-label="Picker dialog">
          <input
            aria-label="Picker"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="true"
            aria-controls="picker-options"
          />
        </section>
        <div id="picker-options" role="listbox">
          <div role="option">Choice A</div>
          <div role="option">Choice B</div>
        </div>
        <div id="unrelated-options" role="listbox">
          <div role="option">Unrelated</div>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls.some(
            (control) =>
              control.label ===
              "Background action"
          ),
          false
        );
        assert.equal(
          observation.controls.some(
            (control) =>
              control.label === "Choice A" &&
              control.kind === "option"
          ),
          true
        );
        assert.equal(
          observation.controls.some(
            (control) =>
              control.label === "Unrelated"
          ),
          false
        );
        assert.equal(
          observation.surfaces.some(
            (surface) =>
              surface.kind === "listbox" &&
              surface.textPreview.includes(
                "Choice A"
              )
          ),
          true
        );

        const picker =
          observation.inputs.find(
            (input) =>
              input.label === "Picker"
          );

        assert.equal(
          picker?.expanded,
          true
        );
        assert.equal(
          picker?.controls,
          "picker-options"
        );
        assert.equal(
          picker?.hasPopup,
          "listbox"
        );
      }
    );
  }
);

test(
  "treats observed option activation as a mutation boundary",
  async () => {
    await withPage(
      `
        <section role="dialog" aria-modal="true" aria-label="Picker dialog">
          <input
            aria-label="Picker"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="true"
            aria-controls="picker-options"
          />
        </section>
        <div id="picker-options" role="listbox">
          <div role="option">Choice A</div>
        </div>
      `,
      async (page) => {
        for (const kind of [
          "click",
          "select",
        ] as const) {
          const shadow =
            await propose(page, {
              kind,
              target: "Choice A",
            });

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );
          assert.equal(
            shadow.evaluation.safeToExecute,
            false
          );
        }
      }
    );
  }
);

test(
  "fails safe for multiple unassociated portaled popups with one active modal",
  async () => {
    await withPage(
      `
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Picker dialog"
        >
          <input
            aria-label="Picker"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="true"
          />
        </section>

        <div role="listbox">
          <div role="option">Choice A</div>
        </div>

        <div role="listbox">
          <div role="option">Choice B</div>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls.some(
            (control) =>
              control.label === "Choice A" ||
              control.label === "Choice B"
          ),
          false
        );

        assert.equal(
          observation.surfaces.some(
            (surface) =>
              surface.kind === "listbox"
          ),
          false
        );
      }
    );
  }
);


test(
  "observes options from one unique class-based portaled dropdown",
  async () => {
    await withPage(
      `
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Picker dialog"
        >
          <input
            aria-label="Picker"
            role="combobox"
            aria-expanded="true"
          />
        </section>

        <div class="generic-dropdown">
          <div role="option">Choice C</div>
          <div role="option">Choice D</div>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls.some(
            (control) =>
              control.kind === "option" &&
              control.label === "Choice C"
          ),
          true
        );

        assert.equal(
          observation.controls.some(
            (control) =>
              control.kind === "option" &&
              control.label === "Choice D"
          ),
          true
        );
      }
    );
  }
);

test(
  "treats a plain button exposed through an admitted external popup as a mutation boundary",
  async () => {
    await withPage(
      `
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Picker dialog"
        >
          <input
            aria-label="Picker"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="true"
            aria-controls="picker-popup"
          />
        </section>

        <div id="picker-popup">
          <button type="button">
            Choice A
          </button>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        const choice =
          observation.controls.find(
            (control) =>
              control.label === "Choice A"
          );

        assert.equal(
          choice?.kind,
          "button"
        );

        assert.equal(
          choice?.externalPopup,
          true
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "Choice A",
          });

        assert.equal(
          shadow.evaluation.status,
          "MUTATION_RISK"
        );

        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );
      }
    );
  }
);

test(
  "canonicalizes nested external popup wrappers while ignoring an unrelated trigger",
  async () => {
    await withPage(
      `
        <button
          class="generic-dropdown-trigger"
          type="button"
        >
          Background picker
        </button>

        <section
          role="dialog"
          aria-modal="true"
          aria-label="Picker dialog"
        >
          <input
            aria-label="Picker"
            role="combobox"
            aria-expanded="true"
          />
        </section>

        <div class="generic-popover">
          <div class="generic-popover-content">
            <div class="generic-popover-inner">
              <button type="button">
                Choice A
              </button>
              <button type="button">
                Choice B
              </button>
            </div>
          </div>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        const choiceA =
          observation.controls.find(
            (control) =>
              control.label === "Choice A"
          );

        const choiceB =
          observation.controls.find(
            (control) =>
              control.label === "Choice B"
          );

        assert.equal(
          choiceA?.externalPopup,
          true
        );

        assert.equal(
          choiceB?.externalPopup,
          true
        );

        assert.equal(
          observation.controls.some(
            (control) =>
              control.label ===
                "Background picker"
          ),
          false
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "Choice A",
          });

        assert.equal(
          shadow.evaluation.status,
          "MUTATION_RISK"
        );

        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );
      }
    );
  }
);

test(
  "transports bounded executed action history into the next shadow model input",
  async () => {
    await withPage(
      `
        <main>
          <button>Continue</button>
        </main>
      `,
      async (page) => {
        const executedActions = [
          {
            kind: "click",
            target: "First surface",
          },
          {
            kind: "click",
            target: "Second surface",
          },
          {
            kind: "click",
            target: "Third surface",
          },
          {
            kind: "click",
            target: "Fourth surface",
          },
          {
            kind: "click",
            target: "Fifth surface",
          },
          {
            kind: "click",
            target: "Sixth surface",
          },
          {
            kind: "click",
            target: "Seventh surface",
          },
        ] as const;

        let receivedActions:
          unknown = null;

        const result =
          await runGenericBrowserShadow({
            page,
            issueKey: "SYNTHETIC",
            testCase: {
              id: "executed-action-history",
              goal:
                "Continue from the current observed state.",
            },
            outputRoot,
            executedActions: [
              ...executedActions,
            ],
            requestProposal:
              async (input) => {
                receivedActions =
                  input.executedActions;

                return {
                  decision:
                    "NO_SAFE_ACTION",
                  rationale:
                    "No further safe action is required for this transport test.",
                  confidence: "high",
                };
              },
          });

        assert.equal(
          result.status,
          "RECORDED"
        );

        assert.deepEqual(
          receivedActions,
          executedActions.slice(-6)
        );
      }
    );
  }
);

test(
  "executes one grounded transient external popup selection only with browser mutation permission",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Picker dialog"
          >
            <input
              aria-label="Picker"
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded="true"
              aria-controls="picker-popup"
            />
            <div id="selection-state">
              Nothing selected
            </div>
          </section>

          <div id="picker-popup">
            <button
              type="button"
              onclick="
                document
                  .querySelector('#selection-state')
                  .textContent =
                    'Choice selected';
              "
            >
              Choice A
            </button>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Choice A",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation.safeToExecute,
            true
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.externalPopup,
            true
          );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            });

          assert.equal(
            execution.status,
            "EXECUTED"
          );

          assert.equal(
            execution.executed,
            true
          );

          assert.equal(
            execution.stateChanged,
            true
          );

          assert.equal(
            await page
              .locator(
                "#selection-state"
              )
              .innerText(),
            "Choice selected"
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "escalates repeated popup controls to the nearest unique ancestor context",
  async () => {
    const previousMutationPermission =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Adjustment dialog"
          >
            <div>Adjustment controls</div>
          </section>

          <div class="generic-popover">
            <section data-group="alpha">
              <strong>Criterion Alpha</strong>
              <div>
                <button
                  type="button"
                  onclick="
                    document
                      .querySelector('#alpha-picked')
                      .hidden = false;
                  "
                >
                  A1
                </button>
                <button type="button">
                  A2
                </button>
              </div>
              <p id="alpha-picked" hidden>
                Alpha selected
              </p>
            </section>

            <section data-group="beta">
              <strong>Criterion Beta</strong>
              <div>
                <button
                  type="button"
                  onclick="
                    document
                      .querySelector('#beta-picked')
                      .hidden = false;
                  "
                >
                  A1
                </button>
                <button type="button">
                  A2
                </button>
              </div>
              <p id="beta-picked" hidden>
                Beta selected
              </p>
            </section>
          </div>
        `,
        async (page) => {
          const observation =
            await observeBrowserPage(page);

          const repeated =
            observation.controls.filter(
              (control) =>
                control.label === "A1"
            );

          assert.equal(
            repeated.length,
            2
          );

          assert.deepEqual(
            repeated.map(
              (control) =>
                control.contextText
            ),
            [
              "Criterion Alpha",
              "Criterion Beta",
            ]
          );

          assert.equal(
            repeated.every(
              (control) =>
                control.externalPopup ===
                true
            ),
            true
          );

          const shadow =
            await propose(page, {
              kind: "click",
              target: "A1",
              contextText:
                "Criterion Beta",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation.safeToExecute,
            true
          );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            });

          assert.equal(
            execution.status,
            "EXECUTED"
          );

          assert.equal(
            execution.stateChanged,
            true
          );

          assert.equal(
            await page
              .locator("#beta-picked")
              .isVisible(),
            true
          );

          assert.equal(
            await page
              .locator("#alpha-picked")
              .isVisible(),
            false
          );
        }
      );
    } finally {
      if (
        previousMutationPermission ===
        undefined
      ) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previousMutationPermission;
      }
    }
  }
);

test(
  "accepts null action for a terminal goal-satisfied proposal",
  async () => {
    await withPage(
      `
        <main>
          <h1>Reached state</h1>
        </main>
      `,
      async (page) => {
        const result =
          await runGenericBrowserShadow({
            page,
            issueKey: "TEST-1",
            testCase: {
              id: "web-1",
              persona: "company_admin",
              goal:
                "Verify the reached state.",
              startRoute: "/test",
              successCriteria:
                "The expected state is visible.",
              steps: [],
            },
            requestProposal:
              async () => ({
                decision:
                  "GOAL_ALREADY_SATISFIED",
                action: null,
                rationale:
                  "No further navigation is required.",
                confidence: "high",
              }),
          });

        assert.equal(
          result.status,
          "RECORDED"
        );

        if (
          result.status !==
          "RECORDED"
        ) {
          return;
        }

        assert.equal(
          result.proposal.decision,
          "GOAL_ALREADY_SATISFIED"
        );

        assert.equal(
          result.proposal.action,
          undefined
        );

        assert.equal(
          result.evaluation.status,
          "ALREADY_SATISFIED"
        );

        assert.equal(
          result.evaluation.grounded,
          true
        );
      }
    );
  }
);
test(
  "accepts an empty action object for a terminal goal-satisfied proposal",
  async () => {
    await withPage(
      `
        <main>
          <h1>Reached state</h1>
        </main>
      `,
      async (page) => {
        const result =
          await runGenericBrowserShadow({
            page,
            issueKey: "TEST-1",
            testCase: {
              id: "web-1",
              persona: "company_admin",
              goal:
                "Verify the reached state.",
              startRoute: "/test",
              successCriteria:
                "The expected state is visible.",
              steps: [],
            },
            requestProposal:
              async () => ({
                decision:
                  "GOAL_ALREADY_SATISFIED",
                action: {},
                rationale:
                  "No further navigation is required.",
                confidence: "high",
              }),
          });

        assert.equal(
          result.status,
          "RECORDED"
        );

        if (
          result.status !==
          "RECORDED"
        ) {
          return;
        }

        assert.equal(
          result.proposal.decision,
          "GOAL_ALREADY_SATISFIED"
        );

        assert.equal(
          result.proposal.action,
          undefined
        );

        assert.equal(
          result.evaluation.status,
          "ALREADY_SATISFIED"
        );
      }
    );
  }
);

test(
  "rejects an empty action object for an executable proposal",
  async () => {
    await withPage(
      `
        <main>
          <button>Continue</button>
        </main>
      `,
      async (page) => {
        const result =
          await runGenericBrowserShadow({
            page,
            issueKey: "TEST-1",
            testCase: {
              id: "web-1",
              persona: "company_admin",
              goal:
                "Continue safely.",
              startRoute: "/test",
              successCriteria:
                "The next state is reached.",
              steps: [],
            },
            requestProposal:
              async () => ({
                decision:
                  "PROPOSE_ACTION",
                action: {},
                rationale:
                  "A next action is required.",
                confidence: "high",
              }),
          });

        assert.equal(
          result.status,
          "ERROR"
        );

        if (
          result.status !==
          "ERROR"
        ) {
          return;
        }

        assert.match(
          result.note,
          /Unsupported shadow action kind/
        );
      }
    );
  }
);

test(
  "keeps descendant semantic control labels aligned through observation evaluation and execution",
  async () => {
    await withPage(
      `
        <button
          type="button"
          onclick="
            document
              .querySelector('#filter-state')
              .hidden = false;
          "
        >
          <span
            aria-label="filter"
            data-icon="filter"
            class="anticon anticon-filter filter"
          ></span>
        </button>

        <section
          id="filter-state"
          role="dialog"
          aria-label="Filter panel"
          hidden
        >
          Filter opened
        </section>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        const matches =
          observation.controls.filter(
            (control) =>
              control.label === "filter"
          );

        assert.equal(
          matches.length,
          1
        );

        assert.equal(
          matches[0]?.kind,
          "button"
        );

        assert.equal(
          observation.controls.some(
            (control) =>
              control.label.includes(
                "anticon"
              )
          ),
          false
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "filter",
          });

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        assert.equal(
          shadow.evaluation
            .matchedTarget?.source,
          "control"
        );

        assert.equal(
          shadow.evaluation
            .matchedTarget?.label,
          "filter"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );

        assert.equal(
          execution.executed,
          true
        );

        assert.equal(
          execution.stateChanged,
          true
        );

        assert.equal(
          await page
            .locator("#filter-state")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "does not promote raw descendant CSS classes into semantic control labels",
  async () => {
    await withPage(
      `
        <button type="button">
          <span
            class="anticon anticon-filter filter"
          ></span>
        </button>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(page);

        assert.equal(
          observation.controls.some(
            (control) =>
              /anticon|filter/i.test(
                control.label
              )
          ),
          false
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "filter",
          });

        assert.equal(
          shadow.evaluation.status,
          "TARGET_NOT_GROUNDED"
        );

        assert.equal(
          shadow.evaluation.safeToExecute,
          false
        );
      }
    );
  }
);

test(
  "verifies a newly visible runtime surface after one grounded control click",
  async () => {
    await withPage(
      `
        <button
          type="button"
          onclick="
            document
              .querySelector('#runtime-surface')
              .hidden = false;
          "
        >
          Options
        </button>

        <div
          id="runtime-surface"
          class="generic-dropdown"
          hidden
        >
          <span>Runtime choices</span>
        </div>
      `,
      async (page) => {
        const shadow =
          await propose(page, {
            kind: "click",
            target: "Options",
          });

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        assert.equal(
          shadow.evaluation
            .matchedTarget?.source,
          "control"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );

        assert.equal(
          execution.executed,
          true
        );

        assert.equal(
          execution.stateChanged,
          true
        );

        /*
         * The synthetic dropdown intentionally has no semantic
         * surface role and no observation-visible text shape.
         * The runtime-surface verifier, rather than the normal
         * observation fingerprint, must establish the transition.
         */
        assert.equal(
          execution.beforeObservation
            ?.surfaces.length,
          0
        );

        assert.equal(
          execution.afterObservation
            ?.surfaces.length,
          0
        );

        assert.equal(
          execution.afterObservation
            ?.visibleText.includes(
              "Runtime choices"
            ),
          false
        );

        assert.equal(
          await page
            .locator("#runtime-surface")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "keeps a grounded no-op control as verification failed when no runtime surface opens",
  async () => {
    await withPage(
      `
        <button type="button">
          No-op control
        </button>
      `,
      async (page) => {
        const shadow =
          await propose(page, {
            kind: "click",
            target: "No-op control",
          });

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "VERIFICATION_FAILED"
        );

        assert.equal(
          execution.executed,
          true
        );

        assert.equal(
          execution.stateChanged,
          false
        );
      }
    );
  }
);

test(
  "transports an opened tooltip runtime surface into the next browser observation",
  async () => {
    await withPage(
      `
        <button
          type="button"
          onclick="
            document
              .querySelector('#filter-tooltip')
              .hidden = false;
          "
        >
          Filters
        </button>

        <div
          id="filter-tooltip"
          role="tooltip"
          hidden
        >
          <div>Project</div>
          <div>Status</div>
          <div>Type</div>
        </div>
      `,
      async (page) => {
        const shadow =
          await propose(page, {
            kind: "click",
            target: "Filters",
          });

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        assert.equal(
          shadow.evaluation
            .matchedTarget?.source,
          "control"
        );

        const execution =
          await executeBrowserReadOnlyProposal({
            page,
            proposal:
              shadow.proposal,
            evaluation:
              shadow.evaluation,
          });

        assert.equal(
          execution.status,
          "EXECUTED"
        );

        assert.equal(
          execution.executed,
          true
        );

        assert.equal(
          execution.stateChanged,
          true
        );

        assert.equal(
          execution.beforeObservation
            ?.surfaces.length,
          0
        );

        const tooltipSurface =
          execution.afterObservation
            ?.surfaces.find(
              (surface) =>
                surface.role === "tooltip"
            );

        assert.ok(tooltipSurface);

        assert.equal(
          tooltipSurface.kind,
          "surface"
        );

        assert.match(
          tooltipSurface.textPreview,
          /Project.*Status.*Type/
        );
      }
    );
  }
);
test(
  "allows a consequence-word bound semantic option only as an authorized transient click",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div>
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Publish"
                aria-selected="false"
              >
                internal-publish-value
              </div>
            </div>

            <span style="cursor: pointer">
              Publish
            </span>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Publish",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            true
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "keeps a consequence-word bound semantic option rejected for select actions",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div>
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Publish"
              >
                internal-publish-value
              </div>
            </div>

            <span style="cursor: pointer">
              Publish
            </span>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "select",
              target: "Publish",
            });

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            false
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "keeps an ordinary consequence-word control rejected when browser mutations are enabled",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <button type="button">
            Publish
          </button>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Publish",
            });

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            false
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            undefined
          );

          /*
           * Executor defense-in-depth regression:
           * even if an upstream evaluator were to misclassify this
           * ordinary consequence-bearing control as executable,
           * the executor must independently reject it.
           */
          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal: shadow.proposal,
              evaluation: {
                ...shadow.evaluation,
                status: "SAFE_TO_EXECUTE",
                safeToExecute: true,
                grounded: true,
              },
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
            execution.stateChanged,
            false
          );

          assert.match(
            execution.note,
            /independently blocked a potentially consequential control label/
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "keeps one bound semantic option behind the browser mutation permission boundary",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    delete process.env
      .QA_ALLOW_BROWSER_MUTATIONS;

    try {
      await withPage(
        `
          <div>
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Update"
                aria-selected="false"
              >
                internal-update-value
              </div>
            </div>

            <span style="cursor: pointer">
              Update
            </span>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Update",
            });

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            false
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "authorizes one exact bound semantic option only with browser mutation permission",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div>
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Update"
                aria-selected="false"
              >
                internal-update-value
              </div>
            </div>

            <span style="cursor: pointer">
              Update
            </span>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Update",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            true
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.kind,
            "option"
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "keeps an ordinary visible option rejected even when browser mutation permission is enabled",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div role="listbox">
            <div
              role="option"
              aria-label="Choice A"
              aria-selected="false"
            >
              Choice A
            </div>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Choice A",
            });

          assert.equal(
            shadow.evaluation.status,
            "MUTATION_RISK"
          );

          assert.equal(
            shadow.evaluation
              .safeToExecute,
            false
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            undefined
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "executes one live exact semantic option binding with browser mutation permission",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div id="option-host">
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Update"
                aria-selected="false"
              >
                internal-update-value
              </div>
            </div>

            <span
              id="update-row"
              style="cursor: pointer"
              onclick="
                document
                  .querySelector(
                    '#selection-state'
                  )
                  .hidden = false;
              "
            >
              Update
            </span>

            <div
              id="selection-state"
              role="status"
              hidden
            >
              Update selected
            </div>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Update",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            true
          );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            });

          assert.equal(
            execution.status,
            "EXECUTED"
          );

          assert.equal(
            execution.executed,
            true
          );

          assert.equal(
            execution.stateChanged,
            true
          );

          assert.equal(
            await page
              .locator(
                "#selection-state"
              )
              .isVisible(),
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "executes one consequence-word bound semantic option through the live executor",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div id="option-host">
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Publish"
                aria-selected="false"
              >
                internal-publish-value
              </div>
            </div>

            <span
              id="publish-row"
              style="cursor: pointer"
              onclick="
                document
                  .querySelector(
                    '#selection-state'
                  )
                  .hidden = false;
              "
            >
              Publish
            </span>

            <div
              id="selection-state"
              role="status"
              hidden
            >
              Publish selected
            </div>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Publish",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          assert.equal(
            shadow.evaluation
              .matchedTarget
              ?.semanticOptionBinding,
            true
          );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            });

          assert.equal(
            execution.status,
            "EXECUTED"
          );

          assert.equal(
            execution.executed,
            true
          );

          assert.equal(
            execution.stateChanged,
            true
          );

          assert.equal(
            await page
              .locator(
                "#selection-state"
              )
              .isVisible(),
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "re-resolves a semantic option binding after the visual row rerenders",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div id="option-host">
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Update"
                aria-selected="false"
              >
                internal-update-value
              </div>
            </div>

            <span
              id="old-update-row"
              style="cursor: pointer"
            >
              Update
            </span>

            <div
              id="selection-state"
              role="status"
              hidden
            >
              Update selected
            </div>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Update",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          await page
            .locator(
              "#old-update-row"
            )
            .evaluate(
              (element) => {
                const replacement =
                  document.createElement(
                    "span"
                  );

                replacement.id =
                  "new-update-row";

                replacement.style.cursor =
                  "pointer";

                replacement.textContent =
                  "Update";

                replacement.onclick =
                  () => {
                    const state =
                      document
                        .querySelector(
                          "#selection-state"
                        );

                    if (
                      state instanceof
                      HTMLElement
                    ) {
                      state.hidden =
                        false;
                    }
                  };

                element.replaceWith(
                  replacement
                );
              }
            );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            });

          assert.equal(
            execution.status,
            "EXECUTED"
          );

          assert.equal(
            execution.executed,
            true
          );

          assert.equal(
            execution.stateChanged,
            true
          );

          assert.equal(
            await page
              .locator(
                "#selection-state"
              )
              .isVisible(),
            true
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "fails safe when a semantic option binding becomes visually ambiguous before execution",
  async () => {
    const previous =
      process.env
        .QA_ALLOW_BROWSER_MUTATIONS;

    process.env
      .QA_ALLOW_BROWSER_MUTATIONS =
      "true";

    try {
      await withPage(
        `
          <div id="option-host">
            <div
              role="listbox"
              style="
                width: 0;
                height: 0;
                overflow: hidden;
              "
            >
              <div
                role="option"
                aria-label="Update"
                aria-selected="false"
              >
                internal-update-value
              </div>
            </div>

            <span
              id="update-row"
              style="cursor: pointer"
            >
              Update
            </span>
          </div>
        `,
        async (page) => {
          const shadow =
            await propose(page, {
              kind: "click",
              target: "Update",
            });

          assert.equal(
            shadow.evaluation.status,
            "SAFE_TO_EXECUTE"
          );

          await page
            .locator(
              "#option-host"
            )
            .evaluate(
              (host) => {
                const duplicate =
                  document.createElement(
                    "span"
                  );

                duplicate.style.cursor =
                  "pointer";

                duplicate.textContent =
                  "Update";

                host.appendChild(
                  duplicate
                );
              }
            );

          const execution =
            await executeBrowserReadOnlyProposal({
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
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
            execution.stateChanged,
            false
          );
        }
      );
    } finally {
      if (previous === undefined) {
        delete process.env
          .QA_ALLOW_BROWSER_MUTATIONS;
      } else {
        process.env
          .QA_ALLOW_BROWSER_MUTATIONS =
          previous;
      }
    }
  }
);

test(
  "observes one unique semantic option binding from a hidden identity tree to one visible exact row",
  async () => {
    await withPage(
      `
        <div id="option-host">
          <div
            role="listbox"
            style="
              width: 0;
              height: 0;
              overflow: hidden;
            "
          >
            <div
              role="option"
              aria-label="Update"
              aria-selected="false"
            >
              internal-update-value
            </div>
          </div>

          <div>
            <div style="cursor: pointer">
              <span style="cursor: pointer">
                Update
              </span>
            </div>
          </div>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        const updateOptions =
          observation.controls.filter(
            (control) =>
              control.label ===
                "Update" &&
              control.kind ===
                "option"
          );

        assert.equal(
          updateOptions.length,
          1
        );

        assert.equal(
          updateOptions[0]!
            .semanticOptionBinding,
          true
        );

        assert.equal(
          updateOptions[0]!.role,
          "option"
        );

        assert.equal(
          updateOptions[0]!.selected,
          false
        );
      }
    );
  }
);

test(
  "fails safe when semantic option identity is duplicated before visual binding",
  async () => {
    await withPage(
      `
        <div>
          <div
            role="listbox"
            style="
              width: 0;
              height: 0;
              overflow: hidden;
            "
          >
            <div
              role="option"
              aria-label="Update"
            >
              internal-a
            </div>

            <div
              role="option"
              aria-label="Update"
            >
              internal-b
            </div>
          </div>

          <span style="cursor: pointer">
            Update
          </span>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        assert.equal(
          observation.controls.filter(
            (control) =>
              control.label ===
                "Update" &&
              control
                .semanticOptionBinding ===
                true
          ).length,
          0
        );
      }
    );
  }
);

test(
  "fails safe when one semantic option identity has multiple visible exact rows",
  async () => {
    await withPage(
      `
        <div>
          <div
            role="listbox"
            style="
              width: 0;
              height: 0;
              overflow: hidden;
            "
          >
            <div
              role="option"
              aria-label="Update"
            >
              internal-update-value
            </div>
          </div>

          <span style="cursor: pointer">
            Update
          </span>

          <span style="cursor: pointer">
            Update
          </span>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        assert.equal(
          observation.controls.filter(
            (control) =>
              control.label ===
                "Update" &&
              control
                .semanticOptionBinding ===
                true
          ).length,
          0
        );
      }
    );
  }
);

test(
  "does not promote a hidden semantic option when no visible exact row exists",
  async () => {
    await withPage(
      `
        <div>
          <div
            role="listbox"
            style="
              width: 0;
              height: 0;
              overflow: hidden;
            "
          >
            <div
              role="option"
              aria-label="Update"
            >
              internal-update-value
            </div>
          </div>

          <span style="cursor: pointer">
            Different option
          </span>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        assert.equal(
          observation.controls.filter(
            (control) =>
              control.label ===
                "Update" &&
              control
                .semanticOptionBinding ===
                true
          ).length,
          0
        );
      }
    );
  }
);

test(
  "grounds and executes one unique roleless exact-text item inside an observed tooltip surface",
  async () => {
    await withPage(
      `
        <div
          id="filter-surface"
          role="tooltip"
        >
          <div style="cursor: pointer">
            <div style="cursor: pointer">
              <span>Project</span>
            </div>
          </div>

          <div style="cursor: pointer">
            <div style="cursor: pointer">
              <span>Status</span>
            </div>
          </div>

          <div style="cursor: pointer">
            <div style="cursor: pointer">
              <span
                id="type-item"
                style="cursor: pointer"
                onclick="
                  document
                    .querySelector(
                      '#type-options'
                    )
                    .hidden = false;
                "
              >
                Type
              </span>
            </div>
          </div>
        </div>

        <div
          id="type-options"
          role="tooltip"
          hidden
        >
          Select type
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        const typeControls =
          observation.controls.filter(
            (control) =>
              control.label === "Type"
          );

        assert.equal(
          typeControls.length,
          1
        );

        assert.equal(
          typeControls[0]!.kind,
          "control"
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "Type",
          });

        assert.equal(
          shadow.evaluation.status,
          "SAFE_TO_EXECUTE"
        );

        assert.equal(
          shadow.evaluation
            .matchedTarget?.source,
          "control"
        );

        const execution =
          await executeBrowserReadOnlyProposal(
            {
              page,
              proposal:
                shadow.proposal,
              evaluation:
                shadow.evaluation,
            }
          );

        assert.equal(
          execution.status,
          "EXECUTED"
        );

        assert.equal(
          execution.executed,
          true
        );

        assert.equal(
          execution.stateChanged,
          true
        );

        assert.equal(
          await page
            .locator("#type-options")
            .isVisible(),
          true
        );
      }
    );
  }
);

test(
  "fails safe when an observed tooltip exposes duplicate roleless exact-text items",
  async () => {
    await withPage(
      `
        <div role="tooltip">
          <span style="cursor: pointer">
            Type
          </span>

          <span style="cursor: pointer">
            Type
          </span>
        </div>
      `,
      async (page) => {
        const observation =
          await observeBrowserPage(
            page
          );

        assert.equal(
          observation.controls.filter(
            (control) =>
              control.label === "Type"
          ).length,
          2
        );

        const shadow =
          await propose(page, {
            kind: "click",
            target: "Type",
          });

        assert.equal(
          shadow.evaluation.status,
          "TARGET_NOT_GROUNDED"
        );

        assert.equal(
          shadow.evaluation
            .safeToExecute,
          false
        );
      }
    );
  }
);

test("semantic table rows retain grounded column values", async () => {
  await withPage(`
    <table aria-label="Records">
      <thead><tr><th>Name</th><th>Created At</th></tr></thead>
      <tbody>
        <tr><td>First</td><td>2026-02-02</td></tr>
        <tr><td>Second</td><td>2026-01-01</td></tr>
      </tbody>
    </table>
  `, async (page) => {
    const observed = await observeBrowserPage(page);
    assert.equal(
      observed.collections?.[0]
        ?.identity.method,
      "ARIA_NAME"
    );
    assert.deepEqual(
      observed.collections?.[0]
        ?.fields.map(
          (field) => field.visibleLabel
        ),
      ["Name", "Created At"]
    );
    assert.deepEqual(
      observed.collections?.[0]
        ?.rows.map((row) =>
          row.cells.map(
            (cell) => cell.rawValue
          )
        ),
      [
        ["First", "2026-02-02"],
        ["Second", "2026-01-01"],
      ]
    );
  });
});

test("separate semantic tables remain separate collections", async () => {
  await withPage(`
    <table aria-label="Jobs"><tr><th>Date</th></tr><tr><td>2026-02-02</td></tr></table>
    <table aria-label="Archive"><tr><th>Date</th></tr><tr><td>2025-01-01</td></tr></table>
  `, async (page) => {
    const observed = await observeBrowserPage(page);
    assert.deepEqual(
      observed.collections?.map((item) => item.label),
      ["Jobs", "Archive"]
    );
  });
});

test("active modal collection observation excludes background tables", async () => {
  await withPage(`
    <table aria-label="Background"><tr><th>Date</th></tr><tr><td>2025-01-01</td></tr></table>
    <div role="dialog" aria-modal="true" aria-label="Active dialog" style="position:fixed;inset:10px;background:white">
      <table aria-label="Dialog records"><tr><th>Date</th></tr><tr><td>2026-01-01</td></tr></table>
    </div>
  `, async (page) => {
    const observed = await observeBrowserPage(page);
    assert.deepEqual(
      observed.collections?.map((item) => item.label),
      ["Dialog records"]
    );
  });
});

test("plain lists do not become arbitrary ordering collections", async () => {
  await withPage(`
    <ul><li>2026-02-02</li><li>2026-01-01</li></ul>
  `, async (page) => {
    const observed = await observeBrowserPage(page);
    assert.deepEqual(observed.collections, []);
  });
});
