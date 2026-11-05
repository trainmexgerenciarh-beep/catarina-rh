import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * Classify a message without answering it or consulting HR documents.
 */
export async function classifyTopic(text: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: "gemini-flash-latest",
    contents: [
      "Clasifica el tema principal del mensaje en una etiqueta breve en español.",
      "No respondas la consulta, no des consejos y no incluyas datos personales.",
      "Devuelve únicamente la etiqueta temática.",
      "",
      "Mensaje:",
      text
    ].join("\n"),
    config: {
      maxOutputTokens: 32,
      temperature: 0
    }
  });

  const topic = response.text
    ?.trim()
    .split(/\r?\n/, 1)[0]
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!topic) {
    throw new Error("Gemini returned an empty topic");
  }

  return topic.slice(0, 80);
}
