import fs from "fs";

export function readTicketFiles(ticketId: string) {

  const jiraPath = `fixtures/jira/${ticketId}.md`;
  const changePath = `fixtures/change-context/${ticketId}.md`;
  const diffPath = `fixtures/diff/${ticketId}-files.txt`;

  const jiraContent = fs.readFileSync(jiraPath, "utf-8");
  const changeContent = fs.readFileSync(changePath, "utf-8");
  const diffContent = fs.readFileSync(diffPath, "utf-8");
 
  const combinedText = `
  --- JIRA TICKET ---
  ${jiraContent}

  --- CODE CHANGES ---
  ${changeContent}

  --- CHANGED FILES ---
  ${diffContent}
  `;

  return combinedText;
}

import { ollamaClient } from "../llm/ollama-client.js";


export async function generateTestPlan(ticketId: string) {

  const fileContents = readTicketFiles(ticketId);

  const systemPrompt = `
    You are a senior QA engineer. I will give you a Jira ticket and code changes.
    Create a test plan and return ONLY valid JSON. 
    
    Rules:
    1. At least 2 API cases and 2 Browser cases.
    2. Include "GET /skills/export-csv" for company_admin.
    3. Include checking "/company/skills" for an Export button.
    4. No destructive actions.
    
    The JSON structure MUST match exactly this:
    {
      "issueKey": "ticket id",
      "summary": "ticket summary",
      "apiCases": [ { "id": "api-1", "persona": "company_admin", "method": "GET", "path": "...", "expect": { "status": 200 } } ],
      "browserCases": [ { "id": "web-1", "persona": "company_admin", "goal": "...", "startRoute": "...", "successCriteria": "..." } ]
    }
  `;

  console.log("AI test plan");

  const response = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini", 
    response_format: { type: "json_object" },  
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fileContents }
    ]
  });

  const aiAnswer = response.choices[0]?.message.content;
  console.log("Given Answer:\n", aiAnswer);
  
  if (!fs.existsSync("qa-results")) {
    fs.mkdirSync("qa-results");
  }
  
  fs.writeFileSync("qa-results/test-plan.json", aiAnswer || "{}", "utf-8");
  console.log("Mükemmel! Test planı 'qa-results/test-plan.json' adresine kaydedildi.");

  return aiAnswer;
}

