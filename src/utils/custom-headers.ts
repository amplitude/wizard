import { AMPLITUDE_FLAG_HEADER_PREFIX } from '../lib/constants';

/**
 * Builds a list of custom headers for ANTHROPIC_CUSTOM_HEADERS.
 */
export function createCustomHeaders(): {
  add(key: string, value: string): void;
  /** Add a feature flag for Amplitude ($feature/<flagKey>: variant). */
  addFlag(flagKey: string, variant: string): void;
  encode(): string;
} {
  const entries: Array<{ key: string; value: string }> = [];

  return {
    add(key: string, value: string): void {
      const name =
        key.startsWith('x-') || key.startsWith('X-') ? key : `X-${key}`;
      entries.push({ key: name, value });
    },

    addFlag(flagKey: string, variant: string): void {
      const headerName = AMPLITUDE_FLAG_HEADER_PREFIX + flagKey.toUpperCase();
      entries.push({ key: headerName, value: variant });
    },

    encode(): string {
      return entries.map(({ key, value }) => `${key}: ${value}`).join('\n');
    },
  };
}

/**
 * Reverse {@link createCustomHeaders}'s `encode()` output into a header map
 * for clients that take explicit `headers` (e.g. Vercel AI SDK provider).
 */
export function parseAnthropicCustomHeaderBlock(
  encoded: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of encoded.split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf(': ');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return out;
}
