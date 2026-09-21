import assert from "node:assert/strict";
import test from "node:test";

import {
  applySourceBackedBrowserObligationBridge,
  browserCasePageSurfaces,
  sourceBackedPageSurfaces,
  sourceBackedSurfaceMatches,
  sourceBackedSurfaceMemberId,
} from "./planner-browser-obligation-bridge.js";
import {
  buildPlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import {
  normalizePlannerBrowserScopes,
} from "./planner-browser-policy.js";
import {
  dispatchBrowserDeterministicCapability,
} from "../agents/browser/browser-deterministic-capability-dispatch.js";
import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerAcceptanceObligationLedger,
  PlannerAcceptanceSourceLedger,
  TestPlan,
} from "./types.js";

function browserCase(
  id: string,
  goal: string,
  overrides: Partial<BrowserTestCase> = {}
): BrowserTestCase {
  return {
    id,
    persona: "company_admin",
    goal,
    startRoute: "/collection",
    successCriteria: goal,
    automatedChecks: [],
    manualChecks: [],
    fixtureRequirements: [],
    steps: [],
    ...overrides,
  };
}

function obligation(
  id: string,
  text: string,
  sourceUnitId = `source-${id}`
): PlannerAcceptanceObligation {
  return {
    id,
    sourceUnitIds: [sourceUnitId],
    sourceRole: "ACCEPTANCE",
    derivation: "DIRECT_DESCRIPTION_SECTION",
    text,
  };
}

function ledgers(
  obligations: PlannerAcceptanceObligation[],
  extraSourceText: string[] = []
): {
  sourceLedger: PlannerAcceptanceSourceLedger;
  obligationLedger: PlannerAcceptanceObligationLedger;
} {
  const sourceUnits = [
    ...obligations.map((item) => ({
      id: item.sourceUnitIds[0]!,
      sourceKind: "DESCRIPTION" as const,
      sourceRef: "jira.description",
      sectionHeading: "Acceptance Criteria",
      text: item.text,
    })),
    ...extraSourceText.map((text, index) => ({
      id: `context-${index}`,
      sourceKind: "DESCRIPTION" as const,
      sourceRef: "jira.description",
      sectionHeading: "Context",
      text,
    })),
  ];

  return {
    sourceLedger: {
      sourceStatus: "RESOLVED",
      basis: "SUMMARY_DESCRIPTION_FALLBACK",
      sourceUnits,
    },
    obligationLedger: {
      sourceStatus: "RESOLVED",
      derivationStatus: obligations.length > 0
        ? "RESOLVED"
        : "NO_HIGH_CONFIDENCE_OBLIGATIONS",
      obligations,
      unresolvedSourceUnitIds: [],
    },
  };
}

function plan(cases: BrowserTestCase[]): TestPlan {
  return {
    issueKey: "SYNTHETIC",
    summary: "Synthetic plan",
    apiCases: [],
    browserCases: cases,
  };
}

function frontendDefaultPatch(args: {
  label?: string;
  expectedValue?: number;
  file?: string;
  property?: string;
} = {}): string {
  const label = args.label ?? "Penalty Weight";
  const expectedValue = args.expectedValue ?? -3;
  const file = args.file ?? "src/components/Settings.tsx";
  const property = args.property ?? "defaultWeight";

  return [
    "--- GITHUB CHANGE CONTEXT ---",
    `Patch for ${file}:`,
    "@@ -1,4 +1,4 @@",
    " {",
    `   label: '${label}',`,
    `-  ${property}: -9,`,
    `+  ${property}: ${expectedValue},`,
    " }",
  ].join("\n");
}

test("strict shared-head page grammar derives stable source-only surface members", () => {
  for (const text of [
    "Add search to the Payments & All Payments page.",
    "Show search on the Payments and All Payments pages.",
    "For Payments and All Payments pages, track the active tab.",
  ]) {
    const surfaces = sourceBackedPageSurfaces(text);
    assert.deepEqual(surfaces, ["payments", "all payments"]);
    assert.deepEqual(
      surfaces.map(sourceBackedSurfaceMemberId).sort(),
      ["all-payments", "payments"]
    );
  }
  assert.deepEqual(
    sourceBackedPageSurfaces("Track the active tab and all remaining filters."),
    []
  );
});

