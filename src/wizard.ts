/**
 * Main wizard orchestration - coordinates the entire Amplitude SDK installation
 */
import chalk from "chalk";
import { execSync } from "child_process";
import { detectProject } from "./detectors/framework.js";
import { installAmplitudeSDK } from "./installers/unified-sdk.js";
import { updateEnvFile, updateGitignore } from "./utils/file.js";
import { runCodemod } from "./llm/codemod.js";
import { createEditorRules } from "./rules/index.js";
import { getFrameworkConfig } from "./config/frameworks.js";
import { Logger } from "./utils/logger.js";
import type { WizardOptions, Framework } from "./types/index.js";
import ora from "ora";

/**
 * Check if in git repo and warn if uncommitted changes
 */
async function checkGitSafety(
	options: WizardOptions,
	logger: Logger,
): Promise<void> {
	if (options.default) return; // Skip in non-interactive mode

	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: options.installDir,
			stdio: "pipe",
		});

		// Check for uncommitted changes
		const status = execSync("git status --porcelain", {
			cwd: options.installDir,
			encoding: "utf8",
		});

		if (status.trim().length > 0) {
			await logger.warn(
				"You have uncommitted changes. It's recommended to commit or stash them first.",
			);
			const continueAnyway = await lazyConfirm({
				message: "Do you want to continue anyway?",
				default: true,
			});

			if (!continueAnyway) {
				await logger.info(
					"Installation cancelled. Commit your changes and try again.",
				);
				process.exit(0);
			}
		}
	} catch {
		// Not in a git repo
		await logger.warn(
			"You are not inside a git repository. Changes will not be tracked.",
		);
		const continueAnyway = await lazyConfirm({
			message: "Do you want to continue anyway?",
			default: true,
		});

		if (!continueAnyway) {
			await logger.info(
				"Installation cancelled. Initialize a git repository and try again.",
			);
			process.exit(0);
		}
	}
}

/**
 * Lazy-load helper functions for interactive prompts
 */
async function lazyConfirm(options: { message: string; default?: boolean }): Promise<boolean> {
	const { confirm } = await import("@inquirer/prompts");
	return confirm(options);
}

async function lazyInput(options: { message: string; default?: string; validate?: (value: string) => boolean | string }): Promise<string> {
	const { input } = await import("@inquirer/prompts");
	return input(options);
}

async function lazySelect<T extends string>(options: { message: string; choices: Array<{ name: string; value: T }> }): Promise<T> {
	const { select } = await import("@inquirer/prompts");
	return select(options);
}

async function lazySearch<T>(options: { message: string; source: (term: string | undefined) => Promise<Array<{ name: string; value: T; description?: string }>> }): Promise<T> {
	const search = (await import("@inquirer/search")).default;
	return search(options);
}

/**
 * Get user consent for AI code modification
 */
async function getAIConsent(
	options: WizardOptions,
	logger: Logger,
): Promise<void> {
	if (options.default) return; // Skip in non-interactive mode

	await logger.newLine();
	await logger.progressive(
		chalk.cyan(
			"✨ Amplitude Wizard uses AI to intelligently modify your code.",
		),
		chalk.gray(
			"   It will analyze your project and add Amplitude SDK related code and configuration.",
		),
	);
	await logger.newLine();

	const consent = await lazyConfirm({
		message: "Are you happy to continue with Amplitude Wizard assistance?",
		default: true,
	});

	if (!consent) {
		await logger.info(
			"Installation cancelled. You can manually integrate Amplitude SDK.",
		);
		await logger.info("Visit: https://amplitude.com/docs");
		process.exit(0);
	}
}

/**
 * Prompt user for API keys (interactive mode only)
 */
async function promptForKeys(
	options: WizardOptions,
): Promise<{ apiKey: string; deploymentKey?: string }> {
	if (options.default) {
		// Non-interactive mode: use provided keys or fail
		if (!options.apiKey) {
			throw new Error(
				"API key is required in non-interactive mode. Use --api-key flag.",
			);
		}
		return {
			apiKey: options.apiKey,
			deploymentKey: options.deploymentKey,
		};
	}

	// Show instructions for finding keys
	console.log(chalk.gray("\nTo find your API keys:"));
	console.log(
		chalk.gray(
			"  Organization Settings → Projects → Choose yours → Show API Key\n",
		),
	);

	// Interactive mode: ask user
	const apiKey = await lazyInput({
		message: "Enter your Amplitude API Key:",
		default: options.apiKey,
		validate: (value: string) => value.length > 0 || "API key is required",
	});

	const deploymentKey = await lazyInput({
		message:
			"Enter your Amplitude Deployment Key (optional, press Enter to skip):",
		default: options.deploymentKey || "",
	});

	return {
		apiKey,
		deploymentKey: deploymentKey || undefined,
	};
}

