import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  bindDeepRoute,
  resolveDeepRouteBinding,
  verifyDeepRouteTarget,
  type DeepRouteTemplate,
  type RuntimeEntityIdentity,
} from "./browser-deep-route-binding.js";

const contractTemplate:
  DeepRouteTemplate = {
    template:
      "/talent/contracts/:contractId",
    sourceOrigin:
      "UI_ROUTE_MANIFEST",
    sourceRef:
      "src/modules/talent/TalentRoutes.tsx",
    authoritative: true,
    persona: "talent",
    requiredBindings: [
      {
        param: "contractId",
        entityKind: "contract",
      },
    ],
  };

const contractCandidate:
  RuntimeEntityIdentity = {
    entityKind: "contract",
    entityId: "contract-42",
    source: "AUTHENTICATED_GET",
    persona: "talent",
    identityVerified: true,
    ownershipVerified: true,
    ownerId: "talent-7",
    targetIdentity: {
      kind: "EXACT_TEXT",
      value: "Senior Reviewer",
    },
  };

function resolve(
  overrides: Partial<
    Parameters<
      typeof resolveDeepRouteBinding
    >[0]
  > = {}
) {
  return resolveDeepRouteBinding({
    template: contractTemplate,
    persona: "talent",
    requirements: [
      {
        param: "contractId",
        entityKind: "contract",
        persona: "talent",
        ownerId: "talent-7",
        requiresOwnershipVerification:
          true,
      },
    ],
    candidates: [contractCandidate],
    ...overrides,
  });
}

test("accepts an authoritative parameterized route template", () => {
  assert.equal(resolve().status, "RESOLVED");
});

test("rejects a planner-only route template", () => {
  assert.equal(
    resolve({
      template: {
        ...contractTemplate,
        sourceOrigin: "PLANNER_LITERAL",
      },
    }).status,
    "NO_AUTHORITATIVE_TEMPLATE"
  );
});

test("rejects an external route template", () => {
  assert.equal(
    resolve({
      template: {
        ...contractTemplate,
        template:
          "https://example.test/talent/contracts/:contractId",
      },
    }).status,
    "ROUTE_REJECTED"
  );
});

test("rejects a resource or API route template", () => {
  assert.equal(
    resolve({
      template: {
        ...contractTemplate,
        disposition:
          "RESOURCE_OR_API",
      },
    }).status,
    "ROUTE_REJECTED"
  );
});

test("rejects a persona-incompatible route template", () => {
  assert.equal(
    resolve({
      template: {
        ...contractTemplate,
        persona: "company_admin",
      },
    }).status,
    "ROUTE_REJECTED"
  );
});

test("requires exact template parameter names and order", () => {
  assert.equal(
    resolve({
      template: {
        ...contractTemplate,
        requiredBindings: [
          {
            param: "id",
            entityKind: "contract",
          },
        ],
      },
    }).status,
    "BINDING_FAILED"
  );
});

test("represents multiple route parameters deterministically", () => {
  const result =
    resolveDeepRouteBinding({
      template: {
        template:
          "/company/assessments/:assessmentId/submissions/:submissionId/evaluate",
        sourceOrigin:
          "GITHUB_ROUTER_MAPPING",
        authoritative: true,
        persona: "company_admin",
        requiredBindings: [
          {
            param: "assessmentId",
            entityKind:
              "assessment",
          },
          {
            param: "submissionId",
            entityKind:
              "submission",
          },
        ],
      },
      persona: "company_admin",
      requirements: [
        {
          param: "assessmentId",
          entityKind: "assessment",
          persona: "company_admin",
        },
        {
          param: "submissionId",
          entityKind: "submission",
          persona: "company_admin",
        },
      ],
      candidates: [
        {
          entityKind: "submission",
          entityId: "sub 9",
          source:
            "AUTHENTICATED_GET",
          persona: "company_admin",
          identityVerified: true,
        },
        {
          entityKind: "assessment",
          entityId: "assess-2",
          source:
            "AUTHENTICATED_GET",
          persona: "company_admin",
          identityVerified: true,
        },
      ],
    });

  assert.equal(
    result.boundRoute?.route,
    "/company/assessments/assess-2/submissions/sub%209/evaluate"
  );
  assert.deepEqual(
    Object.keys(
      result.boundRoute?.bindings ?? {}
    ),
    ["assessmentId", "submissionId"]
  );
});

test("accepts an exact deterministically verified identity", () => {
  assert.equal(resolve().status, "RESOLVED");
});

