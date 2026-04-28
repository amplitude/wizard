Implement a new feature end-to-end: create a Linear ticket, branch, implement, and open a PR.

## Arguments

`$ARGUMENTS` — a short description of the feature to build. Required.

## Steps

### 1. Create a Linear ticket

Use the `mcp__linear__create_issue` tool to create a ticket.

- **title**: derive a concise imperative title from `$ARGUMENTS` (e.g. "Add org picker to auth flow")
- **description**: a 2–3 sentence description of what the feature does and why it's useful
- **teamId**: call `mcp__linear__list_teams` first if you don't already know the team ID; pick the most relevant team
- Capture the returned issue **identifier** (e.g. `ENG-123`) and **branchName** (Linear supplies a suggested branch name — use it verbatim if provided, otherwise derive one as `<type>/<identifier>-<slug>` e.g. `feat/eng-123-add-org-picker`)

### 2. Create and check out the branch

```bash
git fetch origin main
git checkout -b <branchName> origin/main
```

### 3. Plan the implementation

Before writing any code, reason through:
- Which files need to change
- What the minimal correct implementation looks like (no over-engineering)
- Any invariants or conventions from CLAUDE.md that apply (conventional commits, screen-passive rule, session-as-truth, etc.)

### 4. Implement the feature

- Make the smallest correct change that satisfies `$ARGUMENTS`
- Follow all conventions in CLAUDE.md (no comments unless WHY is non-obvious, no speculative abstractions, no backwards-compat shims for removed code)
- Run `pnpm build` to verify compilation; fix any TypeScript errors before continuing
- Run `pnpm lint` and fix any issues with `pnpm fix`
- Run `pnpm test` and ensure all tests pass

### 5. Commit

Follow the `/commit` command instructions to stage and commit with a conventional commit message. The commit subject should mirror the Linear ticket title.

### 6. Push and open a PR

```bash
git push -u origin <branchName>
```

Then use `mcp__github__create_pull_request` to open a PR on `amplitude/wizard`:

- **title**: the conventional commit subject from step 5 (must pass `pr-conventional-commit.yml`)
- **body**: use the template below
- **head**: `<branchName>`
- **base**: `main`

PR body template:

```
## Summary
- <bullet 1>
- <bullet 2>

## Linear
<Linear ticket URL>

## Test plan
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] <feature-specific manual test step>

https://claude.ai/code
```
