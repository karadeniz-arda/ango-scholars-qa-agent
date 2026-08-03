import {
  hasVerbatimSourceGroundedVisibleText,
} from "./planner-browser-policy.js";

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

  for (const browserCase of browserCases) {
    const caseText = [
      String(browserCase?.goal || ""),
      String(
        browserCase?.successCriteria ||
          ""
      ),
      JSON.stringify(
        browserCase?.steps ?? []
      ),
    ].join(" ");

    const isInvoiceDrawerCase =
      /invoice/i.test(caseText) &&
      /(drawer|details)/i.test(
        caseText
      );

    const containsSentState =
      /sent\s+for\s+processing/i.test(
        caseText
      );

    const containsProcessedState =
      /\bprocessed\b/i.test(
        caseText
      );

    if (
      !isInvoiceDrawerCase ||
      !containsSentState ||
      !containsProcessedState
    ) {
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
      },
      {
        ...browserCase,
        id:
          `${String(
            browserCase?.id || "web"
          )}-processed`,
        __plannerInvoiceState:
          "processed",
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

  for (
    const browserCase
    of browserCases
  ) {
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


    const isInvoiceDrawerCase =
      /invoice/i.test(caseText) &&
      /(drawer|details)/i.test(
        caseText
      );

    /*
     * compatible-state is currently supported
     * only by the specialized invoice resolver.
     */
    if (!isInvoiceDrawerCase) {
      browserCase.runtimeFixturePolicy =
        "exact";

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

        const requiredTableView =
      plannerInvoiceState ===
        "sent for processing" ||
      plannerInvoiceState ===
        "processed"
        ? plannerInvoiceState
        : /sent\s+for\s+processing/i.test(
              caseText
            )
          ? "sent for processing"
          : /\bprocessed\b/i.test(
                caseText
              )
            ? "processed"
            : null;

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
