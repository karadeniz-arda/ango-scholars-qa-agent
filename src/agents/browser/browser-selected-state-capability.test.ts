import assert from "node:assert/strict";
import test from "node:test";

import { chromium, type Page } from "playwright";

import {
  executeGroundedSelectedStateCapability,
  summarizeSelectedStateCapability,
  toSelectedStateCapabilityEvaluation,
} from "./browser-selected-state-capability.js";
import {
  installProductNonGetGuard,
} from "./browser-local-state-transition-proof.js";

type FixtureOptions = {
  body?: string;
  script?: string;
  maxPolls?: number;
};

const ordinaryTabs = `
  <div role="tablist" aria-label="View selector">
    <button role="tab" aria-selected="true" aria-controls="panel-current" onclick="activate(this)">Current</button>
    <button role="tab" aria-selected="false" aria-controls="panel-zulu" onclick="activate(this)">Zulu</button>
    <button role="tab" aria-selected="false" aria-controls="panel-alpha" onclick="activate(this)">Alpha</button>
  </div>
  <section id="panel-current" role="tabpanel">Current content</section>
  <section id="panel-zulu" role="tabpanel" hidden>Zulu content</section>
  <section id="panel-alpha" role="tabpanel" hidden>Alpha content</section>
`;

const ordinaryScript = `
  function activate(tab) {
    const group = tab.closest('[role="tablist"]');
    for (const item of group.querySelectorAll('[role="tab"]')) {
      item.setAttribute('aria-selected', String(item === tab));
      document.getElementById(item.getAttribute('aria-controls')).hidden = item !== tab;
    }
    const query = tab.textContent.trim() === 'Current'
      ? ''
      : '?view=' + tab.textContent.trim().toLowerCase();
    history.replaceState({}, '', location.pathname + query);
  }
`;

