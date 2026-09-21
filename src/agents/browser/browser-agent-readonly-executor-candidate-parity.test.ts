import assert from "node:assert/strict";
import test from "node:test";

import {
  chromium,
} from "playwright";

import {
  executeBrowserReadOnlyProposal,
} from "./browser-agent-readonly-executor.js";
import {
  evaluateBrowserShadowProposal,
} from "./browser-agent-shadow-evaluator.js";
import {
  observeBrowserPage,
} from "./browser-observation.js";

process.env
  .QA_GENERIC_BROWSER_READONLY_EXECUTION =
  "true";

test(
  "executor does not truncate raw hidden controls before an observer-admitted semantic target",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      const hiddenButtons =
        Array.from(
          {
            length: 90,
          },
          (_, index) =>
            `<button hidden>Hidden ${index}</button>`
        ).join("");

      await page.setContent(`
        <main>
          ${hiddenButtons}

          <button
            id="deep-target"
            data-placeholder="Deep Target"
            aria-expanded="false"
            onclick="
              this.setAttribute(
                'aria-expanded',
                'true'
              );
            "
          >
            Accessible Name Is Different
          </button>
        </main>
      `);

      const observation =
        await observeBrowserPage(
          page
        );

      const observed =
        observation.controls.filter(
          (control) =>
            control.kind ===
              "button" &&
            control.label ===
              "Deep Target"
        );

      assert.equal(
        observed.length,
        1
      );

      /*
       * The accessible role name intentionally differs from
       * the observer's semantic label, forcing execution through
       * the observation-aligned fallback.
       */
      const exactRoleCount =
        await page
          .getByRole(
            "button",
            {
              name:
                /^\s*Deep Target\s*$/i,
            }
          )
          .count();

      assert.equal(
        exactRoleCount,
        0
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal: {
            decision:
              "PROPOSE_ACTION",
            action: {
              kind: "click",
              target:
                "Deep Target",
            },
            rationale:
              "Exact observer-admitted semantic target.",
            confidence:
              "high",
          },
          evaluation: {
            status:
              "SAFE_TO_EXECUTE",
            safeToExecute: true,
            grounded: true,
            reason:
              "Exact enabled semantic control.",
            matchedTarget: {
              source:
                "control",
              label:
                "Deep Target",
              kind:
                "button",
            },
          },
        });

      assert.equal(
        result.status,
        "EXECUTED",
        result.note
      );

      assert.equal(
        result.executed,
        true
      );

      assert.equal(
        result.stateChanged,
        true
      );

      assert.match(
        result.note,
        /observation-aligned DOM fallback/
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "observation-aligned fallback still fails safe for duplicate exact visible controls",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <button
            data-placeholder="Duplicate"
          >
            First Accessible Name
          </button>

          <button
            data-placeholder="Duplicate"
          >
            Second Accessible Name
          </button>
        </main>
      `);

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal: {
            decision:
              "PROPOSE_ACTION",
            action: {
              kind: "click",
              target:
                "Duplicate",
            },
            rationale:
              "Ambiguous exact observer target.",
            confidence:
              "low",
          },
          evaluation: {
            status:
              "SAFE_TO_EXECUTE",
            safeToExecute: true,
            grounded: true,
            reason:
              "Synthetic ambiguity regression.",
            matchedTarget: {
              source:
                "control",
              label:
                "Duplicate",
              kind:
                "button",
            },
          },
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );

      assert.equal(
        result.executed,
        false
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "executor refreshes a same-collection observation after page state changes first",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <h1>Results</h1>
          <p role="status" id="page-state">
            1 of 3 • 6 total results
          </p>
          <button
            aria-label="Previous page"
            disabled
          >
            Previous page
          </button>
          <button
            aria-label="Next page"
            onclick="advancePage()"
          >
            Next page
          </button>
          <table aria-label="Results">
            <thead>
              <tr><th>Name</th></tr>
            </thead>
            <tbody id="rows">
              <tr data-row-key="a"><td>A</td></tr>
              <tr data-row-key="b"><td>B</td></tr>
            </tbody>
          </table>
          <script>
            function advancePage() {
              document.getElementById("page-state").textContent =
                "2 of 3 • 6 total results";
              window.setTimeout(() => {
                document.getElementById("rows").innerHTML =
                  "<tr data-row-key='c'><td>C</td></tr>" +
                  "<tr data-row-key='d'><td>D</td></tr>";
              }, 900);
            }
          </script>
        </main>
      `);

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal: {
            decision:
              "PROPOSE_ACTION",
            action: {
              kind: "click",
              target:
                "Next page",
            },
            rationale:
              "Advance one grounded collection page.",
            confidence:
              "high",
          },
          evaluation: {
            status:
              "SAFE_TO_EXECUTE",
            safeToExecute: true,
            grounded: true,
            reason:
              "Exact enabled transient control.",
            matchedTarget: {
              source:
                "control",
              label:
                "Next page",
              kind:
                "button",
            },
          },
        });

      assert.equal(
        result.status,
        "EXECUTED",
        result.note
      );

      assert.equal(
        result.stateChanged,
        true
      );

      assert.deepEqual(
        result.afterObservation
          ?.collections?.[0]
          ?.rows.map((row) =>
            row.cells[0]?.rawValue
          ),
        ["C", "D"]
      );

      assert.deepEqual(
        result.beforeObservation
          ?.collections?.[0]
          ?.rows.map((row) =>
            row.cells[0]?.rawValue
          ),
        ["A", "B"]
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "executor re-resolves one observer-approved activation input by semantic identity",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <input
            id="generated-picker-17"
            role="combobox"
            type="search"
            aria-haspopup="listbox"
            aria-controls="generated-options-17"
            aria-expanded="false"
            onclick="
              this.setAttribute('aria-expanded', 'true');
              document.querySelector('#generated-options-17').hidden = false;
            "
          />
          <input
            hidden
            id="hidden-generated-picker"
            role="combobox"
            type="search"
            aria-haspopup="listbox"
            aria-controls="hidden-options"
            aria-expanded="false"
          />
          <div
            id="generated-options-17"
            role="listbox"
            hidden
          >
            <div role="option">Choice</div>
          </div>
        </main>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target:
            "generated-picker-17",
        },
        rationale:
          "Open the unique activation-safe input.",
        confidence: "high" as const,
      };
      const observation =
        await observeBrowserPage(page);
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation,
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );
      assert.equal(
        evaluation.matchedTarget
          ?.source,
        "input"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "EXECUTED",
        result.note
      );
      assert.equal(
        result.stateChanged,
        true
      );
      assert.match(
        result.note,
        /exact activation-safe input grounding/
      );
      assert.doesNotMatch(
        result.note,
        /keyboard activation/
      );
      assert.equal(
        await page
          .locator(
            "#generated-options-17"
          )
          .isVisible(),
        true
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "exact selected-value combobox uses bounded role-semantic keyboard activation when pointer preflight is obstructed",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <div
            style="position: relative; width: 240px; height: 36px"
          >
            <input
              aria-label="Project picker"
              role="combobox"
              type="search"
              aria-haspopup="listbox"
              aria-controls="project-options"
              aria-expanded="false"
              style="width: 240px; height: 36px"
              onkeydown="
                if (event.key === 'ArrowDown') {
                  this.setAttribute('aria-expanded', 'true');
                  document.querySelector('#project-options').hidden = false;
                  document.body.dataset.keyboardActivated = 'true';
                }
              "
            />
            <span
              aria-hidden="true"
              style="
                position: absolute;
                inset: 0;
                z-index: 2;
                background: white;
              "
            >
              Selected project
            </span>
          </div>
          <div
            id="project-options"
            role="listbox"
            hidden
          >
            <div role="option">Project A</div>
          </div>
        </main>
      `);

      const input =
        page.getByRole(
          "combobox",
          { name: "Project picker" }
        );

      await assert.rejects(
        input.click({
          trial: true,
          timeout: 500,
        })
      );

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Project picker",
        },
        rationale:
          "Open the exact collapsed project picker.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );
      assert.equal(
        evaluation.matchedTarget
          ?.source,
        "input"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "EXECUTED",
        result.note
      );
      assert.equal(
        result.stateChanged,
        true
      );
      assert.match(
        result.note,
        /role-semantic collapsed-listbox keyboard activation/
      );
      assert.equal(
        await input.getAttribute(
          "aria-expanded"
        ),
        "true"
      );
      assert.equal(
        await page
          .getByRole("listbox")
          .isVisible(),
        true
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-keyboard-activated"
          ),
        "true"
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "disabled activation-safe combobox remains non-executable",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <input
          aria-label="Disabled picker"
          role="combobox"
          type="search"
          aria-haspopup="listbox"
          aria-controls="disabled-options"
          aria-expanded="false"
          disabled
          onkeydown="document.body.dataset.activated = 'true'"
        />
        <div id="disabled-options" role="listbox" hidden></div>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Disabled picker",
        },
        rationale:
          "Synthetic disabled-control guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "TARGET_DISABLED"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-activated"
          ),
        null
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "role-semantic keyboard interaction without expansion or popup remains verification-failed",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <div style="position: relative; width: 240px; height: 36px">
            <input
              aria-label="Inert picker"
              role="combobox"
              type="search"
              aria-haspopup="listbox"
              aria-controls="inert-options"
              aria-expanded="false"
              style="width: 240px; height: 36px"
              onkeydown="document.body.dataset.keyboardActivated = 'true'"
            />
            <span
              aria-hidden="true"
              style="position: absolute; inset: 0; z-index: 2; background: white"
            >Selected value</span>
          </div>
          <div id="inert-options" role="listbox" hidden></div>
        </main>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Inert picker",
        },
        rationale:
          "Synthetic state-verification guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "VERIFICATION_FAILED",
        result.note
      );
      assert.equal(
        result.executed,
        true
      );
      assert.equal(
        result.stateChanged,
        false
      );
      assert.match(
        result.note,
        /role-semantic collapsed-listbox keyboard activation/
      );
      assert.equal(
        await page
          .getByRole("combobox")
          .getAttribute(
            "aria-expanded"
          ),
        "false"
      );
      assert.equal(
        await page
          .getByRole("listbox")
          .isVisible(),
        false
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "hidden activation-safe combobox is not grounded or activated",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <input
          hidden
          aria-label="Hidden picker"
          role="combobox"
          type="search"
          aria-haspopup="listbox"
          aria-controls="hidden-options"
          aria-expanded="false"
          onkeydown="document.body.dataset.activated = 'true'"
        />
        <div id="hidden-options" role="listbox" hidden></div>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Hidden picker",
        },
        rationale:
          "Synthetic hidden-control guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "TARGET_NOT_GROUNDED"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-activated"
          ),
        null
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "pointer-obstructed non-combobox input does not receive keyboard activation fallback",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <div style="position: relative; width: 240px; height: 36px">
            <input
              aria-label="Search disclosure"
              role="textbox"
              type="search"
              aria-haspopup="listbox"
              aria-controls="search-options"
              aria-expanded="false"
              style="width: 240px; height: 36px"
              onkeydown="document.body.dataset.keyboardActivated = 'true'"
            />
            <span
              aria-hidden="true"
              style="position: absolute; inset: 0; z-index: 2; background: white"
            >Presentation</span>
          </div>
          <div id="search-options" role="listbox" hidden></div>
        </main>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target:
            "Search disclosure",
        },
        rationale:
          "Synthetic non-combobox guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "ERROR"
      );
      assert.equal(
        result.executed,
        false
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-keyboard-activated"
          ),
        null
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "expanded combobox does not receive collapsed-listbox keyboard activation fallback",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <div style="position: relative; width: 240px; height: 36px">
            <input
              aria-label="Expanded picker"
              role="combobox"
              type="search"
              aria-haspopup="listbox"
              aria-controls="expanded-options"
              aria-expanded="true"
              style="width: 240px; height: 36px"
              onkeydown="document.body.dataset.keyboardActivated = 'true'"
            />
            <span
              aria-hidden="true"
              style="position: absolute; inset: 0; z-index: 2; background: white"
            >Presentation</span>
          </div>
          <div id="expanded-options" role="listbox">
            <div role="option">Choice</div>
          </div>
        </main>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Expanded picker",
        },
        rationale:
          "Synthetic expanded-control guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "ERROR"
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-keyboard-activated"
          ),
        null
      );
      assert.equal(
        await page
          .getByRole("combobox")
          .getAttribute(
            "aria-expanded"
          ),
        "true"
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "consequence-labelled combobox does not gain activation authority",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <input
          aria-label="Save"
          role="combobox"
          type="search"
          aria-haspopup="listbox"
          aria-controls="save-options"
          aria-expanded="false"
          onkeydown="document.body.dataset.activated = 'true'"
          onclick="document.body.dataset.activated = 'true'"
        />
        <div id="save-options" role="listbox" hidden></div>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "Save",
        },
        rationale:
          "Synthetic consequence guard.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "MUTATION_RISK"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );
      assert.equal(
        await page
          .locator("body")
          .getAttribute(
            "data-activated"
          ),
        null
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "activation-input semantic re-resolution fails safe for duplicate live candidates",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <main>
          <input
            id="picker-a"
            role="combobox"
            type="search"
            aria-haspopup="listbox"
            aria-controls="options-a"
            aria-expanded="false"
          />
          <input
            id="picker-b"
            role="combobox"
            type="search"
            aria-haspopup="listbox"
            aria-controls="options-b"
            aria-expanded="false"
          />
        </main>
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target: "picker-a",
        },
        rationale:
          "Open the observed input.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );
      assert.equal(
        result.executed,
        false
      );
      assert.match(
        result.note,
        /2 live inputs matched/
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "activation-input semantic re-resolution fails safe when the observed target disappears",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <input
          id="transient-picker"
          role="combobox"
          type="search"
          aria-haspopup="listbox"
          aria-expanded="false"
        />
      `);

      const proposal = {
        decision:
          "PROPOSE_ACTION" as const,
        action: {
          kind: "click" as const,
          target:
            "transient-picker",
        },
        rationale:
          "Open the observed input.",
        confidence: "high" as const,
      };
      const evaluation =
        evaluateBrowserShadowProposal({
          proposal,
          observation:
            await observeBrowserPage(
              page
            ),
        });

      assert.equal(
        evaluation.status,
        "SAFE_TO_EXECUTE"
      );

      await page
        .locator("#transient-picker")
        .evaluate((element) =>
          element.remove()
        );

      const result =
        await executeBrowserReadOnlyProposal({
          page,
          proposal,
          evaluation,
        });

      assert.equal(
        result.status,
        "BLOCKED"
      );
      assert.equal(
        result.executed,
        false
      );
      assert.match(
        result.note,
        /0 exact inputs were visible/
      );
    } finally {
      await browser.close();
    }
  }
);
