import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  evaluateBrowserShadowProposal,
  evaluateRuntimeDeferredTargetProposal,
} from "./browser-agent-shadow-evaluator.js";

function deferredContract(): any {
  return {
    schemaVersion: 1,
    contractId: "runtime-target-test",
    status: "RUNTIME_TARGET_GROUNDING_REQUIRED",
    authority: "SOURCE_AUTHORIZED",
    obligationIds: ["obligation-1"],
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.ac.1" }],
    coarseEnvelope: {
      routeKind: "STATIC", route: "/company/work-setups",
      routeAuthority: "UI_ROUTE_MANIFEST", routeSourceRefs: ["manifest"],
      sourceSurface: "Company users can inspect Work Setups.",
    },
    persona: { value: "company_admin", authority: "SOURCE_ACTOR" },
    fixtureRequirements: [],
    allowedInteractionClasses: ["OBSERVE", "ASSERT_VISIBLE", "INTERNAL_NAVIGATION", "TRANSIENT_REVEAL"],
    forbiddenConsequenceClasses: ["PERSISTED_OR_CONSEQUENTIAL_CHANGE", "UNKNOWN_CONSEQUENCE", "EXTERNAL_NAVIGATION"],
    proofExpectations: [{ obligationId: "obligation-1", capabilityState: "UNSUPPORTED", proofAuthority: "NONE" }],
    selectionPolicy: "UNIQUE_COMPATIBLE_TARGET_ONLY", ambiguityPolicy: "NO_SAFE_ACTION",
    unavailablePolicy: "BLOCK_TARGET_GROUNDING_UNAVAILABLE",
    runtimeBinding: "NOT_YET_RESOLVED", targetReadyForInteraction: false,
  };
}

function deferredObservation(controls: any[]): any {
  return { ...observation({ controls }), url: "https://example.test/company/work-setups" };
}

function observation(args: {
  controls?: any[];
  inputs?: any[];
} = {}): any {
  return {
    url: "https://example.test/profile",
    title: "Profile",
    headings: [],
    controls: args.controls ?? [],
    inputs: args.inputs ?? [],
    surfaces: [],
    visibleText: [],
  };
}

function control(
  label: string,
  overrides: Record<string, unknown> = {}
): any {
  return {
    kind: "button",
    label,
    role: "button",
    disabled: false,
    selected: false,
    expanded: null,
    checked: null,
    ...overrides,
  };
}

function input(
  label: string,
  activationSafe: boolean
): any {
  return {
    label,
    role: "combobox",
    type: "text",
    disabled: false,
    activationSafe,
    expanded: false,
    required: false,
    hasValue: false,
  };
}

function click(
  target: string
): any {
  return {
    decision: "PROPOSE_ACTION",
    rationale: "Synthetic safety test",
    confidence: "high",
    action: {
      kind: "click",
      target,
    },
  };
}

function select(
  target: string
): any {
  return {
    decision: "PROPOSE_ACTION",
    rationale: "Synthetic safety test",
    confidence: "high",
    action: {
      kind: "select",
      target,
      value: "English",
    },
  };
}

function withBrowserMutations<T>(
  value: boolean,
  run: () => T
): T {
  const key =
    "QA_ALLOW_BROWSER_MUTATIONS";

  const previous =
    process.env[key];

  process.env[key] =
    value ? "true" : "false";

  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] =
        previous;
    }
  }
}

test(
  "activation-safe input click remains a mutation-free transient reveal",
  () => {
    const result =
      withBrowserMutations(
        false,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Select language"),
            observation:
              observation({
                inputs: [
                  input(
                    "Select language",
                    true
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "SAFE_TO_EXECUTE"
    );

    assert.equal(
      result.safeToExecute,
      true
    );
  }
);

test(
  "non-activation-safe input click fails closed",
  () => {
    const result =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Search"),
            observation:
              observation({
                inputs: [
                  input(
                    "Search",
                    false
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "MUTATION_RISK"
    );
  }
);

test(
  "external popup value change requires mutation permission",
  () => {
    const current =
      observation({
        controls: [
          control(
            "Active",
            {
              kind: "menuitem",
              role: "menuitem",
              externalPopup: true,
            }
          ),
        ],
      });

    const blocked =
      withBrowserMutations(
        false,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Active"),
            observation: current,
          })
      );

    assert.equal(
      blocked.status,
      "MUTATION_RISK"
    );

    const allowed =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Active"),
            observation: current,
          })
      );

    assert.equal(
      allowed.status,
      "SAFE_TO_EXECUTE"
    );
  }
);

test(
  "bound semantic option keeps exact click plus mutation-permission authorization",
  () => {
    const current =
      observation({
        controls: [
          control(
            "Publish",
            {
              kind: "option",
              role: "option",
              semanticOptionBinding:
                true,
            }
          ),
        ],
      });

    const blocked =
      withBrowserMutations(
        false,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Publish"),
            observation: current,
          })
      );

    assert.equal(
      blocked.status,
      "MUTATION_RISK"
    );

    const allowed =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Publish"),
            observation: current,
          })
      );

    assert.equal(
      allowed.status,
      "SAFE_TO_EXECUTE"
    );
  }
);