/**
 * Display welcome message
 */
async function displayWelcome(logger: Logger): Promise<void> {
	await logger.newLine();
	await logger.progressive(
		chalk.bold.cyan("╔════════════════════════════════════════════════╗"),
		chalk.bold.cyan("║                                                ║"),
		chalk.bold.cyan("║      Amplitude Unified SDK Wizard 🧙           ║"),
		chalk.bold.cyan("║      AI-Powered Integration Assistant          ║"),
		chalk.bold.cyan("║                                                ║"),
		chalk.bold.cyan("╚════════════════════════════════════════════════╝"),
	);
	await logger.newLine();
}

/**
 * Get all source files from the project
 */
async function getAllSourceFiles(installDir: string): Promise<string[]> {
	try {
		const fg = (await import("fast-glob")).default;
		const files = await fg(
			[
				"**/*.{ts,tsx,js,jsx}",
				"!node_modules",
				"!dist",
				"!build",
				"!coverage",
				"!.next",
				"!.cache",
			],
			{
				cwd: installDir,
				dot: false,
			},
		);
		return files;
	} catch (error: any) {
		return [];
	}
}

/**
 * Select a target file for implementation with search/autocomplete
 */
async function selectTargetFile(
	installDir: string,
	logger: Logger,
): Promise<string | null> {
	const allFiles = await getAllSourceFiles(installDir);

	if (allFiles.length === 0) {
		await logger.warn("No source files found in project");
		return null;
	}

	await logger.newLine();
	await logger.progressive(
		chalk.gray("Type to search and filter files, or paste a path..."),
	);
	await logger.newLine();

	const selectedFile = await lazySearch({
		message: "Select file to add implementation:",
		source: async (term) => {
			if (!term) {
				// Show recent files when no search term
				return allFiles.slice(0, 20).map((file) => ({
					name: file,
					value: file,
					description: undefined,
				}));
			}

			// Filter files based on search term
			const filtered = allFiles.filter((file) =>
				file.toLowerCase().includes(term.toLowerCase()),
			);

			return filtered.slice(0, 20).map((file) => ({
				name: file,
				value: file,
				description: undefined,
			}));
		},
	});

	return selectedFile || null;
}

/**
 * Handle example selection and implementation
 */
