import type {
  Page,
} from "playwright";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type BrowserTextVisibilityOptions = {
  exact?: boolean;
  scopeSelector?: string;
  allowRequiredAsterisk?: boolean;
};

export async function isBrowserTextVisible(
  page: Page,
  text: string,
  options:
    BrowserTextVisibilityOptions = {}
): Promise<boolean> {
  const normalized =
    String(text || "").trim();

  if (!normalized) {
    return false;
  }

  const escapedText =
    escapeRegExp(normalized)
      .replace(/\\\s+/g, "\\s+");

  const regexSource =
    options.exact
      ? [
          "^\\s*",
          escapedText,
          options.allowRequiredAsterisk
            ? "\\s*\\*?"
            : "",
          "\\s*$",
        ].join("")
      : escapedText;

  const regex = new RegExp(
    regexSource,
    "i"
  );

  /*
   * A component-specific scope can be supplied for labels
   * rendered inside an active popover. Otherwise retain the
   * existing broad visibility search behavior.
   */
  const scopes =
    options.scopeSelector
      ? [
          page.locator(
            `${options.scopeSelector}:visible`
          ),
        ]
      : [
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
