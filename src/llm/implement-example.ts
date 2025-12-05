/**
 * LLM-powered implementation of Amplitude examples into user files
 */
import { query, FileContentSchema } from './client.js';
import { readFile } from '../utils/file.js';
import type { Logger } from '../utils/logger.js';
import chalk from 'chalk';
import path from 'path';
import { promises as fs } from 'fs';

export interface ImplementExampleOptions {
  installDir: string;
  filePath: string;
  exampleType: 'events' | 'flags';
  flagName?: string;
  isTypeScript: boolean;
  anthropicApiKey?: string;
  logger: Logger;
}

/**
 * Create prompt for implementing example code
 */
function createImplementPrompt(options: {
  fileContent: string;
  filePath: string;
  exampleType: 'events' | 'flags';
  flagName?: string;
  isTypeScript: boolean;
}): string {
  const { fileContent, filePath, exampleType, flagName, isTypeScript } = options;
  const lang = isTypeScript ? 'TypeScript' : 'JavaScript';

  let instructions = '';

  if (exampleType === 'events') {
    instructions = `Add Amplitude event tracking to this ${lang} file.

INSTRUCTIONS:
1. Import the analytics function from '@amplitude/unified' at the top
2. Add a track() call in an appropriate place where a user action occurs
3. Use descriptive event names that follow best practices (e.g., "Button Clicked", "Form Submitted")
4. Include relevant properties that describe the context
5. Handle optional chaining properly: analytics()?.track()
6. Do NOT modify existing imports if '@amplitude/unified' is already imported
7. Choose a meaningful location for the tracking call based on the file's purpose
8. If this is a React component, add tracking to event handlers
9. Keep the implementation minimal and idiomatic

EXAMPLE:
\`\`\`${lang.toLowerCase()}
import { analytics } from '@amplitude/unified'

function handleSubmit() {
  analytics()?.track('Form Submitted', {
    formType: 'checkout',
    page: 'payment'
  })
  // ... rest of logic
}
\`\`\``;
  } else {
    const flagNameToUse = flagName || 'placeholder-flag';
    instructions = `Add Amplitude feature flag checking to this ${lang} file.

INSTRUCTIONS:
1. Import the experiment function from '@amplitude/unified' at the top
2. Add feature flag check using: experiment()?.variant('${flagNameToUse}')
3. Fetch flags before checking: await experiment()?.fetch()
4. Handle undefined states with optional chaining
5. Use conditional logic based on variant.value === 'on' or 'off'
6. Do NOT modify existing imports if '@amplitude/unified' is already imported
7. Choose a meaningful location for the flag check based on the file's purpose
8. If this is a React component, consider using useEffect for fetching
9. Keep the implementation minimal and idiomatic
${flagName ? '' : '10. NOTE: The flag name is a placeholder - developer should update it'}

EXAMPLE:
\`\`\`${lang.toLowerCase()}
import { experiment } from '@amplitude/unified'

async function loadFeature() {
  await experiment()?.fetch()
  const variant = experiment()?.variant('${flagNameToUse}')

  if (variant?.value === 'on') {
    // New feature enabled
  } else {
    // Old behavior
  }
}
\`\`\``;
  }

  return `You are helping a developer integrate Amplitude SDK into their codebase.

FILE PATH: ${filePath}
LANGUAGE: ${lang}

CURRENT FILE CONTENT:
\`\`\`
${fileContent}
\`\`\`

${instructions}

RESPONSE FORMAT:
You must respond with a JSON object in this exact format:
{
  "newContent": "the complete modified file content as a string",
  "reasoning": "brief explanation of changes made (optional)"
}

IMPORTANT:
- Return the COMPLETE modified file content in the "newContent" field
- Include ALL original code plus your additions
- Make minimal changes - only add what's necessary for the example
- Preserve all existing code structure, formatting, and logic
- Do not include markdown code fences in the newContent - just the raw file content`;
}

/**
 * Generate a simple diff representation
 */
function generateDiff(oldContent: string, newContent: string): string[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff: string[] = [];

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      // Same line
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      // Added line
      diff.push(chalk.green(`+ ${newLines[j]}`));
      j++;
    } else if (i < oldLines.length) {
      // Removed line
      diff.push(chalk.red(`- ${oldLines[i]}`));
      i++;
    }
  }

  return diff;
}

/**
 * Implement example code into a file using LLM
 */
export async function implementExample(
  options: ImplementExampleOptions,
): Promise<{ success: boolean; diff?: string[] }> {
  const { installDir, filePath, exampleType, flagName, isTypeScript, anthropicApiKey, logger } = options;

  try {
    // Read the current file
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(installDir, filePath);
    const oldContent = await readFile(installDir, filePath);

    // Create prompt
    const prompt = createImplementPrompt({
      fileContent: oldContent,
      filePath,
      exampleType,
      flagName,
      isTypeScript,
    });

    // Query LLM
    logger.debugLog('Calling Amplitude Wizard to implement example...');
    const response = await query({
      message: prompt,
      schema: FileContentSchema,
      apiKey: anthropicApiKey,
      logger,
    });

    if (response.skipFile) {
      logger.warn('Amplitude Wizard decided not to modify this file');
      if (response.reasoning) {
        logger.debugLog('Reasoning:', response.reasoning);
      }
      return { success: false };
    }

    // Check if content actually changed
    if (response.newContent === oldContent) {
      logger.info('No changes needed');
      return { success: false };
    }

    // Generate diff
    const diff = generateDiff(oldContent, response.newContent);

    // Write the new content
    await fs.writeFile(absolutePath, response.newContent, 'utf8');

    return { success: true, diff };
  } catch (error: any) {
    logger.error(`Failed to implement example: ${error.message}`);
    return { success: false };
  }
}
