# CI Authentication

The wizard's eval / bench harnesses and production runs in CI need a live
Amplitude OAuth bearer (`WIZARD_OAUTH_TOKEN`) to talk to the gateway.
Access tokens issued by Hydra typically expire in ~1 hour, so we keep
them fresh with a scheduled GitHub Actions workflow that calls the
`/oauth2/token` refresh endpoint and rotates the corresponding repo
secrets in place.

## Architecture

| Piece                                                   | Role                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `scripts/refresh-wizard-oauth-token.mjs`                | Calls Hydra `/oauth2/token` with `grant_type=refresh_token`, writes new credential triple to `GITHUB_OUTPUT`. Zero deps.      |
| `.github/workflows/refresh-wizard-oauth-token.yml`      | Hourly cron at `:23`. Runs the script, then `gh secret set`s `WIZARD_OAUTH_TOKEN` / `WIZARD_REFRESH_TOKEN` / `WIZARD_EXPIRES_AT`. |
| `amplitude-wizard ci-bootstrap`                         | One-time setup: pushes the four secrets from your local OAuth session.                                                        |
| `WIZARD_SECRET_REFRESH_PAT`                             | Fine-grained PAT with `secrets:write` on this repo. The default `GITHUB_TOKEN` cannot write secrets.                          |

## One-time setup

1. **Install the GitHub CLI** and authenticate:

   ```bash
   gh auth login
   ```

2. **Sign in to the wizard locally** so a fresh OAuth session lands on disk:

   ```bash
   npx @amplitude/wizard login
   ```

3. **Create a fine-grained PAT** in GitHub with `secrets:write` scope on
   `amplitude/wizard`. Save it as the `WIZARD_SECRET_REFRESH_PAT` secret in
   the same repo. Without this PAT the refresh workflow has no way to
   rotate the secrets — `GITHUB_TOKEN` cannot.

4. **Run `ci-bootstrap`**:

   ```bash
   amplitude-wizard ci-bootstrap
   ```

   This pushes four values to repo secrets:

   - `WIZARD_OAUTH_TOKEN` ← current access token
   - `WIZARD_REFRESH_TOKEN` ← current refresh token
   - `WIZARD_EXPIRES_AT` ← ISO 8601 expiry
   - `WIZARD_ZONE` ← `us` or `eu`

   Pass `--yes` to skip the confirmation prompt, or `--repo <owner/name>` to
   target a fork.

## How the refresh workflow runs

The workflow runs hourly at `:23` (off the top of the hour to avoid
GitHub's cron thundering-herd) plus on `workflow_dispatch`. Each run:

1. Reads `secrets.WIZARD_REFRESH_TOKEN` + `vars.WIZARD_ZONE`.
2. Calls Hydra `/oauth2/token` with `grant_type=refresh_token`.
3. Writes the new triple to `GITHUB_OUTPUT`.
4. Calls `gh secret set` (using `WIZARD_SECRET_REFRESH_PAT`) to overwrite
   `WIZARD_OAUTH_TOKEN`, `WIZARD_REFRESH_TOKEN`, and `WIZARD_EXPIRES_AT`.

If Hydra rotates the refresh token (it does, on every exchange when the
client is configured for rotation), the new one replaces the stored
value — the workflow never reuses a stale refresh token.

## Troubleshooting

### Refresh failed

The workflow surfaces `::error::OAuth refresh failed.` and exits
non-zero. Common causes:

- **Refresh token revoked.** Most likely after a long inactivity period
  or a deliberate `wizard logout`. Re-bootstrap (next section).
- **Hydra 5xx / network blip.** The next scheduled run will retry; no
  action needed unless multiple consecutive runs fail.
- **PAT expired.** `gh secret set` returns 401. Mint a new
  `WIZARD_SECRET_REFRESH_PAT` and update the secret.

### Re-bootstrapping

```bash
amplitude-wizard logout            # clear the stale session
npx @amplitude/wizard login        # mint a new refresh token
amplitude-wizard ci-bootstrap --yes
```

### Inspecting the secrets locally

`gh secret list --repo amplitude/wizard` shows the names and last-updated
timestamps but not the values (by design). The `WIZARD_EXPIRES_AT` secret
is a useful sanity-check: it should advance by ~1 hour every cron tick.
