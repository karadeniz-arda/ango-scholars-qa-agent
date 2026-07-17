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
  text: string
): Promise<GenericActionResult> {
  const regex = textRegex(text);

  const main = page.locator("main").first();

  const roleLocators = [
    page.getByRole("tab", { name: regex }),
    page.getByRole("button", { name: regex }),
    page.getByRole("link", { name: regex }),
    page.getByRole("menuitem", { name: regex }),
    main.getByText(regex),
    page.getByText(regex),
  ];

  for (const locator of roleLocators) {
    const result = await clickFirstVisible(locator, `text "${text}"`);
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