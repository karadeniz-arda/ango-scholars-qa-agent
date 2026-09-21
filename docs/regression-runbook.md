# Regression and reproducibility runbook

## Safe operating procedure

Before any validation, record branch, `HEAD`, staged count, and dirty/untracked state. Identify whether the plan is frozen, historical, or fresh. If installing an isolated plan at `qa-results/test-plan.json`, back it up byte-for-byte, restore in a trap/finally path, and verify restoration. Keep generated artifacts local. Do not treat an old plan as a freshly generated planner result.

Do not enable API/browser mutations, persistent edits, or fixture provisioning without explicit run-scoped authorization. Never patch around a result during the validation run that produced it.

## Fresh31: current reproducibility benchmark

Frozen root: `qa-results/runs/fresh31-prefinal-frozen-20260920-170933`.

31 frozen plans produced 37 runtime cases in each run:

| Run | PASS | FAIL | BLOCKED | MANUAL_REQUIRED | ERROR | Comparison |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A | 2 | 1 | 25 | 9 | 0 | Baseline |
| B | 2 | 1 | 25 | 9 | 0 | A–B status delta = 0 |
| C | 2 | 1 | 25 | 9 | 0 | B–C status/technical delta = 0; PASS asymmetry = 0 |

Classification: `STABLE_CASE_AND_TECHNICAL`.

For a replay: verify frozen plan hashes, use the same configured profile and safety policy, retain per-case route/fixture/audit/evidence logs, and compare case identity, status, technical result, proof checks, and runtime bindings. A status change alone is not a code regression.

AS-1311 is the key safety example: `GOAL_ALREADY_SATISFIED` did not override a failed deterministic `Download as PDF` requirement. It is not established as an agent-code regression.

## Final-13: historical compatibility corpus

Final-13 is not a current PASS floor. Canonical plan hashes were verified for the matched-profile run at `qa-results/runs/final-13-canonical-matched-profile-20260921-154500`.

The run found six API PASS and eight API BLOCKED results; browser results were 25 BLOCKED, with no browser PASS or FAIL. The subsequent forensic accounting of all eight historical browser PASS cases found 3 `FIXTURE_DRIFT`, 3 `LEGACY_FALSE_OR_WEAK_PASS`, 2 `BENCHMARK_MIGRATION_GAP`, 0 `TRUE_AGENT_REGRESSION`, and 0 `INSUFFICIENT_EVIDENCE`. Use this corpus for provenance and compatibility analysis, never to override a current fail-closed result.

## Evidence hierarchy and delta classification

Keep these layers separate: source authority; execution contract; runtime persona/route/target/entity/fixture binding; fresh deterministic evidence; safety audit; visual review; verdict.

| Delta | First classification | Next step |
| --- | --- | --- |
| Same source authority, compatible runtime state, and expected proof path no longer works | `CODE_REGRESSION` / `TRUE_AGENT_REGRESSION` candidate | Require concrete deterministic evidence before assigning blame |
| Route/persona/entity/fixture changes | `ENVIRONMENTAL_DRIFT` or `FIXTURE_DRIFT` | Preserve first blocker; do not invent a clean state |
| Legacy plan lacks source obligation/check representation while a current primitive exists | `BENCHMARK_MIGRATION_GAP` | Treat as controlled source/provenance migration, not a runner patch |
| Historical PASS depended on screenshots, model satisfaction, inferred authority, or compatibility ownership | `LEGACY_FALSE_OR_WEAK_PASS` | Do not restore old PASS behavior |
| Model action differs but verdict does not | `MODEL_NAVIGATION_DRIFT` / operational variance | Retain telemetry only |
| Runtime proof path changes with authority intact | `PROOF_PATH_DRIFT` | Compare exact contract, evidence binding, and reconciliation gates |
| Evidence cannot distinguish categories | `AMBIGUOUS_INDETERMINATE` | Preserve artifacts and defer a production change |

A historical PASS under an older evidence model may be non-comparable to a current source-authorized deterministic proof contract. Never modify production logic merely to recover a historical PASS before this classification is complete.

Debug the earliest authoritative blocker: (1) source/contract, (2) session/route, (3) target/entity, (4) fixture lifecycle, (5) safety audit, (6) deterministic evidence, (7) case verdict versus ticket coverage.

For lightweight local validation use only the relevant focused tests plus:

```bash
npx tsc --noEmit
git diff --check
git status --short
```
