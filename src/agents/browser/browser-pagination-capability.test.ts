import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { chromium, type Browser, type Page } from "playwright";

import {
  executeGroundedPaginationCapability,
  summarizePaginationCapability,
  toPaginationCapabilityEvaluation,
} from "./browser-pagination-capability.js";
import {
  installProductNonGetGuard,
} from "./browser-local-state-transition-proof.js";

type Behavior =
  | "NORMAL"
  | "NO_CHANGE"
  | "PAGE_ONLY"
  | "UNSETTLED"
  | "NO_PREVIOUS"
  | "RESTORE_MISMATCH"
  | "ROUTE_CHANGE"
  | "NON_GET"
  | "COLLECTION_IDENTITY_CHANGE";

type FixtureOptions = {
  behavior?: Behavior;
  routePath?: string;
  multipleCollections?: boolean;
  multiplePagers?: boolean;
  currentPageUnknown?: boolean;
  nextDisabled?: boolean;
};

let browser: Browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

function tableMarkup(label = "Records", populated = false): string {
  return `
    <table aria-label="${label}">
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody>${populated ? `
        <tr data-row-key="other-a"><td>Other Alpha</td><td>One</td></tr>
        <tr data-row-key="other-b"><td>Other Beta</td><td>Two</td></tr>
      ` : ""}</tbody>
    </table>
  `;
}

async function paginationPage(
  options: FixtureOptions = {}
): Promise<Page> {
  const behavior = options.behavior ?? "NORMAL";
  const routePath = options.routePath ?? "/records";
  const page = await browser.newPage();
  const html = `
    <main>
      ${tableMarkup()}
      ${options.multipleCollections ? tableMarkup("Other records", true) : ""}
      <p id="page-state">${
        options.currentPageUnknown
          ? "Several pages"
          : "1 of 2 • 4 total records"
      }</p>
      <div aria-label="Pagination">
        <button aria-label="Previous page" disabled>Previous</button>
        <button aria-label="Next page" ${options.nextDisabled ? "disabled" : ""}>Next</button>
      </div>
      ${options.multiplePagers ? `
        <div aria-label="Other pagination">
          <button aria-label="Previous page">Previous</button>
          <button aria-label="Next page">Next</button>
        </div>
      ` : ""}
    </main>
    <script>
      const behavior = ${JSON.stringify(behavior)};
      const initiallyDisableNext = ${JSON.stringify(Boolean(options.nextDisabled))};
      const pages = [
        [
          { id: 'a', name: 'Alpha', value: 'One' },
          { id: 'b', name: 'Beta', value: 'Two' },
        ],
        [
          { id: 'c', name: 'Gamma', value: 'Three' },
          { id: 'd', name: 'Delta', value: 'Four' },
        ],
      ];
      let current = 0;
      let ticker;
      const table = document.querySelector('table');
      const tbody = table.querySelector('tbody');
      const pageState = document.getElementById('page-state');
      const previous = document.querySelector('[aria-label="Previous page"]');
      const next = document.querySelector('[aria-label="Next page"]');
      const renderRows = (rows) => {
        tbody.innerHTML = rows.map((row) =>
          '<tr data-row-key="' + row.id + '"><td>' + row.name + '</td><td>' + row.value + '</td></tr>'
        ).join('');
      };
      const render = () => {
        if (behavior !== 'PAGE_ONLY' || current === 0) renderRows(pages[current]);
        if (${JSON.stringify(!options.currentPageUnknown)}) {
          pageState.textContent = (current + 1) + ' of 2 • 4 total records';
        }
        previous.disabled = current === 0 || (behavior === 'NO_PREVIOUS' && current === 1);
        next.disabled = current === 1 || (initiallyDisableNext && current === 0);
      };
      next.addEventListener('click', () => {
        if (behavior === 'NO_CHANGE') return;
        if (behavior === 'NON_GET') {
          fetch('/pagination-attempt', { method: 'POST', body: 'blocked' }).catch(() => {});
        }
        current = 1;
        if (behavior === 'COLLECTION_IDENTITY_CHANGE') {
          table.setAttribute('aria-label', 'Replacement records');
        }
        if (behavior === 'ROUTE_CHANGE') {
          history.pushState({}, '', '/other-surface');
        }
        render();
        if (behavior === 'UNSETTLED') {
          let counter = 0;
          for (const cell of tbody.querySelectorAll('td')) {
            Object.defineProperty(cell, 'innerText', {
              configurable: true,
              get() {
                counter += 1;
                return 'Moving ' + counter;
              },
            });
          }
        }
      });
      previous.addEventListener('click', () => {
        if (behavior === 'NO_PREVIOUS') return;
        clearInterval(ticker);
        current = 0;
        table.setAttribute('aria-label', 'Records');
        history.pushState({}, '', ${JSON.stringify(routePath)});
        render();
        if (behavior === 'RESTORE_MISMATCH') {
          renderRows([
            { id: 'x', name: 'Different', value: 'One' },
            { id: 'y', name: 'Content', value: 'Two' },
          ]);
        }
      });
      renderRows(pages[0]);
      render();
    </script>
  `;
  await page.route("https://pagination.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    });
  });
  await page.goto(`https://pagination.test${routePath}`);
  return page;
}

