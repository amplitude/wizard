/**
 * ExtrasPanel — shared MCP / Slack / Session Replay surface tests.
 *
 * Covers:
 *
 *   1. Each ExtraState renders a distinct glyph (available / queued /
 *      done / skipped) — color isn't load-bearing, the glyph is.
 *   2. The `installing` state renders the BrailleSpinner instead of a
 *      glyph (visual hierarchy: "this is happening RIGHT NOW").
 *   3. ASCII fallback renders `*` / `o` in place of UTF-8 ◆ / ✓ / ○.
 *   4. Framework gating: Session Replay is OMITTED for non-web
 *      frameworks (the SDK isn't available there).
 *   5. Framework gating: web frameworks (Next.js, Vue, React Router,
 *      JavaScript/Web) pass Session Replay through.
 *   6. Detail strings render in muted text after the label.
 *   7. detectMcpClients returns the documented shape and never throws.
 *   8. Empty items list renders nothing (no chrome / no title row).
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import {
  ExtrasPanel,
  detectMcpClients,
  filterExtrasByFramework,
  WEB_FRAMEWORKS,
  type ExtraItem,
} from '../ExtrasPanel.js';
import { Integration } from '../../../../lib/constants.js';

// Strip ANSI escapes for assertion clarity.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function renderFrame(items: ExtraItem[], ascii = false): string {
  const view = render(<ExtrasPanel items={items} ascii={ascii} />);
  const frame = stripAnsi(view.lastFrame() ?? '');
  view.unmount();
  return frame;
}

describe('ExtrasPanel rendering', () => {
  it('renders each non-installing state with its distinct glyph', () => {
    // We render four items (one per non-installing state) and confirm
    // each glyph + label pair shows up. UTF-8 path.
    const items: ExtraItem[] = [
      { kind: 'mcp', label: 'AI Tools', state: 'available' },
      { kind: 'slack', label: 'Slack', state: 'queued' },
      { kind: 'session-replay', label: 'Session Replay', state: 'done' },
      { kind: 'mcp', label: 'Skipped Item', state: 'skipped' },
    ];
    const frame = renderFrame(items);
    expect(frame).toContain('◆');
    expect(frame).toContain('✓');
    expect(frame).toContain('○');
    expect(frame).toContain('AI Tools');
    expect(frame).toContain('Slack');
    expect(frame).toContain('Session Replay');
    expect(frame).toContain('Skipped Item');
  });

  it('shows a spinner (not a glyph) for the installing state', () => {
    const items: ExtraItem[] = [
      { kind: 'mcp', label: 'AI Tools', state: 'installing' },
    ];
    const frame = renderFrame(items);
    // BrailleSpinner draws one of these frames; pin to "any of them".
    expect(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(frame)).toBe(true);
    // Label still appears.
    expect(frame).toContain('AI Tools');
  });

  it('falls back to ASCII glyphs when ascii=true', () => {
    const items: ExtraItem[] = [
      { kind: 'mcp', label: 'AI Tools', state: 'available' },
      { kind: 'slack', label: 'Slack', state: 'done' },
      { kind: 'session-replay', label: 'Session Replay', state: 'skipped' },
    ];
    const frame = renderFrame(items, true);
    expect(frame).toContain('*');
    expect(frame).toContain('o');
    // No UTF-8 ornaments in ASCII mode.
    expect(frame).not.toContain('◆');
    expect(frame).not.toContain('✓');
    expect(frame).not.toContain('○');
  });

  it('renders detail text alongside the label', () => {
    const items: ExtraItem[] = [
      {
        kind: 'mcp',
        label: 'AI Tools',
        state: 'available',
        detail: 'Claude Code + Cursor detected',
      },
    ];
    const frame = renderFrame(items);
    expect(frame).toContain('Claude Code + Cursor detected');
  });

  it('renders nothing when items is empty', () => {
    const view = render(<ExtrasPanel items={[]} />);
    const frame = stripAnsi(view.lastFrame() ?? '').trim();
    view.unmount();
    // An empty ExtrasPanel must not render any chrome / title rows —
    // callers compose it into other layouts and rely on it being a
    // no-op when there's nothing to show.
    expect(frame).toBe('');
  });

  it('renders a title row above the items when provided', () => {
    const items: ExtraItem[] = [
      { kind: 'slack', label: 'Slack', state: 'queued' },
    ];
    const view = render(<ExtrasPanel items={items} title="Also queued" />);
    const frame = stripAnsi(view.lastFrame() ?? '');
    view.unmount();
    expect(frame).toContain('Also queued');
    expect(frame).toContain('Slack');
  });
});

describe('ExtrasPanel framework gating', () => {
  it('omits Session Replay for non-web frameworks', () => {
    const candidate: ExtraItem[] = [
      { kind: 'mcp', label: 'AI Tools', state: 'available' },
      { kind: 'slack', label: 'Slack', state: 'available' },
      {
        kind: 'session-replay',
        label: 'Session Replay',
        state: 'available',
      },
    ];
    // Try a sampling of non-web integrations so a future Integration
    // enum change can't silently re-enable SR for them.
    const nonWeb = [
      Integration.swift,
      Integration.android,
      Integration.flutter,
      Integration.go,
      Integration.java,
      Integration.unreal,
      Integration.unity,
      Integration.python,
      Integration.flask,
      Integration.django,
      Integration.fastapi,
      Integration.javascriptNode,
    ];
    for (const integ of nonWeb) {
      const filtered = filterExtrasByFramework(candidate, integ);
      expect(filtered.some((i) => i.kind === 'session-replay')).toBe(false);
      // MCP / Slack must pass through.
      expect(filtered.some((i) => i.kind === 'mcp')).toBe(true);
      expect(filtered.some((i) => i.kind === 'slack')).toBe(true);
    }
  });

  it('keeps Session Replay for every web framework in WEB_FRAMEWORKS', () => {
    const candidate: ExtraItem[] = [
      {
        kind: 'session-replay',
        label: 'Session Replay',
        state: 'available',
      },
    ];
    for (const integ of WEB_FRAMEWORKS) {
      const filtered = filterExtrasByFramework(candidate, integ);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].kind).toBe('session-replay');
    }
  });

  it('omits Session Replay when integration is null/undefined', () => {
    const candidate: ExtraItem[] = [
      {
        kind: 'session-replay',
        label: 'Session Replay',
        state: 'available',
      },
    ];
    expect(filterExtrasByFramework(candidate, null)).toHaveLength(0);
    expect(filterExtrasByFramework(candidate, undefined)).toHaveLength(0);
  });
});

describe('detectMcpClients', () => {
  it('returns the documented shape without throwing', () => {
    // Pure read of the user's filesystem — must always return the
    // three-boolean shape, even when HOME is unset or paths are
    // missing. The contract matters here because callers feed the
    // result into `summarizeMcpDetection` which assumes the keys
    // exist.
    const result = detectMcpClients();
    expect(typeof result.claudeCode).toBe('boolean');
    expect(typeof result.cursor).toBe('boolean');
    expect(typeof result.zed).toBe('boolean');
  });
});
