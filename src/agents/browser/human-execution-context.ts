import crypto from "node:crypto";
import fs from "node:fs";
import type {
  ContractFixtureRequirementContext,
  VerifiedContractFixtureCandidate,
} from "./fixtures/verified-contract-fixture-state.js";
import { evaluateContractFixtureCandidate } from "./fixtures/verified-contract-fixture-state.js";

export type HumanResolutionRequest = {
  requestId: string;
  caseId: string;
  resolutionKind: "EXISTING_ENTITY_BINDING";
  entityType: "talent-contract";
  persona: "talent";
  requiredInputs: Array<{ key: "entityId"; description: string }>;
};

export type HumanResolutionSubmission = {
  caseId: string;
  resolutionKind: "EXISTING_ENTITY_BINDING";
  requestId: string;
  inputs: { entityId: string };
  provenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT";
};

export type HumanConfirmedExecutionContext = {
  caseId: string;
  entityType: "talent-contract";
  entityId: string;
  persona: "talent";
  provenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT";
  requestId: string;
};

export type HumanResolutionCandidate = {
  entityId: string;
  displayLabel: string;
  entityType: "talent-contract";
  compatible: true;
  facts: Array<{ label: string; value: string | number | boolean }>;
};

export type HumanResolutionCandidateDiscovery = {
  resolutionRequest: HumanResolutionRequest;
  requirementSummary: string;
  candidates: HumanResolutionCandidate[];
  canRescan: true;
  automaticProvisioningAvailable: false;
};

function exactId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 200 && !/[\\/\u0000-\u001f\u007f]/.test(normalized) ? normalized : undefined;
}

export function buildTalentContractHumanResolutionRequest(args: {
  caseId: string;
  fixtureDescription: string;
}): HumanResolutionRequest {
  const identity = `${args.caseId}|EXISTING_ENTITY_BINDING|talent-contract|entityId|${args.fixtureDescription}`;
  return {
    requestId: crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24),
    caseId: args.caseId,
    resolutionKind: "EXISTING_ENTITY_BINDING",
    entityType: "talent-contract",
    persona: "talent",
    requiredInputs: [{ key: "entityId", description: args.fixtureDescription }],
  };
}

function candidateFacts(
  candidate: VerifiedContractFixtureCandidate
): HumanResolutionCandidate["facts"] {
  const values = new Map(candidate.facts.map((fact) => [fact.key, fact.value]));
  const facts: HumanResolutionCandidate["facts"] = [];
  const status = values.get("contract.status");
  const hasWorkSetups = values.get("contract.hasWorkSetups");
  if (status !== undefined) facts.push({ label: "Status", value: status });
  if (typeof hasWorkSetups === "boolean") facts.push({ label: "Work Setups assigned", value: hasWorkSetups ? "Yes" : "No" });
  return facts;
}

/** Presentation projection only; compatibility remains derived by the existing verifier. */
export function buildTalentContractHumanResolutionCandidates(args: {
  request: HumanResolutionRequest;
  requirementContext: ContractFixtureRequirementContext;
  candidates: VerifiedContractFixtureCandidate[];
  expectedOwnerId: string;
}): HumanResolutionCandidateDiscovery {
  const { exactEntityId: _ignoredExactEntityId, ...compatibleRequirementContext } =
    args.requirementContext;
  const compatible = args.candidates
    .filter((candidate) => evaluateContractFixtureCandidate(
      candidate,
      {
        ...compatibleRequirementContext,
        // Discovery finds candidates for an exact human choice; the existing
        // rerun validator applies that chosen identity as the exact binding.
        policy: "compatible-state",
      },
      args.expectedOwnerId
    ).status === "COMPATIBLE")
    .sort((left, right) => left.identity.entityId.localeCompare(right.identity.entityId));
  return {
    resolutionRequest: args.request,
    requirementSummary: args.request.requiredInputs.map((input) => input.description).join("; "),
    candidates: compatible.map((candidate) => ({
      entityId: candidate.identity.entityId,
      displayLabel: `Contract #${candidate.identity.entityId}`,
      entityType: "talent-contract",
      compatible: true,
      facts: candidateFacts(candidate),
    })),
    canRescan: true,
    automaticProvisioningAvailable: false,
  };
}

/** A human chooses a displayed compatible candidate; this creates no verdict or proof state. */
export function buildHumanResolutionSubmissionFromCandidate(args: {
  discovery: HumanResolutionCandidateDiscovery;
  candidateIndex: number;
}): HumanResolutionSubmission | undefined {
  if (!Number.isSafeInteger(args.candidateIndex) || args.candidateIndex < 1) return undefined;
  const candidate = args.discovery.candidates[args.candidateIndex - 1];
  if (!candidate) return undefined;
  return {
    caseId: args.discovery.resolutionRequest.caseId,
    resolutionKind: "EXISTING_ENTITY_BINDING",
    requestId: args.discovery.resolutionRequest.requestId,
    inputs: { entityId: candidate.entityId },
    provenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT",
  };
}

export function readHumanResolutionSubmission(args: {
  path?: string;
  request: HumanResolutionRequest;
  readFile?: (path: string, encoding: BufferEncoding) => string;
}): HumanConfirmedExecutionContext | undefined {
  if (!args.path) return undefined;
  try {
    const value = JSON.parse((args.readFile ?? fs.readFileSync)(args.path, "utf8")) as Record<string, unknown>;
    const keys = Object.keys(value).sort();
    if (keys.join("|") !== "caseId|inputs|provenance|requestId|resolutionKind") return undefined;
    const inputs = value.inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs) || Object.keys(inputs).join("|") !== "entityId") return undefined;
    const entityId = exactId((inputs as Record<string, unknown>).entityId);
    if (!entityId || value.caseId !== args.request.caseId || value.resolutionKind !== args.request.resolutionKind || value.requestId !== args.request.requestId || value.provenance !== "HUMAN_CONFIRMED_EXECUTION_CONTEXT") return undefined;
    return { caseId: args.request.caseId, entityType: args.request.entityType, entityId, persona: args.request.persona, provenance: "HUMAN_CONFIRMED_EXECUTION_CONTEXT", requestId: args.request.requestId };
  } catch {
    return undefined;
  }
}
