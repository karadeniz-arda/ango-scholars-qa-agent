import type {
  Locator,
  Page,
} from "playwright";

import {
  isConsequenceRiskBrowserControlLabel,
} from "./browser-feature-surface-resolver.js";
import {
  BROWSER_SEMANTIC_CONTEXT_MAX_DEPTH,
  findBrowserSemanticContextDepth,
} from "./browser-semantic-context.js";

export type ExpandedSurfaceVerificationSource =
  | "role-dialog"
  | "role-alertdialog"
  | "aria-modal"
  | "data-state"
  | "semantic-class"
  | "aria-expanded";

export type ExpandedSurfaceSnapshot = {
  fingerprint: string;
  role: string | null;
  type:
    | "dialog"
    | "alertdialog"
    | "modal"
    | "drawer"
    | "sheet"
    | "expanded-control";
  name: string | null;
  source:
    ExpandedSurfaceVerificationSource;
};

export type ExpandedTriggerState = {
  ariaExpanded: string | null;
  dataState: string | null;
};

export type ExpandedSurfaceCandidate = {
  index: number;
  contextDepth: number | null;
};

export type ExpandedSurfaceCandidateResolution = {
  selectedIndex?: number;
  note: string;
};

export type ReadOnlyContextualControlResolution = {
  locator?: Locator;
  note: string;
};

export type ReadOnlyExpandedSurfaceResult = {
  ok: boolean;
  interactionSucceeded: boolean;
  expandedSurfaceVerified: boolean;
  triggerName: string;
  contextText?: string;
  surface?: ExpandedSurfaceSnapshot;
  note: string;
};

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveExpandedSurfaceCandidate(
  candidates:
    ExpandedSurfaceCandidate[],
  contextText?: string
): ExpandedSurfaceCandidateResolution {
  if (candidates.length === 0) {
    return {
      note:
        "no visible enabled exact read-only trigger was observed",
    };
  }

  const context = normalize(contextText);

  if (!context) {
    if (candidates.length !== 1) {
      return {
        note:
          `${candidates.length} exact read-only triggers were ambiguous; ` +
          "no DOM-order fallback was used",
      };
    }

    return {
      selectedIndex:
        candidates[0]!.index,
      note:
        "selected the unique visible enabled exact read-only trigger",
    };
  }

  const contextual =
    candidates.filter(
      (candidate) =>
        candidate.contextDepth !== null
    );

  if (contextual.length === 0) {
    return {
      note:
        `no exact trigger had nearby context matching "${contextText}"`,
    };
  }

  const minimumDepth = Math.min(
    ...contextual.map(
      (candidate) =>
        candidate.contextDepth as number
    )
  );
  const best = contextual.filter(
    (candidate) =>
      candidate.contextDepth ===
        minimumDepth
  );

  if (best.length !== 1) {
    return {
      note:
        `${best.length} exact triggers shared the nearest ` +
        `"${contextText}" context; no DOM-order fallback was used`,
    };
  }

  return {
    selectedIndex: best[0]!.index,
    note:
      `selected the unique exact trigger nearest to ` +
      `context "${contextText}" at ancestor depth ${minimumDepth}`,
  };
}

function countFingerprints(
  snapshots: ExpandedSurfaceSnapshot[]
): Map<string, number> {
  const counts = new Map<
    string,
    number
  >();

  for (const snapshot of snapshots) {
    counts.set(
      snapshot.fingerprint,
      (counts.get(
        snapshot.fingerprint
      ) ?? 0) + 1
    );
  }

  return counts;
}

function surfaceStrength(
  surface: ExpandedSurfaceSnapshot
): number {
  if (
    surface.source === "role-dialog" ||
    surface.source ===
      "role-alertdialog"
  ) {
    return 5;
  }

  if (surface.source === "aria-modal") {
    return 4;
  }

  if (surface.source === "data-state") {
    return 3;
  }

  return 2;
}

export function verifyExpandedSurfaceDelta(
  before: ExpandedSurfaceSnapshot[],
  after: ExpandedSurfaceSnapshot[],
  beforeTrigger:
    ExpandedTriggerState,
  afterTrigger:
    ExpandedTriggerState
): {
  verified: boolean;
  surface?: ExpandedSurfaceSnapshot;
  source?: ExpandedSurfaceVerificationSource;
} {
  const beforeCounts =
    countFingerprints(before);
  const afterSeen = new Map<
    string,
    number
  >();
  const newlyObserved:
    ExpandedSurfaceSnapshot[] = [];

  for (const surface of after) {
    const seen =
      (afterSeen.get(
        surface.fingerprint
      ) ?? 0) + 1;
    afterSeen.set(
      surface.fingerprint,
      seen
    );

    if (
      seen >
      (beforeCounts.get(
        surface.fingerprint
      ) ?? 0)
    ) {
      newlyObserved.push(surface);
    }
  }

  newlyObserved.sort(
    (left, right) =>
      surfaceStrength(right) -
        surfaceStrength(left) ||
      left.fingerprint.localeCompare(
        right.fingerprint
      )
  );

  if (newlyObserved[0]) {
    return {
      verified: true,
      surface: newlyObserved[0],
      source: newlyObserved[0].source,
    };
  }

  if (
    normalize(
      beforeTrigger.ariaExpanded
    ) === "false" &&
    normalize(
      afterTrigger.ariaExpanded
    ) === "true"
  ) {
    return {
      verified: true,
      source: "aria-expanded",
      surface: {
        fingerprint:
          "trigger:aria-expanded",
        role: null,
        type: "expanded-control",
        name: null,
        source: "aria-expanded",
      },
    };
  }

  if (
    normalize(beforeTrigger.dataState) !==
      "open" &&
    normalize(afterTrigger.dataState) ===
      "open"
  ) {
    return {
      verified: true,
      source: "data-state",
      surface: {
        fingerprint:
          "trigger:data-state=open",
        role: null,
        type: "expanded-control",
        name: null,
        source: "data-state",
      },
    };
  }

  return { verified: false };
}

