import { createHash } from "node:crypto";

import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerBrowserDeterministicProofBinding,
  PlannerBrowserProofCapability,
  PlannerExecutionSurfacePrerequisiteContract,
  PlannerRuntimeFixtureResolutionContract,
  TestPlan,
} from "./types.js";

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokens(value: string): string[] {
  return normalized(value).match(/[a-z0-9]+/g) ?? [];
}

function stableBindingId(parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 12);
  return `browser-proof-binding-${digest}`;
}

const insignificant = new Set([
  "a", "an", "and", "at", "by", "for", "in", "is", "of", "on",
  "the", "to", "with",
]);

function assertionSemanticallyOccursInObligation(
  assertionText: string,
  obligationText: string
): boolean {
  const assertionTokens = tokens(assertionText);
  const obligationTokens = tokens(obligationText);
  const significant = assertionTokens.filter(
    (item) => item.length > 2 && !insignificant.has(item)
  );
  if (
    significant.length < 2 ||
    !significant.every((item) => obligationTokens.includes(item))
  ) {
    return false;
  }
  const obligation = ` ${obligationTokens.join(" ")} `;
  return assertionTokens.slice(0, -1).some((item, index) => {
    const next = assertionTokens[index + 1]!;
    return ` ${item} ${next} `.length > 5 &&
      obligation.includes(` ${item} ${next} `);
  });
}

function sourceLabelAffirmativelyOccursInObligation(
  label: string,
  obligationText: string
): boolean {
  const labelTokens = tokens(label);
  const obligationTokens = tokens(obligationText);
  const obligation = ` ${obligationTokens.join(" ")} `;
  const overlapCount = labelTokens.filter((item) =>
    obligationTokens.includes(item)
  ).length;
  return overlapCount >= 2 && labelTokens.slice(0, -1).some((item, index) => {
    const next = labelTokens[index + 1]!;
    return item.length > 2 && next.length > 1 &&
      obligation.includes(` ${item} ${next} `);
  });
}

