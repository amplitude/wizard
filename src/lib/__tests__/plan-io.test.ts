/**
 * Tests for `readJsonWithSchema` — the shared filesystem helper that
 * powers `readDashboardPlan`, `agent-plans.loadPlan`, and (indirectly)
 * `readLocalEventPlan`. Locks the contract that:
 *
 *   - Missing files surface `not_found` (the happy-path "plan hasn't
 *     been written yet" outcome).
 *   - Permission / disk errors surface `invalid` with the underlying
 *     message in `reason`.
 *   - JSON parse failures surface `invalid` with a "not valid JSON"
 *     prefix so callers can distinguish corruption from schema drift.
 *   - Schema validation failures surface `invalid` with the offending
 *     issue path + message.
 *   - Valid files round-trip through the schema and return `ok`.
 *
 * Hermetic: every test uses a fresh tmpdir + a tiny inline schema so the
 * helper's behavior is exercised without dragging in any of the plan
 * schemas it serves.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readJsonWithSchema } from '../plan-io.js';

const SAMPLE_SCHEMA = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
  })
  .strict();

describe('readJsonWithSchema', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-io-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns not_found when the file does not exist', () => {
    const result = readJsonWithSchema(
      path.join(tmpDir, 'missing.json'),
      SAMPLE_SCHEMA,
      'test',
    );
    expect(result.kind).toBe('not_found');
  });

  it('returns ok with parsed data for a valid file', () => {
    const filePath = path.join(tmpDir, 'good.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, name: 'demo' }));

    const result = readJsonWithSchema(filePath, SAMPLE_SCHEMA, 'test');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toEqual({ version: 1, name: 'demo' });
    }
  });

  it('returns invalid for malformed JSON with a "not valid JSON" reason', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{ this is not json');

    const result = readJsonWithSchema(filePath, SAMPLE_SCHEMA, 'test');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/not valid JSON/);
    }
  });

  it('returns invalid for schema-violating JSON', () => {
    const filePath = path.join(tmpDir, 'wrong-shape.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, name: 'demo' }));

    const result = readJsonWithSchema(filePath, SAMPLE_SCHEMA, 'test');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      // The reason format mirrors the previous open-coded reader in
      // `agent-plans.loadPlan` so existing callers see the same shape.
      expect(result.reason).toMatch(/schema validation/i);
    }
  });

  it('returns invalid when the path resolves to a directory (EISDIR)', () => {
    // Pointing at a directory exercises the "non-ENOENT read error"
    // branch — the helper must surface it as `invalid` so callers
    // log it rather than silently treating it as "no plan yet."
    const result = readJsonWithSchema(tmpDir, SAMPLE_SCHEMA, 'test');
    expect(result.kind).toBe('invalid');
  });

  it('round-trips strict-schema rejection of extra fields', () => {
    const filePath = path.join(tmpDir, 'extra.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({ version: 1, name: 'demo', surprise: 'extra' }),
    );

    const result = readJsonWithSchema(filePath, SAMPLE_SCHEMA, 'test');
    expect(result.kind).toBe('invalid');
  });
});
