import type { Locator, Page } from "playwright";

export type GenericActionResult = {
  ok: boolean;
  note: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textRegex(text: string): RegExp {
  return new RegExp(escapeRegExp(text.trim()).replaceAll("\\ ", "\\s+"), "i");
}

function buttonTextCandidates(text: string): string[] {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();

  const candidates = new Set<string>([normalized]);

  if (lower === "add") {
    candidates.add("Add");
    candidates.add("Add new");
    candidates.add("Create");
    candidates.add("Create new");
    candidates.add("New");
    candidates.add("+");
  }

  if (lower === "create") {
    candidates.add("Create");
    candidates.add("Add");
    candidates.add("New");
  }

  if (lower === "view") {
    candidates.add("View");
    candidates.add("Details");
    candidates.add("Open");
  }

  if (lower === "details") {
    candidates.add("Details");
    candidates.add("View");
    candidates.add("Open");
  }

  return [...candidates];
}

async function clickFirstVisible(locator: Locator, label: string): Promise<GenericActionResult> {
  const count = await locator.count().catch(() => 0);

  for (let index = 0; index < Math.min(count, 5); index += 1) {
    const item = locator.nth(index);

    const visible = await item.isVisible().catch(() => false);
    if (!visible) continue;

    try {
      await item.scrollIntoViewIfNeeded({ timeout: 1000 });
      await item.click({ timeout: 1500 });
      return {
        ok: true,
        note: `clicked ${label}`,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    note: `${label} not visible or not safely clickable`,
  };
}

export async function clickSmartButton(
  page: Page,
  text: string
): Promise<GenericActionResult> {
  const candidates = buttonTextCandidates(text);

  for (const candidate of candidates) {
    const regex = textRegex(candidate);

    const byButton = await clickFirstVisible(
      page.getByRole("button", { name: regex }),
      `button "${candidate}"`
    );

    if (byButton.ok) return byButton;

    const byLink = await clickFirstVisible(
      page.getByRole("link", { name: regex }),
      `link "${candidate}"`
    );

    if (byLink.ok) return byLink;

    const byAria = await clickFirstVisible(
      page.locator(`[aria-label*="${candidate}" i]`),
      `aria-label "${candidate}"`
    );

    if (byAria.ok) return byAria;
  }

  return {
    ok: false,
    note: `button "${text}" not visible or not safely clickable`,
  };
}

export async function clickSmartText(
  page: Page,
  text: string,
  options?: {
    allowGlobalNavigationFallback?: boolean;
  }
): Promise<GenericActionResult> {
  const regex = textRegex(text);

  const main = page
    .locator('main, [role="main"]')
    .first();

  /*
   * Prefer controls rendered inside the current content
   * surface before considering global navigation controls.
   * This prevents a wizard step label from resolving to a
   * same-named sidebar link.
   */
  const contentLocators = [
    main.getByRole("tab", { name: regex }),
    main.getByRole("button", { name: regex }),
    main.getByRole("link", { name: regex }),
    main.getByRole("menuitem", { name: regex }),
    main.getByText(regex),
  ];

  for (const locator of contentLocators) {
    const result = await clickFirstVisible(
      locator,
      `content text "${text}"`
    );

    if (result.ok) return result;
  }

  /*
   * JOB_WIZARD_CONTENT_SCOPE_V1
   *
   * Same-named sidebar navigation must not be used
   * when the caller requires a control inside the
   * current wizard/content surface.
   */
  if (
    options?.allowGlobalNavigationFallback ===
    false
  ) {
    return {
      ok: false,
      note:
        `could not click text "${text}" ` +
        `inside the current content surface`,
    };
  }

  const globalLocators = [
    page.getByRole("tab", { name: regex }),
    page.getByRole("button", { name: regex }),
    page.getByRole("link", { name: regex }),
    page.getByRole("menuitem", { name: regex }),
    page.getByText(regex),
  ];

  for (const locator of globalLocators) {
    const result = await clickFirstVisible(
      locator,
      `global text "${text}"`
    );

    if (result.ok) return result;
  }

  return {
    ok: false,
    note: `could not click text "${text}"`,
  };
}

export async function openLikelyPanelOrItem(page: Page): Promise<GenericActionResult> {
  const candidateLocators = [
    page.getByRole("button", { name: /details|view|open|review/i }),
    page.getByRole("link", { name: /details|view|open|review/i }),
    page.locator("main [role='row']").nth(1),
    page.locator("main [role='button']").first(),
    page.locator("main article").first(),
    page.locator("main li").first(),
    page.locator("main tr").nth(1),
    page.locator("main .card").first(),
  ];

  for (const locator of candidateLocators) {
    const result = await clickFirstVisible(locator, "likely panel/item trigger");
    if (result.ok) return result;
  }

  return {
    ok: false,
    note: "could not open likely panel/item trigger",
  };
}

function normalizeRowDetailValue(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getRequestedRowTokens(
  requestedText: string
): string[] {
  const ignoredTokens = new Set([
    "a",
    "an",
    "the",
    "change",
    "changes",
    "request",
    "requests",
    "row",
    "record",
    "open",
    "view",
    "details",
    "detail",
    "review",
  ]);

  return normalizeRowDetailValue(
    requestedText
  )
    .split(/[^a-z0-9]+/i)
    .filter(
      (token) =>
        token.length >= 3 &&
        !ignoredTokens.has(token)
    );
}

async function captureVisibleDetailSurfaces(
  page: Page
): Promise<string[]> {
  return page
    .evaluate(() => {
      const selector = [
        '[role="dialog"]',
        '[data-radix-dialog-content]',
        '[data-state="open"]',
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
        '[class*="modal"]',
        '[class*="Modal"]',
      ].join(", ");

      return Array.from(
        document.querySelectorAll<HTMLElement>(
          selector
        )
      )
        .filter((element) => {
          const style =
            window.getComputedStyle(element);

          const rect =
            element.getBoundingClientRect();

          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width >= 40 &&
            rect.height >= 40 &&
            rect.bottom > 0 &&
            rect.right > 0
          );
        })
        .map((element) => {
          const rect =
            element.getBoundingClientRect();

          const text = String(
            element.innerText ||
              element.textContent ||
              ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);

          return [
            element.tagName,
            element.getAttribute("role") ||
              "no-role",
            element.getAttribute(
              "data-state"
            ) || "no-state",
            Math.round(rect.left),
            Math.round(rect.top),
            Math.round(rect.width),
            Math.round(rect.height),
            text,
          ].join("|");
        });
    })
    .catch(() => []);
}

async function countVisibleExpectedTexts(
  page: Page,
  expectedTexts: string[]
): Promise<number> {
  let visibleCount = 0;

  for (
    const expectedText of
      expectedTexts.slice(0, 20)
  ) {
    const matches = page.getByText(
      textRegex(expectedText)
    );

    const count = Math.min(
      await matches.count().catch(() => 0),
      20
    );

    let found = false;

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const visible = await matches
        .nth(index)
        .isVisible()
        .catch(() => false);

      if (visible) {
        found = true;
        break;
      }
    }

    if (found) {
      visibleCount += 1;
    }
  }

  return visibleCount;
}

async function findSingleSafeActionCellControl(
  row: Locator
): Promise<{
  control: Locator;
  descriptor: string;
} | null> {
  const table = row.locator(
    'xpath=ancestor::*[' +
      'self::table or ' +
      '@role="table" or ' +
      '@role="grid"' +
    '][1]'
  );

  const headerTexts = await table
    .locator(
      'thead th, [role="columnheader"]'
    )
    .allInnerTexts()
    .catch(() => []);

  const cells = row.locator(
    'td, [role="cell"], [role="gridcell"]'
  );

  const cellCount = Math.min(
    await cells.count().catch(() => 0),
    30
  );

  for (
    let cellIndex = 0;
    cellIndex < cellCount;
    cellIndex += 1
  ) {
    const cell = cells.nth(cellIndex);

    const cellMetadata = await cell
      .evaluate(
        (
          element,
          correspondingHeader
        ) => {
          if (
            !(element instanceof HTMLElement)
          ) {
            return "";
          }

          return [
            correspondingHeader,
            element.getAttribute(
              "data-label"
            ),
            element.getAttribute(
              "aria-label"
            ),
            element.getAttribute(
              "headers"
            ),
            element.getAttribute(
              "class"
            ),
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        },
        headerTexts[cellIndex] || ""
      )
      .catch(() => "");

    if (
      !/\bactions?\b/i.test(
        cellMetadata
      )
    ) {
      continue;
    }

    const semanticControls = cell.locator(
      [
        "button",
        "a",
        '[role="button"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(", ")
    );

    const visibleSemanticControls:
      Locator[] = [];

    const semanticCount = Math.min(
      await semanticControls
        .count()
        .catch(() => 0),
      12
    );

    for (
      let index = 0;
      index < semanticCount;
      index += 1
    ) {
      const control =
        semanticControls.nth(index);

      const usable = await control
        .evaluate((element) => {
          if (
            !(element instanceof HTMLElement)
          ) {
            return false;
          }

          const style =
            window.getComputedStyle(element);

          const rect =
            element.getBoundingClientRect();

          const disabled =
            element.hasAttribute(
              "disabled"
            ) ||
            element.getAttribute(
              "aria-disabled"
            ) === "true" ||
            (
              element instanceof
                HTMLButtonElement &&
              element.disabled
            );

          return (
            !disabled &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width >= 8 &&
            rect.height >= 8
          );
        })
        .catch(() => false);

      if (usable) {
        visibleSemanticControls.push(
          control
        );
      }
    }

    let controls =
      visibleSemanticControls;

    /*
     * Some action cells render an SVG/image with a
     * click handler and expose no semantic button.
     * Only consider that fallback when there is
     * exactly one visible icon in the Actions cell.
     */
    if (controls.length === 0) {
      const icons = cell.locator(
        "svg, img"
      );

      const visibleIcons: Locator[] = [];

      const iconCount = Math.min(
        await icons.count().catch(() => 0),
        8
      );

      for (
        let index = 0;
        index < iconCount;
        index += 1
      ) {
        const icon = icons.nth(index);

        const visible = await icon
          .isVisible()
          .catch(() => false);

        if (visible) {
          visibleIcons.push(icon);
        }
      }

      controls = visibleIcons;
    }

    if (controls.length !== 1) {
      continue;
    }

    const control = controls[0]!;

    const descriptor = await control
      .evaluate((element) => {
        const normalize = (
          value: unknown
        ) =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        return normalize(
          [
            element.tagName,
            element.textContent,
            element.getAttribute(
              "aria-label"
            ),
            element.getAttribute(
              "title"
            ),
            element.getAttribute(
              "alt"
            ),
            element.getAttribute(
              "src"
            ),
            element.getAttribute(
              "data-testid"
            ),
            element.getAttribute(
              "data-icon"
            ),
            element.getAttribute(
              "data-lucide"
            ),
            element.getAttribute(
              "class"
            ),
            element.outerHTML.slice(
              0,
              600
            ),
          ]
            .filter(Boolean)
            .join(" ")
        );
      })
      .catch(() => "");

    const unsafe =
      /\b(apply|approve|reject|delete|remove|publish|submit|send|invite|archive|create|save)\b/i
        .test(descriptor);

    if (unsafe) {
      continue;
    }

    return {
      control,
      descriptor:
        descriptor ||
        "single safe control in Actions column",
    };
  }

  return null;
}

export async function openMatchingTableRowDetail(
  page: Page,
  requestedText: string,
  expectedDetailTexts: string[] = []
): Promise<GenericActionResult> {
  const requested =
    normalizeRowDetailValue(
      requestedText
    );

  const requestedTokens =
    getRequestedRowTokens(
      requestedText
    );

  if (
    !requested ||
    requestedTokens.length === 0
  ) {
    return {
      ok: false,
      note:
        `table-row detail request ` +
        `"${requestedText}" has no usable ` +
        `semantic record tokens`,
    };
  }

  const rows = page.locator(
    [
      'main [role="row"]',
      "main tr",
    ].join(", ")
  );

  const rowCount = Math.min(
    await rows.count().catch(() => 0),
    40
  );

  type Candidate = {
    rowIndex: number;
    rowText: string;
    control: Locator;
    descriptor: string;
    score: number;
  };

  const candidates: Candidate[] = [];

  const matchedRows: Array<{
    rowIndex: number;
    rowText: string;
    row: Locator;
  }> = [];

  let matchedRowCount = 0;

  for (
    let rowIndex = 0;
    rowIndex < rowCount;
    rowIndex += 1
  ) {
    const row = rows.nth(rowIndex);

    const visible = await row
      .isVisible()
      .catch(() => false);

    if (!visible) {
      continue;
    }

    const rowText = String(
      await row
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();

    const normalizedRowText =
      normalizeRowDetailValue(rowText);

    const rowMatches =
      requestedTokens.every(
        (token) =>
          normalizedRowText.includes(
            token
          )
      );

    if (!rowMatches) {
      continue;
    }

    matchedRowCount += 1;

    matchedRows.push({
      rowIndex,
      rowText,
      row,
    });

    const controls = row.locator(
      [
        "button",
        "a",
        '[role="button"]',
      ].join(", ")
    );

    const controlCount = Math.min(
      await controls
        .count()
        .catch(() => 0),
      16
    );

    for (
      let controlIndex = 0;
      controlIndex < controlCount;
      controlIndex += 1
    ) {
      const control =
        controls.nth(controlIndex);

      const metadata = await control
        .evaluate((element) => {
          if (
            !(element instanceof HTMLElement)
          ) {
            return null;
          }

          const normalize = (
            value: unknown
          ) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

          const style =
            window.getComputedStyle(element);

          const rect =
            element.getBoundingClientRect();

          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width >= 8 &&
            rect.height >= 8 &&
            rect.bottom > 0 &&
            rect.right > 0;

          const disabled =
            element.hasAttribute(
              "disabled"
            ) ||
            element.getAttribute(
              "aria-disabled"
            ) === "true" ||
            (
              element instanceof
                HTMLButtonElement &&
              element.disabled
            );

          const descendantMetadata =
            Array.from(
              element.querySelectorAll<
                HTMLElement
              >(
                [
                  "svg",
                  "[aria-label]",
                  "[title]",
                  "[data-testid]",
                  "[data-icon]",
                  "[data-lucide]",
                ].join(", ")
              )
            )
              .slice(0, 20)
              .map((child) =>
                [
                  child.tagName,
                  child.getAttribute(
                    "aria-label"
                  ),
                  child.getAttribute(
                    "title"
                  ),
                  child.getAttribute(
                    "data-testid"
                  ),
                  child.getAttribute(
                    "data-icon"
                  ),
                  child.getAttribute(
                    "data-lucide"
                  ),
                  child.getAttribute(
                    "class"
                  ),
                ]
                  .filter(Boolean)
                  .join(" ")
              )
              .join(" ");

          const descriptor = normalize(
            [
              element.innerText,
              element.textContent,
              element.getAttribute(
                "aria-label"
              ),
              element.getAttribute(
                "title"
              ),
              element.getAttribute(
                "name"
              ),
              element.getAttribute(
                "data-testid"
              ),
              element.getAttribute(
                "class"
              ),
              descendantMetadata,
            ]
              .filter(Boolean)
              .join(" ")
          );

          return {
            visible,
            disabled,
            descriptor,
          };
        })
        .catch(() => null);

      if (
        !metadata ||
        !metadata.visible ||
        metadata.disabled
      ) {
        continue;
      }

      const unsafeControl =
        /\b(apply|approve|reject|delete|remove|publish|submit|send|invite|archive|create|save)\b/i
          .test(metadata.descriptor);

      if (unsafeControl) {
        continue;
      }

      const explicitDetailSignal =
        /\b(view|details?|open|review|inspect|preview)\b/i
          .test(metadata.descriptor);

      const iconDetailSignal =
        /\b(eye|visibility)\b/i
          .test(metadata.descriptor);

      if (
        !explicitDetailSignal &&
        !iconDetailSignal
      ) {
        continue;
      }

      let score =
        requestedTokens.length * 25;

      if (
        normalizedRowText.includes(
          requested
        )
      ) {
        score += 60;
      }

      if (explicitDetailSignal) {
        score += 100;
      }

      if (iconDetailSignal) {
        score += 90;
      }

      candidates.push({
        rowIndex,
        rowText,
        control,
        descriptor:
          metadata.descriptor,
        score,
      });
    }
  }

  /*
   * Icon-only fallback:
   * the requested row matched semantically, but its
   * Actions control exposed no View/Eye label.
   * Accept only one safe control from the explicit
   * Actions column of that matched row.
   */
  if (
    candidates.length === 0 &&
    matchedRows.length > 0
  ) {
    for (const matchedRow of matchedRows) {
      const fallbackControl =
        await findSingleSafeActionCellControl(
          matchedRow.row
        );

      if (!fallbackControl) {
        continue;
      }

      candidates.push({
        rowIndex:
          matchedRow.rowIndex,
        rowText:
          matchedRow.rowText,
        control:
          fallbackControl.control,
        descriptor:
          fallbackControl.descriptor,
        score: 75,
      });
    }
  }

  if (matchedRowCount === 0) {
    return {
      ok: false,
      note:
        `no visible table row matched ` +
        `requested record state ` +
        `"${requestedText}"`,
    };
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      note:
        `matched ${matchedRowCount} table ` +
        `row(s) for "${requestedText}", ` +
        `but none exposed a safe ` +
        `View/Details/Eye control`,
    };
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.rowIndex - right.rowIndex
  );

  const candidate = candidates[0]!;

  const surfacesBefore =
    await captureVisibleDetailSurfaces(
      page
    );

  const expectedBefore =
    await countVisibleExpectedTexts(
      page,
      expectedDetailTexts
    );

  const urlBefore = page.url();

  try {
    await candidate.control
      .scrollIntoViewIfNeeded({
        timeout: 1500,
      });

    await candidate.control.click({
      timeout: 2500,
    });
  } catch {
    return {
      ok: false,
      note:
        `safe row-detail control was ` +
        `found for "${requestedText}" ` +
        `but could not be clicked`,
    };
  }

  await page.waitForTimeout(900);

  const surfacesAfter =
    await captureVisibleDetailSurfaces(
      page
    );

  const expectedAfter =
    await countVisibleExpectedTexts(
      page,
      expectedDetailTexts
    );

  const newSurface =
    surfacesAfter.some(
      (surface) =>
        !surfacesBefore.includes(surface)
    );

  const urlChanged =
    page.url() !== urlBefore;

  const expectedThreshold =
    Math.min(
      2,
      expectedDetailTexts.length
    );

  const expectedFieldsAppeared =
    expectedThreshold > 0 &&
    expectedAfter >=
      expectedThreshold &&
    expectedAfter > expectedBefore;

  const opened =
    newSurface ||
    urlChanged ||
    expectedFieldsAppeared;

  if (!opened) {
    return {
      ok: false,
      note:
        `clicked safe row-detail control ` +
        `for "${requestedText}", but no ` +
        `new detail surface, URL transition ` +
        `or expected-field increase was ` +
        `verified`,
    };
  }

  const verificationSignals = [
    newSurface
      ? "new-detail-surface"
      : "",
    urlChanged
      ? "url-transition"
      : "",
    expectedFieldsAppeared
      ? `expected-fields=${expectedAfter}`
      : "",
  ]
    .filter(Boolean)
    .join(",");

  return {
    ok: true,
    note:
      `opened and verified matching ` +
      `table-row detail for ` +
      `"${requestedText}" ` +
      `(row="${candidate.rowText.slice(
        0,
        160
      )}", control="${
        candidate.descriptor
          .slice(0, 120)
      }", verification=${
        verificationSignals
      })`,
  };
}

export type ScrollAwareTextVisibilityResult = {
  visible: boolean;
  attempted: boolean;
  scrolled: boolean;
  note: string;
};

export async function findTextInOpenDetailSurface(
  page: Page,
  requestedText: string
): Promise<ScrollAwareTextVisibilityResult> {
  const requested =
    String(requestedText || "")
      .replace(/\s+/g, " ")
      .trim();

  if (!requested) {
    return {
      visible: false,
      attempted: false,
      scrolled: false,
      note:
        "scroll-aware detail assertion skipped: " +
        "requested text is empty",
    };
  }

  const result = await page
    .evaluate(
      async ({ requestedText }) => {
        /*
         * tsx/esbuild may inject __name(...) around
         * nested functions. Playwright serializes only
         * this callback, so expose the helper inside
         * the browser execution context.
         */
        if (
          typeof (globalThis as any).__name !==
          "function"
        ) {
          (globalThis as any).__name =
            Function(
              "target",
              "return target;"
            );
        }

        const normalize = (
          value: unknown
        ): string =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const normalizedRequested =
          normalize(requestedText);

        const surfaceSelector = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          '[data-radix-dialog-content]',
          '[data-state="open"]',
          '[class*="drawer"]',
          '[class*="Drawer"]',
          '[class*="sheet"]',
          '[class*="Sheet"]',
          '[class*="modal"]',
          '[class*="Modal"]',
        ].join(", ");

        const isRendered = (
          element: HTMLElement
        ): boolean => {
          const style =
            window.getComputedStyle(element);

          const rect =
            element.getBoundingClientRect();

          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width >= 2 &&
            rect.height >= 2 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top <
              window.innerHeight &&
            rect.left <
              window.innerWidth
          );
        };

        const intersectionArea = (
          first: DOMRect,
          second: DOMRect
        ): number => {
          const width = Math.max(
            0,
            Math.min(
              first.right,
              second.right
            ) -
              Math.max(
                first.left,
                second.left
              )
          );

          const height = Math.max(
            0,
            Math.min(
              first.bottom,
              second.bottom
            ) -
              Math.max(
                first.top,
                second.top
              )
          );

          return width * height;
        };

        const isVisiblyInsideSurface = (
          element: HTMLElement,
          surface: HTMLElement
        ): boolean => {
          if (!isRendered(element)) {
            return false;
          }

          let clippedRect =
            element.getBoundingClientRect();

          const surfaceRect =
            surface.getBoundingClientRect();

          if (
            intersectionArea(
              clippedRect,
              surfaceRect
            ) < 4
          ) {
            return false;
          }

          let ancestor =
            element.parentElement;

          while (
            ancestor &&
            surface.contains(ancestor)
          ) {
            const style =
              window.getComputedStyle(
                ancestor
              );

            const clipsVertically =
              /auto|scroll|hidden|clip|overlay/i
                .test(style.overflowY);

            const clipsHorizontally =
              /auto|scroll|hidden|clip|overlay/i
                .test(style.overflowX);

            if (
              clipsVertically ||
              clipsHorizontally
            ) {
              const ancestorRect =
                ancestor
                  .getBoundingClientRect();

              const left = Math.max(
                clippedRect.left,
                ancestorRect.left
              );

              const right = Math.min(
                clippedRect.right,
                ancestorRect.right
              );

              const top = Math.max(
                clippedRect.top,
                ancestorRect.top
              );

              const bottom = Math.min(
                clippedRect.bottom,
                ancestorRect.bottom
              );

              if (
                right - left < 2 ||
                bottom - top < 2
              ) {
                return false;
              }

              clippedRect = {
                x: left,
                y: top,
                left,
                top,
                right,
                bottom,
                width: right - left,
                height: bottom - top,
                toJSON: () => ({}),
              } as DOMRect;
            }

            if (ancestor === surface) {
              break;
            }

            ancestor =
              ancestor.parentElement;
          }

          return true;
        };

        const textMatches = (
          candidateText: string
        ): boolean => {
          const normalizedCandidate =
            normalize(candidateText);

          if (
            !normalizedCandidate ||
            !normalizedRequested
          ) {
            return false;
          }

          if (
            normalizedCandidate ===
            normalizedRequested
          ) {
            return true;
          }

          return (
            ` ${normalizedCandidate} `
              .includes(
                ` ${normalizedRequested} `
              )
          );
        };

        const findVisibleMatch = (
          surface: HTMLElement
        ): HTMLElement | null => {
          const elements = [
            ...Array.from(
              surface.querySelectorAll<
                HTMLElement
              >("*")
            ),
          ];

          return (
            elements
              .filter((element) => {
                if (
                  [
                    "SCRIPT",
                    "STYLE",
                    "NOSCRIPT",
                    "SVG",
                    "PATH",
                  ].includes(
                    element.tagName
                  )
                ) {
                  return false;
                }

                const text =
                  String(
                    element.innerText ||
                      element.textContent ||
                      ""
                  )
                    .replace(/\s+/g, " ")
                    .trim();

                if (
                  !textMatches(text)
                ) {
                  return false;
                }

                /*
                 * Avoid accepting the entire modal
                 * merely because its descendant text
                 * contains the requested label.
                 */
                if (
                  normalize(text).length >
                  Math.max(
                    normalizedRequested
                      .length * 8,
                    normalizedRequested
                      .length + 220
                  )
                ) {
                  return false;
                }

                return (
                  isVisiblyInsideSurface(
                    element,
                    surface
                  )
                );
              })
              .sort(
                (left, right) => {
                  const leftText =
                    normalize(
                      left.innerText ||
                        left.textContent
                    );

                  const rightText =
                    normalize(
                      right.innerText ||
                        right.textContent
                    );

                  const leftExact =
                    leftText ===
                    normalizedRequested;

                  const rightExact =
                    rightText ===
                    normalizedRequested;

                  if (
                    leftExact !== rightExact
                  ) {
                    return leftExact
                      ? -1
                      : 1;
                  }

                  return (
                    leftText.length -
                    rightText.length
                  );
                }
              )[0] ?? null
          );
        };

        const describeSurface = (
          surface: HTMLElement
        ): string => {
          const role =
            surface.getAttribute("role");

          const className =
            String(
              surface.className || ""
            )
              .replace(/\s+/g, ".")
              .slice(0, 100);

          return [
            surface.tagName
              .toLowerCase(),
            role
              ? `[role="${role}"]`
              : "",
            className
              ? `.${className}`
              : "",
          ]
            .filter(Boolean)
            .join("");
        };

        const surfaces =
          Array.from(
            document.querySelectorAll<
              HTMLElement
            >(surfaceSelector)
          )
            .filter((surface) => {
              if (!isRendered(surface)) {
                return false;
              }

              const rect =
                surface
                  .getBoundingClientRect();

              return (
                rect.width >= 120 &&
                rect.height >= 120
              );
            })
            .map((surface) => {
              const rect =
                surface
                  .getBoundingClientRect();

              const style =
                window
                  .getComputedStyle(
                    surface
                  );

              const zIndex =
                Number.parseInt(
                  style.zIndex,
                  10
                );

              return {
                surface,
                area:
                  rect.width *
                  rect.height,
                zIndex:
                  Number.isFinite(zIndex)
                    ? zIndex
                    : 0,
              };
            })
            .sort(
              (left, right) =>
                right.zIndex -
                  left.zIndex ||
                right.area -
                  left.area
            );

        if (surfaces.length === 0) {
          return {
            visible: false,
            attempted: false,
            scrolled: false,
            surface: "",
            positionsChecked: 0,
          };
        }

        const waitForRender =
          async (): Promise<void> => {
            await new Promise<void>(
              (resolve) => {
                window
                  .requestAnimationFrame(
                    () => resolve()
                  );
              }
            );

            await new Promise<void>(
              (resolve) => {
                window
                  .requestAnimationFrame(
                    () => resolve()
                  );
              }
            );

            await new Promise<void>(
              (resolve) => {
                window.setTimeout(
                  resolve,
                  45
                );
              }
            );
          };

        let positionsChecked = 0;

        for (
          const surfaceEntry of
            surfaces.slice(0, 4)
        ) {
          const surface =
            surfaceEntry.surface;

          const initialMatch =
            findVisibleMatch(surface);

          if (initialMatch) {
            return {
              visible: true,
              attempted: true,
              scrolled: false,
              surface:
                describeSurface(surface),
              positionsChecked,
            };
          }

          const candidateElements = [
            surface,
            ...Array.from(
              surface.querySelectorAll<
                HTMLElement
              >("*")
            ),
          ];

          const scrollables =
            candidateElements
              .filter((element) => {
                const style =
                  window.getComputedStyle(
                    element
                  );

                const scrollableOverflow =
                  /auto|scroll|overlay/i
                    .test(
                      style.overflowY
                    );

                return (
                  isRendered(element) &&
                  scrollableOverflow &&
                  element.scrollHeight >
                    element.clientHeight +
                      24
                );
              })
              .map((element) => ({
                element,
                originalTop:
                  element.scrollTop,
                range:
                  element.scrollHeight -
                  element.clientHeight,
                area:
                  element.clientWidth *
                  element.clientHeight,
              }))
              .sort(
                (left, right) =>
                  right.range *
                    right.area -
                  left.range *
                    left.area
              )
              .slice(0, 6);

          if (
            scrollables.length === 0
          ) {
            continue;
          }

          const originalPositions =
            scrollables.map(
              ({
                element,
                originalTop,
              }) => ({
                element,
                originalTop,
              })
            );

          for (
            const scrollable of
              scrollables
          ) {
            const viewport =
              Math.max(
                scrollable
                  .element
                  .clientHeight,
                100
              );

            const stepSize =
              Math.max(
                Math.round(
                  viewport * 0.72
                ),
                80
              );

            const positions =
              new Set<number>([
                0,
                Math.round(
                  scrollable.originalTop
                ),
                scrollable.range,
              ]);

            for (
              let position = 0;
              position <=
                scrollable.range;
              position += stepSize
            ) {
              positions.add(
                Math.min(
                  position,
                  scrollable.range
                )
              );

              if (
                positions.size >= 12
              ) {
                break;
              }
            }

            for (
              const position of
                [...positions]
                  .sort(
                    (
                      left,
                      right
                    ) =>
                      left - right
                  )
            ) {
              scrollable
                .element
                .scrollTop =
                position;

              scrollable
                .element
                .dispatchEvent(
                  new Event(
                    "scroll",
                    {
                      bubbles: true,
                    }
                  )
                );

              positionsChecked += 1;

              await waitForRender();

              const match =
                findVisibleMatch(
                  surface
                );

              if (match) {
                match.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });

                await waitForRender();

                return {
                  visible: true,
                  attempted: true,
                  scrolled:
                    position !==
                    scrollable
                      .originalTop,
                  surface:
                    describeSurface(
                      surface
                    ),
                  positionsChecked,
                };
              }
            }
          }

          /*
           * A failed assertion must not leave the
           * UI at a different scroll position.
           */
          for (
            const original of
              originalPositions
          ) {
            original.element.scrollTop =
              original.originalTop;

            original.element
              .dispatchEvent(
                new Event(
                  "scroll",
                  {
                    bubbles: true,
                  }
                )
              );
          }

          await waitForRender();
        }

        return {
          visible: false,
          attempted: true,
          scrolled: false,
          surface:
            surfaces[0]
              ? describeSurface(
                  surfaces[0].surface
                )
              : "",
          positionsChecked,
        };
      },
      {
        requestedText: requested,
      }
    )
    .catch((error: unknown) => ({
      visible: false,
      attempted: true,
      scrolled: false,
      surface: "",
      positionsChecked: 0,
      runtimeError:
        error instanceof Error
          ? error.message
          : String(error),
    }));

  if (!result.attempted) {
    return {
      visible: false,
      attempted: false,
      scrolled: false,
      note:
        `scroll-aware detail assertion ` +
        `was not applicable for ` +
        `"${requested}"`,
    };
  }

  if (!result.visible) {
    const runtimeError =
      "runtimeError" in result
        ? String(result.runtimeError || "")
        : "";

    return {
      visible: false,
      attempted: true,
      scrolled: false,
      note:
        runtimeError
          ? `scroll-aware detail assertion ` +
            `runtime error for "${requested}": ` +
            `${runtimeError}`
          : `scroll-aware detail assertion ` +
            `checked ${result.positionsChecked} ` +
            `position(s) inside ` +
            `${result.surface || "an open detail surface"} ` +
            `but did not find visible text ` +
            `"${requested}"`,
    };
  }

  return {
    visible: true,
    attempted: true,
    scrolled: result.scrolled,
    note:
      `scroll-aware detail assertion found ` +
      `visible text "${requested}" inside ` +
      `${result.surface || "an open detail surface"}` +
      (
        result.scrolled
          ? ` after scanning ` +
            `${result.positionsChecked} ` +
            `position(s)`
          : ` without changing the ` +
            `surface scroll position`
      ),
  };
}
