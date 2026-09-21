import assert from "node:assert/strict";
import test from "node:test";

import {
  chromium,
} from "playwright";

import {
  isBrowserTextVisible,
} from "./browser-text-visibility.js";

test(
  "uses exact rendered-text visibility without conflating hidden or longer labels",
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
          <span>Receptiveness to feedback</span>
          <span style="display: none">Receptive</span>
          <span style="visibility: hidden">Receptive</span>
          <details>
            <span>Receptive</span>
          </details>
          <span aria-hidden="true">ARIA-only Receptive</span>
          <div class="background" style="display: none">
            <span>Receptive</span>
          </div>
          <section class="active">
            <span>Receptive</span>
            <span>Receptive</span>
          </section>
        </main>
      `);

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptiveness to feedback",
          { exact: true }
        ),
        true
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          {
            exact: true,
            scopeSelector: ".active",
          }
        ),
        true
      );

      await page
        .locator(".active")
        .evaluate((element) => {
          (element as HTMLElement)
            .style.display = "none";
        });

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          { exact: true }
        ),
        false
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          {
            exact: true,
            scopeSelector: ".active",
          }
        ),
        false
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "ARIA-only Receptive",
          { exact: true }
        ),
        true,
        "aria-hidden alone does not make a rendered element Playwright-hidden"
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          {
            exact: true,
            scopeSelector: ".background",
          }
        ),
        false
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          {
            exact: true,
            scopeSelector: ".missing",
          }
        ),
        false
      );

      assert.equal(
        await isBrowserTextVisible(
          page,
          "Receptive",
          { exact: true }
        ),
        false,
        "a longer visible word must not satisfy an exact label assertion"
      );
    } finally {
      await browser.close();
    }
  }
);