async function withFixture(
  options: FixtureOptions,
  evaluate: (page: Page) => Promise<void>
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://example.test/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<main>${options.body ?? ordinaryTabs}</main><script>${
          options.script ?? ordinaryScript
        }</script>`,
      });
    });
    await page.goto("https://example.test/surface");
    await evaluate(page);
  } finally {
    await browser.close();
  }
}

async function execute(page: Page, maxPolls = 12) {
  const guard = await installProductNonGetGuard(
    page,
    "https://example.test"
  );
  try {
    return await executeGroundedSelectedStateCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls, pollMs: 20 },
    });
  } finally {
    await guard.stop();
  }
}

test("selects the stable exact alternate, verifies tab and panel state, settles, and restores", async () => {
  await withFixture({}, async (page) => {
    const result = await execute(page);
    assert.equal(
      result.status,
      "EXECUTED_VERIFIED",
      JSON.stringify(result)
    );
    assert.equal(result.reason, "EXECUTED_VERIFIED");
    assert.equal(result.targetSelection?.label, "Alpha");
    assert.equal(result.targetSelection?.selectionStrategy, "STABLE_NORMALIZED_IDENTITY");
    assert.equal(result.selectedStateChanged, true);
    assert.equal(result.associatedStateChanged, true);
    assert.equal(result.settled, true);
    assert.equal(result.restoration.restored, true);
    assert.equal(result.transportSafety.productNonGetAttemptCount, 0);
    assert.equal(result.acceptanceProof.attempted, false);
    assert.equal(page.url(), "https://example.test/surface");
    assert.equal(
      await page.getByRole("tab", { name: "Current", exact: true }).getAttribute("aria-selected"),
      "true"
    );
  });
});

test("requires an active same-origin non-GET guard before clicking", async () => {
  await withFixture({}, async (page) => {
    const result = await executeGroundedSelectedStateCapability({ page });
    assert.equal(result.reason, "TRANSPORT_GUARD_REQUIRED");
    assert.equal(result.executed, false);
  });
});

test("abstains when multiple semantic tablists compete", async () => {
  await withFixture({
    body: ordinaryTabs + ordinaryTabs.replaceAll("panel-", "other-panel-"),
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.reason, "GROUP_AMBIGUOUS");
    assert.equal(result.executed, false);
  });
});

test("abstains on duplicate exact target identities instead of using DOM order", async () => {
  await withFixture({
    body: `
      <div role="tablist">
        <button role="tab" aria-selected="true" aria-controls="panel-current">Current</button>
        <button role="tab" aria-selected="false" aria-controls="panel-a">Other</button>
        <button role="tab" aria-selected="false" aria-controls="panel-b">Other</button>
      </div>
      <section id="panel-current" role="tabpanel">Current</section>
      <section id="panel-a" role="tabpanel" hidden>A</section>
      <section id="panel-b" role="tabpanel" hidden>B</section>
    `,
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.reason, "CONTROL_AMBIGUOUS");
    assert.equal(result.executed, false);
  });
});

test("abstains when current selected state is unknown", async () => {
  await withFixture({
    body: ordinaryTabs.replace('aria-selected="true"', ""),
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.reason, "CURRENT_STATE_UNKNOWN");
    assert.equal(result.executed, false);
  });
});

test("abstains before clicking when every alternate has consequence risk", async () => {
  await withFixture({
    body: `
      <div role="tablist">
        <button role="tab" aria-selected="true" aria-controls="panel-current">Current</button>
        <button role="tab" aria-selected="false" aria-controls="panel-save">Save</button>
      </div>
      <section id="panel-current" role="tabpanel">Current</section>
      <section id="panel-save" role="tabpanel" hidden>Save</section>
    `,
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.reason, "UNSAFE_CONSEQUENCE");
    assert.equal(result.executed, false);
  });
});

test("withholds success when selection never changes", async () => {
  await withFixture({ script: "function activate() {}" }, async (page) => {
    const result = await execute(page, 5);
    assert.equal(result.reason, "STATE_DID_NOT_SETTLE");
    assert.equal(result.executed, true);
    assert.equal(result.selectedStateChanged, false);
  });
});

test("withholds success when selected state changes without its associated panel", async () => {
  await withFixture({
    script: `
      function activate(tab) {
        for (const item of tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')) {
          item.setAttribute('aria-selected', String(item === tab));
        }
      }
    `,
  }, async (page) => {
    const result = await execute(page, 5);
    assert.equal(result.reason, "STATE_DID_NOT_SETTLE");
    assert.equal(result.executed, true);
  });
});

test("requires stable associated state rather than accepting a moving panel", async () => {
  await withFixture({
    script: `${ordinaryScript}
      const originalActivate = activate;
      activate = function(tab) {
        originalActivate(tab);
        if (tab.textContent.trim() === 'Alpha') {
          const panel = document.getElementById('panel-alpha');
          window.moving = setInterval(() => panel.textContent = String(Date.now()), 5);
        } else {
          clearInterval(window.moving);
        }
      };
    `,
  }, async (page) => {
    const result = await execute(page, 6);
    assert.equal(result.reason, "STATE_DID_NOT_SETTLE");
    assert.equal(result.executed, true);
    assert.equal(result.settled, false);
  });
});

test("restoration failure prevents operational success", async () => {
  await withFixture({
    script: `${ordinaryScript}
      const originalActivate = activate;
      activate = function(tab) {
        if (tab.textContent.trim() === 'Current' && location.search) return;
        originalActivate(tab);
      };
    `,
  }, async (page) => {
    const result = await execute(page, 6);
    assert.equal(result.reason, "RESTORATION_FAILED");
    assert.equal(result.selectedStateChanged, true);
    assert.equal(result.restoration.restored, false);
  });
});

test("semantic restoration allows canonical query and stable reloaded panel content", async () => {
  await withFixture({
    script: `${ordinaryScript}
      const originalActivate = activate;
      activate = function(tab) {
        originalActivate(tab);
        if (tab.textContent.trim() === 'Current') {
          document.getElementById('panel-current').textContent = 'Current content reloaded';
          history.replaceState({}, '', location.pathname + '?view=current');
        }
      };
    `,
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.status, "EXECUTED_VERIFIED");
    assert.equal(result.restoration.restored, true);
    assert.equal(page.url(), "https://example.test/surface?view=current");
  });
});

test("does not treat semantic options as tab state or create proof and verdict fields", async () => {
  await withFixture({
    body: `
      <div role="listbox">
        <button role="option" aria-selected="true">Current</button>
        <button role="option" aria-selected="false">Publish</button>
      </div>
    `,
  }, async (page) => {
    const result = await execute(page);
    assert.equal(result.reason, "GROUP_NOT_GROUNDED");
    assert.equal(result.acceptanceProof.attempted, false);
    assert.equal("deterministicEvidence" in result, false);
    assert.equal("caseProofReadiness" in result, false);
    assert.equal(["PASS", "FAIL"].includes(result.status), false);
  });
});

test("telemetry counts only distinct verified operational surfaces", async () => {
  await withFixture({}, async (page) => {
    const first = await execute(page);
    const second = await execute(page);
    const telemetry = summarizeSelectedStateCapability([first, second]);
    assert.equal(telemetry.capabilityAttemptCount, 2);
    assert.equal(telemetry.capabilityExecutionCount, 2);
    assert.equal(telemetry.verifiedStateChangeCount, 2);
    assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 1);
    const adapted = toSelectedStateCapabilityEvaluation(first);
    assert.equal(adapted.verifiedStateChange, true);
    assert.equal(adapted.restorationRequired, true);
    assert.equal(adapted.transportSafe, true);
    assert.equal(adapted.acceptanceProof.attempted, false);
  });
});
