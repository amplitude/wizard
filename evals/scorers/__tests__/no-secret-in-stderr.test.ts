/**
 * Layer 0 secret-in-stderr scorer — verify the redactor's
 * post-condition: no token-shaped string survives in captured stderr.
 *
 * The runner's redactString() runs at capture time; this scorer is the
 * net that catches anything the redactor missed.
 */

import { describe, expect, it } from 'vitest';

import { scorer } from '../layer0-hard-fail/no-secret-in-stderr.js';
import type { Artifact, Scenario } from '../../runner/types.js';

const baseArtifact: Omit<Artifact, 'stderr'> = {
  runId: 'run-test',
  scenario: 'test',
  ring: 1,
  startedAt: '2026-05-06T12:00:00Z',
  finishedAt: '2026-05-06T12:00:01Z',
  exitCode: 0,
  runLog: [],
  fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
  source: 'live',
};

const dummyScenario = {} as Scenario;

function withStderr(stderr: string): Artifact {
  return { ...baseArtifact, stderr };
}

describe('no-secret-in-stderr scorer', () => {
  it('passes on empty stderr', () => {
    const r = scorer.evaluate(withStderr(''), dummyScenario);
    expect(r.pass).toBe(true);
    expect(r.hardFail).toBeUndefined();
  });

  it('passes on benign stderr', () => {
    const r = scorer.evaluate(
      withStderr('warning: deprecated flag\nbuild ok\n'),
      dummyScenario,
    );
    expect(r.pass).toBe(true);
  });

  it('hard-fails on a JWT-shaped string', () => {
    // Build the JWT shape from parts so static-analysis tools don't
    // flag this fixture as a real leaked secret. The runtime string
    // still matches the JWT regex; that's what we're testing.
    const head = 'ey' + 'J' + 'a'.repeat(15);
    const body = 'ey' + 'J' + 'b'.repeat(15);
    const sig = 'c'.repeat(20);
    const jwt = `${head}.${body}.${sig}`;
    const r = scorer.evaluate(
      withStderr(`some error: ${jwt}\n`),
      dummyScenario,
    );
    expect(r.pass).toBe(false);
    expect(r.hardFail).toBe(true);
    expect(r.detail).toMatch(/JWT/);
  });

  it('passes when Bearer is already redacted', () => {
    const r = scorer.evaluate(
      withStderr('Authorization: Bearer [REDACTED]\n'),
      dummyScenario,
    );
    expect(r.pass).toBe(true);
  });

  it('hard-fails on an unredacted Bearer token', () => {
    // Bearer + non-redacted value. Constructed to avoid any
    // accidental match against well-known token patterns.
    const token = 'x'.repeat(12);
    const r = scorer.evaluate(
      withStderr(`Authorization: Bearer ${token}\n`),
      dummyScenario,
    );
    expect(r.pass).toBe(false);
    expect(r.hardFail).toBe(true);
    expect(r.detail).toMatch(/Bearer/);
  });

  it('hard-fails on a 32+ hex string', () => {
    // 32 hex chars constructed at runtime so static analysis doesn't
    // see a hex-shaped literal in the source.
    const hex = '0'.repeat(16) + 'a'.repeat(16);
    const r = scorer.evaluate(withStderr(`key=${hex}\n`), dummyScenario);
    expect(r.pass).toBe(false);
    expect(r.hardFail).toBe(true);
  });

  it('hard-fails on the eval API key literal', () => {
    const original = process.env.AMPLITUDE_EVAL_API_KEY;
    try {
      // Synthesized fake key — not a real Anthropic-format key, just
      // a unique string the scorer should grep for. Avoid the `sk-`
      // prefix to keep static analysis quiet.
      const fakeKey = 'eval-fixture-' + 'q'.repeat(20);
      process.env.AMPLITUDE_EVAL_API_KEY = fakeKey;
      const r = scorer.evaluate(
        withStderr(`config: ${fakeKey} leaked\n`),
        dummyScenario,
      );
      expect(r.pass).toBe(false);
      expect(r.hardFail).toBe(true);
      expect(r.detail).toMatch(/API key/);
    } finally {
      if (original === undefined) delete process.env.AMPLITUDE_EVAL_API_KEY;
      else process.env.AMPLITUDE_EVAL_API_KEY = original;
    }
  });
});
