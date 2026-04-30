/**
 * welcome-back-context — unit tests for the IntroScreen welcome panel
 * helpers. The IntroScreen renders during the very first frame of a run,
 * so the helpers must be totally crash-proof against missing or malformed
 * event files.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readPreviousRunSummary,
  humanizeAge,
} from '../welcome-back-context.js';

describe('readPreviousRunSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-back-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('returns zero counts and null timestamp when no events file exists', () => {
    const summary = readPreviousRunSummary(tmpDir);
    expect(summary.eventCount).toBe(0);
    expect(summary.lastRunAt).toBeNull();
  });

  it('counts events from canonical .amplitude/events.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    const events = [
      { name: 'signup_started', description: 'User started signup' },
      { name: 'signup_completed', description: 'User completed signup' },
      { name: 'checkout_started', description: 'Checkout begun' },
    ];
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      JSON.stringify(events),
    );

    const summary = readPreviousRunSummary(tmpDir);
    expect(summary.eventCount).toBe(3);
    expect(summary.lastRunAt).toBeInstanceOf(Date);
  });

  it('counts events from legacy .amplitude-events.json when canonical absent', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude-events.json'),
      JSON.stringify([{ name: 'page_view', description: 'Viewed a page' }]),
    );

    const summary = readPreviousRunSummary(tmpDir);
    expect(summary.eventCount).toBe(1);
    expect(summary.lastRunAt).toBeInstanceOf(Date);
  });

  it('prefers the freshest file when both canonical + legacy exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    const canonical = path.join(tmpDir, '.amplitude', 'events.json');
    const legacy = path.join(tmpDir, '.amplitude-events.json');

    fs.writeFileSync(legacy, JSON.stringify([{ name: 'old' }]));
    // Force canonical to be newer (legacy might tie if both writes happen
    // in the same ms — backdate legacy to make the assertion deterministic).
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(legacy, oldTime, oldTime);

    fs.writeFileSync(
      canonical,
      JSON.stringify([{ name: 'new1' }, { name: 'new2' }]),
    );

    const summary = readPreviousRunSummary(tmpDir);
    // Canonical wins → 2 events, not 1.
    expect(summary.eventCount).toBe(2);
  });

  it('silently returns 0 events but keeps timestamp on malformed JSON', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      'not-json-at-all',
    );

    const summary = readPreviousRunSummary(tmpDir);
    expect(summary.eventCount).toBe(0);
    // File existed → timestamp is set, the user did run the wizard before
    // even if the file's been corrupted since.
    expect(summary.lastRunAt).toBeInstanceOf(Date);
  });

  it('ignores empty-name entries when counting events', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.amplitude', 'events.json'),
      JSON.stringify([
        { name: 'real_event', description: '' },
        { name: '', description: 'placeholder' },
        { name: '   ', description: 'whitespace' },
      ]),
    );

    const summary = readPreviousRunSummary(tmpDir);
    expect(summary.eventCount).toBe(1);
  });

  it('does not throw when installDir does not exist', () => {
    expect(() =>
      readPreviousRunSummary('/no/such/path/anywhere-1234567890'),
    ).not.toThrow();
  });
});

describe('humanizeAge', () => {
  const NOW = new Date('2026-04-28T12:00:00Z');

  it('returns "just now" for very recent timestamps', () => {
    expect(humanizeAge(new Date(NOW.getTime() - 5_000), NOW)).toBe('just now');
  });

  it('returns "just now" for future timestamps (clock skew)', () => {
    expect(humanizeAge(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now');
  });

  it('formats minutes', () => {
    expect(humanizeAge(new Date(NOW.getTime() - 60_000), NOW)).toBe(
      '1 minute ago',
    );
    expect(humanizeAge(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(
      '5 minutes ago',
    );
  });

  it('formats hours', () => {
    expect(humanizeAge(new Date(NOW.getTime() - 60 * 60_000), NOW)).toBe(
      '1 hour ago',
    );
    expect(humanizeAge(new Date(NOW.getTime() - 2 * 60 * 60_000), NOW)).toBe(
      '2 hours ago',
    );
  });

  it('formats days', () => {
    const oneDay = 24 * 60 * 60_000;
    expect(humanizeAge(new Date(NOW.getTime() - oneDay), NOW)).toBe(
      '1 day ago',
    );
    expect(humanizeAge(new Date(NOW.getTime() - 3 * oneDay), NOW)).toBe(
      '3 days ago',
    );
  });

  it('formats months', () => {
    const oneMonth = 30 * 24 * 60 * 60_000;
    expect(humanizeAge(new Date(NOW.getTime() - oneMonth), NOW)).toBe(
      '1 month ago',
    );
    expect(humanizeAge(new Date(NOW.getTime() - 4 * oneMonth), NOW)).toBe(
      '4 months ago',
    );
  });

  it('formats years', () => {
    const oneYear = 365 * 24 * 60 * 60_000;
    expect(humanizeAge(new Date(NOW.getTime() - oneYear), NOW)).toBe(
      '1 year ago',
    );
    expect(humanizeAge(new Date(NOW.getTime() - 2 * oneYear), NOW)).toBe(
      '2 years ago',
    );
  });
});
