# Intern QA Agent — Handoff

## Current Milestone

The QA agent generates structured test plans from real Jira issues and GitHub change context, resolves executable API and browser context, executes cases against staging, and reconciles deterministic and visual evidence into final results.

The current reliability milestone is complete for the validated 13-issue canonical regression suite.

## Latest Canonical Regression

Run folder:

`qa-results/runs/final-13-regression-20260731-164253`

Summary:

`qa-results/runs/final-13-regression-20260731-164253/regression-summary.json`

These paths refer to local runtime artifacts and are intentionally ignored by Git. The verified totals and key outcomes are recorded below so the handoff remains complete when viewed on GitHub.

Execution profile:

- Canonical plans
- Browser mutations enabled for the approved draft-job workflows
- API mutations disabled
- Persistent assessment edit mutations disabled
- Evidence review enabled

Final totals:

- Issues completed: 13/13
- API: PASS 5, FAIL 0, BLOCKED 9, MANUAL_REQUIRED 0, ERROR 0
- Browser: PASS 7, FAIL 1, BLOCKED 8, MANUAL_REQUIRED 9, ERROR 0
- Browser blocked-reason coverage: 8/8
- Fixture unavailable: 8
- Mutation safety guard: 0
- Evidence reviews: 20
- Retained media: 34 PNG screenshots/checkpoints and 22 WEBM videos
- PASS_CONFIRMED: 8
- Product findings: 1
- Agent regressions: 0
- Unclassified failures: 0
- Guard failures: 0
- Final guard: `FINAL_13_REGRESSION_OK`
- Run-specific false-PASS audit: 0 identified false PASS results within the implemented test oracles

Canonical plan hashes, TypeScript validation, and diff validation passed before execution.

Key canonical outcomes:

- AS-1014: both invoice drawer cases passed after bounded drawer-open polling.
- AS-1058 web-2: the read-only language editor passed with high-confidence evidence while persistent edit mutations remained disabled.
- AS-1139: both approved draft-job creation paths passed, including exact cleanup.
- AS-1165 web-2: correctly reconciled to `BLOCKED / TEST_DATA_ISSUE`.
- AS-1011: one high-confidence product finding was retained without an agent regression. The expected query key was `project=`, while the application persisted `projectId=310` before and after reload.

## Planner Reproducibility

Latest representative check: `AS-1011`.

Result:

- Planner contract validation: 2/2 PASS
- Structural signatures: MATCH
- URL synchronization normalization applied to both relevant cases
- Active `qa-results/test-plan.json` restored
- Final signal: `PLANNER_REPRODUCIBILITY_OK`

The check validates schema, supported personas and actions, fixture policies, case budgets, mutation safety, and structural coverage. This result proves reproducibility for AS-1011 under the current structural checker; it is not a claim of global byte-identical LLM output.

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

Mutation flags remain disabled by default in `.env.example`.

The latest canonical regression deliberately enabled only supported browser mutations while keeping API mutations and persistent assessment edit mutations disabled.

AS-1139 results:

- Mutation cases: 2/2 PASS
- Evidence verdicts: 2/2 `PASS_CONFIRMED` with high confidence
- Exact cleanup: 2/2 PASS
- Unique runner-created jobs: 2/2
- No orphaned runner-created jobs were reported in this run

Browser mutations should only be enabled for approved workflows with deterministic cleanup. Cleanup failure is surfaced as `CLEANUP_FAILED` rather than being hidden.

## Remaining Limitations

- Staging fixture availability remains the main source of BLOCKED cases.
- Permission-sensitive cases may require a dedicated persona with the exact permission combination.
- Deep scrollable modal fields may still require broader surface-scoped scrolling and checkpoint coverage.
- Some filters and virtualized selectors still lack sufficiently reliable semantic metadata.
- Backend requests, downloads, and complex redirects require dedicated deterministic oracles.
- Browser mutations remain disabled by default even though the approved AS-1139 workflows now have verified exact cleanup.

## Recommended Next Phase

Future work should add broad reusable capabilities rather than issue-specific workflows:

1. Broader surface-scoped scrolling and checkpoint coverage for deep dialogs and drawers.
2. More reliable permission-aware personas for exact authorization combinations.
3. Robust accessible menu and virtualized-filter interaction.
4. Typed runtime fixture contracts shared across entity families.
5. Deterministic download, request, response, href, and redirect oracles.

Avoid branches based on Jira issue keys, browser case IDs, or fixed staging record IDs.
