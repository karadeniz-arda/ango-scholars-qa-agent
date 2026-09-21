import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserTestCase, PlannerAcceptanceObligationLedger, PlannerAcceptanceSourceLedger } from "../../planner/types.js";
import {
  BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS,
  type BrowserObservation,
} from "./browser-observation.js";
import {
  allocateBrowserRuntimeSourceAssertions,
  buildBrowserSourceBoundAssertionSetRequirements,
  buildBrowserSourceDerivedAssertionCheckCarriers,
  collectBrowserSourceBoundAssertionSetTelemetry,
  evaluateBrowserSourceBoundAssertionSet,
  evaluateBrowserSourceBoundAssertionSetDischarge,
  observeBrowserSourceDerivedButtonCarriers,
  SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_MARKER,
  summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry,
} from "./browser-source-bound-assertion-set-proof.js";
import {
  buildGenericBrowserAssertionHandoffCase,
} from "./browser-agent-assertion-handoff.js";

const sourceLedger: PlannerAcceptanceSourceLedger = {
  sourceStatus: "RESOLVED", basis: "ACCEPTANCE_CRITERIA",
  sourceUnits: [{ id: "ac-1", sourceKind: "ACCEPTANCE_CRITERIA", sourceRef: "jira:AC-1", text: "The control uses Alpha, Beta, Gamma, and Delta." }],
};
const ledger: PlannerAcceptanceObligationLedger = {
  sourceStatus: "RESOLVED", derivationStatus: "RESOLVED", unresolvedSourceUnitIds: [],
  obligations: [{ id: "ob-1", sourceUnitIds: ["ac-1"], sourceRole: "ACCEPTANCE", derivation: "DIRECT_ACCEPTANCE_FIELD", text: "The control uses Alpha, Beta, Gamma, and Delta." }],
};
function browserCase(overrides: Partial<BrowserTestCase> = {}): BrowserTestCase {
  return { id: "case-1", persona: "company_admin", goal: "Observe control", startRoute: "/control", successCriteria: "Enumerated values visible", acceptanceObligationIds: ["ob-1"], steps: ["Alpha", "Beta", "Gamma", "Delta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `oracle-${text}` })), ...overrides };
}
function requirement(testCase = browserCase()) {
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  assert.equal(requirements.length, 1);
  return requirements[0]!;
}
function confirmed(req = requirement()) {
  return evaluateBrowserSourceBoundAssertionSet({ requirement: req, deterministicEvidence: req.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "visible" })), actualPersona: "company_admin", actualRoutePath: "/control", freshObservation: true });
}
function visibleEvidence(testCase = browserCase()) {
  return (testCase.steps ?? [])
    .filter((step) => step.action === "assertTextVisible")
    .map((step, stepIndex) => ({
    stepIndex,
    oracleId: step.oracleId!,
    action: step.action as "assertTextVisible",
    expected: step.text,
    passed: true,
    note: "visible",
  }));
}

function buttonObservation(
  controls: Array<{ kind: "button" | "link" | "control"; label: string; role: string }>
): BrowserObservation {
  return {
    url: "https://example.test/control",
    title: "Control",
    headings: [],
    controls: controls.map((control) => ({
      ...control,
      disabled: false,
      selected: null,
      expanded: null,
      checked: null,
    })),
    inputs: [],
    surfaces: [],
    visibleText: [],
    counts: { headings: 0, controls: controls.length, inputs: 0, surfaces: 0, visibleText: 0 },
  };
}

function directButtonAuthority(args: {
  sourceText?: string;
  steps?: BrowserTestCase["steps"];
} = {}) {
  const sourceText = args.sourceText ?? "Add a “Download as PDF” button to the contract details page.";
  const source: PlannerAcceptanceSourceLedger = {
    sourceStatus: "RESOLVED",
    basis: "SUMMARY_DESCRIPTION_FALLBACK",
    sourceUnits: [{ id: "task-button", sourceKind: "DESCRIPTION", sourceRef: "jira.description", sectionHeading: "Task", text: sourceText }],
  };
  const taskLedger: PlannerAcceptanceObligationLedger = {
    sourceStatus: "RESOLVED",
    derivationStatus: "RESOLVED",
    unresolvedSourceUnitIds: [],
    obligations: [{ id: "button-obligation", sourceUnitIds: ["task-button"], sourceRole: "TASK", derivation: "DIRECT_TASK_SECTION", text: sourceText }],
  };
  const testCase = browserCase({
    id: "button-case",
    acceptanceObligationIds: ["button-obligation"],
    steps: args.steps ?? [],
  });
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({
    testCase,
    obligationLedger: taskLedger,
    sourceLedger: source,
    acceptedRoutePath: "/control",
  });
  return { source, taskLedger, testCase, requirements };
}

