import { describe, it, expect } from 'vitest';
import { sleep } from '../helper-functions.js';

describe('sleep', () => {
  it('returns a Promise', () => {
    const result = sleep(0);
    expect(result).toBeInstanceOf(Promise);
    return result;
  });

  it('resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});
