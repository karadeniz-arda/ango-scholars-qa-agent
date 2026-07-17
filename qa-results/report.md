# QA Agent Report

## Issue

- **Issue:** AS-1058
- **Plan Issue Key:** AS-1058
- **Summary:** UI - Update Language Proficiency Model to Use Listening, Speaking, Writing, and Reading
- **Generated At:** 2026-07-17T14:32:47.015Z

## Plan Notes

The language proficiency model changed from receptive/productive to four skills: listening, speaking, writing, reading. API schema shows Language.mode enum changed to 'listening' | 'speaking' | 'writing' | 'reading', and new DTOs (CreateTalentLanguageProficiencyDto, UpdateTalentLanguageProficiencyDto) use listeningLevel/speakingLevel/writingLevel/readingLevel. Assessment endpoints now populate languages. The assessment create endpoint path is visible in e2e tests: POST /companies/{companyId}/assessments and GET /companies/{companyId}/assessments/{id}. Talent profile language endpoints are not fully visible in the diff, so those are marked UNKNOWN. Unauthenticated browser coverage is not generated per runner constraints; unauthenticated API cases are included. No placeholders are used for IDs - assessment detail and create endpoints require a companyId and assessmentId, marked UNKNOWN with notes.

## Executive Summary

Issue: AS-1058

- API: 3 PASS / 6 BLOCKED
- Browser: 6 BLOCKED / 1 MANUAL_REQUIRED

## What worked

- API runner executed 3 passing case(s).
- Mutating or missing-context API cases were blocked instead of producing false product failures.

## Failure Learning

### Next Agent Improvements

1. **Some API cases still need runtime context resolvers** — Add or improve runtime resolvers for the missing path params before treating these as product failures.
2. **Browser route resolver needs deeper route/context support** — Add route/context resolver for deep talent contract, assessment, or modal flows. Keep these BLOCKED until the route is known.
3. **Browser generic actions need flow-specific openers** — For modal/form assertions, add generic openers such as Add/Edit/View details before checking field labels. Do not mark these as product bugs automatically.

### Mutating API cases are safely blocked

- Severity: low
- Category: safety_guard
- Product Risk: expected_blocked
- Suggested Code Area: src/agents/api/run-api-cases.ts
- Recommendation: Keep this as expected behavior. Only enable QA_ALLOW_API_MUTATIONS=true with isolated test data.
- Evidence:
  - api-2 | company_admin | POST | /companies/3/assessments | BLOCKED
  - api-9 | unauthenticated | POST | /companies/3/assessments | BLOCKED

### Some API cases still need runtime context resolvers

- Severity: high
- Category: api_context
- Product Risk: agent_limitation
- Suggested Code Area: src/agents/api/run-api-cases.ts, src/agents/api/setup-resolver.ts
- Recommendation: Add or improve runtime resolvers for the missing path params before treating these as product failures.
- Evidence:
  - api-4 | talent | POST | UNKNOWN | BLOCKED
  - api-5 | talent | PATCH | UNKNOWN | BLOCKED
  - api-6 | talent | GET | UNKNOWN | BLOCKED
  - api-7 | company_admin | POST | UNKNOWN | BLOCKED

### Browser route resolver needs deeper route/context support

- Severity: high
- Category: browser_route
- Product Risk: agent_limitation
- Suggested Code Area: src/agents/browser/browser-route-resolver.ts, src/discovery/ui-route-catalog.ts
- Recommendation: Add route/context resolver for deep talent contract, assessment, or modal flows. Keep these BLOCKED until the route is known.
- Evidence:
  - web-1 | BLOCKED
  - web-3 | BLOCKED
  - web-4 | BLOCKED
  - web-5 | BLOCKED
  - web-6 | BLOCKED

### Browser generic actions need flow-specific openers

- Severity: medium
- Category: browser_action
- Product Risk: agent_limitation
- Suggested Code Area: src/agents/browser/generic-browser-actions.ts, src/agents/browser/run-browser-cases.ts
- Recommendation: For modal/form assertions, add generic openers such as Add/Edit/View details before checking field labels. Do not mark these as product bugs automatically.
- Evidence:
  - web-2 | MANUAL_REQUIRED


## Result Summary

### API Summary

- **PASS:** 3
- **BLOCKED:** 6


### Browser Summary

- **BLOCKED:** 6
- **MANUAL_REQUIRED:** 1


## Result Semantics

