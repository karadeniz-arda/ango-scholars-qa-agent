import type {
  Locator,
  Page,
} from "playwright";
import {
  evaluateRuntimeInvoiceFixturePreparation,
  requiresRuntimeInvoiceFixturePreparation,
  runtimeFixturePreparationAllowsInteraction,
  type BrowserRuntimeFixturePreparationResult,
  type RuntimeInvoiceFixtureState,
} from "./browser-runtime-fixture-preparation.js";

/*
 * AS1014_NONREACT_EVIDENCE_V1
 *
 * Invoice table view and invoice drawer state are
 * separate concepts. Drawer labels such as
 * "Invoice Approved By" must not silently navigate
 * a Sent for Processing case to the Processed tab.
 */
type DesiredInvoiceState =
  | "any"
  | "approved"
  | "pending"
  | "no-timesheets";

type RequiredInvoiceTableView =
  | "sent-for-processing"
  | "processed"
  | null;

type VisibleInvoiceRow = {
  row: Locator;
  text: string;
  invoiceNumber: string;
};

export type InvoiceInteractionResult = (
  | {
      status: "OPENED";
      note: string;
      selectedInvoice: string;
      requestedInvoice: string | null;
      requiredTableView:
        RequiredInvoiceTableView;
      selectedTableView: string | null;
      exactInvoiceMatched: boolean;
      handoffInvoice: string | null;
      handoffInvoiceMatched: boolean;
      runtimeFixturePolicy:
        | "exact"
        | "compatible-state";
    }
  | {
      status: "TEST_DATA_ISSUE";
      note: string;
    }
  | {
      status: "AUTOMATION_LIMITATION";
      note: string;
    }
) & {
  runtimeFixturePreparation?:
    BrowserRuntimeFixturePreparationResult;
};

export type PreparedRuntimeInvoiceFixture = {
  result: BrowserRuntimeFixturePreparationResult;
  candidate: VisibleInvoiceRow | null;
  selectedTableView: string | null;
};

