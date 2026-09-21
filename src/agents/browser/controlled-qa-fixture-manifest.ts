import fs from "node:fs";

export type ControlledQaTalentContractFixture = {
  entityType: "talent-contract";
  entityId: string;
  relationships?: { talentId?: string; jobId?: string };
  preconditions?: { workSetup?: "ABSENT" | "PRESENT"; contractStatus?: "ACTIVE_OR_STARTED" };
  persona: "talent";
  provenance: "CONTROLLED_QA_FIXTURE";
};

export type ControlledQaTalentContractCandidateFacts = {
  entityId: string;
  ownerId: string;
  ownershipVerified: boolean;
  hasWorkSetups: boolean;
  status: string;
};

type ControlledQaFixtureManifest = {
  mode: "CONTROLLED_QA_VALIDATION";
  cases: Record<string, ControlledQaTalentContractFixture>;
};

function nonEmptyId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 200 ? normalized : undefined;
}

const forbiddenAuthorityFields = new Set([
  "assertionResult",
  "evidence",
  "goalSatisfied",
  "proof",
  "verdict",
]);

/** Validates only fixture identity and observed prerequisite facts; it cannot create proof or a verdict. */
export function controlledQaFixtureMatchesCandidate(args: {
  fixture: ControlledQaTalentContractFixture;
  candidate: ControlledQaTalentContractCandidateFacts;
  talentId: string;
}): boolean {
  const { fixture, candidate, talentId } = args;
  return candidate.entityId === fixture.entityId &&
    candidate.ownerId === talentId &&
    candidate.ownershipVerified === true &&
    (!fixture.relationships?.talentId || fixture.relationships.talentId === talentId) &&
    (!fixture.preconditions?.workSetup || candidate.hasWorkSetups === (fixture.preconditions.workSetup === "PRESENT")) &&
    (!fixture.preconditions?.contractStatus || candidate.status === "ACTIVE");
}

export function controlledQaFixtureForCase(args: {
  caseId: string;
  manifestPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
}): ControlledQaTalentContractFixture | undefined {
  if (!args.manifestPath) return undefined;
  try {
    const parsed = JSON.parse((args.readFile ?? fs.readFileSync)(args.manifestPath, "utf8")) as Partial<ControlledQaFixtureManifest>;
    const raw = parsed.mode === "CONTROLLED_QA_VALIDATION" && parsed.cases && typeof parsed.cases === "object"
      ? parsed.cases[args.caseId]
      : undefined;
    if (!raw || raw.entityType !== "talent-contract" || raw.persona !== "talent" || raw.provenance !== "CONTROLLED_QA_FIXTURE") return undefined;
    if (Object.keys(raw).some((field) => forbiddenAuthorityFields.has(field))) return undefined;
    const entityId = nonEmptyId(raw.entityId);
    if (!entityId) return undefined;
    const talentId = nonEmptyId(raw.relationships?.talentId);
    const jobId = nonEmptyId(raw.relationships?.jobId);
    const workSetup = raw.preconditions?.workSetup;
    const contractStatus = raw.preconditions?.contractStatus;
    if ((workSetup && workSetup !== "ABSENT" && workSetup !== "PRESENT") || (contractStatus && contractStatus !== "ACTIVE_OR_STARTED")) return undefined;
    return { entityType: "talent-contract", entityId, persona: "talent", provenance: "CONTROLLED_QA_FIXTURE", ...(talentId || jobId ? { relationships: { ...(talentId ? { talentId } : {}), ...(jobId ? { jobId } : {}) } } : {}), ...(workSetup || contractStatus ? { preconditions: { ...(workSetup ? { workSetup } : {}), ...(contractStatus ? { contractStatus } : {}) } } : {}) };
  } catch {
    return undefined;
  }
}
