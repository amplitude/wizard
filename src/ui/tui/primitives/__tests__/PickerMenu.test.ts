/**
 * Unit tests for PickerMenu's pagination math.
 *
 * `computeVisibleCount` is the pure helper that turns measured header
 * height + terminal rows into the number of option rows that fit. We
 * test it directly instead of mounting the component, since vitest in
 * this repo runs in a `node` environment without a DOM/Ink renderer.
 */

import { describe, it, expect } from 'vitest';
import { computeVisibleCount } from '../PickerMenu.js';

describe('computeVisibleCount', () => {
  describe('first-frame fallback (measuredHeaderRows === null)', () => {
    it('uses the hardcoded chrome constant before measurement is available', () => {
      // 30 rows - 16 chrome = 14 available, 20 options → 14 visible
      expect(computeVisibleCount(30, null, 20)).toBe(14);
    });

    it('clamps to MIN_VISIBLE_ROWS on extremely short terminals', () => {
      // 10 rows - 16 chrome = -6 → floor at 5
      expect(computeVisibleCount(10, null, 20)).toBe(5);
    });

    it('clamps to total options when the list fits in available rows', () => {
      // 50 rows - 16 chrome = 34 available, 7 options → 7 visible
      expect(computeVisibleCount(50, null, 7)).toBe(7);
    });
  });

  describe('measured-header path', () => {
    it('replaces the fallback constant with measured header + footer reserve', () => {
      // measured header = 1 row, footer reserve = 3 → 4 chrome rows
      // 30 - 4 = 26 available, 20 options → 20 visible (fits)
      expect(computeVisibleCount(30, 1, 20)).toBe(20);
    });

    it('shrinks visibleCount when a wrapped header consumes more rows', () => {
      // header wraps to 5 rows on a narrow terminal → 5 + 3 = 8 chrome
      // 20 - 8 = 12 available, 30 options → 12 visible
      expect(computeVisibleCount(20, 5, 30)).toBe(12);
    });

    it('reacts to a header height change between renders', () => {
      // Same terminal + options. Header grows from 1 → 4 (caused by a
      // longer message text or wrapping). visibleCount must drop
      // accordingly so the cursor never falls off-screen.
      const before = computeVisibleCount(25, 1, 30);
      const after = computeVisibleCount(25, 4, 30);
      expect(before).toBeGreaterThan(after);
      expect(before).toBe(21); // 25 - (1+3) = 21
      expect(after).toBe(18); // 25 - (4+3) = 18
    });

    it('clamps to MIN_VISIBLE_ROWS when measured chrome eats the screen', () => {
      // header = 18, footer reserve 3 = 21 chrome on 20-row terminal
      // available = -1 → floor at 5
      expect(computeVisibleCount(20, 18, 30)).toBe(5);
    });

    it('clamps to total options when everything fits', () => {
      // 40 rows, header 2, chrome 5 → 35 available, 8 options → 8
      expect(computeVisibleCount(40, 2, 8)).toBe(8);
    });
  });
});
