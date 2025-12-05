/**
 * Logger utility with colored output and progressive display
 */
import chalk from "chalk";

/**
 * Small delay to make output easier to follow visually
 */
async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Logger {
	private debug: boolean;

	constructor(debug = false) {
		this.debug = debug;
	}

	async info(message: string): Promise<void> {
		await delay(60);
		console.log(chalk.blue("ℹ"), message);
	}

	async success(message: string): Promise<void> {
		await delay(80);
		console.log(chalk.green("✓"), message);
	}

	async error(message: string): Promise<void> {
		await delay(80);
		console.log(chalk.red("✗"), message);
	}

	async warn(message: string): Promise<void> {
		await delay(80);
		console.log(chalk.yellow("⚠"), message);
	}

	// biome-ignore lint/suspicious/noExplicitAny: typing is not important here
	async debugLog(message: string, data?: any): Promise<void> {
		if (this.debug) {
			await delay(40);
			console.log(chalk.gray("[DEBUG]"), message);
			if (data) {
				console.log(chalk.gray(JSON.stringify(data, null, 2)));
			}
		}
	}

	async section(title: string): Promise<void> {
		await delay(150);
		console.log(`\n${chalk.bold.cyan(title)}`);
		console.log(chalk.cyan("─".repeat(title.length)));
		await delay(50);
	}

	async step(message: string): Promise<void> {
		await delay(60);
		console.log(chalk.cyan("→"), message);
	}

	async code(code: string): Promise<void> {
		await delay(40);
		console.log(chalk.gray(code));
	}

	async newLine(): Promise<void> {
		await delay(30);
		console.log();
	}

	/**
	 * Print multiple lines progressively with delays
	 */
	async progressive(...lines: string[]): Promise<void> {
		for (const line of lines) {
			await delay(60);
			console.log(line);
		}
	}
}
