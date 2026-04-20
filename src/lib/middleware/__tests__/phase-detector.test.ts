import { describe, it, expect, beforeEach } from 'vitest';
import { PhaseDetector } from '../phase-detector.js';
import type { SDKMessage } from '../types.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function assistantMessage(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
  } as SDKMessage;
}

function messageWithoutStatus(text: string): SDKMessage {
  return assistantMessage(text); // no [STATUS] tag
}

// ── construction ──────────────────────────────────────────────────────────────

describe('PhaseDetector', () => {
  let detector: PhaseDetector;

  beforeEach(() => {
    detector = new PhaseDetector();
  });

  // ── non-assistant messages ───────────────────────────────────────────────

  it('returns null for non-assistant message types', () => {
    const msg = { type: 'tool_result', message: {} } as SDKMessage;
    expect(detector.detect(msg)).toBeNull();
  });

  it('returns null for user messages', () => {
    const msg = { type: 'user', message: {} } as SDKMessage;
    expect(detector.detect(msg)).toBeNull();
  });

  // ── missing/wrong content shape ──────────────────────────────────────────

  it('returns null when message content is not an array', () => {
    const msg = {
      type: 'assistant',
      message: { content: 'plain string' },
    } as unknown as SDKMessage;
    expect(detector.detect(msg)).toBeNull();
  });

  it('returns null when message has no content field', () => {
    const msg = { type: 'assistant', message: {} } as SDKMessage;
    expect(detector.detect(msg)).toBeNull();
  });

  // ── [STATUS] tag required ────────────────────────────────────────────────

  it('returns null when text lacks [STATUS] tag', () => {
    expect(
      detector.detect(messageWithoutStatus('Checking project structure')),
    ).toBeNull();
  });

  // ── phase 1.0-begin ──────────────────────────────────────────────────────

  it('detects 1.0-begin from "Checking project structure"', () => {
    const msg = assistantMessage('[STATUS] Checking project structure');
    expect(detector.detect(msg)).toBe('1.0-begin');
  });

  it('detects 1.0-begin from "Verifying Amplitude dependencies"', () => {
    const msg = assistantMessage('[STATUS] Verifying Amplitude dependencies');
    expect(detector.detect(msg)).toBe('1.0-begin');
  });

  it('detects 1.0-begin from "Generating events based on project"', () => {
    const msg = assistantMessage('[STATUS] Generating events based on project');
    expect(detector.detect(msg)).toBe('1.0-begin');
  });

  // ── phase 1.1-edit ───────────────────────────────────────────────────────

  it('detects 1.1-edit from "Inserting Amplitude capture code" after 1.0-begin', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    const msg = assistantMessage('[STATUS] Inserting Amplitude capture code');
    expect(detector.detect(msg)).toBe('1.1-edit');
  });

  it('does not detect 1.1-edit before 1.0-begin', () => {
    const msg = assistantMessage('[STATUS] Inserting Amplitude capture code');
    expect(detector.detect(msg)).toBeNull();
  });

  // ── phase 1.2-revise ─────────────────────────────────────────────────────

  it('detects 1.2-revise from "Finding and correcting errors" after 1.1-edit', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    const msg = assistantMessage('[STATUS] Finding and correcting errors');
    expect(detector.detect(msg)).toBe('1.2-revise');
  });

  it('detects 1.2-revise from "Linting, building and prettying"', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    const msg = assistantMessage('[STATUS] Linting, building and prettying');
    expect(detector.detect(msg)).toBe('1.2-revise');
  });

  // ── phase 1.3-conclude ───────────────────────────────────────────────────

  it('detects 1.3-conclude from "Configured dashboard" after 1.2-revise', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    detector.detect(assistantMessage('[STATUS] Finding and correcting errors'));
    const msg = assistantMessage('[STATUS] Configured dashboard');
    expect(detector.detect(msg)).toBe('1.3-conclude');
  });

  it('detects 1.3-conclude from "Created setup report"', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    detector.detect(assistantMessage('[STATUS] Finding and correcting errors'));
    const msg = assistantMessage('[STATUS] Created setup report');
    expect(detector.detect(msg)).toBe('1.3-conclude');
  });

  // ── no further phases after 1.3-conclude ─────────────────────────────────

  it('returns null after the final phase 1.3-conclude is reached', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    detector.detect(assistantMessage('[STATUS] Finding and correcting errors'));
    detector.detect(assistantMessage('[STATUS] Configured dashboard'));
    // No next phase — returns null
    expect(
      detector.detect(assistantMessage('[STATUS] Configured dashboard')),
    ).toBeNull();
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it('reset() returns the detector to its initial state', () => {
    detector.detect(assistantMessage('[STATUS] Checking project structure'));
    detector.detect(
      assistantMessage('[STATUS] Inserting Amplitude capture code'),
    );
    detector.reset();
    // After reset, 1.0-begin should be detectable again
    const msg = assistantMessage('[STATUS] Checking project structure');
    expect(detector.detect(msg)).toBe('1.0-begin');
  });

  // ── non-text content blocks ───────────────────────────────────────────────

  it('ignores non-text content blocks', () => {
    const msg = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_1' },
          { type: 'text', text: '[STATUS] Checking project structure' },
        ],
      },
    } as unknown as SDKMessage;
    expect(detector.detect(msg)).toBe('1.0-begin');
  });

  it('returns null when all content blocks are non-text', () => {
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1' }],
      },
    } as unknown as SDKMessage;
    expect(detector.detect(msg)).toBeNull();
  });
});
