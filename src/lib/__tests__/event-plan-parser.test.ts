/**
 * event-plan-parser — disk reader for the Event Verification screen plus
 * direct coverage of {@link parseEventPlanContent} so wild agent JSON shapes
 * regress with a fast, hermetic suite (no filesystem).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseEventPlanContent,
  readLocalEventPlan,
  readLocalEventPlanRich,
} from '../event-plan-parser.js';

describe('parseEventPlanContent', () => {
  it('returns null for invalid JSON', () => {
    expect(parseEventPlanContent('not json')).toBeNull();
  });

  it('returns null when the document is not an array and has no events array', () => {
    expect(parseEventPlanContent(JSON.stringify({ foo: [] }))).toBeNull();
    expect(parseEventPlanContent(JSON.stringify({ events: {} }))).toBeNull();
  });

  it('returns an empty array for []', () => {
    expect(parseEventPlanContent(JSON.stringify([]))).toEqual([]);
  });

  it('unwraps { events: [...] } the same way as the disk reader tests', () => {
    expect(
      parseEventPlanContent(
        JSON.stringify({
          events: [{ name: 'A', description: 'one' }],
        }),
      ),
    ).toEqual([{ name: 'A', description: 'one' }]);
  });

  it('maps event_name to name', () => {
    expect(
      parseEventPlanContent(
        JSON.stringify([{ event_name: 'Tracked', description: 'd' }]),
      ),
    ).toEqual([{ name: 'Tracked', description: 'd' }]);
  });

  it('prefers description over eventDescriptionAndReasoning when both exist', () => {
    expect(
      parseEventPlanContent(
        JSON.stringify([
          {
            name: 'N',
            description: 'short',
            eventDescriptionAndReasoning: 'long verbose',
          },
        ]),
      ),
    ).toEqual([{ name: 'N', description: 'short' }]);
  });
});

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

describe('readLocalEventPlanRich', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'event-plan-rich-test-'),
    );
  });

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  it('returns null when neither canonical nor legacy file exists', () => {
    expect(readLocalEventPlanRich(installDir)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.json'), '{ this is not json');

    expect(readLocalEventPlanRich(installDir)).toBeNull();
  });

  it('returns null when the JSON is not an array (and has no events array)', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify({ unrelated: 'shape' }),
    );

    expect(readLocalEventPlanRich(installDir)).toBeNull();
  });

  it('returns [] when the file parses to an empty array', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify([]));

    expect(readLocalEventPlanRich(installDir)).toEqual([]);
  });

  it('preserves callsites annotations on each event', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        {
          name: 'Page Viewed',
          description: 'Viewed a page',
          callsites: [
            { filePath: 'src/app.ts', anchor: 'PageViewed' },
            { filePath: 'src/router.ts' },
          ],
        },
        {
          name: 'No Callsites Yet',
          description: 'pending',
        },
      ]),
    );

    expect(readLocalEventPlanRich(installDir)).toEqual([
      {
        name: 'Page Viewed',
        description: 'Viewed a page',
        callsites: [
          { filePath: 'src/app.ts', anchor: 'PageViewed' },
          { filePath: 'src/router.ts' },
        ],
      },
      {
        name: 'No Callsites Yet',
        description: 'pending',
      },
    ]);
  });

  it('does not crash on a numeric name field — coerces to string', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        { name: 42, description: 'numeric name' },
        { name: 'Real', description: 'real one' },
      ]),
    );

    // 42 → '42', kept; both events survive.
    expect(readLocalEventPlanRich(installDir)).toEqual([
      { name: '42', description: 'numeric name' },
      { name: 'Real', description: 'real one' },
    ]);
  });

  it('does not crash on null / object / boolean field values — drops the entry', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        { name: null, description: 'no name' },
        { name: { weird: 'object' }, description: 'still no name' },
        { name: true, description: 'boolean name' },
        { name: 'Survivor', description: { nested: 'thing' } },
      ]),
    );

    // Null/object/boolean names get coerced to '' and filtered out.
    // The survivor's description coerces to '' since it's an object.
    expect(readLocalEventPlanRich(installDir)).toEqual([
      { name: 'Survivor', description: '' },
    ]);
  });

  it('does not crash when an entry itself is null or a primitive', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([null, 'string-not-object', 42, { name: 'Real One' }]),
    );

    expect(readLocalEventPlanRich(installDir)).toEqual([
      { name: 'Real One', description: '' },
    ]);
  });

  it('drops malformed callsite entries instead of throwing', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify([
        {
          name: 'Mixed Callsites',
          description: 'd',
          callsites: [
            { filePath: 'good.ts', anchor: 'A' },
            { filePath: 123 }, // numeric filePath: drop
            null, // null entry: drop
            { anchor: 'no-path' }, // missing filePath: drop
            { filePath: 'good2.ts' },
          ],
        },
      ]),
    );

    expect(readLocalEventPlanRich(installDir)).toEqual([
      {
        name: 'Mixed Callsites',
        description: 'd',
        callsites: [
          { filePath: 'good.ts', anchor: 'A' },
          { filePath: 'good2.ts' },
        ],
      },
    ]);
  });

  it('unwraps the { events: [...] } wrapper like readLocalEventPlan does', () => {
    const dir = path.join(installDir, '.amplitude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'events.json'),
      JSON.stringify({
        events: [{ name: 'Wrapped', description: 'inside' }],
      }),
    );

    expect(readLocalEventPlanRich(installDir)).toEqual([
      { name: 'Wrapped', description: 'inside' },
    ]);
  });
});
