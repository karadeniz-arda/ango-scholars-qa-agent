import type {
  Page,
} from "playwright";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function isBrowserTextVisible(
  page: Page,
  text: string
): Promise<boolean> {
  const normalized =
    String(text || "").trim();

  if (!normalized) {
    return false;
  }

  const regex = new RegExp(
    escapeRegExp(normalized)
      .replace(/\\\s+/g, "\\s+"),
    "i"
  );

  /*
   * Search the active drawer/dialog first. A hidden duplicate
   * elsewhere in the DOM must not make a visible assertion
   * fail merely because it is the locator's first match.
   */
  const scopes = [
    page.getByRole("dialog"),

    page.locator(
      '[data-radix-dialog-content]'
    ),

    page.locator(
      '[data-state="open"]'
    ),

    page.locator(
      [
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
      ].join(", ")
    ),

    page.locator("main"),

    page.locator("body"),
  ];

  for (const scope of scopes) {
    const matches =
      scope.getByText(regex);

    const count = Math.min(
      await matches
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const visible =
        await matches
          .nth(index)
          .isVisible()
          .catch(() => false);

      if (visible) {
        return true;
      }
    }
  }

  return false;
}
