import type { ApiTestCase, BrowserStep, BrowserTestCase } from "./types.js";

/** Fields that may cross the model-output boundary. Authority is compiled later. */
export type PlannerBrowserCaseProposal = {
  id: string;
  persona: "company_admin" | "talent";
  goal: string;
  startRoute: string;
  successCriteria: string;
  automatedChecks: string[];
  manualChecks: string[];
  fixtureRequirements: string[];
  steps: BrowserStep[];
};

export type PlannerBrowserSemanticCandidateProposal = {
  id: string;
  proposedCaseId: string;
  obligationIds: string[];
  sourceUnitIds: string[];
  proposedBehavior: string;
  proposedPersona?: "company_admin" | "talent" | "unknown";
  proposedTargetSurface?: string;
  proposedMutationClass?: string;
  sourceMemberCoverageClaims?: string[];
  proposedChecks: Array<{ text: string; obligationIds: string[]; proposedRole: string }>;
  proposedFixtureNeeds: Array<{ text: string; obligationIds: string[] } | string>;
  proposedRelationshipHints: Array<{
    relationship: string;
    obligationIds: string[];
    dependsOnObligationIds: string[];
    reason: string;
  }>;
};

export type PlannerModelProposal = {
  issueKey: string;
  summary: string;
  notes?: string;
  apiCases: ApiTestCase[];
  browserCases: PlannerBrowserCaseProposal[];
  browserSemanticCandidates?: PlannerBrowserSemanticCandidateProposal[];
};

/** The sole proposal-to-executable case boundary. No compiler authority is created here. */
export function materializePlannerBrowserCaseProposal(
  proposal: PlannerBrowserCaseProposal
): BrowserTestCase {
  const steps = proposal.steps.map((item) => item.action === "assertSurfaceControls"
    ? { ...item, controls: item.controls.map((control) => ({ ...control })) }
    : { ...item });
  return {
    id: proposal.id,
    persona: proposal.persona,
    goal: proposal.goal,
    startRoute: proposal.startRoute,
    successCriteria: proposal.successCriteria,
    automatedChecks: [...proposal.automatedChecks],
    manualChecks: [...proposal.manualChecks],
    fixtureRequirements: [...proposal.fixtureRequirements],
    steps,
  };
}

const text = (value: unknown): string => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function step(value: unknown): BrowserStep | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const action = item.action;
  switch (action) {
    case "wait": return typeof item.ms === "number" ? { action, ms: item.ms } : undefined;
    case "reload":
    case "selectRuntimeTopTab": return { action };
    case "setViewport": return typeof item.width === "number" && typeof item.height === "number"
      ? { action, width: item.width, height: item.height } : undefined;
    case "clickTopTab": case "clickButton": case "clickText": case "openMenu":
      return typeof item.text === "string" ? { action, text: item.text } as BrowserStep : undefined;
    case "openRuntimeControl": return typeof item.target === "string" ? { action, target: item.target } : undefined;
    case "selectOption": return typeof item.text === "string" ? { action, text: item.text } : undefined;
    case "selectRuntimeFilterOption": {
      if (typeof item.filterKey === "string" && item.verification === "visible-state") {
        return { action, filterKey: item.filterKey, verification: "visible-state", ...(typeof item.hint === "string" ? { hint: item.hint } : {}) };
      }
      if (typeof item.queryKey === "string") return { action, queryKey: item.queryKey, hint: typeof item.hint === "string" ? item.hint : undefined, verification: item.verification === "url" ? "url" : undefined } as BrowserStep;
      return undefined;
    }
    case "createDraftJobAndVerifyRedirect": return item.origin === "jobs" || item.origin === "all-jobs" ? { action, origin: item.origin } : undefined;
    case "assertUrlContains": case "assertUrlNotContains": case "assertTextVisible": case "assertTextNotVisible":
      return typeof item.text === "string" ? { action, text: item.text } : undefined;
    case "assertSurfaceControls": {
      if (!["dialog", "menu", "listbox", "region", "surface"].includes(String(item.surfaceKind)) || !Array.isArray(item.controls)) return undefined;
      const controls = item.controls.flatMap((control) => {
        if (!control || typeof control !== "object") return [];
        const c = control as Record<string, unknown>;
        return typeof c.kind === "string" && typeof c.label === "string" ? [{ kind: c.kind, label: c.label }] : [];
      });
      return { action, surfaceKind: item.surfaceKind, controls } as BrowserStep;
    }
    default: return undefined;
  }
}

function browserCase(value: unknown): PlannerBrowserCaseProposal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const persona = item.persona === "company_admin" || item.persona === "talent" ? item.persona : undefined;
  if (!persona) return undefined;
  return {
    id: text(item.id), persona, goal: text(item.goal), startRoute: text(item.startRoute),
    successCriteria: text(item.successCriteria), automatedChecks: strings(item.automatedChecks),
    manualChecks: strings(item.manualChecks), fixtureRequirements: strings(item.fixtureRequirements),
    steps: Array.isArray(item.steps) ? item.steps.flatMap((entry) => { const result = step(entry); return result ? [result] : []; }) : [],
  };
}

