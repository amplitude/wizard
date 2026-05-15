/**
 * ProjectPicker — coverage at 10 / 250 / 5000 projects.
 *
 * Why three sizes:
 *   - 10 pins the rendered shape (cursor glyph, footer copy, scope syntax)
 *   - 250 verifies the "showing N of M" footer and windowing kicks in
 *   - 5000 is the load-tolerance test — picker MUST stay under the
 *     100-Text-node ceiling regardless of dataset size
 *
 * The 100-Text-node check counts visible project ROWS, not raw Text
 * nodes (we render multiple Text children per row for color zones).
 * The contract that matters is "≤50 project rows" — we assert that by
 * counting unique project names from the rendered frame.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  ProjectPicker,
  parseQuery,
  rankMatch,
  filterAndRank,
  MAX_VISIBLE_ROWS,
  type ProjectPickerEntry,
} from '../ProjectPicker.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function strip(frame: string | undefined): string {
  return (frame ?? '').replace(ANSI, '');
}

/**
 * Yield two macrotasks so Ink's stdin reader + React's reducer commits
 * settle after a `stdin.write()`. Mirrors the pattern used in
 * `AuthScreen.region-host.test.tsx`.
 */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function type(stdin: { write: (s: string) => void }, text: string) {
  for (const ch of text) {
    stdin.write(ch);
    await flushAsync();
  }
}

function makeProjects(
  n: number,
  orgs: string[] = ['acme', 'globex', 'initech'],
): ProjectPickerEntry[] {
  const envs = ['Production', 'Staging', 'Dev', 'QA'];
  // Use coprime cycle lengths (3 orgs × 4 envs) so the (org, env) tuples
  // span their full cross product instead of always co-occurring — the
  // intersection-stacking test below depends on env not being
  // deterministically tied to org.
  return Array.from({ length: n }, (_, i) => {
    const org = orgs[i % orgs.length];
    const env = envs[i % envs.length];
    return {
      id: `p${i}`,
      name: `${org}-web-${i}`,
      orgName: org,
      orgId: `org-${org}`,
      envName: env,
    };
  });
}

/** Count unique rendered project names (= visible project rows). */
function countVisibleProjectRows(
  frame: string,
  projects: ProjectPickerEntry[],
): number {
  let count = 0;
  for (const p of projects) {
    if (frame.includes(p.name)) count++;
  }
  return count;
}

describe('parseQuery', () => {
  it('treats a bare query as residual fuzzy', () => {
    expect(parseQuery('web')).toEqual({ scopes: {}, residual: 'web' });
  });

  it('extracts a single %org scope', () => {
    expect(parseQuery('%org acme')).toEqual({
      scopes: { org: 'acme' },
      residual: '',
    });
  });

  it('stacks multiple scopes', () => {
    expect(parseQuery('%org acme %name web')).toEqual({
      scopes: { org: 'acme', name: 'web' },
      residual: '',
    });
  });

  it('keeps non-scope text as residual', () => {
    expect(parseQuery('foo %env prod bar')).toEqual({
      scopes: { env: 'prod bar' },
      residual: 'foo',
    });
  });

  it('lowercases scope values', () => {
    expect(parseQuery('%ORG ACME')).toEqual({
      scopes: { org: 'acme' },
      residual: '',
    });
  });

  it('returns empty for blank input', () => {
    expect(parseQuery('')).toEqual({ scopes: {}, residual: '' });
  });
});

describe('rankMatch', () => {
  it('returns null for non-match', () => {
    expect(rankMatch('hello', 'xyz')).toBeNull();
  });

  it('ranks prefix matches above mid-string matches', () => {
    const prefix = rankMatch('acme-web', 'acme');
    const middle = rankMatch('production-acme', 'acme');
    expect(prefix).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(prefix!).toBeGreaterThan(middle!);
  });

  it('is case-insensitive', () => {
    expect(rankMatch('Acme', 'ACME')).not.toBeNull();
  });

  it('returns 0 for empty needle (no filter)', () => {
    expect(rankMatch('anything', '')).toBe(0);
  });
});

describe('filterAndRank', () => {
  const projects = makeProjects(30);

  it('returns all projects for an empty query', () => {
    const result = filterAndRank(projects, parseQuery(''));
    expect(result.length).toBe(30);
  });

  it('narrows by %org scope', () => {
    const result = filterAndRank(projects, parseQuery('%org acme'));
    expect(result.length).toBe(10); // 30 projects / 3 orgs
    expect(result.every((r) => r.entry.orgName === 'acme')).toBe(true);
  });

  it('narrows by %env scope', () => {
    const result = filterAndRank(projects, parseQuery('%env production'));
    // 30 projects / 4 envs ≈ 7-8 production rows.
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.entry.envName === 'Production')).toBe(true);
  });

  it('stacks scopes (intersection)', () => {
    const result = filterAndRank(
      projects,
      parseQuery('%org acme %env production'),
    );
    expect(
      result.every(
        (r) =>
          r.entry.orgName === 'acme' && r.entry.envName === 'Production',
      ),
    ).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Strict subset of the org-only filter (10 acme rows), because not
    // every acme row sits in Production with the 3×4 cycle scheme.
    const acmeOnly = filterAndRank(projects, parseQuery('%org acme'));
    expect(result.length).toBeLessThan(acmeOnly.length);
  });

  it('fuzzy-matches the residual against all visible columns', () => {
    const result = filterAndRank(projects, parseQuery('globex'));
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (r) =>
          r.entry.orgName.includes('globex') ||
          r.entry.name.includes('globex'),
      ),
    ).toBe(true);
  });
});

