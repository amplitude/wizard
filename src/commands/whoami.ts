import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI } from './helpers';
import { CLI_INVOCATION } from './context';

export const whoamiCommand: CommandModule = {
  command: 'whoami',
  describe: 'Show the currently logged-in user',
  builder: (yargs) => yargs,
  handler: () => {
    void (async () => {
      const { getStoredUser, getStoredToken } = await import(
        '../utils/ampli-settings.js'
      );
      const user = getStoredUser();
      const token = getStoredToken();
      if (user && token && user.id !== 'pending') {
        getUI().log.info(
          `Logged in as ${chalk.bold(user.firstName + ' ' + user.lastName)} <${
            user.email
          }>`,
        );
        if (user.zone !== 'us') getUI().note(`Zone: ${user.zone}`);
      } else {
        getUI().log.warn(
          `Not logged in. Run \`${CLI_INVOCATION} login\` to authenticate.`,
        );
      }
      process.exit(0);
    })();
  },
};