test("candidate and case text can bind but cannot invent source surface members", () => {
  const surfaces = ["payments", "all payments"];
  assert.deepEqual(
    sourceBackedSurfaceMatches("Company All Payments page search area", surfaces),
    ["all payments"]
  );
  assert.deepEqual(
    sourceBackedSurfaceMatches("Refunds page search area", surfaces),
    []
  );
  assert.deepEqual(
    browserCasePageSurfaces(browserCase(
      "payments",
      "On the Payments page, verify the search control."
    )),
    ["payments"]
  );
});

const resetDefaultClaim =
  "A new record with advanced settings enabled shows Penalty Weight as -3; Reset to defaults restores -3.";

test("source-backed search allocates to every explicitly named compatible surface but remains unbound without predicate authority", () => {
  const required = obligation(
    "search-control",
    "Add a search bar to the Primary & Archived page."
  );
  const primary = browserCase(
    "primary",
    "Verify search on the Primary page.",
    {
      acceptanceObligationIds: [
        "planner-model-only-obligation",
      ],
    }
  );
  const archived = browserCase(
    "archived",
    "Verify search on the Archived page.",
    {
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: ["Planner proposal"],
        collectionFilterRequirements: [{
          kind: "COLLECTION_FILTER",
          requirementId: "planner-only",
          sourceClaim: "Search talent email and job title with case-insensitive contains.",
          interactionKind: "TEXT_SEARCH",
          controlSemantic: "SEARCH",
          authority: "AUTHORITATIVE",
          probes: [],
        }],
      },
    }
  );
  const metadata = ledgers(
    [required],
    [
      "For example, users may know a numeric record ID.",
      "Implementation searches talent email and job title.",
      "A nonmatching query shows an empty state.",
    ]
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([primary, archived]),
    metadata
  );

  assert.deepEqual(
    result.browserObligationBindings,
    [{
      obligationId: "search-control",
      sourceUnitIds: ["source-search-control"],
      semanticFamily: "SEARCH_FILTER",
      state: "SUPPORTED_BUT_UNBOUND",
      allocatedCaseIds: ["primary", "archived"],
      reason: "Search/filter is supported, but the authoritative source does not bind every property required by the existing proof contract.",
      missingAuthority: [
        "VISIBLE_FILTER_FIELD",
        "FILTER_PREDICATE",
        "MATCHING_RESULT_EXPECTATION",
      ],
    }]
  );
  for (const testCase of result.browserCases) {
    assert.deepEqual(
      testCase.acceptanceObligationIds,
      ["search-control"]
    );
    assert.equal(
      testCase.acceptanceScope?.collectionFilterRequirements,
      undefined
    );
  }
  assert.equal(
    JSON.stringify(result).includes("planner-only"),
    false
  );
});

test("a fully source-authorized filter contract binds without using implementation or planner authority", () => {
  const required = obligation(
    "bound-search",
    "Provide a search input on the Records page that filters the visible \"Reference\" field using exact text; matching rows are included."
  );
  const metadata = ledgers([required]);
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "records",
        "Verify search on the Records page."
      ),
    ]),
    metadata
  );
  const binding = result.browserObligationBindings?.[0];
  const requirement = result.browserCases[0]
    ?.acceptanceScope?.collectionFilterRequirements?.[0];

  assert.equal(binding?.state, "SUPPORTED_AND_BOUND");
  assert.equal(requirement?.probes[0]?.predicate, "EXACT_TEXT");
  assert.equal(
    requirement?.probes[0]?.fieldScope.kind,
    "VISIBLE_FIELD"
  );
  assert.equal(
    requirement?.probes[0]?.fieldScope.kind === "VISIBLE_FIELD"
      ? requirement.probes[0].fieldScope.proofFieldBinding.proposedField
      : undefined,
    "Reference"
  );
});

