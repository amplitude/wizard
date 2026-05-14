/**
 * agent-manifest — Machine-readable description of the CLI surface.
 *
 * Exposed via `amplitude-wizard help --json` so AI coding agents can
 * introspect the available commands, flags, env vars, and exit codes
 * without parsing human help text.
 *
 * Kept hand-maintained (rather than auto-generated from yargs internals)
 * so it stays a stable contract that changes only intentionally. Two
 * blocks ARE generated, however, so they can't drift from the runtime:
 *
 *   - `exitCodes`     — generated from the `ExitCode` enum +
 *                       `ExitCodeDescription` map in `exit-codes.ts`.
 *   - `ndjsonProtocol` — generated from `AGENT_EVENT_WIRE_VERSION`,
 *                       `WIZARD_PROTOCOL_VERSION`, and
 *                       `EVENT_DATA_VERSIONS` in `agent-events.ts`.
 *
 * Adding a new exit code or registering a new event in the wire format
 * automatically surfaces in `wizard manifest` — no manual edit here.
 */

import {
  AGENT_EVENT_WIRE_VERSION,
  EVENT_DATA_VERSIONS,
  WIZARD_PROTOCOL_VERSION,
} from './agent-events.js';
import { ExitCode, ExitCodeDescription } from './exit-codes.js';

export interface CommandFlag {
  name: string;
  describe: string;
  type: 'string' | 'boolean' | 'number';
  default?: string | boolean | number;
}

export interface CommandEntry {
  command: string;
  describe: string;
  flags?: CommandFlag[];
  subcommands?: CommandEntry[];
  outputs?: 'human' | 'json' | 'ndjson' | 'both';
}

/**
 * Wire-format + protocol-version block surfaced on the manifest. Mirrors
 * what `--print-protocol` advertises out-of-band so an orchestrator that
 * probes `wizard manifest` once at cold-start gets the same numbers it
 * would observe on the NDJSON stream during a live run.
 *
 * All three fields are imported from `agent-events.ts` — single source of
 * truth, no re-declared constants. Adding a new registered event in
 * `EVENT_DATA_VERSIONS` automatically appears in `eventDataVersions`
 * here; bumping `WIZARD_PROTOCOL_VERSION` automatically bumps
 * `protocolVersion` here.
 */
export interface NdjsonProtocolBlock {
  /**
   * Envelope-level wire-format version (`v` on every NDJSON line).
   * Mirrors `AGENT_EVENT_WIRE_VERSION`. Bumped only on breaking changes
   * to the top-level envelope keys.
   */
  wireVersion: number;
  /**
   * Coarse-grained "wizard protocol" version covering CLI flags, exit
   * codes, and NDJSON framing outside the envelope itself. Mirrors
   * `WIZARD_PROTOCOL_VERSION`. Same value `--print-protocol` returns
   * as `wizardProtocolVersion`.
   */
  protocolVersion: number;
  /**
   * Per-event-type data-shape versions, keyed off the `data.event`
   * discriminator. Mirror of `EVENT_DATA_VERSIONS`. Orchestrators
   * branch on `(type, data.event, data_version)` and can read this
   * map at cold-start to learn which version they're about to see.
   */
  eventDataVersions: Record<string, number>;
}

export interface AgentManifest {
  schemaVersion: 1;
  bin: string;
  /** npm package name, for `npx <package>` invocation. */
  package: string;
  /**
   * Ordered list of ways to invoke the CLI. The first entry is the
   * recommended form — agents should use it unless they know the CLI
   * is globally installed. Each entry is an argv prefix that precedes
   * the verb and flags (e.g. `[...invocation, 'detect', '--json']`).
   */
  invocations: Array<{
    argv: string[];
    describe: string;
    requiresGlobalInstall: boolean;
  }>;
  description: string;
  /**
   * Amplitude's data-model terminology — surfaces the hierarchy so agents
   * reading the manifest know that `org`, `project`, `app`, and
   * `environment` are nested, not synonyms. Without this, agents tend to
   * confuse `--env` (Amplitude environment) with environment variables, or
   * `project` with a directory path. Canonical terms align with the
   * amplitude/amplitude (Python `app_id`, `orgs` table) and
   * amplitude/javascript (`App` GraphQL type, `appId`) monorepos — not
   * Amplitude's UI surface, which sometimes says "Project ID" for app.id.
   * Note: the backend still calls the project-level container a "workspace"
   * internally (GraphQL `workspaces` field, legacy `WorkspaceId` in
   * ampli.json); the manifest uses the user-facing "project" term.
   */
  concepts: {
    hierarchy: string[];
    glossary: Array<{ term: string; describe: string }>;
  };
  globalFlags: CommandFlag[];
  env: Array<{ name: string; describe: string }>;
  exitCodes: Array<{ code: number; name: string; describe: string }>;
  commands: CommandEntry[];
  /**
   * @deprecated Use `ndjsonProtocol.wireVersion` instead. Retained for one
   * release as an alias so existing orchestrators that branched on
   * `manifest.ndjsonSchemaVersion === 1` don't break. Always equals
   * `ndjsonProtocol.wireVersion`; will be removed in the next manifest
   * `schemaVersion` bump.
   */
  ndjsonSchemaVersion: 1;
  /**
   * NDJSON wire-format + protocol-version block, generated from
   * `AGENT_EVENT_WIRE_VERSION` / `WIZARD_PROTOCOL_VERSION` /
   * `EVENT_DATA_VERSIONS` in `agent-events.ts`. Mirrors the payload
   * `--print-protocol` returns, so an orchestrator that probes
   * `wizard manifest` once at cold-start has every protocol number it
   * needs without spawning a second probe.
   */
  ndjsonProtocol: NdjsonProtocolBlock;
}

