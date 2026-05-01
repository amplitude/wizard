## Summary

<!-- What changed and why (1–3 sentences). -->

## Test plan

<!-- How you verified the change (manual steps, tests run). -->

## Checklist

- [ ] `pnpm lint` and `pnpm test` pass (or N/A with reason)
- [ ] TUI / router / `flows.ts` / navigation `store.ts` changes: ran focused Vitest  
      `pnpm exec vitest run --pool=forks --maxWorkers=1` on the relevant `src/ui/tui/**/__tests__/*` paths (or N/A)
- [ ] Included **`/reflect`** checklist in this PR description or linked it (or N/A — e.g. typo-only / non-agent work)