test("pagination remains unsupported and weak text assertions cannot bind it", () => {
  const required = obligation(
    "pagination",
    "Pagination retains the selected page during a page transition."
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "pagination-case",
        "Verify pagination and selected page transition.",
        {
          automatedChecks: [
            'Verify "undefined" is not visible.',
            'Verify "null" is not visible.',
          ],
        }
      ),
    ]),
    ledgers(
      [required],
      ["Implementation retains previous data and preserves total count."]
    )
  );

  assert.equal(
    result.browserObligationBindings?.[0]?.state,
    "UNSUPPORTED_AUTOMATION_SEMANTIC"
  );
  assert.equal(
    result.browserCases[0]?.acceptanceScope?.collectionFilterRequirements,
    undefined
  );
});

test("direction obligations allocate by semantic facets while unrelated cases remain unlinked", () => {
  const obligations = [
    obligation("blocks", "Urdu headings and paragraphs read right-to-left and anchor to the right edge."),
    obligation("mixed", "English content remains left-to-right and mixed Urdu blocks retain their own direction."),
    obligation("rich", "List markers, blockquote borders, and table-cell alignment follow text direction."),
    obligation("choices", "Radio and checkbox controls follow right-to-left text direction."),
    obligation("editor", "Typing Urdu in the Markdown editor behaves like a right-to-left field."),
  ];
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase("editor-case", "Verify the Markdown editor direction.", {
        manualChecks: [
          "Verify Urdu heading and paragraph direction.",
          "Verify English and mixed Urdu blocks keep independent direction.",
        ],
      }),
      browserCase("rendered-case", "Verify rendered content direction.", {
        manualChecks: [
          "Verify Urdu heading and paragraph direction.",
          "Verify English and mixed Urdu blocks keep independent direction.",
          "Verify list, blockquote, and table-cell direction.",
        ],
      }),
      browserCase("choice-case", "Verify talent option direction.", {
        manualChecks: [
          "Verify Urdu heading and paragraph direction.",
          "Verify English and mixed Urdu blocks keep independent direction.",
          "Verify list, blockquote, and table-cell direction.",
          "Verify radio and checkbox controls follow right-to-left direction.",
        ],
      }),
    ]),
    ledgers(obligations)
  );
  const byId = new Map(
    result.browserObligationBindings?.map(
      (item) => [item.obligationId, item]
    )
  );

  assert.deepEqual(byId.get("blocks")?.allocatedCaseIds, [
    "editor-case",
    "rendered-case",
    "choice-case",
  ]);
  assert.deepEqual(byId.get("mixed")?.allocatedCaseIds, [
    "editor-case",
    "rendered-case",
    "choice-case",
  ]);
  assert.deepEqual(byId.get("rich")?.allocatedCaseIds, [
    "rendered-case",
    "choice-case",
  ]);
  assert.deepEqual(byId.get("choices")?.allocatedCaseIds, ["choice-case"]);
  assert.deepEqual(byId.get("editor")?.allocatedCaseIds, ["editor-case"]);
  assert.equal(
    result.browserObligationBindings?.every(
      (item) => item.state === "UNSUPPORTED_AUTOMATION_SEMANTIC"
    ),
    true
  );
});

test("ambiguous compatible allocation abstains without selecting the first case", () => {
  const required = obligation(
    "ambiguous-search",
    "A search input is required for the collection."
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase("first", "Verify collection search."),
      browserCase("second", "Verify collection search."),
    ]),
    ledgers([required])
  );

  assert.equal(
    result.browserObligationBindings?.[0]?.state,
    "AMBIGUOUS_CASE_ALLOCATION"
  );
  assert.deepEqual(
    result.browserObligationBindings?.[0]?.allocatedCaseIds,
    []
  );
  assert.equal(
    result.browserCases.some(
      (item) => item.acceptanceObligationIds?.includes("ambiguous-search")
    ),
    false
  );
});

test("a server lifecycle obligation remains accounted for without manufacturing a browser case", () => {
  const required = obligation(
    "snapshot",
    "Save a snapshot of the records when a resource is created."
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([]),
    ledgers([required])
  );

  assert.equal(result.browserCases.length, 0);
  assert.deepEqual(result.browserObligationBindings?.[0], {
    obligationId: "snapshot",
    sourceUnitIds: ["source-snapshot"],
    semanticFamily: "SERVER_LIFECYCLE_NON_BROWSER",
    state: "UNALLOCATED_AUTHORITATIVE_OBLIGATION",
    allocatedCaseIds: [],
    reason: "No compatible retained browser case was deterministically available.",
  });
});

