import type { Page } from "playwright";

import type {
  BrowserTestCase,
  PlannerBrowserDeterministicProofBinding,
} from "../../planner/types.js";
import type {
  BrowserDeterministicEvidence,
} from "./evidence-review.js";
import {
  resolveBrowserExecutionSurfacePrerequisite,
} from "./browser-execution-surface-prerequisite.js";
import {
  observeBrowserPage,
  type BrowserObservation,
} from "./browser-observation.js";
import {
  findTextInOpenDetailSurface,
} from "./generic-browser-actions.js";
import {
  runtimeFixturePreparationAllowsInteraction,
  type BrowserRuntimeFixturePreparationResult,
} from "./browser-runtime-fixture-preparation.js";

export type BrowserEvidenceContractProofResult = {
  schemaVersion: 1;
  bindingId: string;
  evidenceContractId: string;
  obligationId: string;
  executionCaseId: string;
  memberId: string;
  capabilityKind:
    | "VISIBLE_TEXT_IN_EXPANDED_SURFACE"
    | "SEARCH_INPUT_PRESENT";
  status: "CONFIRMED" | "CONTRADICTED" | "NOT_EXECUTED";
  freshObservation: boolean;
  surfaceCount: number;
  expectedText?: string;
  oracleId?: string;
  candidateCount?: number;
  note: string;
};

export type BrowserEvidenceContractProofCoverage = {
  schemaVersion: 1;
  obligationId: string;
  policy: "ALL_REQUIRED";
  status: "SATISFIED" | "UNSATISFIED";
  requiredMemberIds: string[];
  provedMemberIds: string[];
  remainingMemberIds: string[];
  confirmedBindingIds: string[];
  note: string;
};

type SurfaceObservation = Awaited<
  ReturnType<typeof findTextInOpenDetailSurface>
>;