- **PASS:** The test executed successfully and all explicit expectations were verified.
- **FAIL:** The target page or endpoint was reached, but the expected product behavior was not observed.
- **BLOCKED:** The test could not be executed because route, persona, auth, setup data, or environment context was missing.
- **MANUAL_REQUIRED:** The test needs human verification because it is destructive, ambiguous, visual-only, or not reliably automatable yet.
- **ERROR:** The agent or runtime failed unexpectedly.

### Reason Categories

- **ASSERTIONS_PASSED:** All explicit browser assertions passed.
- **PRODUCT_ASSERTION_FAILED:** The page or endpoint was reached, but an expected product behavior was not observed.
- **EXPECTED_STATUS_MATCHED:** API response status matched the expected status.
- **API_EXPECTATION_FAILED:** API response was received but did not match the expected product/API expectation.
- **MISSING_API_CONTEXT:** API path, setup data, request body, or API contract is missing.
- **MISSING_BROWSER_ROUTE:** Browser route could not be resolved.
- **AUTOMATION_LIMITATION:** The agent reached the page but could not safely or reliably automate/verify the required interaction.
- **NO_STRUCTURED_STEPS:** The browser case does not include executable structured steps.
- **NO_EXPLICIT_ASSERTIONS:** The browser case executed actions but did not verify explicit expectations.
- **AGENT_RUNTIME_ERROR:** The agent/runtime failed unexpectedly.



## API Results

| Case ID | Persona | Method | Original Path | Resolved Path | Expected | Actual | Result | Reason Category | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| api-1 |company_admin |GET |UNKNOWN |/companies/3/assessments/13 |200 |200 |PASS |EXPECTED_STATUS_MATCHED | |
| api-2 |company_admin |POST |UNKNOWN |/companies/3/assessments |201 | |BLOCKED |MISSING_API_CONTEXT |POST is a mutating API case. It is blocked by default to avoid changing staging data. Set QA_ALLOW_API_MUTATIONS=true only when test data is safe. |
| api-3 |company_admin |GET |UNKNOWN |/companies/3/assessments/13 |200 |200 |PASS |EXPECTED_STATUS_MATCHED | |
| api-4 |talent |POST |UNKNOWN |UNKNOWN |201 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-5 |talent |PATCH |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-6 |talent |GET |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-7 |company_admin |POST |UNKNOWN |UNKNOWN |400 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-8 |unauthenticated |GET |UNKNOWN |/companies/3/assessments/13 |401 |401 |PASS |EXPECTED_STATUS_MATCHED | |
| api-9 |unauthenticated |POST |UNKNOWN |/companies/3/assessments |401 | |BLOCKED |MISSING_API_CONTEXT |POST is a mutating API case. It is blocked by default to avoid changing staging data. Set QA_ALLOW_API_MUTATIONS=true only when test data is safe. |


## Browser Results