test("an authoritative OTHER Task obligation remains serialized and gains no proof authority", () => {
  const sourceLedger: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "SUMMARY_DESCRIPTION_FALLBACK",
    sourceUnits: [{
      id: "source-other-task",
      sourceKind: "DESCRIPTION",
      sourceRef: "jira.description",
      sectionHeading: "Task",
      text: "The details drawer displays Invoice ID.",
    }],
  };
  const obligationLedger =
    buildPlannerAcceptanceObligationLedger(sourceLedger);
  const result = applySourceBackedBrowserObligationBridge(
    plan([]),
    { sourceLedger, obligationLedger }
  );
  result.acceptanceSourceLedger = sourceLedger;
  result.acceptanceObligationLedger = obligationLedger;

  assert.equal(obligationLedger.obligations.length, 1);
  assert.deepEqual(result.browserObligationBindings?.[0], {
    obligationId: obligationLedger.obligations[0]?.id,
    sourceUnitIds: ["source-other-task"],
    semanticFamily: "OTHER",
    state: "UNALLOCATED_AUTHORITATIVE_OBLIGATION",
    allocatedCaseIds: [],
    reason: "No compatible retained browser case was deterministically available.",
  });

  const reloaded = JSON.parse(JSON.stringify(result)) as TestPlan;
  assert.deepEqual(
    reloaded.acceptanceObligationLedger,
    obligationLedger
  );
  assert.equal(
    reloaded.browserObligationBindings?.[0]?.semanticFamily,
    "OTHER"
  );
  assert.notEqual(
    reloaded.browserObligationBindings?.[0]?.state,
    "SUPPORTED_AND_BOUND"
  );
});

test("unsupported automation and genuine manual judgment remain distinct", () => {
  const unsupported = obligation(
    "state",
    "Reset to defaults restores the previous stored value."
  );
  const manual = obligation(
    "manual",
    "A reviewer confirms that the visual composition is aesthetically pleasing."
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase("state-case", "Verify reset to defaults restores state."),
      browserCase("manual-case", "Review the visual composition.", {
        acceptanceObligationIds: ["manual"],
      }),
    ]),
    ledgers([unsupported, manual])
  );
  const byId = new Map(
    result.browserObligationBindings?.map(
      (item) => [item.obligationId, item.state]
    )
  );

  assert.equal(byId.get("state"), "UNSUPPORTED_AUTOMATION_SEMANTIC");
  assert.equal(byId.get("manual"), "MANUAL_BY_NATURE");
});

test("preservation wording stays an unsupported state obligation and is never inverted into mutation proof", () => {
  const required = obligation(
    "unchanged",
    "Completed results remain unchanged."
  );
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase("history", "Verify completed results remain unchanged."),
    ]),
    ledgers([required])
  );

  assert.equal(
    result.browserObligationBindings?.[0]?.semanticFamily,
    "STATE_TRANSITION"
  );
  assert.equal(
    result.browserObligationBindings?.[0]?.state,
    "UNSUPPORTED_AUTOMATION_SEMANTIC"
  );
  assert.equal(
    result.browserCases[0]?.acceptanceScope?.collectionFilterRequirements,
    undefined
  );
});

