import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyWriteOperation,
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
      // explicit `model` takes precedence over the SDK-provided one
      model: 'claude-sonnet-4-5',
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
