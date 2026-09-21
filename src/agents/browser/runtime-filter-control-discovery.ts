import type {
  Locator,
  Page,
} from "playwright";
import type {
  FilterControlCandidate,
} from "./runtime-filter-shared.js";

async function scoreFilterControl(
  locator: Locator,
  tokens: string[]
): Promise<{
  score: number;
  descriptor: string;
  currentText: string;
  nativeSelect: boolean;
} | null> {
  return locator
    .evaluate(
      (
        element,
        rawTokens
      ) => {
        if (
          !(
            element instanceof
            HTMLElement
          )
        ) {
          return null;
        }

        const style =
          window.getComputedStyle(
            element
          );

        const rect =
          element
            .getBoundingClientRect();

        const visible =
          style.display !==
            "none" &&
          style.visibility !==
            "hidden" &&
          Number(style.opacity) !==
            0 &&
          rect.width >= 20 &&
          rect.height >= 16 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top <
            window.innerHeight &&
          rect.left <
            window.innerWidth;

        if (!visible) {
          return null;
        }

        const ownText =
          String(
            element.getAttribute(
              "aria-label"
            ) ||
            element.getAttribute(
              "placeholder"
            ) ||
            element.getAttribute(
              "aria-valuetext"
            ) ||
            element.innerText ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

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

        const labelledBy =
          String(
            element.getAttribute(
              "aria-labelledby"
            ) || ""
          )
            .split(/\s+/)
            .filter(Boolean)
            .map(
              (id) =>
                document
                  .getElementById(id)
                  ?.textContent || ""
            )
            .join(" ");

        const explicitLabel =
          element.id
            ? Array.from(
                document
                  .querySelectorAll<
                    HTMLLabelElement
                  >("label")
              ).find(
                (label) =>
                  label.htmlFor ===
                  element.id
              )?.innerText || ""
            : "";

        const closestLabel =
          element
            .closest("label")
            ?.textContent || "";

        const parentText =
          element.parentElement
            ?.textContent || "";

        const previousText =
          element.parentElement
            ?.previousElementSibling
            ?.textContent || "";

        const grandparentText =
          element.parentElement
            ?.parentElement
            ?.textContent || "";

        const ownDescriptor =
          [
            ownText,
            element.getAttribute(
              "name"
            ),
            element.getAttribute(
              "data-testid"
            ),
            element.getAttribute(
              "data-slot"
            ),
            descendantMetadata,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const labelDescriptor =
          [
            labelledBy,
            explicitLabel,
            closestLabel,
            previousText,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const nearDescriptor =
          String(parentText || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
            .slice(0, 220);

        const broadDescriptor =
          String(grandparentText || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
            .slice(0, 300);

        const tokens =
          Array.isArray(rawTokens)
            ? rawTokens.map(
                (value) =>
                  String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLowerCase()
              )
            : [];

        const directTokenMatchCount =
          tokens.filter(
            (token) =>
              token &&
              ownDescriptor.includes(
                token
              )
          ).length;

        let score = 0;

        for (const token of tokens) {
          if (!token) {
            continue;
          }

          if (
            ownDescriptor === token
          ) {
            score += 140;
          } else if (
            ownDescriptor.includes(
              token
            )
          ) {
            score += 90;
          }

          if (
            labelDescriptor.includes(
              token
            )
          ) {
            score += 110;
          }

          if (
            nearDescriptor.includes(
              token
            )
          ) {
            score += 45;
          }

          if (
            broadDescriptor.includes(
              token
            )
          ) {
            score += 12;
          }
        }

        const role =
          element.getAttribute(
            "role"
          );

        const tagName =
          element.tagName
            .toLowerCase();

        const nativeSelect =
          tagName === "select";

        const plainButton =
          tagName === "button" ||
          role === "button";

        if (
          plainButton &&
          role !== "combobox" &&
          !element.hasAttribute(
            "aria-haspopup"
          ) &&
          directTokenMatchCount === 0
        ) {
          return null;
        }

        if (nativeSelect) {
          score += 45;
        }

        if (role === "combobox") {
          score += 40;
        }

        if (
          element.hasAttribute(
            "aria-haspopup"
          )
        ) {
          score += 25;
        }

        if (
          element.closest(
            [
              '[role="dialog"]',
              '[data-state="open"]',
              '[class*="popover"]',
              '[class*="Popover"]',
              '[class*="drawer"]',
              '[class*="Drawer"]',
              '[class*="sheet"]',
              '[class*="Sheet"]',
            ].join(",")
          )
        ) {
          score += 30;
        }

        if (
          element.closest("main")
        ) {
          score += 8;
        }

        const descriptor =
          [
            ownDescriptor,
            labelDescriptor,
            nearDescriptor,
          ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 420);

        return {
          score,
          descriptor,
          currentText:
            ownText.slice(0, 120),
          nativeSelect,
        };
      },
      tokens
    )
    .catch(() => null);
}

export async function findRelevantFilterControl(
  page: Page,
  tokens: string[]
): Promise<{
  candidate:
    FilterControlCandidate | null;
  ambiguity: string;
}> {
  const selector = [
    "main select",
    'main [role="combobox"]',
    "main button",
    'main [role="button"]',
    'main button[aria-haspopup]',
    'main [role="button"][aria-haspopup]',
    '[role="dialog"] select',
    '[role="dialog"] [role="combobox"]',
    '[role="dialog"] button',
    '[data-state="open"] select',
    '[data-state="open"] [role="combobox"]',
    '[data-state="open"] button',
    '[class*="popover"] select',
    '[class*="popover"] [role="combobox"]',
    '[class*="popover"] button',
    '[class*="Popover"] select',
    '[class*="Popover"] [role="combobox"]',
    '[class*="Popover"] button',
    '[class*="drawer"] select',
    '[class*="drawer"] [role="combobox"]',
    '[class*="drawer"] button',
    '[class*="Drawer"] select',
    '[class*="Drawer"] [role="combobox"]',
    '[class*="Drawer"] button',
    '[class*="sheet"] select',
    '[class*="sheet"] [role="combobox"]',
    '[class*="sheet"] button',
    '[class*="Sheet"] select',
    '[class*="Sheet"] [role="combobox"]',
    '[class*="Sheet"] button',
  ].join(", ");

  const controls =
    page.locator(selector);

  const count = Math.min(
    await controls
      .count()
      .catch(() => 0),
    120
  );

  const candidates:
    FilterControlCandidate[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      controls.nth(index);

    const metadata =
      await scoreFilterControl(
        locator,
        tokens
      );

    if (
      !metadata ||
      metadata.score < 65
    ) {
      continue;
    }

    candidates.push({
      locator,
      ...metadata,
    });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.descriptor.localeCompare(
        right.descriptor
      ) ||
      left.currentText.localeCompare(
        right.currentText
      )
  );

  const best = candidates[0];
  const second = candidates[1];

  if (!best) {
    return {
      candidate: null,
      ambiguity:
        "no visible filter control matched " +
        `tokens [${tokens.join(", ")}]`,
    };
  }

  if (
    second &&
    best.score -
      second.score < 12
  ) {
    return {
      candidate: null,
      ambiguity:
        `multiple filter controls matched ` +
        `without a unique winner: ` +
        `${best.score}:${best.descriptor} | ` +
        `${second.score}:${second.descriptor}`,
    };
  }

  return {
    candidate: best,
    ambiguity: "",
  };
}