test("one grouped-control case cannot inherit unrelated worker state obligations", () => {
  const obligations = [
    obligation(
      "ui-default",
      "Custom scoring shows the new value and Reset to defaults restores it."
    ),
    obligation(
      "worker-score",
      "Two events with no custom configuration score 98 and pass."
    ),
    obligation(
      "stored-override",
      "An explicit stored custom value overrides the worker default."
    ),
    obligation(
      "completed-history",
      "Completed results remain unchanged."
    ),
  ];
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "ui-case",
        "Verify the Custom scoring controls and Reset to defaults behavior."
      ),
    ]),
    ledgers(obligations)
  );
  const byId = new Map(
    result.browserObligationBindings?.map(
      (item) => [item.obligationId, item]
    )
  );

  assert.deepEqual(byId.get("ui-default")?.allocatedCaseIds, ["ui-case"]);
  for (const id of [
    "worker-score",
    "stored-override",
    "completed-history",
  ]) {
    assert.equal(
      byId.get(id)?.state,
      "UNALLOCATED_AUTHORITATIVE_OBLIGATION"
    );
    assert.deepEqual(byId.get(id)?.allocatedCaseIds, []);
  }
  assert.deepEqual(
    result.browserCases[0]?.acceptanceObligationIds,
    ["ui-default"]
  );
});

test("source-authorized reset default emits one typed local-state requirement", () => {
  const required = obligation(
    "reset-default",
    resetDefaultClaim
  );
  const metadata = ledgers([required]);
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "settings",
        "Verify Reset to defaults restores the Penalty Weight."
      ),
    ]),
    {
      ...metadata,
      sourceContext: frontendDefaultPatch(),
    }
  );
  const requirement = result.browserCases[0]
    ?.acceptanceScope
    ?.localControlStateTransitionRequirements?.[0];

  assert.equal(
    requirement?.kind,
    "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT"
  );
  assert.equal(requirement?.obligationId, "reset-default");
  assert.deepEqual(requirement?.sourceRefs, [{
    sourceUnitId: "source-reset-default",
    sourceRef: "jira.description",
    sourceRole: "ACCEPTANCE",
  }]);
  assert.deepEqual(requirement?.authority, {
    sourceRole: "ACCEPTANCE",
    proofAuthority: "ACCEPTANCE",
  });
  assert.deepEqual(requirement?.transition, {
    semantic: "RESET_RESTORES_DEFAULT",
    expectedValue: -3,
    expectedValueAuthority: "JIRA_AUTHORIZED",
  });
  assert.deepEqual(requirement?.structuralBinding, {
    sourceEvidenceRefs: [
      "src/components/Settings.tsx",
    ],
    valueBinding: {
      evidenceKind: "LABELLED_DEFAULT_PROPERTY",
      sourceLabel: "Penalty Weight",
      sourceProperty: "defaultWeight",
    },
  });
  assert.equal(
    result.browserObligationBindings?.[0]?.state,
    "SUPPORTED_AND_BOUND"
  );
  assert.deepEqual(
    result.browserObligationBindings?.[0]
      ?.emittedRequirementIds,
    [requirement?.requirementId]
  );
});

test("typed local-state requirement survives normalized plan reload and dispatch", () => {
  const required = obligation(
    "retained-reset-default",
    resetDefaultClaim
  );
  const metadata = ledgers([required]);
  const bridged = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "settings",
        "Verify Reset to defaults restores the Penalty Weight."
      ),
    ]),
    {
      ...metadata,
      sourceContext: frontendDefaultPatch(),
    }
  );
  const emitted = bridged.browserCases[0]
    ?.acceptanceScope
    ?.localControlStateTransitionRequirements?.[0];

  assert.ok(emitted);
  normalizePlannerBrowserScopes(bridged, {
    acceptanceSourceLedger: metadata.sourceLedger,
    acceptanceObligationLedger:
      metadata.obligationLedger,
  });

  const normalizedRequirements = bridged.browserCases[0]
    ?.acceptanceScope
    ?.localControlStateTransitionRequirements;
  assert.equal(normalizedRequirements?.length, 1);
  assert.deepEqual(normalizedRequirements?.[0], emitted);

  const serialized = JSON.stringify(bridged);
  const reloaded = JSON.parse(serialized) as TestPlan;
  const reloadedRequirements = reloaded.browserCases[0]
    ?.acceptanceScope
    ?.localControlStateTransitionRequirements;

  assert.equal(reloadedRequirements?.length, 1);
  assert.deepEqual(reloadedRequirements?.[0], emitted);
  assert.equal(
    reloadedRequirements?.[0]?.requirementId,
    emitted.requirementId
  );

  const dispatch =
    dispatchBrowserDeterministicCapability({
      caseId: "settings",
      obligationId: required.id,
      acceptanceScope:
        reloaded.browserCases[0]?.acceptanceScope,
    });

  assert.equal(dispatch.status, "MATCHED");
  if (dispatch.status !== "MATCHED") return;
  assert.equal(
    dispatch.candidate.requirementId,
    emitted.requirementId
  );
  assert.equal(
    dispatch.candidate.capabilityKind,
    "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION"
  );
  assert.deepEqual(
    dispatch.candidate.requirement,
    emitted
  );
});