test("BUTTON_LABEL synthesizes an exact semantic-button carrier without planner assertion text", () => {
  const { taskLedger, testCase, requirements } = directButtonAuthority();
  assert.equal(requirements.length, 1);
  const req = requirements[0]!;
  assert.equal(req.sourceSupportedUiRelation, "BUTTON_LABEL");
  assert.deepEqual(req.buttonCarrier, {
    kind: "SOURCE_DERIVED_EXACT_VISIBLE_BUTTON",
    member: "download as pdf",
    targetContext: "GENERIC_BROWSER_ASSERTION_HANDOFF",
  });
  assert.deepEqual(req.members.map((member) => member.action), ["assertExactVisibleButton"]);
  const buttonCarrierObservations = observeBrowserSourceDerivedButtonCarriers({
    requirements,
    observation: buttonObservation([{ kind: "button", role: "button", label: "Download as PDF" }]),
    targetContextGrounded: true,
  });
  const evidence = evaluateBrowserSourceBoundAssertionSet({
    requirement: req,
    deterministicEvidence: [],
    buttonCarrierObservations,
    actualPersona: "company_admin",
    actualRoutePath: "/control",
    freshObservation: true,
  });
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: testCase, allCases: [testCase], obligationLedger: taskLedger, requirements })[0]!;
  assert.equal(evidence.result, "CONFIRMED");
  assert.equal(evaluateBrowserSourceBoundAssertionSetDischarge({ testCase, obligationLedger: taskLedger, allocation, requirement: req, evidence }).status, "DETERMINISTIC_OBLIGATION_PROVED");
});

test("BUTTON_LABEL carrier is planner-text independent and distinguishes grounded absence from ambiguity", () => {
  for (const steps of [
    [],
    [{ action: "assertTextVisible", text: "Download your PDF now", oracleId: "paraphrase" }] as BrowserTestCase["steps"],
  ]) {
    const { requirements } = directButtonAuthority({ steps });
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0]!.members[0]!.expectedText, "download as pdf");
  }

  const { requirements } = directButtonAuthority();

  for (const variation of [
    {
      controls: [
        {
          kind: "link" as const,
          role: "link",
          label: "Download as PDF",
        },
      ],
      targetContextGrounded: true,
      expected: "CONTRADICTED",
    },
    {
      controls: [
        {
          kind: "button" as const,
          role: "button",
          label: "Download as PDF",
        },
        {
          kind: "button" as const,
          role: "button",
          label: "Download as PDF",
        },
      ],
      targetContextGrounded: true,
      expected: "NOT_CONFIRMED",
    },
    {
      controls: [
        {
          kind: "button" as const,
          role: "button",
          label: "Download as PDF",
        },
      ],
      targetContextGrounded: false,
      expected: "NOT_CONFIRMED",
    },
    {
      controls: [],
      targetContextGrounded: true,
      expected: "CONTRADICTED",
    },
  ]) {
    const observations =
      observeBrowserSourceDerivedButtonCarriers({
        requirements,
        observation:
          buttonObservation(
            variation.controls
          ),
        targetContextGrounded:
          variation.targetContextGrounded,
      });

    assert.equal(
      observations[0]!.result,
      variation.expected
    );
  }
});

