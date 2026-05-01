/**
 * AgentDriver — the single seam between the wizard and the Claude Agent SDK.
 *
 * Production binds this to `query()` from `@anthropic-ai/claude-agent-sdk`.
 * Tests can bind a scripted driver that yields a canned message sequence,
 * letting the rest of `runAgent` (hooks, journey classifier, NDJSON emission,
 * retry/stall logic) execute unchanged against deterministic input.
 *
 * Why a driver and not just the SDK module alias used in `vitest.config.ts`?
 *  - The vitest alias is process-global, so every unit test sees the same
 *    fixed two-message sequence. Scenario / e2e tests need per-test scripts
 *    so they can exercise specific tool-call orderings, error paths, etc.
 *  - The driver is an explicit TypeScript boundary. The shape passed to it is
 *    what we want to assert in tests (mcpServers, hooks, systemPrompt, env)
 *    without spinning up a real subprocess.
 *  - Default resolution is lazy: production loads the real SDK on first use,
 *    tests that override never trigger the dynamic import at all.
 *
 * Threading model:
 *  - `setAgentDriver(driver)` overrides the active driver process-wide. Use
 *    in test setup; pair with `setAgentDriver(null)` in teardown.
 *  - `getAgentDriver()` returns the override if one is set, otherwise lazily
 *    loads and caches the real SDK driver.
 *  - The default driver cache survives `setAgentDriver(null)` so subsequent
 *    test runs don't re-import the SDK every time.
 */

export type AgentDriverArgs = {
  prompt: string | AsyncIterable<unknown>;
  options?: Record<string, unknown>;
};

export type AgentDriver = (args: AgentDriverArgs) => AsyncIterable<unknown>;

let activeDriver: AgentDriver | null = null;
let defaultDriverPromise: Promise<AgentDriver> | null = null;

export function setAgentDriver(driver: AgentDriver | null): void {
  activeDriver = driver;
}

async function loadDefaultDriver(): Promise<AgentDriver> {
  if (!defaultDriverPromise) {
    defaultDriverPromise = (async () => {
      const mod = await import('@anthropic-ai/claude-agent-sdk');
      return mod.query as unknown as AgentDriver;
    })();
  }
  return defaultDriverPromise;
}

export async function getAgentDriver(): Promise<AgentDriver> {
  return activeDriver ?? loadDefaultDriver();
}
