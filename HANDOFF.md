# Intern QA Agent — Handoff

## Current Milestone

The QA agent generates structured test plans from real Jira issues and GitHub change context, resolves executable API and browser context, executes cases against staging, and reconciles deterministic and visual evidence into final results.

The current reliability milestone is complete.

## Latest Canonical Regression

Run folder:

`qa-results/runs/final-13-regression-20260730-213505`

Summary:

`qa-results/runs/final-13-regression-20260730-213505/regression-summary.json`

Final totals:

- Issues completed: 13/13
- API: PASS 5, FAIL 0, BLOCKED 9, MANUAL_REQUIRED 0, ERROR 0
- Browser: PASS 5, FAIL 1, BLOCKED 10, MANUAL_REQUIRED 9, ERROR 0
- Browser blocked-reason coverage: 10/10
- Fixture unavailable: 8
- Mutation safety guard: 2
- Evidence reviews: 18
- PASS_CONFIRMED: 5
- Product findings: 1
- Agent regressions: 0
- Unclassified failures: 0
- Guard failures: 0
- Final guard: `FINAL_13_REGRESSION_OK`

Canonical plan hashes and TypeScript validation passed before execution.

Canonical parity validation also confirmed:

- AS-1058 web-2: `PASS_CONFIRMED` with high-confidence evidence.
- AS-1165 web-2: correctly reconciled to `BLOCKED / TEST_DATA_ISSUE`.
- AS-1011: one high-confidence product finding was retained without an agent regression.

## Planner Reproducibility

Representative fresh-plan canary:

`qa-results/planner-reproducibility/AS-1014-2026-07-29T12-11-46-528Z`

Result:

- Planner contract validation: 2/2 PASS
- Structural signatures: MATCH
- Active `qa-results/test-plan.json` restored
- Final signal: `PLANNER_REPRODUCIBILITY_OK`

The reproducibility check validates schema, supported personas and actions, fixture policies, case budgets, mutation safety, and structural coverage. It does not require byte-identical LLM wording.

## Delivered Reliability Capabilities

- Real Jira and GitHub-context planning
- API endpoint manifest discovery
- UI route manifest discovery
- Runtime execution-context and resource resolution
- Query-parameter preservation
- API semantic response evaluation
- Exact and compatible-state fixture policies
- Browser route probing and landmark verification
- Persona-aware browser session reuse
- Safe menu, tab, filter, and URL interaction primitives
- Runtime invoice and contract fixture resolution
- Safe semantic table-row and detail-control discovery
- Screenshot, checkpoint, trace, and video evidence
- PASS evidence auditing
- Final evidence reconciliation
- Machine-readable blocked taxonomy
- Canonical regression and planner reproducibility scripts

## Change-Request Row Detail Capability

The browser runner can now:

1. Match a table row using source-grounded request semantics.
2. Inspect only controls inside that matched row.
3. Prefer explicit View, Details, Review, Eye, or Visibility semantics.
4. Fall back to exactly one safe control in an explicit Actions column.
5. Verify that a detail surface, URL transition, or expected-field increase occurred.

The AS-1093 web-2 canary successfully found the Publish request row and opened the Review Job Change Request modal. Nineteen expected fields passed. `Country rate map` remained inconclusive because it was not visible in the captured modal portion, so the complete case remained `MANUAL_REQUIRED`.

No issue key, case ID, job ID, or fixed record ID is embedded in the capability.

## Mutation Validation

Canonical execution keeps browser mutations disabled and reports mutation cases as `BLOCKED`.

A separate guarded AS-1139 canary verified both supported draft-job creation origins:

- Mutation cases: 2/2 PASS
- Exact cleanup: 2/2 PASS
- Unique created IDs: 2/2
- No orphaned runner-created jobs

The mutation canary should not be rerun without a specific regression reason.

## Remaining Limitations

- Staging fixture availability remains the main source of BLOCKED cases.
- Permission-sensitive cases may require a dedicated persona with the exact permission combination.
- Deep scrollable modal fields may still require broader surface-scoped scrolling and checkpoint coverage.
- Some filters and virtualized selectors still lack sufficiently reliable semantic metadata.
- Backend requests, downloads, and complex redirects require dedicated deterministic oracles.
- Canonical mutation cases remain intentionally blocked by default.

## Recommended Next Phase

Future work should add broad reusable capabilities rather than issue-specific workflows:

1. Broader surface-scoped scrolling and checkpoint coverage for deep dialogs and drawers.
2. More reliable permission-aware personas for exact authorization combinations.
3. Robust accessible menu and virtualized-filter interaction.
4. Typed runtime fixture contracts shared across entity families.
5. Deterministic download, request, response, href, and redirect oracles.

Avoid branches based on Jira issue keys, browser case IDs, or fixed staging record IDs.
