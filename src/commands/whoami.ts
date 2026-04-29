import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI } from './helpers';
import { CLI_INVOCATION } from './context';

export const whoamiCommand: CommandModule = {
  command: 'whoami',
  describe: 'Show the currently logged-in user',
  builder: (yargs) => yargs,
  handler: (argv) => {
    void (async () => {
      const { getStoredUser, getStoredToken } = await import(
        '../utils/ampli-settings.js'
      );
      const user = getStoredUser();
      const token = getStoredToken();
      const loggedIn = Boolean(user && token && user.id !== 'pending');
      // Whoami emits JSON ONLY when the caller explicitly opts in via
      // `--json` or `--agent`. We deliberately skip the
      // non-TTY auto-detect path other commands use because existing
      // shell scripts grep this command's plain-text output — flipping
      // the default on a routine pipe would be a silent regression.
      // The skill always passes `--json` so machine consumers get
      // the structured shape.
      const wantsJson =
        Boolean(argv.json as boolean | undefined) ||
        Boolean(argv.agent as boolean | undefined);

      if (wantsJson) {
        // Carry the same shape as `setup_context` so a skill can
        // pass `whoami` output straight into its display logic
        // without a second mapping step. `region` is the canonical
        // 'us' | 'eu' tag (not "Zone:" string). `tokenExpiresAt`
        // is exposed so the orchestrator can decide whether to
        // pre-emptively run `wizard login` before `apply`.
        const region: 'us' | 'eu' | undefined =
          user?.zone === 'eu' ? 'eu' : user?.zone === 'us' ? 'us' : undefined;
        // Best-effort: enrich with the org/app the cwd is bound to
        // so the skill can render "you're logged in as X working on
        // Y" in a single line, matching the setup_context shape.
        // Failures here are silent — whoami works without ampli.json.
        let projectScope:
          | {
              orgId?: string;
              projectId?: string;
              appId?: string;
              appName?: string;
              envName?: string;
            }
          | undefined;
        try {
          const { readAmpliConfig } = await import('../lib/ampli-config.js');
          // Honor the global `--install-dir` flag the rest of the CLI
          // uses. Without this, a skill that calls
          // `wizard whoami --json --install-dir <abs>` would get
          // projectScope from cwd instead of the explicit dir — the
          // same "scanned the wrong project" failure mode this PR is
          // supposed to fix.
          const installDir =
            (argv['install-dir'] as string | undefined) ?? process.cwd();
          const cfg = readAmpliConfig(installDir);
          if (cfg.ok) {
            const next: NonNullable<typeof projectScope> = {};
            if (cfg.config.OrgId) next.orgId = cfg.config.OrgId;
            if (cfg.config.ProjectId) next.projectId = cfg.config.ProjectId;
            if (cfg.config.AppId) next.appId = cfg.config.AppId;
            if (cfg.config.AppName) next.appName = cfg.config.AppName;
            if (cfg.config.EnvName) next.envName = cfg.config.EnvName;
            if (Object.keys(next).length > 0) projectScope = next;
          }
        } catch {
          /* ampli.json read is best-effort */
        }
        process.stdout.write(
          JSON.stringify({
            v: 1,
            '@timestamp': new Date().toISOString(),
            type: 'result',
            message: loggedIn
              ? `whoami: ${user!.email}`
              : 'whoami: not logged in',
            data_version: 1,
            data: {
              event: 'whoami',
              loggedIn,
              ...(loggedIn && user
                ? {
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    ...(region ? { region } : {}),
                    tokenExpiresAt: token?.expiresAt ?? null,
                    ...(projectScope ? { projectScope } : {}),
                  }
                : {
                    // Stable resume hint so a skill can prompt the
                    // user with a one-line copy-paste instead of
                    // composing the command itself.
                    loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
                  }),
            },
          }) + '\n',
        );
        process.exit(0);
        return;
      }

      if (loggedIn && user) {
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
