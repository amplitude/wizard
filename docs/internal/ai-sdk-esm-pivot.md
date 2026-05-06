# AI SDK + ESM pivot (rewrite alignment)

**Problem the subagent review surfaced:** many small extractions (`tool-policy`,
etc.) do not, by themselves, move the wizard toward the **speed / reliability /
modern runtime** target in `MIGRATION_PLAN.md` and `NEW_MIGRATION_PLAN.md`. The
high-value bet is **one primary messages API** implemented with **Vercel AI
SDK** (`ai`, `@ai-sdk/anthropic`), **Vertex-safe fetch** (existing
`sanitizingFetch`), then **delete** parallel complexity once parity tests pass.

## Execution order (no more “module theatre”)

1. **Ship deps + proof point (done in tree):** `ai` + `@ai-sdk/anthropic`;
   opt-in probe `maybeRunAiSdkGatewayProbe` after gateway env is configured
   (`AMPLITUDE_WIZARD_AI_SDK_PROBE=1`). Optional CI gate:
   `AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1`.
2. **Console dual path (opt-in):** `AMPLITUDE_WIZARD_AI_SDK_CONSOLE=1` routes
   `queryConsole` through `streamText` + `getConsoleQueryStack`;
   local CLI runs stay on Agent SDK. Shared **`createWizardAiSdkAnthropic`**
   (`src/lib/agent/wizard-ai-sdk-anthropic.ts`) keeps probe + console on the
   same auth / `baseURL` / `sanitizingFetch` wiring.
3. **Dual harness:** `runAgent` flag to route **first user turn** (or smoke
   path) through `streamText` + tools stub — grow until MCP + wizard-tools
   parity.
4. **Default the AI SDK path** when evals + proxy smoke are green; keep Agent
   SDK as fallback for one release if needed.
5. **Packaging:** `package.json` now exposes a root **`exports` map** (still CJS
   artifacts) — next step for true ESM is **2.0** with `import` conditions once
   the runtime is one stack, not two.

## Env flags

| Variable                                 | Meaning                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AMPLITUDE_WIZARD_AI_SDK_PROBE=1`        | After `initializeAgent`, run one short `streamText` through gateway + `sanitizingFetch`. |
| `AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1` | Throw if the probe errors (CI / dogfood).                                                |
| `AMPLITUDE_WIZARD_AI_SDK_CONSOLE=1`      | Route **ConsoleView** slash prompts through Vercel AI SDK (not local CLI; tools omitted vs Agent SDK path). |

## Relation to open stacked PRs

Gateway sanitization, skill tiers, and install presentation are **enablers**.
The **measurable** modernization is **AI SDK on the wire** and eventually
**removing** duplicate stream / retry / hook layers from the Agent SDK path.
