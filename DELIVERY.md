# Delivery Guide

This document explains the two delivery packages, how to run the agent,
how to review the latest regression, and which credentials are not included.

## Package 1 — Source

Recommended name:

`ango-scholars-qa-agent-source.zip`

Start with:

1. `README.md`
2. `DELIVERY.md`
3. `HANDOFF.md`
4. `.env.example`
5. `package.json`

The package contains source code, canonical fixtures, configuration
templates, scripts, and documentation.

It intentionally excludes:

- `.git/`
- `node_modules/`
- `qa-results/`
- `dist/`
- `.DS_Store`
- existing ZIP files
- the real `.env`

The real `.env` is not included because it may contain Jira, GitHub,
Firebase, model-provider, persona, and staging credentials. Full staging
execution requires approved values to be supplied separately through a
secure channel. The real `.env` must never be committed or pushed.

## Installation

The latest validated environment was:

- Node.js `v24.18.0`
- npm `11.16.0`

Install deterministic dependencies:

```bash
npm ci
```

Create the local environment file:

```bash
cp .env.example .env
```

Populate only the values required for the commands being run. Authenticated
browser execution requires `QA_AUTH_MODE=firebase` and valid Firebase and
persona configuration.

## Active Plan Contract

Generate a plan:

```bash
npm run plan -- --issue AS-1066
```

This writes the active plan to:

`qa-results/test-plan.json`

The following commands execute that active plan:

```bash
npm run run -- --issue AS-1066
npm run browser -- --issue AS-1066
npm run smoke -- --issue AS-1066
```

Their `--issue` argument does not regenerate the plan. Generate or load the
matching plan first. The canonical and multi-issue scripts manage active-plan
switching internally.

## Canonical Regression

```bash
QA_REGRESSION_PLAN_MODE=canonical \
QA_REGRESSION_RESUME=false \
QA_ALLOW_BROWSER_MUTATIONS=true \
QA_ALLOW_API_MUTATIONS=false \
QA_BROWSER_MUTATION_PREFLIGHT=false \
QA_ALLOW_BROWSER_EDIT_FLOWS=false \
QA_EVIDENCE_REVIEW=true \
bash scripts/run-final-13-regression.sh
```

Browser mutations are enabled in this profile only because the canonical
suite contains approved QA-owned draft workflows with deterministic exact
cleanup. Default mutation values in `.env.example` remain `false`.

## Package 2 — Final Results and Evidence

Recommended name:

`ango-scholars-qa-agent-final-results-and-evidence.zip`

Start with:

1. `README-RESULTS.md`
2. `runs/final-13-regression-20260731-164253/regression-summary.json`
3. `runs/final-13-regression-20260731-164253/summary.md`
4. Each issue directory's plan, report, logs, evidence, and videos
5. `final-13-regression.log`
6. `planner-repro.log`
7. `final-prezip-audit.json`

The package contains:

- 13 canonical issue plans and reports
- plan and smoke logs
- regression JSON and TSV summaries
- 34 PNG screenshots/checkpoints
- 22 WEBM videos
- the final regression log
- planner reproducibility output
- the final package integrity audit

## Latest Validated Result

Run:

`final-13-regression-20260731-164253`

Totals:

- Issues completed: 13/13
- API: PASS 5, FAIL 0, BLOCKED 9, MANUAL_REQUIRED 0, ERROR 0
- Browser: PASS 7, FAIL 1, BLOCKED 8, MANUAL_REQUIRED 9, ERROR 0
- Evidence reviews: 20
- PASS_CONFIRMED: 8
- Product findings: 1
- Agent regressions: 0
- Unclassified failures: 0
- Guard failures: 0
- Final signal: `FINAL_13_REGRESSION_OK`

The single browser FAIL is the high-confidence AS-1011 product finding.
The expected query key was `project=`, while the application persisted
`projectId=310` before and after reload.

`FINAL_13_REGRESSION_OK` means the frozen suite completed without an
unexpected agent regression, unclassified failure, or guard failure.
It does not mean every product assertion passed.

## False-PASS Review Statement

No false PASS was identified in this final canonical run based on the
implemented deterministic assertions, semantic API checks, archived
screenshots/checkpoints and videos, evidence-review outcomes, and final
reconciliation.

This is a run-specific audit conclusion. It is not a mathematical guarantee
that defects outside the implemented test oracles do not exist.

## Intentional Canonical Hardcodes

`scripts/run-final-13-regression.sh` intentionally contains the frozen
13-issue suite and suite-specific guards. These belong to the regression
harness and are not issue-key branches in the general planner or browser
runtime.
