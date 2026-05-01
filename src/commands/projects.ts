import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, ExitCode } from './helpers';

export const projectsCommand: CommandModule = {
  command: 'projects <command>',
  describe: "Inspect the authenticated user's Amplitude projects",
  builder: (yargs) =>
    yargs
      .command(
        'list',
        'List accessible projects/environments (paginated, searchable)',
        (yargs) =>
          yargs.options({
            query: {
              describe:
                'case-insensitive substring filter (matches org, workspace, env, app id)',
              type: 'string',
            },
            limit: {
              describe: 'page size (default 25, max 200)',
              type: 'number',
              default: 25,
            },
            offset: {
              describe: 'page offset (default 0)',
              type: 'number',
              default: 0,
            },
          }),
        (argv) => {
          void (async () => {
            const { resolveMode } = await import('../lib/mode-config.js');
            const { jsonOutput } = resolveMode({
              json: argv.json as boolean | undefined,
              human: argv.human as boolean | undefined,
              agent: argv.agent as boolean | undefined,
              requireExplicitWrites: true,
              isTTY: Boolean(process.stdout.isTTY),
            });
            try {
              const { runProjectsList } = await import('../lib/agent-ops.js');
              const offset = (argv.offset as number | undefined) ?? 0;
              const limit = (argv.limit as number | undefined) ?? 25;
              const result = await runProjectsList({
                query: argv.query,
                limit,
                offset,
              });

              if (jsonOutput) {
                // Emit a `needs_input`-shaped envelope so outer agents can
                // render the same picker they would for the inline prompt.
                const hasMore = offset + result.returned < result.total;
                // Use `result.returned`, not the user-supplied `limit`, so
                // an over-the-cap value (e.g. `--limit 9999` clamped to
                // 200 internally) doesn't skip past unread items.
                const nextOffset = offset + result.returned;
                process.stdout.write(
                  JSON.stringify({
                    v: 1,
                    '@timestamp': new Date().toISOString(),
                    type: 'needs_input',
                    message: result.warning
                      ? result.warning
                      : `${result.total} project${
                          result.total === 1 ? '' : 's'
                        } available${
                          result.query ? ` matching "${result.query}"` : ''
                        }.`,
                    ...(result.warning && { level: 'warn' }),
                    data: {
                      event: 'needs_input',
                      code: 'project_selection',
                      ui: {
                        component: 'searchable_select',
                        priority: 'required',
                        title: 'Select an Amplitude project',
                        description:
                          'Choose where events from this app should be sent.',
                        searchPlaceholder:
                          'Search projects, orgs, workspaces, environments…',
                        emptyState:
                          'No projects matched. Try a different query, or run `wizard login` if you expected results.',
                      },
                      choices: result.choices.map((c) => ({
                        value: c.appId,
                        label: c.label,
                        description: c.description,
                        hint: c.envName,
                        metadata: {
                          orgId: c.orgId,
                          orgName: c.orgName,
                          workspaceId: c.workspaceId,
                          workspaceName: c.workspaceName,
                          envName: c.envName,
                          appId: c.appId,
                          rank: c.rank,
                        },
                        resumeFlags: c.resumeFlags,
                      })),
                      recommended: result.choices[0]?.appId,
                      recommendedReason: result.choices[0]
                        ? `Highest-ranked environment in the first matching workspace (${result.choices[0].description}).`
                        : undefined,
                      responseSchema: {
                        appId: 'string (required, from choices[].value)',
                      },
                      pagination: {
                        total: result.total,
                        returned: result.returned,
                        ...(result.query && { query: result.query }),
                        ...(hasMore && {
                          nextCommand: [
                            'npx',
                            '@amplitude/wizard',
                            'projects',
                            'list',
                            '--agent',
                            '--offset',
                            String(nextOffset),
                            '--limit',
                            String(limit),
                            ...(result.query ? ['--query', result.query] : []),
                          ],
                        }),
                      },
                      allowManualEntry: true,
                      manualEntry: {
                        flag: '--app-id',
                        placeholder: 'Enter Amplitude app ID (e.g. 769610)',
                        pattern: '^\\d+$',
                      },
                    },
                  }) + '\n',
                );
              } else {
                const ui = getUI();
                if (result.warning) {
                  ui.log.warn(result.warning);
                } else if (result.total === 0) {
                  ui.note(
                    `No projects matched${
                      result.query ? ` "${result.query}"` : ''
                    }.`,
                  );
                } else {
                  ui.log.info(
                    `${result.total} project${result.total === 1 ? '' : 's'}${
                      result.query ? ` matching "${result.query}"` : ''
                    }:`,
                  );
                  for (const c of result.choices) {
                    ui.log.info(`  ${chalk.bold(c.appId)}  ${c.label}`);
                  }
                  if (offset + result.returned < result.total) {
                    ui.log.info(
                      chalk.dim(
                        `  … ${
                          result.total - result.returned - offset
                        } more — pass --offset and --limit to page.`,
                      ),
                    );
                  }
                }
              }
              process.exit(
                result.warning ? ExitCode.AUTH_REQUIRED : ExitCode.SUCCESS,
              );
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              if (jsonOutput) {
                process.stdout.write(
                  JSON.stringify({
                    v: 1,
                    '@timestamp': new Date().toISOString(),
                    type: 'error',
                    message: `projects list failed: ${message}`,
                    data: { event: 'projects_list_failed' },
                  }) + '\n',
                );
              } else {
                getUI().log.error(`Projects list failed: ${message}`);
              }
              process.exit(ExitCode.GENERAL_ERROR);
            }
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand: `projects list`'),
  handler: () => {
    // Sub-command dispatcher; demandCommand handles the no-op case.
  },
};
