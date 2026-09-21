import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

import {
  observeBrowserPage,
  type BrowserObservation,
  type BrowserObservedCollection,
} from "./browser-observation.js";
import {
  recognizeOperationalCapabilityTransition,
} from "./browser-standard-run-capability-recognition.js";

function observation(
  overrides: Partial<BrowserObservation> = {}
): BrowserObservation {
  return {
    url: "https://example.test/work?tab=one",
    title: "Work",
    headings: ["Work"],
    controls: [],
    inputs: [],
    surfaces: [],
    visibleText: ["First panel content"],
    counts: {
      headings: 1,
      controls: 0,
      inputs: 0,
      surfaces: 0,
      collections: 0,
      visibleText: 1,
    },
    ...overrides,
  };
}

function tabs(
  selected: "First" | "Second",
  secondControls = "panel-second"
) {
  return [
    {
      kind: "tab" as const,
      label: "First",
      role: "tab",
      disabled: false,
      selected: selected === "First",
      expanded: null,
      checked: null,
      controls: "panel-first",
      controlledSurface: {
        id: "panel-first",
        role: "tabpanel",
        visible: selected === "First",
        contentFingerprint: "first-panel",
        textLength: 19,
      },
    },
    {
      kind: "tab" as const,
      label: "Second",
      role: "tab",
      disabled: false,
      selected: selected === "Second",
      expanded: null,
      checked: null,
      controls: secondControls,
      controlledSurface: {
        id: secondControls,
        role: "tabpanel",
        visible: selected === "Second",
        contentFingerprint: "second-panel",
        textLength: 20,
      },
    },
  ];
}

function selectedArgs(overrides: {
  before?: BrowserObservation;
  after?: BrowserObservation;
  settlement?: BrowserObservation;
} = {}) {
  const before = overrides.before ?? observation({ controls: tabs("First") });
  const after = overrides.after ?? observation({
    url: "https://example.test/work?tab=two",
    controls: tabs("Second"),
    visibleText: ["Second panel content"],
  });
  return {
    beforeObservation: before,
    proposedAction: { kind: "click" as const, target: "Second" },
    matchedTarget: {
      source: "control" as const,
      kind: "tab",
      label: "Second",
    },
    executionResult: {
      status: "EXECUTED" as const,
      executed: true,
      stateChanged: true,
      afterObservation: after,
    },
    settlementObservation: overrides.settlement ?? structuredClone(after),
  };
}

function row(name: string, index: number) {
  return {
    sequencePosition: index,
    rowSequenceObserved: true as const,
    rowId: name,
    rowIdentity: {
      method: "DATA_ROW_KEY" as const,
      sourceText: name,
    },
    rowIdentityStatus: "GROUNDED" as const,
    cells: [{
      visibleFieldId: "name",
      rawValue: name,
      provenance: { method: "NATIVE_TD" as const },
    }],
    provenance: { method: "NATIVE_TR" as const },
  };
}

function collection(
  id: string,
  names: string[]
): BrowserObservedCollection {
  return {
    collectionId: id,
    shape: "TABLE",
    label: "Results",
    identity: {
      method: "ARIA_NAME",
      sourceText: "Results",
    },
    fields: [{
      visibleLabel: "Name",
      visibleFieldId: "name",
      provenance: {
        method: "NATIVE_TH",
        sourceText: "Name",
      },
    }],
    rows: names.map(row),
    paginationControls: [
      {
        kind: "PREVIOUS",
        role: "button",
        label: "Previous page",
        sourceRef: "collection-pagination",
      },
      {
        kind: "NEXT",
        role: "button",
        label: "Next page",
        sourceRef: "collection-pagination",
      },
    ],
    provenance: {
      method: "NATIVE_TABLE",
      rowSequenceObserved: true,
    },
  };
}

function pageControls(page: number) {
  return [
    {
      kind: "button" as const,
      label: "Previous page",
      role: "button",
      disabled: page === 1,
      selected: null,
      expanded: null,
      checked: null,
    },
    {
      kind: "button" as const,
      label: "Next page",
      role: "button",
      disabled: page === 3,
      selected: null,
      expanded: null,
      checked: null,
    },
  ];
}

function paginationObservation(args: {
  page: number;
  id?: string;
  names: string[];
  url?: string;
  includeCollection?: boolean;
}): BrowserObservation {
  const hasCollection = args.includeCollection !== false;
  return observation({
    url: args.url ?? "https://example.test/results",
    controls: pageControls(args.page),
    collections: hasCollection
      ? [collection(args.id ?? "results", args.names)]
      : [],
    visibleText: [`${args.page} of 3 • 6 total results`],
    counts: {
      headings: 1,
      controls: 2,
      inputs: 0,
      surfaces: 0,
      collections: hasCollection ? 1 : 0,
      visibleText: 1,
    },
  });
}

