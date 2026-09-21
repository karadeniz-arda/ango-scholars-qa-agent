import {
  hasVerbatimSourceGroundedVisibleText,
} from "./planner-browser-policy.js";
import {
  compileSourceInvoiceExecutionCapabilities,
  sourceInvoiceCapabilityForCase,
} from "./planner-source-invoice-capability.js";

/*
 * PLANNER_FIXTURE_POLICY_V1
 *
 * The LLM is instructed to distinguish an exact
 * Jira identity from a GitHub/test fixture.
 *
 * This deterministic gate provides the safe
 * fallback for invoice cases:
 *
 * - invoice appears in Jira section:
 *     exact
 * - invoice appears only outside Jira:
 *     compatible-state
 * - no Jira identity + grounded invoice state:
 *     compatible-state through the specialized resolver
 * - missing invoice state:
 *     exact
 *
 * compatible-state is currently accepted only for
 * invoice cases handled by the specialized invoice
 * runtime resolver.
 */
function extractPlannerJiraSection(
  sourceContext: string
): string {
  const jiraMarker =
    "--- JIRA TICKET ---";

  const githubMarker =
    "--- GITHUB CHANGE CONTEXT ---";

  const jiraStart =
    sourceContext.indexOf(
      jiraMarker
    );

  if (jiraStart < 0) {
    /*
     * Without reliable source boundaries, use the
     * whole context as Jira-equivalent. This safely
     * defaults concrete identities to exact.
     */
    return sourceContext;
  }

  const githubStart =
    sourceContext.indexOf(
      githubMarker,
      jiraStart +
        jiraMarker.length
    );

  if (githubStart < 0) {
    return sourceContext.slice(
      jiraStart
    );
  }

  return sourceContext.slice(
    jiraStart,
    githubStart
  );
}

function findInvoiceNumbers(
  value: unknown
): string[] {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(
          value ?? {}
        );

  const matches =
    text.match(
      /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/gi
    ) ?? [];

  return [
    ...new Set(
      matches.map(
        (match) =>
          match.toUpperCase()
      )
    ),
  ];
}

type PlannerInvoiceState =
  | "sent for processing"
  | "processed";

function canonicalPlannerInvoiceState(
  value: unknown
): PlannerInvoiceState | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");

  return normalized === "sent for processing" ||
    normalized === "processed"
    ? normalized
    : null;
}

function singleInvoiceStateInText(
  value: unknown
): PlannerInvoiceState | null {
  const text = String(value ?? "");
  const states = [
    /sent\s+for\s+processing/i.test(text)
      ? "sent for processing" as const
      : null,
    /\bprocessed\b/i.test(text)
      ? "processed" as const
      : null,
  ].filter(
    (state): state is PlannerInvoiceState =>
      state !== null
  );

  return states.length === 1
    ? states[0]!
    : null;
}

/*
 * PLANNER_ATOMIC_INVOICE_EXECUTION_IDENTITY_V1
 *
 * Parent acceptance prose may describe every required invoice
 * state even when one BrowserTestCase executes exactly one state.
 * Preserve the strongest existing bounded execution identity:
 *
 * 1. deterministic partition/internal metadata;
 * 2. an exact state-selecting execution step;
 * 3. an exact single-state case goal.
 *
 * Success criteria remain available to the legacy combined-case
 * detector only when no narrower execution identity exists.
 */
function boundedPlannerInvoiceState(
  browserCase: any
): PlannerInvoiceState | null {
  const metadataStates = [
    canonicalPlannerInvoiceState(
      browserCase?.__plannerInvoiceState
    ),
    canonicalPlannerInvoiceState(
      browserCase?.plannerExecutionShell
        ?.partition?.memberId
    ),
  ].filter(
    (state): state is PlannerInvoiceState =>
      state !== null
  );

  if (metadataStates.length > 0) {
    return new Set(metadataStates).size === 1
      ? metadataStates[0]!
      : null;
  }

  const stateSelectingSteps = (
    Array.isArray(browserCase?.steps)
      ? browserCase.steps
      : []
  )
    .filter(
      (step: any) =>
        step?.action === "clickTopTab"
    )
    .map((step: any) =>
      singleInvoiceStateInText(
        step?.text
      )
    )
    .filter(
      (
        state: PlannerInvoiceState | null
      ): state is PlannerInvoiceState =>
        state !== null
    );

  if (stateSelectingSteps.length > 0) {
    return new Set(stateSelectingSteps).size === 1
      ? stateSelectingSteps[0]!
      : null;
  }

  return singleInvoiceStateInText(
    browserCase?.goal
  );
}

