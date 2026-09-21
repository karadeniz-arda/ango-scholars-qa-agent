import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlannerExecutionSurfacePrerequisiteContract,
} from "../../planner/types.js";
import {
  resolveBrowserExecutionSurfacePrerequisite,
} from "./browser-execution-surface-prerequisite.js";
import type {
  BrowserObservation,
} from "./browser-observation.js";

function contract(
  kind: PlannerExecutionSurfacePrerequisiteContract["kind"]
): PlannerExecutionSurfacePrerequisiteContract {
  return {
    schemaVersion: 1,
    prerequisiteId: `surface-${kind.toLowerCase()}`,
    status: "SURFACE_RUNTIME_RESOLUTION_REQUIRED",
    kind,
    authority: "SOURCE_AUTHORIZED",
    sourceUnitRefs: [{ sourceUnitId: "source-1", sourceRef: "jira.description" }],
    surfacePartition: {
      partitionId: "partition-1",
      verdictGroupId: "group-1",
      obligationId: "obligation-1",
      memberId: "all-payments",
      surface: "all payments",
    },
    executionContext: {
      executionContainerId: "container-1",
      semanticCandidateId: "candidate-1",
      executionCaseId: "case-1",
      route: "/company/all-payments",
      persona: "company_admin",
    },
    acceptanceCoverage: {
      policy: "ALL_REQUIRED",
      requiredMemberIds: ["all-payments", "payments"],
      plannedMemberIds: ["all-payments"],
      memberId: "all-payments",
    },
    selectionPolicy:
      kind === "SEARCH_INPUT"
        ? "UNIQUE_GROUNDED_CONTROL_ONLY"
        : "GROUNDED_CONTROL_SURFACE_PRESENT",
    ambiguityPolicy:
      kind === "SEARCH_INPUT"
        ? "BLOCK_SURFACE_UNAVAILABLE"
        : "ALLOW_MULTIPLE_GROUNDED_CONTROLS",
    runtimeBinding: "NOT_YET_RESOLVED",
    surfaceReadyForInteraction: false,
  };
}

function observation(
  overrides: Partial<BrowserObservation> = {}
): BrowserObservation {
  return {
    url: "https://example.test/company/all-payments",
    title: "All Payments",
    headings: [],
    controls: [],
    inputs: [],
    surfaces: [],
    collections: [],
    visibleText: [],
    counts: {
      headings: 0,
      controls: 0,
      inputs: 0,
      surfaces: 0,
      collections: 0,
      visibleText: 0,
    },
    ...overrides,
  };
}

const searchInput: BrowserObservation["inputs"][number] = {
  label: "Search invoices",
  placeholder: "Search invoices",
  role: "textbox",
  type: "search",
  disabled: false,
  activationSafe: false,
  expanded: null,
  required: false,
  hasValue: false,
};

const filterControl: BrowserObservation["controls"][number] = {
  kind: "button",
  label: "Filters",
  role: "button",
  disabled: false,
  selected: null,
  expanded: false,
  checked: null,
};

test("one grounded search input resolves runtime surface readiness only", () => {
  const result = resolveBrowserExecutionSurfacePrerequisite({
    contract: contract("SEARCH_INPUT"),
    observation: observation({ inputs: [searchInput] }),
    actualPersona: "company_admin",
  });
  assert.equal(result.status, "READY");
  assert.equal(result.surfaceReadyForInteraction, true);
  assert.equal("proof" in result, false);
  assert.equal("verdict" in result, false);
});

test("one or many grounded tab/filter controls resolve while zero fails closed", () => {
  const prerequisite = contract("TAB_OR_FILTER_CONTROL");
  assert.equal(resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation({ controls: [filterControl] }),
    actualPersona: "company_admin",
  }).status, "READY");

  const missing = resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation(),
    actualPersona: "company_admin",
  });
  assert.deepEqual(
    missing.status === "BLOCKED" && [missing.reason, missing.candidateCount],
    ["SURFACE_CONTROL_NOT_GROUNDED", 0]
  );

  const many = resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation({ controls: [
      filterControl,
      { ...filterControl, label: "More filters" },
    ] }),
    actualPersona: "company_admin",
  });

  assert.equal(many.status, "READY");
  assert.equal(many.candidateCount, 2);
  assert.equal(
    many.status === "READY"
      ? many.binding.kind
      : "",
    "CONTROL_SURFACE"
  );
  assert.equal("proof" in many, false);
  assert.equal("verdict" in many, false);
});

test("disabled and noninteractive controls cannot satisfy the prerequisite", () => {
  for (const control of [
    { ...filterControl, disabled: true },
    { ...filterControl, kind: "control" as const, role: "generic" },
  ]) {
    const result = resolveBrowserExecutionSurfacePrerequisite({
      contract: contract("TAB_OR_FILTER_CONTROL"),
      observation: observation({ controls: [control] }),
      actualPersona: "company_admin",
    });
    assert.equal(result.status, "BLOCKED");
  }
  assert.equal(resolveBrowserExecutionSurfacePrerequisite({
    contract: contract("SEARCH_INPUT"),
    observation: observation({ inputs: [{ ...searchInput, disabled: true }] }),
    actualPersona: "company_admin",
  }).status, "BLOCKED");
});

test("route, persona, malformed coverage and duplicate search controls fail closed", () => {
  const prerequisite = contract("SEARCH_INPUT");
  assert.equal(resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation({ url: "https://example.test/company/payments", inputs: [searchInput] }),
    actualPersona: "company_admin",
  }).status, "BLOCKED");
  assert.equal(resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation({ inputs: [searchInput] }),
    actualPersona: "talent",
  }).status, "BLOCKED");
  assert.equal(resolveBrowserExecutionSurfacePrerequisite({
    contract: {
      ...prerequisite,
      acceptanceCoverage: {
        ...prerequisite.acceptanceCoverage,
        plannedMemberIds: [],
      },
    },
    observation: observation({ inputs: [searchInput] }),
    actualPersona: "company_admin",
  }).status, "BLOCKED");
  const duplicate = resolveBrowserExecutionSurfacePrerequisite({
    contract: prerequisite,
    observation: observation({ inputs: [searchInput, searchInput] }),
    actualPersona: "company_admin",
  });
  assert.equal(duplicate.status, "BLOCKED");
  assert.equal(
    duplicate.status === "BLOCKED" ? duplicate.reason : "",
    "SURFACE_CONTROL_AMBIGUOUS"
  );
});

test("planning contract remains unresolved and serialization stable", () => {
  const original = contract("SEARCH_INPUT");
  const reloaded = JSON.parse(JSON.stringify(original));
  assert.deepEqual(reloaded, original);
  assert.equal(original.surfaceReadyForInteraction, false);
  assert.equal(original.runtimeBinding, "NOT_YET_RESOLVED");
  assert.equal("runtimeControl" in original, false);
});
