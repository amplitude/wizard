import { describe, expect, it, vi } from 'vitest';
import { ToolLoopGuard, createToolLoopHooks } from '../tool-loop-guard';

const read = { file_path: '/fixture/app.ts' };
describe('ToolLoopGuard', () => {
  it('warns on three identical completed calls and stops on the fourth', () => {
    const guard = new ToolLoopGuard();
    expect(guard.observe('Read', read, 'same')).toBeNull();
    expect(guard.observe('Read', read, 'same')).toBeNull();
    expect(guard.observe('Read', read, 'same')).toBe('warn');
    expect(guard.observe('Read', read, 'same')).toBe('stop');
    expect(guard.stopped).toBe(true);
  });
  it('detects a repeated two-tool cycle', () => {
    const guard = new ToolLoopGuard();
    const outcomes = Array.from({ length: 8 }, (_, i) =>
      guard.observe(
        i % 2 ? 'Grep' : 'Read',
        { path: 'app' },
        i % 2 ? 'match' : 'file',
      ),
    );
    expect(outcomes[5]).toBe('warn');
    expect(outcomes[7]).toBe('stop');
  });
  it('detects three-tool cycles and retains only fingerprints', () => {
    const guard = new ToolLoopGuard();
    const names = ['Read', 'Grep', 'Glob'];
    const outcomes = Array.from({ length: 12 }, (_, i) =>
      guard.observe(
        names[i % 3],
        { path: 'secret-source-path' },
        'private-source-contents',
      ),
    );
    expect(outcomes[8]).toBe('warn');
    expect(outcomes[11]).toBe('stop');
    expect(JSON.stringify(guard)).not.toContain('secret-source-path');
    expect(JSON.stringify(guard)).not.toContain('private-source-contents');
  });

  it('ignores object key order and wizard reason prose, but not semantic inputs', () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 3; i++)
      guard.observe(
        'mcp__wizard-tools__detect_package_manager',
        { reason: `attempt ${i}`, dir: '.' },
        { b: 2, a: 1 },
      );
    expect(
      guard.observe(
        'mcp__wizard-tools__detect_package_manager',
        { dir: '.', reason: 'again' },
        { a: 1, b: 2 },
      ),
    ).toBe('stop');
    const changed = new ToolLoopGuard();
    for (let i = 0; i < 12; i++)
      expect(
        changed.observe('Read', { file_path: `${i}.ts` }, 'same'),
      ).toBeNull();
  });
  it('allows changed results, file writes, polling, and a new user turn', () => {
    for (const progress of ['result', 'write', 'poll', 'user']) {
      const guard = new ToolLoopGuard();
      for (let i = 0; i < 3; i++) guard.observe('Read', read, 'same');
      if (progress === 'result') guard.observe('Read', read, 'changed');
      if (progress === 'write') guard.observe('Edit', read, { success: true });
      if (progress === 'poll')
        guard.observe('TaskOutput', { task_id: 'task' }, 'running');
      if (progress === 'user') guard.reset();
      expect(guard.observe('Read', read, 'same')).toBeNull();
      expect(guard.stopped).toBe(false);
    }
  });
  it('does not count duplicate completion hooks or missing results', () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 10; i++)
      expect(guard.observe('Read', read, 'same', 'same-id')).toBeNull();
    for (let i = 0; i < 10; i++)
      expect(guard.observe('Read', read, undefined)).toBeNull();
  });
  it('does not let a reset or additional calls clear a terminal trip', () => {
    const guard = new ToolLoopGuard();
    for (let i = 0; i < 4; i++) guard.observe('Read', read, 'same');
    guard.reset();
    expect(guard.stopped).toBe(true);
  });
  it('bounds history and tolerates non-JSON results without retaining them', () => {
    const guard = new ToolLoopGuard();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => guard.observe('Read', read, circular)).not.toThrow();
    for (let i = 0; i < 1000; i++)
      guard.observe('Read', { file_path: `${i}` }, 'different', `${i}`);
    expect(guard.stopped).toBe(false);
  });
});

describe('tool-loop hooks', () => {
  it('also stops repeated failed executions', async () => {
    const stop = vi.fn();
    const hooks = createToolLoopHooks(new ToolLoopGuard(), stop);
    const opts = { signal: new AbortController().signal };
    for (let i = 0; i < 4; i++)
      await hooks.failure(
        { tool_name: 'Edit', tool_input: read, error: 'old text not found' },
        `failed-${i}`,
        opts,
      );
    expect(stop).toHaveBeenCalledOnce();
  });

  it('warns the model, calls stop once, and denies queued tools after a trip', async () => {
    const stop = vi.fn();
    const hooks = createToolLoopHooks(new ToolLoopGuard(), stop);
    const opts = { signal: new AbortController().signal };
    const input = {
      tool_name: 'Read',
      tool_input: read,
      tool_response: 'same',
    };
    await hooks.post(input, '1', opts);
    await hooks.post(input, '2', opts);
    expect(await hooks.post(input, '3', opts)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringContaining('unchanged'),
      },
    });
    expect(await hooks.post(input, '4', opts)).toMatchObject({
      continue: false,
    });
    await hooks.post(input, '5', opts);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await hooks.pre({}, '6', opts)).toMatchObject({
      continue: false,
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
  });
});
