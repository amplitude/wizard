#!/usr/bin/env node
/**
 * Reads the version from package.json and patches it into src/lib/constants.ts.
 * Runs as a prebuild step so the hardcoded VERSION always matches package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const constantsPath = join(root, 'src', 'lib', 'constants.ts');
const src = readFileSync(constantsPath, 'utf8');
const updated = src.replace(
  /const VERSION = '[^']*';/,
  `const VERSION = '${version}';`,
);

if (src !== updated) {
  writeFileSync(constantsPath, updated);
  console.log(`synced VERSION → ${version}`);
} else {
  console.log(`VERSION already ${version}`);
}
