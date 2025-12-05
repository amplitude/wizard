/**
 * Core code modification logic using LLM
 * Implements the two-phase approach: filter files, then generate content
 */
import {
  getAllFilesInProject,
  readFile,
  applyFileChange,
  getFilesMatchingPatterns,
} from '../utils/file.js';
import { query, FilesListSchema, FileContentSchema } from './client.js';
import {
  createFilterFilesPrompt,
  createGenerateFilePrompt,
} from './prompts/base.js';
import type { FileChange, WizardOptions, FrameworkConfig } from '../types/index.js';
import type { Logger } from '../utils/logger.js';
import ora from 'ora';

export interface CodemodOptions {
  installDir: string;
  frameworkConfig: FrameworkConfig;
  documentation: string;
  anthropicApiKey?: string;
  logger: Logger;
  dryRun?: boolean;
}

/**
 * Phase 1: Use LLM to filter which files need modification
 */
async function filterFilesWithLLM(
  options: CodemodOptions,
): Promise<string[]> {
  const { installDir, frameworkConfig, documentation, anthropicApiKey, logger } = options;

  const spinner = ora('Analyzing project files...').start();

  try {
    // Get relevant files using framework-specific patterns
    const relevantFiles = await getFilesMatchingPatterns(
      installDir,
      frameworkConfig.filterPatterns,
      frameworkConfig.ignorePatterns || [],
    );

    logger.debugLog(`Found ${relevantFiles.length} relevant files to analyze`);

    // Create prompt for LLM to filter files
    const prompt = createFilterFilesPrompt({
      documentation,
      fileList: relevantFiles.join('\n'),
      frameworkName: frameworkConfig.name,
      frameworkRules: frameworkConfig.filterFilesRules,
    });

    // Query LLM
    const response = await query({
      message: prompt,
      schema: FilesListSchema,
      apiKey: anthropicApiKey,
      logger,
    });

    spinner.succeed(`Identified ${response.files.length} files to modify`);

    if (response.reasoning) {
      logger.debugLog('LLM reasoning for file selection:', response.reasoning);
    }

    return response.files;
  } catch (error: any) {
    spinner.fail('Failed to analyze project files');
    throw error;
  }
}

/**
 * Phase 2: Generate complete file content for each file sequentially
 */
async function generateFileChanges(
  filesToChange: string[],
  options: CodemodOptions,
): Promise<FileChange[]> {
  const { installDir, frameworkConfig, documentation, anthropicApiKey, logger } = options;
  const changes: FileChange[] = [];

  for (let i = 0; i < filesToChange.length; i++) {
    const filePath = filesToChange[i];
    const spinner = ora(`Processing ${filePath} (${i + 1}/${filesToChange.length})...`).start();

    try {
      // Read existing file content (if it exists)
      let oldContent: string | undefined;
      try {
        oldContent = await readFile(installDir, filePath);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, will be created
          oldContent = undefined;
        } else {
          throw error;
        }
      }

      // Build context: files already changed and files remaining
      const changedFilesContext = changes
        .map((change) => {
          return `FILE: ${change.filePath}\n${change.newContent}`;
        })
        .join('\n\n---\n\n');

      const unchangedFiles = filesToChange
        .slice(i + 1)
        .join('\n');

      // Create prompt for generating file content
      const prompt = createGenerateFilePrompt({
        fileContent: oldContent || '',
        filePath,
        documentation,
        frameworkName: frameworkConfig.name,
        frameworkRules: frameworkConfig.generateFilesRules,
        changedFiles: changedFilesContext,
        unchangedFiles,
      });

      // Query LLM for complete file content
      const response = await query({
        message: prompt,
        schema: FileContentSchema,
        apiKey: anthropicApiKey,
        logger,
      });

      // Skip if LLM says no changes needed
      if (response.skipFile) {
        spinner.info(`Skipped ${filePath} (no changes needed)`);
        if (response.reasoning) {
          logger.debugLog('Skip reasoning:', response.reasoning);
        }
        continue;
      }

      // Check if content actually changed
      if (response.newContent === oldContent) {
        spinner.info(`Skipped ${filePath} (no changes)`);
        continue;
      }

      // Track the change
      const change: FileChange = {
        filePath,
        oldContent,
        newContent: response.newContent,
      };

      changes.push(change);

      spinner.succeed(`Updated ${filePath}`);

      if (response.reasoning) {
        logger.debugLog('Change reasoning:', response.reasoning);
      }
    } catch (error: any) {
      spinner.fail(`Failed to process ${filePath}`);
      await logger.error(`Error: ${error.message}`);
      // Continue with other files
    }
  }

  return changes;
}

/**
 * Main function: Run the complete two-phase code modification flow
 */
export async function runCodemod(options: CodemodOptions): Promise<FileChange[]> {
  const { logger, dryRun } = options;

  // Phase 1: Filter files
  await logger.step('Phase 1: Identifying files to modify');
  const filesToChange = await filterFilesWithLLM(options);

  if (filesToChange.length === 0) {
    await logger.info('No files need modification');
    return [];
  }

  // Phase 2: Generate file changes
  await logger.step('Phase 2: Generating updated file content');
  const changes = await generateFileChanges(filesToChange, options);

  if (changes.length === 0) {
    await logger.info('No changes were made');
    return [];
  }

  // Apply changes
  if (!dryRun) {
    await logger.step('Applying changes...');
    for (const change of changes) {
      await applyFileChange(change, { installDir: options.installDir, dryRun });
    }
    await logger.success(`Applied ${changes.length} file changes`);
  } else {
    await logger.info(`[DRY RUN] Would apply ${changes.length} file changes`);
  }

  return changes;
}
