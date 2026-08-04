import type {
  Locator,
  Page,
} from "playwright";

import {
  observeBrowserPage,
  type BrowserObservation,
} from "./browser-observation.js";

import type {
  BrowserShadowProposal,
} from "./browser-agent-shadow.js";

import type {
  BrowserShadowProposalEvaluation,
} from "./browser-agent-shadow-evaluator.js";

export type BrowserReadOnlyExecutionStatus =
  | "SKIPPED"
  | "BLOCKED"
  | "EXECUTED"
  | "VERIFICATION_FAILED"
  | "ERROR";

export type BrowserReadOnlyExecutionResult = {
  status: BrowserReadOnlyExecutionStatus;
  note: string;
  executed: boolean;
  stateChanged: boolean;
  beforeObservation?: BrowserObservation;
  afterObservation?: BrowserObservation;
};

export type ExecuteBrowserReadOnlyProposalArgs = {
  page: Page;
  proposal: BrowserShadowProposal;
  evaluation: BrowserShadowProposalEvaluation;
};

const CONSEQUENCE_RISK_LABEL =
  /\b(?:add|apply|approve|archive|checkout|confirm|create|deactivate|delete|disable|enable|invite|log\s*out|pay|publish|reject|remove|save|send|sign\s*out|submit|upload)\b/i;

function readOnlyExecutionEnabled():
  boolean {
  return (
    process.env
      .QA_GENERIC_BROWSER_READONLY_EXECUTION ===
    "true"
  );
}

