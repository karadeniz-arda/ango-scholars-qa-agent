import OpenAI from "openai";

export const ollamaClient = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL,
  apiKey: process.env.OLLAMA_API_KEY,
});