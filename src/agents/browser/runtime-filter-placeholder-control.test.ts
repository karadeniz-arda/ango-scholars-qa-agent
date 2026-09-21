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
  findRuntimeFilterControlByPlaceholder,
} from "./runtime-filter-placeholder-control.js";

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
  "resolves a selected-value custom control through an explicit label association",
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
        const candidate =
          await findRuntimeFilterControlByPlaceholder(
            page,
            [
              "select language",
              "language",
            ]
          );

        assert.ok(candidate);

        assert.equal(
          await candidate.locator.innerText(),
          "English"
        );

        assert.match(
          candidate.descriptor,
          /label association/
        );
      }
    );
  }
);

test(
  "preserves ordinary placeholder resolution",
  async () => {
    await withPage(
      `
        <main>
          <button
            role="combobox"
            aria-haspopup="listbox"
          >
            <span>Select Project</span>
          </button>
        </main>
      `,
      async (page) => {
        const candidate =
          await findRuntimeFilterControlByPlaceholder(
            page,
            ["project"]
          );

        assert.ok(candidate);
        assert.match(
          candidate.currentText,
          /Select Project/i
        );
      }
    );
  }
);

test(
  "fails safe when the same semantic label resolves multiple controls",
  async () => {
    await withPage(
      `
        <main>
          <label>
            Select Language
            <button
              aria-haspopup="listbox"
            >
              English
            </button>
          </label>

          <label>
            Select Language
            <button
              aria-haspopup="listbox"
            >
              German
            </button>
          </label>
        </main>
      `,
      async (page) => {
        const candidate =
          await findRuntimeFilterControlByPlaceholder(
            page,
            [
              "select language",
              "language",
            ]
          );

        assert.equal(
          candidate,
          null
        );
      }
    );
  }
);

test(
  "does not promote arbitrary nearby text into a semantic label association",
  async () => {
    await withPage(
      `
        <main>
          <section>
            <p>Select Language</p>

            <button
              aria-haspopup="listbox"
            >
              English
            </button>
          </section>
        </main>
      `,
      async (page) => {
        const candidate =
          await findRuntimeFilterControlByPlaceholder(
            page,
            [
              "select language",
              "language",
            ]
          );

        /*
         * The existing resolver may still return visible
         * placeholder-like text through its legacy fallback.
         *
         * What this regression test protects is the new
         * semantic-label path: nearby text must not be
         * misclassified as an actual label association to
         * the adjacent control.
         */
        assert.ok(candidate);

        assert.doesNotMatch(
          candidate.descriptor,
          /label association/i
        );

        const tagName =
          await candidate.locator.evaluate(
            (element) =>
              element.tagName.toLowerCase()
          );

        assert.equal(
          tagName,
          "p"
        );
      }
    );
  }
);