test("BUTTON_LABEL grounded absence becomes contradicted evidence but bounded incompleteness abstains", () => {
  const {
    taskLedger,
    testCase,
    requirements,
  } = directButtonAuthority();

  const requirement =
    requirements[0]!;

  const absent =
    observeBrowserSourceDerivedButtonCarriers({
      requirements,
      observation:
        buttonObservation([]),
      targetContextGrounded: true,
    });

  assert.equal(
    absent[0]!.result,
    "CONTRADICTED"
  );

  const evidence =
    evaluateBrowserSourceBoundAssertionSet({
      requirement,
      deterministicEvidence: [],
      buttonCarrierObservations: absent,
      actualPersona: "company_admin",
      actualRoutePath: "/control",
      freshObservation: true,
    });

  assert.equal(
    evidence.members[0]!.result,
    "CONTRADICTED"
  );
  assert.equal(
    evidence.result,
    "NOT_CONFIRMED"
  );

  const allocation =
    allocateBrowserRuntimeSourceAssertions({
      currentCase: testCase,
      allCases: [testCase],
      obligationLedger: taskLedger,
      requirements,
    })[0]!;

  assert.equal(
    evaluateBrowserSourceBoundAssertionSetDischarge({
      testCase,
      obligationLedger: taskLedger,
      allocation,
      requirement,
      evidence,
    }).status,
    "NOT_PROVED"
  );

  const capped =
    observeBrowserSourceDerivedButtonCarriers({
      requirements,
      observation:
        buttonObservation(
          Array.from(
            {
              length:
                BROWSER_OBSERVATION_DEFAULT_MAX_CONTROLS,
            },
            (_, index) => ({
              kind: "button" as const,
              role: "button",
              label: `Other ${index}`,
            })
          )
        ),
      targetContextGrounded: true,
    });

  assert.equal(
    capped[0]!.result,
    "NOT_CONFIRMED"
  );

  const modalObservation =
    buttonObservation([]);

  modalObservation.surfaces = [{
    kind: "dialog",
    label: "Open dialog",
    role: "dialog",
    modal: true,
    textPreview: "Open dialog",
  }];

  const modal =
    observeBrowserSourceDerivedButtonCarriers({
      requirements,
      observation: modalObservation,
      targetContextGrounded: true,
    });

  assert.equal(
    modal[0]!.result,
    "NOT_CONFIRMED"
  );
});

test("BUTTON_LABEL carrier cannot confirm with stale or persona/route-mismatched context", () => {
  const { requirements } = directButtonAuthority();
  const req = requirements[0]!;
  const buttonCarrierObservations = observeBrowserSourceDerivedButtonCarriers({
    requirements,
    observation: buttonObservation([{ kind: "button", role: "button", label: "Download as PDF" }]),
    targetContextGrounded: true,
  });
  for (const context of [
    { actualPersona: "talent", actualRoutePath: "/control", freshObservation: true },
    { actualPersona: "company_admin", actualRoutePath: "/other", freshObservation: true },
    { actualPersona: "company_admin", actualRoutePath: "/control", freshObservation: false },
  ]) {
    assert.equal(evaluateBrowserSourceBoundAssertionSet({
      requirement: req,
      deterministicEvidence: [],
      buttonCarrierObservations,
      ...context,
    }).result, "NOT_CONFIRMED");
  }
});

test("semantic description-mention prose does not become exact text authority", () => {
  const description = directButtonAuthority({
    sourceText:
      "Update the Skills step description to mention that users can add up to 10 skills.",
  });

  assert.deepEqual(description.requirements, []);

  const plannerOnly = directButtonAuthority({
    sourceText: "Improve the contract details page.",
  });

  assert.deepEqual(plannerOnly.requirements, []);
});

test("recognizes explicit enumerated presence and discharges all required members", () => {
  const testCase = browserCase(); const req = requirement(testCase); const evidence = confirmed(req);
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: testCase, allCases: [testCase], obligationLedger: ledger, requirements: [req] })[0]!;
  const decision = evaluateBrowserSourceBoundAssertionSetDischarge({ testCase, obligationLedger: ledger, allocation, requirement: req, evidence });
  assert.equal(evidence.result, "CONFIRMED");
  assert.equal(req.semanticFamily, "EXPLICIT_ENUMERATED_PRESENCE");
  assert.equal(decision.status, "DETERMINISTIC_OBLIGATION_PROVED");
  if (decision.status === "DETERMINISTIC_OBLIGATION_PROVED") assert.equal(decision.discharge.proofKind, "SOURCE_BOUND_ASSERTION_SET");
});

test("MODEL_STEP_MISMATCH_CANNOT_OVERRIDE_SOURCE_SUPPORTED_PROOF_V1", () => {
  const testCase = browserCase({ steps: [{ action: "assertTextVisible", text: "planner-only promise", oracleId: "oracle" }] });
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  assert.deepEqual(
    requirements[0]!.members.map((member) => member.expectedText),
    ["Alpha", "Beta", "Gamma", "Delta"]
  );
  assert.equal(requirements[0]!.members.some((member) => member.oracleId === "oracle"), false);
});