| Case ID | Persona | Start Route | Result | Reason Category | Evidence / Notes | Goal |
| --- | --- | --- | --- | --- | --- | --- |
| web-1 |company_admin |/company/assessments/13 |BLOCKED |MISSING_BROWSER_ROUTE |Assessment language modal requires entering an edit flow. Browser edit flows are disabled by default to protect staging data. Set QA_ALLOW_BROWSER_EDIT_FLOWS=true only for isolated test data. \| Success signal: The assessment language requirements modal displays proficiency fields for Listening, Speaking, Writing, and Reading. The old 'Receptive Level' and 'Productive Level' labels are not visible. \| Success signal reached: false |Verify assessment language requirements modal shows Listening, Speaking, Writing, Reading labels and no Receptive/Productive |
| web-2 |company_admin |/company/assessments/13 |MANUAL_REQUIRED |AUTOMATION_LIMITATION |qa-results/evidence/web-2-screenshot.png \| Success signal: Assessment header view shows language badges formatted with listening, speaking, writing, and reading proficiency info. No 'receptive' or 'productive' text in language badges. \| Success signal reached: false \| Pages visited: https://scholars-client-575683486613.us-east1.run.app/company/assessments/13?project=310 \| Key visible texts: Project, Skills, All \| Notes: assert visible "Languages": FAIL \| assert not visible "receptive": PASS \| assert not visible "productive": PASS \| assert not visible "Receptive": PASS \| assert not visible "Productive": PASS \| assert not visible "undefined": PASS \| One or more assertions failed after a generic browser action limitation. Manual verification is required before treating this as a product bug. \| Trace: 01. navigate PASS - Navigated to https://scholars-client-575683486613.us-east1.run.app/company/assessments/13 \|\| 02. browser-step FAIL - assert visible "Languages": FAIL \|\| 03. browser-step PASS - assert not visible "receptive": PASS \|\| 04. browser-step PASS - assert not visible "productive": PASS \|\| 05. browser-step PASS - assert not visible "Receptive": PASS \|\| 06. browser-step PASS - assert not visible "Productive": PASS \|\| 07. browser-step PASS - assert not visible "undefined": PASS \|\| 08. browser-step FAIL - One or more assertions failed after a generic browser action limitation. Manual verification is required before treating this as a product bug. \|\| 09. screenshot PASS - Screenshot captured: qa-results/evidence/web-2-screenshot.png \|\| 10. final-status MANUAL_REQUIRED - Final browser case status: MANUAL_REQUIRED \| Video: qa-results/videos/AS-1058-web-2.webm \| Evidence review verdict: AUTOMATION_LIMITATION \| Evidence review confidence: medium \| Evidence review rationale: The screenshot shows the correct assessment page for 'Introduction to Ornithology', but the agent is currently on the 'Submissions' tab. The test goal requires verifying language badges in the 'assessment header view', yet no language-related information is visible in this tab's content. The 'Details' tab is available and unselected, suggesting the agent did not navigate to the nested UI state where the assessment header and language badges would be displayed. Because the required panel or tab was not opened, the failure to find the text 'Languages' cannot be proven as a product bug from this screenshot alone. \| Visible evidence: The active tab is 'Submissions' while 'Details' and 'Questions' tabs remain unselected; The text 'Languages' is absent from the entire visible page; No language badges or four-skill proficiency information appear in the current table or header area \| Evidence review recommended status: MANUAL_REQUIRED |Verify assessment header view displays language badges with new four-skill format |
| web-3 |company_admin |/company/skills |BLOCKED |IRRELEVANT_BROWSER_ROUTE |Browser relevance gate rejected web-3: expected area=jobs, selected area=skills, route=/company/skills \| Success signal: Job change request languages comparison displays language summaries with four-skill proficiency info instead of just language names. \| Success signal reached: false |Verify job change request review languages comparison shows new skill format |
| web-4 |company_admin |/company/skills |BLOCKED |IRRELEVANT_BROWSER_ROUTE |Browser relevance gate rejected web-4: expected area=talent-pool, selected area=skills, route=/company/skills \| Success signal: Talent pool details panel shows language summary cards with language name and proficiency metadata using the new four-skill model. \| Success signal reached: false |Verify talent pool details panel skills tab displays language summary cards with four-skill info |
| web-5 |talent |/talent/jobs |BLOCKED |IRRELEVANT_BROWSER_ROUTE |Browser relevance gate rejected web-5: expected area=onboarding, selected area=jobs, route=/talent/jobs \| Success signal: Onboarding languages step displays language adjustment rows with proficiency level controls for Listening, Speaking, Writing, and Reading. Compact layout is applied. No Receptive/Productive labels visible. \| Success signal reached: false |Verify onboarding languages step shows four skill proficiency selectors (Listening, Speaking, Writing, Reading) |
| web-6 |talent |/talent/jobs |BLOCKED |IRRELEVANT_BROWSER_ROUTE |Browser relevance gate rejected web-6: expected area=talent-profile, selected area=jobs, route=/talent/jobs \| Success signal: Skills & Languages tab shows language adjustment rows with four skill proficiency controls. Each row uses size xs and allows per-skill level adjustments via popover. \| Success signal reached: false |Verify skills and languages profile tab displays language rows with four-skill adjustment and xs size |
| web-7 |talent |/talent/jobs |BLOCKED |IRRELEVANT_BROWSER_ROUTE |Browser relevance gate rejected web-7: expected area=languages, selected area=jobs, route=/talent/jobs \| Success signal: On a narrow viewport, the language adjustment popover renders Listening, Speaking, Writing, Reading skill rows without layout overflow or undefined text. \| Success signal reached: false |Verify language adjustment popover on mobile viewport shows four skill rows correctly |


## Observations

- API cases marked **PASS** matched the expected HTTP status.
- API cases marked **FAIL** reached the endpoint but did not match the expected product/API expectation.
- API cases marked **BLOCKED** were not executed because route, setup data, body, persona, or required context was missing.
- API cases marked **ERROR** failed because of an agent/runtime execution problem.
- Browser cases marked **PASS** completed all generic browser assertions successfully.
- Browser cases marked **FAIL** reached the target page but at least one expected product assertion failed.
- Browser cases marked **MANUAL_REQUIRED** reached a point where human verification is needed because the action is not safely or reliably automatable yet.
- Browser cases marked **BLOCKED** were not executed because route, persona, setup data, or required context was missing.
- Browser cases marked **ERROR** failed because of an agent/runtime execution problem.
- Browser assertion details are included in the **Evidence / Notes** column.