function pathOf(value: string): string | null {
  try {
    return new URL(value, "https://runtime.invalid").pathname.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
}

function notExecuted(
  binding: PlannerBrowserDeterministicProofBinding,
  note: string
): BrowserEvidenceContractProofResult {
  return {
    schemaVersion: 1,
    bindingId: binding.bindingId,
    evidenceContractId: binding.evidenceContractId,
    obligationId: binding.obligationId,
    executionCaseId: binding.executionCaseId,
    memberId: binding.acceptanceCoverage.memberId,
    capabilityKind: binding.capabilityKind,
    status: "NOT_EXECUTED",
    freshObservation: false,
    surfaceCount: 0,
    ...(binding.capabilityKind === "VISIBLE_TEXT_IN_EXPANDED_SURFACE"
      ? {
          expectedText: binding.assertion.expectedText,
          oracleId: binding.assertion.oracleId,
        }
      : {}),
    note,
  };
}

function preparationMatches(args: {
  binding: PlannerBrowserDeterministicProofBinding;
  preparations: BrowserRuntimeFixturePreparationResult[];
}): boolean {
  if (!args.binding.runtimePreconditions.requiresRuntimeFixtureBinding) {
    return true;
  }
  const requiredState = ["processed", "sent-for-processing"].includes(
    args.binding.acceptanceCoverage.memberId
  )
    ? args.binding.acceptanceCoverage.memberId
    : null;
  return args.preparations.some((item) =>
    runtimeFixturePreparationAllowsInteraction(item) &&
    item.binding?.executionCaseId === args.binding.executionCaseId &&
    item.persona === args.binding.runtimePreconditions.persona &&
    item.binding?.ownerPersonaRef === args.binding.runtimePreconditions.persona &&
    (
      requiredState === null ||
      (
        item.requiredState === requiredState &&
        item.verifiedState === requiredState &&
        item.binding?.verifiedState === requiredState
      )
    )
  );
}

export async function executeBrowserEvidenceContractProofs(args: {
  page: Page;
  testCase: BrowserTestCase;
  actualPersona: string | null | undefined;
  deterministicEvidence: BrowserDeterministicEvidence[];
  runtimeFixturePreparations: BrowserRuntimeFixturePreparationResult[];
  observe?: (
    page: Page,
    expectedText: string
  ) => Promise<SurfaceObservation>;
  observeSearchInput?: (page: Page) => Promise<BrowserObservation>;
}): Promise<BrowserEvidenceContractProofResult[]> {
  const bindings = args.testCase.deterministicProofBindings ?? [];
  const observe = args.observe ?? findTextInOpenDetailSurface;
  const actualPath = pathOf(args.page.url());
  const results: BrowserEvidenceContractProofResult[] = [];

  for (const binding of bindings) {
    const executionCaseId =
      args.testCase.runtimeFixtureResolutionContract
        ?.interactionExecutionCaseId ??
      args.testCase.executionSurfacePrerequisiteContract
        ?.executionContext.executionCaseId ?? args.testCase.id;
    if (
      binding.schemaVersion !== 1 ||
      binding.authority !== "SOURCE_AUTHORIZED" ||
      binding.executionCaseId !== executionCaseId ||
      binding.obligationId === ""
    ) {
      results.push(notExecuted(
        binding,
        "Proof binding is malformed or belongs to another execution case; no observation was attempted."
      ));
      continue;
    }
    if (
      args.actualPersona !== binding.runtimePreconditions.persona ||
      actualPath !== pathOf(binding.runtimePreconditions.route)
    ) {
      results.push(notExecuted(
        binding,
        "The active persona or route does not match the source-bound execution context; no observation was attempted."
      ));
      continue;
    }
    if (!preparationMatches({
      binding,
      preparations: args.runtimeFixturePreparations,
    })) {
      results.push(notExecuted(
        binding,
        "The exact runtime fixture binding is unresolved or mismatched; no proof observation was attempted."
      ));
      continue;
    }
    if (binding.capabilityKind === "SEARCH_INPUT_PRESENT") {
      const contract = args.testCase.executionSurfacePrerequisiteContract;
      if (
        !contract ||
        contract.prerequisiteId !== binding.prerequisite.prerequisiteId ||
        contract.kind !== binding.prerequisite.kind ||
        contract.surfacePartition.partitionId !==
          binding.prerequisite.surfacePartitionId ||
        contract.executionContext.executionCaseId !== binding.executionCaseId
      ) {
        results.push(notExecuted(
          binding,
          "The source-bound search-input prerequisite is absent or mismatched; no observation was attempted."
        ));
        continue;
      }
      const observation = await (args.observeSearchInput ?? observeBrowserPage)(
        args.page
      );
      const resolution = resolveBrowserExecutionSurfacePrerequisite({
        contract,
        observation,
        actualPersona: binding.runtimePreconditions.persona,
      });
      const confirmed = resolution.status === "READY" &&
        resolution.binding.kind === "INPUT" &&
        resolution.candidateCount === 1;
      results.push({
        schemaVersion: 1,
        bindingId: binding.bindingId,
        evidenceContractId: binding.evidenceContractId,
        obligationId: binding.obligationId,
        executionCaseId: binding.executionCaseId,
        memberId: binding.acceptanceCoverage.memberId,
        capabilityKind: binding.capabilityKind,
        status: confirmed ? "CONFIRMED" : "CONTRADICTED",
        freshObservation: true,
        surfaceCount: 0,
        candidateCount: resolution.candidateCount,
        note: confirmed
          ? "Fresh deterministic observation found exactly one source-authorized, enabled structured search input."
          : "Fresh structured search-input observation was absent or ambiguous; proof failed closed.",
      });
      continue;
    }

    const canonicalAssertionPassed = args.deterministicEvidence.some((item) =>
      item.action === "assertTextVisible" &&
      item.oracleId === binding.assertion.oracleId &&
      item.expected === binding.assertion.expectedText &&
      item.passed === true
    );
    if (!canonicalAssertionPassed) {
      results.push(notExecuted(
        binding,
        "The exact canonical assertion did not pass; planning metadata alone cannot execute or satisfy proof."
      ));
      continue;
    }

    const observation = await observe(args.page, binding.assertion.expectedText);
    const surfaceCount = observation.surfaceCount ?? 0;
    const confirmed = observation.attempted === true &&
      observation.visible === true && surfaceCount === 1;
    results.push({
      schemaVersion: 1, bindingId: binding.bindingId,
      evidenceContractId: binding.evidenceContractId,
      obligationId: binding.obligationId, executionCaseId: binding.executionCaseId,
      memberId: binding.acceptanceCoverage.memberId,
      capabilityKind: binding.capabilityKind,
      status: confirmed ? "CONFIRMED" : "CONTRADICTED",
      freshObservation: observation.attempted === true, surfaceCount,
      expectedText: binding.assertion.expectedText, oracleId: binding.assertion.oracleId,
      note: confirmed
        ? "Fresh deterministic observation found the exact source-bound text in exactly one active expanded detail surface."
        : observation.attempted !== true
          ? "No active expanded detail surface was available for a fresh proof observation."
          : surfaceCount !== 1
            ? `Expected exactly one active expanded detail surface, observed ${surfaceCount}; proof failed closed.`
            : "Fresh deterministic expanded-surface observation did not find the exact source-bound text.",
    });
  }
  return results;
}

/** Positive-only obligation coverage. It is deliberately verdict-neutral. */
export function summarizeBrowserEvidenceContractProofCoverage(args: {
  bindings: PlannerBrowserDeterministicProofBinding[];
  results: BrowserEvidenceContractProofResult[];
}): BrowserEvidenceContractProofCoverage[] {
  const obligationIds = [...new Set(
    args.bindings.map((item) => item.obligationId)
  )].sort();
  return obligationIds.map((obligationId) => {
    const bindings = args.bindings.filter(
      (item) => item.obligationId === obligationId
    );
    const requiredMemberIds = [...new Set(bindings.flatMap(
      (item) => item.acceptanceCoverage.requiredMemberIds
    ))].sort();
    const confirmed = args.results.filter((result) =>
      result.obligationId === obligationId &&
      result.status === "CONFIRMED" &&
      bindings.some((binding) => binding.bindingId === result.bindingId)
    );
    const provedMemberIds = [...new Set(confirmed.map(
      (item) => item.memberId
    ))].filter((item) => requiredMemberIds.includes(item)).sort();
    const remainingMemberIds = requiredMemberIds.filter(
      (item) => !provedMemberIds.includes(item)
    );
    const satisfied = requiredMemberIds.length > 0 &&
      remainingMemberIds.length === 0;
    return {
      schemaVersion: 1,
      obligationId,
      policy: "ALL_REQUIRED",
      status: satisfied ? "SATISFIED" : "UNSATISFIED",
      requiredMemberIds,
      provedMemberIds,
      remainingMemberIds,
      confirmedBindingIds: [...new Set(confirmed.map(
        (item) => item.bindingId
      ))].sort(),
      note: satisfied
        ? "Every required acceptance member has independent fresh deterministic proof. This is obligation satisfaction metadata, not a PASS verdict."
        : "One or more required acceptance members lack fresh deterministic proof; partial or duplicate evidence cannot discharge ALL_REQUIRED coverage.",
    };
  });
}
