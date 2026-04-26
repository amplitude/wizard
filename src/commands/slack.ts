import type { CommandModule } from 'yargs';
import { getUI, setUI, LoggingUI } from './helpers';

export const slackCommand: CommandModule = {
  command: 'slack',
  describe: 'Connect Amplitude to Slack',
  builder: (yargs) => yargs,
  handler: () => {
    void (async () => {
      // Dynamic imports may land named exports on `.default` under tsx
      // CJS/ESM interop. This helper normalises that.
      const cjs = <T>(mod: T & { default?: T }): T => (mod.default ?? mod) as T;

      try {
        const { getStoredUser, getStoredToken } = cjs(
          await import('../utils/ampli-settings.js'),
        );
        const { readAmpliConfig } = cjs(await import('../lib/ampli-config.js'));
        const { fetchSlackInstallUrl, fetchSlackConnectionStatus } = cjs(
          await import('../lib/api.js'),
        );
        const { OUTBOUND_URLS } = cjs(await import('../lib/constants.js'));
        const opn = (await import('opn')).default;

        const storedUser = getStoredUser();
        const zone = storedUser?.zone ?? 'us';
        const storedToken = getStoredToken(storedUser?.id, zone);
        // The App API validates access_tokens, not id_tokens.
        const accessToken = storedToken?.accessToken;

        // Read orgId from project-level ampli.json
        const ampliConfig = readAmpliConfig(process.cwd());
        const orgId = ampliConfig.ok ? ampliConfig.config.OrgId : undefined;

        if (!accessToken || !orgId) {
          setUI(new LoggingUI());
          getUI().log.info(
            'No Amplitude session found. Run `npx @amplitude/wizard` first to log in and set up your project.',
          );
          process.exit(1);
        }

        // Check if Slack is already connected before prompting install.
        const isConnected = await fetchSlackConnectionStatus(
          accessToken,
          zone,
          orgId,
        );
        if (isConnected) {
          setUI(new LoggingUI());
          getUI().log.info(
            'Slack is already connected to your Amplitude workspace.',
          );
          process.exit(0);
        }

        const settingsUrl = OUTBOUND_URLS.slackSettings(zone, orgId);
        let url = settingsUrl;

        // Try to get the direct Slack OAuth URL from the App API.
        const directUrl = await fetchSlackInstallUrl(
          accessToken,
          zone,
          orgId,
          settingsUrl,
        );
        if (directUrl) url = directUrl;

        setUI(new LoggingUI());
        getUI().log.info(`Opening Slack integration: ${url}`);
        await opn(url, { wait: false });
      } catch {
        setUI(new LoggingUI());
        const { getCloudUrlFromRegion } = cjs(await import('../utils/urls.js'));
        const opn = (await import('opn')).default;
        const url = `${getCloudUrlFromRegion('us')}/analytics/settings/profile`;
        getUI().log.info(`Opening Amplitude Settings to connect Slack: ${url}`);
        await opn(url, { wait: false });
      }
    })();
  },
};
