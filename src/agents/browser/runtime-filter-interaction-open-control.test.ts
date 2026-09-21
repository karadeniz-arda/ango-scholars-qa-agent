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
  openRuntimeControl,
} from "./runtime-filter-interaction.js";

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
  "opens a selected-value control through its stable semantic label",
  async () => {
    await withPage(
      `
        <main>
          <label for="language-trigger">
            Select Language
          </label>

          <button
            id="language-trigger"
            aria-haspopup="listbox"
            aria-expanded="false"
            onclick="
              this.setAttribute('aria-expanded', 'true');
              document.getElementById('language-listbox').hidden = false;
            "
          >
            English
          </button>

          <div
            id="language-listbox"
            role="listbox"
            hidden
          >
            <div role="option">
              English
            </div>
            <div role="option">
              German
            </div>
          </div>
        </main>
      `,
      async (page) => {
        const result =
          await openRuntimeControl(
            page,
            "Select Language"
          );

        assert.equal(
          result.ok,
          true
        );

        assert.match(
          result.note,
          /opened and verified runtime control/i
        );

        assert.equal(
          await page
            .locator("#language-trigger")
            .getAttribute("aria-expanded"),
          "true"
        );

        await assert.doesNotReject(
          async () =>
            await page
              .getByRole("listbox")
              .waitFor({
                state: "visible",
              })
        );
      }
    );
  }
);

test(
  "does not report success when a resolved control clicks but does not open",
  async () => {
    await withPage(
      `
        <main>
          <label for="language-trigger">
            Select Language
          </label>

          <button
            id="language-trigger"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            English
          </button>
        </main>
      `,
      async (page) => {
        const result =
          await openRuntimeControl(
            page,
            "Select Language"
          );

        assert.equal(
          result.ok,
          false
        );

        assert.match(
          result.note,
          /no expanded state.*verified/i
        );
      }
    );
  }
);
