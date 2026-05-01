# Lint / format / build scoping (detail)

End-of-run verification must stay **scoped to files you edited** — never project-wide.

**Why:** project-wide scripts routinely take 5–10+ minutes, exceed bash timeouts, and freeze the spinner — setup-report + dashboard creation never run. Pass explicit paths. If a custom lint command only accepts no-args, skip it and note in the setup report.

**Time budget:** lint+format+typecheck combined under 60s. If a single command exceeds 90s or you're on a third attempt, STOP — note in setup report and proceed.

The static commandments still list allowed vs denied shell shapes for the bash allowlist — follow those first.