function semanticCandidate(value: unknown): PlannerBrowserSemanticCandidateProposal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const objectArray = (key: string) => Array.isArray(item[key]) ? item[key] : [];
  return {
    id: text(item.id), proposedCaseId: text(item.proposedCaseId), obligationIds: strings(item.obligationIds), sourceUnitIds: strings(item.sourceUnitIds),
    proposedBehavior: text(item.proposedBehavior),
    ...(item.proposedPersona === "company_admin" || item.proposedPersona === "talent" || item.proposedPersona === "unknown" ? { proposedPersona: item.proposedPersona } : {}),
    ...(typeof item.proposedTargetSurface === "string" ? { proposedTargetSurface: item.proposedTargetSurface } : {}),
    ...(typeof item.proposedMutationClass === "string" ? { proposedMutationClass: item.proposedMutationClass } : {}),
    ...(Array.isArray(item.sourceMemberCoverageClaims) ? { sourceMemberCoverageClaims: strings(item.sourceMemberCoverageClaims) } : {}),
    proposedChecks: objectArray("proposedChecks").flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const e = entry as Record<string, unknown>; return typeof e.text === "string" && typeof e.proposedRole === "string" ? [{ text: e.text, obligationIds: strings(e.obligationIds), proposedRole: e.proposedRole }] : []; }),
    proposedFixtureNeeds: objectArray("proposedFixtureNeeds").reduce<Array<string | { text: string; obligationIds: string[] }>>((result, entry) => { if (typeof entry === "string") { result.push(entry); } else if (entry && typeof entry === "object") { const e = entry as Record<string, unknown>; if (typeof e.text === "string") result.push({ text: e.text, obligationIds: strings(e.obligationIds) }); } return result; }, []),
    proposedRelationshipHints: objectArray("proposedRelationshipHints").flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const e = entry as Record<string, unknown>; return typeof e.relationship === "string" && typeof e.reason === "string" ? [{ relationship: e.relationship, obligationIds: strings(e.obligationIds), dependsOnObligationIds: strings(e.dependsOnObligationIds), reason: e.reason }] : []; }),
  };
}

function apiCase(value: unknown): ApiTestCase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const persona = item.persona === "company_admin" || item.persona === "talent" || item.persona === "unauthenticated" ? item.persona : undefined;
  const method = item.method === "GET" || item.method === "POST" || item.method === "PATCH" || item.method === "DELETE" ? item.method : undefined;
  const expect = item.expect && typeof item.expect === "object" ? item.expect as Record<string, unknown> : {};
  const status = typeof expect.status === "number" || expect.status === "UNKNOWN" ? expect.status : "UNKNOWN";
  if (!persona || !method) return undefined;
  return {
    id: text(item.id), persona, method, path: text(item.path),
    ...(Object.prototype.hasOwnProperty.call(item, "body") ? { body: item.body } : {}),
    expect: {
      status,
      ...(typeof expect.contentType === "string" ? { contentType: expect.contentType } : {}),
      ...(typeof expect.notes === "string" ? { notes: expect.notes } : {}),
    },
  };
}

export function normalizePlannerModelProposal(raw: unknown): PlannerModelProposal {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const semanticCandidates = Array.isArray(item.browserSemanticCandidates)
    ? item.browserSemanticCandidates.flatMap((entry) => { const result = semanticCandidate(entry); return result ? [result] : []; })
    : undefined;
  return {
    issueKey: text(item.issueKey), summary: text(item.summary),
    ...(typeof item.notes === "string" ? { notes: item.notes } : {}),
    apiCases: Array.isArray(item.apiCases) ? item.apiCases.flatMap((entry) => { const result = apiCase(entry); return result ? [result] : []; }) : [],
    browserCases: Array.isArray(item.browserCases) ? item.browserCases.flatMap((entry) => { const result = browserCase(entry); return result ? [result] : []; }) : [],
    ...(semanticCandidates !== undefined ? { browserSemanticCandidates: semanticCandidates } : {}),
  };
}

export function clonePlannerSemanticCandidateProposals(
  candidates: PlannerBrowserSemanticCandidateProposal[]
): PlannerBrowserSemanticCandidateProposal[] {
  return candidates.map((candidate) => ({
    ...candidate,
    obligationIds: [...candidate.obligationIds],
    sourceUnitIds: [...candidate.sourceUnitIds],
    ...(candidate.sourceMemberCoverageClaims
      ? { sourceMemberCoverageClaims: [...candidate.sourceMemberCoverageClaims] }
      : {}),
    proposedChecks: candidate.proposedChecks.map((check) => ({ ...check, obligationIds: [...check.obligationIds] })),
    proposedFixtureNeeds: candidate.proposedFixtureNeeds.map((need) => typeof need === "string" ? need : { ...need, obligationIds: [...need.obligationIds] }),
    proposedRelationshipHints: candidate.proposedRelationshipHints.map((hint) => ({ ...hint, obligationIds: [...hint.obligationIds], dependsOnObligationIds: [...hint.dependsOnObligationIds] })),
  }));
}
