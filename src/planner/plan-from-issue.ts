import fs from "fs";
import {
  getReasoningOptions,
  ollamaClient,
} from "../llm/ollama-client.js";
import {
  cleanJsonOutput,
  repairJsonWithModel,
} from "./planner-json-output.js";
import {
  applyPlannerCaseLimits,
} from "./planner-case-budget.js";
import {
  normalizePlannerApiStatusExpectations,
} from "./planner-api-status-expectation.js";
import {
  applyBrowserTextAssertionProvenanceGate,
  applyBrowserUrlAssertionPrerequisiteGate,
  applySourceGroundedBrowserFilterCoverage,
  normalizePlannerBrowserScopes,
  normalizePlannerUrlSynchronizationSteps,
} from "./planner-browser-policy.js";
import {
  enrichTestPlanWithDiscovery,
} from "./planner-discovery-enrichment.js";
import {
  applyPlannerRuntimeFixturePolicies,
  splitCombinedInvoiceStateCases,
} from "./planner-runtime-fixture-policy.js";
import { getJiraIssue } from "../agents/api/jiraFetcher.js";
import {
  buildPlannerAcceptanceSourceLedger,
  buildPlannerJiraSourceUnits,
} from "./planner-acceptance-source-ledger.js";
import {
  auditPlannerAcceptanceCoverage,
} from "./planner-acceptance-coverage-audit.js";
import {
  buildPlannerAcceptanceObligationLedger,
} from "./planner-acceptance-obligation-ledger.js";
import {
  buildPlannerSourceDerivedObligationMemberLedger,
} from "./planner-source-derived-obligation-members.js";
import {
  buildPlannerSemanticMemberCoverageAudit,
} from "./planner-semantic-member-coverage.js";
import { getGithubChangeContext } from "../agents/api/githubFetcher.js";
import {
  extractPlannerRouteEvidence,
} from "./planner-route-evidence.js";
import {
  auditPlannerObligationCaseAllocation,
} from "./planner-obligation-case-allocation-audit.js";
import {
  applySourceBackedBrowserObligationBridge,
} from "./planner-browser-obligation-bridge.js";
import {
  buildPlannerAcceptanceVerdictGrouping,
} from "./planner-acceptance-verdict-grouping.js";
import {
  buildPlannerBrowserSemanticIr,
  verdictGroupCandidatesFromSemanticIr,
} from "./planner-browser-semantic-ir.js";
import {
  applyPlannerBrowserSemanticAllocation,
} from "./planner-browser-semantic-allocation.js";
import {
  compileSourceInvoiceExecutionCapabilities,
} from "./planner-source-invoice-capability.js";
import {
  clonePlannerSemanticCandidateProposals,
  materializePlannerBrowserCaseProposal,
  normalizePlannerModelProposal,
} from "./planner-model-proposal.js";
import { finalizeCompiledTestPlanArtifact } from "./compiled-test-plan.js";
import { formatCompiledPlanSummary, summarizeCompiledPlan } from "./planner-plan-summary.js";

type ADFNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
};

function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";

  const children = node.content?.map(adfToText).join("") ?? "";

  if (node.type === "heading") return `\n${children}\n`;
  if (node.type === "paragraph") return `${children}\n`;
  if (node.type === "listItem") return `- ${children.trim()}\n`;

  return children;
}

function formatJiraAcceptanceCriteria(
  discovery: any
): string {
  if (
    discovery?.status !== "RESOLVED"
  ) {
    return [
      "Discovery Status: UNAVAILABLE",
      "Acceptance Criteria: (source availability unknown)",
    ].join("\n");
  }

  const sources =
    Array.isArray(discovery?.sources)
      ? discovery.sources
      : [];

  if (sources.length === 0) {
    return [
      "Discovery Status: RESOLVED",
      "Acceptance Criteria: (none populated)",
    ].join("\n");
  }

  return [
    "Discovery Status: RESOLVED",
    "Acceptance Criteria:",
    ...sources.map(
      (source: any) =>
        `- [${String(source?.fieldName ?? "").trim()} | ` +
        `${String(source?.fieldId ?? "").trim()}] ` +
        `${String(source?.text ?? "").trim()}`
    ),
  ].join("\n");
}

async function readTicketContext(
  ticketId: string
) {
  const jiraIssue =
    await getJiraIssue(ticketId);

  if (!jiraIssue) {
    throw new Error(
      `Could not fetch Jira issue: ${ticketId}`
    );
  }

  const descriptionText =
    adfToText(jiraIssue.description);

  const acceptanceCriteriaText =
    formatJiraAcceptanceCriteria(
      jiraIssue.acceptanceCriteriaDiscovery
    );

  const acceptanceSourceLedger =
    buildPlannerAcceptanceSourceLedger({
      summary:
        jiraIssue.summary,
      descriptionText,
      descriptionAdf:
        jiraIssue.description,
      acceptanceCriteriaDiscovery:
        jiraIssue.acceptanceCriteriaDiscovery,
    });
  const jiraRouteSourceUnits =
    buildPlannerJiraSourceUnits({
      summary: jiraIssue.summary,
      descriptionText,
      descriptionAdf:
        jiraIssue.description,
      acceptanceCriteriaDiscovery:
        jiraIssue.acceptanceCriteriaDiscovery,
    });

  let githubContext = "";

  try {
    githubContext =
      await getGithubChangeContext(
        ticketId
      );
  } catch (error: any) {
    githubContext = `
--- GITHUB CHANGE CONTEXT ---
Could not fetch GitHub changes. Reason: ${error.message}
`;
  }

  const fileContents = `
--- JIRA TICKET ---
Key: ${jiraIssue.key}
Summary: ${jiraIssue.summary}
Status: ${jiraIssue.status}
Description: ${descriptionText}

--- JIRA ACCEPTANCE CRITERIA ---
${acceptanceCriteriaText}

${githubContext}
`;
  const routeEvidence =
    extractPlannerRouteEvidence({
      jiraSummary: jiraIssue.summary,
      jiraDescription: descriptionText,
      jiraAcceptanceCriteria:
        acceptanceCriteriaText,
      jiraSourceUnits:
        jiraRouteSourceUnits,
      githubContext,
    });

  return {
    fileContents,
    acceptanceSourceLedger,
    routeEvidence,
  };
}

