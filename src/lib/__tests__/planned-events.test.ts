/**
 * commitPlannedEvents — currently a no-op while the Amplitude MCP server
 * lacks working write tools (`create_events` / `update_event` both
 * return "MCP error"). These tests lock down the no-op contract so we
 * notice immediately if the function regresses to making MCP calls.
 *
 * When the MCP server adds write support and we revert this file's
 * implementation, also revert this test file to the prior commit.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { commitPlannedEvents } from '../planned-events';

vi.mock('../../utils/debug');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

describe('commitPlannedEvents (disabled / no-op)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockQuery.mockReset();
  });

  it('returns zero counts when events array is empty (no MCP traffic)', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [],
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns zero counts when appId is missing (no MCP traffic)', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '',
      events: [{ name: 'Button Clicked', description: '' }],
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Critical: this is the whole point of the disable. We pay zero MCP
  // round-trips and zero Claude-agent fallback inferences for what we
  // know will fail.
  it('returns a structured skip without making any MCP or agent calls', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: 'fired on click' }],
    });

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(0);
    expect(result.described).toBe(0);
    expect(result.error).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('still deduplicates and trims input names so the attempted count is honest', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [
        { name: '  Button Clicked  ', description: '' },
        { name: 'Button Clicked', description: '' },
        { name: '', description: 'no name' },
      ],
    });

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
