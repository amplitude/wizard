import type { CommandModule } from 'yargs';
import { getUI } from './helpers';
import { resolveInstallDir } from '../utils/install-dir';

export const logoutCommand: CommandModule = {
  command: 'logout',
  describe: 'Log out of your Amplitude account',
  builder: (yargs) => yargs,
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
      const installDir = resolveInstallDir(
        argv.installDir as string | undefined,
      );
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
        // already does. Project-scoped artifacts (`.amplitude/`,
        // setup report) are NOT removed here — that's `wizard reset`.
        // Two surfaces for the same destruction is a launch-day
        // footgun, so we keep them split: `logout` for "I'm done
        // signing in," `reset` for "wipe this project's wizard data."
        clearAuthFieldsInAmpliConfig(installDir);
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
