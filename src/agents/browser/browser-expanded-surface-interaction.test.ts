import assert from "node:assert/strict";
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
  openReadOnlyExpandedSurface,
} from "./browser-expanded-surface-interaction.js";
import {
  runGenericBrowserSteps,
} from "./browser-step-executor.js";

let browser: Browser;

before(async () => {
  browser = await chromium.launch({
    headless: true,
  });
});

after(async () => {
  await browser.close();
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

test(
  "verifies a newly opened role=dialog independently from trigger execution",
  async () => {
    await withPage(
      `
        <button onclick="document.querySelector('#details').hidden = false">View details</button>
        <section id="details" role="dialog" aria-modal="true" style="min-height: 80px" hidden>
          <h2>Record details</h2>
        </section>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "View details",
            }
          );

        assert.equal(result.ok, true);
        assert.equal(
          result.interactionSucceeded,
          true
        );
        assert.equal(
          result.expandedSurfaceVerified,
          true
        );
        assert.equal(
          result.surface?.source,
          "role-dialog"
        );
        assert.equal(
          result.surface?.name,
          "Record details"
        );
      }
    );
  }
);

test(
  "does not infer expanded success when a trigger clicks but no surface appears",
  async () => {
    await withPage(
      `<button onclick="this.dataset.clicked = 'true'">View details</button>`,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "View details",
            }
          );

        assert.equal(result.ok, false);
        assert.equal(
          result.interactionSucceeded,
          true
        );
        assert.equal(
          result.expandedSurfaceVerified,
          false
        );
        assert.equal(
          await page
            .getByRole("button")
            .getAttribute("data-clicked"),
          "true"
        );
      }
    );
  }
);

test(
  "does not accept a pre-existing unrelated dialog as a post-click transition",
  async () => {
    await withPage(
      `
        <section role="dialog" aria-modal="true" style="min-height: 80px"><h2>Already open</h2></section>
        <button>View details</button>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "View details",
            }
          );

        assert.equal(
          result.interactionSucceeded,
          true
        );
        assert.equal(
          result.expandedSurfaceVerified,
          false
        );
      }
    );
  }
);

test(
  "uses unique nearest context without choosing among equal contextual triggers by DOM order",
  async () => {
    await withPage(
      `
        <section>
          <h2>Language Requirements</h2>
          <button onclick="this.dataset.clicked = 'true'">Configure</button>
          <button onclick="this.dataset.clicked = 'true'">Configure</button>
        </section>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "Configure",
              contextText:
                "Language Requirements",
            }
          );

        assert.equal(
          result.interactionSucceeded,
          false
        );
        assert.match(
          result.note,
          /shared the nearest/
        );
        assert.equal(
          await page.locator(
            "[data-clicked='true']"
          ).count(),
          0
        );
      }
    );
  }
);

test(
  "refuses duplicate exact triggers when no contextual discriminator exists",
  async () => {
    await withPage(
      `
        <button>Preview</button>
        <button>Preview</button>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "Preview",
            }
          );

        assert.equal(result.ok, false);
        assert.match(
          result.note,
          /ambiguous; no DOM-order fallback/
        );
      }
    );
  }
);

test(
  "blocks a consequence-bearing trigger before interaction",
  async () => {
    await withPage(
      `
        <button onclick="this.dataset.clicked = 'true'">Save</button>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "Save",
            }
          );

        assert.equal(
          result.interactionSucceeded,
          false
        );
        assert.match(
          result.note,
          /consequence-bearing/
        );
        assert.equal(
          await page
            .getByRole("button")
            .getAttribute("data-clicked"),
          null
        );
      }
    );
  }
);

test(
  "accepts an exact false-to-true aria-expanded transition",
  async () => {
    await withPage(
      `
        <button aria-expanded="false" onclick="this.setAttribute('aria-expanded', 'true')">Expand details</button>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText:
                "Expand details",
            }
          );

        assert.equal(result.ok, true);
        assert.equal(
          result.surface?.source,
          "aria-expanded"
        );
      }
    );
  }
);

test(
  "selects one of several Configure controls only through unique nearby section context",
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
          <section>
            <h2>Proctoring</h2>
            <button>Configure</button>
          </section>
        </main>
        <div id="language" role="dialog" aria-modal="true" style="min-height: 80px" hidden>
          <h2>Language Requirements</h2>
        </div>
      `,
      async (page) => {
        const result =
          await openReadOnlyExpandedSurface(
            page,
            {
              triggerText: "Configure",
              contextText:
                "Language Requirements",
            }
          );

        assert.equal(result.ok, true);
        assert.equal(
          result.surface?.name,
          "Language Requirements"
        );
      }
    );
  }
);

test(
  "expanded-surface observation does not create PASS when a downstream assertion fails",
  async () => {
    await withPage(
      `
        <button onclick="document.querySelector('#details').hidden = false">View details</button>
        <section id="details" role="dialog" style="min-height: 80px" hidden><h2>Details</h2></section>
      `,
      async (page) => {
        const result =
          await runGenericBrowserSteps(
            page,
            {
              goal:
                "Verify required acceptance content.",
              successCriteria:
                "Required acceptance content is visible.",
              steps: [
                {
                  action: "clickButton",
                  text: "View details",
                  verifyExpandedSurface: true,
                },
                {
                  action:
                    "assertTextVisible",
                  text:
                    "Required acceptance content",
                  oracleId:
                    "oracle-required-content",
                  acceptanceCritical: true,
                },
              ],
            }
          );

        assert.equal(result.status, "FAIL");
        assert.equal(
          result
            .expandedSurfaceObservations?.[0]
            ?.expandedSurfaceVerified,
          true
        );
        assert.equal(
          result.deterministicEvidence?.[0]
            ?.passed,
          false
        );
      }
    );
  }
);

test(
  "expanded-surface observation alone remains MANUAL_REQUIRED rather than becoming acceptance proof",
  async () => {
    await withPage(
      `
        <button onclick="document.querySelector('#details').hidden = false">View details</button>
        <section id="details" role="dialog" style="min-height: 80px" hidden><h2>Details</h2></section>
      `,
      async (page) => {
        const result =
          await runGenericBrowserSteps(
            page,
            {
              goal: "Inspect details.",
              successCriteria:
                "Details are correct.",
              steps: [
                {
                  action: "clickButton",
                  text: "View details",
                  verifyExpandedSurface: true,
                },
              ],
            }
          );

        assert.equal(
          result.status,
          "MANUAL_REQUIRED"
        );
        assert.equal(
          result.deterministicEvidence
            ?.length ?? 0,
          0
        );
      }
    );
  }
);
