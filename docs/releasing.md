# Releasing

## Automated release flow

Every merge to `main` triggers [release-please](https://github.com/googleapis/release-please), which manages versioning, changelogs, and publishing automatically.

```
PR merged to main (conventional commit)
  │
  ▼
release-please runs
  │
  ├─ No pending release → creates/updates a release PR
  │   • Bumps version (e.g. 1.0.0-beta.1 → 1.0.0-beta.2)
  │   • Updates CHANGELOG.md
  │
  └─ Release PR was just merged → creates a GitHub Release + tag
      │
      ▼
  Publish job runs (requires npm-publish environment approval)
      │
      ▼
  Published to npm with OIDC + provenance under the "beta" dist-tag
```

### Steps to release

1. Merge PRs to `main` using [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)
2. release-please opens a release PR that bumps the version and updates the changelog
3. Review and merge the release PR
4. A maintainer approves the `npm-publish` environment deployment in the Actions UI
5. The package is published to npm

### Beta releases

All releases are currently published as beta prereleases (`1.0.0-beta.N`) under the `beta` npm dist-tag. This means:

- `npm install @amplitude/wizard` will **not** install beta versions
- `npm install @amplitude/wizard@beta` will install the latest beta

This is configured in `release-please-config.json` and the `--tag beta` flag in the publish workflow.

> **Note:** The `"versioning": "prerelease"` setting in `release-please-config.json` ensures that all commits (`fix:`, `feat:`, etc.) only increment the beta number (`1.0.0-beta.2` → `1.0.0-beta.3`). When ready to move to a stable release, remove `prerelease`, `prerelease-type`, and `versioning` from the config.

## Manual publish (emergency)

If the automated flow fails, use the **Publish (manual)** workflow:

1. Go to **Actions > Publish (manual) > Run workflow**
2. It checks if `package.json` has a newer version than npm
3. Requires `npm-publish` environment approval
4. Publishes with OIDC + provenance + beta tag

## Security controls

| Control | Implementation |
|---------|---------------|
| **Authentication** | npm OIDC trusted publishing — no static tokens |
| **Provenance** | Disabled while repo is internal (see [Going public](#going-public) below) |
| **Approval gate** | `npm-publish` GitHub environment requires maintainer approval |
| **SHA pinning** | All external actions pinned to full commit SHAs |
| **CODEOWNERS** | Workflow and manifest changes require maintainer review |

## Key files

| File | Purpose |
|------|---------|
| `.github/workflows/release-please.yml` | Automated release + publish |
| `.github/workflows/publish.yml` | Manual publish fallback |
| `release-please-config.json` | Beta prerelease configuration |
| `.release-please-manifest.json` | Current version tracker |
| `.github/CODEOWNERS` | Review requirements |

## Going public

When the repo is made public, re-enable npm provenance attestation:

1. Add `--provenance` back to the publish command in both workflows:
   - `.github/workflows/release-please.yml`
   - `.github/workflows/publish.yml`
2. Update the security controls table above to reflect provenance is active
