/**
 * Presentation-only projection of finalized browser facts. This module never
 * derives, mutates, or reconciles a case verdict.
 */
export type BrowserHumanReadableQaResult = {
  status: "PASS" | "FAIL" | "BLOCKED" | "MANUAL_REQUIRED" | "ERROR";
  summary: string;
  accomplished: string[];
  reason: { category: string; explanation: string };
  humanAction?: {
    required: boolean;
    instruction: string;
    requiredInputs?: Array<{ key: string; description: string }>;
  };
  rerun?: { possible: boolean; instruction?: string };
  evidence: Array<{ kind: string; description: string; path?: string }>;
  technical: { reasonCode?: string; blockerCategory?: string };
};

export type BrowserHumanReadableQaInput = {
  status: BrowserHumanReadableQaResult["status"];
  reasonCategory?: string;
  caseVerdict?: { verdict: BrowserHumanReadableQaResult["status"]; reason: string; blockerDiagnostic?: string; requiredCheckIds: string[]; passedCheckIds: string[]; failedCheckIds: string[]; missingCheckIds: string[] };
  acceptedRoutePath?: string;
  interactionExecutionCount?: number;
  terminationReason?: string;
  evidencePath?: string;
  observedFailure?: { expected: string; observed: string };
  manualQuestion?: string;
  resolutionRequest?: {
    kind: string;
    description: string;
    requiredInputs: Array<{ key: string; description: string }>;
    rerunSupported: boolean;
  };
};

function reasonFor(code: string): { category: string; explanation: string } {
  if (code === "ACTUAL_PERSONA_UNAVAILABLE") return { category: "AUTHENTICATION", explanation: "The required authenticated persona was not available to the runtime." };
  if (code === "PERSONA_MISMATCH") return { category: "AUTHENTICATION", explanation: "The authenticated persona did not match the case's required persona." };
  if (code === "ACCEPTED_ROUTE_UNAVAILABLE") return { category: "ROUTE_BINDING", explanation: "The runtime could not establish an accepted route for this case." };
  if (code === "SOURCE_ROUTE_MISMATCH") return { category: "ROUTE_BINDING", explanation: "The accepted runtime route did not match the exact source-authorized route." };
  if (code === "TARGET_VERIFICATION_UNAVAILABLE") return { category: "TARGET_GROUNDING", explanation: "The runtime could not deterministically verify the requested target on the accepted route." };
  if (code === "TARGET_VERIFICATION_FAILED") return { category: "TARGET_GROUNDING", explanation: "The runtime deterministically found that the requested target was not verified." };
  if (code === "NO_COMPATIBLE_ENTITY") return { category: "EXISTING_ENTITY_BINDING", explanation: "The required exact existing entity could not be safely selected from the available runtime candidates." };
  if (["FIXTURE_UNAVAILABLE", "TEST_DATA_ISSUE"].includes(code)) return { category: "MISSING_TEST_DATA", explanation: "The required runtime fixture state was not available or could not be verified safely." };
  if (["EXECUTION_CONTRACT_UNAVAILABLE", "NO_SOURCE_AUTHORIZED_EXECUTION_CHECKS"].includes(code)) return { category: "SOURCE_AUTHORITY", explanation: "Available runtime information is insufficient to establish a source-authorized deterministic execution check." };
  if (["UNSAFE_EXECUTION", "PRODUCT_MUTATION_OBSERVED", "PERSISTENCE_VIOLATION"].includes(code)) return { category: "RUNTIME_SAFETY", explanation: "The runtime safety policy intentionally prevented or invalidated further automation." };
  if (code === "NEEDS_MORE_CONTEXT") return { category: "NEEDS_MORE_CONTEXT", explanation: "The agent reached a bounded point where it lacked enough grounded context to choose another safe action." };
  if (code === "REQUIRED_CHECK_CONTRADICTED") return { category: "PRODUCT_FAIL", explanation: "A required deterministic check was contradicted by fresh runtime evidence." };
  if (["TYPED_MANUAL_CHECK_REQUIRED", "REQUIRED_CHECK_EVIDENCE_MISSING"].includes(code)) return { category: "MANUAL_ORACLE", explanation: "Automation could not deterministically answer the remaining acceptance question." };
  if (code === "RUNNER_ERROR") return { category: "ENVIRONMENT", explanation: "The browser runtime could not complete the operation; product behavior was not conclusively evaluated." };
  return { category: "EXECUTION_CONTEXT", explanation: "The case did not reach a completed deterministic result with the recorded execution context." };
}

