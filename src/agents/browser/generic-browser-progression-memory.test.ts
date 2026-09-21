import assert from "node:assert/strict";
import test from "node:test";

import {
  appendGenericBrowserProgressionTransition,
  buildGenericBrowserProgressionState,
  deriveGenericBrowserProgressionContext,
  GENERIC_BROWSER_PROGRESSION_HISTORY_LIMIT,
  type GenericBrowserProgressionTransition,
} from "./generic-browser-progression-memory.js";
import {
  buildGenericBrowserShadowModelInput,
} from "./browser-agent-shadow.js";
import type {
  BrowserObservation,
} from "./browser-observation.js";

function observation(overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return {
    url: "https://runtime.example/company/jobs?project=1",
    title: "QA",
    headings: ["Basic Info"],
    controls: [],
    inputs: [],
    surfaces: [],
    collections: [],
    collectionAbstentions: [],
    visibleText: ["Project", "Job title"],
    counts: {
      headings: 1,
      controls: 0,
      inputs: 0,
      surfaces: 0,
      collections: 0,
      collectionAbstentions: 0,
      visibleText: 2,
    },
    ...overrides,
  };
}

function transition(args: {
  iteration: number;
  start: BrowserObservation;
  target?: string;
  goalOrProofProgressed?: boolean;
}) {
  return {
    iteration: args.iteration,
    startState: buildGenericBrowserProgressionState(args.start),
    action: { kind: "click" as const, target: args.target ?? "6 Work Setups" },
    actionSignature: `click:${args.target ?? "6 Work Setups"}`,
    goalOrProofProgressed: args.goalOrProofProgressed ?? false,
  };
}

test("marks a path advisory-exhausted only after returning to its semantic start state", () => {
  const stateA = observation();
  const stateB = observation({
    headings: ["Work Setups"],
    visibleText: ["Work Setups", "Optional tasks"],
  });
  const history = [
    transition({ iteration: 1, start: stateA }),
    transition({ iteration: 2, start: stateB, target: "Basic Info" }),
  ];

  const context = deriveGenericBrowserProgressionContext({
    observation: stateA,
    history,
  });

  assert.equal(context.exhaustedPaths.length, 1);
  assert.equal(context.exhaustedPaths[0]!.action.target, "6 Work Setups");
  assert.equal(context.exhaustedPaths[0]!.subsequentVerifiedActionCount, 1);
});

test("does not mark a path exhausted from a meaningfully different semantic state", () => {
  const stateA = observation();
  const stateB = observation({
    headings: ["Work Setups"],
    visibleText: ["Work Setups", "Optional tasks"],
  });
  const history = [
    transition({ iteration: 1, start: stateA }),
    transition({ iteration: 2, start: stateB, target: "Basic Info" }),
  ];

  const context = deriveGenericBrowserProgressionContext({
    observation: observation({
      url: "https://runtime.example/company/jobs?project=2",
      visibleText: ["Project", "Another project"],
    }),
    history,
  });

  assert.deepEqual(context.exhaustedPaths, []);
});

test("does not mark a goal/proof-progressing path exhausted", () => {
  const stateA = observation();
  const stateB = observation({
    headings: ["Work Setups"],
    visibleText: ["Work Setups"],
  });
  const history = [
    transition({
      iteration: 1,
      start: stateA,
      goalOrProofProgressed: true,
    }),
    transition({ iteration: 2, start: stateB, target: "Basic Info" }),
  ];

  assert.deepEqual(
    deriveGenericBrowserProgressionContext({
      observation: stateA,
      history,
    }).exhaustedPaths,
    []
  );
});

test("a semantically changed filter reentry is not collapsed into the old state", () => {
  const filtersClosed = observation({
    url: "https://runtime.example/company/jobs?tab=change-requests",
    headings: [],
    visibleText: ["No requests"],
  });
  const filtersOpen = observation({
    url: "https://runtime.example/company/jobs?tab=change-requests",
    headings: [],
    surfaces: [{
      kind: "surface",
      role: "tooltip",
      label: "Status Type",
      modal: false,
      textPreview: "Status Type",
    }],
    visibleText: ["No requests", "Status", "Type"],
  });
  const history = [
    transition({ iteration: 1, start: filtersClosed, target: "filter" }),
    transition({ iteration: 2, start: filtersOpen, target: "Type" }),
  ];

  const context = deriveGenericBrowserProgressionContext({
    observation: filtersOpen,
    history,
  });

  assert.deepEqual(context.exhaustedPaths, []);
});

test("history is bounded and progression data has no proof or verdict fields", () => {
  let history: GenericBrowserProgressionTransition[] = [];
  const start = observation();

  for (let iteration = 1; iteration <= 20; iteration += 1) {
    history = appendGenericBrowserProgressionTransition(
      history,
      transition({ iteration, start, target: `target-${iteration}` })
    );
  }

  assert.equal(history.length, GENERIC_BROWSER_PROGRESSION_HISTORY_LIMIT);
  const state = buildGenericBrowserProgressionState(start);
  assert.equal("proof" in state, false);
  assert.equal("verdict" in state, false);
});

test("the model receives concise advisory exhausted-path history without verdict authority", () => {
  const stateA = observation();
  const stateB = observation({
    headings: ["Work Setups"],
    visibleText: ["Work Setups"],
  });
  const history = [
    transition({ iteration: 1, start: stateA }),
    transition({ iteration: 2, start: stateB, target: "Basic Info" }),
  ];
  const input = buildGenericBrowserShadowModelInput(
    "AS-test",
    {
      id: "case-1",
      persona: "company_admin",
      goal: "Inspect Work Setups",
    },
    stateA,
    [],
    history
  );

  assert.equal(input.progressionContext.exhaustedPaths.length, 1);
  assert.equal(
    input.progressionContext.exhaustedPaths[0]!.action.target,
    "6 Work Setups"
  );
  assert.equal("proof" in input.progressionContext, false);
  assert.equal("verdict" in input.progressionContext, false);
});
