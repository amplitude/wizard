import { describe, it, expect } from 'vitest';
import { extractAppId } from '../api';
import type { AmplitudeProject } from '../api';

function makeProject(
  environments:
    | Array<{ rank: number; appId: string | null }>
    | null
    | undefined,
): AmplitudeProject {
  return {
    id: 'proj-1',
    name: 'Test Project',
    environments: environments?.map((e, i) => ({
      name: `env-${i}`,
      rank: e.rank,
      app: e.appId ? { id: e.appId } : null,
    })),
  };
}

describe('extractAppId', () => {
  it('returns the app ID from the lowest-rank environment', () => {
    const project = makeProject([
      { rank: 2, appId: 'app-high' },
      { rank: 1, appId: 'app-low' },
      { rank: 3, appId: 'app-higher' },
    ]);
    expect(extractAppId(project)).toBe('app-low');
  });

  it('skips environments where app is null', () => {
    const project = makeProject([
      { rank: 1, appId: null },
      { rank: 2, appId: 'app-2' },
    ]);
    expect(extractAppId(project)).toBe('app-2');
  });

  it('returns null when all environments have null app', () => {
    const project = makeProject([
      { rank: 1, appId: null },
      { rank: 2, appId: null },
    ]);
    expect(extractAppId(project)).toBeNull();
  });

  it('returns null when environments array is empty', () => {
    expect(extractAppId(makeProject([]))).toBeNull();
  });

  it('returns null when environments is null', () => {
    expect(extractAppId(makeProject(null))).toBeNull();
  });

  it('returns null when environments is undefined', () => {
    expect(extractAppId(makeProject(undefined))).toBeNull();
  });

  it('returns the only environment when there is one', () => {
    const project = makeProject([{ rank: 5, appId: 'only-app' }]);
    expect(extractAppId(project)).toBe('only-app');
  });

  it('does not mutate the original environments array', () => {
    const envs: AmplitudeProject['environments'] = [
      { name: 'a', rank: 3, app: { id: 'x' } },
      { name: 'b', rank: 1, app: { id: 'y' } },
    ];
    const project: AmplitudeProject = {
      id: 'p',
      name: 'P',
      environments: envs,
    };
    extractAppId(project);
    expect(envs[0].rank).toBe(3);
    expect(envs[1].rank).toBe(1);
  });
});
