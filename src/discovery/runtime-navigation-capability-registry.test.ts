import assert from "node:assert/strict";
import test from "node:test";

import {
  selectRuntimeNavigationCapability,
  type RuntimeNavigationResolverRegistration,
} from "./runtime-navigation-capability-registry.js";
import {
  findAuthoritativeParameterizedUiRouteTemplatesFromEntries,
  type UiRouteEntry,
} from "./ui-route-catalog.js";

const contractRoute: UiRouteEntry = {
  path: "/talent/contracts/:contractId",
  file: "src/routes/talent-contract.tsx",
  params: ["contractId"],
  area: "contracts",
  persona: "talent",
};

const registration: RuntimeNavigationResolverRegistration = {
  template: contractRoute.path,
  persona: "talent",
  parameters: [{ param: "contractId", entityKind: "contract" }],
  resolverRef: "talent-contract-detail-readonly-v1",
  resolverClassification: "AUTHENTICATED_READ_ONLY_DISCOVERY",
  resolverProvenance: {
    module: "src/agents/browser/browser-route-talent-contract.ts",
    exportName: "resolveTalentContractDetailRoute",
  },
  selectionPolicy: "UNIQUE_COMPATIBLE_ONLY",
  ambiguityPolicy: "BLOCK_TEST_DATA_ISSUE",
  identityVerification: "REQUIRED",
  ownershipVerification: "REQUIRED",
  stateVerification: "WHEN_REQUIRED",
};

function templates(entries: UiRouteEntry[], surface = "Talent contract details") {
  return findAuthoritativeParameterizedUiRouteTemplatesFromEntries(entries, {
    surface,
  });
}

test("source-backed surface provenance can select a unique parameterized template without fabricating identity", () => {
  const entry: UiRouteEntry = {
    ...contractRoute,
    authoritative: true,
    routeKind: "PARAMETERIZED",
    surfaceIdentity: {
      canonicalSurface: "Contract Details",
      aliases: ["Contract Details", "Work Setups"],
      routeRef: contractRoute.path,
      routeTemplateRef: contractRoute.path,
      persona: "talent",
      provenance: [
        {
          sourceRef: "src/routes/title.ts:1",
          evidenceKind: "DOCUMENT_TITLE",
          value: "Contract Details",
        },
        {
          sourceRef: "src/routes/contract.ts:2",
          evidenceKind: "TAB_LABEL",
          value: "Work Setups",
        },
      ],
      evidenceKind: "DOCUMENT_TITLE",
      authority: "SOURCE_CORROBORATION",
    },
  };
  const result = templates([entry], "Talent contract work setup detail");
  assert.equal(result.length, 1);
  assert.equal(result[0]?.template, contractRoute.path);
  assert.deepEqual(result[0]?.requiredBindings, [{ param: "contractId", entityKind: "contract" }]);
  assert.equal((result[0] as any)?.runtimeIdentity, undefined);
});

test("one authoritative template and one registered resolver produce deferred capability", () => {
  const discovered = selectRuntimeNavigationCapability({
    templates: templates([contractRoute]),
    registrations: [registration],
    candidatePersona: "talent",
  });
  assert.equal(discovered.status, "AVAILABLE");
  if (discovered.status !== "AVAILABLE") return;
  assert.deepEqual(discovered.capability.parameters, [
    { param: "contractId", entityKind: "contract" },
  ]);
  assert.equal(discovered.capability.runtimeIdentity, "NOT_YET_RESOLVED");
  assert.equal(discovered.capability.navigationReadyForExecution, false);
});

test("zero or multiple target-compatible templates fail closed", () => {
  assert.equal(selectRuntimeNavigationCapability({
    templates: templates([contractRoute], "Skill selector"),
    registrations: [registration],
  }).status, "UNAVAILABLE");

  const second: UiRouteEntry = {
    ...contractRoute,
    path: "/talent/contracts/:contractId/details",
  };
  assert.equal(selectRuntimeNavigationCapability({
    templates: templates([contractRoute, second]),
    registrations: [registration],
  }).status, "AMBIGUOUS");
});

test("missing, duplicate, or persona-conflicting resolver authority fails closed", () => {
  const discoveredTemplates = templates([contractRoute]);
  assert.equal(selectRuntimeNavigationCapability({
    templates: discoveredTemplates,
    registrations: [],
  }).status, "UNAVAILABLE");
  assert.equal(selectRuntimeNavigationCapability({
    templates: discoveredTemplates,
    registrations: [registration, { ...registration }],
  }).status, "AMBIGUOUS");
  assert.equal(selectRuntimeNavigationCapability({
    templates: discoveredTemplates,
    registrations: [registration],
    candidatePersona: "company_admin",
  }).status, "CONFLICT");
});

test("capability identity is stable and contains no concrete runtime identifier", () => {
  const run = () => selectRuntimeNavigationCapability({
    templates: templates([contractRoute]),
    registrations: [registration],
  });
  const first = run();
  const second = run();
  assert.equal(first.status, "AVAILABLE");
  assert.equal(second.status, "AVAILABLE");
  if (first.status !== "AVAILABLE" || second.status !== "AVAILABLE") return;
  assert.equal(first.capability.capabilityId, second.capability.capabilityId);
  assert.equal(JSON.stringify(first.capability).includes("concreteRoute"), false);
  assert.equal(JSON.stringify(first.capability).includes("selectedIdentity"), false);
});


test("runtime selector applies persona before cross-persona template ambiguity", () => {
  const discovered = selectRuntimeNavigationCapability({
    templates: templates([contractRoute, { ...contractRoute, path: "/company/contracts/:contractId", persona: "company_admin" }]),
    registrations: [registration], candidatePersona: "talent",
  });
  assert.equal(discovered.status, "AVAILABLE");
  if (discovered.status === "AVAILABLE") {
    assert.equal(discovered.capability.template, contractRoute.path);
    assert.equal(discovered.capability.identityVerification, "REQUIRED");
    assert.equal(discovered.capability.ownershipVerification, "REQUIRED");
    assert.equal(discovered.capability.runtimeIdentity, "NOT_YET_RESOLVED");
  }
});
