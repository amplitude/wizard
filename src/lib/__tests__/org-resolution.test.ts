import { describe, expect, it } from 'vitest';
import { resolveOrgByApiKey, resolveEnvsWithKey } from '../org-resolution.js';
import type { AmplitudeOrg } from '../api.js';

/** Minimal fixture factory for org hierarchy. */
function makeOrgs(overrides?: Partial<AmplitudeOrg>[]): AmplitudeOrg[] {
  const defaults: AmplitudeOrg[] = [
    {
      id: 'org-1',
      name: 'Acme Corp',
      workspaces: [
        {
          id: 'ws-1',
          name: 'Main Workspace',
          environments: [
            {
              name: 'Production',
              rank: 1,
              app: { id: 'app-1', apiKey: 'key-prod' },
            },
            {
              name: 'Staging',
              rank: 2,
              app: { id: 'app-2', apiKey: 'key-staging' },
            },
          ],
        },
      ],
    },
    {
      id: 'org-2',
      name: 'Beta Inc',
      workspaces: [
        {
          id: 'ws-2',
          name: 'Beta Workspace',
          environments: [
            { name: 'Dev', rank: 1, app: { id: 'app-3', apiKey: 'key-dev' } },
          ],
        },
      ],
    },
  ];
  if (!overrides) return defaults;
  return overrides.map((o, i) => ({ ...defaults[i % defaults.length], ...o }));
}

describe('resolveOrgByApiKey', () => {
  it('returns the matching org/workspace/env for a known API key', () => {
    const result = resolveOrgByApiKey(makeOrgs(), 'key-prod');
    expect(result).toEqual({
      orgId: 'org-1',
      orgName: 'Acme Corp',
      workspaceId: 'ws-1',
      workspaceName: 'Main Workspace',
      projectName: 'Production',
    });
  });

  it('matches an API key in a second org', () => {
    const result = resolveOrgByApiKey(makeOrgs(), 'key-dev');
    expect(result).toEqual({
      orgId: 'org-2',
      orgName: 'Beta Inc',
      workspaceId: 'ws-2',
      workspaceName: 'Beta Workspace',
      projectName: 'Dev',
    });
  });

  it('matches staging environment (not just the first)', () => {
    const result = resolveOrgByApiKey(makeOrgs(), 'key-staging');
    expect(result).toEqual({
      orgId: 'org-1',
      orgName: 'Acme Corp',
      workspaceId: 'ws-1',
      workspaceName: 'Main Workspace',
      projectName: 'Staging',
    });
  });

  it('returns null when API key is not found', () => {
    expect(resolveOrgByApiKey(makeOrgs(), 'key-unknown')).toBeNull();
  });

  it('returns null for empty orgs array', () => {
    expect(resolveOrgByApiKey([], 'key-prod')).toBeNull();
  });

  it('handles environments with null app', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-x',
        name: 'Org X',
        workspaces: [
          {
            id: 'ws-x',
            name: 'WS X',
            environments: [
              { name: 'Broken', rank: 1, app: null },
              { name: 'Good', rank: 2, app: { id: 'a1', apiKey: 'key-good' } },
            ],
          },
        ],
      },
    ];
    const result = resolveOrgByApiKey(orgs, 'key-good');
    expect(result).toEqual({
      orgId: 'org-x',
      orgName: 'Org X',
      workspaceId: 'ws-x',
      workspaceName: 'WS X',
      projectName: 'Good',
    });
  });

  it('handles workspace with null environments', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-y',
        name: 'Org Y',
        workspaces: [{ id: 'ws-y', name: 'WS Y', environments: null }],
      },
    ];
    expect(resolveOrgByApiKey(orgs, 'anything')).toBeNull();
  });

  it('skips environments where apiKey is null', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-z',
        name: 'Org Z',
        workspaces: [
          {
            id: 'ws-z',
            name: 'WS Z',
            environments: [
              { name: 'NoKey', rank: 1, app: { id: 'a1', apiKey: null } },
            ],
          },
        ],
      },
    ];
    expect(resolveOrgByApiKey(orgs, 'null')).toBeNull();
  });
});

describe('resolveEnvsWithKey', () => {
  it('returns envs sorted by rank from first workspace when no workspaceId', () => {
    const result = resolveEnvsWithKey(makeOrgs());
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Production');
    expect(result[0].rank).toBe(1);
    expect(result[1].name).toBe('Staging');
    expect(result[1].rank).toBe(2);
  });

  it('includes org and workspace metadata on each env', () => {
    const result = resolveEnvsWithKey(makeOrgs());
    expect(result[0]).toMatchObject({
      orgId: 'org-1',
      orgName: 'Acme Corp',
      workspaceId: 'ws-1',
      workspaceName: 'Main Workspace',
      apiKey: 'key-prod',
    });
  });

  it('filters to a specific workspace by ID', () => {
    const result = resolveEnvsWithKey(makeOrgs(), 'ws-2');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Dev');
    expect(result[0].orgId).toBe('org-2');
  });

  it('returns empty array when workspaceId does not match', () => {
    expect(resolveEnvsWithKey(makeOrgs(), 'ws-nonexistent')).toEqual([]);
  });

  it('returns empty array for empty orgs', () => {
    expect(resolveEnvsWithKey([])).toEqual([]);
  });

  it('filters out environments with null app', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-1',
        name: 'Test',
        workspaces: [
          {
            id: 'ws-1',
            name: 'WS',
            environments: [
              { name: 'NoApp', rank: 1, app: null },
              { name: 'WithApp', rank: 2, app: { id: 'a', apiKey: 'k' } },
            ],
          },
        ],
      },
    ];
    const result = resolveEnvsWithKey(orgs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('WithApp');
  });

  it('filters out environments with null apiKey', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-1',
        name: 'Test',
        workspaces: [
          {
            id: 'ws-1',
            name: 'WS',
            environments: [
              { name: 'NullKey', rank: 1, app: { id: 'a', apiKey: null } },
              { name: 'HasKey', rank: 2, app: { id: 'b', apiKey: 'real-key' } },
            ],
          },
        ],
      },
    ];
    const result = resolveEnvsWithKey(orgs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('HasKey');
  });

  it('sorts by rank regardless of array order', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-1',
        name: 'Test',
        workspaces: [
          {
            id: 'ws-1',
            name: 'WS',
            environments: [
              { name: 'Third', rank: 3, app: { id: 'a', apiKey: 'k3' } },
              { name: 'First', rank: 1, app: { id: 'b', apiKey: 'k1' } },
              { name: 'Second', rank: 2, app: { id: 'c', apiKey: 'k2' } },
            ],
          },
        ],
      },
    ];
    const result = resolveEnvsWithKey(orgs);
    expect(result.map((e) => e.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('handles workspace with null environments', () => {
    const orgs: AmplitudeOrg[] = [
      {
        id: 'org-1',
        name: 'Test',
        workspaces: [{ id: 'ws-1', name: 'WS', environments: null }],
      },
    ];
    expect(resolveEnvsWithKey(orgs)).toEqual([]);
  });
});