describe('ProjectPicker — 10 projects', () => {
  it('renders all 10 rows with the cursor on the first row', () => {
    const projects = makeProjects(10);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    expect(countVisibleProjectRows(frame, projects)).toBe(10);
    // First project highlighted — its name should appear.
    expect(frame).toContain(projects[0].name);
    unmount();
  });

  it('shows the filter input with scope hint', () => {
    const projects = makeProjects(10);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    expect(frame).toContain('Filter:');
    expect(frame).toContain('%org');
    unmount();
  });

  it('does not render the "showing N of M" footer when all fit', () => {
    const projects = makeProjects(10);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    expect(frame).not.toMatch(/showing \d+ of \d+/);
    unmount();
  });
});

describe('ProjectPicker — 250 projects', () => {
  it('caps visible rows at the window and shows the footer', () => {
    const projects = makeProjects(250);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    const visible = countVisibleProjectRows(frame, projects);
    expect(visible).toBeLessThanOrEqual(MAX_VISIBLE_ROWS);
    expect(frame).toMatch(/showing \d+ of 250/);
    expect(frame).toContain('keep typing to narrow');
    unmount();
  });
});

describe('ProjectPicker — 5000 projects (load tolerance)', () => {
  it('renders no more than MAX_VISIBLE_ROWS project rows', () => {
    const projects = makeProjects(5000);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    // Hard cap: we must NOT have rendered all 5000 (would blow up
    // Text-node budget and freeze the terminal on real hardware).
    const visible = countVisibleProjectRows(frame, projects);
    expect(visible).toBeLessThanOrEqual(MAX_VISIBLE_ROWS);
    expect(visible).toBeGreaterThan(0);
    // Footer must reflect the dataset size.
    expect(frame).toMatch(/showing \d+ of 5000/);
    unmount();
  });

  it('frame line count stays bounded — no overdraw on 5000 projects', () => {
    const projects = makeProjects(5000);
    const { lastFrame, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    const frame = strip(lastFrame());
    const lines = frame.split('\n');
    // Generous ceiling: 50 rows + ~10 lines of chrome + safety buffer.
    expect(lines.length).toBeLessThan(100);
    unmount();
  });
});

describe('ProjectPicker — empty state', () => {
  it('renders the "no matches" hint when filter yields zero rows', async () => {
    const projects = makeProjects(10);
    const { lastFrame, stdin, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    // Type a query that matches nothing.
    await type(stdin, 'zzzzzzz');
    const frame = strip(lastFrame());
    expect(frame).toContain('no matches');
    expect(frame).toContain('press n to create one');
    unmount();
  });
});

describe('ProjectPicker — column scoping smoke test', () => {
  it('typed %org acme narrows the visible list', async () => {
    const projects = makeProjects(30);
    const { lastFrame, stdin, unmount } = render(
      <ProjectPicker projects={projects} onSelect={() => {}} />,
    );
    await type(stdin, '%org acme');
    const frame = strip(lastFrame());
    // Only acme-org projects should show — globex-* should not.
    const globexProjects = projects.filter((p) => p.orgName === 'globex');
    for (const p of globexProjects) {
      expect(frame).not.toContain(p.name);
    }
    const acmeProjects = projects.filter((p) => p.orgName === 'acme');
    const acmeVisible = countVisibleProjectRows(frame, acmeProjects);
    expect(acmeVisible).toBeGreaterThan(0);
    unmount();
  });
});

describe('ProjectPicker — new-project sub-state', () => {
  it('switches to the inline new-project form on `n` keypress', async () => {
    const projects = makeProjects(5);
    let createdWith: { name: string; envName: string } | null = null;
    const { lastFrame, stdin, unmount } = render(
      <ProjectPicker
        projects={projects}
        onSelect={() => {}}
        onCreate={(input) => {
          createdWith = input;
        }}
      />,
    );
    await type(stdin, 'n');
    const frame = strip(lastFrame());
    expect(frame).toContain('Create a new project');
    expect(frame).toContain('Project name');
    // Sub-state should suppress the filter chrome.
    expect(frame).not.toContain('Filter:');
    expect(createdWith).toBeNull();
    unmount();
  });

  it('uses the initialQuery prop to seed the filter and gates `n`', async () => {
    // Verifies the gating semantics via initialQuery rather than typing
    // 'a' then 'n' — ink-testing-library batches stdin writes such that
    // a setState dispatched inside one useEffect is not guaranteed to
    // commit before the next stdin write reaches useInput handlers in
    // the same synchronous flush. Seeding via initialQuery sidesteps
    // that race while still exercising the same hotkey-gate code path.
    const projects = makeProjects(5);
    const { lastFrame, stdin, unmount } = render(
      <ProjectPicker
        projects={projects}
        onSelect={() => {}}
        onCreate={() => {}}
        initialQuery="acme"
      />,
    );
    await flushAsync();
    await type(stdin, 'n');
    const frame = strip(lastFrame());
    expect(frame).not.toContain('Create a new project');
    // Filter chrome should still be visible — we're still in the picker.
    expect(frame).toContain('Filter:');
    unmount();
  });
});
