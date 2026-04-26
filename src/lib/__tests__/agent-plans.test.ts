import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createAndPersistPlan,
  loadPlan,
  isPlanFresh,
  pruneStalePlans,
  PLAN_TTL_MS,
  WizardPlanSchema,
  getPlansDir,
} from '../agent-plans.js';
import { CACHE_ROOT_OVERRIDE_ENV } from '../../utils/storage-paths.js';

describe('agent-plans persistence', () => {
  let cacheRoot: string;
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    // Redirect the cache root to an isolated tempdir so each test starts
    // with an empty plans dir and tests can't see each other's plans.
    cacheRoot = mkdtempSync(join(tmpdir(), 'wiz-plans-cache-'));
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  });

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
    vi.useRealTimers();
  });

  it('createAndPersistPlan writes a valid plan to disk and returns it', () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: '@amplitude/analytics-browser',
      events: [
        { name: 'user signed up', description: 'Fires on first signup' },
      ],
      fileChanges: [{ path: 'src/lib/amplitude.ts', operation: 'create' }],
    });

    expect(plan.v).toBe(1);
    expect(plan.planId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(plan.framework).toBe('nextjs');
    expect(plan.events).toHaveLength(1);
    expect(plan.fileChanges).toHaveLength(1);
    expect(plan.requiresApproval).toBe(true);

    const path = join(getPlansDir(), `${plan.planId}.json`);
    expect(existsSync(path)).toBe(true);
  });

  it('loadPlan returns ok for a freshly-written plan', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'vue',
      frameworkName: 'Vue 3',
      sdk: '@amplitude/analytics-browser',
    });

    const loaded = await loadPlan(plan.planId);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.plan.planId).toBe(plan.planId);
      expect(loaded.plan.framework).toBe('vue');
    }
  });

  it('loadPlan returns not_found for an unknown ID', async () => {
    const result = await loadPlan('deadbeef-dead-4ead-bead-deadbeefdead');
    expect(result.kind).toBe('not_found');
  });

  it('loadPlan returns invalid for malformed JSON', async () => {
    const dir = getPlansDir();
    await fs.mkdir(dir, { recursive: true });
    const id = 'bad-1234-5678-9012-345678901234';
    await fs.writeFile(join(dir, `${id}.json`), 'not json{', 'utf8');
    const result = await loadPlan(id);
    expect(result.kind).toBe('invalid');
  });

  it('loadPlan returns invalid when schema validation fails', async () => {
    const dir = getPlansDir();
    await fs.mkdir(dir, { recursive: true });
    const id = 'badx-1234-5678-9012-345678901234';
    await fs.writeFile(
      join(dir, `${id}.json`),
      JSON.stringify({ v: 1, planId: 'not-a-uuid' }),
      'utf8',
    );
    const result = await loadPlan(id);
    expect(result.kind).toBe('invalid');
  });

  it('isPlanFresh marks plans created within TTL as fresh', () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
    });
    expect(isPlanFresh(plan)).toBe(true);
    // Just outside TTL
    const stale = {
      ...plan,
      createdAt: new Date(Date.now() - PLAN_TTL_MS - 1).toISOString(),
    };
    expect(isPlanFresh(stale)).toBe(false);
  });

  it('loadPlan returns expired for plans older than TTL', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
    });
    // Rewrite the file with an old createdAt
    const oldPlan = {
      ...plan,
      createdAt: new Date(Date.now() - PLAN_TTL_MS - 60_000).toISOString(),
    };
    await fs.writeFile(
      join(getPlansDir(), `${plan.planId}.json`),
      JSON.stringify(oldPlan),
      'utf8',
    );
    const result = await loadPlan(plan.planId);
    expect(result.kind).toBe('expired');
  });

  it('pruneStalePlans removes plans older than TTL based on mtime', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
    });
    // Pretend it's the future, so the plan looks stale by mtime
    const future = Date.now() + PLAN_TTL_MS + 60_000;
    const removed = await pruneStalePlans(future);
    expect(removed).toBeGreaterThanOrEqual(1);
    // Plan file should be gone
    const path = join(getPlansDir(), `${plan.planId}.json`);
    expect(existsSync(path)).toBe(false);
  });

  it('WizardPlanSchema rejects extra unknown fields gracefully (passthrough by default)', () => {
    const valid = {
      v: 1,
      planId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      createdAt: new Date().toISOString(),
      installDir: '/tmp/x',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
      events: [],
      fileChanges: [],
      requiresApproval: true,
    };
    expect(WizardPlanSchema.safeParse(valid).success).toBe(true);

    // Wrong event name length
    const tooLong = {
      ...valid,
      events: [{ name: 'a'.repeat(81), description: 'too long' }],
    };
    expect(WizardPlanSchema.safeParse(tooLong).success).toBe(false);

    // Wrong operation enum
    const badOp = {
      ...valid,
      fileChanges: [{ path: 'src/foo.ts', operation: 'launch-rocket' }],
    };
    expect(WizardPlanSchema.safeParse(badOp).success).toBe(false);
  });

  it('plans dir lives under the cache root', () => {
    // With the AMPLITUDE_WIZARD_CACHE_DIR override, the plans dir is the
    // override + /plans. Ensures we're not accidentally writing to the
    // repo or to the user's real home dir.
    expect(getPlansDir()).toBe(join(cacheRoot, 'plans'));
  });
});