function directSourceLabel(value: string): string {
  return normalized(value).split(/\s*\(/, 1)[0]!.trim();
}

function expandedSurfaceSource(
  plan: TestPlan,
  obligation: PlannerAcceptanceObligation
) {
  const units = plan.acceptanceSourceLedger?.sourceUnits ?? [];
  return units.find((unit) =>
    obligation.sourceUnitIds.includes(unit.id) &&
    /\b(dialog|drawer|modal|panel|sheet|details?\s+(?:drawer|panel|view))\b/i
      .test(unit.text)
  );
}

function sourceLabelText(value: string): string {
  return String(value ?? "").split(/\s*\(/, 1)[0]!.trim();
}

function sourceLabelsForExpandedSurface(args: {
  plan: TestPlan;
  obligation: PlannerAcceptanceObligation;
  surfaceSourceUnitId: string;
}) {
  const obligationUnits = args.plan.acceptanceSourceLedger?.sourceUnits
    .filter((unit) => args.obligation.sourceUnitIds.includes(unit.id)) ?? [];
  const sourceRefs = new Set(obligationUnits.map((unit) => unit.sourceRef));
  const sectionHeadings = new Set(obligationUnits
    .map((unit) => normalized(unit.sectionHeading))
    .filter(Boolean));
  return (args.plan.acceptanceSourceLedger?.sourceUnits ?? []).filter((unit) => {
    const label = sourceLabelText(unit.text);
    const labelTokens = tokens(label);
    return unit.id !== args.surfaceSourceUnitId &&
      !/[.!?]\s*$/.test(label) &&
      label.length > 0 &&
      label.length <= 80 &&
      labelTokens.length <= 6 &&
      /^[\p{L}\p{N}][\p{L}\p{N} ._\-/()&]+$/u.test(label) &&
      sourceLabelAffirmativelyOccursInObligation(label, args.obligation.text) &&
    sourceRefs.has(unit.sourceRef) &&
    (
      sectionHeadings.size === 0 ||
      sectionHeadings.has(normalized(unit.sectionHeading))
    );
  });
}

function coverageForCase(
  testCase: BrowserTestCase,
  contract: PlannerRuntimeFixtureResolutionContract | undefined
): PlannerBrowserDeterministicProofBinding["acceptanceCoverage"] | null {
  const executionCaseId =
    testCase.runtimeFixtureResolutionContract?.interactionExecutionCaseId ??
    testCase.id;
  const coverage = contract?.acceptanceCoverage;
  const member = contract?.members.find(
    (item) => item.executionCaseId === executionCaseId
  );
  if (
    coverage?.kind === "INVOICE_STATE" &&
    member?.acceptanceFixtureConstraint?.fixtureKind === "invoice"
  ) {
    const memberId = member.acceptanceFixtureConstraint.partition.memberId;
    if (!coverage.plannedMemberIds.some((item) => item === memberId)) {
      return null;
    }
    return {
      policy: "ALL_REQUIRED",
      requiredMemberIds: [...new Set(coverage.requiredMemberIds)].sort(),
      plannedMemberIds: [...new Set(coverage.plannedMemberIds)].sort(),
      memberId,
    };
  }
  return {
    policy: "ALL_REQUIRED",
    requiredMemberIds: [executionCaseId],
    plannedMemberIds: [executionCaseId],
    memberId: executionCaseId,
  };
}

function sourceAuthorizesSearchInput(args: {
  plan: TestPlan;
  obligation: PlannerAcceptanceObligation;
  contract: PlannerExecutionSurfacePrerequisiteContract;
}): boolean {
  const { contract } = args;
  const sourceUnits = args.plan.acceptanceSourceLedger?.sourceUnits ?? [];
  return contract.schemaVersion === 1 &&
    contract.status === "SURFACE_RUNTIME_RESOLUTION_REQUIRED" &&
    contract.kind === "SEARCH_INPUT" &&
    contract.authority === "SOURCE_AUTHORIZED" &&
    contract.surfacePartition.obligationId === args.obligation.id &&
    contract.executionContext.executionCaseId !== "" &&
    contract.executionContext.route.startsWith("/") &&
    contract.sourceUnitRefs.length > 0 &&
    contract.sourceUnitRefs.every((ref) => sourceUnits.some((unit) =>
      unit.id === ref.sourceUnitId &&
      unit.sourceRef === ref.sourceRef &&
      args.obligation.sourceUnitIds.includes(unit.id)
    )) &&
    contract.selectionPolicy === "UNIQUE_GROUNDED_CONTROL_ONLY" &&
    contract.ambiguityPolicy === "BLOCK_SURFACE_UNAVAILABLE" &&
    contract.acceptanceCoverage.policy === "ALL_REQUIRED" &&
    contract.acceptanceCoverage.memberId === contract.surfacePartition.memberId &&
    contract.acceptanceCoverage.requiredMemberIds.includes(
      contract.acceptanceCoverage.memberId
    ) &&
    contract.acceptanceCoverage.plannedMemberIds.includes(
      contract.acceptanceCoverage.memberId
    );
}

function searchInputBinding(args: {
  obligation: PlannerAcceptanceObligation;
  evidenceContractId: string;
  contract: PlannerExecutionSurfacePrerequisiteContract;
}): PlannerBrowserDeterministicProofBinding {
  const { contract } = args;
  return {
    schemaVersion: 1,
    bindingId: stableBindingId([
      args.evidenceContractId,
      contract.executionContext.executionCaseId,
      contract.prerequisiteId,
      contract.surfacePartition.memberId,
    ]),
    evidenceContractId: args.evidenceContractId,
    obligationId: args.obligation.id,
    executionCaseId: contract.executionContext.executionCaseId,
    capabilityKind: "SEARCH_INPUT_PRESENT",
    authority: "SOURCE_AUTHORIZED",
    prerequisite: {
      kind: "SEARCH_INPUT",
      prerequisiteId: contract.prerequisiteId,
      sourceUnitRefs: contract.sourceUnitRefs,
      selectionPolicy: "UNIQUE_GROUNDED_CONTROL_ONLY",
      ambiguityPolicy: "BLOCK_SURFACE_UNAVAILABLE",
      surfacePartitionId: contract.surfacePartition.partitionId,
    },
    runtimePreconditions: {
      persona: contract.executionContext.persona,
      route: contract.executionContext.route,
      requiresRuntimeFixtureBinding: false,
    },
    acceptanceCoverage: contract.acceptanceCoverage,
  };
}

/**
 * Binds one authoritative evidence contract to an existing deterministic
 * expanded-surface observation. Candidate prose and fixture metadata cannot
 * create a binding: both the surface and asserted label must occur in the
 * source ledger. Model-authored assertion steps are execution guidance only;
 * this binding synthesizes its stable assertion identity from one exact,
 * source-authorized label when such a label is unambiguous.
 */
export function bindPlannerBrowserProofCapability(args: {
  plan: TestPlan;
  obligation: PlannerAcceptanceObligation;
  evidenceContractId: string;
  executionCases: BrowserTestCase[];
  targetCompatible: boolean;
  runtimeFixtureResolution?: PlannerRuntimeFixtureResolutionContract;
  executionSurfacePrerequisites?: PlannerExecutionSurfacePrerequisiteContract[];
  baseCapability: PlannerBrowserProofCapability;
}): PlannerBrowserProofCapability {
  if (![
    "UNKNOWN",
    "SUPPORTED_BUT_UNBOUND",
  ].includes(args.baseCapability.state)) {
    return args.baseCapability;
  }
  const searchPrerequisites = args.executionSurfacePrerequisites ??
    args.executionCases.flatMap((testCase) =>
      testCase.executionSurfacePrerequisiteContract
        ? [testCase.executionSurfacePrerequisiteContract]
        : []
    );
  if (searchPrerequisites.length > 0) {
    if (!args.targetCompatible) {
      return {
        ...args.baseCapability,
        state: "SUPPORTED_BUT_UNBOUND",
        reason: "A source-authorized search-input presence semantic exists, but no exact compatible execution target is bound.",
      };
    }
    const bindings = searchPrerequisites.flatMap((contract) =>
      sourceAuthorizesSearchInput({
        plan: args.plan,
        obligation: args.obligation,
        contract,
      })
        ? [searchInputBinding({
            obligation: args.obligation,
            evidenceContractId: args.evidenceContractId,
            contract,
          })]
        : []
    );
    if (bindings.length !== searchPrerequisites.length) {
      return {
        ...args.baseCapability,
        state: "SUPPORTED_BUT_UNBOUND",
        reason: "A search-input prerequisite is missing exact source authority, ALL_REQUIRED member coverage, or unique-control policy.",
      };
    }
    const ordered = bindings.sort((left, right) =>
      left.bindingId.localeCompare(right.bindingId)
    );
    return {
      obligationId: args.obligation.id,
      state: "SUPPORTED_AND_BOUND",
      requirementIds: ordered.map((item) => item.bindingId),
      bindings: ordered,
      reason: "Each source-authorized SEARCH_INPUT prerequisite is bound to one fresh, unique structured input-presence observation.",
    };
  }

  const surfaceSource = expandedSurfaceSource(args.plan, args.obligation);
  if (!surfaceSource) return args.baseCapability;

  if (!args.targetCompatible || args.executionCases.length === 0) {
    return {
      ...args.baseCapability,
      state: "SUPPORTED_BUT_UNBOUND",
      reason: "A source-authorized expanded-surface proof semantic exists, but no exact compatible execution target is bound.",
    };
  }

  const bindings: PlannerBrowserDeterministicProofBinding[] = [];
  for (const testCase of args.executionCases) {
    if (!testCase.startRoute || testCase.persona === "unauthenticated") continue;
    const sourceLabels = sourceLabelsForExpandedSurface({
      plan: args.plan,
      obligation: args.obligation,
      surfaceSourceUnitId: surfaceSource.id,
    });
    if (sourceLabels.length !== 1) continue;
    const coverage = coverageForCase(
      testCase,
      args.runtimeFixtureResolution
    );
    if (!coverage) continue;
    const sourceUnit = sourceLabels[0]!;
    const expectedText = sourceLabelText(sourceUnit.text);
    const oracleId = `source-expanded-label-${stableBindingId([
      args.evidenceContractId,
      args.obligation.id,
      sourceUnit.id,
      expectedText,
    ])}`;
    const executionCaseId =
      testCase.runtimeFixtureResolutionContract?.interactionExecutionCaseId ??
      testCase.id;
    const bindingId = stableBindingId([
      args.evidenceContractId,
      executionCaseId,
      oracleId,
      sourceUnit.id,
      coverage.memberId,
    ]);
    bindings.push({
      schemaVersion: 1,
      bindingId,
      evidenceContractId: args.evidenceContractId,
      obligationId: args.obligation.id,
      executionCaseId,
      capabilityKind: "VISIBLE_TEXT_IN_EXPANDED_SURFACE",
      authority: "SOURCE_AUTHORIZED",
      assertion: {
        action: "assertTextVisible",
        oracleId,
        expectedText,
        sourceUnitId: sourceUnit.id,
        sourceRef: sourceUnit.sourceRef,
      },
      surface: {
        kind: "EXPANDED_DETAIL_SURFACE",
        sourceUnitId: surfaceSource.id,
        sourceRef: surfaceSource.sourceRef,
      },
      runtimePreconditions: {
        persona: testCase.persona,
        route: testCase.startRoute,
        requiresRuntimeFixtureBinding:
          args.runtimeFixtureResolution?.status ===
            "RUNTIME_FIXTURE_RESOLUTION_REQUIRED",
      },
      acceptanceCoverage: coverage,
    });
  }

  if (bindings.length !== args.executionCases.length) {
    return {
      ...args.baseCapability,
      state: "SUPPORTED_BUT_UNBOUND",
      reason: "A source-authorized expanded-surface proof semantic exists, but its exact source label or execution-member binding is missing or ambiguous.",
    };
  }
  const ordered = bindings.sort((left, right) =>
    left.bindingId.localeCompare(right.bindingId)
  );
  return {
    obligationId: args.obligation.id,
    state: "SUPPORTED_AND_BOUND",
    requirementIds: ordered.map((item) => item.bindingId),
    bindings: ordered,
    reason: "Each execution member has one exact source-authorized text oracle bound to a fresh deterministic expanded-surface observation.",
  };
}
