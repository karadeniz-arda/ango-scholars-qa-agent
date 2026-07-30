import OpenAI from "openai";

type QaReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh";

function readReasoningEffort():
  QaReasoningEffort | undefined {
  const value =
    process.env.QA_REASONING_EFFORT?.trim();

  if (!value) {
    return undefined;
  }

  if (
    value !== "low" &&
    value !== "medium" &&
    value !== "high" &&
    value !== "xhigh"
  ) {
    throw new Error(
      "QA_REASONING_EFFORT must be " +
      "low, medium, high, or xhigh."
    );
  }

  return value;
}

export function getReasoningOptions() {
  const reasoningEffort =
    readReasoningEffort();

  if (!reasoningEffort) {
    return {};
  }

  return {
    reasoning_effort: reasoningEffort,
  };
}

export function getVisionModelOptions() {
  const reasoningEffort =
    readReasoningEffort();

  if (reasoningEffort) {
    return {
      reasoning_effort: reasoningEffort,
    };
  }

  return {
    temperature: 0 as const,
  };
}

export const ollamaClient = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL,
  apiKey: process.env.OLLAMA_API_KEY,
});