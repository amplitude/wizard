/**
 * Last-used selection persistence.
 *
 * Feeds the upcoming collapsed org/workspace/env picker: the picker
 * pre-focuses the row matching these ids on first render, falling back
 * to the first entry when none match.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getLastUsedSelection,
  storeLastUsedSelection,
} from '../ampli-settings.js';

let tmp: string;
let cfg: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wizard-last-used-'));
  cfg = join(tmp, 'ampli.json');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('getLastUsedSelection', () => {
  it('returns an empty triple on a fresh config', () => {
    expect(getLastUsedSelection(cfg)).toEqual({
      orgId: undefined,
      workspaceId: undefined,
      projectId: undefined,
    });
  });
});

describe('storeLastUsedSelection', () => {
  it('round-trips the full triple', () => {
    storeLastUsedSelection(
      { orgId: 'org-1', workspaceId: 'ws-2', projectId: 'proj-3' },
      cfg,
    );
    expect(getLastUsedSelection(cfg)).toEqual({
      orgId: 'org-1',
      workspaceId: 'ws-2',
      projectId: 'proj-3',
    });
  });

  it('round-trips a partial triple (org only)', () => {
    storeLastUsedSelection({ orgId: 'org-only' }, cfg);
    expect(getLastUsedSelection(cfg)).toEqual({
      orgId: 'org-only',
      workspaceId: undefined,
      projectId: undefined,
    });
  });

  it('clears workspace + project when only orgId changes', () => {
    storeLastUsedSelection(
      { orgId: 'org-1', workspaceId: 'ws-1', projectId: 'proj-1' },
      cfg,
    );
    storeLastUsedSelection({ orgId: 'org-2' }, cfg);
    expect(getLastUsedSelection(cfg)).toEqual({
      orgId: 'org-2',
      workspaceId: undefined,
      projectId: undefined,
    });
  });

  it('does not clobber unrelated top-level keys (ampli-CLI ownership)', () => {
    // Simulate an existing ampli.json with an ampli-CLI User-* entry.
    writeFileSync(
      cfg,
      JSON.stringify({
        'User-abc123': { User: { id: 'abc123' } },
      }),
    );
    storeLastUsedSelection({ orgId: 'org-1' }, cfg);
    const after = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(after['User-abc123']).toEqual({ User: { id: 'abc123' } });
    expect(after['wizard']).toMatchObject({ lastUsedOrgId: 'org-1' });
  });

  it('preserves unknown keys inside the wizard namespace', () => {
    // Pretend a future slice wrote a different setting under wizard.*.
    writeFileSync(
      cfg,
      JSON.stringify({
        wizard: { someFutureSetting: 'keep me' },
      }),
    );
    storeLastUsedSelection({ orgId: 'org-1' }, cfg);
    const after = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(after.wizard.someFutureSetting).toBe('keep me');
    expect(after.wizard.lastUsedOrgId).toBe('org-1');
  });
});
