import { describe, it, expect } from 'vitest';
import { extractAppId } from '../api';
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

describe('extractAppId', () => {
  it('returns the app ID from the lowest-rank environment', () => {
    const ws = makeWorkspace([
      { rank: 2, appId: 'app-high' },
      { rank: 1, appId: 'app-low' },
      { rank: 3, appId: 'app-higher' },
    ]);
    expect(extractAppId(ws)).toBe('app-low');
  });

  it('skips environments where app is null', () => {
    const ws = makeWorkspace([
      { rank: 1, appId: null },
      { rank: 2, appId: 'app-2' },
    ]);
    expect(extractAppId(ws)).toBe('app-2');
  });

  it('returns null when all environments have null app', () => {
    const ws = makeWorkspace([
      { rank: 1, appId: null },
      { rank: 2, appId: null },
    ]);
    expect(extractAppId(ws)).toBeNull();
  });

  it('returns null when environments array is empty', () => {
    expect(extractAppId(makeWorkspace([]))).toBeNull();
  });

  it('returns null when environments is null', () => {
    expect(extractAppId(makeWorkspace(null))).toBeNull();
  });

  it('returns null when environments is undefined', () => {
    expect(extractAppId(makeWorkspace(undefined))).toBeNull();
  });

  it('returns the only environment when there is one', () => {
    const ws = makeWorkspace([{ rank: 5, appId: 'only-app' }]);
    expect(extractAppId(ws)).toBe('only-app');
  });

  it('does not mutate the original environments array', () => {
    const envs: AmplitudeWorkspace['environments'] = [
      { name: 'a', rank: 3, app: { id: 'x' } },
      { name: 'b', rank: 1, app: { id: 'y' } },
    ];
    const ws: AmplitudeWorkspace = { id: 'w', name: 'W', environments: envs };
    extractAppId(ws);
    expect(envs[0].rank).toBe(3);
    expect(envs[1].rank).toBe(1);
  });
});
