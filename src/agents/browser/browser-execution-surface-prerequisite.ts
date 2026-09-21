import type {
  PlannerExecutionSurfacePrerequisiteContract,
} from "../../planner/types.js";
import {
  findGroundedSearchControlCandidate,
} from "./browser-grounded-search-proof.js";
import type {
  BrowserObservation,
} from "./browser-observation.js";

export type BrowserExecutionSurfacePrerequisiteResult =
  | {
      status: "READY";
      prerequisiteId: string;
      candidateCount: number;
      surfaceReadyForInteraction: true;
      binding: {
        kind: "INPUT" | "CONTROL" | "CONTROL_SURFACE";
        label: string;
        role: string;
        observationUrl: string;
      };
    }
  | {
      status: "BLOCKED";
      prerequisiteId: string;
      candidateCount: number;
      surfaceReadyForInteraction: false;
      binding: null;
      reason:
        | "MALFORMED_CONTRACT"
        | "EXECUTION_CONTEXT_MISMATCH"
        | "SURFACE_CONTROL_NOT_GROUNDED"
        | "SURFACE_CONTROL_AMBIGUOUS";
    };

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function pathname(value: string): string {
  try {
    return new URL(value, "https://runtime.invalid").pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

function contractValid(
  contract: PlannerExecutionSurfacePrerequisiteContract
): boolean {
  const coverage = contract.acceptanceCoverage;
  return contract.schemaVersion === 1 &&
    contract.status === "SURFACE_RUNTIME_RESOLUTION_REQUIRED" &&
    contract.authority === "SOURCE_AUTHORIZED" &&
    (
      (
        contract.kind === "SEARCH_INPUT" &&
        contract.selectionPolicy === "UNIQUE_GROUNDED_CONTROL_ONLY" &&
        contract.ambiguityPolicy === "BLOCK_SURFACE_UNAVAILABLE"
      ) ||
      (
        contract.kind === "TAB_OR_FILTER_CONTROL" &&
        contract.selectionPolicy === "GROUNDED_CONTROL_SURFACE_PRESENT" &&
        contract.ambiguityPolicy === "ALLOW_MULTIPLE_GROUNDED_CONTROLS"
      )
    ) &&
    contract.runtimeBinding === "NOT_YET_RESOLVED" &&
    contract.surfaceReadyForInteraction === false &&
    contract.sourceUnitRefs.length > 0 &&
    Boolean(contract.surfacePartition.partitionId) &&
    Boolean(contract.surfacePartition.obligationId) &&
    Boolean(contract.surfacePartition.memberId) &&
    coverage.policy === "ALL_REQUIRED" &&
    coverage.requiredMemberIds.includes(coverage.memberId) &&
    coverage.plannedMemberIds.includes(coverage.memberId) &&
    coverage.memberId === contract.surfacePartition.memberId &&
    Boolean(contract.executionContext.executionContainerId) &&
    Boolean(contract.executionContext.semanticCandidateId) &&
    Boolean(contract.executionContext.executionCaseId) &&
    contract.executionContext.route.startsWith("/") &&
    ["company_admin", "talent"].includes(contract.executionContext.persona);
}

function blocked(
  contract: PlannerExecutionSurfacePrerequisiteContract,
  candidateCount: number,
  reason: Extract<
    BrowserExecutionSurfacePrerequisiteResult,
    { status: "BLOCKED" }
  >["reason"]
): BrowserExecutionSurfacePrerequisiteResult {
  return {
    status: "BLOCKED",
    prerequisiteId: contract.prerequisiteId,
    candidateCount,
    surfaceReadyForInteraction: false,
    binding: null,
    reason,
  };
}

export function resolveBrowserExecutionSurfacePrerequisite(args: {
  contract: PlannerExecutionSurfacePrerequisiteContract;
  observation: BrowserObservation;
  actualPersona: "company_admin" | "talent";
}): BrowserExecutionSurfacePrerequisiteResult {
  const { contract, observation } = args;
  if (!contractValid(contract)) {
    return blocked(contract, 0, "MALFORMED_CONTRACT");
  }
  if (
    contract.executionContext.persona !== args.actualPersona ||
    pathname(contract.executionContext.route) !== pathname(observation.url)
  ) {
    return blocked(contract, 0, "EXECUTION_CONTEXT_MISMATCH");
  }

  if (contract.kind === "SEARCH_INPUT") {
    const groundedSearchCandidateCount = observation.inputs.filter((input) => {
      const text = normalized(input.placeholder || input.label);
      return !input.disabled &&
        ["textbox", "searchbox"].includes(normalized(input.role)) &&
        /^search(?:\b|\s+by\b)/.test(text);
    }).length;
    const candidate = findGroundedSearchControlCandidate(observation);
    if ("reason" in candidate) {
      return blocked(
        contract,
        groundedSearchCandidateCount,
        candidate.reason === "SEARCH_CONTROL_AMBIGUOUS"
          ? "SURFACE_CONTROL_AMBIGUOUS"
          : "SURFACE_CONTROL_NOT_GROUNDED"
      );
    }
    return {
      status: "READY",
      prerequisiteId: contract.prerequisiteId,
      candidateCount: 1,
      surfaceReadyForInteraction: true,
      binding: {
        kind: "INPUT",
        label: candidate.label,
        role: candidate.role,
        observationUrl: observation.url,
      },
    };
  }

  const candidates = observation.controls.filter((control) => {
    const label = normalized(control.label);
    const role = normalized(control.role);
    const semanticallyInteractive = control.kind === "tab" || [
      "button", "tab", "menuitem", "checkbox", "radio",
    ].includes(role);
    return !control.disabled && semanticallyInteractive && (
      control.kind === "tab" || role === "tab" || /\bfilters?\b/.test(label)
    );
  });
  if (candidates.length === 0) {
    return blocked(contract, 0, "SURFACE_CONTROL_NOT_GROUNDED");
  }
  return {
    status: "READY",
    prerequisiteId: contract.prerequisiteId,
    candidateCount: candidates.length,
    surfaceReadyForInteraction: true,
    binding: {
      kind: "CONTROL_SURFACE",
      label:
        `${candidates.length} grounded tab/filter control` +
        `${candidates.length === 1 ? "" : "s"}`,
      role: "surface",
      observationUrl: observation.url,
    },
  };
}
