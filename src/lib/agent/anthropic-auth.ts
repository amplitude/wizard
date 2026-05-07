/**
 * Shared Anthropic auth resolver — used by the AI SDK gateway probe and the
 * console-query Vercel AI SDK path. Reads `ANTHROPIC_API_KEY` first, then falls
 * back to `ANTHROPIC_AUTH_TOKEN`. API key always wins when both are set.
 *
 * Returns an empty object when neither is present so callers can spread the
 * result into the `createAnthropic` options without further branching.
 */
export function resolveAnthropicAuth(): {
  apiKey?: string;
  authToken?: string;
} {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return { apiKey };
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) return { authToken };
  return {};
}
