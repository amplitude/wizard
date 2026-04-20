import { describe, it, expect, vi } from 'vitest';
import { MiddlewarePipeline } from '../pipeline.js';
import { PhaseDetector } from '../phase-detector.js';
import type { Middleware, MiddlewareContext, SDKMessage } from '../types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function assistantMessage(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  } as SDKMessage;
}

function resultMessage(): SDKMessage {
  return { type: 'result', result: 'success' } as SDKMessage;
}

function makeMw(overrides?: Partial<Middleware>): Middleware & {
  onInit: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onFinalize: ReturnType<typeof vi.fn>;
  onPhaseTransition: ReturnType<typeof vi.fn>;
} {
  return {
    name: 'test-mw',
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onFinalize: vi.fn(),
    onPhaseTransition: vi.fn(),
    ...overrides,
  };
}

// ── construction / onInit ─────────────────────────────────────────────────────

describe('MiddlewarePipeline', () => {
  it('calls onInit for each middleware at construction time', () => {
    const mw1 = makeMw();
    const mw2 = makeMw({ name: 'mw2' });
    new MiddlewarePipeline([mw1, mw2]);
    expect(mw1.onInit).toHaveBeenCalledTimes(1);
    expect(mw2.onInit).toHaveBeenCalledTimes(1);
  });

  it('passes a MiddlewareContext to onInit with phase = "setup"', () => {
    const mw = makeMw();
    new MiddlewarePipeline([mw]);
    const ctx: MiddlewareContext = mw.onInit.mock.calls[0][0];
    expect(ctx.currentPhase).toBe('setup');
    expect(ctx.currentPhaseFreshContext).toBe(true);
  });

  it('works when middleware has no optional hooks', () => {
    const minimal: Middleware = { name: 'minimal' };
    expect(() => new MiddlewarePipeline([minimal])).not.toThrow();
  });

  // ── onMessage ───────────────────────────────────────────────────────────

  it('dispatches onMessage to all middleware', () => {
    const mw1 = makeMw();
    const mw2 = makeMw({ name: 'mw2' });
    const pipeline = new MiddlewarePipeline([mw1, mw2]);
    const msg = assistantMessage('hello');

    pipeline.onMessage(msg);

    expect(mw1.onMessage).toHaveBeenCalledWith(
      msg,
      expect.any(Object),
      expect.any(Object),
    );
    expect(mw2.onMessage).toHaveBeenCalledWith(
      msg,
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('context.currentPhase starts as "setup"', () => {
    const mw = makeMw();
    const pipeline = new MiddlewarePipeline([mw]);
    pipeline.onMessage({ type: 'user' } as SDKMessage);
    const ctx: MiddlewareContext = mw.onMessage.mock.calls[0][1];
    expect(ctx.currentPhase).toBe('setup');
  });

  it('auto-detects phase transition on [STATUS] message', () => {
    const mw = makeMw();
    const pipeline = new MiddlewarePipeline([mw]);

    pipeline.onMessage(assistantMessage('[STATUS] Checking project structure'));

    // onPhaseTransition should have been called once (setup → 1.0-begin)
    expect(mw.onPhaseTransition).toHaveBeenCalledWith(
      'setup',
      '1.0-begin',
      expect.any(Object),
      expect.any(Object),
    );

    // Subsequent message should have updated phase in context
    pipeline.onMessage({ type: 'user' } as SDKMessage);
    const ctx: MiddlewareContext = mw.onMessage.mock.calls[1][1];
    expect(ctx.currentPhase).toBe('1.0-begin');
  });

  it('does not auto-detect phases when autoDetectPhases = false', () => {
    const mw = makeMw();
    const pipeline = new MiddlewarePipeline([mw], { autoDetectPhases: false });

    pipeline.onMessage(assistantMessage('[STATUS] Checking project structure'));

    expect(mw.onPhaseTransition).not.toHaveBeenCalled();
  });

  // ── store context read/write ─────────────────────────────────────────────

  it('middleware can write to store and later read it back via context', () => {
    let capturedCtx: MiddlewareContext | null = null;

    const writer: Middleware = {
      name: 'writer',
      onMessage(_msg, _ctx, store) {
        store.set('result', 42);
      },
    };

    const reader: Middleware = {
      name: 'reader',
      onMessage(_msg, ctx) {
        capturedCtx = ctx;
      },
    };

    const pipeline = new MiddlewarePipeline([writer, reader]);
    pipeline.onMessage({ type: 'user' } as SDKMessage);

    // Both writer and reader share the same pipeline-level store
    // Next onMessage the value should be available
    pipeline.onMessage({ type: 'user' } as SDKMessage);
    expect(capturedCtx!.get<number>('result')).toBe(42);
  });

  // ── finalize ─────────────────────────────────────────────────────────────

  it('calls onFinalize for all middleware', () => {
    const mw1 = makeMw();
    const mw2 = makeMw({ name: 'mw2' });
    const pipeline = new MiddlewarePipeline([mw1, mw2]);
    const result = { type: 'result' } as SDKMessage;

    pipeline.finalize(result, 1234);

    expect(mw1.onFinalize).toHaveBeenCalledWith(
      result,
      1234,
      expect.any(Object),
      expect.any(Object),
    );
    expect(mw2.onFinalize).toHaveBeenCalledWith(
      result,
      1234,
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('finalize returns the value from the last middleware that returns something', () => {
    const mw1: Middleware = {
      name: 'mw1',
      onFinalize: () => 'first',
    };
    const mw2: Middleware = {
      name: 'mw2',
      onFinalize: () => 'second',
    };
    const mw3: Middleware = {
      name: 'mw3',
      // returns nothing
    };
    const pipeline = new MiddlewarePipeline([mw1, mw2, mw3]);
    expect(pipeline.finalize(resultMessage(), 0)).toBe('second');
  });

  it('finalize returns undefined when no middleware returns a value', () => {
    const mw = makeMw();
    mw.onFinalize.mockReturnValue(undefined);
    const pipeline = new MiddlewarePipeline([mw]);
    expect(pipeline.finalize(resultMessage(), 0)).toBeUndefined();
  });

  // ── startPhase ────────────────────────────────────────────────────────────

  it('startPhase triggers onPhaseTransition for all middleware', () => {
    const mw = makeMw();
    const pipeline = new MiddlewarePipeline([mw]);

    pipeline.startPhase('1.1-edit', true);

    expect(mw.onPhaseTransition).toHaveBeenCalledWith(
      'setup',
      '1.1-edit',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('startPhase updates currentPhase in context', () => {
    const mw = makeMw();
    const pipeline = new MiddlewarePipeline([mw]);

    pipeline.startPhase('1.2-revise', false);
    pipeline.onMessage({ type: 'user' } as SDKMessage);

    const ctx: MiddlewareContext = mw.onMessage.mock.calls[0][1];
    expect(ctx.currentPhase).toBe('1.2-revise');
    expect(ctx.currentPhaseFreshContext).toBe(false);
  });

  // ── custom PhaseDetector ──────────────────────────────────────────────────

  it('accepts a custom PhaseDetector instance', () => {
    const customDetector = new PhaseDetector();
    const mw = makeMw();
    expect(
      () => new MiddlewarePipeline([mw], { phaseDetector: customDetector }),
    ).not.toThrow();
  });

  // ── empty middleware list ─────────────────────────────────────────────────

  it('works with an empty middleware list', () => {
    const pipeline = new MiddlewarePipeline([]);
    expect(() =>
      pipeline.onMessage({ type: 'user' } as SDKMessage),
    ).not.toThrow();
    expect(() => pipeline.finalize(resultMessage(), 0)).not.toThrow();
  });
});
