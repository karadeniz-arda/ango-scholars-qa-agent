import type {
  Locator,
  Page,
} from "playwright";

export type RuntimeFilterInteractionResult = {
  ok: boolean;
  note: string;
};

type QueryState = {
  has: boolean;
  values: string[];
};

type FilterControlCandidate = {
  locator: Locator;
  score: number;
  descriptor: string;
  currentText: string;
  nativeSelect: boolean;
};

type RuntimeOptionCandidate = {
  locator: Locator;
  label: string;
  score: number;
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeQueryKey(
  value: unknown
): string {
  return String(value ?? "")
    .trim();
}

function queryKeyTokens(
  queryKey: string,
  hint?: string
): string[] {
  const splitQueryKey =
    queryKey
      .replace(
        /([a-z0-9])([A-Z])/g,
        "$1 $2"
      )
      .replace(
        /[_\-.]+/g,
        " "
      );

  const values = [
    queryKey,
    splitQueryKey,
    hint ?? "",
  ];

  const normalizedKey =
    normalize(queryKey);

  const aliases:
    Record<string, string[]> = {
      project: [
        "project",
        "projects",
      ],
      status: [
        "status",
        "statuses",
      ],
      type: [
        "type",
        "types",
      ],
      category: [
        "category",
        "categories",
      ],
      skillids: [
        "skill",
        "skills",
      ],
      searchtext: [
        "search",
        "keyword",
      ],
      maindiscipline: [
        "main discipline",
        "discipline",
      ],
      secondarydiscipline: [
        "secondary discipline",
        "discipline",
      ],
    };

  values.push(
    ...(
      aliases[normalizedKey] ??
      []
    )
  );

  const tokens = new Set<string>();

  for (const value of values) {
    const normalized =
      normalize(value);

    if (!normalized) {
      continue;
    }

    tokens.add(normalized);

    for (
      const token
      of normalized.split(
        /[^a-z0-9]+/i
      )
    ) {
      if (token.length >= 3) {
        tokens.add(token);
      }
    }
  }

  return [...tokens];
}

function isUnsafeFilterOptionLabel(
  value: string
): boolean {
  const normalized =
    normalize(value);

  if (
    !normalized ||
    normalized.length > 120
  ) {
    return true;
  }

  if (
    /^(all|any|none|clear|reset|select|choose|search|filter|filters|apply|cancel|close|done)(\b|$)/i
      .test(normalized)
  ) {
    return true;
  }

  return [
    "delete",
    "reject",
    "approve",
    "submit",
    "publish",
    "create",
    "save",
    "send",
    "invite",
    "archive",
    "remove",
    "request publish",
    "invite external people",
    "complete",
  ].includes(normalized);
}

function readQueryState(
  rawUrl: string,
  queryKey: string
): QueryState {
  try {
    const url = new URL(rawUrl);

    return {
      has:
        url.searchParams.has(
          queryKey
        ),
      values:
        url.searchParams.getAll(
          queryKey
        ),
    };
  } catch {
    return {
      has: false,
      values: [],
    };
  }
}

function queryStateChanged(
  before: QueryState,
  after: QueryState
): boolean {
  return (
    before.has !== after.has ||
    JSON.stringify(
      before.values
    ) !==
      JSON.stringify(
        after.values
      )
  );
}

function compactQueryFamilyKey(
  value: string
): string {
  return value
    .replace(/[_\-.]+/g, "")
    .toLowerCase()
    .replace(/ids?$/, "");
}

function findRelatedChangedQueryKey(
  beforeUrl: string,
  afterUrl: string,
  expectedKey: string
): string | null {
  try {
    const before =
      new URL(beforeUrl);

    const after =
      new URL(afterUrl);

    const expectedFamily =
      compactQueryFamilyKey(
        expectedKey
      );

    const keys =
      new Set([
        ...before.searchParams.keys(),
        ...after.searchParams.keys(),
      ]);

    for (const key of keys) {
      if (
        key === expectedKey ||
        compactQueryFamilyKey(key) !==
          expectedFamily
      ) {
        continue;
      }

      const beforeValues =
        before.searchParams.getAll(key);

      const afterValues =
        after.searchParams.getAll(key);

      if (
        JSON.stringify(beforeValues) !==
        JSON.stringify(afterValues)
      ) {
        return key;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function clickVisible(
  locator: Locator
): Promise<boolean> {
  const visible =
    await locator
      .isVisible({
        timeout: 700,
      })
      .catch(() => false);

  if (!visible) {
    return false;
  }

  try {
    await locator
      .scrollIntoViewIfNeeded({
        timeout: 1000,
      });

    await locator.click({
      timeout: 1800,
    });

    return true;
  } catch {
    return false;
  }
}

async function verifyQueryTransition(
  page: Page,
  beforeUrl: string,
  queryKey: string,
  selectedLabel: string
): Promise<RuntimeFilterInteractionResult> {
  await page.waitForTimeout(900);

  let afterUrl = page.url();

  if (afterUrl === beforeUrl) {
    await page.waitForTimeout(1100);
    afterUrl = page.url();
  }

  const beforeState =
    readQueryState(
      beforeUrl,
      queryKey
    );

  const afterState =
    readQueryState(
      afterUrl,
      queryKey
    );

  const urlChanged =
    afterUrl !== beforeUrl;

  const relevantQueryChanged =
    queryStateChanged(
      beforeState,
      afterState
    );

  if (
    urlChanged &&
    relevantQueryChanged &&
    afterState.has
  ) {
    return {
      ok: true,
      note:
        `selected runtime filter option ` +
        `"${selectedLabel}" for query key ` +
        `"${queryKey}" and observed URL ` +
        `transition: ${beforeUrl} -> ` +
        `${afterUrl}`,
    };
  }

  const relatedChangedKey =
    urlChanged
      ? findRelatedChangedQueryKey(
          beforeUrl,
          afterUrl,
          queryKey
        )
      : null;

  /*
   * The UI interaction succeeded when a related query
   * key changed. Continue execution so the following
   * exact URL assertion can determine whether this is
   * the expected contract or a deterministic mismatch.
   */
  if (relatedChangedKey) {
    return {
      ok: true,
      note:
        `selected runtime filter option ` +
        `"${selectedLabel}" and observed related ` +
        `query transition via ` +
        `"${relatedChangedKey}" instead of exact ` +
        `"${queryKey}": ${beforeUrl} -> ` +
        `${afterUrl}; exact query-key mapping ` +
        `remains for following assertions`,
    };
  }

  return {
    ok: false,
    note:
      `selected runtime filter option ` +
      `"${selectedLabel}", but query key ` +
      `"${queryKey}" transition could not ` +
      `be verified: ${beforeUrl} -> ` +
      `${afterUrl}`,
  };
}

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

        const normalizeValue = (
          value: unknown
        ) =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const ownText =
          normalizeValue(
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
            element.textContent
          );

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
          normalizeValue(
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
            ]
              .filter(Boolean)
              .join(" ")
          );

        const labelDescriptor =
          normalizeValue(
            [
              labelledBy,
              explicitLabel,
              closestLabel,
              previousText,
            ]
              .filter(Boolean)
              .join(" ")
          );

        const nearDescriptor =
          normalizeValue(
            parentText
          ).slice(0, 220);

        const broadDescriptor =
          normalizeValue(
            grandparentText
          ).slice(0, 300);

        const tokens =
          Array.isArray(rawTokens)
            ? rawTokens.map(
                normalizeValue
              )
            : [];

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

async function findRelevantFilterControl(
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
      right.score - left.score
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
      second.score < 12 &&
    best.descriptor !==
      second.descriptor
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


async function visibleRuntimeFilterSurfaceSignatures(
  page: Page
): Promise<string[]> {
  return page
    .evaluate(() => {
      const selectors = [
        '[role="menu"]',
        '[role="listbox"]',
        '[data-state="open"]',
        '[data-radix-menu-content]',
        '[data-radix-popper-content-wrapper]',
        '[class*="popover"]',
        '[class*="Popover"]',
        '[class*="dropdown"]',
        '[class*="Dropdown"]',
        '[class*="drawer"]',
        '[class*="Drawer"]',
        '[class*="sheet"]',
        '[class*="Sheet"]',
      ];

      const elements =
        Array.from(
          document.querySelectorAll<
            HTMLElement
          >(
            selectors.join(",")
          )
        );

      return elements
        .filter((element) => {
          const style =
            window.getComputedStyle(
              element
            );

          const rect =
            element
              .getBoundingClientRect();

          return (
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(style.opacity) !==
              0 &&
            rect.width >= 10 &&
            rect.height >= 10 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top <
              window.innerHeight &&
            rect.left <
              window.innerWidth
          );
        })
        .map((element) => {
          const rect =
            element
              .getBoundingClientRect();

          const text =
            String(
              element.innerText ||
              element.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300);

          return [
            element.getAttribute(
              "role"
            ) || "no-role",
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

async function scoreRuntimeFilterDimension(
  locator: Locator,
  tokens: string[]
): Promise<{
  score: number;
  label: string;
  descriptor: string;
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
          rect.height >= 14 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top <
            window.innerHeight &&
          rect.left <
            window.innerWidth;

        if (!visible) {
          return null;
        }

        const openSurface =
          element.closest(
            [
              '[role="menu"]',
              '[role="listbox"]',
              '[data-state="open"]',
              '[data-radix-menu-content]',
              '[data-radix-popper-content-wrapper]',
              '[class*="popover"]',
              '[class*="Popover"]',
              '[class*="dropdown"]',
              '[class*="Dropdown"]',
              '[class*="drawer"]',
              '[class*="Drawer"]',
              '[class*="sheet"]',
              '[class*="Sheet"]',
            ].join(",")
          );

        if (!openSurface) {
          return null;
        }

        const normalizeValue = (
          value: unknown
        ) =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const label =
          String(
            element.getAttribute(
              "aria-label"
            ) ||
            element.innerText ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        if (!label) {
          return null;
        }

        const normalizedLabel =
          normalizeValue(label);

        const disabled =
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          element.hasAttribute(
            "disabled"
          );

        if (disabled) {
          return null;
        }

        const role =
          element.getAttribute(
            "role"
          ) || "";

        /*
         * Actual selectable values are handled by
         * findSafeRuntimeOption. This pass resolves
         * only a filter category/dimension trigger.
         */
        if (
          role === "option" ||
          role ===
            "menuitemradio" ||
          role ===
            "menuitemcheckbox"
        ) {
          return null;
        }

        const tokens =
          Array.isArray(rawTokens)
            ? rawTokens.map(
                normalizeValue
              )
            : [];

        let score = 0;

        for (const token of tokens) {
          if (!token) {
            continue;
          }

          if (
            normalizedLabel === token
          ) {
            score += 180;
          } else if (
            normalizedLabel.includes(
              token
            )
          ) {
            score += 85;
          }
        }

        if (
          role === "menuitem"
        ) {
          score += 35;
        }

        if (
          element.hasAttribute(
            "aria-haspopup"
          )
        ) {
          score += 50;
        }

        if (
          element.querySelector("svg")
        ) {
          score += 8;
        }

        const descriptor =
          [
            normalizedLabel,
            role,
            element.getAttribute(
              "aria-haspopup"
            ),
            element.getAttribute(
              "aria-expanded"
            ),
            element.getAttribute(
              "data-state"
            ),
          ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 300);

        return {
          score,
          label,
          descriptor,
        };
      },
      tokens
    )
    .catch(() => null);
}

async function findRuntimeFilterDimension(
  page: Page,
  tokens: string[]
): Promise<{
  locator: Locator;
  score: number;
  label: string;
  descriptor: string;
} | null> {
  const selector = [
    '[role="menu"] [role="menuitem"]',
    '[role="menu"] button',
    '[role="menu"] [role="button"]',
    '[data-state="open"] [role="menuitem"]',
    '[data-state="open"] button',
    '[data-radix-menu-content] [role="menuitem"]',
    '[data-radix-menu-content] button',
    '[data-radix-popper-content-wrapper] [role="menuitem"]',
    '[data-radix-popper-content-wrapper] button',
    '[class*="popover"] [role="menuitem"]',
    '[class*="popover"] button',
    '[class*="Popover"] [role="menuitem"]',
    '[class*="Popover"] button',
    '[class*="dropdown"] [role="menuitem"]',
    '[class*="Dropdown"] [role="menuitem"]',
  ].join(", ");

  const entries =
    page.locator(selector);

  const count = Math.min(
    await entries
      .count()
      .catch(() => 0),
    100
  );

  const candidates: Array<{
    locator: Locator;
    score: number;
    label: string;
    descriptor: string;
  }> = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      entries.nth(index);

    const metadata =
      await scoreRuntimeFilterDimension(
        locator,
        tokens
      );

    if (
      !metadata ||
      metadata.score < 100 ||
      isUnsafeFilterOptionLabel(
        metadata.label
      )
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
      right.score - left.score
  );

  const best = candidates[0];
  const second = candidates[1];

  if (!best) {
    return null;
  }

  if (
    second &&
    best.score -
      second.score < 12 &&
    best.descriptor !==
      second.descriptor
  ) {
    return null;
  }

  return best;
}


async function findRuntimeFilterDimensionByExactText(
  page: Page,
  tokens: string[]
): Promise<{
  locator: Locator;
  score: number;
  label: string;
  descriptor: string;
} | null> {
  const normalizedTokens = [
    ...new Set(
      tokens
        .map(normalize)
        .filter(Boolean)
    ),
  ];

  const candidates: Array<{
    locator: Locator;
    score: number;
    label: string;
    descriptor: string;
    key: string;
  }> = [];

  const seenKeys =
    new Set<string>();

  for (
    const token
    of normalizedTokens
  ) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const matches =
      page.getByText(
        new RegExp(
          `^\\s*${escaped}\\s*$`,
          "i"
        )
      );

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
      const textLocator =
        matches.nth(index);

      const visible =
        await textLocator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (!visible) {
        continue;
      }

      const insideNavigation =
        await textLocator
          .locator(
            "xpath=ancestor::aside[1] | " +
            "ancestor::nav[1]"
          )
          .count()
          .catch(() => 0);

      if (insideNavigation > 0) {
        continue;
      }

      const label =
        String(
          await textLocator
            .innerText()
            .catch(
              async () =>
                await textLocator
                  .textContent()
                  .catch(() => "")
            )
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !label ||
        normalize(label) !== token ||
        isUnsafeFilterOptionLabel(
          label
        )
      ) {
        continue;
      }

      const semanticAncestor =
        textLocator.locator(
          [
            "xpath=",
            "ancestor-or-self::*[",
            "self::button or ",
            "self::a or ",
            '@role="menuitem" or ',
            '@role="button" or ',
            "@aria-haspopup or ",
            "@tabindex",
            "][1]",
          ].join("")
        );

      const semanticCount =
        await semanticAncestor
          .count()
          .catch(() => 0);

      let clickTarget =
        textLocator;

      let score = 120;

      let descriptor =
        `exact visible text "${label}"`;

      if (semanticCount > 0) {
        const promoted =
          semanticAncestor.first();

        const promotedVisible =
          await promoted
            .isVisible({
              timeout: 400,
            })
            .catch(() => false);

        if (promotedVisible) {
          clickTarget = promoted;
          score += 55;

          const role =
            await promoted
              .getAttribute("role")
              .catch(() => null);

          const hasPopup =
            await promoted
              .getAttribute(
                "aria-haspopup"
              )
              .catch(() => null);

          const tag =
            await promoted
              .getAttribute(
                "data-slot"
              )
              .catch(() => null);

          descriptor =
            [
              descriptor,
              `promoted role=${
                role ?? "none"
              }`,
              `aria-haspopup=${
                hasPopup ?? "none"
              }`,
              `data-slot=${
                tag ?? "none"
              }`,
            ].join(" | ");
        }
      }

      const box =
        await clickTarget
          .boundingBox()
          .catch(() => null);

      if (!box) {
        continue;
      }

      const key = [
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
        normalize(label),
      ].join(":");

      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);

      candidates.push({
        locator: clickTarget,
        score,
        label,
        descriptor,
        key,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  if (!best) {
    return null;
  }

  if (
    second &&
    best.score -
      second.score < 15 &&
    best.key !== second.key
  ) {
    return null;
  }

  return {
    locator: best.locator,
    score: best.score,
    label: best.label,
    descriptor:
      best.descriptor,
  };
}

async function openRuntimeFilterDimension(
  page: Page,
  tokens: string[],
  queryKey: string
): Promise<RuntimeFilterInteractionResult> {
  let candidate =
    await findRuntimeFilterDimension(
      page,
      tokens
    );

  let usedExactTextFallback =
    false;

  if (!candidate) {
    candidate =
      await findRuntimeFilterDimensionByExactText(
        page,
        tokens
      );

    usedExactTextFallback =
      Boolean(candidate);
  }

  if (!candidate) {
    return {
      ok: false,
      note:
        `runtime filter discovery could not ` +
        `resolve a unique category entry for ` +
        `query key "${queryKey}" using either ` +
        `semantic controls or one unique exact ` +
        `visible text candidate`,
    };
  }

  const before =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const clicked =
    await clickVisible(
      candidate.locator
    );

  if (!clicked) {
    return {
      ok: false,
      note:
        `runtime filter category ` +
        `"${candidate.label}" for query key ` +
        `"${queryKey}" was not safely clickable`,
    };
  }

  await page.waitForTimeout(600);

  const expanded =
    await candidate.locator
      .getAttribute(
        "aria-expanded"
      )
      .catch(() => null);

  const state =
    await candidate.locator
      .getAttribute(
        "data-state"
      )
      .catch(() => null);

  const after =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const surfaceChanged =
    after.some(
      (signature) =>
        !before.includes(signature)
    ) ||
    before.some(
      (signature) =>
        !after.includes(signature)
    );

  const opened =
    expanded === "true" ||
    state === "open" ||
    surfaceChanged;

  if (
    !opened &&
    usedExactTextFallback
  ) {
    return {
      ok: true,
      note:
        `clicked unique exact visible runtime ` +
        `filter category "${candidate.label}" for ` +
        `query key "${queryKey}"; the category did ` +
        `not expose semantic open-state metadata, ` +
        `so downstream safe-option discovery and ` +
        `the exact URL query transition remain ` +
        `required`,
    };
  }

  if (!opened) {
    return {
      ok: false,
      note:
        `clicked runtime filter category ` +
        `"${candidate.label}", but no submenu, ` +
        `listbox or replacement surface could ` +
        `be verified`,
    };
  }

  return {
    ok: true,
    note:
      `opened and verified runtime filter ` +
      `category "${candidate.label}" for ` +
      `query key "${queryKey}"`,
  };
}



async function promoteRuntimeFilterPlaceholderTarget(
  rawLocator: Locator
): Promise<{
  locator: Locator;
  scoreBonus: number;
  strategy: string;
} | null> {
  const semanticAncestor =
    rawLocator.locator(
      [
        "xpath=",
        "ancestor-or-self::*[",
        "self::select or ",
        "self::input or ",
        "self::button or ",
        "self::a or ",
        '@role="combobox" or ',
        '@role="button" or ',
        '@role="menuitem" or ',
        "@aria-haspopup or ",
        "@tabindex",
        "][1]",
      ].join("")
    );

  const semanticCount =
    await semanticAncestor
      .count()
      .catch(() => 0);

  if (semanticCount > 0) {
    const candidate =
      semanticAncestor.first();

    const visible =
      await candidate
        .isVisible({
          timeout: 400,
        })
        .catch(() => false);

    const box =
      visible
        ? await candidate
            .boundingBox()
            .catch(() => null)
        : null;

    if (
      visible &&
      box &&
      box.width >= 20 &&
      box.height >= 16
    ) {
      return {
        locator: candidate,
        scoreBonus: 45,
        strategy:
          "semantic ancestor",
      };
    }
  }

  /*
   * Some React select components render the visible
   * placeholder as a span inside an unlabelled div.
   * The parent is still a safe control when it:
   * - is a close ancestor of the exact placeholder;
   * - is visible and bounded like an input/control;
   * - exposes pointer/trigger styling or metadata;
   * - is outside navigation.
   */
  let ancestor =
    rawLocator;

  for (
    let depth = 1;
    depth <= 6;
    depth += 1
  ) {
    ancestor =
      ancestor.locator(
        "xpath=.."
      );

    const exists =
      await ancestor
        .count()
        .catch(() => 0);

    if (exists === 0) {
      break;
    }

    const metadata =
      await ancestor
        .evaluate(
          (element) => {
            if (
              !(
                element instanceof
                HTMLElement
              )
            ) {
              return null;
            }

            if (
              element.matches(
                "html, body"
              ) ||
              element.closest(
                "aside, nav"
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
              style.display !== "none" &&
              style.visibility !==
                "hidden" &&
              Number(style.opacity) !==
                0 &&
              style.pointerEvents !==
                "none" &&
              rect.width >= 40 &&
              rect.height >= 20 &&
              rect.width <= 900 &&
              rect.height <= 180 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top <
                window.innerHeight &&
              rect.left <
                window.innerWidth;

            if (!visible) {
              return null;
            }

            const tag =
              element.tagName
                .toLowerCase();

            const role =
              element.getAttribute(
                "role"
              ) || "";

            const className =
              typeof element.className ===
              "string"
                ? element.className
                    .toLowerCase()
                : "";

            const tabIndexValue =
              element.getAttribute(
                "tabindex"
              );

            const semantic =
              [
                "button",
                "a",
                "input",
                "select",
              ].includes(tag) ||
              [
                "button",
                "combobox",
                "menuitem",
              ].includes(role) ||
              element.hasAttribute(
                "aria-haspopup"
              ) ||
              (
                tabIndexValue !== null &&
                Number(tabIndexValue) >= 0
              );

            const explicitTriggerMetadata =
              element.hasAttribute(
                "data-state"
              ) ||
              element.hasAttribute(
                "data-slot"
              ) ||
              element.hasAttribute(
                "data-radix-collection-item"
              ) ||
              element.hasAttribute(
                "onclick"
              );

            const placeholderLikeClass =
              /placeholder|selection-item|selected-value|value-container|label|display-text/
                .test(className);

            const controlLikeClass =
              !placeholderLikeClass &&
              /(^|[\\s_-])(select|selector|combobox|dropdown|trigger|input|control)([\\s_-]|$)/
                .test(className);

            const pointerTrigger =
              style.cursor ===
                "pointer";

            const visualTrigger =
              pointerTrigger ||
              explicitTriggerMetadata ||
              controlLikeClass;

            /*
             * Visible placeholder/value spans may include
             * "select" in their class name while still being
             * only text nodes inside the real control.
             */
            if (
              !semantic &&
              style.cursor ===
                "text"
            ) {
              return null;
            }

            if (
              !semantic &&
              tag === "span" &&
              !pointerTrigger &&
              !explicitTriggerMetadata
            ) {
              return null;
            }

            if (
              !semantic &&
              !visualTrigger
            ) {
              return null;
            }

            const text =
              String(
                element.innerText ||
                element.textContent ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 240);

            return {
              tag,
              role,
              cursor:
                style.cursor,
              text,
              className:
                className.slice(
                  0,
                  300
                ),
            };
          }
        )
        .catch(() => null);

    if (!metadata) {
      continue;
    }

    const visible =
      await ancestor
        .isVisible({
          timeout: 400,
        })
        .catch(() => false);

    if (!visible) {
      continue;
    }

    return {
      locator: ancestor,
      scoreBonus:
        Math.max(
          15,
          42 - depth * 4
        ),
      strategy:
        `visual ancestor depth=${depth} ` +
        `tag=${metadata.tag} ` +
        `role=${
          metadata.role || "none"
        } ` +
        `cursor=${metadata.cursor}`,
    };
  }

  return null;
}

async function findRuntimeFilterControlByPlaceholder(
  page: Page,
  tokens: string[]
): Promise<FilterControlCandidate | null> {
  const normalizedTokens = [
    ...new Set(
      tokens
        .map(normalize)
        .filter(Boolean)
    ),
  ];

  const sources: Array<{
    locator: Locator;
    baseScore: number;
    source: string;
  }> = [];

  for (
    const token
    of normalizedTokens
  ) {
    const escaped =
      token.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const tokenRegex =
      new RegExp(
        escaped,
        "i"
      );

    const placeholderRegex =
      new RegExp(
        `^\\s*(?:select|choose|search)` +
        `\\s+(?:a\\s+|an\\s+|the\\s+)?` +
        `${escaped}\\s*$`,
        "i"
      );

    sources.push(
      {
        locator:
          page.getByPlaceholder(
            tokenRegex
          ),
        baseScore: 230,
        source:
          `placeholder contains "${token}"`,
      },
      {
        locator:
          page.getByRole(
            "combobox",
            {
              name: tokenRegex,
            }
          ),
        baseScore: 220,
        source:
          `combobox name contains "${token}"`,
      },
      {
        locator:
          page.getByText(
            placeholderRegex
          ),
        baseScore: 180,
        source:
          `visible placeholder text for "${token}"`,
      }
    );
  }

  const candidates:
    Array<
      FilterControlCandidate & {
        key: string;
      }
    > = [];

  const seen =
    new Set<string>();

  for (const source of sources) {
    const count = Math.min(
      await source.locator
        .count()
        .catch(() => 0),
      30
    );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const rawLocator =
        source.locator.nth(index);

      const visible =
        await rawLocator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (!visible) {
        continue;
      }

      const navigationAncestorCount =
        await rawLocator
          .locator(
            "xpath=ancestor::aside[1] | " +
            "ancestor::nav[1]"
          )
          .count()
          .catch(() => 0);

      if (
        navigationAncestorCount > 0
      ) {
        continue;
      }

      let clickTarget =
        rawLocator;

      let score =
        source.baseScore;

      let promotionStrategy =
        "raw placeholder element";

      const promotedTarget =
        await promoteRuntimeFilterPlaceholderTarget(
          rawLocator
        );

      if (promotedTarget) {
        clickTarget =
          promotedTarget.locator;

        score +=
          promotedTarget.scoreBonus;

        promotionStrategy =
          promotedTarget.strategy;
      }

      const box =
        await clickTarget
          .boundingBox()
          .catch(() => null);

      if (!box) {
        continue;
      }

      const currentText =
        String(
          await clickTarget
            .getAttribute(
              "placeholder"
            )
            .catch(() => null) ||
          await clickTarget
            .getAttribute(
              "aria-label"
            )
            .catch(() => null) ||
          await clickTarget
            .innerText()
            .catch(() => "") ||
          await clickTarget
            .textContent()
            .catch(() => "") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

      if (
        !currentText ||
        isUnsafeFilterOptionLabel(
          currentText
        ) &&
        !/^(select|choose|search)\b/i
          .test(currentText)
      ) {
        continue;
      }

      const key = [
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
      ].join(":");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const nativeSelect =
        await clickTarget
          .evaluate(
            (element) =>
              element.tagName
                .toLowerCase() ===
              "select"
          )
          .catch(() => false);

      const role =
        await clickTarget
          .getAttribute("role")
          .catch(() => null);

      const tagName =
        await clickTarget
          .evaluate(
            (element) =>
              element.tagName
                .toLowerCase()
          )
          .catch(() => "unknown");

      candidates.push({
        locator:
          clickTarget,

        score,

        descriptor:
          [
            source.source,
            `tag=${tagName}`,
            `role=${
              role ?? "none"
            }`,
            `text=${currentText}`,
            `promotion=${promotionStrategy}`,
          ].join(" | "),

        currentText,

        nativeSelect,

        key,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score
  );

  const best =
    candidates[0];

  const second =
    candidates[1];

  if (!best) {
    return null;
  }

  if (
    second &&
    best.score -
      second.score < 12 &&
    best.key !== second.key
  ) {
    return null;
  }

  return {
    locator:
      best.locator,

    score:
      best.score,

    descriptor:
      best.descriptor,

    currentText:
      best.currentText,

    nativeSelect:
      best.nativeSelect,
  };
}

async function selectNativeOption(
  page: Page,
  control: Locator,
  queryKey: string
): Promise<RuntimeFilterInteractionResult> {
  const options = await control
    .locator("option")
    .evaluateAll(
      (elements) =>
        elements.map(
          (element) => {
            const option =
              element as
                HTMLOptionElement;

            return {
              label:
                String(
                  option.label ||
                  option.textContent ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim(),
              value:
                String(
                  option.value || ""
                ),
              selected:
                option.selected,
              disabled:
                option.disabled,
            };
          }
        )
    )
    .catch(() => []);

  const target = options.find(
    (option) =>
      !option.selected &&
      !option.disabled &&
      option.value.length > 0 &&
      !isUnsafeFilterOptionLabel(
        option.label
      )
  );

  if (!target) {
    return {
      ok: false,
      note:
        `runtime filter control for ` +
        `"${queryKey}" exposed no safe ` +
        `unselected native option`,
    };
  }

  const beforeUrl = page.url();

  try {
    await control.selectOption({
      value: target.value,
    });
  } catch {
    return {
      ok: false,
      note:
        `runtime native filter option ` +
        `"${target.label}" for ` +
        `"${queryKey}" was not safely ` +
        `selectable`,
    };
  }

  return verifyQueryTransition(
    page,
    beforeUrl,
    queryKey,
    target.label
  );
}

async function readRuntimeOption(
  locator: Locator,
  currentText: string
): Promise<{
  label: string;
  score: number;
} | null> {
  return locator
    .evaluate(
      (
        element,
        rawCurrentText
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
          rect.height >= 14 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top <
            window.innerHeight &&
          rect.left <
            window.innerWidth;

        if (!visible) {
          return null;
        }

        const label =
          String(
            element.getAttribute(
              "aria-label"
            ) ||
            element.innerText ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim();

        if (!label) {
          return null;
        }

        const disabled =
          element.getAttribute(
            "aria-disabled"
          ) === "true" ||
          element.hasAttribute(
            "disabled"
          );

        const selected =
          element.getAttribute(
            "aria-selected"
          ) === "true" ||
          element.getAttribute(
            "aria-checked"
          ) === "true" ||
          element.getAttribute(
            "data-state"
          ) === "checked" ||
          element.getAttribute(
            "data-state"
          ) === "selected";

        if (
          disabled ||
          selected
        ) {
          return null;
        }

        const normalizeValue = (
          value: unknown
        ) =>
          String(value ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        if (
          normalizeValue(label) ===
          normalizeValue(
            rawCurrentText
          )
        ) {
          return null;
        }

        const role =
          element.getAttribute(
            "role"
          );

        const insideOpenSurface =
          Boolean(
            element.closest(
              [
                '[role="listbox"]',
                '[role="menu"]',
                '[data-state="open"]',
                '[data-radix-menu-content]',
                '[data-radix-popper-content-wrapper]',
                '[class*="popover"]',
                '[class*="Popover"]',
                '[class*="dropdown"]',
                '[class*="Dropdown"]',
              ].join(",")
            )
          );

        if (!insideOpenSurface) {
          return null;
        }

        let score = 20;

        if (role === "option") {
          score += 80;
        }

        if (
          role ===
            "menuitemradio" ||
          role ===
            "menuitemcheckbox"
        ) {
          score += 55;
        }

        if (
          element.hasAttribute(
            "data-radix-collection-item"
          )
        ) {
          score += 20;
        }

        if (
          element.hasAttribute(
            "data-combobox-option"
          )
        ) {
          score += 75;
        }

        if (
          element.hasAttribute(
            "data-option"
          ) ||
          element.hasAttribute(
            "data-select-option"
          )
        ) {
          score += 60;
        }

        const className =
          typeof element.className ===
          "string"
            ? element.className
                .toLowerCase()
            : "";

        if (
          /select-item-option-selected|select__option--is-selected|(^|\s)is-selected(\s|$)/
            .test(className) ||
          /select-item-option-disabled|select__option--is-disabled|(^|\s)is-disabled(\s|$)/
            .test(className)
        ) {
          return null;
        }

        if (
          /combobox-option|select-option|select-item-option|select__option|dropdown-item/
            .test(className)
        ) {
          score += 70;
        }

        return {
          label,
          score,
        };
      },
      currentText
    )
    .catch(() => null);
}

async function findSafeRuntimeOption(
  page: Page,
  currentText: string,
  forbiddenExactLabels: string[] = []
): Promise<RuntimeOptionCandidate | null> {
  const options = page.locator(
    [
      '[role="option"]',
      '[role="menuitemradio"]',
      '[role="menuitemcheckbox"]',
      '[data-radix-collection-item]',
      '[data-combobox-option]',
      '[data-option]',
      '[data-select-option]',
      '[class*="Combobox-option"]',
      '[class*="combobox-option"]',
      '[class*="Select-option"]',
      '[class*="select-option"]',
      '[class*="select-item-option"]:not([class*="content"])',
      '[class*="Select-item-option"]:not([class*="content"])',
      '[class*="select__option"]',
      '[class*="Select__option"]',
      '[class*="dropdown-item"]',
      '[class*="Dropdown-item"]',
    ].join(", ")
  );

  const count = Math.min(
    await options
      .count()
      .catch(() => 0),
    100
  );

  const candidates:
    RuntimeOptionCandidate[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      options.nth(index);

    const hasPopup =
      await locator
        .getAttribute(
          "aria-haspopup"
        )
        .catch(() => null);

    if (hasPopup) {
      continue;
    }

    const metadata =
      await readRuntimeOption(
        locator,
        currentText
      );

    const normalizedLabel =
      normalize(
        metadata?.label
      );

    const isForbiddenDimensionLabel =
      forbiddenExactLabels.some(
        (label) =>
          normalize(label) ===
          normalizedLabel
      );

    if (
      !metadata ||
      isForbiddenDimensionLabel ||
      isUnsafeFilterOptionLabel(
        metadata.label
      )
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
      right.score - left.score
  );

  const best =
    candidates[0];

  if (best) {
    return best;
  }

  /*
   * Ant Design and similarly structured selects may
   * expose clickable option rows without ARIA roles.
   * Restrict this fallback to visible option rows
   * inside an open select dropdown.
   */
  const structuredOptions =
    page.locator(
      [
        ".ant-select-dropdown:not(" +
          ".ant-select-dropdown-hidden) " +
          ".ant-select-item-option",
        '[class*="select-dropdown"]' +
          ':not([class*="hidden"]) ' +
          '[class*="select-item-option"]' +
          ':not([class*="option-content"])',
      ].join(", ")
    );

  const structuredCount =
    Math.min(
      await structuredOptions
        .count()
        .catch(() => 0),
      100
    );

  for (
    let index = 0;
    index < structuredCount;
    index += 1
  ) {
    const locator =
      structuredOptions.nth(index);

    const metadata =
      await locator
        .evaluate((element) => {
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
            style.display !== "none" &&
            style.visibility !==
              "hidden" &&
            Number(style.opacity) !==
              0 &&
            style.pointerEvents !==
              "none" &&
            rect.width >= 20 &&
            rect.height >= 14 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top <
              window.innerHeight &&
            rect.left <
              window.innerWidth;

          if (!visible) {
            return null;
          }

          const className =
            typeof element.className ===
              "string"
              ? element.className
                  .toLowerCase()
              : "";

          const disabled =
            element.getAttribute(
              "aria-disabled"
            ) === "true" ||
            element.hasAttribute(
              "disabled"
            ) ||
            /option-disabled|is-disabled/
              .test(className);

          const selected =
            element.getAttribute(
              "aria-selected"
            ) === "true" ||
            element.getAttribute(
              "aria-checked"
            ) === "true" ||
            /option-selected|is-selected/
              .test(className);

          if (
            disabled ||
            selected
          ) {
            return null;
          }

          const label =
            String(
              element.getAttribute(
                "aria-label"
              ) ||
              element.innerText ||
              element.textContent ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim();

          if (!label) {
            return null;
          }

          return {
            label,
            score: 115,
          };
        })
        .catch(() => null);

    if (!metadata) {
      continue;
    }

    const normalizedLabel =
      normalize(metadata.label);

    const forbidden =
      forbiddenExactLabels.some(
        (label) =>
          normalize(label) ===
          normalizedLabel
      );

    if (
      forbidden ||
      normalize(currentText) ===
        normalizedLabel ||
      isUnsafeFilterOptionLabel(
        metadata.label
      )
    ) {
      continue;
    }

    console.log(
      ` Runtime filter option discovery ` +
        `resolved structured option ` +
        `"${metadata.label}"`
    );

    return {
      locator,
      label: metadata.label,
      score: metadata.score,
    };
  }

  /*
   * Diagnostic fallback: report the live DOM shape
   * of visible option-like descendants when the
   * semantic resolver finds no candidate.
   */
  const diagnostics =
    await page
      .locator(
        [
          '[role="listbox"]',
          '[role="menu"]',
          '[data-state="open"]',
          '[data-radix-menu-content]',
          '[data-radix-popper-content-wrapper]',
          '[class*="dropdown"]',
          '[class*="Dropdown"]',
          '[class*="popover"]',
          '[class*="Popover"]',
        ].join(", ")
      )
      .evaluateAll(
        (surfaces) => {
          const rows: string[] = [];
          const seen =
            new Set<string>();

          for (const surface of surfaces) {
            if (
              !(
                surface instanceof
                HTMLElement
              )
            ) {
              continue;
            }

            const elements =
              surface.querySelectorAll<
                HTMLElement
              >(
                "div,li,span,button"
              );

            for (const element of elements) {
              const style =
                window.getComputedStyle(
                  element
                );

              const rect =
                element
                  .getBoundingClientRect();

              const text =
                String(
                  element.innerText ||
                  element.textContent ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim();

              const className =
                typeof element.className ===
                "string"
                  ? element.className
                  : "";

              const role =
                element.getAttribute(
                  "role"
                ) || "none";

              const visible =
                style.display !== "none" &&
                style.visibility !==
                  "hidden" &&
                Number(style.opacity) !==
                  0 &&
                rect.width >= 20 &&
                rect.height >= 14 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top <
                  window.innerHeight &&
                rect.left <
                  window.innerWidth;

              const candidateLike =
                style.cursor ===
                  "pointer" ||
                role !== "none" ||
                /option|item|select|menu|virtual|dropdown/i
                  .test(className);

              if (
                !visible ||
                !candidateLike ||
                !text ||
                text.length > 120
              ) {
                continue;
              }

              const key = [
                Math.round(rect.x),
                Math.round(rect.y),
                Math.round(rect.width),
                Math.round(rect.height),
                text,
              ].join(":");

              if (seen.has(key)) {
                continue;
              }

              seen.add(key);

              rows.push(
                [
                  `tag=${
                    element.tagName
                      .toLowerCase()
                  }`,
                  `role=${role}`,
                  `cursor=${style.cursor}`,
                  `class=${
                    className
                      .replace(/\s+/g, ".")
                      .slice(0, 180)
                  }`,
                  `text=${
                    text.slice(0, 100)
                  }`,
                ].join("|")
              );

              if (rows.length >= 40) {
                return rows;
              }
            }
          }

          return rows;
        }
      )
      .catch(() => []);

  console.log(
    ` Runtime filter option discovery ` +
      `diagnostics: ${
        diagnostics.length > 0
          ? diagnostics.join(" || ")
          : "no visible option-like nodes found"
      }`
  );

  return null;
}


export async function openRuntimeControl(
  page: Page,
  targetValue: string
): Promise<RuntimeFilterInteractionResult> {
  const normalizedTarget =
    normalize(targetValue);

  if (!normalizedTarget) {
    return {
      ok: false,
      note: "runtime control target is empty",
    };
  }

  const semanticTarget =
    normalizedTarget
      .replace(
        /^(?:select|choose|search)\s+(?:a\s+|an\s+|the\s+)?/i,
        ""
      )
      .trim() ||
    normalizedTarget;

  const candidate =
    await findRuntimeFilterControlByPlaceholder(
      page,
      queryKeyTokens(
        semanticTarget,
        normalizedTarget
      )
    );

  if (!candidate) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" could not ` +
        `be uniquely resolved by placeholder, ` +
        `accessible name or visible control text`,
    };
  }

  if (candidate.nativeSelect) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" resolved ` +
        `to a native select whose open state cannot ` +
        `be deterministically verified without ` +
        `selecting a value`,
    };
  }

  const before =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const clicked =
    await clickVisible(candidate.locator);

  if (!clicked) {
    return {
      ok: false,
      note:
        `runtime control "${targetValue}" was ` +
        `resolved but was not safely clickable`,
    };
  }

  await page.waitForTimeout(500);

  const expanded =
    await candidate.locator
      .getAttribute("aria-expanded")
      .catch(() => null);

  const state =
    await candidate.locator
      .getAttribute("data-state")
      .catch(() => null);

  const after =
    await visibleRuntimeFilterSurfaceSignatures(
      page
    );

  const surfaceChanged =
    after.some(
      (signature) =>
        !before.includes(signature)
    ) ||
    before.some(
      (signature) =>
        !after.includes(signature)
    );

  const opened =
    expanded === "true" ||
    state === "open" ||
    surfaceChanged;

  if (!opened) {
    return {
      ok: false,
      note:
        `clicked runtime control "${targetValue}", ` +
        `but no expanded state, listbox, dropdown ` +
        `or replacement surface was verified`,
    };
  }

  return {
    ok: true,
    note:
      `opened and verified runtime control ` +
      `"${targetValue}" using ` +
      `${candidate.descriptor}`,
  };
}


export async function selectRuntimeFilterOption(
  page: Page,
  queryKeyValue: string,
  hint?: string
): Promise<RuntimeFilterInteractionResult> {
  const queryKey =
    normalizeQueryKey(
      queryKeyValue
    );

  if (
    !/^[A-Za-z][A-Za-z0-9_.-]*$/
      .test(queryKey)
  ) {
    return {
      ok: false,
      note:
        `runtime filter query key ` +
        `"${queryKey || "(empty)"}" ` +
        `is invalid`,
    };
  }

  const tokens =
    queryKeyTokens(
      queryKey,
      hint
    );

  let controlDiscovery =
    await findRelevantFilterControl(
      page,
      tokens
    );

  let candidate =
    controlDiscovery.candidate;

  let ambiguity =
    controlDiscovery.ambiguity;

  /*
   * Some filter UIs expose a first-level menu with
   * category entries such as Project, Status or Type.
   * The actual combobox/listbox/options appear only
   * after that dimension entry is opened.
   */
  if (!candidate) {
    const dimensionResult =
      await openRuntimeFilterDimension(
        page,
        tokens,
        queryKey
      );

    if (!dimensionResult.ok) {
      return {
        ok: false,
        note:
          `runtime filter discovery could not ` +
          `resolve a unique control for query ` +
          `key "${queryKey}": ${ambiguity}; ` +
          `${dimensionResult.note}`,
      };
    }

    console.log(
      ` Runtime filter interaction: ` +
        `${dimensionResult.note}`
    );

    await page.waitForTimeout(400);

    controlDiscovery =
      await findRelevantFilterControl(
        page,
        tokens
      );

    candidate =
      controlDiscovery.candidate;

    ambiguity =
      controlDiscovery.ambiguity;

    if (!candidate) {
      candidate =
        await findRuntimeFilterControlByPlaceholder(
          page,
          tokens
        );

      if (candidate) {
        ambiguity = "";

        console.log(
          ` Runtime filter interaction: ` +
            `resolved related filter control ` +
            `from placeholder semantics: ` +
            `${candidate.descriptor}`
        );
      }
    }

    /*
     * A submenu may expose the real selectable
     * values directly rather than adding another
     * combobox control.
     */
    if (!candidate) {
      const directOption =
        await findSafeRuntimeOption(
          page,
          "",
          tokens
        );

      if (!directOption) {
        return {
          ok: false,
          note:
            `runtime filter category for query ` +
            `key "${queryKey}" opened, but no ` +
            `safe unselected option or related ` +
            `control could be resolved: ` +
            `${ambiguity}`,
        };
      }

      const beforeUrl =
        page.url();

      const selected =
        await clickVisible(
          directOption.locator
        );

      if (!selected) {
        return {
          ok: false,
          note:
            `runtime filter option ` +
            `"${directOption.label}" for query ` +
            `key "${queryKey}" was not safely ` +
            `clickable`,
        };
      }

      return verifyQueryTransition(
        page,
        beforeUrl,
        queryKey,
        directOption.label
      );
    }
  }

  if (candidate.nativeSelect) {
    return selectNativeOption(
      page,
      candidate.locator,
      queryKey
    );
  }

  const opened =
    await clickVisible(
      candidate.locator
    );

  if (!opened) {
    return {
      ok: false,
      note:
        `runtime filter control for query ` +
        `key "${queryKey}" was discovered ` +
        `but was not safely clickable`,
    };
  }

  await page.waitForTimeout(500);

  const option =
    await findSafeRuntimeOption(
      page,
      candidate.currentText,
      tokens
    );

  if (!option) {
    await page.keyboard
      .press("Escape")
      .catch(() => undefined);

    return {
      ok: false,
      note:
        `runtime filter control for query ` +
        `key "${queryKey}" opened, but no ` +
        `safe unselected option could be ` +
        `resolved`,
    };
  }

  const beforeUrl = page.url();

  const selected =
    await clickVisible(
      option.locator
    );

  if (!selected) {
    return {
      ok: false,
      note:
        `runtime filter option ` +
        `"${option.label}" for query key ` +
        `"${queryKey}" was not safely ` +
        `clickable`,
    };
  }

  return verifyQueryTransition(
    page,
    beforeUrl,
    queryKey,
    option.label
  );
}
