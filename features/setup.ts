/**
 * Cucumber test setup. Loaded before any step definition file via the
 * `require` array in `cucumber.mjs`.
 *
 * Redirects `HOME` (and `USERPROFILE` on Windows) to a freshly-created
 * temp directory so disk-backed zone signals — `getStoredUser()` and
 * `readAmpliConfig()` — don't pick up the developer's real
 * `~/.ampli.json` during BDD runs. The Wizard flow's RegionSelect gate
 * calls `tryResolveZone(s)`, which consults Tier 2/3 (ampli.json,
 * stored user). Without this redirect, a `region: null` session in
 * tests still resolves to a non-null zone, silently skipping
 * RegionSelect and breaking flow assertions.
 *
 * MUST run before any module reads `os.homedir()` at import time —
 * `src/utils/ampli-settings.ts` computes `AMPLI_CONFIG_PATH` from
 * `os.homedir()` at module load, so this file must load first.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const sandboxHome = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ampli-wizard-bdd-home-'),
);

process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;

// Best-effort cleanup on process exit. Cucumber spawns one process per
// run, so this fires once at the end.
process.on('exit', () => {
  try {
    fs.rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // ignore — temp cleanup is best-effort
  }
});
