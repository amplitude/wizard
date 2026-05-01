Stage and commit all changes to the current git repository.

1. Run `git status` and `git diff` in parallel to review what has changed.
2. Run `git log --oneline -5` to check recent commit message style.
3. Stage all modified and untracked files relevant to the work (avoid .env or credential files).
4. Write a **conventional commit** message that focuses on the "why" not the "what". Follow the style of recent commits.
5. Commit using a HEREDOC to ensure correct formatting, co-authored by Claude.
6. Run `git status` to confirm the commit succeeded.

## Conventional commit format

This repo enforces conventional commits on PR titles (see `.github/workflows/pr-conventional-commit.yml`). Match the same format for commit messages so the PR title can be taken from the commit directly.

Subject line pattern:

```
<type>(<scope>)?!?: <description>
```

- **type** (required, lowercase): one of `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore`, `revert`
- **scope** (optional): a short noun in parentheses, e.g. `feat(auth): ...`
- **!** (optional): mark a breaking change, e.g. `feat!: drop Node 16 support` or `feat(api)!: rename endpoint`
- **description** (required): imperative, lowercase-first, no trailing period

Valid examples:

- `feat: add org picker to auth flow`
- `fix(router): preserve overlay stack across flow transitions`
- `ci: pin actions/github-script to full SHA`
- `feat!: require Node 20`

Invalid (CI will reject):

- `FEAT: add org picker` — type must be lowercase
- `added org picker` — missing type prefix
- `feat add org picker` — missing `:` after type

Do not push. Do not amend existing commits. If a pre-commit hook fails, fix the issue and create a new commit.