async function execute(page: Page, maxPolls = 10) {
  const guard = await installProductNonGetGuard(
    page,
    "https://pagination.test"
  );
  try {
    return await executeGroundedPaginationCapability({
      page,
      transportGuard: guard,
      settlement: { maxPolls, pollMs: 20 },
    });
  } finally {
    await guard.stop();
  }
}

test("grounds one collection and pager, changes the same collection, settles, and restores exactly", async () => {
  const page = await paginationPage();
  try {
    const result = await execute(page);
    assert.equal(result.status, "EXECUTED_VERIFIED", JSON.stringify(result));
    assert.equal(result.surface?.associationMethod, "SINGLE_COLLECTION_SINGLE_PAGINATION_GROUP_IN_ACTIVE_SURFACE");
    assert.equal(result.beforeState?.page.currentPage, 1);
    assert.equal(result.afterState?.page.currentPage, 2);
    assert.equal(result.beforeState?.collectionId, result.afterState?.collectionId);
    assert.notEqual(result.beforeState?.collectionFingerprint, result.afterState?.collectionFingerprint);
    assert.equal(result.restoration.restored, true);
    assert.equal(result.restoration.restoredState?.collectionFingerprint, result.beforeState?.collectionFingerprint);
    assert.equal(result.transportSafety.productNonGetAttemptCount, 0);
    assert.equal(page.url(), "https://pagination.test/records");
  } finally {
    await page.close();
  }
});

test("requires an active same-origin product non-GET guard before clicking", async () => {
  const page = await paginationPage();
  try {
    const result = await executeGroundedPaginationCapability({ page });
    assert.equal(result.reason, "TRANSPORT_GUARD_REQUIRED");
    assert.equal(result.executed, false);
  } finally {
    await page.close();
  }
});

test("abstains when multiple grounded collections compete", async () => {
  const page = await paginationPage({ multipleCollections: true });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "COLLECTION_AMBIGUOUS");
    assert.equal(result.executed, false);
  } finally {
    await page.close();
  }
});

test("abstains when multiple pagination control groups compete", async () => {
  const page = await paginationPage({ multiplePagers: true });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "PAGINATION_CONTROL_GROUP_AMBIGUOUS");
    assert.equal(result.executed, false);
  } finally {
    await page.close();
  }
});

test("abstains when explicit current page state is unavailable", async () => {
  const page = await paginationPage({ currentPageUnknown: true });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "CURRENT_PAGE_UNKNOWN");
    assert.equal(result.executed, false);
  } finally {
    await page.close();
  }
});

test("abstains before interaction when Next is disabled", async () => {
  const page = await paginationPage({ nextDisabled: true });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "NEXT_UNAVAILABLE");
    assert.equal(result.executed, false);
  } finally {
    await page.close();
  }
});

test("requires an explicit page-state change", async () => {
  const page = await paginationPage({ behavior: "NO_CHANGE" });
  try {
    const result = await execute(page, 5);
    assert.equal(result.reason, "STATE_DID_NOT_CHANGE");
    assert.equal(result.executed, true);
    assert.equal(result.pageStateChanged, false);
  } finally {
    await page.close();
  }
});