test("local-state requirement ID is stable across source and case order changes", () => {
  const required = obligation(
    "stable-reset",
    resetDefaultClaim
  );
  const metadata = ledgers([required]);
  const makeCase = (id: string) =>
    browserCase(
      id,
      "Verify Reset to defaults restores the Penalty Weight.",
      { acceptanceObligationIds: [required.id] }
    );
  const first = applySourceBackedBrowserObligationBridge(
    plan([makeCase("one"), makeCase("two")]),
    {
      ...metadata,
      sourceContext: frontendDefaultPatch(),
    }
  );
  const second = applySourceBackedBrowserObligationBridge(
    plan([makeCase("two"), makeCase("one")]),
    {
      ...metadata,
      sourceContext: [
        frontendDefaultPatch(),
        frontendDefaultPatch(),
      ].reverse().join("\n"),
    }
  );
  const ids = (result: TestPlan) =>
    result.browserCases.map(
      (item) => item.acceptanceScope
        ?.localControlStateTransitionRequirements?.[0]
        ?.requirementId
    );

  assert.equal(new Set(ids(first)).size, 1);
  assert.equal(new Set(ids(second)).size, 1);
  assert.equal(ids(first)[0], ids(second)[0]);
  assert.deepEqual(
    first.browserObligationBindings?.[0]?.allocatedCaseIds,
    ["one", "two"]
  );
  assert.deepEqual(
    second.browserObligationBindings?.[0]?.allocatedCaseIds,
    ["two", "one"]
  );
});

test("coarse grouped-controls classification does not block an exact reset contract", () => {
  const required = obligation(
    "grouped-reset",
    "A new form with Custom scoring enabled shows Looking Away as -1; Reset to defaults restores -1."
  );
  const metadata = ledgers([required]);
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "grouped",
        "Verify Custom scoring and Reset to defaults."
      ),
    ]),
    {
      ...metadata,
      sourceContext: frontendDefaultPatch({
        label: "Looking Away",
        expectedValue: -1,
      }),
    }
  );

  assert.equal(
    result.browserObligationBindings?.[0]?.semanticFamily,
    "GROUPED_CONTROLS"
  );
  assert.equal(
    result.browserObligationBindings?.[0]?.state,
    "SUPPORTED_AND_BOUND"
  );
  assert.equal(
    result.browserCases[0]?.acceptanceScope
      ?.localControlStateTransitionRequirements?.length,
    1
  );
});

