import { describe, it, expect } from 'vitest';
import { extractProjectId } from '../api';
import type { AmplitudeWorkspace } from '../api';

function makeWorkspace(
  environments:
    | Array<{ rank: number; appId: string | null }>
    | null
    | undefined,
): AmplitudeWorkspace {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    environments: environments?.map((e, i) => ({
      name: `env-${i}`,
      rank: e.rank,
      app: e.appId ? { id: e.appId } : null,
    })),
  };
}

describe('extractProjectId', () => {
  it('returns the app ID from the lowest-rank environment', () => {
    const ws = makeWorkspace([
      { rank: 2, appId: 'proj-high' },
      { rank: 1, appId: 'proj-low' },
      { rank: 3, appId: 'proj-higher' },
    ]);
    expect(extractProjectId(ws)).toBe('proj-low');
  });

  it('skips environments where app is null', () => {
    const ws = makeWorkspace([
      { rank: 1, appId: null },
      { rank: 2, appId: 'proj-2' },
    ]);
    expect(extractProjectId(ws)).toBe('proj-2');
  });

  it('returns null when all environments have null app', () => {
    const ws = makeWorkspace([
      { rank: 1, appId: null },
      { rank: 2, appId: null },
    ]);
    expect(extractProjectId(ws)).toBeNull();
  });

  it('returns null when environments array is empty', () => {
    expect(extractProjectId(makeWorkspace([]))).toBeNull();
  });

  it('returns null when environments is null', () => {
    expect(extractProjectId(makeWorkspace(null))).toBeNull();
  });

  it('returns null when environments is undefined', () => {
    expect(extractProjectId(makeWorkspace(undefined))).toBeNull();
  });

  it('returns the only environment when there is one', () => {
    const ws = makeWorkspace([{ rank: 5, appId: 'only-proj' }]);
    expect(extractProjectId(ws)).toBe('only-proj');
  });

  it('does not mutate the original environments array', () => {
    const envs: AmplitudeWorkspace['environments'] = [
      { name: 'a', rank: 3, app: { id: 'x' } },
      { name: 'b', rank: 1, app: { id: 'y' } },
    ];
    const ws: AmplitudeWorkspace = { id: 'w', name: 'W', environments: envs };
    extractProjectId(ws);
    expect(envs[0].rank).toBe(3);
    expect(envs[1].rank).toBe(1);
  });
});
