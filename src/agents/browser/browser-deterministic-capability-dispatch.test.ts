import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserAcceptanceScope,
  BrowserLocalControlStateTransitionRequirement,
} from "../../planner/types.js";
import {
  dispatchBrowserDeterministicCapability,
  type DispatchBrowserDeterministicCapabilityArgs,
} from "./browser-deterministic-capability-dispatch.js";

function requirement(args: {
  requirementId?: string;
  obligationId?: string;
} = {}): BrowserLocalControlStateTransitionRequirement {
  return {
    kind:
      "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
    requirementId:
      args.requirementId ?? "requirement-1",
    obligationId:
      args.obligationId ?? "obligation-1",
    sourceRefs: [{
      sourceUnitId: "source-1",
      sourceRef: "jira.description",
      sourceRole: "ACCEPTANCE",
    }],
    authority: {
      sourceRole: "ACCEPTANCE",
      proofAuthority: "ACCEPTANCE",
    },
    transition: {
      semantic: "RESET_RESTORES_DEFAULT",
      expectedValue: -3,
      expectedValueAuthority:
        "JIRA_AUTHORIZED",
    },
    structuralBinding: {
      sourceEvidenceRefs: [
        "src/components/Settings.tsx",
      ],
      valueBinding: {
        evidenceKind:
          "LABELLED_DEFAULT_PROPERTY",
        sourceLabel: "Penalty Weight",
        sourceProperty: "defaultWeight",
      },
    },
  };
}

function scope(
  requirements:
    BrowserLocalControlStateTransitionRequirement[] = []
): BrowserAcceptanceScope {
  return {
    requiresBehaviorProof: true,
    behaviorClaims: [],
    localControlStateTransitionRequirements:
      requirements,
  };
}

function dispatch(
  overrides: Partial<
    DispatchBrowserDeterministicCapabilityArgs
  > = {}
) {
  return dispatchBrowserDeterministicCapability({
    caseId: "web-1",
    obligationId: "obligation-1",
    acceptanceScope: scope([
      requirement(),
    ]),
    ...overrides,
  });
}

test("exact typed local-state requirement dispatches to the existing capability", () => {
  const exactRequirement = requirement();
  const decision = dispatch({
    acceptanceScope: scope([
      exactRequirement,
    ]),
  });

  assert.equal(decision.status, "MATCHED");
  if (decision.status !== "MATCHED") return;
  assert.deepEqual(
    {
      caseId: decision.candidate.caseId,
      requirementId:
        decision.candidate.requirementId,
      obligationId:
        decision.candidate.obligationId,
      requirementKind:
        decision.candidate.requirementKind,
      capabilityKind:
        decision.candidate.capabilityKind,
    },
    {
      caseId: "web-1",
      requirementId: "requirement-1",
      obligationId: "obligation-1",
      requirementKind:
        "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
      capabilityKind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    }
  );
  assert.equal(
    decision.candidate.requirement,
    exactRequirement
  );
});

test("no typed requirement produces no capability match", () => {
  assert.equal(
    dispatch({ acceptanceScope: scope() }).status,
    "NO_CAPABILITY_MATCH"
  );
});

test("search-only requirements do not match the local-state capability", () => {
  assert.equal(
    dispatch({
      acceptanceScope: {
        requiresBehaviorProof: true,
        behaviorClaims: [],
        collectionFilterRequirements: [{
          kind: "COLLECTION_FILTER",
          requirementId: "search-1",
          sourceClaim: "Search records.",
          interactionKind: "TEXT_SEARCH",
          controlSemantic: "SEARCH",
          authority: "AUTHORITATIVE",
          probes: [],
        }],
      },
    }).status,
    "NO_CAPABILITY_MATCH"
  );
});

for (const scenario of [
  {
    name: "coarse grouped-controls classification",
    extra: { semanticFamily: "GROUPED_CONTROLS" },
  },
  {
    name: "coarse state-transition classification",
    extra: { semanticFamily: "STATE_TRANSITION" },
  },
  {
    name: "planner goal and manual prose",
    extra: {
      goal: "Reset to defaults.",
      manualChecks: [
        "The default value is restored.",
      ],
    },
  },
  {
    name: "known canary issue key",
    extra: { issueKey: "AS-1402" },
  },
  {
    name: "known canary route",
    extra: {
      route:
        "/company/assessments/create",
    },
  },
  {
    name: "forged caller marker",
    extra: {
      hasLocalStateCapability: true,
    },
  },
]) {
  test(`${scenario.name} cannot create a match`, () => {
    const input = {
      caseId: "web-1",
      obligationId: "obligation-1",
      acceptanceScope: scope(),
      ...scenario.extra,
    } as DispatchBrowserDeterministicCapabilityArgs;

    assert.equal(
      dispatchBrowserDeterministicCapability(
        input
      ).status,
      "NO_CAPABILITY_MATCH"
    );
  });
}