async function handleExampleSelection(
	exampleType: string,
	options: WizardOptions,
	logger: Logger,
	project: any,
): Promise<void> {
	const isTypeScript = project.hasTypeScript;
	const lang = isTypeScript ? "typescript" : "javascript";

	let exampleCode = "";
	let explanation = "";

	if (exampleType === "events") {
		explanation = "Track user actions with custom properties:";
		exampleCode = isTypeScript
			? `import { analytics } from '@amplitude/unified'

// Track a button click
analytics()?.track('Button Clicked', {
  buttonName: 'submit',
  page: 'checkout'
})

// Identify a user
analytics()?.identify(userId, {
  email: user.email,
  plan: 'pro'
})`
			: `import { analytics } from '@amplitude/unified'

// Track a button click
analytics()?.track('Button Clicked', {
  buttonName: 'submit',
  page: 'checkout'
})

// Identify a user
analytics()?.identify(userId, {
  email: user.email,
  plan: 'pro'
})`;
	} else if (exampleType === "flags") {
		explanation = "Check feature flags to control feature rollout:";
		exampleCode = isTypeScript
			? `import { experiment } from '@amplitude/unified'

// Fetch latest feature flags
await experiment()?.fetch()

// Check a feature flag
const variant = experiment()?.variant('new-checkout-flow')

if (variant?.value === 'on') {
  // Show new checkout flow
} else {
  // Show old checkout flow
}`
			: `import { experiment } from '@amplitude/unified'

// Fetch latest feature flags
await experiment()?.fetch()

// Check a feature flag
const variant = experiment()?.variant('new-checkout-flow')

if (variant?.value === 'on') {
  // Show new checkout flow
} else {
  // Show old checkout flow
}`;
	}

	// Display the example
	await logger.newLine();
	await logger.progressive(chalk.cyan(explanation));
	await logger.newLine();
	await logger.code(exampleCode);
	await logger.newLine();

	// Ask what to do
	const action = await lazySelect({
		message: "What would you like to do?",
		choices: [
			{ name: "Have AI implement this", value: "implement" },
			{ name: "Go Back", value: "back" },
		],
	});

	if (action === "back") {
		// Go back to the main menu
		await displayInteractiveMenu(options, logger, project);
		return;
	}

	if (action === "implement") {
		// Select target file
		const targetFile = await selectTargetFile(options.installDir, logger);

		if (!targetFile) {
			// User cancelled, go back
			await displayInteractiveMenu(options, logger, project);
			return;
		}

		// Ask for flag name if implementing feature flags
		let flagName: string | undefined;
		if (exampleType === "flags") {
			await logger.newLine();
			flagName = await lazyInput({
				message:
					"Enter feature flag name (or press Enter to use 'placeholder'):",
				default: "placeholder",
			});

			if (flagName === "placeholder") {
				await logger.info(
					"Using 'placeholder' - remember to update this to your actual flag name!",
				);
			}
		}

		// Implement with LLM
		const spinner = ora(
			`Amplitude Wizard is implementing in ${targetFile}...`,
		).start();

		// Lazy-load implementExample
		const { implementExample } = await import("./llm/implement-example.js");

		const result = await implementExample({
			installDir: options.installDir,
			filePath: targetFile,
			exampleType: exampleType as "events" | "flags",
			flagName,
			isTypeScript,
			anthropicApiKey: options.anthropicApiKey,
			logger,
		});

		if (!result.success) {
			spinner.fail("Failed to implement example");
			await logger.newLine();
			await displayInteractiveMenu(options, logger, project);
			return;
		}

		spinner.succeed(`Successfully implemented in ${targetFile}`);

		// Show diff
		if (result.diff && result.diff.length > 0) {
			await logger.newLine();
			await logger.section("Changes Made:");
			await logger.progressive(chalk.gray(`File: ${targetFile}`));
			await logger.newLine();

			// Show first 20 lines of diff progressively
			const diffToShow = result.diff.slice(0, 20);
			await logger.progressive(...diffToShow);

			if (result.diff.length > 20) {
				await logger.progressive(
					chalk.gray(`\n... and ${result.diff.length - 20} more changes`),
				);
			}
		}

		await logger.newLine();
		await logger.success("Example code has been added!");
		await logger.info(
			"Review the changes and adjust as needed for your use case.",
		);
		await logger.newLine();

		// Go back to main menu
		await displayInteractiveMenu(options, logger, project);
	}
}

/**
 * Handle MCP installation to IDEs
 */
