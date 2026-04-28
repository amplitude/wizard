Review the most recent contents of the wizard's log file. Logs are
per-project under `~/.amplitude/wizard/runs/<sha256(installDir)>/log.txt`
(structured mirror at `log.ndjson`). To find the exact path for the
current project, either run the wizard's `/diagnostics` slash command or
hash the install directory yourself. Pre-refactor builds wrote to
`/tmp/amplitude-wizard.log` — if you're inspecting an older session, look
there first; the migration shim moves it to `~/.amplitude/wizard/bootstrap.log`
on the next run.

The log may be quite substantial, so prepare to tail or search it. Look for
