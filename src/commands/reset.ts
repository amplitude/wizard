import type { CommandModule } from 'yargs';
import { getUI } from './helpers';
import { resolveInstallDir } from '../utils/install-dir';

export const resetCommand: CommandModule = {
  command: 'reset',
  describe:
    'Remove wizard-managed artifacts from the current project (events plan, dashboard URL, setup report, ampli.json scope). Leaves your auth + tracking-plan fields intact.',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to reset (defaults to cwd)',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const installDir = resolveInstallDir(
        argv['install-dir'] as string | undefined,
      );
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { clearAuthFieldsInAmpliConfig } = await import(
        '../lib/ampli-config.js'
      );
      const { resolveMode } = await import('../lib/mode-config.js');
      const { jsonOutput } = resolveMode({
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
        requireExplicitWrites: false,
        isTTY: Boolean(process.stdout.isTTY),
      });
      // Targets to remove:
      //   - `.amplitude/` directory (canonical: events.json, dashboard.json,
      //      product-map.json, etc. — all metadata produced by past runs)
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
          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'log',
                level: 'warn',
                message: `failed to remove ${target.path}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              }) + '\n',
            );
          } else {
            getUI().log.warn(
              `Failed to remove ${target.path}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
      // Also strip auth-scoped fields from ampli.json so a follow-up
      // wizard run doesn't reuse the prior org/app binding.
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
