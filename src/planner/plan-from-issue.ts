import fs from "fs";
import { ollamaClient } from "../llm/ollama-client.js";
import { getJiraIssue } from "../agents/api/jiraFetcher.js";
import { getGithubChangeContext } from "../agents/api/githubFetcher.js";

type ADFNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  content?: ADFNode[];
};

function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  
  const children = node.content?.map(adfToText).join("") ?? "";
  
  if (node.type === "heading") return `\n${children}\n`;
  if (node.type === "paragraph") return `${children}\n`;
  if (node.type === "listItem") return `- ${children.trim()}\n`;
  
  return children;
}

export async function readTicketFiles(ticketId: string) {
  const jiraIssue = await getJiraIssue(ticketId);
  
  if (!jiraIssue) {
    throw new Error(`Could not fetch Jira issue: ${ticketId}`);
  }
  
  const descriptionText = adfToText(jiraIssue.description);
  let githubContext = "";
  
  try {
    githubContext = await getGithubChangeContext(ticketId);
  } catch (error: any) {
    githubContext = `
--- GITHUB CHANGE CONTEXT ---
Could not fetch GitHub changes. Reason: ${error.message}
`;
  }
  
  return `
--- JIRA TICKET ---
Key: ${jiraIssue.key}
Summary: ${jiraIssue.summary}
Status: ${jiraIssue.status}
Description: ${descriptionText}

${githubContext}
`;
}

export async function generateTestPlan(ticketId: string) {
  const fileContents = await readTicketFiles(ticketId);
  
  const systemPrompt = `
You are a senior QA engineer. I will give you a real Jira ticket. Create a test plan and return ONLY valid JSON.

Important context:
- You will receive a real Jira ticket and GitHub change context.
- Use GitHub changed files, patches, commit messages, and Jira acceptance criteria together.
- Prefer endpoints, routes, components, fields, labels, and UI copy that are visible in the GitHub diff.
- If GitHub context is missing or incomplete, mark unknown paths/routes as "UNKNOWN" instead of inventing them.
- Do not reuse routes, issue names, or test data from previous issues.

General rules:
1. Include API cases and browser cases if relevant.
2. Focus on acceptance criteria and risky edge cases.
3. Do not hardcode the old Skills export ticket.
4. API personas may be: "company_admin", "talent", and "unauthenticated".
5. Browser personas may be only: "company_admin" and "talent".
6. Do NOT generate unauthenticated browserCases yet because the browser runner does not support unauthenticated execution. Mention unauthenticated browser coverage in notes instead.
7. Do NOT use unsupported personas such as "company_member".
8. Do NOT invent endpoint paths. If the Jira ticket or GitHub diff does not provide an endpoint, set "path": "UNKNOWN".
9. Do NOT invent browser routes. If the Jira ticket or GitHub diff does not provide a route, set "startRoute": "UNKNOWN".
10. Do NOT use placeholders like "{jobId}", "{paymentId}", "{existingJobId}", "{companyId}", or "{id}". If an ID/setup data is required, mark the route/path as "UNKNOWN" and explain it in notes.
11. For POST, PATCH, or DELETE requests, include a realistic "body" only if the Jira ticket or GitHub diff clearly provides enough information. Otherwise set "path": "UNKNOWN" and explain that GitHub diff/API contract is needed.
12. No destructive browser actions. Do not click Reject, Delete, Submit, Send, Approve, Archive, Invite, Remove, or similar destructive buttons.
13. If a test cannot be executed yet because GitHub diff/API contract/route/test data is missing, still include the test case but explain this in notes.
14. Return ONLY valid JSON. No markdown.

Browser step rules:
Every browserCase MUST include a "steps" array. The browser runner supports ONLY these actions:
1. wait
   Example: { "action": "wait", "ms": 1000 }
2. setViewport
   Example: { "action": "setViewport", "width": 430, "height": 900 }
3. clickTopTab
   Use for safe main-content tabs such as Details, Applicants, Assessments, Payments.
   Example: { "action": "clickTopTab", "text": "Details" }
4. clickButton
   Use only for safe non-destructive buttons.
   Example: { "action": "clickButton", "text": "Filters" }
5. clickText
   Use for safe visible text in the main content area.
   Example: { "action": "clickText", "text": "Payments" }
6. assertTextVisible
   Use for expected headings, labels, badges, columns, validation messages, and UI copy.
   Example: { "action": "assertTextVisible", "text": "Active" }
7. assertTextNotVisible
   Use for negative checks such as undefined, null, raw errors, leaked data, or removed old copy.
   Example: { "action": "assertTextNotVisible", "text": "undefined" }

Browser step requirements:
- Every executable browserCase must include at least one assertion step.
- If startRoute is "UNKNOWN", still include the ideal generic steps for when the route is resolved.
- Do not invent CSS selectors, XPath, Playwright code, or unsupported action names.
- For read-only UI issues, prefer assertTextVisible/assertTextNotVisible and safe tab navigation.
- For visual/layout issues, include one normal viewport case and optionally one setViewport narrow/mobile case.
- For table/column issues, assert the table/page heading and the expected new column text.
- Always include negative assertions for "undefined" and "null" when the ticket mentions missing/partial server data.

The JSON structure MUST match exactly this:
{
  "issueKey": "ticket id",
  "summary": "ticket summary",
  "notes": "overall assumptions, missing context, route limitations, or unauthenticated browser coverage notes",
  "apiCases": [
    {
      "id": "api-1",
      "persona": "company_admin",
      "method": "GET",
      "path": "UNKNOWN",
      "body": {},
      "expect": {
        "status": 200,
        "notes": "why this case matters or why it is blocked"
      }
    }
  ],
  "browserCases": [
    {
      "id": "web-1",
      "persona": "company_admin",
      "goal": "what to verify",
      "startRoute": "UNKNOWN",
      "successCriteria": "what should be true",
      "steps": [
        { "action": "assertTextVisible", "text": "expected text" },
        { "action": "assertTextNotVisible", "text": "undefined" },
        { "action": "assertTextNotVisible", "text": "null" }
      ]
    }
  ]
}
`;

  console.log("AI test plan from real Jira issue");
  
  const response = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fileContents },
    ],
  });
  
  const aiAnswer = response.choices[0]?.message.content || "{}";
console.log("Given Answer:\n", aiAnswer);

function cleanJsonOutput(raw: string): string {
  let cleaned = raw.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(cleaned);
  return JSON.stringify(parsed, null, 2);
}

const cleanPlan = cleanJsonOutput(aiAnswer);

if (!fs.existsSync("qa-results")) {
  fs.mkdirSync("qa-results");
}

fs.writeFileSync("qa-results/test-plan.json", cleanPlan, "utf-8");
console.log("Test plan saved");

return cleanPlan;
}