test("rejects an unverified identity", () => {
  assert.equal(
    resolve({
      candidates: [
        {
          ...contractCandidate,
          identityVerified: false,
        },
      ],
    }).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("rejects a model-proposed identity", () => {
  assert.equal(
    resolve({
      candidates: [
        {
          ...contractCandidate,
          source: "MODEL_PROPOSAL",
        },
      ],
    }).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("does not select the first of multiple compatible candidates", () => {
  assert.equal(
    resolve({
      candidates: [
        contractCandidate,
        {
          ...contractCandidate,
          entityId: "contract-43",
        },
      ],
    }).status,
    "AMBIGUOUS_ENTITY"
  );
});

test("reports runtime identity required for zero candidates", () => {
  assert.equal(
    resolve({ candidates: [] }).status,
    "RUNTIME_IDENTITY_REQUIRED"
  );
});

test("deduplicates repeat observations of the same verified entity", () => {
  assert.equal(
    resolve({
      candidates: [
        contractCandidate,
        { ...contractCandidate },
      ],
    }).status,
    "RESOLVED"
  );
});

test("rejects an entity-kind mismatch", () => {
  assert.equal(
    resolve({
      candidates: [
        {
          ...contractCandidate,
          entityKind: "assessment",
        },
      ],
    }).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("rejects persona and ownership mismatches", () => {
  assert.equal(
    resolve({
      candidates: [
        {
          ...contractCandidate,
          persona: "company_admin",
          ownerId: "other-talent",
        },
      ],
    }).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("distinguishes unverified required state from identity", () => {
  assert.equal(
    resolve({
      requirements: [
        {
          param: "contractId",
          entityKind: "contract",
          persona: "talent",
          requiredState: {
            signedDocument: true,
          },
        },
      ],
    }).status,
    "ENTITY_STATE_UNVERIFIED"
  );
});

test("accepts exactly verified required state", () => {
  assert.equal(
    resolve({
      requirements: [
        {
          param: "contractId",
          entityKind: "contract",
          persona: "talent",
          requiredState: {
            status: "active",
          },
        },
      ],
      candidates: [
        {
          ...contractCandidate,
          verifiedState: {
            status: "active",
          },
          verifiedStateKeys: ["status"],
        },
      ],
    }).status,
    "RESOLVED"
  );
});

test("a verified incompatible state is not treated as unverified", () => {
  assert.equal(
    resolve({
      requirements: [
        {
          param: "contractId",
          entityKind: "contract",
          persona: "talent",
          requiredState: {
            status: "active",
          },
        },
      ],
      candidates: [
        {
          ...contractCandidate,
          verifiedState: {
            status: "closed",
          },
          verifiedStateKeys: ["status"],
        },
      ],
    }).status,
    "NO_COMPATIBLE_ENTITY"
  );
});

test("a single verified parameter produces the exact route", () => {
  assert.equal(
    resolve().boundRoute?.route,
    "/talent/contracts/contract-42"
  );
});

test("missing binding fails", () => {
  assert.equal(
    bindDeepRoute(
      contractTemplate,
      {}
    ).status,
    "BINDING_FAILED"
  );
});

test("an extra unrelated binding is rejected safely", () => {
  assert.equal(
    bindDeepRoute(
      contractTemplate,
      {
        contractId: "42",
        unrelated: "9",
      }
    ).status,
    "BINDING_FAILED"
  );
});

for (const identifier of [
  "../admin",
  "nested/id",
  "nested\\id",
  "\u0000bad",
]) {
  test(`rejects malformed identifier ${JSON.stringify(identifier)}`, () => {
    assert.equal(
      bindDeepRoute(
        contractTemplate,
        { contractId: identifier }
      ).status,
      "BINDING_FAILED"
    );
  });
}

test("encodes a safe path value", () => {
  assert.equal(
    bindDeepRoute(
      contractTemplate,
      { contractId: "contract 42" }
    ).boundRoute?.route,
    "/talent/contracts/contract%2042"
  );
});

test("preserves supported template query semantics exactly", () => {
  const template: DeepRouteTemplate = {
    ...contractTemplate,
    template:
      "/talent/contracts/:contractId?view=details",
  };
  const rawBound = bindDeepRoute(
    template,
    { contractId: "42" }
  ).boundRoute!;
  const bound = {
    ...rawBound,
    targetIdentity: {
      kind: "EXACT_TEXT" as const,
      value: "Senior Reviewer",
    },
  };

  assert.equal(
    bound.route,
    "/talent/contracts/42?view=details"
  );
  assert.equal(
    verifyDeepRouteTarget(bound, {
      finalUrl:
        "https://app.test/talent/contracts/42?view=other",
      navigationSucceeded: true,
      exactSurfaceIdentities: [
        {
          kind: "EXACT_TEXT",
          value: "Senior Reviewer",
        },
      ],
    }).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("identical input produces an identical bound route", () => {
  assert.deepEqual(resolve(), resolve());
});

test("preserved route without entity surface is not target verified", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        exactSurfaceIdentities: [],
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("exact verified target identity produces target verification", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        exactSurfaceIdentities: [
          {
            kind: "EXACT_TEXT",
            value: "Senior Reviewer",
          },
        ],
      }
    ).status,
    "TARGET_VERIFIED"
  );
});

test("not-found and error surfaces fail target verification", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        exactSurfaceIdentities: [
          {
            kind: "EXACT_TEXT",
            value: "Senior Reviewer",
          },
        ],
        notFoundOrError: true,
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("wrong entity label fails target verification", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        exactSurfaceIdentities: [
          {
            kind: "EXACT_TEXT",
            value: "Junior Reviewer",
          },
        ],
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("a containing text string cannot substitute for an exact target label", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        exactSurfaceIdentities: [
          {
            kind: "EXACT_TEXT",
            value:
              "Dashboard Senior Reviewer Contract details",
          },
        ],
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("navigation success alone is insufficient", () => {
  const boundRoute = {
    ...resolve().boundRoute!,
    targetIdentity: undefined,
  };

  assert.equal(
    verifyDeepRouteTarget(
      boundRoute,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("screenshots and model statements are insufficient", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: true,
        screenshotAvailable: true,
        modelClaimsTarget: true,
      }
    ).status,
    "TARGET_IDENTITY_UNVERIFIED"
  );
});

test("navigation failure remains distinct from target verification", () => {
  assert.equal(
    verifyDeepRouteTarget(
      resolve().boundRoute!,
      {
        finalUrl:
          "https://app.test/talent/contracts/contract-42",
        navigationSucceeded: false,
      }
    ).status,
    "NAVIGATION_FAILED"
  );
});

test("the binder has no acceptance-evidence or verdict authority", () => {
  const source = fs.readFileSync(
    new URL(
      "./browser-deep-route-binding.ts",
      import.meta.url
    ),
    "utf8"
  );

  assert.doesNotMatch(
    source,
    /deterministicEvidence|manualChecks|reconcil|finalizeBrowser|\bPASS\b/
  );
});
