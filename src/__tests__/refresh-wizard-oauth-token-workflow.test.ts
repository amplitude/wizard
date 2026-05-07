/**
 * Sanity-check the shape of `.github/workflows/refresh-wizard-oauth-token.yml`.
 *
 * Doesn't aim to be exhaustive (we can't run the workflow from vitest),
 * but catches accidental regressions in the cron schedule, action pins,
 * or the four secret names — all of which the rest of CI silently depends
 * on.
 */

process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_PATH = resolve(
  __dirname,
  '../../.github/workflows/refresh-wizard-oauth-token.yml',
);

describe('refresh-wizard-oauth-token workflow', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');

  it('runs hourly at :23 to dodge the top-of-hour thundering herd', () => {
    expect(yaml).toMatch(/cron: '23 \* \* \* \*'/);
  });

  it('supports manual dispatch alongside the cron schedule', () => {
    expect(yaml).toMatch(/workflow_dispatch:/);
  });

  it('pins actions/checkout and actions/setup-node to commit SHAs (not tags)', () => {
    expect(yaml).toMatch(/uses: actions\/checkout@[a-f0-9]{40} # v\d+/);
    expect(yaml).toMatch(/uses: actions\/setup-node@[a-f0-9]{40} # v\d+/);
  });

  it('runs the refresh script and reads its outputs', () => {
    expect(yaml).toMatch(/node scripts\/refresh-wizard-oauth-token\.mjs/);
    expect(yaml).toMatch(/steps\.refresh\.outputs\.access_token/);
    expect(yaml).toMatch(/steps\.refresh\.outputs\.refresh_token/);
    expect(yaml).toMatch(/steps\.refresh\.outputs\.expires_at/);
  });

  it('updates exactly the four expected repo secrets', () => {
    expect(yaml).toMatch(/gh secret set WIZARD_OAUTH_TOKEN/);
    expect(yaml).toMatch(/gh secret set WIZARD_REFRESH_TOKEN/);
    expect(yaml).toMatch(/gh secret set WIZARD_EXPIRES_AT/);
    // WIZARD_ZONE is read as a static input on every run (set once via
    // ci-bootstrap, not rotated by the cron). Accept either `vars.` or
    // `secrets.` — operators may store the zone as either depending on
    // their org policy. Both behave identically at runtime; the wizard
    // doesn't treat the value as sensitive (it's just `us` / `eu`).
    expect(yaml).toMatch(
      /WIZARD_ZONE: \$\{\{ (vars|secrets)\.WIZARD_ZONE \}\}/,
    );
  });

  it('uses the dedicated PAT for secrets:write — GITHUB_TOKEN cannot rotate secrets', () => {
    expect(yaml).toMatch(/secrets\.WIZARD_SECRET_REFRESH_PAT/);
  });

  it('skips the secret-write step when the refresh failed', () => {
    expect(yaml).toMatch(/if: steps\.refresh\.outputs\.refresh != 'failed'/);
  });
});
