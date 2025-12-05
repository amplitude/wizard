/**
 * Editor rules generation for AI assistants (Cursor, Claude Code)
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import type { Logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create .cursor/rules directory and add Amplitude integration rules
 */
export async function createCursorRules(
	installDir: string,
	logger: Logger,
): Promise<void> {
	try {
		const cursorRulesDir = path.join(installDir, ".cursor", "rules");
		await fs.mkdir(cursorRulesDir, { recursive: true });

		// Read template
		const templatePath = path.join(
			__dirname,
			"templates",
			"amplitude-rules.md",
		);
		const template = await fs.readFile(templatePath, "utf8");

		// Write to .cursor/rules
		const rulesPath = path.join(cursorRulesDir, "amplitude-integration.mdc");
		await fs.writeFile(rulesPath, template, "utf8");

		await logger.success("Created .cursor/rules/amplitude-integration.mdc");
	} catch (error: any) {
		await logger.warn(`Failed to create Cursor rules: ${error.message}`);
	}
}

/**
 * Create .claude directory and add Amplitude integration rules
 */
export async function createClaudeRules(
	installDir: string,
	logger: Logger,
): Promise<void> {
	try {
		const claudeDir = path.join(installDir, ".claude");
		await fs.mkdir(claudeDir, { recursive: true });

		// Read template
		const templatePath = path.join(
			__dirname,
			"templates",
			"amplitude-rules.md",
		);
		const template = await fs.readFile(templatePath, "utf8");

		// Write to .claude directory
		const rulesPath = path.join(claudeDir, "amplitude-integration.md");
		await fs.writeFile(rulesPath, template, "utf8");

		await logger.success("Created .claude/amplitude-integration.md");
	} catch (error: any) {
		await logger.warn(`Failed to create Claude rules: ${error.message}`);
	}
}

/**
 * Create editor rules for all supported AI assistants
 */
export async function createEditorRules(
	installDir: string,
	logger: Logger,
): Promise<void> {
	await logger.section("🤖 Setting up AI Assistant Guidelines");

	await Promise.all([
		createCursorRules(installDir, logger),
		createClaudeRules(installDir, logger),
	]);

	await logger.info(
		"AI assistants in this project will now follow Amplitude SDK best practices",
	);
}