test("direct Task description semantics fail closed without an exact-copy contract", () => {
  const source = {
    ...sourceLedger,
    sourceUnits: [{
      id: "task-1",
      sourceKind: "DESCRIPTION" as const,
      sourceRef: "jira.description",
      text:
        "Update the Skills step description to mention that users can add up to 10 skills.",
    }],
  };

  const taskLedger = {
    ...ledger,
    obligations: [{
      id: "task-obligation",
      sourceUnitIds: ["task-1"],
      sourceRole: "TASK" as const,
      derivation: "DIRECT_TASK_SECTION" as const,
      text: source.sourceUnits[0]!.text,
    }],
  };

  const testCase = browserCase({
    acceptanceObligationIds: ["task-obligation"],
    steps: [{
      action: "assertTextVisible",
      text: "Add up to 10 skills",
      oracleId: "skills-limit",
    }],
  });

  assert.deepEqual(
    buildBrowserSourceBoundAssertionSetRequirements({
      testCase,
      obligationLedger: taskLedger,
      sourceLedger: source,
      acceptedRoutePath: "/skills",
    }),
    []
  );
});

test("planner carrier cannot promote semantic description prose into exact text authority", () => {
  const sourceText =
    "Update the Skills step description to mention that users can add up to 10 skills.";

  const source = {
    ...sourceLedger,
    sourceUnits: [{
      id: "task-1",
      sourceKind: "DESCRIPTION" as const,
      sourceRef: "jira.description",
      text: sourceText,
    }],
  };

  const taskLedger = {
    ...ledger,
    obligations: [{
      id: "task-obligation",
      sourceUnitIds: ["task-1"],
      sourceRole: "TASK" as const,
      derivation: "DIRECT_TASK_SECTION" as const,
      text: sourceText,
    }],
  };

  const testCase = browserCase({
    acceptanceObligationIds: ["task-obligation"],
    steps: [{
      action: "assertTextVisible",
      text:
        "Add up to 10 skills to get better job matches. You can edit them later.",
      oracleId: "planner-long-copy",
    }],
  });

  const requirements =
    buildBrowserSourceBoundAssertionSetRequirements({
      testCase,
      obligationLedger: taskLedger,
      sourceLedger: source,
      acceptedRoutePath: "/skills",
    });

  assert.deepEqual(requirements, []);

  assert.deepEqual(
    buildBrowserSourceDerivedAssertionCheckCarriers({
      testCase,
      requirements,
    }),
    []
  );

  assert.equal(testCase.steps?.length, 1);
});

test("negative assertion requires explicit absence semantics in its authoritative source", () => {
  const testCase = browserCase({ steps: ["Legacy Alpha", "Legacy Beta"].map((text) => ({ action: "assertTextNotVisible" as const, text, oracleId: `oracle-${text}` })) });
  assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: ledger, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "Legacy Alpha and Legacy Beta are visible." }] }, acceptedRoutePath: "/control" }), []);
  const negativeSource = { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "Legacy Alpha and Legacy Beta are no longer shown in the client UI." }] };
  const negativeLedger = { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: "Legacy Alpha and Legacy Beta are no longer shown in the client UI." }] };
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: negativeLedger, sourceLedger: negativeSource, acceptedRoutePath: "/control" });
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.semanticFamily, "EXPLICIT_ENUMERATED_ABSENCE");
});

test("enumerated admission ignores model-member mismatch and rejects non-authoritative or behavioral source prose", () => {
  const withEpsilon = browserCase({ steps: ["Alpha", "Beta", "Gamma", "Epsilon"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `oracle-${text}` })) });
  assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase: withEpsilon, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" })[0]!.members.map((member) => member.expectedText), ["Alpha", "Beta", "Gamma", "Delta"]);
  for (const sourceRole of ["TASK", "EXPECTED_BEHAVIOR"] as const) {
    assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase: browserCase(), obligationLedger: { ...ledger, obligations: [{ ...ledger.obligations[0]!, sourceRole }] }, sourceLedger, acceptedRoutePath: "/control" }), []);
  }
  for (const text of [
    "Migration preserves Alpha, Beta, Gamma, and Delta with no data loss.",
    "Create and update works for Alpha, Beta, Gamma, and Delta.",
    "The filter works for Alpha, Beta, Gamma, and Delta.",
    "Profile sections display the new fields correctly.",
  ]) {
    const caseForText = text.includes("fields correctly")
      ? browserCase({ steps: ["Alpha", "Beta"].map((label) => ({ action: "assertTextVisible" as const, text: label, oracleId: `oracle-${label}` })) })
      : browserCase();
    const semanticLedger = { ...ledger, obligations: [{ ...ledger.obligations[0]!, text }] };
    const semanticSource = { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text }] };
    assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase: caseForText, obligationLedger: semanticLedger, sourceLedger: semanticSource, acceptedRoutePath: "/control" }), []);
  }
});

