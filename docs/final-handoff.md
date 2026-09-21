# Final documentation and handoff

## Checkpoint

This handoff describes the evidence-backed pre-final state, not an unrestricted automation claim.

- Branch: `refactor/generic-browser-agent-v2`
- Base pre-final commit: `be65ef56c49b64135c85d2e1d42e17681b4274c3`
- Fresh31 frozen benchmark: `qa-results/runs/fresh31-prefinal-frozen-20260920-170933`
- Final-13 matched-profile compatibility run: `qa-results/runs/final-13-canonical-matched-profile-20260921-154500`

Artifacts under `qa-results/` are local evidence, intentionally excluded from commits.

## Architecture milestone

The runtime keeps source requirement, execution contract, runtime binding, fresh proof, visual review, and final verdict separate. The generic browser uses bounded semantic observe → one grounded action → re-observe behavior; ambiguous targets fail closed. Planner proposals may guide navigation but cannot create source/proof/verdict authority.

AS-1311 is the practical safety example: a model `GOAL_ALREADY_SATISFIED` assessment did not override failure of the source-authorized `Download as PDF` requirement. The result was `FAIL`.

## Fresh31 reproducibility

| Run | PASS | FAIL | BLOCKED | MANUAL_REQUIRED | ERROR |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 2 | 1 | 25 | 9 | 0 |
| B | 2 | 1 | 25 | 9 | 0 |
| C | 2 | 1 | 25 | 9 | 0 |

31 frozen plans yielded 37 runtime cases. A–B status delta was zero; B–C status and technical deltas were zero; PASS asymmetry was zero. Result: `STABLE_CASE_AND_TECHNICAL`.

## Historical Final-13 accounting

Final-13 is retained as historical canonical compatibility evidence, not the current strict PASS floor. The canonical plans/hashes were verified and the matched-profile forensic found no true agent regressions among the eight historical browser PASS cases.

| Historical PASS accounting | Count | Interpretation |
| --- | ---: | --- |
| `FIXTURE_DRIFT` | 3 | AS-1014 web-1/web-2 and AS-1190 web-2 no longer had compatible runtime fixture state. |
| `LEGACY_FALSE_OR_WEAK_PASS` | 3 | AS-1139 web-1/web-2 and AS-1165 web-1 used legacy compatibility or handoff ownership that lacked current source-authorized proof authority. |
| `BENCHMARK_MIGRATION_GAP` | 2 | AS-1058 web-1/web-2 have byte-identical legacy plans that lack the modern source-obligation and execution-contract representation. |
| `TRUE_AGENT_REGRESSION` | 0 | None established. |
| `INSUFFICIENT_EVIDENCE` | 0 | None remained after the saved-plan/runtime comparison. |

The current source-bound literal proof capability still works for AS-1058 in Fresh31. Its Final-13 gap is therefore a controlled benchmark/source-provenance migration question, not runner regression. Historical screenshot, model, or compatibility-flow evidence does not supersede current source-authorized deterministic proof.

No production patch was justified by this forensic audit. `ACCEPT_FINAL13_AS_HISTORICAL_NOT_COMPARABLE` is the final compatibility decision.

## Capability inventory

| Capability | Evidence classification | Claim and limit |
| --- | --- | --- |
| Source-bound literal proof (AS-1058) | Current real UI | Exact authorized members can produce deterministic proof; limited to supported literal/member semantics |
| False-PASS safety (AS-1311) | Current real UI safety boundary | Model-positive intent cannot override deterministic contradiction |
| Runtime safety audit | Safety boundary proven | Audit gates verdicts; does not prove universal environment cleanliness |
| Fixture/entity resolution | Safety boundary proven | Missing compatible state blocks safely; it is not provisioning |
| Fresh31 A/B/C | Current frozen benchmark | Stable cohort replay; not an ML benchmark or product certification |
| Structural search input | Partially proven | Narrow typed structural proof shape; not broad structural coverage |
| Route discovery | Historical real UI, bounded | Safe probing/abstention; not universal recovery |
| A1 action cycle | Partially proven | Grounded one-action cycle is tested; not a universal live guarantee |
| Progression memory | Synthetic only | Bounded memory/budget mechanisms are tested; no dedicated real-UI proof of cross-case isolation or dead-path avoidance |
| Query/filter handling | Partially proven | Bounded interaction is evidenced; no whole-ticket source-grounded AS-1011 proof |
| State transitions | Historical real UI | Historical evidence exists; current unattended AS-1402 remains blocked |

## Not production-ready

- Unattended fixture provisioning and cleanup.
- Controlled prerequisite success.
- Full AS-1011 coverage.
- Current unattended AS-1402 execution.
- Local forensic or unwired prototype files.

The fixture-cleanup setting is a policy signal, not universal proof of safe lifecycle cleanup. Safe fixture consumption and exact entity binding are implemented in meaningful paths; generic unattended fixture construction is not production-ready. Permission to create test data is not authority to decide which data validly satisfies a source requirement. Typed construction authority, isolated ownership, lifecycle control, and cleanup proof remain future work.

`BLOCKED` and `MANUAL_REQUIRED` are valid outcomes. Environment, fixture, permissions, product, and model behavior can drift; this cohort is not a general ML benchmark.

## Fresh31 usefulness decision

A 37-case first-blocker census was completed before stopping development. The dominant blockers were source-authority availability (12 cases), fixture/entity availability (11), genuinely manual visual verification (5), and smaller heterogeneous route/proof gaps. The runtime funnel was 37 cases → 18 accepted routes → 18 generic proposals → 13 safe executions → 12 verified state changes → 1 autonomous handoff → 2 deterministic PASS cases.

The census found no small, generic, safe, high-leverage patch that could unlock multiple current fixture-ready cases without weakening source authority, fixture identity, mutation policy, or deterministic proof gates. The final engineering decision is `STOP_DEVELOPMENT_AND_HANDOFF`: evidence-based, not merely time-based. Future improvements remain possible, especially typed fixture authority, source-to-proof contracts, and route diagnostics.

## Prioritized next work

1. Preserve/extend typed fixture authority.
2. Add isolated provisioning only with exact cleanup proof.
3. Add proof primitives only for real source-authorized semantics with bounded generic observations.
4. Improve route diagnostics and first-blocker telemetry.
5. Promote historical cases to current P5 claims only when comparable proof is necessary.
6. Preserve planner authority as distinct from execution, proof, and verdict authority.

Start debugging at source obligation and contract, then runtime route/target/entity/fixture binding, deterministic evidence, safety audit, and finally the separate case/ticket result layers.