/*
 * AS1014_INVOICE_STATE_SPLIT_V1
 *
 * The planner may merge sent-for-processing and
 * processed coverage into one browser case.
 *
 * Split that combined case before discovery and
 * deduplication so the two material states cannot
 * collapse into one executable case.
 */
export function splitCombinedInvoiceStateCases(
  plan: any
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const expandedCases: any[] = [];
  const sourceCapabilities = plan.sourceInvoiceExecutionCapabilities ??
    compileSourceInvoiceExecutionCapabilities(plan);
  const capabilityPlan = {
    ...plan,
    sourceInvoiceExecutionCapabilities: sourceCapabilities,
  };

  for (const browserCase of browserCases) {
    const sourceCapability = sourceInvoiceCapabilityForCase(capabilityPlan, browserCase);
    if (!sourceCapability) {
      /* Preserve the archived model-authored transform for legacy plans that
       * have no typed acceptance ledger. It cannot create a source capability
       * or a source-authorized runtime contract. */
      const caseText = [
        String(browserCase?.goal || ""),
        String(browserCase?.successCriteria || ""),
        JSON.stringify(browserCase?.steps ?? []),
      ].join(" ");
      const bounded = boundedPlannerInvoiceState(browserCase);
      const isInvoiceDrawerCase = /invoice/i.test(caseText) &&
        /(drawer|details)/i.test(caseText);
      if (isInvoiceDrawerCase && bounded) {
        browserCase.__plannerInvoiceState = bounded;
        expandedCases.push(browserCase);
        continue;
      }
      if (!isInvoiceDrawerCase ||
        !/sent\s+for\s+processing/i.test(caseText) ||
        !/\bprocessed\b/i.test(caseText)) {
        expandedCases.push(browserCase);
        continue;
      }
      expandedCases.push(
        { ...browserCase, id: `${String(browserCase?.id || "web")}-sent`,
          __plannerInvoiceState: "sent for processing",
          plannerExecutionShell: { sourceCaseId: String(browserCase?.id || "web"),
            partition: { mode: "ALL_REQUIRED", memberId: "sent-for-processing", memberCount: 2 } } },
        { ...browserCase, id: `${String(browserCase?.id || "web")}-processed`,
          __plannerInvoiceState: "processed",
          plannerExecutionShell: { sourceCaseId: String(browserCase?.id || "web"),
            partition: { mode: "ALL_REQUIRED", memberId: "processed", memberCount: 2 } } },
      );
      continue;
    }
    const modelState = boundedPlannerInvoiceState(browserCase);
    if (modelState && sourceCapability.requiredStates.includes(
      modelState === "sent for processing" ? "sent-for-processing" : modelState
    )) {
      browserCase.__plannerInvoiceState = modelState;
      expandedCases.push(browserCase);
      continue;
    }
    const sourceStates = sourceCapability.requiredStates;
    const existingShellState = String(
      browserCase?.plannerExecutionShell?.partition?.memberId ?? ""
    ).toLowerCase();
    const existingSourceState = sourceStates.find((state) =>
      state === existingShellState
    );
    if (
      sourceStates.length === 1 ||
      (sourceStates.length > 1 &&
        existingSourceState !== undefined)
    ) {
      const state = sourceStates.length === 1
        ? sourceStates[0]!
        : existingSourceState!;
      browserCase.__plannerInvoiceState =
        state === "sent-for-processing" ? "sent for processing" : state;
      expandedCases.push(
        browserCase
      );
      continue;
    }

    expandedCases.push(
      {
        ...browserCase,
        id:
          `${String(
            browserCase?.id || "web"
          )}-sent`,
        __plannerInvoiceState:
          "sent for processing",
        plannerExecutionShell: {
          sourceCaseId: String(
            browserCase?.id || "web"
          ),
          partition: {
            mode: "ALL_REQUIRED",
            memberId: "sent-for-processing",
            memberCount: 2,
          },
        },
      },
      {
        ...browserCase,
        id:
          `${String(
            browserCase?.id || "web"
          )}-processed`,
        __plannerInvoiceState:
          "processed",
        plannerExecutionShell: {
          sourceCaseId: String(
            browserCase?.id || "web"
          ),
          partition: {
            mode: "ALL_REQUIRED",
            memberId: "processed",
            memberCount: 2,
          },
        },
      }
    );
  }

  plan.browserCases =
    expandedCases;

  return plan;
}