export function evaluateUniqueCompatibleFixtureCandidates(
  candidateCount: number
): { status: "UNIQUE" } | {
  status: "BLOCKED";
  reason: "NO_COMPATIBLE_CANDIDATE" | "AMBIGUOUS_COMPATIBLE_CANDIDATES";
} {
  if (candidateCount === 1) return { status: "UNIQUE" };
  return {
    status: "BLOCKED",
    reason: candidateCount < 1
      ? "NO_COMPATIBLE_CANDIDATE"
      : "AMBIGUOUS_COMPATIBLE_CANDIDATES",
  };
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function getCaseText(
  testCase: any
): string {
  const stepsText = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
        .map((step: any) =>
          [
            step?.action,
            step?.text,
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ")
    : "";

  return [
    testCase?.goal,
    testCase?.successCriteria,
    stepsText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]+/g, " ");
}

export function isInvoiceRowClickRequest(
  testCase: any,
  requestedText: string
): boolean {
  const caseText = getCaseText(testCase);

  if (
    !caseText.includes("invoice")
  ) {
    return false;
  }

  const normalizedRequestedText =
    String(requestedText || "")
      .trim()
      .toLowerCase();

  return (
    /^inv[-\s]/i.test(
      normalizedRequestedText
    ) ||
    normalizedRequestedText.includes(
      "invoice number"
    ) ||
    normalizedRequestedText.includes(
      "invoice from fixture"
    ) ||
    normalizedRequestedText.includes(
      "invoice fixture"
    )
  );
}

function inferRequiredInvoiceTableView(
  testCase: any
): RequiredInvoiceTableView {
  const steps = Array.isArray(
    testCase?.steps
  )
    ? testCase.steps
    : [];

  const requestedTabTexts = steps
    .filter(
      (step: any) =>
        step?.action === "clickTopTab"
    )
    .map(
      (step: any) =>
        String(step?.text || "")
          .trim()
          .toLowerCase()
    );

  if (
    requestedTabTexts.some(
      (value: string) =>
        value === "sent for processing"
    )
  ) {
    return "sent-for-processing";
  }

  if (
    requestedTabTexts.some(
      (value: string) =>
        value === "processed"
    )
  ) {
    return "processed";
  }

  return null;
}

function inferDesiredInvoiceState(
  testCase: any
): DesiredInvoiceState {
  const text = getCaseText(testCase);

  /*
   * A concrete table tab is already the requested
   * invoice collection state. Do not infer another
   * state from drawer field labels and leave that tab.
   */
  if (
    inferRequiredInvoiceTableView(
      testCase
    )
  ) {
    return "any";
  }

  if (
    text.includes("no timesheet") ||
    text.includes("without timesheet") ||
    text.includes("zero timesheet")
  ) {
    return "no-timesheets";
  }

  if (
    text.includes("pending invoice") ||
    text.includes("non approved invoice") ||
    text.includes("not approved invoice") ||
    text.includes("non-approved invoice")
  ) {
    return "pending";
  }

  if (
    text.includes("approved invoice") ||
    text.includes("invoice approved by") ||
    text.includes("invoice approver") ||
    text.includes("invoice approval time")
  ) {
    return "approved";
  }

  return "any";
}

function rowMatchesState(
  rowText: string,
  desiredState: DesiredInvoiceState
): boolean {
  const text = rowText.toLowerCase();

  if (desiredState === "any") {
    return true;
  }

  if (desiredState === "approved") {
    return (
      /\bapproved\b/i.test(text) ||
      /\bprocessed\b/i.test(text) ||
      /\bpaid\b/i.test(text)
    );
  }

  if (desiredState === "pending") {
    return (
      /\bpending\b/i.test(text) ||
      text.includes("sent for processing") ||
      text.includes("awaiting") ||
      text.includes("not approved") ||
      text.includes("unpaid")
    );
  }

  return (
    text.includes("no timesheet") ||
    text.includes("0 timesheet") ||
    text.includes("zero timesheet")
  );
}

async function collectVisibleInvoiceRows(
  page: Page
): Promise<VisibleInvoiceRow[]> {
  const main = page.locator("main").first();

  const rowSources = [
    main.locator("tbody tr"),
    main.locator("[role='row']"),
  ];

  const rows: VisibleInvoiceRow[] = [];
  const seenInvoices = new Set<string>();

  for (const source of rowSources) {
    const count = Math.min(
      await source.count().catch(() => 0),
      50
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const row = source.nth(index);

      const visible = await row
        .isVisible()
        .catch(() => false);

      if (!visible) {
        continue;
      }

      const text = (
        await row
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();

      const invoiceMatch = text.match(
        /\bINV-[A-Z0-9-]+\b/i
      );

      if (!invoiceMatch) {
        continue;
      }

      const invoiceNumber =
        invoiceMatch[0]!.trim();

      const key =
        invoiceNumber.toLowerCase();

      if (seenInvoices.has(key)) {
        continue;
      }

      seenInvoices.add(key);

      rows.push({
        row,
        text,
        invoiceNumber,
      });
    }
  }

  return rows;
}

async function hasEmptyInvoiceState(
  page: Page
): Promise<boolean> {
  const mainText = (
    await page
      .locator("main")
      .first()
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .toLowerCase();

  return (
    mainText.includes("no data") ||
    mainText.includes("no invoices") ||
    mainText.includes("no records") ||
    mainText.includes("nothing to show")
  );
}

async function findVisibleInvoiceSurface(
  page: Page
): Promise<Locator | null> {
  const candidates = [
    page.getByRole("dialog"),

    page.locator(
      '[data-state="open"]'
    ),

    page.locator(
      "[data-radix-dialog-content]"
    ),

    page.locator("aside"),

    page.locator(
      '[role="complementary"]'
    ),

    page.locator(
      [
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
      ].join(", ")
    ),
  ];

  for (const candidate of candidates) {
    const count = Math.min(
      await candidate
        .count()
        .catch(() => 0),
      8
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const item =
        candidate.nth(index);

      const visible = await item
        .isVisible()
        .catch(() => false);

      if (!visible) {
        continue;
      }

      const text = (
        await item
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      const hasInvoiceNumber =
        /\binv-[a-z0-9-]+\b/i.test(
          text
        );

      const hasInvoiceDetailsTitle =
        text.includes(
          "invoice details"
        );

      const detailLandmarkCount = [
        "invoice no",
        "invoice status",
        "payment provider",
        "total amount",
        "due date",
        "line items",
        "work period",
      ].filter(
        (landmark) =>
          text.includes(landmark)
      ).length;

      /*
       * A navigation sidebar may contain "Invoices" and
       * "Timesheets", but it is not an invoice drawer.
       * Require an invoice number/title plus multiple
       * invoice-detail fields.
       */
      if (
        (
          hasInvoiceNumber ||
          hasInvoiceDetailsTitle
        ) &&
        detailLandmarkCount >= 2
      ) {
        return item;
      }
    }
  }

  return null;
}

async function invoiceDrawerIsVisible(
  page: Page
): Promise<boolean> {
  return Boolean(
    await findVisibleInvoiceSurface(page)
  );
}

function extractInvoiceStatus(
  drawerText: string
): string | null {
  const normalized = drawerText
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const match = normalized.match(
    /invoice status\s*:?\s*([a-z][a-z -]{0,30}?)(?=\s+(?:total amount|due date|payment provider|line items|timesheets|project|$))/
  );

  return match?.[1]
    ?.replace(/\s+/g, " ")
    .trim() || null;
}

async function invoiceDrawerMatchesState(
  page: Page,
  desiredState: DesiredInvoiceState
): Promise<boolean> {
  const surface =
    await findVisibleInvoiceSurface(page);

  if (!surface) {
    return false;
  }

  if (desiredState === "any") {
    return true;
  }

  const text = (
    await surface
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const invoiceStatus =
    extractInvoiceStatus(text);

  console.log(
    ` Invoice drawer state probe: ` +
      `status=${invoiceStatus ?? "unknown"} | ` +
      text.slice(0, 240)
  );

  if (desiredState === "approved") {
    /*
     * Explicit invoice status is authoritative.
     * Timesheet approval fields must never make a Draft
     * invoice look approved.
     */
    if (invoiceStatus) {
      return [
        "approved",
        "processed",
        "paid",
        "completed",
      ].some(
        (status) =>
          invoiceStatus === status ||
          invoiceStatus.startsWith(
            `${status} `
          )
      );
    }

    /*
     * Fallback only to invoice-specific labels.
     * Generic "Approved By" may belong to a timesheet.
     */
    return (
      text.includes(
        "invoice approved by"
      ) ||
      text.includes(
        "invoice approved at"
      ) ||
      text.includes(
        "invoice processed by"
      ) ||
      text.includes(
        "invoice paid on"
      )
    );
  }

  if (desiredState === "pending") {
    if (invoiceStatus) {
      return [
        "draft",
        "pending",
        "unpaid",
        "awaiting approval",
        "sent for processing",
      ].some(
        (status) =>
          invoiceStatus === status ||
          invoiceStatus.startsWith(
            `${status} `
          )
      );
    }

    return (
      text.includes(
        "invoice awaiting approval"
      ) ||
      text.includes(
        "invoice not approved"
      ) ||
      text.includes(
        "invoice sent for processing"
      )
    );
  }

  return (
    text.includes("no timesheet") ||
    text.includes("no timesheets") ||
    text.includes("0 timesheet") ||
    text.includes("zero timesheet") ||
    text.includes("nothing to show") ||
    text.includes("no data")
  );
}

async function waitForInvoiceDrawerOpen(
  page: Page
): Promise<boolean> {
  for (
    let attempt = 1;
    attempt <= 8;
    attempt += 1
  ) {
    if (
      await invoiceDrawerIsVisible(
        page
      )
    ) {
      return true;
    }

    if (attempt < 8) {
      await page.waitForTimeout(300);
    }
  }

  return false;
}

async function waitForInvoiceDrawerClosed(
  page: Page
): Promise<boolean> {
  for (
    let attempt = 1;
    attempt <= 6;
    attempt += 1
  ) {
    if (
      !await invoiceDrawerIsVisible(
        page
      )
    ) {
      return true;
    }

    await page.waitForTimeout(300);
  }

  return false;
}

async function closeInvoiceDrawer(
  page: Page,
  invoiceNumber?: string
): Promise<boolean> {
  if (
    !await invoiceDrawerIsVisible(page)
  ) {
    return true;
  }

  /*
   * Escape is safer than clicking an arbitrary backdrop or
   * an icon whose accessible name is unclear.
   */
  await page.keyboard
    .press("Escape")
    .catch(() => {});

  if (
    await waitForInvoiceDrawerClosed(
      page
    )
  ) {
    console.log(
      ` Invoice drawer closed with Escape: ` +
        `${invoiceNumber || "unknown"}`
    );

    return true;
  }

  const surface =
    await findVisibleInvoiceSurface(page);

  if (!surface) {
    return true;
  }

  const closeCandidates = [
    surface.locator(
      'button[aria-label*="close" i]'
    ),

    surface.locator(
      'button[title*="close" i]'
    ),

    surface.getByRole("button", {
      name: /^(close|dismiss)$/i,
    }),

    surface
      .locator("button")
      .filter({
        hasText: /^(×|x)$/i,
      }),
  ];

  for (
    const candidate of closeCandidates
  ) {
    const count = Math.min(
      await candidate
        .count()
        .catch(() => 0),
      4
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const item =
        candidate.nth(index);

      if (
        !await item
          .isVisible()
          .catch(() => false)
      ) {
        continue;
      }

      try {
        await item.click({
          timeout: 1500,
        });

        if (
          await waitForInvoiceDrawerClosed(
            page
          )
        ) {
          console.log(
            ` Invoice drawer closed with control: ` +
              `${invoiceNumber || "unknown"}`
          );

          return true;
        }
      } catch {
        // Try the next explicit close control.
      }
    }
  }

  return false;
}

async function trySelectInvoiceStateView(
  page: Page,
  desiredState: DesiredInvoiceState,
  requiredTableView:
    RequiredInvoiceTableView = null
): Promise<string | null> {
  const labels =
    requiredTableView ===
      "sent-for-processing"
      ? [
          "Sent for Processing",
        ]
      : requiredTableView ===
          "processed"
        ? [
            "Processed",
          ]
        : desiredState === "approved"
          ? [
              "Approved",
              "Processed",
              "Paid",
            ]
          : desiredState === "pending"
            ? [
                "Pending",
                "Draft",
                "Sent for Processing",
              ]
            : [];

  if (labels.length === 0) {
    return null;
  }

  const main =
    page.locator("main").first();

  for (const label of labels) {
    const regex = new RegExp(
      `^\\s*${escapeRegExp(label)}\\s*$`,
      "i"
    );

    const candidates = [
      main.getByRole("tab", {
        name: regex,
      }),

      main.getByRole("button", {
        name: regex,
      }),

      main.getByRole("link", {
        name: regex,
      }),
    ];

    for (const candidate of candidates) {
      const count = Math.min(
        await candidate
          .count()
          .catch(() => 0),
        3
      );

      for (
        let index = 0;
        index < count;
        index += 1
      ) {
        const item =
          candidate.nth(index);

        if (
          !await item
            .isVisible()
            .catch(() => false)
        ) {
          continue;
        }

        try {
          await item.click({
            timeout: 1500,
          });

          await page.waitForTimeout(800);

          await page
            .waitForLoadState(
              "networkidle",
              {
                timeout: 3000,
              }
            )
            .catch(() => {});

          console.log(
            ` Invoice state view selected: ` +
              label
          );

          return label;
        } catch {
          // Try another exact state control.
        }
      }
    }
  }

  console.log(
    ` Invoice state view unavailable for ` +
      `required state=${
        requiredTableView ||
        desiredState
      }.`
  );

  return null;
}

async function verifyInvoiceStateViewActive(
  page: Page,
  requiredState: RuntimeInvoiceFixtureState
): Promise<boolean> {
  const label =
    requiredState === "processed"
      ? "Processed"
      : "Sent for Processing";
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(label)}\\s*$`,
    "i"
  );
  const main = page.locator("main").first();
  const candidates = main.locator(
    '[role="tab"], button, a'
  );
  let visibleMatchCount = 0;
  let activeMatchCount = 0;

  const count = Math.min(
    await candidates.count().catch(() => 0),
    100
  );

  for (let index = 0; index < count; index += 1) {
      const item = candidates.nth(index);

      if (!await item.isVisible().catch(() => false)) {
        continue;
      }

      const itemLabel = String(
        await item
          .getAttribute("aria-label")
          .catch(() => null) ||
        await item
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim();

      if (!pattern.test(itemLabel)) {
        continue;
      }

      visibleMatchCount += 1;

      const active = await item
        .evaluate((element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const className =
            typeof element.className === "string"
              ? element.className
              : "";

          return (
            element.getAttribute("aria-selected") === "true" ||
            element.getAttribute("data-state") === "active" ||
            element.getAttribute("aria-current") === "page" ||
            element.getAttribute("aria-current") === "true" ||
            /(^|\s)(active|selected)(\s|$)/i.test(className)
          );
        })
        .catch(() => false);

      if (active) {
        activeMatchCount += 1;
      }
  }

  return (
    visibleMatchCount >= 1 &&
    activeMatchCount === 1
  );
}

/**
 * The runtime-fixture contract is the canonical source-authorized carrier for
 * an atomic invoice state. Planner tab steps remain a legacy interaction hint
 * only; they must neither override nor be required to recover that state.
 */
export function runtimeInvoiceStateFromCase(
  testCase: any
): RuntimeInvoiceFixtureState | null {
  const contract =
    testCase?.runtimeFixtureResolutionContract;

  if (contract) {
    const members = Array.isArray(contract.members)
      ? contract.members
      : [];
    const interactionExecutionCaseId = String(
      contract.interactionExecutionCaseId || ""
    ).trim();
    const member = members.find(
      (item: any) =>
        String(item?.executionCaseId || "").trim() ===
        interactionExecutionCaseId
    );
    const constraint =
      member?.acceptanceFixtureConstraint;
    const capability =
      member?.fixtureResolutionCapability;
    const constraintState =
      constraint?.fixtureKind === "invoice" &&
      constraint?.semantic?.kind === "STATE"
        ? constraint.semantic.state
        : null;
    const capabilityState =
      capability?.fixtureKind === "invoice" &&
      capability?.resolverRef ===
        "browser-visible-invoice-row"
        ? capability.supportedState
        : null;

    if (
      contract.status ===
        "RUNTIME_FIXTURE_RESOLUTION_REQUIRED" &&
      contract.policy === "ALL_REQUIRED" &&
      members.length === 1 &&
      constraintState &&
      capabilityState === constraintState
    ) {
      return constraintState;
    }

    /* A present but malformed typed contract must not fall back to model steps. */
    return null;
  }

  return inferRequiredInvoiceTableView(
    testCase
  );
}

function plannerRequestedInvoiceIdentity(
  requestedText: string
): string | null {
  return String(requestedText || "").match(
    /\bINV-[A-Z0-9-]+\b/i
  )?.[0] ?? null;
}

export async function prepareRuntimeInvoiceFixture(
  page: Page,
  testCase: any,
  requestedText: string,
  options: {
    executionPersona?: string | null;
    now?: () => Date;
  } = {}
): Promise<PreparedRuntimeInvoiceFixture> {
  const requiredState =
    runtimeInvoiceStateFromCase(testCase);
  const preparedAt = (
    options.now?.() ?? new Date()
  ).toISOString();
  const evidenceRef =
    `runtime-fixture-preparation:${String(
      testCase?.id || "unknown-case"
    )}`;
  const selectedTableView =
    requiredState
      ? await trySelectInvoiceStateView(
          page,
          "any",
          requiredState
        )
      : null;
  const stateVerified =
    requiredState !== null &&
    selectedTableView !== null &&
    await verifyInvoiceStateViewActive(
      page,
      requiredState
    );
  let rows: VisibleInvoiceRow[] = [];

  if (stateVerified) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      rows = await collectVisibleInvoiceRows(page);

      if (rows.length > 0 || attempt === 8) {
        break;
      }

      await page.waitForTimeout(700);
    }
  }

  const result =
    evaluateRuntimeInvoiceFixturePreparation({
      testCase,
      actualPersona:
        options.executionPersona,
      requiredState,
      stateVerified,
      candidates: requiredState
        ? rows.map((row) => ({
            identityRef:
              row.invoiceNumber,
            verifiedState:
              requiredState,
          }))
        : [],
      requestedIdentity:
        plannerRequestedInvoiceIdentity(
          requestedText
        ),
      preparedAt,
      evidenceRef,
    });

  testCase.runtimeFixturePreparationResult =
    result;

  const candidate =
    runtimeFixturePreparationAllowsInteraction(
      result
    )
      ? rows.find(
          (row) =>
            row.invoiceNumber ===
            result.selectedIdentity
        ) ?? null
      : null;

  return {
    result,
    candidate,
    selectedTableView,
  };
}

async function clickInvoiceCandidate(
  page: Page,
  candidate: VisibleInvoiceRow
): Promise<boolean> {
  const invoiceRegex = new RegExp(
    `^\\s*${escapeRegExp(
      candidate.invoiceNumber
    )}\\s*$`,
    "i"
  );

  /*
   * Only click the invoice-number element or an explicit
   * interactive control containing that invoice number.
   * Never click the whole row or an arbitrary blank area.
   */
  const targets = [
    candidate.row.getByRole("link", {
      name: invoiceRegex,
    }),

    candidate.row.getByRole("button", {
      name: invoiceRegex,
    }),

    candidate.row
      .locator("a")
      .filter({
        hasText: invoiceRegex,
      }),

    candidate.row
      .locator("button")
      .filter({
        hasText: invoiceRegex,
      }),

    candidate.row
      .getByText(
        invoiceRegex,
        {
          exact: true,
        }
      ),
  ];

  for (const locator of targets) {
    const count = Math.min(
      await locator
        .count()
        .catch(() => 0),
      3
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const target =
        locator.nth(index);

      const visible = await target
        .isVisible()
        .catch(() => false);

      if (!visible) {
        continue;
      }

      try {
        await target
          .scrollIntoViewIfNeeded({
            timeout: 1500,
          });

await target.click({
  timeout: 2000,
});

if (
  await waitForInvoiceDrawerOpen(
    page
  )
) {
  return true;
}
      } catch {
        // Try the next explicit invoice-number target.
      }
    }
  }

  return false;
}

export async function resolveAndOpenInvoiceRow(
  page: Page,
  testCase: any,
  requestedText: string,
  options: {
    executionPersona?: string | null;
    now?: () => Date;
  } = {}
): Promise<InvoiceInteractionResult> {

  if (
    requiresRuntimeInvoiceFixturePreparation(
      testCase
    )
  ) {
    const preparation =
      await prepareRuntimeInvoiceFixture(
        page,
        testCase,
        requestedText,
        options
      );

    if (
      !runtimeFixturePreparationAllowsInteraction(
        preparation.result
      ) ||
      !preparation.candidate
    ) {
      return {
        status: "TEST_DATA_ISSUE",
        note: preparation.result.note,
        runtimeFixturePreparation:
          preparation.result,
      };
    }

    const opened = await clickInvoiceCandidate(
      page,
      preparation.candidate
    );

    if (!opened) {
      return {
        status: "AUTOMATION_LIMITATION",
        note:
          `manual required: prepared runtime invoice ` +
          `${preparation.result.selectedIdentity} could not be opened safely`,
        runtimeFixturePreparation:
          preparation.result,
      };
    }

    const requestedInvoice =
      plannerRequestedInvoiceIdentity(
        requestedText
      );
    const handoffInvoice =
      String(
        testCase?.runtimeResourceContext
          ?.invoiceNumber || ""
      ).match(/\bINV-[A-Z0-9-]+\b/i)?.[0] ??
      null;
    const selectedInvoice =
      preparation.result.selectedIdentity!;
    const exactInvoiceMatched = Boolean(
      requestedInvoice &&
      selectedInvoice.toLowerCase() ===
        requestedInvoice.toLowerCase()
    );
    const handoffInvoiceMatched = Boolean(
      handoffInvoice &&
      selectedInvoice.toLowerCase() ===
        handoffInvoice.toLowerCase()
    );

    testCase.runtimeSelectedInvoice =
      selectedInvoice;
    testCase.runtimeInvoiceFixture = {
      policy: "compatible-state",
      requestedInvoice,
      handoffInvoice,
      selectedInvoice,
      requiredTableView:
        preparation.result.requiredState,
      selectedTableView:
        preparation.selectedTableView,
      exactInvoiceMatched,
      handoffInvoiceMatched,
    };
    testCase.runtimeEvidenceIdentity = {
      checkpointAction: "clickText",
      entityType: "invoice",
      requestedIdentity:
        requestedInvoice,
      runtimeIdentity:
        selectedInvoice,
      handoffIdentity:
        handoffInvoice,
      substituted: Boolean(
        requestedInvoice &&
        !exactInvoiceMatched
      ),
      policy: "compatible-state",
      selectionSource:
        handoffInvoiceMatched
          ? "api-handoff"
          : exactInvoiceMatched
            ? "planner"
            : "runtime-discovery",
    };

    return {
      status: "OPENED",
      selectedInvoice,
      requestedInvoice,
      handoffInvoice,
      requiredTableView:
        preparation.result.requiredState,
      selectedTableView:
        preparation.selectedTableView,
      exactInvoiceMatched,
      handoffInvoiceMatched,
      runtimeFixturePolicy:
        "compatible-state",
      note:
        `${preparation.result.note}; ` +
        `invoice drawer opened; ` +
        `fixture readiness is runtime-only and does not imply proof or PASS`,
      runtimeFixturePreparation:
        preparation.result,
    };
  }

    const preRequiredTableView =
    inferRequiredInvoiceTableView(
      testCase
    );

  const preDesiredState =
    inferDesiredInvoiceState(
      testCase
    );

  const preselectedStateView =
    await trySelectInvoiceStateView(
      page,
      preDesiredState,
      preRequiredTableView
    );

  if (
    preRequiredTableView &&
    !preselectedStateView
  ) {
    return {
      status: "AUTOMATION_LIMITATION",
      note:
        `manual required: exact invoice ` +
        `table view "${preRequiredTableView}" ` +
        `could not be selected safely`,
    };
  }
  /*
   * Payments tables may temporarily render "No data" while
   * their async query is still loading. Do not classify that
   * first transient frame as a real test-data issue.
   */
  let rows: VisibleInvoiceRow[] = [];

  for (
    let attempt = 1;
    attempt <= 8;
    attempt += 1
  ) {
    rows =
      await collectVisibleInvoiceRows(
        page
      );

    if (rows.length > 0) {
      break;
    }

    if (attempt < 8) {
      if (attempt === 1) {
        console.log(
          " Invoice table has no visible rows yet; " +
            "waiting for async table data."
        );
      }

      await page.waitForTimeout(700);
    }
  }

  if (rows.length === 0) {
    if (
      await hasEmptyInvoiceState(page)
    ) {
      return {
        status: "TEST_DATA_ISSUE",
        note:
          "blocked: invoice table is empty; " +
          "no safe invoice fixture is available.",
      };
    }

    return {
      status: "AUTOMATION_LIMITATION",
      note:
        "manual required: no visible invoice rows " +
        "could be identified in the main table.",
    };
  }

  console.log(
    ` Invoice interaction discovered: ` +
      rows
        .map((row) => row.invoiceNumber)
        .join(", ")
  );

  const plannerRequestedInvoice =
    String(requestedText || "").match(
      /\bINV-[A-Z0-9-]+\b/i
    )?.[0];

  const handoffInvoice =
    String(
      testCase
        ?.runtimeResourceContext
        ?.invoiceNumber ||
        ""
    ).match(
      /\bINV-[A-Z0-9-]+\b/i
    )?.[0];

    const requiredTableView =
    preRequiredTableView;

  const desiredState =
    preDesiredState;

  const selectedStateView =
    preselectedStateView;

  if (
    requiredTableView &&
    !selectedStateView
  ) {
    return {
      status:
        "AUTOMATION_LIMITATION",
      note:
        `manual required: exact invoice ` +
        `table view "${requiredTableView}" ` +
        `could not be selected safely`,
    };
  }

    if (selectedStateView) {
    console.log(
      ` Invoice rows after state view ` +
        `${selectedStateView}: ` +
        `${
          rows
            .map(
              (row) =>
                row.invoiceNumber
            )
            .join(", ")
        }`
    );
  }

  /*
   * INVOICE_FIXTURE_POLICY_ENFORCEMENT_V1
   *
   * Missing or unknown policy defaults to exact.
   * This prevents a Jira-required identity from
   * being silently replaced by another record.
   */
  const runtimeFixturePolicy:
    | "exact"
    | "compatible-state" =
    testCase?.runtimeFixturePolicy ===
      "compatible-state"
      ? "compatible-state"
      : "exact";

  /*
   * compatible-state preference:
   * 1. the explicitly requested invoice;
   * 2. rows whose visible text hints at the state;
   * 3. all remaining visible invoices.
   *
   * exact preference:
   * only the explicitly requested invoice.
   *
   * Final state verification happens inside the drawer.
   */
  const exactRows =
    plannerRequestedInvoice
      ? rows.filter(
          (row) =>
            row.invoiceNumber
              .toLowerCase() ===
            plannerRequestedInvoice
              .toLowerCase()
        )
      : [];

  /*
   * API_BROWSER_INVOICE_HANDOFF_V1
   *
   * For compatible-state cases, prefer the invoice
   * already selected and semantically checked by the API
   * runner. Exact fixture policy remains planner-owned and
   * never accepts an API substitution.
   */
  const handoffRows =
    runtimeFixturePolicy ===
      "compatible-state" &&
    handoffInvoice
      ? rows.filter(
          (row) =>
            !exactRows.includes(row) &&
            row.invoiceNumber
              .toLowerCase() ===
              handoffInvoice
                .toLowerCase()
        )
      : [];

  if (
    runtimeFixturePolicy ===
      "compatible-state" &&
    handoffInvoice
  ) {
    console.log(
      ` Invoice API handoff preference: ` +
        `${handoffInvoice}; ` +
        (
          handoffRows.length > 0 ||
          exactRows.some(
            (row) =>
              row.invoiceNumber
                .toLowerCase() ===
              handoffInvoice
                .toLowerCase()
          )
            ? "matched visible row"
            : "not visible in selected view; using safe fallback"
        )
    );
  }

  if (
    runtimeFixturePolicy === "exact" &&
    plannerRequestedInvoice &&
    exactRows.length === 0
  ) {
    return {
      status: "TEST_DATA_ISSUE",
      note:
        `blocked: exact invoice fixture ` +
        `${plannerRequestedInvoice} was not found ` +
        `in the selected invoice table view ` +
        `${selectedStateView || "current"}; ` +
        `no runtime invoice substitution was ` +
        `performed`,
    };
  }

  const visibleStateRows =
    rows.filter(
      (row) =>
        !handoffRows.includes(row) &&
        !exactRows.includes(row) &&
        rowMatchesState(
          row.text,
          desiredState
        )
    );

  const remainingRows =
    rows.filter(
      (row) =>
        !handoffRows.includes(row) &&
        !exactRows.includes(row) &&
        !visibleStateRows.includes(row)
    );

  const orderedRows =
    runtimeFixturePolicy === "exact" &&
    plannerRequestedInvoice
      ? [
          ...exactRows,
        ]
      : [
          ...handoffRows,
          ...exactRows,
          ...visibleStateRows,
          ...remainingRows,
        ];

  let openedDrawerCount = 0;

  const maxDrawerProbes =
    runtimeFixturePolicy === "exact"
      ? 1
      : selectedStateView
        ? 3
        : 2;

  for (
    const candidate of
    orderedRows.slice(
      0,
      maxDrawerProbes
    )
  ) {
    const originalScrollY =
      await page
        .evaluate(
          () => window.scrollY
        )
        .catch(() => 0);

    console.log(
      ` Invoice drawer probe trying: ` +
        `${candidate.invoiceNumber} ` +
        `(required state=${desiredState})`
    );

    const opened =
      await clickInvoiceCandidate(
        page,
        candidate
      );

    if (!opened) {
      console.log(
        ` Invoice drawer probe could not open: ` +
          candidate.invoiceNumber
      );

      continue;
    }

    openedDrawerCount += 1;

    const stateMatches =
      await invoiceDrawerMatchesState(
        page,
        desiredState
      );

    if (stateMatches) {
      const exactInvoiceMatched =
        Boolean(
          plannerRequestedInvoice &&
          candidate.invoiceNumber
            .toLowerCase() ===
            plannerRequestedInvoice
              .toLowerCase()
        );

      const handoffInvoiceMatched =
        Boolean(
          handoffInvoice &&
          candidate.invoiceNumber
            .toLowerCase() ===
            handoffInvoice
              .toLowerCase()
        );

      testCase.runtimeSelectedInvoice =
        candidate.invoiceNumber;

      testCase.runtimeInvoiceFixture = {
        policy:
          runtimeFixturePolicy,
        requestedInvoice:
          plannerRequestedInvoice ??
          null,
        handoffInvoice:
          handoffInvoice ?? null,
        selectedInvoice:
          candidate.invoiceNumber,
        requiredTableView,
        selectedTableView:
          selectedStateView,
        exactInvoiceMatched,
        handoffInvoiceMatched,
      };

      /*
       * GENERIC_RUNTIME_ENTITY_IDENTITY_V1
       *
       * Entity-specific resolvers publish one common identity
       * contract. Checkpoint, screenshot, video and reporting
       * layers do not need to understand invoice internals.
       */
      testCase.runtimeEvidenceIdentity = {
        checkpointAction:
          "clickText",
        entityType:
          "invoice",
        requestedIdentity:
          plannerRequestedInvoice ??
          null,
        runtimeIdentity:
          candidate.invoiceNumber,
        handoffIdentity:
          handoffInvoice ?? null,
        substituted:
          Boolean(
            plannerRequestedInvoice &&
            !exactInvoiceMatched
          ),
        policy:
          runtimeFixturePolicy,
        selectionSource:
          handoffInvoiceMatched
            ? "api-handoff"
            : exactInvoiceMatched
              ? "planner"
              : "runtime-discovery",
      };

      return {
        status: "OPENED",
        selectedInvoice:
          candidate.invoiceNumber,
        requestedInvoice:
          plannerRequestedInvoice ??
          null,
        handoffInvoice:
          handoffInvoice ?? null,
        requiredTableView,
        selectedTableView:
          selectedStateView,
        exactInvoiceMatched,
        handoffInvoiceMatched,
        runtimeFixturePolicy,
        note:
          `opened runtime-selected invoice ` +
          `${candidate.invoiceNumber}; ` +
          `required table view=` +
          `${requiredTableView || "current"}; ` +
          `selected table view=` +
          `${selectedStateView || "current"}; ` +
          `fixture policy=` +
          `${runtimeFixturePolicy}; ` +
          `API handoff invoice=` +
          `${handoffInvoice || "none"}; ` +
          `API handoff match=` +
          `${handoffInvoiceMatched}; ` +
          `exact requested invoice match=` +
          `${exactInvoiceMatched}`,
      };
    }

    console.log(
      ` Invoice drawer probe rejected: ` +
        `${candidate.invoiceNumber} ` +
        `did not match state=${desiredState}`
    );

    const closed =
      await closeInvoiceDrawer(
        page,
        candidate.invoiceNumber
      );

    if (!closed) {
      return {
        status:
          "AUTOMATION_LIMITATION",
        note:
          `manual required: invoice ` +
          `${candidate.invoiceNumber} opened, ` +
          `but the actual invoice drawer could ` +
          `not be closed safely.`,
      };
    }

    await page
      .evaluate(
        (scrollY) => {
          window.scrollTo(
            0,
            Number(scrollY)
          );
        },
        originalScrollY
      )
      .catch(() => {});

    await page.waitForTimeout(250);
  }

  if (openedDrawerCount === 0) {
    return {
      status:
        "AUTOMATION_LIMITATION",
      note:
        "manual required: visible invoice rows " +
        "were discovered, but no invoice drawer " +
        "could be confirmed as open.",
    };
  }

  if (
    !selectedStateView &&
    orderedRows.length >
      openedDrawerCount
  ) {
    return {
      status:
        "AUTOMATION_LIMITATION",
      note:
        `manual required: sampled ` +
        `${openedDrawerCount} invoice ` +
        `drawer(s), but no explicit ` +
        `${desiredState} filter/view was ` +
        `available. Brute-force inspection ` +
        `was stopped safely.`,
    };
  }

  return {
    status: "TEST_DATA_ISSUE",
    note:
      `blocked: ${openedDrawerCount} invoice ` +
      `drawer(s) were inspected in the ` +
      `${selectedStateView || "current"} view, ` +
      `but none matched required state=` +
      `${desiredState}.`,
  };
}
