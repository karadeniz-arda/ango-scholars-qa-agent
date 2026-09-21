import type {
  BrowserTestCase,
  PlannerAcceptanceObligation,
  PlannerSourceInvoiceExecutionCapability,
  TestPlan,
} from "./types.js";

export type SourceInvoiceState =
  | "processed"
  | "sent-for-processing";

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sourceContainsInvoiceState(
  text: string,
  state: SourceInvoiceState
): boolean {
  const value = normalized(text);
  return value.includes("invoice") && (
    state === "processed"
      ? /\bprocessed\b/.test(value)
      : /\bsent[\s-]+for[\s-]+processing\b/.test(value)
  );
}

/** Existing bounded source parser for the canonical invoice state members. */
export function sourceBackedInvoiceStates(
  obligations: PlannerAcceptanceObligation[]
): SourceInvoiceState[] {
  return (["processed", "sent-for-processing"] as const)
    .filter((state) => obligations.some((item) =>
      sourceContainsInvoiceState(item.text, state)
    ));
}

export function sourceInvoiceCapabilityForObligation(
  obligation: PlannerAcceptanceObligation
): PlannerSourceInvoiceExecutionCapability | undefined {
  const text = normalized(obligation.text);
  const requiredStates = sourceBackedInvoiceStates([obligation]);
  if (
    requiredStates.length === 0 ||
    !/\binvoice\b/.test(text) ||
    !/(?:drawer|details)/i.test(text)
  ) {
    return undefined;
  }
  return {
    kind: "INVOICE_RUNTIME_FIXTURE",
    authority: "SOURCE_AUTHORIZED",
    obligationIds: [obligation.id],
    sourceUnitIds: [...obligation.sourceUnitIds].sort(),
    requiredStates: [...requiredStates].sort(),
    targetScope: "INVOICE_DETAILS_DRAWER",
    resolverRef: "browser-visible-invoice-row",
    supportedPersona: "company_admin",
  };
}

export function compileSourceInvoiceExecutionCapabilities(
  plan: Pick<TestPlan, "acceptanceObligationLedger" | "acceptanceSourceLedger">
): PlannerSourceInvoiceExecutionCapability[] {
  if (
    plan.acceptanceObligationLedger?.sourceStatus !== "RESOLVED" ||
    plan.acceptanceSourceLedger?.sourceStatus !== "RESOLVED"
  ) {
    return [];
  }
  const sourceUnitIds = new Set(
    plan.acceptanceSourceLedger.sourceUnits.map((item) => item.id)
  );
  return (plan.acceptanceObligationLedger.obligations ?? [])
    .flatMap((obligation) => {
      if (obligation.sourceUnitIds.some((id) => !sourceUnitIds.has(id))) {
        return [];
      }
      const capability = sourceInvoiceCapabilityForObligation(obligation);
      return capability ? [capability] : [];
    })
    .sort((left, right) => left.obligationIds[0]!.localeCompare(right.obligationIds[0]!));
}

export function sourceInvoiceCapabilityForCase(
  plan: Pick<TestPlan, "sourceInvoiceExecutionCapabilities" | "browserCases">,
  testCase: BrowserTestCase
): PlannerSourceInvoiceExecutionCapability | undefined {
  const capabilities = plan.sourceInvoiceExecutionCapabilities ?? [];
  const obligationIds = testCase.acceptanceObligationIds ?? [];
  const matched = capabilities.filter((capability) =>
    capability.obligationIds.some((id) => obligationIds.includes(id))
  );
  if (matched.length === 1) return matched[0];
  return matched.length === 0 && capabilities.length === 1 &&
    ((plan.browserCases?.length ?? 0) === 1 ||
      Boolean(testCase.plannerExecutionShell) ||
      Boolean((testCase as BrowserTestCase & { __plannerInvoiceState?: unknown })
        .__plannerInvoiceState))
    ? capabilities[0]
    : undefined;
}