export function applyPlannerRuntimeFixturePolicies(
  plan: any,
  sourceContext: string
): any {
  const browserCases =
    Array.isArray(plan?.browserCases)
      ? plan.browserCases
      : [];

  const jiraSection =
    extractPlannerJiraSection(
      sourceContext
    );

  const jiraInvoices =
    new Set(
      findInvoiceNumbers(
        jiraSection
      )
    );

  const sourceInvoices =
    findInvoiceNumbers(
      sourceContext
    );

  const compatibleCandidates =
    sourceInvoices.filter(
      (invoiceNumber) =>
        !jiraInvoices.has(
          invoiceNumber
        )
    );

  const policyNotes: string[] = [];
  const sourceCapabilities = plan.sourceInvoiceExecutionCapabilities ??
    compileSourceInvoiceExecutionCapabilities(plan);
  const capabilityPlan = {
    ...plan,
    sourceInvoiceExecutionCapabilities: sourceCapabilities,
  };

  for (
    const browserCase
    of browserCases
  ) {
    const sourceCapability = sourceInvoiceCapabilityForCase(capabilityPlan, browserCase);
    const goal =
      String(
        browserCase?.goal || ""
      );

    const successCriteria =
      String(
        browserCase
          ?.successCriteria || ""
      );

    const caseText = [
      goal,
      successCriteria,
      JSON.stringify(
        browserCase?.steps ?? []
      ),
    ].join(" ");

    const isInvoiceDrawerCase = Boolean(sourceCapability) ||
      (/invoice/i.test(caseText) && /(drawer|details)/i.test(caseText));

        const plannerInvoiceState =
      String(
        browserCase
          ?.__plannerInvoiceState ||
          ""
      )
        .trim()
        .toLowerCase();

    /*
     * Internal planner metadata must not appear
     * in the final generated test plan.
     */
    delete browserCase
      .__plannerInvoiceState;

    if (!isInvoiceDrawerCase) {
      delete browserCase.fixtureIdentityAuthority;
      browserCase.runtimeFixturePolicy = "exact";
      continue;
    }

    const caseInvoices =
      findInvoiceNumbers(
        browserCase
      );

    const exactJiraInvoice =
      caseInvoices.find(
        (invoiceNumber) =>
          jiraInvoices.has(
            invoiceNumber
          )
      );

    if (exactJiraInvoice) {
      browserCase.runtimeFixturePolicy =
        "exact";

      policyNotes.push(
        `${String(
          browserCase?.id ||
          "browser-case"
        )}: exact invoice identity is ` +
        `grounded in Jira.`
      );

      continue;
    }

    const candidateInvoice =
      caseInvoices.find(
        (invoiceNumber) =>
          !jiraInvoices.has(
            invoiceNumber
          )
      ) ??
      compatibleCandidates[0];

    /*
     * INVOICE_RUNTIME_RESOLVER_WITHOUT_HINT_V1
     *
     * A concrete planner invoice is optional. The specialized
     * browser resolver can safely select a runtime invoice and
     * verify the required table state and opened identity.
     */
    const resolverRequestText =
      candidateInvoice ??
      "invoice number";

    const shellState = String(
      browserCase?.plannerExecutionShell?.partition?.memberId ?? ""
    ).toLowerCase();
    const sourceStates = sourceCapability?.requiredStates ?? [];
    const requiredTableView =
      plannerInvoiceState ===
        "sent for processing" ||
      plannerInvoiceState ===
        "processed"
        ? plannerInvoiceState
        : sourceStates.length === 1
          ? sourceStates[0] === "sent-for-processing"
            ? "sent for processing"
            : "processed"
          : shellState === "sent-for-processing" || shellState === "processed"
            ? shellState === "sent-for-processing"
              ? "sent for processing"
              : "processed"
        : /sent\s+for\s+processing/i.test(
              caseText
            )
          ? "sent for processing"
          : /\bprocessed\b/i.test(
                caseText
              )
            ? "processed"
          : null;

    /*
     * SOURCE_BACKED_APPROVED_INVOICE_COMPATIBLE_STATE_V1
     *
     * "Approved" is a drawer-level invoice state understood and verified by
     * the generic resolveAndOpenInvoiceRow() path. It is deliberately NOT
     * added to the typed processed/sent-for-processing table-state contract.
     *
     * Only an affirmative approved-invoice state in the authoritative Jira
     * section can enable substitution. "Invoice Approved By" alone is a
     * disclosure label, not state authority. Any model/GitHub invoice literal
     * remains a hint and is normalized back to the semantic runtime target.
     */
    const sourceBackedApprovedInvoiceState =
      (
        /\bapproved\s+invoice\b/i.test(jiraSection) ||
        /\binvoice\s+is\s+approved\b/i.test(jiraSection)
      ) &&
      (
        /\bapproved\s+invoice\b/i.test(caseText) ||
        /\binvoice\s+is\s+approved\b/i.test(caseText)
      );

    if (
      !requiredTableView &&
      sourceBackedApprovedInvoiceState
    ) {
      browserCase.runtimeFixturePolicy =
        "compatible-state";

      browserCase.steps = (
        Array.isArray(browserCase?.steps)
          ? browserCase.steps
          : []
      ).map((step: any) => {
        if (step?.action !== "clickText") {
          return step;
        }

        const requestedText = String(
          step?.text || ""
        )
          .trim()
          .toLowerCase();

        const runtimeInvoiceResolverRequest =
          /^inv[-\s]/i.test(requestedText) ||
          requestedText.includes("invoice number") ||
          requestedText.includes("invoice from fixture") ||
          requestedText.includes("invoice fixture");

        return runtimeInvoiceResolverRequest
          ? {
              ...step,
              text: "invoice number",
            }
          : step;
      });

      policyNotes.push(
        `${String(
          browserCase?.id || "browser-case"
        )}: source-backed approved invoice normalized to compatible-state runtime resolution; non-Jira invoice literals remain non-authoritative hints.`
      );

      continue;
    }

    if (requiredTableView) {
      browserCase.runtimeFixturePolicy =
        "compatible-state";

      /*
       * Convert unstable generic tab steps into a
       * canonical state-specific invoice flow.
       * This also ensures Sent for processing and
       * Processed receive different fingerprints.
       */
      /*
       * SOURCE_GROUNDED_INVOICE_ASSERTIONS_V1
       *
       * Assertion completeness must not depend on which labels
       * the LLM happened to repeat in its generated case.
       */
      const visibleLabels = [
        "Invoice No",
        "Payment Provider",
        "Line Items",
        "Invoice Approved By",
        "Invoice Approved At",
        "Timesheets",
        "ID",
        "Timesheet Approved By",
        "Timesheet Approved At",
      ].filter(
        (label) =>
          hasVerbatimSourceGroundedVisibleText(
            label,
            sourceContext
          )
      );

      const shouldAssertUndefined =
        /\bundefined\b/i.test(
          sourceContext
        );

      const shouldAssertNull =
        /\bnull\b/i.test(
          sourceContext
        );

      const normalizedSteps: any[] = [
        {
          action: "clickTopTab",
          text: requiredTableView,
        },
        {
          action: "clickText",
          text: resolverRequestText,
        },
        {
          action: "wait",
          ms: 1000,
        },
        ...visibleLabels.map(
          (label) => ({
            action:
              "assertTextVisible",
            text: label,
          })
        ),
      ];

      if (
        shouldAssertUndefined
      ) {
        normalizedSteps.push({
          action:
            "assertTextNotVisible",
          text: "undefined",
        });
      }

      if (
        shouldAssertNull
      ) {
        normalizedSteps.push({
          action:
            "assertTextNotVisible",
          text: "null",
        });
      }

      browserCase.steps =
        normalizedSteps;

            /*
       * Each executable case must claim only the
       * single state that its steps verify.
       *
       * Quick timesheet redirection stays in the
       * overall plan notes as manual coverage.
       */
      browserCase.goal =
        `Verify that a compatible company ` +
        `invoice in the ${requiredTableView} ` +
        `state opens the invoice details ` +
        `drawer.`;

      browserCase.successCriteria = [
        `A compatible runtime invoice in the ` +
          `${requiredTableView} state opens ` +
          `the invoice details drawer.`,

        visibleLabels.length > 0
          ? `The drawer displays ` +
            `${visibleLabels.join(", ")}.`
          : "",

        shouldAssertUndefined
          ? `The drawer does not display ` +
            `undefined.`
          : "",

        shouldAssertNull
          ? `The drawer does not display ` +
            `null.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      policyNotes.push(
        `${String(
          browserCase?.id ||
          "browser-case"
        )}: compatible-state invoice ` +
        `flow normalized for ` +
        `"${requiredTableView}" using ` +
        `resolver hint ${
          candidateInvoice ??
          "invoice number"
        }; ` +
        `quick timesheet redirection ` +
        `remains manual-only.`
      );

      continue;
    }

    browserCase.runtimeFixturePolicy =
      "exact";

    policyNotes.push(
      `${String(
        browserCase?.id ||
        "browser-case"
      )}: exact fixture policy used ` +
      `because the required invoice ` +
      `table state could not be resolved.`
    );
  }

  if (
    policyNotes.length > 0
  ) {
    plan.notes = [
      String(
        plan?.notes || ""
      ).trim(),
      `Planner runtime fixture policy: ` +
        policyNotes.join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return plan;
}
