import { Given, When, Then, Before, After, DataTable } from '@cucumber/cucumber';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseAmpliConfig,
  readAmpliConfig,
  writeAmpliConfig,
  isConfigured,
  isMinimallyConfigured,
  mergeAmpliConfig,
  ampliConfigExists,
  type AmpliConfig,
  type AmpliConfigParseResult,
} from '../../src/lib/ampli-config.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let projectDir: string;
let lastResult: AmpliConfigParseResult | null;
let currentConfig: AmpliConfig | null;
let warnings: string[];

// ── Lifecycle ─────────────────────────────────────────────────────────────────

Before(function () {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampli-wizard-test-'));
  lastResult = null;
  currentConfig = null;
  warnings = [];
});

After(function () {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I am working in a project directory', function () {
  // projectDir is created in Before — nothing else needed
});

Given('there is no {string} in the project directory', function (filename: string) {
  const filePath = path.join(projectDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
});

Given(
  '{string} exists in the project directory with content:',
  function (filename: string, content: string) {
    fs.writeFileSync(path.join(projectDir, filename), content.trim(), 'utf-8');
  },
);

// ── When ──────────────────────────────────────────────────────────────────────

When('the wizard checks for an existing ampli.json', function () {
  lastResult = readAmpliConfig(projectDir);
});

When('the wizard reads ampli.json', function () {
  lastResult = readAmpliConfig(projectDir);
  if (lastResult.ok) currentConfig = lastResult.config;
});

When(
  'the wizard writes ampli.json with:',
  function (dataTable: DataTable) {
    const config: AmpliConfig = dataTable.rowsHash() as AmpliConfig;
    writeAmpliConfig(projectDir, config);
    currentConfig = config;
  },
);

When(
  'the wizard merges ampli.json with:',
  function (dataTable: DataTable) {
    const existingResult = readAmpliConfig(projectDir);
    const existing = existingResult.ok ? existingResult.config : {};
    const updates = dataTable.rowsHash() as Partial<AmpliConfig>;
    const merged = mergeAmpliConfig(existing, updates);
    writeAmpliConfig(projectDir, merged);
    currentConfig = merged;
  },
);

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the result should be {string}', function (expected: string) {
  assert.ok(lastResult, 'No result — did you run a When step?');
  if (lastResult.ok) {
    assert.fail(`Expected error "${expected}" but parse succeeded`);
  }
  assert.strictEqual(lastResult.error, expected);
});

Then('the project should be considered unconfigured', function () {
  const config = currentConfig ?? (lastResult?.ok ? lastResult.config : {});
  assert.strictEqual(isConfigured(config), false);
  assert.strictEqual(isMinimallyConfigured(config), false);
});

Then('the project should be considered configured', function () {
  assert.ok(currentConfig, 'No config loaded');
  assert.strictEqual(isConfigured(currentConfig), true);
});

Then('the project should be considered minimally configured', function () {
  assert.ok(currentConfig, 'No config loaded');
  assert.strictEqual(isMinimallyConfigured(currentConfig), true);
});

Then('the project should not be considered fully configured', function () {
  assert.ok(currentConfig, 'No config loaded');
  assert.strictEqual(isConfigured(currentConfig), false);
});

Then('the config should have OrgId {string}', function (expected: string) {
  assert.ok(currentConfig, 'No config loaded');
  assert.strictEqual(currentConfig.OrgId, expected);
});

Then('the config should have SourceId {string}', function (expected: string) {
  assert.ok(currentConfig, 'No config loaded');
  assert.strictEqual(currentConfig.SourceId, expected);
});

Then('{string} should exist in the project directory', function (filename: string) {
  assert.ok(
    fs.existsSync(path.join(projectDir, filename)),
    `Expected ${filename} to exist in ${projectDir}`,
  );
});

Then('it should contain OrgId {string}', function (expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok, `Expected valid ampli.json but got error: ${!result.ok ? result.error : ''}`);
  assert.strictEqual(result.config.OrgId, expected);
});

Then('it should contain SourceId {string}', function (expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok);
  assert.strictEqual(result.config.SourceId, expected);
});

Then('{string} should contain OrgId {string}', function (_filename: string, expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok);
  assert.strictEqual(result.config.OrgId, expected);
});

Then('{string} should contain SourceId {string}', function (_filename: string, expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok);
  assert.strictEqual(result.config.SourceId, expected);
});

Then('{string} should contain Version {string}', function (_filename: string, expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok);
  assert.strictEqual(result.config.Version, expected);
});

Then('{string} should contain Path {string}', function (_filename: string, expected: string) {
  const result = readAmpliConfig(projectDir);
  assert.ok(result.ok);
  assert.strictEqual(result.config.Path, expected);
});

Then('the user should be warned about merge conflicts', function () {
  // In a real wizard this would display a warning in the TUI — here we
  // verify that the parse result carries the correct error code so the
  // calling layer can surface the warning.
  assert.ok(lastResult && !lastResult.ok && lastResult.error === 'merge_conflicts');
});
