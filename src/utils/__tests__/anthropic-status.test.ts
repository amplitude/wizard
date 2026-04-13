import { describe, it, expect } from 'vitest';
import { checkAnthropicStatus } from '../anthropic-status.js';

describe('checkAnthropicStatus', () => {
  it('always returns operational (Vertex AI via proxy — no remote status check)', () => {
    const result = checkAnthropicStatus();
    expect(result).toEqual({ status: 'operational' });
  });
});
