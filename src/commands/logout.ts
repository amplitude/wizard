import type { CommandModule } from 'yargs';
import { getUI } from './helpers';

export const logoutCommand: CommandModule = {
  command: 'logout',
  describe: 'Log out of your Amplitude account',
  builder: (yargs) =>
    yargs.options({
      clean: {
        // Logout already clears the OAuth token + per-project API key +
        // checkpoint. `--clean` extends that to also delete the
        // project-scoped wizard artifacts (`.amplitude/events.json`,
        // `.amplitude/dashboard.json`, the legacy `.amplitude-*.json`
        // dotfiles, and `amplitude-setup-report.md`). Off by default
        // so a logout-during-debug doesn't nuke a user's setup
        // report; opt-in for "I want a clean slate before re-running
        // the wizard."
        describe:
          'Also delete .amplitude/ project artifacts and the setup report',
        type: 'boolean',
        default: false,
      },
    }),
  handler: (argv) => {
    void (async () => {
      const { getStoredUser, clearStoredCredentials } = await import(
        '../utils/ampli-settings.js'
      );
      const { clearApiKey } = await import('../utils/api-key-store.js');
      const { clearCheckpoint } = await import('../lib/session-checkpoint.js');
      const { clearAuthFieldsInAmpliConfig } = await import(
        '../lib/ampli-config.js'
      );
      const installDir =
        (argv.installDir as string | undefined) ?? process.cwd();
      const user = getStoredUser();
      try {
        clearStoredCredentials();
        clearApiKey(installDir);
        clearCheckpoint(installDir);
        // Strip auth-scoped fields (OrgId / ProjectId / AppId / AppName /
        // EnvName / DashboardUrl / DashboardId) from ampli.json so the
        // next sign-in starts on a clean scope. Tracking-plan fields
        // (SourceId, Branch, Version) survive — they belong to the
        // codebase, not the user. Mirrors what the TUI LogoutScreen
        // already does.
        clearAuthFieldsInAmpliConfig(installDir);
        if (argv.clean) {
          // --clean: nuke the project's wizard-managed artifacts.
          // Best-effort: each removal is wrapped so a missing file
          // (the common case) doesn't fail the logout.
          const fs = await import('node:fs');
          const path = await import('node:path');
          const targets = [
            path.join(installDir, '.amplitude'),
            path.join(installDir, '.amplitude-events.json'),
            path.join(installDir, '.amplitude-dashboard.json'),
            path.join(installDir, 'amplitude-setup-report.md'),
          ];
          for (const target of targets) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
            } catch {
              /* best-effort cleanup */
            }
          }
        }
        if (user) {
          getUI().log.success(`Logged out ${user.email}`);
        } else {
          getUI().note('No active session found.');
        }
      } catch {
        getUI().note('No active session found.');
      }
      process.exit(0);
    })();
  },
};
