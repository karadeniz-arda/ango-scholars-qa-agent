import assert from "node:assert/strict";
import test from "node:test";

import {
  chromium,
} from "playwright";

import {
  observeBrowserPage,
} from "./browser-observation.js";
import {
  assertSurfaceControlsInObservation,
} from "./browser-surface-control-assertion.js";

test(
  "scopes an exact menuitem set to the unique menu surface",
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

      const observation =
        await observeBrowserPage(
          page
        );

      const outsideButton =
        observation.controls.find(
          (control) =>
            control.kind ===
              "button" &&
            control.label ===
              "Newest"
        );

      const insideMenuitem =
        observation.controls.find(
          (control) =>
            control.kind ===
              "menuitem" &&
            control.label ===
              "Newest"
        );

      assert.equal(
        outsideButton
          ?.surfaceKind,
        undefined
      );

      assert.equal(
        insideMenuitem
          ?.surfaceKind,
        "menu"
      );

      const result =
        assertSurfaceControlsInObservation({
          observation,
          surfaceKind: "menu",
          controls: [
            {
              kind: "menuitem",
              label: "Newest",
            },
            {
              kind: "menuitem",
              label: "Latest",
            },
            {
              kind: "menuitem",
              label: "Oldest",
            },
          ],
        });

      assert.equal(
        result.passed,
        true,
        result.note
      );

      assert.equal(
        result.resolvedCount,
        3
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "fails safe for duplicate exact controls inside the same menu",
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
          aria-label="Menu"
        >
          <button role="menuitem">
            Newest
          </button>
          <button role="menuitem">
            Newest
          </button>
        </div>
      `);

      const observation =
        await observeBrowserPage(
          page
        );

      const result =
        assertSurfaceControlsInObservation({
          observation,
          surfaceKind: "menu",
          controls: [
            {
              kind: "menuitem",
              label: "Newest",
            },
          ],
        });

      assert.equal(
        result.passed,
        false
      );

      assert.deepEqual(
        result.ambiguous,
        ["menuitem:Newest:2"]
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  "fails safe when more than one requested semantic surface is visible",
  () => {
    const result =
      assertSurfaceControlsInObservation({
        observation: {
          url: "https://example.test/",
          title: "",
          headings: [],
          controls: [
            {
              kind: "menuitem",
              label: "One",
              role: "menuitem",
              surfaceKind: "menu",
              disabled: false,
              selected: null,
              expanded: null,
              checked: null,
            },
          ],
          inputs: [],
          surfaces: [
            {
              kind: "menu",
              label: "First",
              role: "menu",
              modal: false,
              textPreview: "One",
            },
            {
              kind: "menu",
              label: "Second",
              role: "menu",
              modal: false,
              textPreview: "Two",
            },
          ],
          visibleText: [],
          counts: {
            headings: 0,
            controls: 1,
            inputs: 0,
            surfaces: 2,
            visibleText: 0,
          },
        },
        surfaceKind: "menu",
        controls: [
          {
            kind: "menuitem",
            label: "One",
          },
        ],
      });

    assert.equal(
      result.passed,
      false
    );

    assert.equal(
      result.surfaceCount,
      2
    );
  }
);

test(
  "does not accept the right label with the wrong semantic control kind",
  () => {
    const result =
      assertSurfaceControlsInObservation({
        observation: {
          url: "https://example.test/",
          title: "",
          headings: [],
          controls: [
            {
              kind: "button",
              label: "Newest",
              role: "button",
              surfaceKind: "menu",
              disabled: false,
              selected: null,
              expanded: null,
              checked: null,
            },
          ],
          inputs: [],
          surfaces: [
            {
              kind: "menu",
              label: "Sort",
              role: "menu",
              modal: false,
              textPreview: "Newest",
            },
          ],
          visibleText: [],
          counts: {
            headings: 0,
            controls: 1,
            inputs: 0,
            surfaces: 1,
            visibleText: 0,
          },
        },
        surfaceKind: "menu",
        controls: [
          {
            kind: "menuitem",
            label: "Newest",
          },
        ],
      });

    assert.equal(
      result.passed,
      false
    );

    assert.deepEqual(
      result.missing,
      ["menuitem:Newest"]
    );
  }
);
