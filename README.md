# Ango Scholars QA Agent

A TypeScript-based QA agent that generates and executes issue-specific API and browser test plans for Ango Scholars.

The agent can:
- Fetch Jira issue context.
- Fetch related GitHub change context.
- Generate structured API and browser test plans with an LLM.
- Resolve executable routes using known route rules and manager API data.
- Run API tests against staging.
- Run browser tests against staging with Playwright/Stagehand.
- Capture screenshots and videos as evidence.
- Write PASS / FAIL / BLOCKED / MANUAL_REQUIRED / ERROR results into a markdown report.

---

## Tech Stack
- Node.js
- TypeScript
- tsx
- Jira API
- GitHub API
- Firebase Auth
- Playwright
- Stagehand
- YAML config

---

## Prerequisites
- Node.js
- npm
- Access to Jira
- Access to GitHub repositories
- Firebase service account credentials
- Staging environment access

---

## Installation

    npm install

### Environment Variables
Create a .env file in the project root. Required values include:

    JIRA_BASE_URL=
    JIRA_EMAIL=
    JIRA_API_KEY=

    GITHUB_TOKEN=
    GITHUB_REPOS=

    FIREBASE_SERVICE_ACCOUNT_KEY=
    VITE_FIREBASE_API_KEY=
    VITE_FIREBASE_AUTH_DOMAIN=
    VITE_FIREBASE_PROJECT_ID=

    QA_COMPANY_ID=
    QA_COMPANY_EMAIL=
    QA_TALENT_EMAIL=

    OLLAMA_MODEL=

> **Note:** Do not commit your .env file to version control.

### Configuration
Staging URLs are configured in config/environments.yaml.

Example:

    default_target: staging

    environments:
      staging:
        url: https://example-client-url
        api_url: https://example-server-url

---

## Usage

### Generate a Test Plan
Generate a test plan from a Jira issue:

    npm run plan -- --issue AS-1066

*This creates: qa-results/test-plan.json*

### Run API Cases

    npm run run -- --issue AS-1066

*This executes the generated API cases and writes results to: qa-results/report.md*

### Run Browser Cases

    npm run browser -- --issue AS-1066

*This executes browser cases, captures screenshots/videos, and writes results to: qa-results/report.md*

Browser evidence is saved under:
- qa-results/evidence/
- qa-results/videos/

### Run API + Browser Smoke

    npm run smoke -- --issue AS-1066

---

## Result Statuses

The report uses the following statuses:

- **PASS:** The case executed and all required assertions passed.
- **FAIL:** The case executed and at least one required assertion failed with sufficient deterministic evidence.
- **BLOCKED:** Execution was prevented by missing fixture data, an unresolved API contract, mutation safety policy, unsupported authentication, or another explicit prerequisite.
- **MANUAL_REQUIRED:** The correct feature area was reached, but the runner or available evidence could not safely confirm the complete acceptance criterion.
- **ERROR:** An unexpected execution or infrastructure error occurred.

---

## Current Capabilities

The current agent supports:

- Real Jira issue and GitHub change-context based planning.
- Planner case budgets, fixture policies, URL assertion prerequisites, mutation safety rules, and schema normalization.
- API endpoint and UI route manifest discovery.
- Runtime company, project, talent, job, assessment, invoice, contract, work-setup, skill, and related execution-context resolution.
- Source-grounded query-parameter preservation while resolving unknown endpoint bases.
- API semantic assertions in addition to HTTP status checks.
- Safe default blocking for mutating API requests.
- Safe default blocking for browser mutations.
- A dedicated QA-owned draft-job creation flow with exact redirect verification and exact cleanup.
- Firebase-backed company-admin and talent browser personas.
- Browser session reuse for consecutive cases with the same persona.
- Generic browser actions including tab selection, menu opening, filtering, reload, URL assertions, text assertions, and safe option selection.
- Semantic table-row matching and safe row-detail control discovery.
- Runtime-compatible invoice and contract fixture selection where the plan explicitly permits compatible-state substitution.
- Screenshot, checkpoint, video, trace, and structured deterministic evidence capture.
- Screenshot and video evidence review with final PASS / FAIL / BLOCKED / MANUAL_REQUIRED reconciliation.
- Canonical 13-issue regression execution with plan-hash verification and machine-readable blocked-reason taxonomy.
- Planner reproducibility checks based on schema, safety, budget, and structural coverage contracts.

---

## Current Limitations

- Executability still depends on staging data, entity ownership, lifecycle state, and persona permissions.
- Exact fixture policies intentionally block cases when the requested record is unavailable.
- Deep or scrollable modal content may require scroll-aware, surface-scoped assertions.
- Complex virtualized dropdowns and controls without accessible metadata may still require additional generic semantic interaction support.
- Browser and API mutations are disabled by default; canonical mutation cases therefore remain BLOCKED unless an explicitly guarded canary is run.
- Some network, download, redirect, permission, and backend-side acceptance criteria require dedicated deterministic oracles.
- LLM wording can vary between fresh plans; reproducibility checks validate structural and safety contracts rather than byte-identical JSON.

---


## Validation and Reproducibility

Run the canonical 13-issue regression:

    QA_REGRESSION_PLAN_MODE=canonical \
    QA_REGRESSION_RESUME=false \
    QA_ALLOW_BROWSER_MUTATIONS=false \
    QA_ALLOW_API_MUTATIONS=false \
    QA_BROWSER_MUTATION_PREFLIGHT=false \
    QA_ALLOW_BROWSER_EDIT_FLOWS=true \
    QA_EVIDENCE_REVIEW=true \
    bash scripts/run-final-13-regression.sh

Check planner structural reproducibility for a Jira issue:

    npm run check:planner-repro -- --issue AS-1066

Planner reproducibility checks two fresh plans for schema validity, supported personas and actions, case budgets, fixture policy, mutation safety, and structural coverage consistency.

---

## Example Workflow

    npm run plan -- --issue AS-1066
    npm run browser -- --issue AS-1066
    cat qa-results/report.md

## Evaluation Notes
Additional evaluation notes can be found in qa-results/evaluation-notes.md.