async function handleMCPInstallation(
	options: WizardOptions,
	logger: Logger,
): Promise<void> {
	await logger.newLine();
	await logger.section("🔗 Amplitude MCP Setup");

	// Lazy-load MCP utilities
	const {
		getSupportedClients,
		isAmplitudeMCPConfigured,
		addAmplitudeMCPToIDE,
	} = await import("./utils/mcp.js");
	const { checkbox } = await import("@inquirer/prompts");

	// Get all supported clients
	const supportedClients = getSupportedClients();

	if (supportedClients.length === 0) {
		await logger.error("No supported IDEs found (Cursor or VSCode)");
		await logger.info(
			"Amplitude MCP requires Cursor (macOS/Windows) or VSCode (all platforms)",
		);
		await logger.newLine();
		await displayInteractiveMenu(options, logger, null);
		return;
	}

	// Check which clients already have Amplitude MCP configured
	const clientStatus = await Promise.all(
		supportedClients.map(async (client) => ({
			client,
			isConfigured: await isAmplitudeMCPConfigured(client.configPath),
		})),
	);

	// Check if all are already configured
	const allConfigured = clientStatus.every((status) => status.isConfigured);
	if (allConfigured) {
		await logger.success("✓ Amplitude MCP is already configured for all detected IDEs!");
		await logger.newLine();
		await logger.progressive(
			chalk.cyan("📚 Documentation:"),
			chalk.gray("  https://amplitude.com/docs/analytics/amplitude-mcp"),
		);
		await logger.newLine();
		await displayInteractiveMenu(options, logger, null);
		return;
	}

	// Show multi-select for IDEs
	await logger.info("Select which IDEs to configure Amplitude MCP for:");
	await logger.newLine();

	const selectedIDEs = await checkbox({
		message: "Select IDEs (Space to toggle, Enter to confirm):",
		choices: clientStatus.map(({ client, isConfigured }) => ({
			name: isConfigured ? `✓ ${client.name}` : client.name,
			value: client.name,
			checked: !isConfigured, // Only check unconfigured ones by default
			disabled: isConfigured ? "already installed" : false,
		})),
	});

	if (selectedIDEs.length === 0) {
		await logger.info("No IDEs selected. Returning to menu.");
		await logger.newLine();
		await displayInteractiveMenu(options, logger, null);
		return;
	}

	// Ask if using EU region
	const { confirm } = await import("@inquirer/prompts");
	const isEU = await confirm({
		message: "Are you using Amplitude EU?",
		default: false,
	});

	await logger.newLine();

	// Install to selected IDEs
	let installedCount = 0;

	for (const { client, isConfigured } of clientStatus) {
		if (!selectedIDEs.includes(client.name)) {
			continue;
		}

		try {
			// Add MCP configuration
			await addAmplitudeMCPToIDE(client, isEU, logger);
			await logger.success(`✓ Configured Amplitude MCP for ${client.name}`);
			installedCount++;
		} catch (error: any) {
			await logger.error(`Failed to configure ${client.name}: ${error.message}`);
		}
	}

	await logger.newLine();

	if (installedCount > 0) {
		await logger.success(
			`Successfully configured Amplitude MCP for ${installedCount} IDE(s)`,
		);
		await logger.newLine();
		await logger.info("Next steps:");
		await logger.info("1. Restart your IDE(s) to load the MCP configuration");
		await logger.info("2. Authenticate with Amplitude when prompted");
		await logger.newLine();
		await logger.progressive(
			chalk.cyan("📚 Documentation:"),
			chalk.gray("  https://amplitude.com/docs/analytics/amplitude-mcp"),
		);
	} else {
		await logger.info("No IDEs were configured.");
	}

	await logger.newLine();
	await displayInteractiveMenu(options, logger, null);
}

/**
 * Display interactive menu for next steps
 */
async function displayInteractiveMenu(
	options: WizardOptions,
	logger: Logger,
	project: any,
): Promise<void> {
	await logger.newLine();

	// Detect project if not provided (e.g., when called from MCP installation)
	if (!project) {
		project = await detectProject(options.installDir);
	}

	// Interactive menu
	const choices: Array<{ name: string; value: string }> = [
		{ name: "Track an event", value: "events" },
		{ name: "Check a Feature Flag", value: "flags" },
		{ name: "Add Amplitude MCP to your IDE(s)", value: "mcp" },
		{ name: "Exit", value: "done" },
	];

	const selection = await lazySelect({
		message: "What would you like assistance with next?",
		choices,
	});

	if (selection === "done") {
		await logger.newLine();
		await logger.progressive(
			chalk.cyan("📚 Documentation:"),
			chalk.gray("  https://amplitude.com/docs/sdks/unified-sdk"),
		);
		await logger.newLine();
		return;
	}

	// Handle MCP installation
	if (selection === "mcp") {
		await handleMCPInstallation(options, logger);
		return;
	}

	// Check for deployment key FIRST if they selected feature flags
	if (selection === "flags" && !options.deploymentKey) {
		await logger.newLine();
		await logger.progressive(
			chalk.gray("To use feature flags, you need a Deployment Key."),
			chalk.gray(
				"Find it at: Organization Settings → Projects → Choose yours → Deployments",
			),
		);
		await logger.newLine();

		const deploymentKey = await lazyInput({
			message:
				"Enter your Amplitude Deployment Key (or press ENTER to go back):",
			default: "",
		});

		// If user pressed ENTER without entering a key, go back to menu
		if (!deploymentKey || deploymentKey.trim().length === 0) {
			await displayInteractiveMenu(options, logger, project);
			return;
		}

		options.deploymentKey = deploymentKey;
		await logger.success("Deployment key saved!");
		await logger.newLine();
	}

	// Handle example selection
	await handleExampleSelection(selection, options, logger, project);
}

/**
 * Display completion message with interactive next steps
 */