export function getAgentManifest(): AgentManifest {
  return {
    schemaVersion: 1,
    bin: 'amplitude-wizard',
    package: '@amplitude/wizard',
    invocations: [
      {
        argv: ['npx', '@amplitude/wizard'],
        describe: 'Works without installation (recommended for agents)',
        requiresGlobalInstall: false,
      },
      {
        argv: ['amplitude-wizard'],
        describe: 'Direct bin — requires `npm install -g @amplitude/wizard`',
        requiresGlobalInstall: true,
      },
    ],
    description:
      'Interactive CLI that instruments apps with Amplitude analytics.',
    concepts: {
      hierarchy: ['org', 'project', 'app', 'environment'],
      glossary: [
        {
          term: 'org',
          describe:
            'An Amplitude organization (account-level). Identified by a UUID. Canonical backend term: `org_id` (Python) / `orgId` (TS). Auto-derived from --app-id — agents should not pass --org directly.',
        },
        {
          term: 'project',
          describe:
            'A tracking-plan container inside an org (holds branches, tickets, and observed schema). Identified by a UUID. Auto-derived from --app-id — agents should not pass --project-id directly. Note: the backend still refers to this as a "workspace" internally.',
        },
        {
          term: 'app',
          describe:
            'An Amplitude app — the ingestion surface that owns an API key and receives events. Identified by a numeric ID (e.g. 769610). Canonical across amplitude/amplitude (`app_id`, `orgs` table has `supports_cross_app`) and amplitude/javascript (`export type App`, `appId`). Amplitude\'s UI labels the same numeric ID "Project ID". Pass --app-id <id> — this is the only scope flag agents need.',
        },
        {
          term: 'environment',
          describe:
            'A named runtime mode of an app (e.g. "Production", "Development", "Staging"). Not a POSIX environment variable. Each env has its own app.id and API key, so --app-id already identifies one env. Auto-selected from --app-id.',
        },
        {
          term: 'API key',
          describe:
            'An app-level ingestion key embedded into client code (amplitude.init("<key>")). Fetched automatically after `amplitude-wizard login`; agents should not pass one directly.',
        },
        {
          term: 'access token',
          describe:
            'An OAuth access token minted by `amplitude-wizard login`. Used for server-side API calls, never embedded in client code. Passed with AMPLITUDE_TOKEN.',
        },
      ],
    },
    globalFlags: [
      {
        name: '--agent',
        describe:
          'NDJSON output, auto-approve prompts (best for AI coding agents)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--json',
        describe:
          'Emit machine-readable JSON output (implied when piped). Unlike --agent, does not auto-approve prompts.',
        type: 'boolean',
        default: false,
      },
      {
        name: '--human',
        describe: 'Force human-readable output (overrides --json auto-detect)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--ci',
        describe: 'Run non-interactively (no prompts, no colors)',
        type: 'boolean',
        default: false,
      },
      {
        name: '--yes',
        describe:
          'Skip all prompts and grant the inner agent write capability. Required for the `apply` subcommand. Distinct from --auto-approve, which only picks defaults on `needs_input`.',
        type: 'boolean',
        default: false,
      },
      {
        name: '--auto-approve',
        describe:
          'Silently pick the recommended choice on `needs_input` prompts. Does NOT grant write capability — pair with --yes to allow file writes.',
        type: 'boolean',
        default: false,
      },
      {
        name: '--force',
        describe:
          'Allow destructive writes (overwrite/delete existing files). Implies --yes.',
        type: 'boolean',
        default: false,
      },
      {
        name: '--install-dir',
        describe: 'Project directory to inspect or instrument',
        type: 'string',
      },
      {
        name: '--app-id',
        describe:
          'Amplitude app ID (numeric, e.g. 769610). The only scope flag agents need — org, project, and environment are derived automatically. See concepts.glossary.',
        type: 'string',
      },
      {
        name: '--app-name',
        describe:
          'Name for a new Amplitude app (creates one when no apps exist, or with --ci/--agent).',
        type: 'string',
      },
      {
        name: '--debug',
        describe: 'Enable debug logging',
        type: 'boolean',
        default: false,
      },
    ],
    env: [
      {
        name: 'AMPLITUDE_TOKEN',
        describe:
          'OAuth access-token override (requires prior `amplitude-wizard login`)',
      },
      {
        name: 'AMPLITUDE_WIZARD_TOKEN',
        describe: 'Alias for AMPLITUDE_TOKEN',
      },
      {
        name: 'AMPLITUDE_WIZARD_AGENT',
        describe: 'Set to 1 to force agent mode (NDJSON output, auto-approve)',
      },
      {
        name: 'AMPLITUDE_WIZARD_DEBUG',
        describe: 'Set to 1 to enable debug logging',
      },
      {
        name: 'AMPLITUDE_WIZARD_LOG',
        describe: 'Path to write logs to',
      },
      {
        name: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
        describe:
          'Set to 1 to skip the nested-invocation diagnostic. The wizard sanitizes inherited outer-agent env vars either way, so nesting works by default.',
      },
      {
        name: 'AMPLITUDE_WIZARD_MAX_TURNS',
        describe:
          "Override the inner agent's per-run turn cap (default 200, sanity-bounded at 10000). Useful for unusually long-running setups.",
      },
    ],
    // exitCodes is generated from the `ExitCode` enum + `ExitCodeDescription`
    // map so adding a new code in `exit-codes.ts` surfaces here automatically.
    // Sorted by numeric value so the manifest is stable across reorderings
    // of the source enum (which is read in declaration order today, but
    // shouldn't be a contract). The manifest test asserts every `ExitCode`
    // enum value appears here — drift fails CI.
    exitCodes: (
      Object.entries(ExitCode) as Array<
        [keyof typeof ExitCode, (typeof ExitCode)[keyof typeof ExitCode]]
      >
    )
      .map(([name, code]) => ({
        code,
        name,
        describe: ExitCodeDescription[name],
      }))
      .sort((a, b) => a.code - b.code),
    commands: [
      {
        command: '(default)',
        describe: 'Run the full interactive setup wizard',
        outputs: 'human',
      },
      {
        command: 'detect',
        describe: 'Detect the framework used in the current project',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to inspect',
            type: 'string',
          },
        ],
      },
      {
        command: 'status',
        describe:
          'Report project setup state: framework, SDK installed, API key, auth',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to inspect',
            type: 'string',
          },
        ],
      },
      {
        command: 'plan',
        describe:
          'Plan an Amplitude setup without making any changes (emits a structured WizardPlan + planId; planId is valid for 24h, pass it to `apply` to execute)',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to plan against',
            type: 'string',
          },
        ],
      },
      {
        command: 'apply',
        describe:
          'Execute a previously generated plan. Requires --plan-id and --yes; pair with --force for destructive overwrites.',
        outputs: 'both',
        flags: [
          {
            name: '--plan-id',
            describe: 'plan ID returned by `amplitude-wizard plan`',
            type: 'string',
          },
          {
            name: '--install-dir',
            describe: 'Project directory the plan was generated against',
            type: 'string',
          },
        ],
      },
      {
        command: 'verify',
        describe:
          'Verify a project setup without running the agent (no-network check that SDK + API key + framework are all in place). Exits non-zero on failure.',
        outputs: 'both',
        flags: [
          {
            name: '--install-dir',
            describe: 'Project directory to verify',
            type: 'string',
          },
        ],
      },
      {
        command: 'auth status',
        describe: 'Show current login state',
        outputs: 'both',
      },
      {
        command: 'auth token',
        describe: 'Print the stored OAuth access token to stdout (for scripts)',
        outputs: 'both',
      },
      {
        command: 'login',
        describe: 'Authenticate with Amplitude via browser OAuth',
        outputs: 'human',
      },
      {
        command: 'logout',
        describe: 'Clear stored credentials',
        outputs: 'human',
      },
      {
        command: 'whoami',
        describe: 'Show logged-in user (legacy; prefer `auth status --json`)',
        outputs: 'human',
      },
      {
        command: 'mcp add',
        describe: 'Install the Amplitude MCP server into your editor',
        outputs: 'human',
      },
      {
        command: 'mcp remove',
        describe: 'Remove the Amplitude MCP server from your editor',
        outputs: 'human',
      },
      {
        command: 'mcp serve',
        describe:
          'Run the Amplitude wizard MCP server on stdio (for AI coding agents)',
        outputs: 'json',
      },
      {
        command: 'manifest',
        describe: 'Print this machine-readable CLI manifest',
        outputs: 'json',
      },
    ],
    ndjsonSchemaVersion: 1,
    // Imported from `agent-events.ts` — no re-declared constants. The
    // `EVENT_DATA_VERSIONS` registry is cloned into a plain Record so the
    // JSON serializer emits a stable POJO (the source is an `as const`
    // tuple). Mirrors what `--print-protocol` surfaces out-of-band; the
    // manifest test asserts both blocks stay in sync with the source.
    ndjsonProtocol: {
      wireVersion: AGENT_EVENT_WIRE_VERSION,
      protocolVersion: WIZARD_PROTOCOL_VERSION,
      eventDataVersions: Object.fromEntries(
        Object.entries(EVENT_DATA_VERSIONS),
      ),
    },
  };
}
