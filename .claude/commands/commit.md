Stage and commit all changes to the current git repository.

1. Run `git status` and `git diff` in parallel to review what has changed.
2. Run `git log --oneline -5` to check recent commit message style.
3. Stage all modified and untracked files relevant to the work (avoid .env or credential files).
4. Write a concise commit message that focuses on the "why" not the "what". Follow the style of recent commits.
5. Commit using a HEREDOC to ensure correct formatting, co-authored by Claude.
6. Run `git status` to confirm the commit succeeded.

Do not push. Do not amend existing commits. If a pre-commit hook fails, fix the issue and create a new commit.
