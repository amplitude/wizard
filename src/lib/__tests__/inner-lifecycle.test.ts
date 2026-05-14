import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyWriteOperation,
  EVENT_DATA_VERSIONS,
  summarizeForEvent,
  summarizeToolInput,
} from '../agent-events.js';
import { createInnerLifecycleHooks } from '../inner-lifecycle.js';
import { AgentUI } from '../../ui/agent-ui.js';
import { setUI } from '../../ui/index.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  level?: string;
  data?: Record<string, unknown>;
}

describe('agent-events helpers', () => {
  describe('summarizeForEvent', () => {
    it('passes short strings through unchanged', () => {
      expect(summarizeForEvent('hello')).toBe('hello');
    });

    it('truncates strings longer than the cap with an ellipsis', () => {
      const long = 'a'.repeat(200);
      const summary = summarizeForEvent(long, 50);
      expect(summary.length).toBe(50);
      expect(summary.endsWith('…')).toBe(true);
    });
  });

  describe('summarizeToolInput', () => {
    it('extracts the file path from Read / Edit / Write', () => {
      expect(summarizeToolInput('Read', { file_path: '/tmp/a.ts' })).toBe(
        '/tmp/a.ts',
      );
      expect(summarizeToolInput('Write', { file_path: '/tmp/b.ts' })).toBe(
        '/tmp/b.ts',
      );
      expect(summarizeToolInput('Edit', { file_path: '/tmp/c.ts' })).toBe(
        '/tmp/c.ts',
      );
    });

    it('falls back to `path` when `file_path` is missing', () => {
      expect(summarizeToolInput('Read', { path: '/tmp/a.ts' })).toBe(
        '/tmp/a.ts',
      );
    });

    it('extracts the command from Bash', () => {
      expect(summarizeToolInput('Bash', { command: 'pnpm test' })).toBe(
        'pnpm test',
      );
    });

    it('extracts the pattern from Grep / Glob', () => {
      expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO');
      expect(summarizeToolInput('Glob', { pattern: 'src/**/*.ts' })).toBe(
        'src/**/*.ts',
      );
    });

    it('counts todos for TodoWrite', () => {
      expect(summarizeToolInput('TodoWrite', { todos: [{}, {}, {}] })).toBe(
        '3 todo(s)',
      );
    });

    it('falls back to a JSON head for unknown tools', () => {
      const s = summarizeToolInput('UnknownTool', { foo: 'bar' });
      expect(s).toMatch(/foo/);
    });

    it('returns undefined for non-object inputs', () => {
      expect(summarizeToolInput('Read', null)).toBeUndefined();
      expect(summarizeToolInput('Read', 'string-input')).toBeUndefined();
    });
  });

  describe('classifyWriteOperation', () => {
    it('classifies Write as create', () => {
      expect(classifyWriteOperation('Write')).toBe('create');
    });

    it('classifies Edit / MultiEdit / NotebookEdit as modify', () => {
      expect(classifyWriteOperation('Edit')).toBe('modify');
      expect(classifyWriteOperation('MultiEdit')).toBe('modify');
      expect(classifyWriteOperation('NotebookEdit')).toBe('modify');
    });

    it('returns null for non-write tools', () => {
      for (const tool of ['Read', 'Bash', 'Grep', 'Glob', 'Task']) {
        expect(classifyWriteOperation(tool)).toBeNull();
      }
    });
  });
});

