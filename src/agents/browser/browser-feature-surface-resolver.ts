import type { Locator, Page } from "playwright";
import {
  observeBrowserPage,
  type BrowserObservation,
  type BrowserObservationControl,
} from "./browser-observation.js";

export type FeatureSurfaceResolutionResult = {
  status: "ALREADY_AVAILABLE" | "ENTERED" | "BLOCKED";
  note: string;
};

export type FeatureSurfaceCandidateSelection = {
  candidate?: BrowserObservationControl;
  reason: string;
};

const CONSEQUENCE_RISK_LABEL =
  /\b(?:add|apply|approve|archive|confirm|create|delete|disable|enable|invite|pay|publish|reject|remove|save|send|submit|upload)\b/i;

function normalize(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isConsequenceRiskBrowserControlLabel(
  value: unknown
): boolean {
  return CONSEQUENCE_RISK_LABEL.test(
    normalize(value)
  );
}

function exactLabelPattern(value: string): RegExp {
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}\\s*$`, "i");
}

function phraseOccurrenceCount(text: string, phrase: string): number {
  if (!phrase) return 0;

  let count = 0;
  let offset = 0;

  while (offset < text.length) {
    const found = text.indexOf(phrase, offset);
    if (found < 0) break;

    const before = found > 0 ? text[found - 1] ?? " " : " ";
    const after = text[found + phrase.length] ?? " ";

    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) {
      count += 1;
    }

    offset = found + phrase.length;
  }

  return count;
}

function isSafeFeatureEntryControl(control: BrowserObservationControl): boolean {
  const label = normalize(control.label);
  const wordCount = label.split(/\s+/).filter(Boolean).length;

  if (
    !label ||
    label.length < 4 ||
    wordCount < 2 ||
    control.disabled ||
    control.selected === true ||
    isConsequenceRiskBrowserControlLabel(label) ||
    !["tab", "link", "button"].includes(control.kind)
  ) {
    return false;
  }

  return !control.href ||
    control.href.startsWith("/") ||
    control.href.startsWith("#") ||
    control.href.startsWith("?");
}

export function selectFeatureSurfaceCandidate(
  observation: BrowserObservation,
  requirementText: string,
  requiredControlLabel: string
): FeatureSurfaceCandidateSelection {
  const requirements = normalize(requirementText);
  const requiredControl = normalize(requiredControlLabel);
  const scored = observation.controls
    .filter(isSafeFeatureEntryControl)
    .filter((control) => normalize(control.label) !== requiredControl)
    .map((control) => {
      const label = normalize(control.label);
      const occurrences = phraseOccurrenceCount(requirements, label);
      const kindScore = control.kind === "tab" ? 60 : control.kind === "link" ? 35 : 15;
      const words = label.split(/\s+/).filter(Boolean).length;

      return {
        control,
        occurrences,
        score: occurrences * 100 + kindScore + Math.min(words, 5) * 12 +
          Math.min(label.length, 40),
      };
    })
    .filter((candidate) => candidate.occurrences > 0)
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  if (!top) {
    return {
      reason: "No safe observed feature-entry control was named by the canonical requirements.",
    };
  }

  const tiedLabel = scored.find(
    (candidate) =>
      candidate !== top &&
      candidate.score === top.score &&
      normalize(candidate.control.label) !== normalize(top.control.label)
  );

  if (tiedLabel) {
    return {
      reason:
        "Observed feature-entry candidates were semantically ambiguous; no DOM-order fallback was used.",
    };
  }

  return {
    candidate: top.control,
    reason:
      `Selected the unique observed ${top.control.kind} ` +
      `"${top.control.label}" named by the canonical requirements.`,
  };
}

export function observationHasControl(
  observation: BrowserObservation,
  label: string
): boolean {
  const target = normalize(label);
  const singularTarget =
    target.endsWith("s")
      ? target.slice(0, -1)
      : target;
  return observation.controls.some((control) => {
    const actual = normalize(control.label);
    const singularActual =
      actual.endsWith("s")
        ? actual.slice(0, -1)
        : actual;

    const filterFamilyMatch =
      singularTarget === "filter" &&
      /(?:^|\b)(?:filter|funnel|sliders?|tune)(?:\b|$)/i.test(actual);

    return filterFamilyMatch || actual === target || singularActual === singularTarget ||
      actual.startsWith(`${target} `) || actual.endsWith(` ${target}`);
  });
}

function buildRequirementText(testCase: any): string {
  const stepText = Array.isArray(testCase?.steps)
    ? testCase.steps.map((step: any) => String(step?.text || "")).filter(Boolean)
    : [];

  return [testCase?.goal, testCase?.successCriteria, ...stepText]
    .filter(Boolean)
    .join(" ");
}

function buildMainCandidateLocator(
  page: Page,
  control: BrowserObservationControl
): Locator | null {
  const main = page.locator('main, [role="main"]').first();
  const name = exactLabelPattern(control.label);

  if (control.kind === "tab") return main.getByRole("tab", { name });
  if (control.kind === "link") return main.getByRole("link", { name });
  if (control.kind === "button") return main.getByRole("button", { name });
  return null;
}

async function collectUniqueVisibleEnabled(locator: Locator): Promise<Locator[]> {
  const matches: Locator[] = [];
  const count = Math.min(await locator.count().catch(() => 0), 10);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    const visible = await item.isVisible({ timeout: 500 }).catch(() => false);
    const enabled = await item.isEnabled({ timeout: 500 }).catch(() => false);
    if (visible && enabled) matches.push(item);
  }

  return matches;
}

type FeatureControlState = {
  active: boolean;
  className: string;
  state: string;
};

async function captureFeatureControlState(
  locator: Locator
): Promise<FeatureControlState | null> {
  return locator.evaluate((element) => {
    const activeValues = [
      element.getAttribute("aria-selected"),
      element.getAttribute("aria-current"),
      element.getAttribute("aria-pressed"),
      element.getAttribute("data-selected"),
      element.getAttribute("data-active"),
      element.getAttribute("data-state"),
    ].map((value) => String(value || "").trim().toLowerCase());

    return {
      active: activeValues.some((value) =>
        ["true", "page", "active", "selected", "checked"].includes(value)
      ),
      className: element instanceof HTMLElement
        ? String(element.className || "").replace(/\s+/g, " ").trim()
        : "",
      state: String(element.getAttribute("data-state") || "").trim().toLowerCase(),
    };
  }).catch(() => null);
}

export async function ensureRequiredFeatureSurface(
  page: Page,
  testCase: any,
  requiredControlLabel: string
): Promise<FeatureSurfaceResolutionResult> {
  const before = await observeBrowserPage(page);
  const requiredWasAvailable = observationHasControl(before, requiredControlLabel);
  const selection = selectFeatureSurfaceCandidate(
    before,
    buildRequirementText(testCase),
    requiredControlLabel
  );

  if (!selection.candidate) {
    return requiredWasAvailable
      ? {
          status: "ALREADY_AVAILABLE",
          note:
            `Required control "${requiredControlLabel}" was already present and no ` +
            "distinct safe nested feature control was required by the canonical requirements.",
        }
      : { status: "BLOCKED", note: selection.reason };
  }

  const locator = buildMainCandidateLocator(page, selection.candidate);
  if (!locator) {
    return {
      status: "BLOCKED",
      note: `${selection.reason} The candidate did not map to a supported read-only locator.`,
    };
  }

  const matches = await collectUniqueVisibleEnabled(locator);
  if (matches.length !== 1 || !matches[0]) {
    return {
      status: "BLOCKED",
      note:
        `${selection.reason} Expected one visible enabled main-surface match, observed ` +
        `${matches.length}; no DOM-order fallback was used.`,
    };
  }

  const match = matches[0];
  const beforeState = await captureFeatureControlState(match);
  const beforeUrl = page.url();

  await match.scrollIntoViewIfNeeded({ timeout: 1000 });
  await match.click({ timeout: 2000 });
  await page.waitForTimeout(750);

  const after = await observeBrowserPage(page);
  const afterLocator = buildMainCandidateLocator(page, selection.candidate) ?? locator;
  const afterMatches = await collectUniqueVisibleEnabled(afterLocator);
  const afterState = afterMatches.length === 1 && afterMatches[0]
    ? await captureFeatureControlState(afterMatches[0])
    : null;
  const targetStateChanged = Boolean(
    afterState &&
    (afterState.active || afterState.className !== beforeState?.className ||
      afterState.state !== beforeState?.state)
  );
  const urlChanged = page.url() !== beforeUrl;
  const requiredBecameAvailable =
    !requiredWasAvailable && observationHasControl(after, requiredControlLabel);

  if (!observationHasControl(after, requiredControlLabel)) {
    return {
      status: "BLOCKED",
      note:
        `Clicked the unique observed "${selection.candidate.label}" control, but required ` +
        `control "${requiredControlLabel}" did not become available; URL ${beforeUrl} -> ${page.url()}.`,
    };
  }

  if (!urlChanged && !targetStateChanged && !requiredBecameAvailable) {
    return {
      status: "BLOCKED",
      note:
        `Clicked the unique observed "${selection.candidate.label}" control, but no URL, ` +
        "active-state, visual-class, or required-control availability transition was verified.",
    };
  }

  return {
    status: "ENTERED",
    note:
      `Entered observed feature surface via "${selection.candidate.label}" and verified ` +
      `required control "${requiredControlLabel}" became available; URL ${beforeUrl} -> ${page.url()}.`,
  };
}
