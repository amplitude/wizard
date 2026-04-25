import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createAndPersistPlan,
  loadPlan,
  isPlanFresh,
  pruneStalePlans,
  applyPlanPatch,
  getApplyContextFromEnv,
  PLAN_TTL_MS,
  WizardPlanSchema,
  getPlansDir,
} from '../agent-plans.js';

describe('agent-plans persistence', () => {
  beforeEach(async () => {
    // Clean any leftover plans from previous test runs in this process
    const dir = getPlansDir();
    if (existsSync(dir)) {
      const entries = await fs.readdir(dir);
      for (const e of entries) {
        if (e.endsWith('.json')) {
          await fs.unlink(join(dir, e)).catch(() => undefined);
        }
      }
    }
  });

  afterEach(() => {
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
    const id = 'bad-1234-5678-9012-345678901234';
    await fs.writeFile(join(dir, `${id}.json`), 'not json{', 'utf8');
    const result = await loadPlan(id);
    expect(result.kind).toBe('invalid');
  });

  it('loadPlan returns invalid when schema validation fails', async () => {
    const dir = getPlansDir();
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

  it('plans dir lives under tmpdir() (not in repo)', () => {
    expect(getPlansDir().startsWith(tmpdir())).toBe(true);
  });

  // ── applyPlanPatch ──────────────────────────────────────────────────

  it('applyPlanPatch records agentSessionId and stamps agentSessionUpdatedAt', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: '@amplitude/analytics-browser',
    });
    expect(plan.agentSessionId).toBeUndefined();

    const updated = await applyPlanPatch(plan.planId, {
      agentSessionId: 'sdk-sess-1234',
    });

    expect(updated).not.toBeNull();
    expect(updated?.agentSessionId).toBe('sdk-sess-1234');
    expect(updated?.agentSessionUpdatedAt).toBeTruthy();
    // Persists across reads
    const reloaded = await loadPlan(plan.planId);
    expect(reloaded.kind).toBe('ok');
    if (reloaded.kind === 'ok') {
      expect(reloaded.plan.agentSessionId).toBe('sdk-sess-1234');
    }
  });

  it('applyPlanPatch returns null for unknown plan ids (no throw)', async () => {
    const result = await applyPlanPatch(
      'deadbeef-dead-4ead-bead-deadbeefdead',
      { agentSessionId: 'x' },
    );
    expect(result).toBeNull();
  });

  it('applyPlanPatch can update events and fileChanges', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
    });
    const updated = await applyPlanPatch(plan.planId, {
      events: [{ name: 'user signed up', description: 'fires on signup' }],
      fileChanges: [{ path: 'src/foo.ts', operation: 'create' }],
    });
    expect(updated?.events).toHaveLength(1);
    expect(updated?.fileChanges).toHaveLength(1);
  });

  it('applyPlanPatch preserves agentSessionId on unrelated patches', async () => {
    const plan = createAndPersistPlan({
      installDir: '/tmp/example',
      framework: 'nextjs',
      frameworkName: 'Next.js',
      sdk: null,
    });
    await applyPlanPatch(plan.planId, { agentSessionId: 'sess-1' });
    const after = await applyPlanPatch(plan.planId, {
      events: [{ name: 'event', description: 'd' }],
    });
    expect(after?.agentSessionId).toBe('sess-1');
  });

  // ── getApplyContextFromEnv ──────────────────────────────────────────

  it('getApplyContextFromEnv reads both env vars when set', () => {
    const prev = {
      planId: process.env.AMPLITUDE_WIZARD_PLAN_ID,
      resume: process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID,
    };
    process.env.AMPLITUDE_WIZARD_PLAN_ID = 'plan-abc';
    process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID = 'sess-xyz';
    try {
      const ctx = getApplyContextFromEnv();
      expect(ctx).toEqual({
        planId: 'plan-abc',
        resumeSessionId: 'sess-xyz',
      });
    } finally {
      // Restore to avoid leaking into other tests
      if (prev.planId === undefined)
        delete process.env.AMPLITUDE_WIZARD_PLAN_ID;
      else process.env.AMPLITUDE_WIZARD_PLAN_ID = prev.planId;
      if (prev.resume === undefined)
        delete process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID;
      else process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID = prev.resume;
    }
  });

  it('getApplyContextFromEnv returns nulls when env is empty', () => {
    const prev = {
      planId: process.env.AMPLITUDE_WIZARD_PLAN_ID,
      resume: process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID,
    };
    delete process.env.AMPLITUDE_WIZARD_PLAN_ID;
    delete process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID;
    try {
      expect(getApplyContextFromEnv()).toEqual({
        planId: null,
        resumeSessionId: null,
      });
    } finally {
      if (prev.planId !== undefined)
        process.env.AMPLITUDE_WIZARD_PLAN_ID = prev.planId;
      if (prev.resume !== undefined)
        process.env.AMPLITUDE_WIZARD_RESUME_SESSION_ID = prev.resume;
    }
  });

  it('WizardPlanSchema accepts plans without agentSessionId (back-compat)', () => {
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
  });

  it('WizardPlanSchema accepts plans with agentSessionId', () => {
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
      agentSessionId: 'sdk-sess-1234',
      agentSessionUpdatedAt: new Date().toISOString(),
    };
    expect(WizardPlanSchema.safeParse(valid).success).toBe(true);
  });
});
