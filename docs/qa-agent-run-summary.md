# Generic QA Agent Run Summary

## Scope

Issues tested without adding issue-specific/custom logic:
- AS-1073
- AS-1139
- AS-1133
- AS-1165
- AS-1058

## Findings

### What worked
- The agent generated meaningful test plans from Jira/GitHub context.
- Browser execution worked when the route resolver could map the issue to known product areas.
- Evidence generation worked for executable browser cases.
- BLOCKED status prevented false FAILs when route/API context was missing.

### Main limitations
- API execution is blocked when exact endpoint paths/contracts are unavailable.
- Browser execution is blocked for deep/id-dependent routes.
- Dropdown/popover interaction can produce false negatives.
- Some flows need test data IDs and reusable capabilities before reliable execution.

## Per-Issue Results

| Issue | Plan | API | Browser | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| AS-1073 | Generated | BLOCKED | BLOCKED | Report only | Missing skills API/UI route context |
| AS-1139 | Generated | BLOCKED | PASS | Screenshots + video | Jobs route resolver worked |
| AS-1133 | Generated | BLOCKED | Mixed PASS/FAIL | Screenshots + video | Sort dropdown false negative risk |
| AS-1165 | Generated | BLOCKED | 1 PASS, rest BLOCKED | 1 screenshot | Top-level Work Setups route worked |
| AS-1058 | Generated | BLOCKED | BLOCKED | Report only | Deep language/profile/assessment routes missing |

## Suggested Next Steps

1. Add feature-area based route resolver improvements.
2. Add API endpoint resolver from client endpoint files/OpenAPI.
3. Add reusable dropdown/select capability.
4. Add runId-based artifact folders.
5. Add test data resolver for IDs needed by deep flows.
## Evidence Review V2

Browser `FAIL` ve `MANUAL_REQUIRED` sonuçları önce screenshot tabanlı multimodal evidence review ile incelenir.

Video fallback yalnızca screenshot review sonucu `INCONCLUSIVE` olduğunda veya confidence `low` olduğunda çalışır. Her executable browser case için ayrı video oluşturulur ve deterministic olarak `qa-results/videos/<ISSUE>-<CASE>.webm` yoluna kaydedilir.

Video reviewer, failed assertion'ları `resolvedFailures` ve `unresolvedFailures` olarak ayrı ayrı değerlendirir. Herhangi bir failure açıklanamıyorsa overall verdict güvenli biçimde `INCONCLUSIVE` kalır ve `resolvedByVideo` false olur.

Evidence reviewer sonuçları ana browser runner status'unu otomatik değiştirmez; yalnızca verdict, rationale, evidence ve recommended status üretir.

Targeted doğrulamalar:

- `AS-1073 web-2`: screenshot review `TEST_DATA_ISSUE (high)`; video fallback tetiklenmez.
- `AS-1165 web-1`: screenshot review `INCONCLUSIVE (medium)`; video fallback tetiklenir, unresolved failures nedeniyle `INCONCLUSIVE / MANUAL_REQUIRED / resolvedByVideo=false` kalır.
