import {
  getReasoningOptions,
  ollamaClient,
} from "../llm/ollama-client.js";

function stripMarkdownFences(raw: string): string {
  return String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractFirstJsonObject(raw: string): string {
  const text = stripMarkdownFences(raw);

  const start = text.indexOf("{");

  if (start === -1) {
    throw new Error("Model output does not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("Model output contains an incomplete JSON object.");
}

function removeKnownBadJsonLines(jsonText: string): string {
  const lines = jsonText.split("\n");

  return lines
    .filter((line, index) => {
      const trimmed = line.trim();
      const nextLine = lines[index + 1]?.trim() || "";

      /**
       * Fixes invalid model mistakes like:
       *
       * {
       *   "id": "api-4",
       *   "company_admin",
       *   "persona": "company_admin"
       * }
       *
       * A standalone string line inside an object is invalid JSON.
       */
      const isStandaloneString = /^"[^"]+"\s*,?$/.test(trimmed);
      const nextLooksLikeProperty = /^"[^"]+"\s*:/.test(nextLine);

      return !(isStandaloneString && nextLooksLikeProperty);
    })
    .join("\n");
}

function removeTrailingCommas(jsonText: string): string {
  return jsonText.replace(/,\s*([}\]])/g, "$1");
}

export function cleanJsonOutput(raw: string): string {
  const extracted = extractFirstJsonObject(raw);

  try {
    const parsed = JSON.parse(extracted);
    return JSON.stringify(parsed, null, 2);
  } catch (firstError) {
    const repaired = removeTrailingCommas(removeKnownBadJsonLines(extracted));

    try {
      const parsed = JSON.parse(repaired);
      return JSON.stringify(parsed, null, 2);
    } catch {
      throw firstError;
    }
  }
}

export async function repairJsonWithModel(raw: string, parseError: any): Promise<string> {
  console.log("Initial test plan JSON parse failed. Retrying JSON repair...");
  console.log(`Parse error: ${parseError.message}`);

  const repairResponse = await ollamaClient.chat.completions.create({
    model: process.env.OLLAMA_MODEL || "gpt-4o-mini",
    ...getReasoningOptions(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are a JSON repair assistant.

Return ONLY valid JSON.
Do not use markdown fences.
Do not add explanation.
Do not add new test cases.
Do not remove valid test cases.
Preserve the original test plan schema and content as much as possible.
Only fix invalid JSON syntax.
`,
      },
      {
        role: "user",
        content: `
This test plan failed JSON.parse with this error:

${parseError.message}

Return the corrected valid JSON object only:

${raw}
`,
      },
    ],
  });

  const repairedAnswer = repairResponse.choices[0]?.message.content || "{}";

  return cleanJsonOutput(repairedAnswer);
}
