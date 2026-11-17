import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema } from "../schemas/extractionSchema.js";

export class ExtractionError extends Error {
    constructor(message: string, public readonly status = 502) {
        super(message);
        this.name = "ExtractionError";
    }
}
type DocumentPage = {
    pageNumber: number;
    text: string;
};

export async function extractForm(pages: DocumentPage[]) {
    const SYSTEM_PROMPT = `Read the customer document and produce one reusable form definition.

Return ONLY a valid JSON object with these properties:
- "title": a string
- "description": a string
- "fields": an array of field definitions

Do not include Markdown, code fences, tables, explanations, or text
before or after the JSON.

Use only properties defined in the provided form schema.
Do not add properties such as helpText, notes, or defaultValue.

Use double quotes for property names and string values.
Use ordinary numbers, not MongoDB functions such as NumberInt().
Do not include _id, createdAt, updatedAt, or __v.

Generate unique camelCase field IDs.
Allowed field types: text, textarea, number, boolean, select.
Use visibleWhen and requiredWhen for supported dependencies.

Extract only requirements supported by the customer document.
Do not invent missing values or limits.
Omit optional properties when their values are unknown.
If no fields can be identified, return an empty fields array.

Required-field rules:
- For boolean checkbox fields, set "required" to false.
- For conditionally required fields, set "required" to false
  and express the condition using "requiredWhen".
- Use "required": true only for unconditionally required,
  non-boolean fields.

Accuracy rules:
- Preserve confirmed facts.
- Clearly distinguish confirmed requirements from unresolved ones.
- Do not describe a confirmed value as missing or unconfirmed.

The example below demonstrates the output structure only.
Do not copy its fields or limits unless the document supports them.
{
  "title": "Test request",
  "description": "Information required for component testing.",
  "fields": [
    {
      "id": "sampleId",
      "label": "Sample ID",
      "type": "text",
      "required": true
    }
  ]
}`;
    try {
        const text = pages
            .map((p) => `Page ${p.pageNumber}:\n${p.text}`)
            .join("\n\n");

        const client = new Anthropic({
            apiKey: process.env["ANTHROPIC_API_KEY"] // This is the default and can be omitted
        });

        const message = await client.messages.create({
            model: process.env["ANTHROPIC_MODEL"] as string,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: text }],
            output_config: {
                format: zodOutputFormat(extractionSchema),
            },
        });

    if (message.stop_reason === "refusal") {
        throw new ExtractionError("Claude declined to extract a form from this document.");
    }
    if (message.stop_reason === "max_tokens") {
        throw new ExtractionError("Claude response was cut off before the form was complete.");
    }
    if (message.stop_reason !== "end_turn") {
        throw new ExtractionError("Claude could not complete the form extraction.");
    }

    const llmRes = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

    if (!llmRes.trim()) {
        throw new ExtractionError("Claude returned no form text.");
    }

    try {
        return JSON.parse(llmRes) as unknown;
    } catch {
        throw new ExtractionError("Claude returned invalid JSON instead of a form.");
    }
} catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
            throw new ExtractionError("Claude is rate-limited or unavailable due to usage limits. Please try again later.", 503);
        }
        if (error.status === 401 || error.status === 403) {
            throw new ExtractionError("The server could not authenticate with Claude. Check the server API configuration.", 503);
        }
        throw new ExtractionError("The request to Claude failed. Please try again later.");
    }
    // Preserve unexpected failures for the server's generic JSON error handler.
    throw error;
}



}
