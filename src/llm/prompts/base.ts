/**
 * Base LLM prompt templates for Amplitude SDK integration
 */

export interface FilterFilesPromptParams {
  documentation: string;
  fileList: string;
  frameworkName: string;
  frameworkRules: string;
}

export interface GenerateFilePromptParams {
  fileContent: string;
  filePath: string;
  documentation: string;
  frameworkName: string;
  frameworkRules: string;
  changedFiles: string;
  unchangedFiles: string;
}

/**
 * Prompt template for Phase 1: Filter which files need modification
 */
export function createFilterFilesPrompt(params: FilterFilesPromptParams): string {
  const { documentation, fileList, frameworkName, frameworkRules } = params;

  return `You are an Amplitude SDK installation wizard, an expert AI programming assistant that implements the Amplitude Unified SDK for ${frameworkName} projects.

Given the following list of file paths from a project, determine which files are likely to require modifications to integrate the Amplitude Unified SDK. Use the installation documentation as a reference for what files might need modifications.

IMPORTANT INSTRUCTIONS:
- If you would like to create a new file, include the file path in your response.
- If you would like to modify an existing file, include the file path in your response.
- Return files in the order you would like to process them, with new files first, followed by files to update.
- Only return files that will be required to integrate Amplitude SDK.
- Do not return files that are unlikely to require modification.
- If unsure, include the file (better to have more than less).
- If two files might include the content you need to edit, return both.
- If you create a new file, it should not conflict with any existing files.
- Follow the project's file structure and conventions.

${frameworkRules}

INSTALLATION DOCUMENTATION:
${documentation}

ALL FILES IN THE PROJECT:
${fileList}

Respond with a JSON object containing:
{
  "files": ["path/to/file1.tsx", "path/to/file2.ts", ...],
  "reasoning": "Brief explanation of file selection"
}`;
}

/**
 * Prompt template for Phase 2: Generate complete updated file content
 */
export function createGenerateFilePrompt(params: GenerateFilePromptParams): string {
  const {
    fileContent,
    filePath,
    documentation,
    frameworkName,
    frameworkRules,
    changedFiles,
    unchangedFiles,
  } = params;

  return `You are an Amplitude SDK installation wizard, an expert AI programming assistant that implements the Amplitude Unified SDK for ${frameworkName} projects.

Your task is to update the file to integrate the Amplitude Unified SDK according to the documentation.

CRITICAL RULES:
- Return the COMPLETE updated file content (not a diff or patch).
- Preserve existing code formatting and style.
- Only make changes required by the documentation.
- If no changes are needed, set skipFile to true.
- If the file is empty and should be created, add the complete new file contents.
- Follow the project's file structure (it may differ from documentation examples).
- Use relative imports if unsure about project import paths.
- It's okay to skip a file if changes have already been made elsewhere.
- Never hardcode API keys - always use environment variables.
- Use the environment variable prefix appropriate for this framework.

${frameworkRules}

CONTEXT:
---

Documentation for integrating Amplitude Unified SDK with ${frameworkName}:
${documentation}

The file you are updating:
${filePath}

${changedFiles ? `Files you have already modified:\n${changedFiles}\n` : ''}

${unchangedFiles ? `Files still to be processed:\n${unchangedFiles}\n` : ''}

Current file contents${fileContent ? ':' : ' (empty - new file):'}
${fileContent || '(This file will be created)'}

Respond with a JSON object containing:
{
  "newContent": "complete updated file content here",
  "skipFile": false,
  "reasoning": "Brief explanation of changes made"
}`;
}
