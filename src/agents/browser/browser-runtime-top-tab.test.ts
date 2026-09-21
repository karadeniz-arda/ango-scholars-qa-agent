import assert from "node:assert/strict";
import test from "node:test";

import {
  chromium,
} from "playwright";

import {
  selectRuntimeTopTab,
} from "./browser-control-interaction.js";

test(
  "selectRuntimeTopTab deterministically selects and semantically verifies one of several safe inactive tabs",
  async () => {
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage();

      await page.route(
        "https://example.test/**",
        async (route) => {
          await route.fulfill({
            contentType: "text/html",
            body: `
        <main>
          <div role="tablist">
            <button role="tab" aria-selected="true">Draft</button>
            <button role="tab" aria-selected="false" onclick="selectTab(this)">Sent for processing</button>
            <button role="tab" aria-selected="false" onclick="selectTab(this)">Paid</button>
            <button role="tab" aria-selected="false" onclick="selectTab(this)">Cancelled</button>
          </div>
        </main>
        <script>
          function selectTab(tab) {
            for (const item of document.querySelectorAll('[role="tab"]')) {
              item.setAttribute('aria-selected', 'false');
            }
            tab.setAttribute('aria-selected', 'true');
            history.pushState({}, '', '?tab=' + tab.textContent.toLowerCase().replaceAll(' ', '-'));
          }
        </script>
      `,
          });
        }
      );
      await page.goto(
        "https://example.test/payments"
      );

      const result =
        await selectRuntimeTopTab(page);
      const state = await page.evaluate(() => ({
        url: window.location.href,
        tabs: Array.from(
          document.querySelectorAll(
            '[role="tab"]'
          )
        ).map((item) => ({
          text: item.textContent,
          selected:
            item.getAttribute(
              "aria-selected"
            ),
        })),
      }));

      assert.equal(
        result.ok,
        true,
        `${result.note}; state=${JSON.stringify(state)}`
      );
      assert.deepEqual(
        result.runtimeTopTabObservation,
        {
          action: "selectRuntimeTopTab",
          candidateLabels: [
            "Sent for processing",
            "Paid",
            "Cancelled",
          ],
          selectionStrategy:
            "stable-accessible-label",
          targetTabLabel: "Cancelled",
          interactionSucceeded: true,
          observedActiveTabLabel:
            "Cancelled",
          activeStateVerified: true,
          activeStateSource:
            "aria-selected",
          urlChanged: true,
        }
      );

      assert.equal(
        await page
          .getByRole("tab", {
            name: "Cancelled",
          })
          .getAttribute("aria-selected"),
        "true"
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "selectRuntimeTopTab refuses duplicate accessible labels instead of using DOM order",
  async () => {
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage();

      await page.route(
        "https://example.test/**",
        async (route) => {
          await route.fulfill({
            contentType: "text/html",
            body: `
        <main>
          <div role="tablist">
            <button role="tab" aria-selected="true">Draft</button>
            <button role="tab" aria-selected="false">Paid</button>
            <button role="tab" aria-selected="false">Paid</button>
          </div>
        </main>
      `,
          });
        }
      );
      await page.goto(
        "https://example.test/payments"
      );

      const result =
        await selectRuntimeTopTab(page);

      assert.equal(result.ok, false);
      assert.match(
        result.note,
        /duplicate accessible tab labels: paid/
      );
      assert.equal(
        result.runtimeTopTabObservation,
        undefined
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "selectRuntimeTopTab keeps URL-only success distinct from semantic active-state verification",
  async () => {
    const browser = await chromium.launch({
      headless: true,
    });

    try {
      const page = await browser.newPage();

      await page.route(
        "https://example.test/**",
        async (route) => {
          await route.fulfill({
            contentType: "text/html",
            body: `
        <main>
          <div role="tablist">
            <button role="tab" aria-selected="true">Draft</button>
            <button role="tab" onclick="history.pushState({}, '', '?tab=paid')">Paid</button>
          </div>
        </main>
      `,
          });
        }
      );
      await page.goto(
        "https://example.test/payments"
      );

      const result =
        await selectRuntimeTopTab(page);
      const state = await page.evaluate(() => ({
        url: window.location.href,
        tabs: Array.from(
          document.querySelectorAll(
            '[role="tab"]'
          )
        ).map((item) => ({
          text: item.textContent,
          selected:
            item.getAttribute(
              "aria-selected"
            ),
        })),
      }));

      assert.equal(
        result.ok,
        true,
        `${result.note}; state=${JSON.stringify(state)}`
      );
      assert.equal(
        result.runtimeTopTabObservation
          ?.interactionSucceeded,
        true
      );
      assert.equal(
        result.runtimeTopTabObservation
          ?.activeStateVerified,
        false
      );
      assert.equal(
        result.runtimeTopTabObservation
          ?.observedActiveTabLabel,
        null
      );
      assert.equal(
        result.runtimeTopTabObservation
          ?.urlChanged,
        true
      );
    } finally {
      await browser.close();
    }
  }
);