test("mixed canonical assertions partition source admission by exact action family", () => {
  const mixedCase = browserCase({ steps: [
    ...["Alpha", "Beta", "Gamma", "Delta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `visible-${text}` })),
    ...["Legacy Alpha", "Legacy Beta"].map((text) => ({ action: "assertTextNotVisible" as const, text, oracleId: `absent-${text}` })),
  ] });
  const presence = buildBrowserSourceBoundAssertionSetRequirements({ testCase: mixedCase, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  assert.equal(presence.length, 1);
  assert.equal(presence[0]!.semanticFamily, "EXPLICIT_ENUMERATED_PRESENCE");
  assert.deepEqual(presence[0]!.members.map((member) => member.expectedText), ["Alpha", "Beta", "Gamma", "Delta"]);
  assert.ok(presence[0]!.members.every((member) => member.action === "assertTextVisible"));
  const absenceText = "Legacy Alpha and Legacy Beta are no longer shown.";
  const absence = buildBrowserSourceBoundAssertionSetRequirements({ testCase: mixedCase, obligationLedger: { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: absenceText }] }, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: absenceText }] }, acceptedRoutePath: "/control" });
  assert.equal(absence.length, 1);
  assert.equal(absence[0]!.semanticFamily, "EXPLICIT_ENUMERATED_ABSENCE");
  assert.deepEqual(absence[0]!.members.map((member) => member.expectedText), ["Legacy Alpha", "Legacy Beta"]);
  assert.ok(absence[0]!.members.every((member) => member.action === "assertTextNotVisible"));
});

test("an assertion carrier supplies members without replacing execution authority", () => {
  const owner = browserCase({ id: "owner-case", persona: "company_admin", steps: [], acceptanceObligationIds: ["ob-1"] });
  const carrier = browserCase({ id: "carrier-case", persona: "talent", acceptanceObligationIds: ["sibling-obligation"] });
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase: owner, assertionSourceCase: carrier, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.executionCaseId, "owner-case");
  assert.equal(requirements[0]!.persona, "company_admin");
  assert.equal(requirements[0]!.obligationId, "ob-1");
  assert.deepEqual(requirements[0]!.members.map((member) => member.expectedText), ["Alpha", "Beta", "Gamma", "Delta"]);
});

test("MODEL_STEP_ABSENCE_CANNOT_ERASE_SOURCE_SUPPORTED_PROOF_V1", () => {
  const owner = browserCase({ id: "owner-case", steps: [], acceptanceObligationIds: ["ob-1"] });
  const carrier = buildGenericBrowserAssertionHandoffCase({
    id: "handoff-case",
    steps: ["Alpha", "Beta", "Gamma", "Delta"].map((text) => ({ action: "assertTextVisible", text })),
  })!;
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase: owner, assertionSourceCase: carrier, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  const withoutCarrier = buildBrowserSourceBoundAssertionSetRequirements({ testCase: owner, obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/control" });
  assert.deepEqual(requirements[0]!.members, withoutCarrier[0]!.members);
  assert.ok(requirements[0]!.members.every((member) => member.oracleId.startsWith("source-member-")));
  const evidence = evaluateBrowserSourceBoundAssertionSet({ requirement: requirements[0]!, deterministicEvidence: requirements[0]!.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: `Text is visible: ${member.expectedText}`, passed: true, note: "executor-shaped" })), actualPersona: "company_admin", actualRoutePath: "/control", freshObservation: true });
  // Executor prefixes expected text; proof matching normalizes the canonical suffix.
  assert.equal(evidence.result, "CONFIRMED");
});

