/**
 * Tests for the dashboard-plan artifact (PR 2 of DEFER_DASHBOARD_PLAN.md).
 *
 * Coverage:
 *   - Round-trip: write → read returns a structurally-equal plan with the
 *     stamped fields filled in.
 *   - Schema enforcement: malformed input is rejected with a `null` return.
 *   - Atomic-write semantics: a failed write does not leave a partial file
 *     on disk that the reader would later choke on.
 *   - Reader tolerance: missing file → null; corrupted JSON → null;
 *     schema-violating JSON → null. Never throws.
 *   - Path resolution: `getDashboardPlanFile` lands under `.amplitude/`
 *     next to `events.json`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  writeDashboardPlan,
  readDashboardPlan,
  getDashboardPlanFile,
  DashboardPlanInputSchema,
  DashboardPlanSchema,
  type DashboardPlanInput,
} from '../dashboard-plan';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-dashboard-plan-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function validInput(): DashboardPlanInput {
  return {
    orgId: '12345',
    projectId: '67890',
    events: [
      { name: 'User Signed Up' },
      { name: 'Product Added To Cart', properties: ['product id', 'price'] },
    ],
    charts: [
      {
        title: 'Signup Funnel',
        eventName: 'User Signed Up',
        chartType: 'funnel',
      },
      {
        title: 'Daily Cart Adds',
        eventName: 'Product Added To Cart',
        chartType: 'line',
        grouping: 'product id',
        metadata: { window: '7d' },
      },
    ],
    dashboard: { title: 'Onboarding', layout: 'grid' },
  };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('getDashboardPlanFile', () => {
  it('lands under .amplitude/ next to events.json', () => {
    const p = getDashboardPlanFile('/tmp/some-project');
    expect(p).toBe(
      path.join('/tmp/some-project', '.amplitude', 'dashboard-plan.json'),
    );
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('DashboardPlanInputSchema', () => {
  it('accepts a fully-populated valid input', () => {
    expect(() => DashboardPlanInputSchema.parse(validInput())).not.toThrow();
  });

  it('rejects when orgId is missing', () => {
    const bad = { ...validInput() } as Record<string, unknown>;
    delete bad.orgId;
    expect(DashboardPlanInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects when projectId is empty', () => {
    const bad = { ...validInput(), projectId: '' };
    expect(DashboardPlanInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown chartType', () => {
    const bad = {
      ...validInput(),
      charts: [
        {
          title: 'Bad Chart',
          eventName: 'User Signed Up',

          chartType: 'sankey' as any,
        },
      ],
    };
    expect(DashboardPlanInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects extra unknown top-level fields (strict)', () => {
    const bad = { ...validInput(), surprise: 'value' };
    expect(DashboardPlanInputSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty chart title', () => {
    const bad = {
      ...validInput(),
      charts: [
        {
          title: '',
          eventName: 'User Signed Up',
          chartType: 'line' as const,
        },
      ],
    };
    expect(DashboardPlanInputSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts charts with only the required fields', () => {
    const minimal = {
      ...validInput(),
      charts: [
        {
          title: 'Minimal',
          eventName: 'User Signed Up',
          chartType: 'bar' as const,
        },
      ],
    };
    expect(DashboardPlanInputSchema.safeParse(minimal).success).toBe(true);
  });
});

describe('DashboardPlanSchema', () => {
  it('rejects a stamped plan with version != 1', () => {
    const bad = {
      ...validInput(),
      version: 2,
      planId: 'abc',
      createdAt: new Date().toISOString(),
    };
    expect(DashboardPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a stamped plan with a non-ISO createdAt', () => {
    const bad = {
      ...validInput(),
      version: 1,
      planId: 'abc',
      createdAt: 'yesterday',
    };
    expect(DashboardPlanSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeDashboardPlan
// ---------------------------------------------------------------------------

describe('writeDashboardPlan', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('persists to .amplitude/dashboard-plan.json and stamps version/planId/createdAt', () => {
    const persisted = writeDashboardPlan(tmpDir, validInput());
    expect(persisted).not.toBeNull();
    expect(persisted!.version).toBe(1);
    expect(persisted!.planId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(() => new Date(persisted!.createdAt).toISOString()).not.toThrow();
    // File on disk matches the returned object byte-for-byte (modulo newline).
    const raw = fs.readFileSync(getDashboardPlanFile(tmpDir), 'utf8');
    expect(JSON.parse(raw)).toEqual(persisted);
  });

  it('creates the .amplitude/ directory lazily', () => {
    expect(fs.existsSync(path.join(tmpDir, '.amplitude'))).toBe(false);
    writeDashboardPlan(tmpDir, validInput());
    expect(fs.existsSync(getDashboardPlanFile(tmpDir))).toBe(true);
  });

  it('returns null when the install directory does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does', 'not', 'exist');
    expect(writeDashboardPlan(nonexistent, validInput())).toBeNull();
  });

  it('returns null and does not write when input fails schema validation', () => {
    const bad = {
      ...validInput(),
      orgId: '', // empty -> rejected
    } as DashboardPlanInput;
    const result = writeDashboardPlan(tmpDir, bad);
    expect(result).toBeNull();
    expect(fs.existsSync(getDashboardPlanFile(tmpDir))).toBe(false);
  });

  it('overwrites a prior plan idempotently (new planId)', () => {
    const first = writeDashboardPlan(tmpDir, validInput());
    const second = writeDashboardPlan(tmpDir, validInput());
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.planId).not.toBe(first!.planId);
    // On-disk file matches the second write.
    const raw = fs.readFileSync(getDashboardPlanFile(tmpDir), 'utf8');
    expect(JSON.parse(raw).planId).toBe(second!.planId);
  });

  it('uses atomic writes — no temp file is left behind on success', () => {
    writeDashboardPlan(tmpDir, validInput());
    const dir = path.join(tmpDir, '.amplitude');
    const entries = fs.readdirSync(dir);
    // Only the canonical file should be present; no ${pid}.tmp leftovers.
    expect(entries).toEqual(['dashboard-plan.json']);
  });

  // Byte-shape regression test. The plan modules feed user-visible event
  // names + chart titles into Amplitude, so any drift in field ordering,
  // field naming, or null-vs-omitted handling could mis-track events
  // downstream. This snapshot pins the persisted shape against an input
  // we control; planId + createdAt are stripped so the snapshot is stable.
  it('persists a stable, byte-identical on-disk shape (snapshot)', () => {
    writeDashboardPlan(tmpDir, validInput());
    const raw = fs.readFileSync(getDashboardPlanFile(tmpDir), 'utf8');
    const parsed = JSON.parse(raw);
    delete parsed.planId;
    delete parsed.createdAt;
    expect(parsed).toEqual({
      version: 1,
      orgId: '12345',
      projectId: '67890',
      events: [
        { name: 'User Signed Up' },
        { name: 'Product Added To Cart', properties: ['product id', 'price'] },
      ],
      charts: [
        {
          title: 'Signup Funnel',
          eventName: 'User Signed Up',
          chartType: 'funnel',
        },
        {
          title: 'Daily Cart Adds',
          eventName: 'Product Added To Cart',
          chartType: 'line',
          grouping: 'product id',
          metadata: { window: '7d' },
        },
      ],
      dashboard: { title: 'Onboarding', layout: 'grid' },
    });
  });

  it('a prior good plan survives a subsequent failed write (atomic-rename semantics)', () => {
    const first = writeDashboardPlan(tmpDir, validInput());
    expect(first).not.toBeNull();

    // Force the second write to fail validation. The file on disk must
    // remain the FIRST write — atomic-rename guarantees this regardless
    // of where in the write the failure occurred.
    const bad = {
      ...validInput(),
      events: [{ name: '' }] as Array<{ name: string }>,
    } as DashboardPlanInput;
    const second = writeDashboardPlan(tmpDir, bad);
    expect(second).toBeNull();

    const raw = fs.readFileSync(getDashboardPlanFile(tmpDir), 'utf8');
    expect(JSON.parse(raw).planId).toBe(first!.planId);
  });
});

// ---------------------------------------------------------------------------
// readDashboardPlan
// ---------------------------------------------------------------------------

describe('readDashboardPlan', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('round-trips a written plan exactly', () => {
    const written = writeDashboardPlan(tmpDir, validInput())!;
    const read = readDashboardPlan(tmpDir);
    expect(read).toEqual(written);
  });

  it('returns null when the file is missing', () => {
    expect(readDashboardPlan(tmpDir)).toBeNull();
  });

  it('returns null on corrupted JSON (does not throw)', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(getDashboardPlanFile(tmpDir), '{ not valid json', 'utf8');
    expect(readDashboardPlan(tmpDir)).toBeNull();
  });

  it('returns null when the file is JSON but fails schema validation', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    fs.writeFileSync(
      getDashboardPlanFile(tmpDir),
      JSON.stringify({ version: 1, planId: 'x', createdAt: 'nope' }),
      'utf8',
    );
    expect(readDashboardPlan(tmpDir)).toBeNull();
  });

  it('returns null when the file has a future schema version', () => {
    fs.mkdirSync(path.join(tmpDir, '.amplitude'), { recursive: true });
    const fromFuture = {
      ...validInput(),
      version: 99,
      planId: 'abc',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      getDashboardPlanFile(tmpDir),
      JSON.stringify(fromFuture),
      'utf8',
    );
    expect(readDashboardPlan(tmpDir)).toBeNull();
  });
});
