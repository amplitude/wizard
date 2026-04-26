/**
 * Unit tests for PickerMenu's pagination math.
 *
 * `computeVisibleCount` is the pure helper that turns total rows plus
 * reserved chrome into the number of option rows that fit. We test it
 * directly instead of mounting the component, since vitest in this repo
 * runs in a `node` environment without a DOM/Ink renderer.
 */

import { describe, expect, it } from 'vitest';
import { computeVisibleCount } from '../PickerMenu.js';

describe('computeVisibleCount', () => {
  describe('fallback and measured-header chrome', () => {
    it('uses the hardcoded chrome constant before measurement is available', () => {
      expect(computeVisibleCount(30, 20, 16)).toBe(14);
    });

    it('clamps to MIN_VISIBLE_ROWS on extremely short terminals', () => {
      expect(computeVisibleCount(10, 20, 16)).toBe(5);
    });

    it('clamps to total options when the list fits in available rows', () => {
      expect(computeVisibleCount(50, 7, 16)).toBe(7);
    });

    it('shrinks visibleCount when a wrapped header consumes more rows', () => {
      expect(computeVisibleCount(20, 30, 8)).toBe(12);
    });

    it('reacts to a header height change between renders', () => {
      const before = computeVisibleCount(25, 30, 4);
      const after = computeVisibleCount(25, 30, 7);
      expect(before).toBeGreaterThan(after);
      expect(before).toBe(21);
      expect(after).toBe(18);
    });

    it('clamps to MIN_VISIBLE_ROWS when measured chrome eats the screen', () => {
      expect(computeVisibleCount(20, 30, 21)).toBe(5);
    });

    it('clamps to total options when everything fits', () => {
      expect(computeVisibleCount(40, 8, 5)).toBe(8);
    });
  });

  describe('explicit parent-constrained budgets', () => {
    it('reserves scroll-indicator rows from parent-provided budgets', () => {
      expect(computeVisibleCount(9, 40, 2)).toBe(7);
    });

    it('still caps visible rows to the option count after reserve rows', () => {
      expect(computeVisibleCount(20, 7, 2)).toBe(7);
    });

    it('still enforces the minimum visible rows in tight parent budgets', () => {
      expect(computeVisibleCount(6, 40, 2)).toBe(5);
    });
  });
});