export async function readTicketFiles(
  ticketId: string
) {
  const context =
    await readTicketContext(ticketId);

  return context.fileContents;
}

export async function generateTestPlan(ticketId: string) {
  const {
    fileContents,
    acceptanceSourceLedger,
    routeEvidence,
  } = await readTicketContext(ticketId);
  const acceptanceObligationLedger =
    buildPlannerAcceptanceObligationLedger(
      acceptanceSourceLedger
    );
  const sourceDerivedObligationMemberLedger =
    buildPlannerSourceDerivedObligationMemberLedger({
      sourceLedger: acceptanceSourceLedger,
      obligationLedger: acceptanceObligationLedger,
    });
  const sourceMemberAuthorityContext =
    sourceDerivedObligationMemberLedger.memberSets.flatMap((memberSet) =>
      memberSet.members.map((member) => ({
        memberId: member.memberId,
        parentObligationId: memberSet.parentObligationId,
        sourceUnitRef: memberSet.sourceUnitRef,
        dimension: memberSet.dimension,
        kind: member.kind,
        exactSourceText: member.exactSourceText,
      }))
    );
  const acceptanceAuthorityContext = JSON.stringify({
    sourceStatus: acceptanceObligationLedger.sourceStatus,
    derivationStatus:
      acceptanceObligationLedger.derivationStatus,
    obligations:
      acceptanceObligationLedger.obligations,
    unresolvedSourceUnitIds:
      acceptanceObligationLedger.unresolvedSourceUnitIds,
    sourceDerivedObligationMembers: sourceMemberAuthorityContext,
  }, null, 2);

  const systemPrompt = `
You are a senior QA engineer. I will give you a real Jira ticket. Create a test plan and return ONLY valid JSON.

Important context:
- You will receive a real Jira ticket and GitHub change context.
- The Jira issue defines the test scope. Treat its summary, description, and acceptance criteria as the authoritative product behavior to test.
- Use GitHub changed files, patches, commit messages, endpoints, routes, components, fields, labels, and UI copy only as technical evidence for behavior already within the Jira scope.
- Do not generate coverage for unrelated, collateral, cleanup, refactor, copy, or regression changes merely because they appear in the same pull request, commit, or merged diff.
- Treat Jira acceptance criteria as empty only when Acceptance Criteria Discovery Status is RESOLVED and no populated acceptance criteria are supplied. UNAVAILABLE means source coverage is unknown, not empty; do not claim complete acceptance coverage from summary and description alone.
- When Jira acceptance criteria are confirmed empty, infer scope from the Jira summary and description. Do not treat the entire GitHub diff as the issue scope.
- Before returning JSON, verify that every apiCase and browserCase directly tests the Jira issue. Remove any case whose only justification is that it appears in the same GitHub change.
- If GitHub context is missing or incomplete, mark unknown paths/routes as "UNKNOWN" instead of inventing them.
- Do not reuse routes, issue names, or test data from previous issues.
- Every concrete fixture value must be grounded in the supplied Jira ticket or GitHub change context. This includes numeric IDs, UUIDs, project names, skill names, talent names, job names, invoice numbers, emails, labels, record titles, and query-parameter values.
- Before using a concrete fixture value in an API path, query string, request body, browser click step, browser assertion, goal, or success criterion, verify that the exact value appears in the supplied context.
- Never create illustrative fixture values such as fake record names, sample IDs, alphabetic example names, or convenient project/skill labels. Examples shown in these instructions describe JSON shape only and are never test data.
- When the required fixture value is not supplied, do not guess it. Keep the route or endpoint unresolved where necessary, describe the missing runtime data, lifecycle state, ownership, or permission prerequisite in fixtureRequirements, and generate a case that will honestly become BLOCKED rather than FAIL.
- Do not click or assert record-specific browser text unless that exact record text is grounded in the supplied context. Stable product UI labels, headings, buttons, tabs, fields, and acceptance-criterion copy may still be asserted when they are supported by Jira or GitHub evidence.
- For assertTextVisible, copy multi-word UI text verbatim from Jira or GitHub evidence. Do not transform a semantic requirement into a guessed title-cased field, column, heading, button, status, or indicator label. When no exact visible label is supplied, omit that exact assertion and place the unsupported human-verification requirement in manualChecks.
- Do not place ungrounded numeric or named values into query parameters. When a query behavior requires unavailable fixture IDs, document the fixture requirement instead of inventing executable values.
- The dedicated createDraftJobAndVerifyRedirect action is allowed to generate its own unique QA-owned job title at runtime. Do not put that generated title or any invented record value into the plan.
- PLANNER_PROPOSAL_ONLY_FIXTURE_POLICY_V1: Browser cases may describe the runtime records, lifecycle states, ownership conditions, permissions, or data shapes they need through fixtureRequirements, but the model must not choose runtime fixture substitution policy.
- Do not emit runtimeFixturePolicy in browserCase objects. Exact-versus-compatible fixture policy is derived deterministically after generation from authoritative source identity, source-backed state requirements, and registered runtime resolver capabilities.

General rules:
1. Include API cases and browser cases if relevant.
2. Focus on acceptance criteria and risky edge cases.
3. Do not hardcode the old Skills export ticket.
4. API personas may be: "company_admin", "talent", and "unauthenticated".
5. Browser personas may be only: "company_admin" and "talent".
6. Do NOT generate unauthenticated browserCases yet because the browser runner does not support unauthenticated execution. Mention unauthenticated browser coverage in notes instead.
7. Do NOT use unsupported personas such as "company_member".
8. Do NOT invent endpoint paths. If the Jira ticket or GitHub diff does not provide an endpoint base path, set the base path as "UNKNOWN".
8a. If API query parameters and their concrete values are clearly visible in the Jira ticket or GitHub diff, append that exact grounded query string after UNKNOWN for the API case only. If the values are not supplied, do not invent or append query-parameter values. An API endpoint or network-request query parameter must never be reused as evidence that the browser address bar uses the same query key.
9. Do NOT invent browser routes. If the Jira ticket or GitHub diff does not provide a route, set "startRoute": "UNKNOWN".
10. When an exact API path template is visible in the GitHub diff, generated API contract, or supplied endpoint catalog, preserve the canonical placeholders such as "{companyId}", "{projectId}", "{jobId}", "{talentId}", "{requestId}", or "{id}". The runner resolves supported placeholders from execution context. Do not invent placeholder names or numeric IDs. Use "UNKNOWN" only when no sufficiently relevant canonical path template is available.
11. For POST, PATCH, or DELETE requests, include a realistic "body" only if the Jira ticket or GitHub diff clearly provides enough information. Otherwise set "path": "UNKNOWN" and explain that GitHub diff/API contract is needed.
11a. expect.status must be one exact HTTP status integer from 100 through 599 only when that exact status is grounded in Jira or the API contract. Otherwise use "UNKNOWN". Never encode alternatives or prose such as "401_or_403", "401 or 403", or "2xx" in expect.status.
12. Generic destructive browser actions remain prohibited. Do not use clickButton, clickText, openMenu, or selectOption to trigger Reject, Delete, Submit, Send, Approve, Archive, Invite, Remove, Save Draft, Publish, Create, or similar state-changing operations. The only permitted browser mutation is createDraftJobAndVerifyRedirect, and only when the Jira scope explicitly requires verification of the post-creation job redirect. That dedicated action creates one uniquely named QA draft, verifies its exact redirect, and cleans up the exact created resource. Next and Previous remain allowed only for safe, non-persisting wizard navigation.
13. Balance meaningful coverage with executability. Missing routes, API contracts, fixtures, or required states should reduce confidence, but must not erase important Jira-scope acceptance coverage. Generate separate cases only for distinct behaviors or states that are directly supported by the Jira scope. GitHub context alone is not sufficient justification for an additional case. Do not generate duplicates that test the same behavior with trivial wording or data changes.
14. Return ONLY valid JSON. No markdown.
15. Never output standalone string values inside objects. Every object field must be a valid "key": value pair.
16. Do not output duplicate malformed fields such as "company_admin", before "persona".
17. Every apiCase object must contain exactly these top-level fields: id, persona, method, path, body, expect.
18. Every browserCase object is a NON-AUTHORITATIVE interaction candidate and must contain exactly these top-level fields: id, persona, goal, startRoute, successCriteria, automatedChecks, manualChecks, fixtureRequirements, steps.
19. Browser semantic planning is primary. Return browserSemanticCandidates that reference only the supplied authoritative obligation IDs and exact sourceUnitIds. A candidate proposes behavior, interaction shape, persona, target, fixture needs, proof meaning, and relationship hints; it never grants authority to any of them.
19l. sourceMemberCoverageClaims is optional. When supplied, it must be an array of only exact memberId values from the read-only authoritative source-member list for that candidate's obligation and sourceUnitIds. It describes intended semantic coverage only: it grants no source, route, target, fixture, execution, proof, or verdict authority. Never invent, rename, or use free-form member names.
19a. Each browserSemanticCandidate must reference one proposedCaseId from browserCases. Do not create acceptance text absent from its referenced obligation. Relationship hints are candidate-only: separate bullets, sentences, routes, personas, or semantic families do not prove independence.
19b. TICKET COVERAGE is not CASE VERDICT. Do not copy ticket-wide lifecycle, migration, visual, backend, permission, or manual requirements into every interaction candidate. A check or fixture need must list the exact obligationIds it supports.
19c. Do not merge semantic candidates merely because they share a route, persona, fixture, interaction, or proof family. The deterministic planner owns final grouping, authority, allocation, budget, and case materialization.
19d. Decompose the Jira acceptance criteria into bounded semantic candidates before proposing interaction shells. If no authoritative obligation IDs are supplied, return an empty browserSemanticCandidates array rather than inventing authority.
19e. Every browserCase candidate must separate proposed scope into three arrays:
    - automatedChecks: acceptance criteria that the supported runner steps and captured evidence can verify automatically.
    - manualChecks: acceptance criteria that require human judgment, unsupported interaction, external verification, or an unavailable deterministic oracle.
    - fixtureRequirements: runtime records, lifecycle states, ownership conditions, data shapes, or permission combinations required before execution.
19f. Candidate successCriteria must describe only the obligations referenced by its semantic candidate. Do not put route, fixture, or manual-execution limitations into successCriteria.
19g. Candidate manualChecks remain untrusted proposals. The deterministic planner may retain only exact source obligations belonging to the same effective verdict group.
19h. Missing or incompatible fixtureRequirements must produce blocked ticket-level accounting, not an ordinary product failure.
19i. automatedChecks must correspond to proposed deterministic steps, but only source-authorized acceptance checks with an exact bound proof primitive may discharge an obligation.
19j. Every proposedChecks item must be an object with exactly text, obligationIds, and proposedRole. proposedRole must be one of ACCEPTANCE_PROOF, SUPPLEMENTAL_SANITY, PRECONDITION, or STRUCTURAL_SUPPORT. Do not emit MANUAL_REVIEW, MANUAL_VERIFICATION, or another role.
19k. Every proposedFixtureNeeds item must be an object with exactly text and obligationIds. Every proposedRelationshipHints item must be an object with exactly relationship, obligationIds, dependsOnObligationIds, and reason. relationship must be ATOMIC, INDEPENDENT, DEPENDS_ON, or UNKNOWN. These nested values remain candidate-only and must never be emitted as standalone strings. DEPENDS_ON requires exact dependsOnObligationIds; use UNKNOWN when dependency identity is not exact.
20. The final test-case budget is strict:
   - Generate at most 4 apiCases.
   - You may propose up to 8 browser interaction candidate shells. The deterministic planner materializes at most 4 final browserCases.
   - Materialize at most 8 final API plus browser cases.
   - Treat these as hard maximums, not target quotas.
   - Order cases from highest to lowest acceptance-criterion and regression value.
   - Never merge independently proposed browser acceptance units merely to fit the final budget.
   - Do not create separate cases for trivial wording, data-value, status-code, undefined/null, viewport, or persona variations unless they represent a distinct acceptance criterion or material product risk.
   - When the ticket contains more behaviors than the budget allows, prioritize the major acceptance criteria and highest-risk behavior, then describe omitted manual or unsupported coverage in overall notes.
21. For stateful features, consider positive, negative, permission, error, empty, and lifecycle-state coverage, but include only the highest-value distinct states supported by the Jira scope. GitHub context may provide implementation evidence, but must not independently expand the issue scope.
22. Missing GitHub context must not create several repeated UNKNOWN cases. Generate one representative case for the same missing route, endpoint contract, fixture, permission set, or unsupported dependency, and describe the remaining blocked coverage in notes.
23. A test plan containing zero total cases is invalid. When execution details are unavailable, generate the smallest meaningful representative coverage with UNKNOWN paths or routes and clearly document why it is blocked.

Browser step rules:
Every browserCase MUST include a "steps" array. The browser runner supports ONLY these actions:
1. wait
   Example: { "action": "wait", "ms": 1000 }
2. setViewport
   Example: { "action": "setViewport", "width": 430, "height": 900 }
3. clickTopTab
   Use only when the exact safe main-content tab label is grounded in Jira or GitHub context.
   Example: { "action": "clickTopTab", "text": "Details" }
4. selectRuntimeTopTab
   Use for label-agnostic active-tab URL tracking when the exact tab labels are unavailable. The runner discovers one visible main-content tab group, selects a safe inactive tab and verifies that it becomes selected.
   Example: { "action": "selectRuntimeTopTab" }
5. clickButton
   Use only for safe non-destructive buttons.
   Example: { "action": "clickButton", "text": "Filters" }
6. clickText
   Use for safe visible text in the main content area when it is not a menu option.
   Example: { "action": "clickText", "text": "Payments" }
7. openMenu
   Use to open a safe dropdown, sort control, filter popover, or icon-only menu trigger. The text is a semantic hint such as Filters, Sort, Newest, Actions, or More.
   Example: { "action": "openMenu", "text": "Filters" }
8. selectOption
   Use only after openMenu when the exact safe option label is grounded in Jira or GitHub context.
   Example: { "action": "selectOption", "text": "Newest" }
9. selectRuntimeFilterOption
   Use after openMenu when the filter dimension is grounded in Jira or frontend UI evidence, but the exact safe option label or fixture value is unavailable. The runner discovers the related visible filter control and selects one safe unselected runtime option.
   This action has two distinct verification modes:
   - Use verification "visible-state" for an ordinary UI filter whose selected state is visibly observable but whose browser URL behavior is not grounded. Supply filterKey as a normalized machine-readable form of the source-grounded UI filter dimension and optionally supply its exact visible label as hint. Do not derive filterKey solely from an API endpoint or request query parameter.
   - Use verification "url", or omit verification for the default URL mode, only when Jira browser-URL language or frontend router code explicitly establishes the browser query contract. Supply queryKey as the exact browser URL key without "=".
   Visible-state example: { "action": "selectRuntimeFilterOption", "filterKey": "status", "hint": "Status", "verification": "visible-state" }
   URL example: { "action": "selectRuntimeFilterOption", "queryKey": "project", "hint": "Project", "verification": "url" }
10. createDraftJobAndVerifyRedirect
    Use only for Jira-scoped post-creation job redirect behavior. The runner generates one unique QA-owned draft title, selects source-grounded safe wizard values, observes the exact create response, verifies the concrete details route, and deletes the exact created job.
    Use origin "jobs" for the project-scoped workflow and origin "all-jobs" for the all-jobs workflow.
    Example: { "action": "createDraftJobAndVerifyRedirect", "origin": "jobs" }
11. reload
    Safely reload the current page to verify URL or visible-state restoration without changing product data.
    Example: { "action": "reload" }
12. assertUrlContains
    Deterministically verify that the current Playwright URL contains an exact source-grounded path or query substring.
    Example: { "action": "assertUrlContains", "text": "tab=processed" }
13. assertUrlNotContains
    Deterministically verify that the current Playwright URL does not contain an obsolete or forbidden exact substring.
    Example: { "action": "assertUrlNotContains", "text": "jobId=" }
14. assertTextVisible
    Use for expected headings, labels, badges, columns, validation messages, and UI copy.
    Example: { "action": "assertTextVisible", "text": "Active" }
15. assertTextNotVisible
    Use for negative checks such as undefined, null, raw errors, leaked data, or removed old copy.
    Example: { "action": "assertTextNotVisible", "text": "undefined" }
16. openRuntimeControl
    Use when an exact source-grounded placeholder, accessible name, or visible control label must be opened so its currently rendered options, results, or empty-state surface can be inspected without selecting a value.
    target must be copied exactly from Jira or GitHub context. This action proves only that the control and an expanded surface opened.
    Example: { "action": "openRuntimeControl", "target": "Search work setups" }

Browser step requirements:
- Every executable browserCase must include at least one assertion step.
- Do not claim that a form, modal, details panel, applicant row, review screen, or post-action state is tested unless the steps explicitly navigate to and open that state.
- When the acceptance criterion describes a nested flow, include the complete safe prerequisite chain using supported actions. Example: open Applicants, select Hired, open the relevant Work Setup or applicant details, then assert the review content.
- A browserCase may contain only assertion steps when the expected state is directly visible on the start route. Otherwise include at least one meaningful interaction step before assertions.
- When a grounded combobox or searchable selector must be expanded without choosing a value, use openRuntimeControl immediately before assertions about its expanded options, results, or empty state.
- openRuntimeControl proves only that the control opened. It does not prove an empty state, available option, selected value, backend result, or persisted state unless following deterministic assertions prove those claims.
- Never invent the openRuntimeControl target. Copy its placeholder, accessible name, or visible control label exactly from Jira or GitHub context; otherwise leave the interaction MANUAL_REQUIRED.
- For sort, filter, dropdown, popover, Actions, More, or icon-only controls, use openMenu before asserting or selecting menu content.
- Use selectOption only after openMenu. Do not use clickText for an option that is hidden inside a closed menu or listbox.
- Use assertUrlContains or assertUrlNotContains only when Jira explicitly requires browser/page URL behavior or frontend route/router code proves that exact browser URL contract. API endpoint and network-request query parameters do not ground browser URL assertions.
- Never place the first positive assertUrlContains step before the action that establishes the expected URL state, unless the exact asserted substring is already present in startRoute.
- URL query assertions must include the equals sign, such as "tab=" or "project=". Never use a bare assertion such as "tab" or "project".
- clickTopTab must refer to a real tab control whose exact label is grounded in Jira or GitHub context. Do not use page headings or sidebar labels such as Payments or All payments as invented tab labels.
- When Jira requires label-agnostic active-tab URL synchronization and exact tab labels are unavailable, prefer selectRuntimeTopTab instead of inventing a clickTopTab label.
- selectRuntimeTopTab proves only that one safe visible inactive main-content tab was selected and visibly became active. It does not prove an exact tab-label-to-query-value mapping.
- A typical label-agnostic tab URL flow is selectRuntimeTopTab, assertUrlContains "tab=", reload, then assertUrlContains "tab=" again.
- Do not use selectRuntimeTopTab when the acceptance criterion requires one specific named tab. That case requires the exact grounded label and clickTopTab.
- Opening Filters does not establish filter URL state.
- When the exact safe option label is grounded, use openMenu followed by selectOption.
- When the exact option label or fixture value is unavailable but Jira or frontend UI evidence grounds the filter dimension, use openMenu followed by selectRuntimeFilterOption with filterKey and verification "visible-state". filterKey must be a normalized form of that source-grounded UI filter dimension; a key found only in an API endpoint or request parameter is insufficient.
- Visible-state mode must not include queryKey, assertUrlContains, assertUrlNotContains, or reload merely because an API filter uses a similarly named parameter. It proves only that one safe runtime option was selected and its visible selected state changed.
- When Jira browser-URL language or frontend router code explicitly grounds an exact browser query key, use selectRuntimeFilterOption with queryKey and verification "url", or omit verification to use the default URL mode.
- A runtime filter URL flow may use openMenu "Filters", selectRuntimeFilterOption, assertUrlContains, reload, and a repeated assertion only when browser URL synchronization and reload persistence are explicitly grounded.
- Neither runtime mode proves backend filtering, filtered-record correctness, persistence, ordering, or an exact label-to-value mapping without another deterministic oracle.
- Do not use selectRuntimeFilterOption when Jira requires one specific named filter option. That case requires the exact grounded option label and selectOption.
- Do not invent filterKey or queryKey. filterKey requires a source-grounded UI filter dimension; queryKey requires an explicit browser URL contract. Otherwise leave the unsupported interaction BLOCKED or MANUAL_REQUIRED.
- wait, reload, assertTextVisible, assertTextNotVisible and URL assertions do not establish tab, filter, sorting or selection state.
- A tab query assertion requires first selecting or changing the relevant tab. A filter query assertion requires first selecting or changing the relevant filter.
- When the exact interaction, tab value, filter option or required fixture is unavailable, do not assert that the query key already exists on the initial page. Describe the missing prerequisite and allow the case to become BLOCKED or MANUAL_REQUIRED instead of producing a product FAIL.
- Use reload only when browser-state reload persistence or restoration is explicitly part of the Jira behavior or frontend router contract. API request parameters and ordinary filter behavior do not imply reload persistence. After reload, repeat the URL assertion and add a visible UI assertion when the acceptance criterion also requires the selected control or tab to restore.
- URL assertion text must be an exact browser URL substring grounded in Jira browser-URL language or frontend route/router context. A query key that appears only in an API endpoint, request builder, controller, DTO, or backend filter is not browser URL grounding. A grounded browser query key without a grounded value may verify only key presence and must not overclaim the selected value mapping.
- Do not infer network request bodies, backend filtering, database persistence, or record ordering from URL assertions.
- For a sorting control whose current visible value is Newest, Latest, or Oldest, use that current value or the semantic hint Sort in openMenu, then use selectOption for the desired value.
- Separate directly visible control behavior from hidden semantic behavior. URL synchronization may be included only when assertUrlContains or assertUrlNotContains directly proves the URL requirement. Record ordering, backend request semantics, permissions, and untested persistence must remain separate.
- For sort or filter changes, prefer one browserCase limited to visibly opening the control, seeing source-grounded options, selecting them, and observing the selected UI label. Add browser URL synchronization only when Jira or frontend router evidence explicitly proves that contract. API query parameters, backend filtering, createdAt/updatedAt ordering, and unsupported network semantics must remain separate and honestly become MANUAL_REQUIRED when no supported oracle is available.
- A UI interaction case must not claim that selecting a sort label proves the underlying record order. Its goal and successCriteria must remain limited to the visible control behavior it can actually demonstrate.
- For a funnel or icon-only filter control, use { "action": "openMenu", "text": "Filters" }; the runner resolves safe semantic icon metadata and verifies that a menu or listbox actually opened.
- Do not assert modal content before opening the modal.
- Do not assert form fields before opening the form.
- Do not assert post-submit, post-approve, post-reject, or completed state unless the action is safely executable.
- createDraftJobAndVerifyRedirect is the sole exception for post-creation job redirect coverage. Do not combine it with generic Save as Draft, Publish, Create, or Delete clicks.
- When both standard Jobs and All Jobs origins are explicitly within the Jira scope, generate two separate browser cases because they require different origins and expected route bases.
- For origin "jobs", use startRoute "/company/jobs/create" and assert "/company/jobs/" plus "project=" after the dedicated action.
- For origin "all-jobs", use startRoute "/company/jobs/create?origin=all-jobs" and assert "/company/all-jobs/" plus "project=" after the dedicated action.
- In both cases, assert that "jobId=", "undefined", and "null" are absent when those malformed URL risks are within the Jira scope.
- When a state-changing action is otherwise prohibited, verify only the safe pre-action controls in automatedChecks and place the unsupported state-changing coverage in manualChecks. Do not put that limitation in successCriteria.
- If startRoute is "UNKNOWN", include only steps that clearly belong to the intended product area and document the missing route or fixture in fixtureRequirements. Keep goal and successCriteria limited to the expected product behavior.
- Do not combine mutually exclusive fixture states such as pending, rejected, approved, empty, and no-file completion in one browserCase.
- Do not generate permission-specific browser cases unless the available persona can actually represent the required permission set. Put unsupported permission coverage in the overall notes instead of creating a false-pass-prone browser case.
- Each case must cover a distinct acceptance criterion or high-risk behavior. Do not create duplicate cases that differ only by wording or trivial data permutations.
- Prefer a concise but complete plan. Cover every distinct acceptance criterion and high-risk state without duplicate or trivial cases.
- Do not invent CSS selectors, XPath, Playwright code, or unsupported action names.
- For visual/layout issues, include one normal viewport case and optionally one narrow/mobile case.
- For table/column issues, navigate to the relevant table state before asserting the expected column text.
- Include negative assertions for "undefined" and "null" only when missing or partial server data is relevant to that case.

The JSON structure MUST match exactly this:
{
  "issueKey": "ticket id",
  "summary": "ticket summary",
  "notes": "overall assumptions, missing context, route limitations, or unauthenticated browser coverage notes",
  "apiCases": [
    {
      "id": "api-1",
      "persona": "company_admin",
      "method": "GET",
      "path": "UNKNOWN",
      "body": {},
      "expect": {
        "status": 200,
        "notes": "why this case matters or why it is blocked"
      }
    }
  ],
  "browserSemanticCandidates": [
    {
      "id": "semantic-1",
      "proposedCaseId": "web-candidate-1",
      "obligationIds": ["COPY_AN_EXACT_SUPPLIED_OBLIGATION_ID"],
      "sourceUnitIds": ["COPY_ITS_EXACT_SOURCE_UNIT_ID"],
      "proposedBehavior": "source-bounded behavior intent",
      "proposedPersona": "company_admin",
      "proposedTargetSurface": "candidate surface description",
      "sourceMemberCoverageClaims": ["OPTIONAL_EXACT_SUPPLIED_MEMBER_ID"],
      "proposedMutationClass": "READ_ONLY",
      "proposedChecks": [
        {
          "text": "copy the exact source obligation text when proposing acceptance proof",
          "obligationIds": ["COPY_AN_EXACT_SUPPLIED_OBLIGATION_ID"],
          "proposedRole": "ACCEPTANCE_PROOF"
        }
      ],
      "proposedFixtureNeeds": [
        {
          "text": "candidate-only runtime state needed before execution",
          "obligationIds": ["COPY_AN_EXACT_SUPPLIED_OBLIGATION_ID"]
        }
      ],
      "proposedRelationshipHints": [
        {
          "relationship": "UNKNOWN",
          "obligationIds": ["COPY_AN_EXACT_SUPPLIED_OBLIGATION_ID"],
          "dependsOnObligationIds": [],
          "reason": "No affirmative source relationship authority is available."
        }
      ]
    }
  ],
  "browserCases": [
    {
      "id": "web-candidate-1",
      "persona": "company_admin",
      "goal": "what to verify",
      "startRoute": "UNKNOWN",
      "successCriteria": "what should be true",
      "automatedChecks": [
        "behavior verified by supported runner steps"
      ],
      "manualChecks": [],
      "fixtureRequirements": [],
      "steps": [
        { "action": "assertTextVisible", "text": "expected text" },
        { "action": "assertTextNotVisible", "text": "undefined" },
        { "action": "assertTextNotVisible", "text": "null" }
      ]
    }
  ]
}
`;

  console.log("AI test plan from real Jira issue");

  const response = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini",
    ...getReasoningOptions(),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          `${fileContents}\n\n` +
          `--- AUTHORITATIVE ACCEPTANCE OBLIGATION LEDGER ---\n` +
          `${acceptanceAuthorityContext}\n`,
      },
    ],
  });

  const aiAnswer = response.choices[0]?.message.content || "{}";

  console.log("Given Answer:\n", aiAnswer);

  let cleanPlan: string;

  try {
    cleanPlan = cleanJsonOutput(aiAnswer);
  } catch (error: any) {
    cleanPlan = await repairJsonWithModel(aiAnswer, error);
  }

  const modelProposal = normalizePlannerModelProposal(
    JSON.parse(cleanPlan) as unknown
  );

  if (modelProposal.issueKey !== ticketId) {
    throw new Error(
      `Planner returned issueKey ${String(modelProposal.issueKey)} instead of ${ticketId}`
    );
  }
  if (modelProposal.browserCases.length > 0 &&
      modelProposal.browserSemanticCandidates === undefined) {
    throw new Error(
      "Fresh planner output with browserCases must include browserSemanticCandidates"
    );
  }

  // Construct a new deterministic compilation input from proposal-only data.
  const parsedPlan: any = {
    issueKey: modelProposal.issueKey,
    summary: modelProposal.summary,
    ...(modelProposal.notes !== undefined ? { notes: modelProposal.notes } : {}),
    apiCases: modelProposal.apiCases,
    browserCases: modelProposal.browserCases.map(
      materializePlannerBrowserCaseProposal
    ),
    ...(modelProposal.browserSemanticCandidates !== undefined
      ? { browserSemanticCandidates: modelProposal.browserSemanticCandidates }
      : {}),
  };

  const semanticIr =
    buildPlannerBrowserSemanticIr({
      rawCandidates:
        modelProposal.browserSemanticCandidates,
      browserCases:
        Array.isArray(parsedPlan.browserCases)
          ? parsedPlan.browserCases
          : [],
      obligationLedger:
        acceptanceObligationLedger,
      memberLedger: sourceDerivedObligationMemberLedger,
    });
  const semanticMemberCoverageAudit =
    buildPlannerSemanticMemberCoverageAudit({
      semanticIr,
      memberLedger: sourceDerivedObligationMemberLedger,
    });
  const verdictGrouping =
    buildPlannerAcceptanceVerdictGrouping({
      obligationLedger:
        acceptanceObligationLedger,
      sourceLedger:
        acceptanceSourceLedger,
      candidateGroups:
        verdictGroupCandidatesFromSemanticIr({
          semanticIr,
          sourceLedger:
            acceptanceSourceLedger,
          obligationLedger:
            acceptanceObligationLedger,
      }),
    });

  /*
   * SOURCE_SURFACE_PROVENANCE_V1
   *
   * Route discovery runs before the later semantic-allocation attachment, but
   * its source-backed surface matcher must see the already-normalized
   * candidate/obligation context. These are the same deterministic objects
   * attached to the final plan below; no planner prose is promoted here.
   */
  parsedPlan.browserSemanticIr = semanticIr;
  parsedPlan.acceptanceSourceLedger = acceptanceSourceLedger;
  parsedPlan.acceptanceObligationLedger = acceptanceObligationLedger;
  parsedPlan.sourceDerivedObligationMemberLedger =
    sourceDerivedObligationMemberLedger;
  parsedPlan.semanticMemberCoverageAudit =
    semanticMemberCoverageAudit;
  parsedPlan.sourceInvoiceExecutionCapabilities =
    compileSourceInvoiceExecutionCapabilities(parsedPlan);

  const enrichedPlan =
    applyBrowserTextAssertionProvenanceGate(
      applyBrowserUrlAssertionPrerequisiteGate(
        normalizePlannerBrowserScopes(
          applySourceGroundedBrowserFilterCoverage(
            applySourceBackedBrowserObligationBridge(
              applyPlannerCaseLimits(
                enrichTestPlanWithDiscovery(
                  normalizePlannerUrlSynchronizationSteps(
                    applyPlannerRuntimeFixturePolicies(
                      splitCombinedInvoiceStateCases(
                        normalizePlannerApiStatusExpectations(
                          parsedPlan
                        )
                      ),
                      fileContents
                    )
                  ),
                  { routeEvidence }
                ),
                {
                  obligationLedger:
                    acceptanceObligationLedger,
                  deferBrowserAllocation:
                    semanticIr.status !==
                    "LEGACY_INPUT",
                }
              ),
              {
                sourceLedger:
                  acceptanceSourceLedger,
                obligationLedger:
                  acceptanceObligationLedger,
                sourceContext: fileContents,
              }
            ),
            fileContents
          ),
          {
            acceptanceSourceLedger,
            acceptanceObligationLedger,
          }
        ),
        fileContents
      ),
      fileContents
    );

  /*
   * PLANNER_ACCEPTANCE_SOURCE_LEDGER_ATTACH_V1
   *
   * Deterministic Jira-source provenance is attached only
   * after model planning and deterministic normalization.
   *
   * This metadata is not proof and cannot create PASS.
   */
  enrichedPlan.acceptanceSourceLedger =
    acceptanceSourceLedger;

  /*
   * PLANNER_ACCEPTANCE_OBLIGATION_LEDGER_ATTACH_V0
   *
   * Deterministic, observational obligations are derived from
   * the immutable Jira source ledger, never from model output.
   */
  enrichedPlan.acceptanceObligationLedger =
    acceptanceObligationLedger;

  /* Source-member coverage metadata only; no V1 execution consumer exists. */
  enrichedPlan.sourceDerivedObligationMemberLedger =
    sourceDerivedObligationMemberLedger;
  enrichedPlan.semanticMemberCoverageAudit =
    semanticMemberCoverageAudit;

  /* Metadata only: UNKNOWN is fail-closed and no V0 runtime consumes it. */
  enrichedPlan.acceptanceVerdictGrouping =
    verdictGrouping;

  applyPlannerBrowserSemanticAllocation({
    plan: enrichedPlan,
    semanticIr,
    verdictGrouping,
    obligationLedger:
      acceptanceObligationLedger,
  });

  /*
   * PLANNER_ACCEPTANCE_COVERAGE_AUDIT_ATTACH_V1
   *
   * Observational only. This records whether authoritative
   * source units remain explicitly represented after model
   * planning and deterministic normalization.
   */
  enrichedPlan.acceptanceCoverageAudit =
    auditPlannerAcceptanceCoverage(
      enrichedPlan,
      acceptanceSourceLedger
    );

  enrichedPlan.obligationCaseAllocationAudit =
    auditPlannerObligationCaseAllocation(
      enrichedPlan,
      acceptanceObligationLedger
    );

  const planSummary = summarizeCompiledPlan(
    enrichedPlan,
    modelProposal.browserCases.length,
    semanticIr.candidates.length,
    semanticIr.rejectedCandidates.length
  );
  const compiledPlan = finalizeCompiledTestPlanArtifact({
    compilationInputPlan: enrichedPlan,
    plannerDiagnostics: {
      rawSemanticCandidates: modelProposal.browserSemanticCandidates
        ? clonePlannerSemanticCandidateProposals(modelProposal.browserSemanticCandidates)
        : [],
    },
    compilationSummary: planSummary.compilationSummary,
  });
  const enrichedJson =
    JSON.stringify(compiledPlan, null, 2);

  const apiCaseCount = Array.isArray(
    compiledPlan.apiCases
  )
    ? enrichedPlan.apiCases.length
    : 0;

  const browserCaseCount = Array.isArray(
    compiledPlan.browserCases
  )
    ? enrichedPlan.browserCases.length
    : 0;

  const totalCaseCount =
    apiCaseCount + browserCaseCount;

  const hasSemanticCoverageAccounting =
    compiledPlan.browserSemanticPlanningAudit !==
      undefined &&
    compiledPlan.browserSemanticPlanningAudit
      .status !== "LEGACY_COMPATIBILITY" &&
    (
      enrichedPlan.browserSemanticPlanningAudit !==
        undefined ||
      acceptanceSourceLedger.sourceUnits.length > 0
    );

  if (
    totalCaseCount === 0 &&
    !hasSemanticCoverageAccounting
  ) {
    throw new Error(
      `Planner produced an empty test plan for ${ticketId}`
    );
  }

  if (!fs.existsSync("qa-results")) {
    fs.mkdirSync("qa-results");
  }

  fs.writeFileSync(
    "qa-results/test-plan.json",
    enrichedJson,
    "utf-8"
  );

  console.log(formatCompiledPlanSummary(planSummary));

  return enrichedJson;
}