test("canonical handoff transports the source-authorized oracle identity exactly", () => {
  const owner = browserCase({ id: "owner-case", steps: [], acceptanceObligationIds: ["ob-1"] });
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({
    testCase: owner,
    assertionSourceCase: browserCase({
      id: "handoff-case",
      steps: ["Alpha", "Beta", "Gamma", "Delta"].map((text) => ({
        action: "assertTextVisible" as const,
        text,
        oracleId: `handoff-${text}`,
      })),
    }),
    obligationLedger: ledger,
    sourceLedger,
    acceptedRoutePath: "/control",
  });
  const handoff = buildGenericBrowserAssertionHandoffCase(
    owner,
    null,
    requirements,
  );
  assert.ok(handoff);
  assert.deepEqual(
    handoff.steps.map((step: { oracleId?: string }) => step.oracleId),
    requirements[0]!.members.map((member) => member.oracleId),
  );
  const evidence = evaluateBrowserSourceBoundAssertionSet({
    requirement: requirements[0]!,
    deterministicEvidence: handoff.steps.map((step: any, stepIndex: number) => ({
      stepIndex,
      oracleId: step.oracleId,
      action: step.action,
      expected: step.text,
      passed: true,
      note: "canonical handoff",
    })),
    actualPersona: "company_admin",
    actualRoutePath: "/control",
    freshObservation: true,
  });
  assert.equal(evidence.result, "CONFIRMED");
  const mismatched = evaluateBrowserSourceBoundAssertionSet({
    requirement: requirements[0]!,
    deterministicEvidence: handoff.steps.map((step: any, stepIndex: number) => ({
      stepIndex,
      oracleId: `wrong-${step.oracleId}`,
      action: step.action,
      expected: step.text,
      passed: true,
      note: "wrong identity",
    })),
    actualPersona: "company_admin",
    actualRoutePath: "/control",
    freshObservation: true,
  });
  assert.equal(mismatched.result, "NOT_CONFIRMED");
  assert.ok(mismatched.members.every((member) => member.result === "NOT_EXECUTED"));
});

test("an assertion carrier supports absence members without overriding authoritative obligation ownership", () => {
  const owner = browserCase({ id: "absence-owner", steps: [], acceptanceObligationIds: ["ob-1"] });
  const carrier = browserCase({ id: "absence-carrier", acceptanceObligationIds: ["sibling-obligation"], steps: ["Legacy Alpha", "Legacy Beta"].map((text) => ({ action: "assertTextNotVisible" as const, text, oracleId: `oracle-${text}` })) });
  const sourceText = "Legacy Alpha and Legacy Beta are no longer shown.";
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase: owner, assertionSourceCase: carrier, obligationLedger: { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: sourceText }] }, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: sourceText }] }, acceptedRoutePath: "/control" });
  assert.equal(requirements.length, 1);
  assert.equal(requirements[0]!.executionCaseId, "absence-owner");
  assert.equal(requirements[0]!.obligationId, "ob-1");
  assert.deepEqual(requirements[0]!.members.map((member) => member.expectedText), ["Legacy Alpha", "Legacy Beta"]);
});

test("an obligation cannot borrow action-compatible source members from its sibling", () => {
  const mixedCase = browserCase({ acceptanceObligationIds: ["ob-1", "ob-2"], steps: ["Alpha", "Beta", "Gamma", "Delta"].map((text) => ({ action: "assertTextVisible" as const, text, oracleId: `oracle-${text}` })) });
  const siblingLedger = { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: "The control uses Alpha and Beta." }, { id: "ob-2", sourceUnitIds: ["ac-2"], sourceRole: "ACCEPTANCE" as const, derivation: "DIRECT_ACCEPTANCE_FIELD" as const, text: "The control uses Gamma and Delta." }] };
  const siblingSource = { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "The control uses Alpha and Beta." }, { id: "ac-2", sourceKind: "ACCEPTANCE_CRITERIA" as const, sourceRef: "jira:AC-2", text: "The control uses Gamma and Delta." }] };
  const requirements = buildBrowserSourceBoundAssertionSetRequirements({ testCase: mixedCase, obligationLedger: siblingLedger, sourceLedger: siblingSource, acceptedRoutePath: "/control" });
  assert.deepEqual(requirements.map((requirement) => requirement.members.map((member) => member.expectedText)), [["Alpha", "Beta"], ["Gamma", "Delta"]]);
});

