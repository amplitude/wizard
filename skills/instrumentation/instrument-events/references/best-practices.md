# Best practices

This document is the canonical instrumentation best-practices reference.
The single source of truth lives in the sibling `discover-event-surfaces`
skill — it's the one the wizard's commandments point the agent at, so
keeping the content there avoids cross-skill drift.

→ See `../../discover-event-surfaces/references/best-practices.md` for
the full guide (event naming, property standards, AI quality flags,
metrics framework, autocapture exclusion list, etc.).

When updating instrumentation best practices, edit only the canonical
file. This stub exists so any tooling or skill flow that expects a
`references/best-practices.md` inside the `instrument-events` skill
still finds a file (and a clear pointer) instead of a 404.
