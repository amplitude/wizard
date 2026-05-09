/**
 * lifecycle-display — vocabulary tests.
 *
 * Pins the glyph palette so accidental changes (e.g. someone swapping
 * ⏸ for a different symbol) trip the test rather than silently shipping
 * an inconsistent vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { lifecycleDisplay, progressDisplay } from '../lifecycle-display.js';
import { TaskLifecycle } from '../../../../lib/orchestration/lifecycle.js';

describe('lifecycle-display', () => {
  it('maps every TaskLifecycle to a non-empty glyph + label', () => {
    for (const state of Object.values(TaskLifecycle)) {
      const display = lifecycleDisplay(state);
      expect(display.glyph.length).toBeGreaterThan(0);
      expect(display.label.length).toBeGreaterThan(0);
      expect(display.color.length).toBeGreaterThan(0);
    }
  });

  it('uses the canonical glyph palette', () => {
    expect(lifecycleDisplay(TaskLifecycle.Queued).glyph).toBe('○');
    expect(lifecycleDisplay(TaskLifecycle.Running).glyph).toBe('›');
    expect(lifecycleDisplay(TaskLifecycle.WaitingForUser).glyph).toBe('…');
    expect(lifecycleDisplay(TaskLifecycle.Blocked).glyph).toBe('⏸');
    expect(lifecycleDisplay(TaskLifecycle.Completed).glyph).toBe('✓');
    expect(lifecycleDisplay(TaskLifecycle.Failed).glyph).toBe('✗');
    expect(lifecycleDisplay(TaskLifecycle.Cancelled).glyph).toBe('⊘');
    expect(lifecycleDisplay(TaskLifecycle.Superseded).glyph).toBe('⮕');
  });

  it('marks active states correctly', () => {
    expect(lifecycleDisplay(TaskLifecycle.Running).active).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.WaitingForUser).active).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Blocked).active).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Queued).active).toBe(false);
    expect(lifecycleDisplay(TaskLifecycle.Completed).active).toBe(false);
  });

  it('marks terminal states correctly', () => {
    expect(lifecycleDisplay(TaskLifecycle.Completed).terminal).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Failed).terminal).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Cancelled).terminal).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Superseded).terminal).toBe(true);
    expect(lifecycleDisplay(TaskLifecycle.Running).terminal).toBe(false);
  });

  it('progressDisplay maps the lighter status union onto the same vocabulary', () => {
    expect(progressDisplay('pending').glyph).toBe('○');
    expect(progressDisplay('in_progress').glyph).toBe('›');
    expect(progressDisplay('completed').glyph).toBe('✓');
    expect(progressDisplay('failed').glyph).toBe('✗');
  });
});