async function displayCompletion(
	options: WizardOptions,
	logger: Logger,
	project: any,
): Promise<void> {
	const deploymentKey = options.deploymentKey;

	await logger.newLine();
	await logger.success("✓ Installation Complete");
	await logger.newLine();

	await logger.progressive(
		chalk.bold.green("✓ Package @amplitude/unified installed"),
		chalk.bold.green("✓ Code modified with SDK initialization"),
		chalk.bold.green("✓ Environment variables configured (.env.local)"),
		chalk.bold.green("✓ AI assistant guidelines added"),
	);

	await logger.newLine();
	await logger.section("🪜  Next Steps");

	const nextSteps = [
		chalk.gray(
			"• Start your application and verify Amplitude SDK is initialized",
		),
		chalk.gray("• Track events on user interactions"),
	];

	if (deploymentKey) {
		nextSteps.push(chalk.gray("• Use feature flags to control rollouts"));
	}

	nextSteps.push(
		chalk.gray("• Check .cursor/rules or .claude for AI assistant guidelines"),
	);

	await logger.progressive(...nextSteps);

	// Show interactive menu
	await displayInteractiveMenu(options, logger, project);
}

/**
 * Main wizard function
 */
export async function runWizard(options: WizardOptions): Promise<void> {
	const logger = new Logger(options.debug);

	try {
		// Display welcome (skip in non-interactive mode)
		if (!options.default) {
			await displayWelcome(logger);
		}

		// Step 0a: Check git safety
		await checkGitSafety(options, logger);

		// Step 0b: Get AI consent
		await getAIConsent(options, logger);

		// Step 1: Detect project
		await logger.section("🔬 Detecting Project Configuration");
		const project = await detectProject(options.installDir);

		if (project.framework === "unknown") {
			await logger.newLine();
			await logger.error("Could not detect a supported framework.");
			await logger.info("Currently supported: React (Vite, CRA)");
			await logger.newLine();
			await logger.progressive(
				chalk.cyan("📚 For other frameworks and manual integration:"),
				chalk.gray("  https://amplitude.com/docs/sdks"),
			);
			await logger.newLine();
			process.exit(1);
		}

		await logger.success(
			`Detected: ${getFrameworkConfig(project.framework).name}`,
		);
		await logger.info(`Package Manager: ${project.packageManager}`);
		await logger.info(`TypeScript: ${project.hasTypeScript ? "Yes" : "No"}`);
		await logger.info(`Likely Entry Point: ${project.entryPoint}`);

		// Step 2: Get API keys
		await logger.section("🔑 Amplitude Configuration");
		const { apiKey, deploymentKey } = await promptForKeys(options);

		// Update options with the keys for later use
		options.apiKey = apiKey;
		options.deploymentKey = deploymentKey;

		// Step 3: Get framework configuration and documentation
		const frameworkConfig = getFrameworkConfig(project.framework);
		const documentation = frameworkConfig.getDocumentation(project);

		// Step 4: Install package and modify code with LLM
		await logger.section("🔗 Installing SDK and Modifying Code");

		// Install the package first
		await installAmplitudeSDK(
			options.installDir,
			project.packageManager,
			logger,
		);

		// Then modify code
		const changes = await runCodemod({
			installDir: options.installDir,
			frameworkConfig,
			documentation,
			anthropicApiKey: options.anthropicApiKey,
			logger,
			dryRun: options.dryRun,
		});

		if (changes.length === 0 && !options.dryRun) {
			await logger.warn(
				"No code changes were made. You may need to manually integrate the SDK.",
			);
		}

		// Step 5: Update environment files
		if (!options.dryRun) {
			await logger.section("🔧 Configuring Environment");
			await updateEnvFile(
				options.installDir,
				apiKey,
				deploymentKey,
				project.envVarPrefix,
			);
			await logger.success("Created .env.local with API keys");

			await updateGitignore(options.installDir);
			await logger.success("Updated .gitignore");
		}

		// Step 6: Create AI assistant rules
		if (!options.dryRun) {
			await createEditorRules(options.installDir, logger);
		}

		// Step 7: Display completion message
		if (!options.default) {
			await displayCompletion(options, logger, project);
		} else {
			await logger.success(
				"Amplitude Unified SDK installation complete! Check .cursor/rules or .claude for guidelines.",
			);
		}
	} catch (error: any) {
		await logger.error("Installation failed");
		await logger.error(error.message);

		if (options.debug && error.stack) {
			await logger.debugLog("Stack trace:", error.stack);
		}

		process.exit(1);
	}
}