function normalize(
  value: unknown
): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegExp(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function exactLabelPattern(
  value: string
): RegExp {
  return new RegExp(
    `^\\s*${escapeRegExp(
      value.trim()
    )}\\s*$`,
    "i"
  );
}

function observationFingerprint(
  observation: BrowserObservation
): string {
  return JSON.stringify({
    url: observation.url,
    title: observation.title,
    headings:
      observation.headings,
    controls:
      observation.controls.map(
        (control) => ({
          kind: control.kind,
          label: control.label,
          disabled:
            control.disabled,
          selected:
            control.selected,
          expanded:
            control.expanded,
          checked:
            control.checked,
          href:
            control.href || "",
        })
      ),
    surfaces:
      observation.surfaces.map(
        (surface) => ({
          kind: surface.kind,
          label: surface.label,
          modal: surface.modal,
          textPreview:
            surface.textPreview,
        })
      ),
    visibleText:
      observation.visibleText,
  });
}

function observationsDiffer(
  before: BrowserObservation,
  after: BrowserObservation
): boolean {
  return (
    observationFingerprint(before) !==
    observationFingerprint(after)
  );
}

function buildRoleCandidates(
  page: Page,
  kind: string,
  target: string
): Locator[] {
  const name =
    exactLabelPattern(target);

  if (kind === "button") {
    return [
      page.getByRole(
        "button",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "link") {
    return [
      page.getByRole(
        "link",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "tab") {
    return [
      page.getByRole(
        "tab",
        {
          name,
        }
      ),
    ];
  }

  if (kind === "menuitem") {
    return [
      page.getByRole(
        "menuitem",
        {
          name,
        }
      ),
    ];
  }

  if (
    kind === "option"
  ) {
    return [];
  }

  return [
    page.getByRole(
      "button",
      {
        name,
      }
    ),
    page.getByRole(
      "link",
      {
        name,
      }
    ),
    page.getByRole(
      "tab",
      {
        name,
      }
    ),
    page.getByRole(
      "menuitem",
      {
        name,
      }
    ),
  ];
}

async function collectVisibleCandidates(
  candidates: Locator[]
): Promise<Locator[]> {
  const visible: Locator[] = [];

  for (const candidate of candidates) {
    const count =
      Math.min(
        await candidate
          .count()
          .catch(() => 0),
        10
      );

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const locator =
        candidate.nth(index);

      const isVisible =
        await locator
          .isVisible({
            timeout: 500,
          })
          .catch(() => false);

      if (isVisible) {
        visible.push(locator);
      }
    }
  }

  return visible;
}

function observationAlignedSelector(
  kind: string
): string | null {
  if (kind === "button") {
    return [
      "button",
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="reset"]',
      '[role="button"]',
    ].join(", ");
  }

  if (kind === "link") {
    return 'a[href], [role="link"]';
  }

  if (kind === "tab") {
    return '[role="tab"]';
  }

  if (kind === "menuitem") {
    return '[role="menuitem"]';
  }

  return null;
}

async function collectObservationAlignedCandidates(
  page: Page,
  kind: string,
  target: string
): Promise<Locator[]> {
  const selector =
    observationAlignedSelector(
      kind
    );

  if (!selector) {
    return [];
  }

  const controls =
    page.locator(selector);

  const count =
    Math.min(
      await controls
        .count()
        .catch(() => 0),
      80
    );

  const normalizedTarget =
    normalize(target);

  const matches: Locator[] = [];

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const locator =
      controls.nth(index);

    const descriptor =
      await locator
        .evaluate((element) => {
          const labelledBy =
            String(
              element.getAttribute(
                "aria-labelledby"
              ) || ""
            )
              .replace(/\s+/g, " ")
              .trim();

          const labelledByText =
            labelledBy
              ? labelledBy
                  .split(/\s+/)
                  .map((id) =>
                    document
                      .getElementById(id)
                      ?.textContent ||
                    ""
                  )
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim()
              : "";

          let associatedLabelText = "";

          if (
            element instanceof
              HTMLInputElement ||
            element instanceof
              HTMLTextAreaElement ||
            element instanceof
              HTMLSelectElement
          ) {
            associatedLabelText =
              Array.from(
                element.labels || []
              )
                .map((label) =>
                  label.textContent ||
                  ""
                )
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
          }

          if (!associatedLabelText) {
            associatedLabelText =
              String(
                element
                  .closest("label")
                  ?.textContent ||
                ""
              )
                .replace(/\s+/g, " ")
                .trim();
          }

          const candidates = [
            element.getAttribute(
              "aria-label"
            ),
            labelledByText,
            associatedLabelText,
            element.getAttribute(
              "title"
            ),
            element.getAttribute(
              "data-placeholder"
            ),
            element.getAttribute(
              "placeholder"
            ),
            element instanceof
              HTMLElement
              ? element.innerText
              : "",
            element.textContent,
            element.getAttribute(
              "name"
            ),
            element.getAttribute(
              "id"
            ),
          ];

          const firstCandidate =
            candidates.find(
              (candidate) =>
                String(
                  candidate || ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .length > 0
            ) || "";

          const label =
            String(firstCandidate)
              .replace(/\s+/g, " ")
              .trim();

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
            Number(
              style.opacity || "1"
            ) > 0 &&
            rect.width > 0 &&
            rect.height > 0;

          return {
            label,
            visible,
          };
        })
        .catch(() => null);

    if (
      descriptor?.visible &&
      normalize(
        descriptor.label
      ) === normalizedTarget
    ) {
      matches.push(locator);
    }
  }

  return matches;
}

async function executeExactControlClick(
  page: Page,
  proposal: BrowserShadowProposal,
  evaluation: BrowserShadowProposalEvaluation
): Promise<BrowserReadOnlyExecutionResult> {
  const action =
    proposal.action;

  const matchedTarget =
    evaluation.matchedTarget;

  if (
    !action ||
    action.kind !== "click" ||
    !matchedTarget ||
    matchedTarget.source !==
      "control"
  ) {
    return {
      status: "BLOCKED",
      note:
        "Read-only click requires a grounded control evaluation.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    normalize(
      matchedTarget.label
    ) !==
    normalize(action.target)
  ) {
    return {
      status: "BLOCKED",
      note:
        "Proposal target and evaluated control label do not match exactly.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    CONSEQUENCE_RISK_LABEL.test(
      action.target
    )
  ) {
    return {
      status: "BLOCKED",
      note:
        "The executor independently blocked a potentially consequential control label.",
      executed: false,
      stateChanged: false,
    };
  }

  const candidates =
    buildRoleCandidates(
      page,
      matchedTarget.kind || "",
      action.target
    );

  if (candidates.length === 0) {
    return {
      status: "BLOCKED",
      note:
        "The evaluated control kind is not eligible for read-only click execution.",
      executed: false,
      stateChanged: false,
    };
  }

  let visible =
    await collectVisibleCandidates(
      candidates
    );

  let usedObservationAlignedFallback =
    false;

  if (visible.length === 0) {
    visible =
      await collectObservationAlignedCandidates(
        page,
        matchedTarget.kind || "",
        action.target
      );

    usedObservationAlignedFallback =
      visible.length > 0;
  }

  if (visible.length !== 1) {
    return {
      status: "BLOCKED",
      note:
        visible.length === 0
          ? "No exact visible semantic or observation-aligned control matched the proposal."
          : "Multiple exact visible controls matched the proposal; execution is ambiguous.",
      executed: false,
      stateChanged: false,
    };
  }

  const target =
    visible[0]!;

  const disabled =
    await target
      .isDisabled({
        timeout: 500,
      })
      .catch(() => false);

  if (disabled) {
    return {
      status: "BLOCKED",
      note:
        "The exact semantic control became disabled before execution.",
      executed: false,
      stateChanged: false,
    };
  }

  const beforeObservation =
    await observeBrowserPage(page);

  try {
    await target
      .scrollIntoViewIfNeeded({
        timeout: 1500,
      });

    await target.click({
      trial: true,
      timeout: 2000,
    });

    await target.click({
      timeout: 2500,
    });

    await page.waitForTimeout(350);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      status: "ERROR",
      note:
        `Exact semantic control click failed: ${message}`,
      executed: false,
      stateChanged: false,
      beforeObservation,
    };
  }

  const afterObservation =
    await observeBrowserPage(page);

  const stateChanged =
    observationsDiffer(
      beforeObservation,
      afterObservation
    );

  const resolutionNote =
    usedObservationAlignedFallback
      ? " via observation-aligned DOM fallback"
      : "";

  return {
    status:
      stateChanged
        ? "EXECUTED"
        : "VERIFICATION_FAILED",
    note:
      stateChanged
        ? `Executed exact read-only click "${action.target}"${resolutionNote} and observed a visible state change.`
        : `Executed exact read-only click "${action.target}"${resolutionNote} but no observable state change was detected.`,
    executed: true,
    stateChanged,
    beforeObservation,
    afterObservation,
  };
}

async function executeInternalNavigation(
  page: Page,
  target: string
): Promise<BrowserReadOnlyExecutionResult> {
  if (
    !target.startsWith("/") ||
    target.startsWith("//")
  ) {
    return {
      status: "BLOCKED",
      note:
        "Read-only navigation requires a concrete internal route beginning with a single slash.",
      executed: false,
      stateChanged: false,
    };
  }

  let current: URL;
  let destination: URL;

  try {
    current =
      new URL(page.url());

    destination =
      new URL(
        target,
        current.origin
      );
  } catch {
    return {
      status: "BLOCKED",
      note:
        "The current page URL or proposed route could not be parsed safely.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    !["http:", "https:"]
      .includes(current.protocol) ||
    destination.origin !==
      current.origin
  ) {
    return {
      status: "BLOCKED",
      note:
        "The proposed navigation is not a same-origin HTTP(S) route.",
      executed: false,
      stateChanged: false,
    };
  }

  const beforeObservation =
    await observeBrowserPage(page);

  try {
    await page.goto(
      destination.toString(),
      {
        waitUntil:
          "domcontentloaded",
        timeout: 15000,
      }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      status: "ERROR",
      note:
        `Internal navigation failed: ${message}`,
      executed: false,
      stateChanged: false,
      beforeObservation,
    };
  }

  const afterObservation =
    await observeBrowserPage(page);

  const reached =
    new URL(
      afterObservation.url
    ).pathname ===
      destination.pathname &&
    new URL(
      afterObservation.url
    ).search ===
      destination.search;

  return {
    status:
      reached
        ? "EXECUTED"
        : "VERIFICATION_FAILED",
    note:
      reached
        ? `Navigated to internal route "${target}".`
        : `Navigation executed but the expected internal route "${target}" was not reached.`,
    executed: true,
    stateChanged:
      observationsDiffer(
        beforeObservation,
        afterObservation
      ),
    beforeObservation,
    afterObservation,
  };
}

export async function executeBrowserReadOnlyProposal(
  args: ExecuteBrowserReadOnlyProposalArgs
): Promise<BrowserReadOnlyExecutionResult> {
  if (!readOnlyExecutionEnabled()) {
    return {
      status: "SKIPPED",
      note:
        "Generic browser read-only execution is disabled.",
      executed: false,
      stateChanged: false,
    };
  }

  const {
    page,
    proposal,
    evaluation,
  } = args;

  if (
    evaluation.status !==
      "SAFE_TO_EXECUTE" ||
    evaluation.safeToExecute !==
      true ||
    evaluation.grounded !== true
  ) {
    return {
      status: "BLOCKED",
      note:
        `Proposal evaluation is not eligible for execution: ${evaluation.status}.`,
      executed: false,
      stateChanged: false,
    };
  }

  const action =
    proposal.action;

  if (!action) {
    return {
      status: "BLOCKED",
      note:
        "The proposal does not contain an executable action.",
      executed: false,
      stateChanged: false,
    };
  }

  if (
    action.kind === "fill" ||
    action.kind === "select"
  ) {
    return {
      status: "BLOCKED",
      note:
        `Action kind "${action.kind}" is excluded from the first read-only execution phase.`,
      executed: false,
      stateChanged: false,
    };
  }

  if (
    action.kind === "click"
  ) {
    return executeExactControlClick(
      page,
      proposal,
      evaluation
    );
  }

  if (
    action.kind === "navigate"
  ) {
    return executeInternalNavigation(
      page,
      action.target
    );
  }

  if (
    action.kind === "assert"
  ) {
    const observation =
      await observeBrowserPage(page);

    return {
      status: "EXECUTED",
      note:
        `Read-only assertion proposal retained its grounded evaluation for "${action.target}".`,
      executed: true,
      stateChanged: false,
      beforeObservation:
        observation,
      afterObservation:
        observation,
    };
  }

  if (
    action.kind === "observe"
  ) {
    const observation =
      await observeBrowserPage(page);

    return {
      status: "EXECUTED",
      note:
        "Captured a fresh read-only browser observation.",
      executed: true,
      stateChanged: false,
      beforeObservation:
        observation,
      afterObservation:
        observation,
    };
  }

  return {
    status: "BLOCKED",
    note:
      `Action kind "${action.kind}" is not supported by the read-only executor.`,
    executed: false,
    stateChanged: false,
  };
}