test("local-state requirement guards reject incomplete or ungrounded authority", async (t) => {
  const scenarios: Array<{
    name: string;
    claim: string;
    sourceContext?: string;
    mutate?: (args: {
      plan: TestPlan;
      metadata: ReturnType<typeof ledgers>;
    }) => void;
  }> = [
    {
      name: "known issue key without transition source",
      claim: "Grouped controls are visible.",
      sourceContext: frontendDefaultPatch(),
      mutate: ({ plan }) => {
        plan.issueKey = "AS-1402";
      },
    },
    {
      name: "planner reset prose without Jira reset",
      claim: "The value is visible.",
      sourceContext: frontendDefaultPatch(),
      mutate: ({ plan }) => {
        plan.browserCases[0]!.manualChecks = [
          "Reset to defaults restores -3.",
        ];
      },
    },
    {
      name: "frontend reset without Jira reset",
      claim: "The default Penalty Weight is -3.",
      sourceContext: `${frontendDefaultPatch()}\n<Button>Reset</Button>`,
    },
    {
      name: "default value without transition",
      claim: "A new record shows Penalty Weight as -3.",
      sourceContext: frontendDefaultPatch(),
    },
    {
      name: "reset without exact expected value",
      claim: "Reset to defaults restores the Penalty Weight.",
      sourceContext: frontendDefaultPatch(),
    },
    {
      name: "grouped controls without transition semantics",
      claim: "The form groups radio and checkbox controls.",
      sourceContext: frontendDefaultPatch(),
    },
    {
      name: "unrelated labelled default source",
      claim: resetDefaultClaim,
      sourceContext: frontendDefaultPatch({
        label: "Unrelated Limit",
      }),
    },
    {
      name: "matching label and default property in unrelated source units",
      claim: resetDefaultClaim,
      sourceContext: [
        "--- GITHUB CHANGE CONTEXT ---",
        "Patch for src/components/PenaltyLabel.tsx:",
        "+ const label = 'Penalty Weight';",
        "Patch for src/constants/defaults.ts:",
        "+ const defaults = { defaultWeight: -3 };",
      ].join("\n"),
    },
    {
      name: "route hint without frontend binding",
      claim: resetDefaultClaim,
      sourceContext: "Patch for src/routes.tsx:\n+ path: '/settings'",
    },
    {
      name: "implementation default without Jira authority",
      claim: "The settings page is available.",
      sourceContext: frontendDefaultPatch(),
    },
    {
      name: "ambiguous allocation",
      claim: resetDefaultClaim,
      sourceContext: frontendDefaultPatch(),
      mutate: ({ plan }) => {
        plan.browserCases.push(
          browserCase(
            "second",
            "Verify Reset to defaults restores the Penalty Weight."
          )
        );
      },
    },
    {
      name: "unallocated obligation",
      claim: resetDefaultClaim,
      sourceContext: frontendDefaultPatch(),
      mutate: ({ plan }) => {
        plan.browserCases[0]!.goal = "Review unrelated pagination.";
        plan.browserCases[0]!.successCriteria = "Pagination is visible.";
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const required = obligation(
        `negative-${scenario.name}`,
        scenario.claim
      );
      const metadata = ledgers([required]);
      const candidatePlan = plan([
        browserCase(
          "first",
          "Verify Reset to defaults restores the Penalty Weight."
        ),
      ]);
      scenario.mutate?.({
        plan: candidatePlan,
        metadata,
      });
      const result = applySourceBackedBrowserObligationBridge(
        candidatePlan,
        {
          ...metadata,
          ...(scenario.sourceContext
            ? {
                sourceContext:
                  scenario.sourceContext,
              }
            : {}),
        }
      );

      assert.equal(
        result.browserCases.some(
          (item) =>
            (item.acceptanceScope
              ?.localControlStateTransitionRequirements
              ?.length ?? 0) > 0
        ),
        false
      );
      assert.notEqual(
        result.browserObligationBindings?.[0]?.state,
        "SUPPORTED_AND_BOUND"
      );
    });
  }
});

test("unrelated authoritative source units cannot be merged into one local-state requirement", () => {
  const required = obligation(
    "split-authority",
    resetDefaultClaim
  );
  required.sourceUnitIds = [
    "source-default",
    "source-reset",
  ];
  const metadata = ledgers([required]);
  metadata.sourceLedger.sourceUnits = [
    {
      id: "source-default",
      sourceKind: "DESCRIPTION",
      sourceRef: "jira.description",
      sectionHeading: "Acceptance Criteria",
      text: "The default Penalty Weight is -3.",
    },
    {
      id: "source-reset",
      sourceKind: "DESCRIPTION",
      sourceRef: "jira.description",
      sectionHeading: "Acceptance Criteria",
      text: "Reset to defaults restores -3.",
    },
  ];
  const result = applySourceBackedBrowserObligationBridge(
    plan([
      browserCase(
        "settings",
        "Verify Reset to defaults restores the Penalty Weight."
      ),
    ]),
    {
      ...metadata,
      sourceContext: frontendDefaultPatch(),
    }
  );

  assert.equal(
    result.browserCases[0]?.acceptanceScope
      ?.localControlStateTransitionRequirements,
    undefined
  );
});
