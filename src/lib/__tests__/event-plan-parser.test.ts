/**
 * event-plan-parser — covers `readLocalEventPlan`, the disk reader the
 * Event Verification screen uses to surface the agent's tracking plan.
 *
 * The parser side of the module is implicitly exercised by tests that
 * read from disk; we don't add a separate suite for the pure JSON parser
 * because every observed-in-the-wild input shape is documented in the
 * inline schema and any drift would surface here too.
 *
 * Tests use a per-test tmp dir so file-system state is hermetic across
 * the suite — important because the reader picks the freshest mtime when
 * both the canonical and legacy paths exist.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalEventPlan } from '../event-plan-parser.js';

describe('readLocalEventPlan', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-plan-test-'));
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('returns [] when neither canonical nor legacy file exists', () => {
    expect(readLocalEventPlan(installDir)).toEqual([]);
  });

  it('reads the canonical .amplitude/events.json path', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        { name: 'Page Viewed', description: 'A page was viewed' },
        { name: 'Button Clicked', description: 'A button was clicked' },
      ]),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([
      { name: 'Page Viewed', description: 'A page was viewed' },
      { name: 'Button Clicked', description: 'A button was clicked' },
    ]);
  });

  it('reads the legacy .amplitude-events.json path when canonical is missing', () => {
    fs.writeFileSync(
      path.join(installDir, '.amplitude-events.json'),
      JSON.stringify([{ name: 'Sign In', description: 'User signed in' }]),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([
      { name: 'Sign In', description: 'User signed in' },
    ]);
  });

  it('prefers the file with the more recent mtime when both exist', () => {
    const canonicalDir = path.join(installDir, '.amplitude');
    fs.mkdirSync(canonicalDir, { recursive: true });
    const canonical = path.join(canonicalDir, 'events.json');
    const legacy = path.join(installDir, '.amplitude-events.json');

    fs.writeFileSync(
      canonical,
      JSON.stringify([{ name: 'Stale Event', description: 'old' }]),
    );
    // Backdate canonical so legacy looks fresher.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(canonical, past, past);

    fs.writeFileSync(
      legacy,
      JSON.stringify([{ name: 'Fresh Event', description: 'new' }]),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([{ name: 'Fresh Event', description: 'new' }]);
  });

  it('returns [] for malformed JSON', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.json'), '{ this is not json');

    expect(readLocalEventPlan(installDir)).toEqual([]);
  });

  it('drops entries with empty names', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        { name: '', description: 'no name' },
        { name: 'Real Event', description: 'has a name' },
        { description: 'also no name' },
      ]),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([{ name: 'Real Event', description: 'has a name' }]);
  });

  it('unwraps the { events: [...] } wrapper some skills emit', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify({
        events: [{ name: 'Wrapped Event', description: 'inside wrapper' }],
      }),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([
      { name: 'Wrapped Event', description: 'inside wrapper' },
    ]);
  });

  it('tolerates field-name variants the agent emits in the wild', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        { event: 'Form Submitted', event_description: 'submitted via POST' },
        { eventName: 'Modal Opened', eventDescription: 'opened the modal' },
      ]),
    );

    const events = readLocalEventPlan(installDir);
    expect(events).toEqual([
      { name: 'Form Submitted', description: 'submitted via POST' },
      { name: 'Modal Opened', description: 'opened the modal' },
    ]);
  });
});