function paginationArgs(overrides: {
  before?: BrowserObservation;
  after?: BrowserObservation;
  settlement?: BrowserObservation;
} = {}) {
  const before = overrides.before ?? paginationObservation({
    page: 1,
    names: ["A", "B"],
  });
  const after = overrides.after ?? paginationObservation({
    page: 2,
    names: ["C", "D"],
  });
  return {
    beforeObservation: before,
    proposedAction: { kind: "click" as const, target: "Next page" },
    matchedTarget: {
      source: "control" as const,
      kind: "button",
      label: "Next page",
    },
    executionResult: {
      status: "EXECUTED" as const,
      executed: true,
      stateChanged: true,
      afterObservation: after,
    },
    settlementObservation: overrides.settlement ?? structuredClone(after),
  };
}

test("real observation binds tab selection to the visible controlled panel", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <main>
        <div role="tablist" aria-label="Example tabs">
          <button role="tab" aria-selected="true" aria-controls="panel-first">First</button>
          <button role="tab" aria-selected="false" aria-controls="panel-second">Second</button>
        </div>
        <section id="panel-first" role="tabpanel">First panel content</section>
        <section id="panel-second" role="tabpanel" hidden>Second panel content</section>
      </main>
    `);
    const observed = await observeBrowserPage(page);
    const first = observed.controls.find((control) => control.label === "First");
    const second = observed.controls.find((control) => control.label === "Second");
    assert.equal(first?.controlledSurface?.id, "panel-first");
    assert.equal(first?.controlledSurface?.role, "tabpanel");
    assert.equal(first?.controlledSurface?.visible, true);
    assert.equal(second?.controlledSurface?.id, "panel-second");
    assert.equal(second?.controlledSurface?.visible, false);
    assert.notEqual(
      first?.controlledSurface?.contentFingerprint,
      second?.controlledSurface?.contentFingerprint
    );
    assert.equal(
      JSON.stringify(observed).includes("controlledSurface"),
      false
    );
  } finally {
    await browser.close();
  }
});

test("recognizes a settled exact tab transition", () => {
  const result = recognizeOperationalCapabilityTransition(selectedArgs());
  assert.equal(result?.evaluation.capabilityKind, "SELECTED_STATE_OPERATIONAL_CAPABILITY");
  assert.equal(result?.evaluation.status, "EXECUTED_VERIFIED");
  assert.equal(result?.evaluation.verifiedStateChange, true);
  assert.equal(result?.evaluation.settled, true);
});

test("does not confirm a selected flag while the wrong controlled panel remains visible", () => {
  const wrongPanels = tabs("Second").map(
    (control, index) => ({
      ...control,
      controlledSurface: {
        ...control.controlledSurface,
        visible: index === 0,
      },
    })
  );
  const after = observation({
    controls: wrongPanels,
    visibleText: ["Wrong panel content"],
  });
  const result = recognizeOperationalCapabilityTransition(
    selectedArgs({ after, settlement: structuredClone(after) })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "AFTER_STATE_UNAVAILABLE");
});

test("does not treat an ordinary button as Selected-State", () => {
  const args = selectedArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
    proposedAction: { kind: "click", target: "Refresh" },
    matchedTarget: { source: "control", kind: "button", label: "Refresh" },
  });
  assert.equal(result, null);
});

test("fails closed when the selected state is ambiguous", () => {
  const ambiguous = tabs("First").map((control) => ({ ...control, selected: true }));
  const result = recognizeOperationalCapabilityTransition(
    selectedArgs({ before: observation({ controls: ambiguous }) })
  );
  assert.equal(result, null);
});

test("withholds Selected-State confirmation without later settlement", () => {
  const {
    settlementObservation: _settlementObservation,
    ...args
  } = selectedArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
  });
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "STATE_DID_NOT_SETTLE");
});

test("records an abstention instead of pending success after execution failure", () => {
  const args = selectedArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
    executionResult: {
      status: "ERROR",
      executed: false,
      stateChanged: false,
    },
  });
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "EXECUTION_NOT_VERIFIED");
  assert.equal(result?.evaluation.executed, false);
});

test("records an abstention when execution reports no state change", () => {
  const args = paginationArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
    executionResult: {
      ...args.executionResult,
      stateChanged: false,
    },
  });
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "EXECUTION_NOT_VERIFIED");
});

test("clears confirmation when the next observation mismatches the immediate state", () => {
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({
      settlement: paginationObservation({
        page: 1,
        names: ["A", "B"],
      }),
    })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "STATE_DID_NOT_SETTLE");
});

test("an unrelated later surface cannot settle an older candidate", () => {
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({
      settlement: paginationObservation({
        page: 2,
        names: ["C", "D"],
        url: "https://example.test/unrelated",
      }),
    })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "STATE_DID_NOT_SETTLE");
});

test("does not treat the immediate after object itself as an independent settlement observation", () => {
  const args = paginationArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
    settlementObservation:
      args.executionResult.afterObservation!,
  });
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "STATE_DID_NOT_SETTLE");
});

test("recognizes a settled same-collection pagination transition", () => {
  const result = recognizeOperationalCapabilityTransition(paginationArgs());
  assert.equal(result?.evaluation.capabilityKind, "PAGINATION_OPERATIONAL_CAPABILITY");
  assert.equal(result?.evaluation.status, "EXECUTED_VERIFIED");
  assert.equal(result?.evaluation.restorationRequired, false);
  assert.equal(result?.evaluation.restored, false);
});

test("does not create a Pagination attempt from a Next label without a collection", () => {
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({
      before: paginationObservation({
        page: 1,
        names: ["A", "B"],
        includeCollection: false,
      }),
    })
  );
  assert.equal(result, null);
});

test("does not confirm pagination when collection content is unchanged", () => {
  const after = paginationObservation({ page: 2, names: ["A", "B"] });
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({ after, settlement: structuredClone(after) })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "COLLECTION_DID_NOT_CHANGE");
});

test("does not confirm pagination when collection identity changes", () => {
  const after = paginationObservation({ page: 2, id: "other", names: ["C", "D"] });
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({ after, settlement: structuredClone(after) })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "COLLECTION_IDENTITY_CHANGED");
});

test("does not confirm pagination across an incompatible route", () => {
  const after = paginationObservation({
    page: 2,
    names: ["C", "D"],
    url: "https://example.test/other",
  });
  const result = recognizeOperationalCapabilityTransition(
    paginationArgs({ after, settlement: structuredClone(after) })
  );
  assert.equal(result?.evaluation.status, "ABSTAINED");
  assert.equal(result?.evaluation.abstentionReason, "SURFACE_CHANGED_UNEXPECTEDLY");
});

test("operational recognition always withholds acceptance proof", () => {
  const result = recognizeOperationalCapabilityTransition(paginationArgs());
  assert.deepEqual(result?.evaluation.acceptanceProof, {
    attempted: false,
    withheldReason: "STANDARD_RUN_OPERATIONAL_RECOGNITION_HAS_NO_ACCEPTANCE_AUTHORITY",
  });
});

test("operational recognition carries no browser verdict fields", () => {
  const result = recognizeOperationalCapabilityTransition(selectedArgs());
  assert.equal("deterministicEvidence" in result!, false);
  assert.equal("caseProofReadiness" in result!, false);
  assert.equal("verdict" in result!, false);
});

test("normal forward progress explicitly does not require restoration", () => {
  const result = recognizeOperationalCapabilityTransition(paginationArgs());
  assert.equal(result?.evaluation.restorationRequired, false);
  assert.equal(result?.evaluation.restored, false);
});

test("an unrelated generic observation action creates no capability attempt", () => {
  const args = paginationArgs();
  const result = recognizeOperationalCapabilityTransition({
    ...args,
    proposedAction: { kind: "observe", target: "/results" },
    matchedTarget: { source: "route", kind: "observe", label: "/results" },
  });
  assert.equal(result, null);
});

test("recognition does not mutate source observations", () => {
  const args = paginationArgs();
  const before = structuredClone(args.beforeObservation);
  const after = structuredClone(args.executionResult.afterObservation);
  const settlement = structuredClone(args.settlementObservation);
  recognizeOperationalCapabilityTransition(args);
  assert.deepEqual(args.beforeObservation, before);
  assert.deepEqual(args.executionResult.afterObservation, after);
  assert.deepEqual(args.settlementObservation, settlement);
});

test("runtime attempt finalizes a pending candidate before reading the next proposed action", () => {
  const source = fs.readFileSync(
    new URL("./generic-browser-runtime-attempt.ts", import.meta.url),
    "utf8"
  );
  const finalizeIndex = source.indexOf(
    "pendingOperationalCapabilityTransition &&"
  );
  const proposedActionIndex = source.indexOf(
    "const proposedAction =",
    finalizeIndex
  );
  const executeIndex = source.indexOf(
    "await executeProposal",
    proposedActionIndex
  );
  assert.ok(finalizeIndex >= 0);
  assert.ok(proposedActionIndex > finalizeIndex);
  assert.ok(executeIndex > proposedActionIndex);
});

test("runtime attempt has an explicit end-of-loop fail-safe finalization path", () => {
  const source = fs.readFileSync(
    new URL("./generic-browser-runtime-attempt.ts", import.meta.url),
    "utf8"
  );
  const loopEnd = source.indexOf(
    "if (pendingOperationalCapabilityTransition) {"
  );
  const budgetState = source.indexOf(
    "const genericBrowserBudgetExhausted",
    loopEnd
  );
  assert.ok(loopEnd >= 0);
  assert.ok(budgetState > loopEnd);
});