async function captureExpandedSurfaces(
  page: Page
): Promise<ExpandedSurfaceSnapshot[]> {
  return page.evaluate(() => {
    const selector = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '[data-state="open"]',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="drawer"]',
      '[class*="Drawer"]',
      '[class*="sheet"]',
      '[class*="Sheet"]',
    ].join(",");

    return Array.from(
      document.querySelectorAll<HTMLElement>(
        selector
      )
    )
      .filter((element) => {
        const rect =
          element.getBoundingClientRect();
        const style =
          window.getComputedStyle(element);

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width >= 40 &&
          rect.height >= 40
        );
      })
      .map((element) => {
        const role = String(
          element.getAttribute("role") || ""
        )
          .trim()
          .toLowerCase();
        const className = String(
          element.className || ""
        );
        const classTokens = className
          .split(/\s+/)
          .filter(Boolean);
        const hasDrawerClass =
          classTokens.some((token) =>
            /(?:^|[-_])drawer(?:$|[-_])/i
              .test(token)
          );
        const hasSheetClass =
          classTokens.some((token) =>
            /(?:^|[-_])sheet(?:$|[-_])/i
              .test(token)
          );
        const hasModalClass =
          classTokens.some((token) =>
            /(?:^|[-_])modal(?:$|[-_])/i
              .test(token)
          );
        const ariaModal =
          element.getAttribute("aria-modal") ===
          "true";
        const dataState = String(
          element.getAttribute("data-state") || ""
        )
          .trim()
          .toLowerCase();

        let source:
          | "role-dialog"
          | "role-alertdialog"
          | "aria-modal"
          | "data-state"
          | "semantic-class";

        if (role === "dialog") {
          source = "role-dialog";
        } else if (
          role === "alertdialog"
        ) {
          source = "role-alertdialog";
        } else if (ariaModal) {
          source = "aria-modal";
        } else if (dataState === "open") {
          source = "data-state";
        } else {
          source = "semantic-class";
        }

        let type:
          | "dialog"
          | "alertdialog"
          | "modal"
          | "drawer"
          | "sheet";

        if (role === "alertdialog") {
          type = "alertdialog";
        } else if (hasDrawerClass) {
          type = "drawer";
        } else if (hasSheetClass) {
          type = "sheet";
        } else if (
          role === "dialog"
        ) {
          type = "dialog";
        } else {
          type = "modal";
        }

        const labelledBy =
          element.getAttribute(
            "aria-labelledby"
          );
        const labelledByText = labelledBy
          ? String(
              document.getElementById(
                labelledBy
              )?.textContent || ""
            )
          : "";
        const headingText = String(
          element.querySelector<HTMLElement>(
            "h1,h2,h3,h4,h5,h6,[role='heading'],.ant-modal-title"
          )?.innerText || ""
        );
        const name = String(
          element.getAttribute("aria-label") ||
            labelledByText ||
            headingText ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        const fingerprint = [
          source,
          role,
          type,
          name.toLowerCase(),
          classTokens
            .filter((token) =>
              /modal|drawer|sheet/i.test(token)
            )
            .sort()
            .join("."),
        ].join("|");

        return {
          fingerprint,
          role: role || null,
          type,
          name: name || null,
          source,
        };
      });
  });
}

async function captureTriggerState(
  locator: Locator
): Promise<ExpandedTriggerState> {
  return locator
    .evaluate((element) => ({
      ariaExpanded:
        element.getAttribute(
          "aria-expanded"
        ),
      dataState:
        element.getAttribute(
          "data-state"
        ),
    }))
    .catch(() => ({
      ariaExpanded: null,
      dataState: null,
    }));
}