test(
  "ordinary option remains blocked even with mutation permission",
  () => {
    const result =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("English"),
            observation:
              observation({
                controls: [
                  control(
                    "English",
                    {
                      kind: "option",
                      role: "option",
                    }
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "MUTATION_RISK"
    );
  }
);

test(
  "ordinary consequential command remains blocked with mutation permission",
  () => {
    const result =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Save"),
            observation:
              observation({
                controls: [
                  control("Save"),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "MUTATION_RISK"
    );
  }
);

test(
  "exact inactive semantic tab remains eligible in read-only mode",
  () => {
    const result =
      withBrowserMutations(
        false,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Details"),
            observation:
              observation({
                controls: [
                  control(
                    "Details",
                    {
                      kind: "tab",
                      role: "tab",
                      selected: false,
                      controls:
                        "panel-details",
                    }
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "SAFE_TO_EXECUTE"
    );

    assert.equal(
      result.safeToExecute,
      true
    );
  }
);

test(
  "consequence-bearing selected-looking control remains blocked",
  () => {
    const result =
      withBrowserMutations(
        false,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              click("Publish"),
            observation:
              observation({
                controls: [
                  control(
                    "Publish",
                    {
                      kind: "tab",
                      role: "tab",
                      selected: false,
                      controls:
                        "panel-publish",
                    }
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "MUTATION_RISK"
    );

    assert.equal(
      result.safeToExecute,
      false
    );
  }
);

test(
  "select remains blocked even when its semantic effect is only transient value change",
  () => {
    const result =
      withBrowserMutations(
        true,
        () =>
          evaluateBrowserShadowProposal({
            proposal:
              select("English"),
            observation:
              observation({
                controls: [
                  control(
                    "English",
                    {
                      kind: "option",
                      role: "option",
                    }
                  ),
                ],
              }),
          })
      );

    assert.equal(
      result.status,
      "MUTATION_RISK"
    );

    assert.equal(
      result.safeToExecute,
      false
    );
  }
);


test(
  "verifies evaluator uses the shared deterministic safety classifier",
  () => {
    const source =
      fs.readFileSync(
        "src/agents/browser/browser-agent-shadow-evaluator.ts",
        "utf8"
      );

    assert.match(
      source,
      /GENERIC_BROWSER_DETERMINISTIC_SAFETY_EVALUATOR_V1/
    );

    assert.match(
      source,
      /classifyGenericBrowserActionSafety/
    );

    assert.equal(
      source.includes(
        "MUTATION_RISK_LABEL"
      ),
      false
    );
  }
);

test("runtime-deferred target grounding accepts one bounded transient reveal only", () => {
  const result = evaluateRuntimeDeferredTargetProposal({
    contract: deferredContract(), actualPersona: "company_admin",
    proposal: click("Work Setup details"),
    observation: deferredObservation([control("Work Setup details", {
      kind: "tab", role: "tab", controlledSurface: "details",
    })]),
  });
  assert.equal(result.status, "SAFE_TO_EXECUTE");
  assert.equal(result.safeToExecute, true);
});

test("runtime-deferred target grounding fails closed for ambiguity, persona, and mutation", () => {
  const contract = deferredContract();
  const ambiguous = evaluateRuntimeDeferredTargetProposal({
    contract, actualPersona: "company_admin", proposal: click("Details"),
    observation: deferredObservation([control("Details", { kind: "tab", controlledSurface: "one" }), control("Details", { kind: "tab", controlledSurface: "two" })]),
  });
  assert.equal(ambiguous.status, "NO_SAFE_ACTION");
  const persona = evaluateRuntimeDeferredTargetProposal({
    contract, actualPersona: "talent", proposal: click("Details"),
    observation: deferredObservation([control("Details", { kind: "tab", controlledSurface: "one" })]),
  });
  assert.equal(persona.status, "BLOCKED");
  const mutation = evaluateRuntimeDeferredTargetProposal({
    contract, actualPersona: "company_admin", proposal: click("Save"),
    observation: deferredObservation([control("Save")]),
  });
  assert.equal(mutation.status, "MUTATION_RISK");
});