export function presentBrowserHumanReadableQaResult(input: BrowserHumanReadableQaInput): BrowserHumanReadableQaResult {
  const status = input.caseVerdict?.verdict ?? input.status;
  const reasonCode = input.caseVerdict?.blockerDiagnostic ?? input.caseVerdict?.reason ?? input.reasonCategory;
  const reason = reasonFor(reasonCode ?? "");
  const technical = (blockerCategory: string) => ({
    ...(reasonCode ? { reasonCode } : {}),
    blockerCategory,
  });
  const accomplished: string[] = [];
  if (input.acceptedRoutePath) accomplished.push(`Reached accepted route ${input.acceptedRoutePath}.`);
  if ((input.interactionExecutionCount ?? 0) > 0) accomplished.push(`Completed ${input.interactionExecutionCount} verified safe read-only interaction${input.interactionExecutionCount === 1 ? "" : "s"}.`);
  if ((input.caseVerdict?.passedCheckIds.length ?? 0) > 0) accomplished.push(`Confirmed ${input.caseVerdict!.passedCheckIds.length} required deterministic check${input.caseVerdict!.passedCheckIds.length === 1 ? "" : "s"}.`);

  const evidence = input.evidencePath ? [{ kind: "runtime-artifact", description: "Recorded browser evidence artifact.", path: input.evidencePath }] : [];
  if (status === "PASS") return { status, summary: "All required deterministic checks passed.", accomplished, reason: { category: "VERIFIED", explanation: "The canonical case verdict confirmed every required check." }, evidence, technical: technical("VERIFIED") };
  if (status === "FAIL") return { status, summary: "A deterministic requirement was contradicted.", accomplished, reason: input.observedFailure ? { category: "PRODUCT_FAIL", explanation: `Expected ${input.observedFailure.expected}; observed ${input.observedFailure.observed}.` } : reason, humanAction: { required: true, instruction: "Investigate the recorded deterministic contradiction as a potential product regression." }, evidence, technical: technical("PRODUCT_FAIL") };
  if (status === "MANUAL_REQUIRED") return { status, summary: "Automation completed its deterministic checks but cannot decide the remaining question.", accomplished, reason, humanAction: { required: true, instruction: input.manualQuestion ?? "Review the available evidence for the remaining acceptance question." }, evidence, technical: technical(reason.category) };
  if (status === "ERROR") return { status, summary: "The browser runtime did not complete this case.", accomplished, reason, humanAction: { required: true, instruction: "Restore the reported environment or runtime dependency, then retry." }, rerun: { possible: true, instruction: "Retry after the runtime error is resolved." }, evidence, technical: technical(reason.category) };
  return { status, summary: "The case stopped before a deterministic verdict could be completed.", accomplished, reason, ...(input.resolutionRequest ? { humanAction: { required: true, instruction: input.resolutionRequest.description, requiredInputs: input.resolutionRequest.requiredInputs }, rerun: { possible: input.resolutionRequest.rerunSupported, ...(input.resolutionRequest.rerunSupported ? { instruction: "Supply the requested execution context, then rerun the case." } : {}) } } : {}), evidence, technical: technical(reason.category) };
}

export function formatBrowserHumanReadableQaResult(result: BrowserHumanReadableQaResult): string {
  const lines = [
    "────────────────────────────────────────",
    `RESULT: ${result.status}`,
    result.summary,
    ...result.accomplished.map((item) => `Completed: ${item}`),
    `Why: ${result.reason.explanation}`,
    ...(result.humanAction ? [
      `Required from QA: ${result.humanAction.instruction}`,
      ...(result.humanAction.requiredInputs ?? []).map((item) => `  • ${item.key}: ${item.description}`),
    ] : []),
    `Technical: ${result.technical.reasonCode ?? "not recorded"}`,
    "────────────────────────────────────────",
  ];
  return lines.join("\n");
}