async function collectTriggerCandidates(
  page: Page,
  triggerText: string,
  contextText?: string
): Promise<{
  locator: Locator;
  candidates: ExpandedSurfaceCandidate[];
}> {
  const controls = page.locator(
    "button, a, [role='button'], [role='link']"
  );
  const count = Math.min(
    await controls.count().catch(() => 0),
    200
  );
  const candidates:
    ExpandedSurfaceCandidate[] = [];
  const expected = normalize(triggerText);
  const context = normalize(contextText);

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const candidate = controls.nth(index);
    const metadata = await candidate
      .evaluate(
        (element, values) => {
          const text = String(
            (element as HTMLElement)
              .innerText ||
              element.textContent ||
              ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const ariaLabel = String(
            element.getAttribute(
              "aria-label"
            ) || ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const rect =
            element.getBoundingClientRect();
          const style =
            window.getComputedStyle(element);
          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0;
          const enabled = !element.matches(
            ":disabled,[aria-disabled='true']"
          );
          const contextAncestors:
            string[] = [];
          let current =
            element.parentElement;

          for (
            let depth = 1;
            current &&
            depth <= values.maxDepth;
            depth += 1
          ) {
            contextAncestors.push(
              String(
                (current as HTMLElement)
                  .innerText ||
                  current.textContent ||
                  ""
              )
                .replace(/\s+/g, " ")
                .trim()
            );
            current =
              current.parentElement;
          }

          return {
            exact:
              text === values.expected ||
              ariaLabel === values.expected,
            visible,
            enabled,
            contextAncestors,
          };
        },
        {
          expected,
          maxDepth:
            BROWSER_SEMANTIC_CONTEXT_MAX_DEPTH,
        }
      )
      .catch(() => null);

    if (
      metadata?.exact &&
      metadata.visible &&
      metadata.enabled
    ) {
      candidates.push({
        index,
        contextDepth:
          context
            ? findBrowserSemanticContextDepth(
                metadata
                  .contextAncestors,
                context
              )
            : null,
      });
    }
  }

  return { locator: controls, candidates };
}

export async function resolveReadOnlyContextualControl(
  page: Page,
  options: {
    targetText: string;
    contextText?: string;
  }
): Promise<ReadOnlyContextualControlResolution> {
  const collected =
    await collectTriggerCandidates(
      page,
      options.targetText,
      options.contextText
    );
  const resolution =
    resolveExpandedSurfaceCandidate(
      collected.candidates,
      options.contextText
    );

  if (
    resolution.selectedIndex ===
      undefined
  ) {
    return {
      note: resolution.note,
    };
  }

  return {
    locator: collected.locator.nth(
      resolution.selectedIndex
    ),
    note: resolution.note,
  };
}

export async function openReadOnlyExpandedSurface(
  page: Page,
  options: {
    triggerText: string;
    contextText?: string;
  }
): Promise<ReadOnlyExpandedSurfaceResult> {
  const triggerName =
    options.triggerText.trim();
  const contextText =
    options.contextText?.trim();

  if (
    !triggerName ||
    isConsequenceRiskBrowserControlLabel(
      triggerName
    )
  ) {
    return {
      ok: false,
      interactionSucceeded: false,
      expandedSurfaceVerified: false,
      triggerName,
      ...(contextText
        ? { contextText }
        : {}),
      note:
        `read-only expanded-surface trigger "${triggerName}" ` +
        "was empty or classified as consequence-bearing",
    };
  }

  const before =
    await captureExpandedSurfaces(page);
  const resolution =
    await resolveReadOnlyContextualControl(
      page,
      {
        targetText: triggerName,
        ...(contextText
          ? { contextText }
          : {}),
      }
    );

  if (
    !resolution.locator
  ) {
    return {
      ok: false,
      interactionSucceeded: false,
      expandedSurfaceVerified: false,
      triggerName,
      ...(contextText
        ? { contextText }
        : {}),
      note: resolution.note,
    };
  }

  const trigger = resolution.locator;
  const beforeTrigger =
    await captureTriggerState(trigger);

  try {
    await trigger.scrollIntoViewIfNeeded({
      timeout: 1000,
    });
    await trigger.click({ timeout: 2000 });
  } catch {
    return {
      ok: false,
      interactionSucceeded: false,
      expandedSurfaceVerified: false,
      triggerName,
      ...(contextText
        ? { contextText }
        : {}),
      note:
        `${resolution.note}; the selected trigger was not safely clickable`,
    };
  }

  await page.waitForTimeout(750);

  const after =
    await captureExpandedSurfaces(page);
  const afterTrigger =
    await captureTriggerState(trigger);
  const verification =
    verifyExpandedSurfaceDelta(
      before,
      after,
      beforeTrigger,
      afterTrigger
    );

  if (!verification.verified) {
    return {
      ok: false,
      interactionSucceeded: true,
      expandedSurfaceVerified: false,
      triggerName,
      ...(contextText
        ? { contextText }
        : {}),
      note:
        `${resolution.note}; trigger interaction succeeded, but no new ` +
        "semantic expanded surface or closed-to-open trigger state was observed",
    };
  }

  const surface = verification.surface;
  const description = surface
    ? `${surface.type}` +
      (surface.name
        ? ` "${surface.name}"`
        : "")
    : "expanded surface";

  return {
    ok: true,
    interactionSucceeded: true,
    expandedSurfaceVerified: true,
    triggerName,
    ...(contextText
      ? { contextText }
      : {}),
    ...(surface ? { surface } : {}),
    note:
      `${resolution.note}; trigger interaction succeeded and newly expanded ` +
      `${description} was verified via ${verification.source}`,
  };
}
