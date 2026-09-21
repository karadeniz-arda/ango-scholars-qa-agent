import assert from "node:assert/strict";
import test from "node:test";

import {
  chromium,
} from "playwright";

import {
  buildGenericBrowserAssertionHandoffCase,
} from "./browser-agent-assertion-handoff.js";
import {
  runGenericBrowserSteps,
} from "./browser-step-executor.js";

test(
  "autonomous handoff preserves surface-control assertions and drops interactions",
  () => {
    const handoff =
      buildGenericBrowserAssertionHandoffCase({
        id: "surface-handoff",
        persona: "company_admin",
        goal:
          "Verify semantic menu contents.",
        startRoute: "/",
        successCriteria:
          "The menu exposes the expected choices.",
        steps: [
          {
            action: "clickButton",
            text: "Open",
          },
          {
            action:
              "assertSurfaceControls",
            surfaceKind: "menu",
            controls: [
              {
                kind: "menuitem",
                label: "Newest",
              },
            ],
          },
          {
            action:
              "assertTextVisible",
            text: "Newest",
          },
        ],
      });

    assert.ok(handoff);

    assert.deepEqual(
      handoff.steps.map(
        (step: any) =>
          step.action
      ),
      [
        "assertSurfaceControls",
        "assertTextVisible",
      ]
    );
  }
);

test(
  "executor accepts duplicate page label when exact semantic menu membership is unique",
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
          <button>Newest</button>

          <div
            role="menu"
            aria-label="Sort choices"
          >
            <button role="menuitem">
              Newest
            </button>
            <button role="menuitem">
              Latest
            </button>
            <button role="menuitem">
              Oldest
            </button>
          </div>
        </main>
      `);

      const result =
        await runGenericBrowserSteps(
          page,
          {
            id: "surface-pass",
            persona:
              "company_admin",
            goal:
              "Verify the visible sort choices.",
            successCriteria:
              "The open sort menu exposes Newest, Latest, and Oldest.",
            steps: [
              {
                action:
                  "assertSurfaceControls",
                surfaceKind: "menu",
                controls: [
                  {
                    kind:
                      "menuitem",
                    label:
                      "Newest",
                  },
                  {
                    kind:
                      "menuitem",
                    label:
                      "Latest",
                  },
                  {
                    kind:
                      "menuitem",
                    label:
                      "Oldest",
                  },
                ],
                oracleId:
                  "sort-options",
              },
            ],
          }
        );

      assert.equal(
        result.status,
        "PASS",
        result.notes.join(" | ")
      );

      assert.equal(
        result
          .deterministicEvidence
          ?.length,
        1
      );

      assert.deepEqual(
        result
          .deterministicEvidence
          ?.[0] &&
          {
            action:
              result
                .deterministicEvidence[0]
                .action,
            oracleId:
              result
                .deterministicEvidence[0]
                .oracleId,
            passed:
              result
                .deterministicEvidence[0]
                .passed,
          },
        {
          action:
            "assertSurfaceControls",
          oracleId:
            "sort-options",
          passed: true,
        }
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "executor fails deterministic surface assertion for duplicate exact controls inside the menu",
  async () => {
    const browser =
      await chromium.launch({
        headless: true,
      });

    try {
      const page =
        await browser.newPage();

      await page.setContent(`
        <div
          role="menu"
          aria-label="Sort choices"
        >
          <button role="menuitem">
            Newest
          </button>
          <button role="menuitem">
            Newest
          </button>
        </div>
      `);

      const result =
        await runGenericBrowserSteps(
          page,
          {
            id: "surface-fail",
            persona:
              "company_admin",
            goal:
              "Verify one exact Newest menu item.",
            successCriteria:
              "The menu exposes one exact Newest choice.",
            steps: [
              {
                action:
                  "assertSurfaceControls",
                surfaceKind: "menu",
                controls: [
                  {
                    kind:
                      "menuitem",
                    label:
                      "Newest",
                  },
                ],
              },
            ],
          }
        );

      assert.equal(
        result.status,
        "FAIL"
      );

      const evidence =
        result
          .deterministicEvidence
          ?.[0];

      assert.equal(
        evidence?.action,
        "assertSurfaceControls"
      );

      assert.equal(
        evidence?.passed,
        false
      );

      assert.match(
        String(evidence?.note || ""),
        /ambiguous=menuitem:Newest:2/
      );
    } finally {
      await browser.close();
    }
  }
);