test("unique explicit enumerated absence discharges only with fresh complete evidence", () => {
  const testCase = browserCase({ steps: ["Legacy Alpha", "Legacy Beta"].map((text) => ({ action: "assertTextNotVisible" as const, text, oracleId: `oracle-${text}` })) });
  const absenceSource = { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "Legacy Alpha and Legacy Beta are no longer shown in the client UI." }] };
  const absenceLedger = { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: "Legacy Alpha and Legacy Beta are no longer shown in the client UI." }] };
  const req = buildBrowserSourceBoundAssertionSetRequirements({ testCase, obligationLedger: absenceLedger, sourceLedger: absenceSource, acceptedRoutePath: "/control" })[0]!;
  const evidence = evaluateBrowserSourceBoundAssertionSet({ requirement: req, deterministicEvidence: req.members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "absent" })), actualPersona: "company_admin", actualRoutePath: "/control", freshObservation: true });
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: testCase, allCases: [testCase], obligationLedger: absenceLedger, requirements: [req] })[0]!;
  assert.equal(evaluateBrowserSourceBoundAssertionSetDischarge({ testCase, obligationLedger: absenceLedger, allocation, requirement: req, evidence }).status, "DETERMINISTIC_OBLIGATION_PROVED");
});

test("duplicate, failed, stale, or context-mismatched evidence cannot confirm", () => {
  const req = requirement();
  for (const variation of [
    { deterministicEvidence: [], actualPersona: "company_admin", actualRoutePath: "/invoices", freshObservation: true },
    { deterministicEvidence: [{ stepIndex: 1, oracleId: "oracle-invoice", action: "assertTextVisible" as const, expected: "updated invoice", passed: true, note: "one" }, { stepIndex: 2, oracleId: "oracle-invoice", action: "assertTextVisible" as const, expected: "updated invoice", passed: true, note: "two" }], actualPersona: "company_admin", actualRoutePath: "/invoices", freshObservation: true },
    { deterministicEvidence: [{ stepIndex: 1, oracleId: "oracle-invoice", action: "assertTextVisible" as const, expected: "updated invoice", passed: false, note: "failed" }], actualPersona: "company_admin", actualRoutePath: "/invoices", freshObservation: true },
    { deterministicEvidence: [{ stepIndex: 1, oracleId: "oracle-invoice", action: "assertTextVisible" as const, expected: "updated invoice", passed: true, note: "stale" }], actualPersona: "talent", actualRoutePath: "/other", freshObservation: false },
  ]) assert.equal(evaluateBrowserSourceBoundAssertionSet({ requirement: req, ...variation }).result, "NOT_CONFIRMED");
});

test("shared authoritative obligations stay ambiguous rather than being assigned to the first case", () => {
  const first = browserCase(); const second = browserCase({ id: "case-2" }); const req = requirement(first);
  const allocation = allocateBrowserRuntimeSourceAssertions({ currentCase: first, allCases: [first, second], obligationLedger: ledger, requirements: [req] })[0]!;
  assert.equal(allocation.semanticFamily, "EXPLICIT_ENUMERATED_PRESENCE");
  assert.equal(allocation.state, "AMBIGUOUS_CASE_ALLOCATION");
  assert.equal(evaluateBrowserSourceBoundAssertionSetDischarge({ testCase: first, obligationLedger: ledger, allocation, requirement: req, evidence: confirmed(req) }).status, "NOT_PROVED");
});

test("non-acceptance and unauthenticated cases remain outside source assertion promotion", () => {
  assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase: browserCase({ persona: "unauthenticated" }), obligationLedger: ledger, sourceLedger, acceptedRoutePath: "/invoices" }), []);
  assert.deepEqual(buildBrowserSourceBoundAssertionSetRequirements({ testCase: browserCase(), obligationLedger: { ...ledger, obligations: [{ ...ledger.obligations[0]!, sourceRole: "TASK" }] }, sourceLedger, acceptedRoutePath: "/invoices" }), []);
});

test("DISCOVERY_ONLY handoff telemetry remains MANUAL_REQUIRED at its caller even when source proof is complete", () => {
  const testCase = browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } });
  const sourceEvidence = requirement(testCase).members.map((member, stepIndex) => ({ stepIndex, oracleId: member.oracleId, action: member.action, expected: member.expectedText, passed: true, note: "source carrier" }));
  const telemetry = collectBrowserSourceBoundAssertionSetTelemetry({ testCase, allCases: [testCase], obligationLedger: ledger, sourceLedger, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: sourceEvidence, actualPersona: "company_admin", freshObservation: true });
  assert.equal(telemetry.discharges.length, 1);
  assert.equal(telemetry.caseProofReadiness.status, "CASE_PROOF_READY");
  // The collector intentionally has no status field or PASS generator.
  assert.equal("status" in telemetry, false);
});