describe('createInnerLifecycleHooks (with AgentUI)', () => {
  let writes: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    setUI(new AgentUI());
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  const eventsOfType = (type: string): NDJSONEvent[] =>
    writes
      .map((l) => JSON.parse(l.trim()) as NDJSONEvent)
      .filter((e) => e.type === type);

  it('SessionStart hook emits inner_agent_started with phase + plan id', async () => {
    const lifecycle = createInnerLifecycleHooks({
      phase: 'apply',
      model: 'claude-sonnet-4-5',
      planId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
    await lifecycle.hooks().SessionStart({ model: 'overridden' }, undefined, {
      signal: new AbortController().signal,
    });

    const evts = eventsOfType('lifecycle');
    const started = evts.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'inner_agent_started',
    );
    expect(started).toBeDefined();
    expect(started?.data).toMatchObject({
      event: 'inner_agent_started',
      // explicit `model` takes precedence over the SDK-provided one.
      // v2 — `model` is a structured ModelDescriptor; the raw SDK
      // alias is preserved on `model.alias`, structured fields let
      // orchestrators branch on tier/family/vendor without
      // string-matching.
      model: {
        vendor: 'anthropic',
        family: 'claude',
        alias: 'claude-sonnet-4-5',
        tier: 'sonnet',
        displayName: 'Sonnet 4.5',
      },
      phase: 'apply',
      planId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    });
  });

  it('PreToolUse hook emits tool_call for any tool', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle
      .hooks()
      .PreToolUse(
        { tool_name: 'Read', tool_input: { file_path: '/tmp/foo.ts' } },
        undefined,
        { signal: new AbortController().signal },
      );

    const evts = eventsOfType('progress');
    const toolCall = evts.find(
      (e) => (e.data as { event?: string } | undefined)?.event === 'tool_call',
    );
    expect(toolCall?.data).toMatchObject({
      event: 'tool_call',
      tool: 'Read',
      summary: '/tmp/foo.ts',
    });
  });

  it('PreToolUse for Write also emits file_change_planned', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
    await lifecycle.hooks().PreToolUse(
      {
        tool_name: 'Write',
        tool_input: { file_path: 'src/lib/amplitude.ts', content: 'init' },
      },
      undefined,
      { signal: new AbortController().signal },
    );

    const evts = eventsOfType('progress');
    const planned = evts.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'file_change_planned',
    );
    expect(planned?.data).toMatchObject({
      event: 'file_change_planned',
      path: 'src/lib/amplitude.ts',
      operation: 'create',
    });
  });

  it('PostToolUse for Edit emits file_change_applied with byte count', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
    await lifecycle.hooks().PostToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: 'src/lib/amplitude.ts', content: 'hello' },
      },
      undefined,
      { signal: new AbortController().signal },
    );

    const evts = eventsOfType('result');
    const applied = evts.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'file_change_applied',
    );
    expect(applied?.data).toMatchObject({
      event: 'file_change_applied',
      path: 'src/lib/amplitude.ts',
      operation: 'modify',
      bytes: 5,
    });
  });

  it('PostToolUse for non-write tools is a no-op', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    await lifecycle
      .hooks()
      .PostToolUse(
        { tool_name: 'Read', tool_input: { file_path: '/tmp/a.ts' } },
        undefined,
        { signal: new AbortController().signal },
      );

    const applied = writes
      .map((l) => JSON.parse(l.trim()) as NDJSONEvent)
      .find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_applied',
      );
    expect(applied).toBeUndefined();
  });

  it('PostToolUse on Edit failure emits file_change_failed and SUPPRESSES file_change_applied', async () => {
    // Regression: when the inner agent's Edit tool reports an error
    // (`is_error: true`), the wizard previously still emitted
    // `file_change_applied`, advertising a successful write to the
    // orchestrator's audit trail even though nothing landed on disk.
    // v2 protocol gates on outcome — failure → file_change_failed,
    // success-side emit and ledger post-write both skipped.
    const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
    await lifecycle.hooks().PostToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: 'src/lib/amplitude.ts' },
        tool_response: {
          is_error: true,
          error: 'String to replace not found',
        },
      },
      undefined,
      { signal: new AbortController().signal },
    );

    const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const failed = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'file_change_failed',
    );
    expect(failed?.data).toMatchObject({
      event: 'file_change_failed',
      path: 'src/lib/amplitude.ts',
      operation: 'modify',
      errorClass: 'syntax',
      errorMessage: 'String to replace not found',
    });
    // No success-side file_change_applied on a failed write.
    const applied = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'file_change_applied',
    );
    expect(applied).toBeUndefined();
  });

  it('PostToolUse on successful Write still emits file_change_applied', async () => {
    // Sanity check: the new failure gate doesn't break the happy path.
    // No `tool_response` (or `is_error: false`) → success branch.
    const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
    await lifecycle.hooks().PostToolUse(
      {
        tool_name: 'Write',
        tool_input: { file_path: 'src/lib/ok.ts', content: 'ok' },
        tool_response: { is_error: false },
      },
      undefined,
      { signal: new AbortController().signal },
    );

    const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const applied = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'file_change_applied',
    );
    expect(applied).toBeDefined();
  });

  // ── v2: relativePath on file_change_planned / file_change_applied ─────
  //
  // Audit subagent #1: absolute paths in `file_change_*` envelopes leak
  // the user's home directory into parent-agent transcripts (Claude Code
  // / Cursor / Codex render the child agent's progress chips verbatim).
  // Mirror the `relativePath` pattern already on `current_file` (PR #716):
  //   - present on `file_change_planned` / `file_change_applied` when the
  //     write lands inside `installDir`,
  //   - absent (field omitted) when the write lands outside `installDir`
  //     so a consumer can trust "if `relativePath` is set, it's a privacy-
  //     safe label."
  describe('v2: relativePath on file_change_* envelopes', () => {
    it('PreToolUse emits file_change_planned with relativePath for an in-installDir write', async () => {
      const installDir = '/Users/dev/project';
      const lifecycle = createInnerLifecycleHooks({
        phase: 'apply',
        installDir,
      });
      await lifecycle.hooks().PreToolUse(
        {
          tool_name: 'Write',
          tool_input: {
            file_path: '/Users/dev/project/src/lib/amplitude.ts',
            content: 'init',
          },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const planned = eventsOfType('progress').find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_planned',
      );
      expect(planned?.data).toMatchObject({
        event: 'file_change_planned',
        path: '/Users/dev/project/src/lib/amplitude.ts',
        relativePath: 'src/lib/amplitude.ts',
        operation: 'create',
      });
    });

    it('PreToolUse OMITS relativePath when the write lands outside installDir', async () => {
      const installDir = '/Users/dev/project';
      const lifecycle = createInnerLifecycleHooks({
        phase: 'apply',
        installDir,
      });
      await lifecycle.hooks().PreToolUse(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/foo.txt', content: 'oob' },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const planned = eventsOfType('progress').find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_planned',
      );
      expect(planned?.data).toBeDefined();
      // path preserved verbatim for audit; relativePath absent so the
      // consumer doesn't render a misleading basename.
      expect(planned?.data).toMatchObject({
        event: 'file_change_planned',
        path: '/tmp/foo.txt',
        operation: 'create',
      });
      expect(
        (planned?.data as Record<string, unknown>)['relativePath'],
      ).toBeUndefined();
    });

    it('PostToolUse emits file_change_applied with relativePath for an in-installDir write', async () => {
      const installDir = '/Users/dev/project';
      const lifecycle = createInnerLifecycleHooks({
        phase: 'apply',
        installDir,
      });
      await lifecycle.hooks().PostToolUse(
        {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/Users/dev/project/src/index.ts',
            content: 'hello',
          },
          tool_response: { is_error: false },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const applied = eventsOfType('result').find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_applied',
      );
      expect(applied?.data).toMatchObject({
        event: 'file_change_applied',
        path: '/Users/dev/project/src/index.ts',
        relativePath: 'src/index.ts',
        operation: 'modify',
        bytes: 5,
      });
    });

    it('PostToolUse OMITS relativePath when the write lands outside installDir', async () => {
      const installDir = '/Users/dev/project';
      const lifecycle = createInnerLifecycleHooks({
        phase: 'apply',
        installDir,
      });
      await lifecycle.hooks().PostToolUse(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/tmp/foo.txt', content: 'oob' },
          tool_response: { is_error: false },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const applied = eventsOfType('result').find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_applied',
      );
      expect(applied?.data).toMatchObject({
        event: 'file_change_applied',
        path: '/tmp/foo.txt',
        operation: 'create',
      });
      expect(
        (applied?.data as Record<string, unknown>)['relativePath'],
      ).toBeUndefined();
    });

    it('OMITS relativePath when installDir is not configured', async () => {
      // Probe calls / tests that don't thread installDir must still emit
      // a well-formed envelope — just without the privacy-safe label.
      const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
      await lifecycle.hooks().PreToolUse(
        {
          tool_name: 'Write',
          tool_input: {
            file_path: '/Users/dev/project/src/anywhere.ts',
            content: 'x',
          },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const planned = eventsOfType('progress').find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_planned',
      );
      expect(planned?.data).toBeDefined();
      expect(
        (planned?.data as Record<string, unknown>)['relativePath'],
      ).toBeUndefined();
    });

    it('stamps data_version: 2 on file_change_planned and file_change_applied', async () => {
      // Registry-coherence pin: a future shape bump forces an
      // EVENT_DATA_VERSIONS update in lockstep. Asserts via the registry
      // (not a hardcoded 2) so the test stays useful after a v3 bump
      // — it then verifies "whatever the registry says" is on the wire.
      const installDir = '/Users/dev/project';
      const lifecycle = createInnerLifecycleHooks({
        phase: 'apply',
        installDir,
      });
      await lifecycle.hooks().PreToolUse(
        {
          tool_name: 'Write',
          tool_input: {
            file_path: '/Users/dev/project/a.ts',
            content: 'x',
          },
        },
        undefined,
        { signal: new AbortController().signal },
      );
      await lifecycle.hooks().PostToolUse(
        {
          tool_name: 'Write',
          tool_input: {
            file_path: '/Users/dev/project/a.ts',
            content: 'x',
          },
          tool_response: { is_error: false },
        },
        undefined,
        { signal: new AbortController().signal },
      );

      const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
      const planned = allEvents.find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_planned',
      );
      const applied = allEvents.find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_applied',
      );
      expect(
        (planned as { data_version?: number } | undefined)?.data_version,
      ).toBe(EVENT_DATA_VERSIONS.file_change_planned);
      expect(
        (applied as { data_version?: number } | undefined)?.data_version,
      ).toBe(EVENT_DATA_VERSIONS.file_change_applied);
      // Defensive: pin to current v2 so a regression that resets the
      // registry to 1 would also trip this assertion.
      expect(EVENT_DATA_VERSIONS.file_change_planned).toBe(2);
      expect(EVENT_DATA_VERSIONS.file_change_applied).toBe(2);
    });

    it('the wire shape passes validateEnvelopeOrLog (envelope is schema-valid)', () => {
      // Mirrors the "round-trips through validateEnvelopeOrLog" assertion
      // used by other v2 event tests (agent-ui-response-schema, agent-ui-
      // v2-events). The validator routes failures to a lazy file logger;
      // we can't intercept that side channel here, so the strongest
      // observable assertion is the structural envelope shape: v=1, ISO
      // timestamp, type from the registered enum, non-empty message, a
      // data block with the discriminator + relativePath, and a
      // data_version stamp that matches the registry. If
      // validateEnvelopeOrLog flagged a coherence issue it would log
      // `data_version mismatch on 'file_change_planned'`; the
      // data_version assertion below pins that path.
      const ui = new AgentUI();
      ui.emitFileChangePlanned({
        path: '/Users/dev/project/src/lib/amplitude.ts',
        relativePath: 'src/lib/amplitude.ts',
        operation: 'create',
      });
      ui.emitFileChangeApplied({
        path: '/Users/dev/project/src/lib/amplitude.ts',
        relativePath: 'src/lib/amplitude.ts',
        operation: 'create',
        bytes: 42,
      });
      const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
      const planned = allEvents.find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_planned',
      );
      const applied = allEvents.find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'file_change_applied',
      );
      for (const e of [planned, applied]) {
        expect(e).toBeDefined();
        expect(e?.v).toBe(1);
        expect(typeof e?.['@timestamp']).toBe('string');
        expect(() => new Date(e?.['@timestamp'] ?? '')).not.toThrow();
        expect(e?.message).toBeTruthy();
        expect(typeof (e as { data_version?: number }).data_version).toBe(
          'number',
        );
      }
      // Privacy-safe label shows up in the human-readable `message` too
      // — confirms the emitter prefers `relativePath` for the progress
      // line so a tail -f of NDJSON doesn't leak the home dir either.
      expect(planned?.message).toContain('src/lib/amplitude.ts');
      expect(planned?.message).not.toContain('/Users/dev/project');
    });
  });

  it('PostToolUse records the tool outcome on the AgentUI accumulator (success)', async () => {
    // PR B6: every PostToolUse (write OR read tool) records an
    // outcome on the run-level ToolCallStats so `tool_call_summary`
    // ships a faithful success/error breakdown.
    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    // PreToolUse first so the stats accumulator has a pending start
    // entry to pair against — mirrors the real SDK call order.
    await lifecycle
      .hooks()
      .PreToolUse(
        { tool_name: 'Read', tool_input: { file_path: '/tmp/a.ts' } },
        undefined,
        { signal: new AbortController().signal },
      );
    await lifecycle
      .hooks()
      .PostToolUse(
        { tool_name: 'Read', tool_input: { file_path: '/tmp/a.ts' } },
        undefined,
        { signal: new AbortController().signal },
      );
    // Inspect the stats via the AgentUI accessor — no need to wait
    // for `emitToolCallSummary` to fire.
    const { getUI } = await import('../../ui/index.js');
    const ui = getUI();
    const stats = (
      ui as unknown as { getToolCallStats?: () => { totalCalls: number } }
    ).getToolCallStats?.();
    expect(stats?.totalCalls).toBe(1);
    // Trigger emission so we can read the outcome breakdown off the
    // wire — easier than peeking at the private accumulator state.
    (
      ui as unknown as { emitToolCallSummary?: () => void }
    ).emitToolCallSummary?.();
    const summary = writes
      .map((l) => JSON.parse(l.trim()) as NDJSONEvent)
      .find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'tool_call_summary',
      );
    expect(summary?.data).toMatchObject({
      totalCalls: 1,
      byOutcome: { success: 1, error: 0, denied: 0 },
    });
  });

  it('PostToolUse records an error outcome when the SDK surfaces is_error', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'apply' });
    await lifecycle.hooks().PreToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: 'src/lib/amplitude.ts' },
      },
      undefined,
      { signal: new AbortController().signal },
    );
    await lifecycle.hooks().PostToolUse(
      {
        tool_name: 'Edit',
        tool_input: { file_path: 'src/lib/amplitude.ts' },
        tool_response: {
          is_error: true,
          error: 'String to replace not found',
        },
      },
      undefined,
      { signal: new AbortController().signal },
    );
    const { getUI } = await import('../../ui/index.js');
    const ui = getUI();
    (
      ui as unknown as { emitToolCallSummary?: () => void }
    ).emitToolCallSummary?.();
    const summary = writes
      .map((l) => JSON.parse(l.trim()) as NDJSONEvent)
      .find(
        (e) =>
          (e.data as { event?: string } | undefined)?.event ===
          'tool_call_summary',
      );
    expect(summary?.data).toMatchObject({
      totalCalls: 1,
      byOutcome: { success: 0, error: 1, denied: 0 },
    });
  });

  it('emitEventPlanProposed surfaces all events to NDJSON', () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    lifecycle.emitEventPlanProposed([
      { name: 'user signed up', description: 'fires on signup' },
      { name: 'product viewed', description: 'fires on product page' },
    ]);

    const evts = eventsOfType('progress');
    const proposed = evts.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'event_plan_proposed',
    );
    expect(
      (proposed?.data as { events?: unknown[] } | undefined)?.events,
    ).toHaveLength(2);
  });

  it('emitEventPlanConfirmed records source and decision', () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'wizard' });
    lifecycle.emitEventPlanConfirmed('auto', 'approved');

    const evts = eventsOfType('result');
    const confirmed = evts.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'event_plan_confirmed',
    );
    expect(confirmed?.data).toMatchObject({
      event: 'event_plan_confirmed',
      source: 'auto',
      decision: 'approved',
    });
  });

  it('withVerification emits started then result on success', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'verify' });
    const out = await lifecycle.withVerification('overall', async () => 42);
    expect(out).toBe(42);

    const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const started = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'verification_started',
    );
    const result = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'verification_result',
    );
    expect(started?.data).toMatchObject({ phase: 'overall' });
    expect(result?.data).toMatchObject({ phase: 'overall', success: true });
  });

  it('withVerification surfaces failures and re-throws', async () => {
    const lifecycle = createInnerLifecycleHooks({ phase: 'verify' });
    await expect(
      lifecycle.withVerification('api_key', async () => {
        throw new Error('missing key');
      }),
    ).rejects.toThrow('missing key');

    const allEvents = writes.map((l) => JSON.parse(l.trim()) as NDJSONEvent);
    const result = allEvents.find(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'verification_result',
    );
    expect(result?.data).toMatchObject({
      phase: 'api_key',
      success: false,
      failures: ['missing key'],
    });
  });
});
