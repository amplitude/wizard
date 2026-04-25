/**
 * Ensures the TUI's inline copies of wizard-session enums stay in sync
 * with the canonical definitions. If this test fails, update
 * src/ui/tui/session-constants.ts to match src/lib/wizard-session.ts.
 */
import { describe, expect, it } from 'vitest';

import * as canonical from '../../../lib/wizard-session';
import * as tui from '../session-constants';

describe('session-constants sync', () => {
  it('RunPhase values match wizard-session', () => {
    expect(tui.RunPhase).toStrictEqual(canonical.RunPhase);
  });

  it('McpOutcome values match wizard-session', () => {
    expect(tui.McpOutcome).toStrictEqual(canonical.McpOutcome);
  });

  it('SlackOutcome values match wizard-session', () => {
    expect(tui.SlackOutcome).toStrictEqual(canonical.SlackOutcome);
  });

  it('OutroKind values match wizard-session', () => {
    expect(tui.OutroKind).toStrictEqual(canonical.OutroKind);
  });

  it('AdditionalFeature values match wizard-session', () => {
    expect(tui.AdditionalFeature).toStrictEqual(canonical.AdditionalFeature);
  });

  it('ADDITIONAL_FEATURE_LABELS values match wizard-session', () => {
    expect(tui.ADDITIONAL_FEATURE_LABELS).toStrictEqual(
      canonical.ADDITIONAL_FEATURE_LABELS,
    );
  });

  it('INLINE_FEATURES values match wizard-session', () => {
    expect([...tui.INLINE_FEATURES].sort()).toStrictEqual(
      [...canonical.INLINE_FEATURES].sort(),
    );
  });

  it('TRAILING_FEATURES values match wizard-session', () => {
    expect([...tui.TRAILING_FEATURES].sort()).toStrictEqual(
      [...canonical.TRAILING_FEATURES].sort(),
    );
  });

  it('OPT_IN_DISCOVERED_FEATURES values match wizard-session', () => {
    expect([...tui.OPT_IN_DISCOVERED_FEATURES].sort()).toStrictEqual(
      [...canonical.OPT_IN_DISCOVERED_FEATURES].sort(),
    );
  });
});