test("DISCOVERY_ONLY telemetry rejects missing authority, migration labels, incomplete members, and shared ownership", () => {
  const testCase = browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } });
  const handoffEvidence = visibleEvidence(testCase);
  const missingAuthority = collectBrowserSourceBoundAssertionSetTelemetry({ testCase, allCases: [testCase], obligationLedger: ledger, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "Unrelated label" }] }, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: handoffEvidence, actualPersona: "company_admin", freshObservation: true });
  assert.equal(missingAuthority.discharges.length, 0);
  assert.equal(missingAuthority.caseProofReadiness.status, "CASE_PROOF_NOT_READY");
  const migrationCase = browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" }, steps: [{ action: "assertTextVisible", text: "migration complete", oracleId: "migration" }] });
  const migrationLedger = { ...ledger, obligations: [{ ...ledger.obligations[0]!, text: "Migration complete", sourceRole: "TASK" as const }] };
  const migration = collectBrowserSourceBoundAssertionSetTelemetry({ testCase: migrationCase, allCases: [migrationCase], obligationLedger: migrationLedger, sourceLedger: { ...sourceLedger, sourceUnits: [{ ...sourceLedger.sourceUnits[0]!, text: "Migration complete" }] }, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: [{ stepIndex: 1, oracleId: "migration", action: "assertTextVisible", expected: "migration complete", passed: true, note: "visible" }], actualPersona: "company_admin", freshObservation: true });
  assert.equal(migration.discharges.length, 0);
  const incompleteCase = browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" }, steps: [{ action: "assertTextVisible", text: "updated invoice", oracleId: "oracle-invoice" }, { action: "assertTextVisible", text: "invoice list", oracleId: "missing" }] });
  const incomplete = collectBrowserSourceBoundAssertionSetTelemetry({ testCase: incompleteCase, allCases: [incompleteCase], obligationLedger: ledger, sourceLedger, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: handoffEvidence, actualPersona: "company_admin", freshObservation: true });
  assert.equal(incomplete.discharges.length, 0);
  const shared = collectBrowserSourceBoundAssertionSetTelemetry({ testCase, allCases: [testCase, { ...testCase, id: "discovery-2" }], obligationLedger: ledger, sourceLedger, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: handoffEvidence, actualPersona: "company_admin", freshObservation: true });
  assert.equal(shared.allocations[0]!.state, "AMBIGUOUS_CASE_ALLOCATION");
  assert.equal(shared.discharges.length, 0);
});

test("discovery observability summary is deterministic, bounded, and retains empty telemetry", () => {
  const testCase = browserCase({ executionPolicy: { lane: "DISCOVERY_ONLY" } });
  const telemetry = collectBrowserSourceBoundAssertionSetTelemetry({ testCase, allCases: [testCase], obligationLedger: ledger, sourceLedger, browserObligationBindings: [], acceptedRoutePath: "/invoices", deterministicEvidence: visibleEvidence(testCase), actualPersona: "company_admin", freshObservation: true });
  const args = { caseId: testCase.id, persona: "company_admin", acceptedRoutePath: "/invoices", telemetry };
  const first = summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry(args);
  assert.equal(SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_MARKER, "SOURCE_BOUND_ASSERTION_SET_DISCOVERY_TELEMETRY_V1");
  assert.equal(JSON.stringify(first), JSON.stringify(summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry(args)));
  assert.equal(JSON.stringify(first).includes("visible"), false);
  assert.equal("status" in first, false);
  const empty = summarizeBrowserSourceBoundAssertionSetDiscoveryTelemetry({ caseId: testCase.id, persona: "company_admin", acceptedRoutePath: null, telemetry: collectBrowserSourceBoundAssertionSetTelemetry({ testCase, allCases: [testCase], obligationLedger: undefined, sourceLedger: undefined, browserObligationBindings: undefined, acceptedRoutePath: null, deterministicEvidence: [], actualPersona: "company_admin", freshObservation: false }) });
  assert.equal(empty.requirementCount, 0);
  assert.equal(empty.evidenceCount, 0);
  assert.deepEqual(empty.requirements, []);
  assert.deepEqual(empty.evidence, []);
});
