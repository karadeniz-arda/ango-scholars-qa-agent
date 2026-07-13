# QA Agent Report

## Issue

- **Issue:** AS-1058
- **Plan Issue Key:** AS-1058
- **Summary:** UI - Update Language Proficiency Model to Use Listening, Speaking, Writing, and Reading
- **Generated At:** 2026-07-13T11:45:12.125Z

## Plan Notes

GitHub diff shows the Language.mode enum was updated from 'receptive' | 'productive' to 'listening' | 'speaking' | 'writing' | 'reading'. The client now uses a new LanguageAdjustmentRow component, new i18n keys (listeningLabel, speakingLabel, writingLabel, readingLabel, proficiencyLevelLabel, levelAdjustment, reset, removeLanguage, customProficiencyValue), and the onboarding payload now sends a 'languages' array of CreateTalentLanguageProficiencyDto objects (each with listeningLevel, speakingLevel, writingLevel, readingLevel) instead of legacy 'languageIds'. The server AssessmentService.findOneByCompany now populates 'languages' alongside skills/question. Specific test data IDs (companyId, assessmentId, languageId) are not provided in the Jira or diff, so they are marked UNKNOWN. Unauthenticated browser coverage is not generated because the browser runner does not support unauthenticated execution; the legacy UI strings (Receptive, Productive, receptiveLevelLabel, productiveLevelLabel) should be visually confirmed to be absent on every updated client surface (assessment modal, assessment view, job change request review, talent profile Skills and Languages tab, talent onboarding Languages step).

## Result Summary

### API Summary

- **BLOCKED:** 12


### Browser Summary

- **BLOCKED:** 7


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
| api-1 |company_admin |POST |UNKNOWN |UNKNOWN |201 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-2 |company_admin |POST |UNKNOWN |UNKNOWN |400 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-3 |company_admin |GET |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-4 |company_admin |GET |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-5 |company_admin |POST |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-6 |company_admin |POST |UNKNOWN |UNKNOWN |400 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-7 |company_admin |POST |UNKNOWN |UNKNOWN |400 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-8 |talent |GET |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-9 |talent |PATCH |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-10 |company_admin |GET |UNKNOWN |UNKNOWN |200 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-11 |company_admin |POST |UNKNOWN |UNKNOWN |400 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |
| api-12 |unauthenticated |GET |UNKNOWN |UNKNOWN |401 | |BLOCKED |MISSING_API_CONTEXT |API path contains unresolved setup data: UNKNOWN |


## Browser Results

| Case ID | Persona | Start Route | Result | Reason Category | Evidence / Notes | Goal |
| --- | --- | --- | --- | --- | --- | --- |
| web-1 |company_admin |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Assessment Language Requirements modal shows Listening/Speaking/Writing/Reading labels instead of Receptive/Productive |
| web-2 |company_admin |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Assessment header view shows languages grouped by skill (Listening/Speaking/Writing/Reading) using formatDeclaredLanguageSkillSummary |
| web-3 |company_admin |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Job change request review language comparison displays the new four-skill summaries and not legacy names |
| web-4 |talent |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Talent profile Skills and Languages tab shows the language adjustment row using the new four-skill model |
| web-5 |talent |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Talent onboarding Languages step renders the new compact LanguageAdjustmentRow with four skills |
| web-6 |company_admin |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Mobile/narrow viewport of the Assessment Language Requirements modal keeps the four-skill labels readable and not clipped |
| web-7 |talent |UNKNOWN |BLOCKED |MISSING_BROWSER_ROUTE |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Talent profile Skills and Languages tab on mobile viewport still shows the four new skill labels and never legacy ones |


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
