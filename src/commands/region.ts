import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, setUI, LoggingUI } from './helpers';
import { CLI_INVOCATION, WIZARD_VERSION } from './context';

export const regionCommand: CommandModule = {
  command: 'region',
  describe: 'Switch your data center region (US or EU)',
  builder: (yargs) => yargs,
  handler: (argv) => {
    void (async () => {
      try {
        const { startTUI } = await import('../ui/tui/start-tui.js');
        const { buildSession } = await import('../lib/wizard-session.js');
        const { Flow } = await import('../ui/tui/router.js');
        const { getStoredUser, getStoredToken, updateStoredUserZone } =
          await import('../utils/ampli-settings.js');
        const { getHostFromRegion } = await import('../utils/urls.js');

        const session = buildSession({
          debug: typeof argv['debug'] === 'boolean' ? argv['debug'] : undefined,
        });

        // Show the "Switch data-center region" variant of RegionSelectScreen.
        session.regionForced = true;

        // Pre-populate credentials from ~/.ampli.json so the screen has context.
        const storedUser = getStoredUser();
        const zone = storedUser?.zone ?? 'us';
        const storedToken = getStoredToken(storedUser?.id, zone);
        if (storedToken) {
          session.credentials = {
            accessToken: storedToken.accessToken,
            idToken: storedToken.idToken,
            projectApiKey: '',
            host: getHostFromRegion(zone),
            appId: 0,
          };
        }

        const tui = startTUI(WIZARD_VERSION, Flow.RegionSelect, session);

        // Wait for the user to pick a region, then persist and exit.
        const pickedRegion = await new Promise<string>((resolve) => {
          const unsub = tui.store.subscribe(() => {
            const s = tui.store.session;
            if (s.region !== null && !s.regionForced) {
              unsub();
              resolve(s.region);
            }
          });
        });

        const updated = updateStoredUserZone(pickedRegion as 'us' | 'eu');
        // Write confirmation synchronously: Ink renders asynchronously via
        // React reconciliation, so store.pushStatus() messages would be lost
        // when process.exit(0) fires on the next line.
        if (updated) {
          console.log(
            chalk.green(`\n✔ Region updated to ${pickedRegion.toUpperCase()}`),
          );
        } else {
          console.log(
            chalk.dim(
              `\nRegion set to ${pickedRegion.toUpperCase()}. Run \`${CLI_INVOCATION} login\` to authenticate.`,
            ),
          );
        }
        process.exit(0);
      } catch {
        setUI(new LoggingUI());
        getUI().log.error(
          `Could not start region picker. Use --region with \`${CLI_INVOCATION} login\` to set your region.`,
        );
        process.exit(1);
      }
    })();
  },
};
