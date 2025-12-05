/**
 * Anthropic Claude API client for LLM-powered code generation
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Logger } from "../utils/logger.js";

export interface QueryOptions<S extends z.ZodTypeAny> {
	message: string;
	schema: S;
	apiKey?: string;
	logger?: Logger;
}

/**
 * Query Claude with a message and validate response against a Zod schema
 */
export async function query<S extends z.ZodTypeAny>(
	options: QueryOptions<S>,
): Promise<z.infer<S>> {
	const { message, schema, apiKey, logger } = options;

	// Use provided API key or fallback to placeholder
	const actualApiKey =
		apiKey || process.env.ANTHROPIC_API_KEY || "PLACEHOLDER_API_KEY";

	if (actualApiKey === "PLACEHOLDER_API_KEY") {
		logger?.warn(
			"Using placeholder API key - LLM calls will fail until real key is provided",
		);
	}

	logger?.debugLog("Querying Claude API", {
		messageLength: message.length,
		schemaName: schema._def.typeName,
	});

	// Initialize Anthropic client
	const anthropic = new Anthropic({
		apiKey: actualApiKey,
	});

	try {
		// Call Claude API with structured output
		const response = await anthropic.messages.create({
			model: "claude-sonnet-4-20250514", // Latest Claude Sonnet
			max_tokens: 8000,
			temperature: 0.2, // Low temperature for more deterministic code generation
			system:
				"You are a helpful assistant that always responds with valid JSON. Never include explanatory text outside the JSON object.",
			messages: [
				{
					role: "user",
					content: `${message}\n\nIMPORTANT: Respond with ONLY a valid JSON object, no other text.`,
				},
			],
		});

		// Extract text content from response
		const textContent = response.content
			.filter((block) => block.type === "text")
			.map((block) => (block as any).text)
			.join("\n");

		logger?.debugLog("Received response from Claude", {
			responseLength: textContent.length,
			stopReason: response.stop_reason,
		});

		// Try to parse as JSON if schema expects an object
		let parsedData: any;
		try {
			// First try to parse directly
			parsedData = JSON.parse(textContent);
		} catch {
			// If that fails, try to extract JSON from markdown code blocks
			const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) {
				try {
					parsedData = JSON.parse(jsonMatch[1]);
				} catch {
					// If still fails, treat as raw text
					parsedData = { content: textContent };
				}
			} else {
				// If not JSON and no code blocks, treat as raw text
				parsedData = { content: textContent };
			}
		}

		// Validate against schema
		const validation = schema.safeParse(parsedData);

		if (!validation.success) {
			logger?.error("Schema validation failed");
			logger?.debugLog("Validation errors", validation.error.errors);
			logger?.debugLog(
				"Raw response from Claude",
				textContent.substring(0, 500),
			);
			throw new Error(
				`Invalid response from Claude: ${JSON.stringify(validation.error.errors)}`,
			);
		}

		return validation.data;
	} catch (error: any) {
		// Handle rate limiting
		if (error.status === 429) {
			throw new Error("Rate limit exceeded. Please try again later.");
		}

		// Handle authentication errors
		if (error.status === 401) {
			throw new Error(
				"Invalid Anthropic API key. Please set ANTHROPIC_API_KEY environment variable.",
			);
		}

		logger?.error(`Claude API error: ${error.message}`);
		throw error;
	}
}

/**
 * Helper to extract files list from Claude response
 */
export const FilesListSchema = z.object({
	files: z
		.array(z.string())
		.describe("List of file paths that need modification"),
	reasoning: z
		.string()
		.optional()
		.describe("Optional reasoning for why these files were selected"),
});

/**
 * Helper to extract file content from Claude response
 */
export const FileContentSchema = z.object({
	newContent: z.string().describe("The complete updated file content"),
	skipFile: z
		.boolean()
		.optional()
		.describe("Set to true if this file does not need changes"),
	reasoning: z
		.string()
		.optional()
		.describe("Optional reasoning for the changes made"),
});
