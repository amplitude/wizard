#!/usr/bin/env node

/**
 * Main entry point for Amplitude Wizard CLI
 */
const startTime = performance.now();

if (process.env.DEBUG) {
  console.log(`[DEBUG] Starting CLI... (${(performance.now() - startTime).toFixed(2)}ms)`);
}

import { createCLI } from './cli.js';

if (process.env.DEBUG) {
  console.log(`[DEBUG] Loaded CLI module (${(performance.now() - startTime).toFixed(2)}ms)`);
}

async function main() {
  try {
    const program = await createCLI();
    if (process.env.DEBUG) {
      console.log(`[DEBUG] Created CLI program (${(performance.now() - startTime).toFixed(2)}ms)`);
    }
    await program.parseAsync(process.argv);
  } catch (error: any) {
    console.error('Fatal error:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
