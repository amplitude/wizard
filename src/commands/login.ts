import type { CommandModule } from 'yargs';
import { getUI, setUI, LoggingUI } from './helpers';

export const loginCommand: CommandModule = {
  command: 'login',
  describe: 'Log in to your Amplitude account',
  builder: (yargs) =>
    yargs.options({
      region: {
        describe: 'data center region (us or eu)',
        choices: ['us', 'eu'] as const,
        default: 'us' as const,
        type: 'string',
        // `--zone` is the pre-existing name; kept as an alias so any
        // scripts using `wizard login --zone` continue to work.
        alias: 'zone',
      },
    }),
  handler: (argv) => {
    void (async () => {
      setUI(new LoggingUI());
      const { performAmplitudeAuth } = await import('../utils/oauth.js');
      const { fetchAmplitudeUser } = await import('../lib/api.js');
      const { storeToken } = await import('../utils/ampli-settings.js');
      // `--region` is canonical; `argv.zone` is the yargs alias mirror.
      const zone = argv.region as 'us' | 'eu';

      try {
        const { getStoredUser, getStoredToken } = await import(
          '../utils/ampli-settings.js'
        );
        // If a valid cached session exists, display the stored user without
        // re-fetching from the API (the cached idToken may be expired).
        const cachedToken = getStoredToken(undefined, zone);
        const cachedUser = cachedToken ? getStoredUser() : undefined;
        if (cachedUser && cachedUser.id !== 'pending') {
          getUI().log.success(
            `Already logged in as ${cachedUser.firstName} ${cachedUser.lastName} <${cachedUser.email}>`,
          );
          if (cachedUser.zone !== 'us') {
            getUI().note(`Zone: ${cachedUser.zone}`);
          }
          process.exit(0);
        }

        const auth = await performAmplitudeAuth({ zone });
        const user = await fetchAmplitudeUser(auth.idToken, auth.zone);
        storeToken(
          {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            zone: auth.zone,
          },
          {
            accessToken: auth.accessToken,
            idToken: auth.idToken,
            refreshToken: auth.refreshToken,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          },
        );
        getUI().log.success(
          `Logged in as ${user.firstName} ${user.lastName} <${user.email}>`,
        );
        if (user.orgs.length > 0) {
          getUI().note(`Org: ${user.orgs.map((o) => o.name).join(', ')}`);
        }
        process.exit(0);
      } catch (e) {
        getUI().log.error(
          `Login failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        process.exit(1);
      }
    })();
  },
};
