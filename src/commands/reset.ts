import type { CommandModule } from 'yargs';
import {
  getUI,
  getInstallDirFromArgv,
  resolveJsonOutput,
  extractErrorMessage,
} from './helpers';

export const resetCommand: CommandModule = {
  command: 'reset',
  describe:
    'Remove project wizard state (`.amplitude/`, legacy `.amplitude-*.json`, setup report) and clear org/project/zone in `.amplitude/project-binding.json`. OAuth, API keys, and tracking-plan fields are left intact.',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to reset (defaults to cwd)',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const installDir = getInstallDirFromArgv(argv);
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { clearAuthFieldsInAmpliConfig } = await import(
        '../lib/ampli-config.js'
      );
      // reset originally passed `requireExplicitWrites: false` — which is
      // the default in resolveMode (Boolean(undefined) === false), so we
      // can omit it here without changing behavior.
      const jsonOutput = await resolveJsonOutput(argv);
      // Targets to remove:
      //   - `.amplitude/` directory (canonical: events.json, dashboard.json,
      //      project-binding.json, etc. — all metadata produced by past runs)
      //   - `.amplitude-events.json` / `.amplitude-dashboard.json` (legacy
      //      dotfile mirrors that older skill packs still write)
      //   - `amplitude-setup-report.md` (human-readable recap)
      // Auth tokens and per-project API keys are NOT touched — `wizard
      // logout --clean` is the command for that. Reset is the "I want
      // a fresh setup run on this codebase" gesture, not "I'm done with
      // Amplitude entirely."
      const targets = [
        { path: path.join(installDir, '.amplitude'), kind: 'dir' as const },
        {
          path: path.join(installDir, '.amplitude-events.json'),
          kind: 'file' as const,
        },
        {
          path: path.join(installDir, '.amplitude-dashboard.json'),
          kind: 'file' as const,
        },
        {
          path: path.join(installDir, 'amplitude-setup-report.md'),
          kind: 'file' as const,
        },
      ];
      const removed: string[] = [];
      const skipped: string[] = [];
      for (const target of targets) {
        try {
          if (fs.existsSync(target.path)) {
            fs.rmSync(target.path, { recursive: true, force: true });
            removed.push(target.path);
          } else {
            skipped.push(target.path);
          }
        } catch (err) {
          // Best-effort: surface the error for the operator but don't
          // block subsequent removals.
          const msg = extractErrorMessage(err);
          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'log',
                level: 'warn',
                message: `failed to remove ${target.path}: ${msg}`,
              }) + '\n',
            );
          } else {
            getUI().log.warn(`Failed to remove ${target.path}: ${msg}`);
          }
        }
      }
      // Write a cleared canonical binding AFTER removing `.amplitude/`.
      // If a stale legacy `ampli.json` is still on disk (Phase G-1 stopped
      // writing it), readAmpliConfig would fall back to it and resurrect
      // auth fields that reset is supposed to clear. By clearing after
      // deletion, the freshly written canonical binding takes precedence.
      try {
        clearAuthFieldsInAmpliConfig(installDir);
      } catch {
        /* best-effort */
      }

      if (jsonOutput) {
        process.stdout.write(
          JSON.stringify({
            v: 1,
            '@timestamp': new Date().toISOString(),
            type: 'result',
            message: `wizard reset: removed ${removed.length}, skipped ${skipped.length}`,
            data_version: 1,
            data: {
              event: 'reset',
              installDir,
              removed,
              skipped,
            },
          }) + '\n',
        );
      } else if (removed.length === 0) {
        getUI().note('Nothing to reset — no wizard artifacts found.');
      } else {
        getUI().log.success(
          `Removed ${removed.length} wizard artifact${
            removed.length === 1 ? '' : 's'
          } from ${installDir}.`,
        );
        for (const item of removed) {
          getUI().note(`  - ${path.basename(item)}`);
        }
      }
      process.exit(0);
    })();
  },
};
