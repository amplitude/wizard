import { describe, it, expect } from 'vitest';
import {
  PAGINATION_THRESHOLD,
  DEFAULT_CHUNK_SIZE,
  resolveChunkSize,
  shouldPaginate,
  buildBatches,
  validateBatchMetadata,
} from '../event-plan-pagination';

describe('event-plan-pagination', () => {
  describe('shouldPaginate', () => {
    it('returns false for the legacy small-project case', () => {
      expect(shouldPaginate(0)).toBe(false);
      expect(shouldPaginate(1)).toBe(false);
      expect(shouldPaginate(5)).toBe(false);
      expect(shouldPaginate(25)).toBe(false);
      expect(shouldPaginate(50)).toBe(false);
    });

    it('returns true above the 50-event threshold', () => {
      expect(shouldPaginate(51)).toBe(true);
      expect(shouldPaginate(75)).toBe(true);
      expect(shouldPaginate(200)).toBe(true);
      expect(shouldPaginate(500)).toBe(true);
    });

    it('matches the documented threshold constant', () => {
      expect(PAGINATION_THRESHOLD).toBe(50);
    });
  });

  describe('resolveChunkSize', () => {
    it('returns the default when env var is absent', () => {
      expect(resolveChunkSize({})).toBe(DEFAULT_CHUNK_SIZE);
      expect(DEFAULT_CHUNK_SIZE).toBe(25);
    });

    it('honors a valid env override', () => {
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '10' }),
      ).toBe(10);
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '50' }),
      ).toBe(50);
    });

    it('falls back to default for non-numeric override', () => {
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: 'abc' }),
      ).toBe(DEFAULT_CHUNK_SIZE);
    });

    it('falls back to default for zero / negative override', () => {
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '0' }),
      ).toBe(DEFAULT_CHUNK_SIZE);
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '-5' }),
      ).toBe(DEFAULT_CHUNK_SIZE);
    });

    it('falls back to default for out-of-range overrides', () => {
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '1' }),
      ).toBe(DEFAULT_CHUNK_SIZE);
      expect(
        resolveChunkSize({ AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE: '500' }),
      ).toBe(DEFAULT_CHUNK_SIZE);
    });
  });

  describe('buildBatches', () => {
    it('returns an empty list for zero events', () => {
      expect(buildBatches(0, 25)).toEqual([]);
    });

    it('returns a single batch for small projects (regression: <50 events)', () => {
      const batches = buildBatches(5, 25);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual({
        batchIndex: 0,
        totalBatches: 1,
        start: 0,
        end: 5,
      });
    });

    it('returns one batch when eventCount exactly fills a chunk', () => {
      expect(buildBatches(25, 25)).toEqual([
        { batchIndex: 0, totalBatches: 1, start: 0, end: 25 },
      ]);
    });

    it('returns three batches of 25 for a 75-event input', () => {
      const batches = buildBatches(75, 25);
      expect(batches).toHaveLength(3);
      expect(batches.map((b) => b.totalBatches)).toEqual([3, 3, 3]);
      expect(batches.map((b) => [b.start, b.end])).toEqual([
        [0, 25],
        [25, 50],
        [50, 75],
      ]);
    });

    it('handles a remainder cleanly (75 events, chunk 30)', () => {
      const batches = buildBatches(75, 30);
      expect(batches).toHaveLength(3);
      expect(batches.map((b) => [b.start, b.end])).toEqual([
        [0, 30],
        [30, 60],
        [60, 75],
      ]);
    });

    it('handles a 200-event monorepo case (8 batches of 25)', () => {
      const batches = buildBatches(200, 25);
      expect(batches).toHaveLength(8);
      expect(batches.every((b) => b.totalBatches === 8)).toBe(true);
      expect(batches[0].start).toBe(0);
      expect(batches[batches.length - 1].end).toBe(200);
    });

    it('floors a fractional chunk size and never returns a zero-width batch', () => {
      const batches = buildBatches(10, 3.7);
      // Floor(3.7) = 3 → ceil(10/3) = 4 batches
      expect(batches).toHaveLength(4);
      expect(batches.every((b) => b.end > b.start)).toBe(true);
    });

    it('clamps chunkSize ≤ 0 to 1 to avoid /0', () => {
      const batches = buildBatches(3, 0);
      expect(batches).toHaveLength(3);
    });
  });

  describe('validateBatchMetadata', () => {
    it('accepts the legacy single-plan shape (no batch fields)', () => {
      expect(validateBatchMetadata({ eventCount: 5 })).toBeNull();
      expect(validateBatchMetadata({ eventCount: 200 })).toBeNull();
    });

    it('accepts a valid (batchIndex, totalBatches) pair', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toBeNull();
      expect(
        validateBatchMetadata({
          batchIndex: 2,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toBeNull();
    });

    it('rejects partial batch metadata (one of the pair missing)', () => {
      expect(validateBatchMetadata({ batchIndex: 0, eventCount: 25 })).toMatch(
        /together/,
      );
      expect(
        validateBatchMetadata({ totalBatches: 3, eventCount: 25 }),
      ).toMatch(/together/);
    });

    it('rejects batchIndex >= totalBatches', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 3,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toMatch(/must be < totalBatches/);
      expect(
        validateBatchMetadata({
          batchIndex: 5,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toMatch(/must be < totalBatches/);
    });

    it('rejects negative batchIndex', () => {
      expect(
        validateBatchMetadata({
          batchIndex: -1,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toMatch(/non-negative integer/);
    });

    it('rejects zero or negative totalBatches', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 0,
          eventCount: 25,
        }),
      ).toMatch(/positive integer/);
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: -1,
          eventCount: 25,
        }),
      ).toMatch(/positive integer/);
    });

    it('rejects non-integer batchIndex', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 1.5,
          totalBatches: 3,
          eventCount: 25,
        }),
      ).toMatch(/non-negative integer/);
    });

    it('rejects empty events array when batch metadata present', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 3,
          eventCount: 0,
        }),
      ).toMatch(/non-empty/);
    });

    it('rejects out-of-range chunkSize', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 1,
          chunkSize: 1,
          eventCount: 1,
        }),
      ).toMatch(/≥ 5/);
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 1,
          chunkSize: 500,
          eventCount: 1,
        }),
      ).toMatch(/≤ 100/);
    });

    it('accepts valid chunkSize at the boundaries', () => {
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 1,
          chunkSize: 5,
          eventCount: 1,
        }),
      ).toBeNull();
      expect(
        validateBatchMetadata({
          batchIndex: 0,
          totalBatches: 1,
          chunkSize: 100,
          eventCount: 1,
        }),
      ).toBeNull();
    });
  });

  describe('integration: 75-event input correctly produces 3 batches', () => {
    it('end-to-end: shouldPaginate true, buildBatches yields 3 × 25', () => {
      const eventCount = 75;
      expect(shouldPaginate(eventCount)).toBe(true);
      const batches = buildBatches(eventCount, DEFAULT_CHUNK_SIZE);
      expect(batches).toHaveLength(3);
      expect(batches[0]).toMatchObject({ batchIndex: 0, totalBatches: 3 });
      expect(batches[1]).toMatchObject({ batchIndex: 1, totalBatches: 3 });
      expect(batches[2]).toMatchObject({ batchIndex: 2, totalBatches: 3 });
      // Sanity: the validator agrees with the batch metadata buildBatches emits.
      for (const b of batches) {
        expect(
          validateBatchMetadata({
            batchIndex: b.batchIndex,
            totalBatches: b.totalBatches,
            chunkSize: DEFAULT_CHUNK_SIZE,
            eventCount,
          }),
        ).toBeNull();
      }
    });
  });

  describe('regression: small-project (≤50 events) behavior unchanged', () => {
    it('5-event input still works as a single batch with no pagination', () => {
      expect(shouldPaginate(5)).toBe(false);
      const batches = buildBatches(5, DEFAULT_CHUNK_SIZE);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toEqual({
        batchIndex: 0,
        totalBatches: 1,
        start: 0,
        end: 5,
      });
    });

    it('50-event input is still single-batch (boundary, exclusive)', () => {
      expect(shouldPaginate(50)).toBe(false);
    });

    it('51-event input crosses the pagination boundary', () => {
      expect(shouldPaginate(51)).toBe(true);
    });
  });
});