test("does not count a page-label-only transition without collection change", async () => {
  const page = await paginationPage({ behavior: "PAGE_ONLY" });
  try {
    const result = await execute(page, 5);
    assert.equal(result.reason, "COLLECTION_DID_NOT_CHANGE");
    assert.equal(result.pageStateChanged, true);
    assert.equal(result.collectionStateChanged, false);
  } finally {
    await page.close();
  }
});

test("requires two compatible stable changed observations", async () => {
  const page = await paginationPage({ behavior: "UNSETTLED" });
  try {
    const result = await execute(page, 7);
    assert.equal(result.reason, "STATE_DID_NOT_SETTLE");
    assert.equal(result.collectionStateChanged, true);
    assert.equal(result.settled, false);
  } finally {
    await page.close();
  }
});

test("retains the exact grounded collection identity across pagination", async () => {
  const page = await paginationPage({ behavior: "COLLECTION_IDENTITY_CHANGE" });
  try {
    const result = await execute(page, 5);
    assert.equal(result.reason, "COLLECTION_IDENTITY_CHANGED");
    assert.equal(result.status, "ABSTAINED");
  } finally {
    await page.close();
  }
});

test("requires one exact enabled inverse Previous control", async () => {
  const page = await paginationPage({ behavior: "NO_PREVIOUS" });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "INVERSE_UNAVAILABLE");
    assert.equal(result.settled, true);
    assert.equal(result.restoration.restored, false);
  } finally {
    await page.close();
  }
});

test("exact page text alone cannot satisfy restoration when collection content differs", async () => {
  const page = await paginationPage({ behavior: "RESTORE_MISMATCH" });
  try {
    const result = await execute(page, 7);
    assert.equal(result.reason, "RESTORATION_FAILED");
    assert.equal(result.restoration.attempted, true);
    assert.equal(result.restoration.restored, false);
  } finally {
    await page.close();
  }
});

test("abstains when pagination leaves the original route surface", async () => {
  const page = await paginationPage({ behavior: "ROUTE_CHANGE" });
  try {
    const result = await execute(page, 5);
    assert.equal(result.reason, "SURFACE_CHANGED_UNEXPECTEDLY");
  } finally {
    await page.close();
  }
});

test("a product non-GET attempt is blocked and invalidates operational success", async () => {
  const page = await paginationPage({ behavior: "NON_GET" });
  try {
    const result = await execute(page);
    assert.equal(result.reason, "NON_GET_REQUEST_ATTEMPTED");
    assert.equal(result.transportSafety.productNonGetAttemptCount, 1);
    assert.equal(result.transportSafety.safe, false);
  } finally {
    await page.close();
  }
});

test("operational result and shared adapter create no proof or verdict authority", async () => {
  const page = await paginationPage();
  try {
    const result = await execute(page);
    const adapted = toPaginationCapabilityEvaluation(result);
    assert.equal(result.acceptanceProof.attempted, false);
    assert.equal("deterministicEvidence" in result, false);
    assert.equal("caseProofReadiness" in result, false);
    assert.equal(["PASS", "FAIL"].includes(result.status), false);
    assert.equal(adapted.verifiedStateChange, true);
    assert.equal(adapted.restorationRequired, true);
    assert.equal(adapted.restored, true);
    assert.equal(adapted.transportSafe, true);
  } finally {
    await page.close();
  }
});

test("telemetry counts two distinct verified pagination surfaces", async () => {
  const firstPage = await paginationPage({ routePath: "/surface-one" });
  const secondPage = await paginationPage({ routePath: "/surface-two" });
  try {
    const first = await execute(firstPage);
    const second = await execute(secondPage);
    const telemetry = summarizePaginationCapability([first, second]);
    assert.equal(telemetry.capabilityAttemptCount, 2);
    assert.equal(telemetry.capabilityExecutionCount, 2);
    assert.equal(telemetry.verifiedStateChangeCount, 2);
    assert.equal(telemetry.capabilityReuseAcrossDistinctSurfaces, 2);
  } finally {
    await firstPage.close();
    await secondPage.close();
  }
});
