# Audit G1 — Update notifier

**Category:** CLI
**Effort:** M
**Status:** Implemented.

## What changed

Added `src/utils/update-notifier.ts`:

- Fire-and-forget background check to `registry.npmjs.org` with a
  1.5s timeout and a 24h on-disk cache (`$TMPDIR/amplitude-wizard-update-check.json`).
- Uses the npm install-v1 slim response format to avoid downloading the
  full packument.
- Writes a one-line notice to `stderr` when a newer version is
  available.

Respects the following opt-outs:

- `AMPLITUDE_WIZARD_NO_UPDATE_CHECK=1`
- `NO_UPDATE_NOTIFIER=1` (matches the widely-used `update-notifier`
  convention)
- `CI=1` / `CI=true`
- `!process.stdout.isTTY` (piped, `--agent` mode, `--ci`)

`bin.ts` kicks off the check after analytics session properties are
configured — this guarantees we never block startup and the fetch runs
in parallel with the wizard's heavy dynamic imports.

Not implemented (intentionally):

- No prompt to auto-update. We surface the command and let the user
  decide; auto-update would be surprising for a tool often run via
  `npx`.
