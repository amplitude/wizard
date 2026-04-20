## Bet 4 — MCP-First Repositioning

**Branch:** `kelsonpw/mcp-first`
**Depends on:** Bets 2 + 3.
**Effort:** ~1 quarter.

### Goal

Ship the wizard's primary surface as an MCP server distributed through Anthropic's and Cursor's marketplaces, framed as "Amplitude for Claude Code / Cursor." The CLI becomes the fallback. Cut scope that distracts from this framing.

### Why now

In 18 months, the developer front door is an MCP tool inside Cursor and Claude Code, not `npx`. The surface exists today (`mcp serve`) but is read-mostly. `context-hub` ships 31 integration skills; `FRAMEWORK_REGISTRY` wires 18. The gap is real work left undone.

### Deliverables

#### Harden `mcp serve`
- [ ] Today `mcp serve` exposes read-only wizard surface. Extend to cover full lifecycle: detect → install → instrument → verify → return diff.
- [ ] Bet 2's structured status (`report_status` tool) is the contract; MCP clients consume it directly.
- [ ] Write actions must still route through `wizard-tools` MCP (e.g., `set_env_values`) — never raw filesystem.
- [ ] Add integration tests against Claude Desktop and Cursor locally.

#### Wire the missing skills
- [ ] Compare `skills/integration/` against `FRAMEWORK_REGISTRY` in `src/lib/registry.ts` and `Integration` enum in `src/lib/constants.ts`.
- [ ] Add detection + `FrameworkConfig` for: SvelteKit, Nuxt (x2), Astro (x4), Angular, Laravel, Rails, Ruby, TanStack (x3). ~13 frameworks.
- [ ] Each new config reuses shared helpers — don't copy-paste boilerplate. Leverage the scaffolder if the Principal SE's framework-scaffolder idea has shipped by then.
- [ ] Contract tests per new framework per Bet 2's eval harness.

#### Marketplace distribution
- [ ] Publish the MCP server to Anthropic's MCP marketplace.
- [ ] Publish to Cursor's plugin directory.
- [ ] Marketing landing page (static) on **GitHub Pages** (org policy permits) — do NOT use Vercel/Netlify/Railway/etc.

#### One-shot install tokens
- [ ] Amplitude web emits `npx @amplitude/wizard install --token=<jwt>` after signup.
- [ ] CLI consumes the JWT instead of browser OAuth — zero auth friction from the web-signup flow.
- [ ] Token is single-use, 10-minute TTL, scoped to the specific org/workspace/project.
- [ ] Mint via the existing OAuth service; validate via the same endpoint.

#### Cuts to fund this work
- [ ] Remove `/snake` slash command. Drop `@pavus/snake-game` from `package.json`. `src/ui/tui/screens/SnakeScreen.tsx` and related.
- [ ] Demote Unreal, Unity, Go, Java first-class configs to generic + skill. Keep the skills; delete `src/frameworks/{unreal,unity,go,java}-wizard-agent.ts` files and `FRAMEWORK_REGISTRY` entries. Telemetry: <1% each of self-serve signup volume.
- [ ] Remove the `/chart`, `/dashboard`, `/taxonomy` slash commands from README — they don't actually exist in `src/ui/tui/console-commands.ts`. Amplitude web owns these flows better.
- [ ] Remove in-wizard Slack setup (same — Amplitude web surface is stronger).

#### Public moat surface
- [ ] Publish `skills/integration/` manifest at `skills.amplitude.com` (or similar, on GitHub Pages): versioned, browsable, contributable from the `context-hub` GitHub release.

### Verification

- MCP server runs end-to-end against a test Next.js repo via Claude Desktop, producing a committable diff.
- Same against Cursor.
- `wizard cli: run started {mode: 'mcp'}` appears in Amplitude with non-zero volume from real users within 30 days of marketplace launch.
- Amplitude web signup → one-shot JWT → wizard install with zero OAuth redirect. End-to-end test in staging.
- Marketplace listings live on both Anthropic and Cursor directories.

### Kill criteria

- MCP signups <10% of total wizard runs after 2 quarters → MCP becomes a side channel, CLI stays the primary surface. Keep `mcp serve` but deprioritize marketplace distribution.

### Out of scope

- Full skills-marketplace UX (browse, filter, submit). Start with a simple manifest page.
- VS Code extension (separate product decision, not this bet).
