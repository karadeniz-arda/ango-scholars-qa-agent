import type {
  BrowserShadowAction,
} from "./browser-agent-shadow.js";
import type {
  BrowserObservation,
} from "./browser-observation.js";

export const GENERIC_BROWSER_PROGRESSION_HISTORY_LIMIT = 6;
const GENERIC_BROWSER_PROGRESSION_EXHAUSTED_PATH_LIMIT = 3;

export type GenericBrowserProgressionState = {
  route: string;
  headings: string[];
  surfaces: string[];
  activeControls: string[];
  landmarks: string[];
  signature: string;
};

export type GenericBrowserProgressionTransition = {
  iteration: number;
  startState: GenericBrowserProgressionState;
  action: BrowserShadowAction;
  actionSignature: string;
  goalOrProofProgressed: boolean;
};

export type GenericBrowserExhaustedProgressionPath = {
  firstExecutedIteration: number;
  action: BrowserShadowAction;
  actionSignature: string;
  startState: GenericBrowserProgressionState;
  subsequentVerifiedActionCount: number;
};

export type GenericBrowserProgressionContext = {
  currentState: GenericBrowserProgressionState;
  exhaustedPaths: GenericBrowserExhaustedProgressionPath[];
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function boundedUnique(values: unknown[], limit: number): string[] {
  return [...new Set(
    values
      .map(normalize)
      .filter(Boolean)
  )]
    .sort()
    .slice(0, limit);
}

function normalizedRoute(rawUrl: unknown): string {
  try {
    const parsed = new URL(String(rawUrl ?? ""));
    const entries = [...parsed.searchParams.entries()]
      .sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          leftKey.localeCompare(rightKey) ||
          leftValue.localeCompare(rightValue)
      );
    const query = new URLSearchParams(entries).toString();
    const pathname = parsed.pathname.replace(/\/$/, "") || "/";

    return query
      ? `${pathname}?${query}`
      : pathname;
  } catch {
    return normalize(rawUrl).slice(0, 1000);
  }
}

function nullableStateToken(value: unknown): string {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "unknown";
}

/**
 * A bounded semantic navigation state, not a DOM/page fingerprint.  It uses
 * route, explicit semantic surfaces, active controls, headings, and a small
 * set of visible landmarks.  Sorting deliberately avoids DOM position as an
 * identity input.
 */
export function buildGenericBrowserProgressionState(
  observation: BrowserObservation
): GenericBrowserProgressionState {
  const route = normalizedRoute(observation.url);
  const headings = boundedUnique(observation.headings, 4);
  const surfaces = boundedUnique(
    observation.surfaces.map((surface) =>
      [
        surface.kind,
        surface.role,
        surface.label,
      ].join(":")
    ),
    3
  );
  const activeControls = boundedUnique(
    observation.controls
      .filter((control) =>
        control.selected !== null ||
        control.expanded !== null ||
        control.checked !== null
      )
      .map((control) =>
        [
          control.kind,
          control.role,
          control.label,
          `selected=${nullableStateToken(control.selected)}`,
          `expanded=${nullableStateToken(control.expanded)}`,
          `checked=${nullableStateToken(control.checked)}`,
        ].join(":")
      ),
    10
  );
  const landmarks = boundedUnique(
    observation.visibleText,
    12
  );
  const signature = JSON.stringify({
    route,
    headings,
    surfaces,
    activeControls,
    landmarks,
  });

  return {
    route,
    headings,
    surfaces,
    activeControls,
    landmarks,
    signature,
  };
}

export function appendGenericBrowserProgressionTransition(
  history: GenericBrowserProgressionTransition[],
  transition: GenericBrowserProgressionTransition
): GenericBrowserProgressionTransition[] {
  return [
    ...history,
    transition,
  ].slice(-GENERIC_BROWSER_PROGRESSION_HISTORY_LIMIT);
}

/**
 * An exhausted path is advisory only.  It exists only after at least one
 * subsequent verified action and a later return to the same bounded semantic
 * state without a goal/proof progression signal.
 */
export function deriveGenericBrowserProgressionContext(args: {
  observation: BrowserObservation;
  history: GenericBrowserProgressionTransition[];
}): GenericBrowserProgressionContext {
  const currentState =
    buildGenericBrowserProgressionState(args.observation);
  const exhaustedPaths = args.history
    .flatMap((transition, index) => {
      const hasSubsequentVerifiedAction =
        index < args.history.length - 1;

      if (
        !hasSubsequentVerifiedAction ||
        transition.goalOrProofProgressed ||
        transition.startState.signature !==
          currentState.signature
      ) {
        return [];
      }

      return [{
        firstExecutedIteration:
          transition.iteration,
        action: transition.action,
        actionSignature:
          transition.actionSignature,
        startState: transition.startState,
        subsequentVerifiedActionCount:
          args.history.length - index - 1,
      }];
    })
    .slice(-GENERIC_BROWSER_PROGRESSION_EXHAUSTED_PATH_LIMIT);

  return {
    currentState,
    exhaustedPaths,
  };
}
