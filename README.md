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
- Write PASS / FAIL / DONE / BLOCKED results into a markdown report.

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

- **PASS:** The test ran and all expected checks passed.
- **FAIL:** The test ran but at least one expected check failed.
- **DONE:** The browser case completed navigation/actions and captured evidence, but had no explicit assertions.
- **BLOCKED:** The case could not be executed because required route, persona, setup data, or context was missing.
- **ERROR:** The case failed due to an execution/runtime error.

---

## Current Capabilities
The current agent supports:

- Jira issue based test planning.
- GitHub change context based test planning.
- Generic browser steps such as:
  - wait
  - setViewport
  - clickTopTab
  - clickButton
  - clickText
  - assertTextVisible
  - assertTextNotVisible
- Static route resolution for known page areas.
- Manager API based route resolution for company job details pages.
- Firebase-based persona authentication.
- Browser session reuse for consecutive cases with the same persona.
- Markdown report generation with API/browser result summaries.

---

## Current Limitations
- Some browser routes still require explicit resolver support.
- Talent-side job details routes are not resolved yet.
- Closed/draft job detail cases require matching staging test data.
- Complex searchable or virtualized dropdowns need data-aware selection instead of coordinate-based scrolling.
- Planner output depends on the quality of Jira and GitHub context.

---

## Example Workflow

    npm run plan -- --issue AS-1066
    npm run browser -- --issue AS-1066
    cat qa-results/report.md

## Evaluation Notes
Additional evaluation notes can be found in qa-results/evaluation-notes.md.