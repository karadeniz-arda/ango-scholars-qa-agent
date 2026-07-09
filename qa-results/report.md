# QA Agent Report

## Issue

- **Issue:** AS-1146
- **Plan Issue Key:** AS-1146
- **Summary:** Project Select issue on project dropdown for the last item
- **Generated At:** 2026-07-07T11:44:10.900Z

## Plan Notes

Jira ticket body is empty (Context, Task, Action, and Acceptance Criteria are all blank). No commits were found in imerit-io/ango-scholars-client or imerit-io/ango-scholars-server for AS-1146. Because the GitHub diff and acceptance criteria are missing, exact endpoints, routes, payloads, and component copy are unknown. All API paths and browser startRoutes are therefore marked as UNKNOWN. The expected fix likely involves a Project dropdown where the last item cannot be selected (common root causes: overflow/clipping, z-index/stacking, scroll position, pointer-events, or off-by-one keyboard navigation). API contract (GET/POST projects, project selection endpoint) and the UI route hosting the dropdown are required to unblock executable test cases. Unauthenticated browser coverage is intentionally not generated per runner limitations; unauthenticated UI behavior (e.g., dropdown not rendered or disabled for logged-out users) should be covered manually.

## Result Summary

### API Summary

No results.


### Browser Summary

- **FAIL:** 5
- **BLOCKED:** 1


## API Results

No API results.


## Browser Results

| Case ID | Persona | Start Route | Result | Evidence / Notes | Goal |
| --- | --- | --- | --- | --- | --- |
| web-1 |company_admin |UNKNOWN |FAIL |qa-results/evidence/web-1-screenshot.png \| wait 1000ms \| assert visible "Project": PASS \| clicked project dropdown \| could not select last dropdown option \| assert not visible "undefined": PASS \| assert not visible "null": PASS |Verify the last item in the Project dropdown is visible, clickable, and becomes the selected value |
| web-2 |company_admin |UNKNOWN |FAIL |qa-results/evidence/web-2-screenshot.png \| wait 1000ms \| assert visible "Project": PASS \| clicked project dropdown \| could not select last dropdown option \| assert not visible "undefined": PASS \| assert not visible "null": PASS |Verify the last item in the Project dropdown is not clipped or hidden by overflow/footer/z-index |
| web-3 |company_admin |UNKNOWN |FAIL |qa-results/evidence/web-3-screenshot.png \| wait 1000ms \| assert visible "Project": PASS \| clicked project dropdown \| could not select last dropdown option \| assert not visible "undefined": PASS \| assert not visible "null": PASS |Verify the last item is reachable via keyboard navigation in the Project dropdown |
| web-4 |company_admin |UNKNOWN |FAIL |qa-results/evidence/web-4-screenshot.png \| wait 1000ms \| assert visible "Project": PASS \| clicked project dropdown \| could not select last dropdown option \| assert not visible "undefined": PASS \| assert not visible "null": PASS |Verify mobile/narrow viewport rendering of the Project dropdown's last item |
| web-5 |talent |UNKNOWN |BLOCKED |Browser startRoute is UNKNOWN. GitHub diff/UI route context is needed before this case can be executed. |Verify the last item in the talent-side Project dropdown is selectable |
| web-6 |company_admin |UNKNOWN |FAIL |qa-results/evidence/web-6-screenshot.png \| wait 1000ms \| assert visible "Project": PASS \| clicked project dropdown \| could not select last dropdown option \| assert not visible "undefined": PASS \| assert not visible "null": PASS |Verify the Project dropdown still renders the header/label and is accessible from a safe top tab |


## Observations

- Browser cases marked **PASS** completed all generic browser assertions successfully.
- Browser cases marked **FAIL** reached the target page but at least one generic browser assertion failed.
- Browser cases marked **DONE** completed navigation/actions and screenshot capture without explicit assertions.
- Browser cases marked **BLOCKED** were not executed because route, persona, setup data, or required context was missing.
- Browser assertion details are included in the **Evidence / Notes** column.
