import type { CommandModule } from 'yargs';
import { getUI } from './helpers';

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
      const installDir =
        (argv.installDir as string | undefined) ?? process.cwd();
      const user = getStoredUser();
      try {
        clearStoredCredentials();
        clearApiKey(installDir);
        clearCheckpoint(installDir);
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