test("malformed typed-looking input cannot create a match", () => {
  const forged = {
    ...requirement(),
    authority: {
      sourceRole: "IMPLEMENTATION",
      proofAuthority: "ACCEPTANCE",
    },
  };

  assert.equal(
    dispatch({
      acceptanceScope: {
        ...scope(),
        localControlStateTransitionRequirements: [
          forged,
        ],
      } as unknown as BrowserAcceptanceScope,
    }).status,
    "NO_CAPABILITY_MATCH"
  );
});

test("malformed expected value cannot survive as dispatch authority", () => {
  const forged = requirement() as unknown as {
    transition: {
      semantic: string;
      expectedValue: unknown;
      expectedValueAuthority: string;
    };
  };
  forged.transition.expectedValue = "-3";

  assert.equal(
    dispatch({
      acceptanceScope: {
        ...scope(),
        localControlStateTransitionRequirements: [
          forged,
        ],
      } as unknown as BrowserAcceptanceScope,
    }).status,
    "NO_CAPABILITY_MATCH"
  );
});

test("multiple exact-scope requirements fail safe independent of order", () => {
  const first = requirement({
    requirementId: "requirement-a",
  });
  const second = requirement({
    requirementId: "requirement-b",
  });
  const forward = dispatch({
    acceptanceScope: scope([
      first,
      second,
    ]),
  });
  const reverse = dispatch({
    acceptanceScope: scope([
      second,
      first,
    ]),
  });

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, {
    status:
      "AMBIGUOUS_CAPABILITY_DISPATCH",
    matchingRequirementIds: [
      "requirement-a",
      "requirement-b",
    ],
    note:
      "More than one typed requirement matches the requested obligation scope; dispatch abstained without selecting by array order.",
  });
});

test("requirements for other obligations are not silently selected", () => {
  assert.equal(
    dispatch({
      acceptanceScope: scope([
        requirement({
          obligationId: "obligation-2",
        }),
      ]),
    }).status,
    "NO_CAPABILITY_MATCH"
  );
});

test("missing case identity cannot produce a detached candidate", () => {
  assert.equal(
    dispatch({ caseId: "" }).status,
    "NO_CAPABILITY_MATCH"
  );
});

test("P0.1 true-Fresh transformed requirement reaches typed dispatch", () => {
  const freshRequirement = requirement({
    requirementId:
      "local-control-state-transition-bf0e94bd83da",
    obligationId:
      "jira-obligation-b8fbfb76d255",
  });
  freshRequirement.sourceRefs = [{
    sourceUnitId:
      "jira-req-5eabbda0253d",
    sourceRef: "jira.description",
    sourceRole: "ACCEPTANCE",
  }];
  freshRequirement.transition.expectedValue =
    -1;
  freshRequirement.structuralBinding = {
    sourceEvidenceRefs: [
      "src/modules/company/assesments/components/create-assessment/constants.ts",
    ],
    valueBinding: {
      evidenceKind:
        "LABELLED_DEFAULT_PROPERTY",
      sourceLabel: "Looking Away",
      sourceProperty: "defaultWeight",
    },
  };

  const decision = dispatch({
    obligationId:
      "jira-obligation-b8fbfb76d255",
    acceptanceScope: scope([
      freshRequirement,
    ]),
  });

  assert.equal(decision.status, "MATCHED");
  if (decision.status !== "MATCHED") return;
  assert.deepEqual(
    {
      caseId: decision.candidate.caseId,
      obligationId:
        decision.candidate.obligationId,
      requirementId:
        decision.candidate.requirementId,
      requirementKind:
        decision.candidate.requirementKind,
      dispatchStatus: decision.status,
      capabilityKind:
        decision.candidate.capabilityKind,
    },
    {
      caseId: "web-1",
      obligationId:
        "jira-obligation-b8fbfb76d255",
      requirementId:
        "local-control-state-transition-bf0e94bd83da",
      requirementKind:
        "LOCAL_CONTROL_STATE_TRANSITION_REQUIREMENT",
      dispatchStatus: "MATCHED",
      capabilityKind:
        "GROUNDED_LOCAL_CONTROL_STATE_TRANSITION",
    }
  );
});
