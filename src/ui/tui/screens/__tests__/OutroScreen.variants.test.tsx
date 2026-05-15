/**
 * OutroScreen — three-variant rendering under WIZARD_NEW_UX.
 *
 * The new-UX gate adds structured `loginCommand` / `resumeCommand`
 * hints to the Error variant so a TUI user sees the same actionable
 * copy a CI/agent-mode operator would read off the NDJSON
 * `emitAuthRequired` envelope. Success and Cancel variants remain
 * unchanged across the gate — assert by negative.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Default to "interactive" so the retry hint renders. Tests that need
// the non-interactive path override per-case.
vi.mock('../../utils/outro-mode.js', () => ({
  isInteractiveOutro: vi.fn(() => true),
}));

import { OutroScreen } from '../OutroScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';

describe('OutroScreen — variants under WIZARD_NEW_UX', () => {
  const ORIGINAL_GATE = process.env.WIZARD_NEW_UX;

  beforeEach(() => {
    process.env.WIZARD_NEW_UX = '1';
  });

  afterEach(() => {
    if (ORIGINAL_GATE === undefined) {
      delete process.env.WIZARD_NEW_UX;
    } else {
      process.env.WIZARD_NEW_UX = ORIGINAL_GATE;
    }
  });

  it('success variant: unchanged across the gate (no login/resume hint)', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Success, changes: ['Wired tracking'] },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Amplitude is live');
    // Success is the happy path — no recovery hints.
    expect(frame).not.toContain('Sign in: npx @amplitude/wizard login');
    expect(frame).not.toContain('Resume: npx @amplitude/wizard');
  });

  it('cancel variant: neutral copy, no login/resume hint (cancel is not an error)', () => {
    const store = makeStoreForSnapshot({
      outroData: { kind: OutroKind.Cancel, message: 'Setup cancelled.' },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup cancelled');
    // The existing "Resume later" forward-looking line is preserved,
    // but the new structured `Sign in:` / `Resume:` payload is reserved
    // for the Error variant.
    expect(frame).not.toContain('Sign in: npx @amplitude/wizard login');
  });

  it('error variant (non-auth): always surfaces the resume command', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: 'Something broke.',
        promptLogin: false,
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup failed');
    // Non-auth failure — login hint suppressed, resume hint always on.
    expect(frame).not.toContain('Sign in: npx @amplitude/wizard login');
    expect(frame).toContain('Resume: npx @amplitude/wizard');
  });

  it('error variant (auth): surfaces BOTH login and resume commands', () => {
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: 'Token expired.',
        promptLogin: true,
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup failed');
    expect(frame).toContain('Sign in: npx @amplitude/wizard login');
    expect(frame).toContain('Resume: npx @amplitude/wizard');
  });

  it('error variant: legacy view (gate off) omits the structured hints', () => {
    delete process.env.WIZARD_NEW_UX;
    const store = makeStoreForSnapshot({
      outroData: {
        kind: OutroKind.Error,
        message: 'Something broke.',
        promptLogin: true,
      },
    });
    const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
    expect(frame).toContain('Setup failed');
    // Legacy view keeps the original troubleshooting block but not the
    // new `Sign in:` / `Resume:` lines.
    expect(frame).not.toContain('Sign in: npx @amplitude/wizard login');
    expect(frame).not.toContain('Resume: npx @amplitude/wizard');
  });
});
