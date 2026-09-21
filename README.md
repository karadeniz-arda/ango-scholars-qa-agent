# ango-scholars-qa-agent

An evidence-first QA agent that turns Jira and repository context into bounded API and browser checks. It is deliberately fail-closed: a useful interaction, model confidence, or a screenshot is never enough by itself to claim PASS.

## Current checkpoint

Fresh31 is the current frozen reproducibility cohort at `qa-results/runs/fresh31-prefinal-frozen-20260920-170933`.

| Run | PASS | FAIL | BLOCKED | MANUAL_REQUIRED | ERROR | Runtime cases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 2 | 1 | 25 | 9 | 0 | 37 |
| B | 2 | 1 | 25 | 9 | 0 | 37 |
| C | 2 | 1 | 25 | 9 | 0 | 37 |

The A–B status delta, B–C status/technical delta, and PASS asymmetry were all zero: `STABLE_CASE_AND_TECHNICAL`. This is a frozen-cohort reproducibility result, not product-wide certification.

## Safety model

```text
REQUIREMENT != CASE EXISTENCE != INTERACTION EXECUTION != DETERMINISTIC PROOF != VISUAL REVIEW != FINAL VERDICT
EXECUTED != PROVED
```

A PASS requires source authority, a typed execution/proof contract, accepted fresh runtime context, deterministic evidence, and a clean runtime audit. The generic browser cycle is observe → one grounded safe action → execute → re-observe. It rejects ambiguous targets and avoids product scripts, `nth` selectors, DOM-order, CSS/framework identifiers, and pixel/proximity heuristics.

Current real-UI evidence includes source-bound literal proof (AS-1058) and false-PASS prevention (AS-1311: a model `GOAL_ALREADY_SATISFIED` claim did not override a failed `Download as PDF` check). Structural controls, route discovery, action cycles, query/filter behavior, and transitions have narrower or historical evidence; unattended fixture provisioning/cleanup is not production-ready.

## Commands

```bash
npm install
npx tsc --noEmit
npm run plan -- --issue AS-1234
npm run run
npm run browser
npm run smoke
```

Credentials and execution permissions are environment-specific. Do not print or commit secrets. Keep mutations and fixture provisioning disabled unless the exact run has explicit approval. Generated `qa-results/` artifacts are local evidence, not planner/source inputs to edit by hand.

## Result meanings

- `PASS`: applicable typed checks, deterministic proof, and safety gates passed.
- `FAIL`: sufficient deterministic evidence contradicts a source-authorized check.
- `BLOCKED`: a required route, entity, fixture, permission, or safety prerequisite is unavailable.
- `MANUAL_REQUIRED`: execution/evidence exists but deterministic authority or completeness is insufficient.
- `ERROR`: infrastructure prevented a reliable result.

`BLOCKED` and `MANUAL_REQUIRED` are correct safety outcomes, not downgraded PASS results.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Authority boundaries and runtime pipeline |
| [Regression runbook](docs/regression-runbook.md) | Fresh31 and Final-13 procedure |
| [Final handoff](docs/final-handoff.md) | Evidence inventory, limitations, priorities |
| [Demo script](docs/demo-script.md) | 5–10 minute evidence-based walkthrough |
| [ADR-001](docs/ADR-001-browser-agent.md) | Original browser-agent decision (historical context) |

The root [HANDOFF.md](HANDOFF.md) links to the current handoff; its former Final-13 description is historical context only.
