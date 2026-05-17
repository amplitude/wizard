// Shared helpers used by multiple command modules. Extracted from the
// monolithic bin.ts so each per-command file can stay focused on its
// own builder/handler.

import { getUI, setUI } from '../ui';
import type { AgentUI } from '../ui/agent-ui';
import { LoggingUI } from '../ui/logging-ui';
import { ExitCode } from '../lib/exit-codes';
import { analytics } from '../utils/analytics';
import type { AmplitudeZone } from '../lib/constants';
import { TERMS_OF_SERVICE_URL } from '../lib/constants.js';
import { accountCreationProvisioningInputsReady } from '../lib/account-creation-flow.js';
import {
  AuthOnboardingPath,
  isCreateAccountOnboarding,
} from '../lib/wizard-session.js';
import { setProjectLogFile } from '../lib/observability';
import { runMigrationShim } from '../utils/storage-migration';
import { assertNever } from '../utils/assert-never';
import { CLI_INVOCATION } from './context';

/**
 * Options accepted by `emitCliEnvelope` — the unifier for the ~17 inline
 * `process.stdout.write(JSON.stringify({ v: 1, '@timestamp': ... }) + '\n')`
 * sites in `src/commands/*.ts`.
 *
 * **Wire contract.** External orchestrators (Claude Code, Cursor, parent
 * agents) parse this NDJSON envelope. Field SHAPE *and* field ORDER are
 * part of the contract — `JSON.stringify` preserves insertion order for
 * plain object properties, so the helper builds the object in the exact
 * canonical order observed across 15 of the 17 prior inline sites:
 *
 *     v, @timestamp, type, [level?], message, [data_version?], [data?]
 *
 * `projects.ts:64` (the only outlier — places `data_version` BEFORE
 * `message`) and `orchestration.ts` (Zod-validated, totally different
 * shape) deliberately remain inline. Migrating them through this helper
 * would change their wire bytes, breaking orchestrators that key off the
 * existing field order.
 */
export interface CliEnvelopeOpts {
  /** Envelope kind (`error`, `lifecycle`, `result`, `log`, `plan`, …). Required. */
  type: string;
  /**
   * Severity tag, emitted only when present. The canonical sites use this
   * exclusively for `'error'` (apply/plan refusals) and `'warn'` (reset
   * filesystem warnings); pass `undefined` for everything else and the
   * field is omitted from the wire bytes entirely.
   */
  level?: 'info' | 'warn' | 'error';
  /** Human-readable single-line message. Optional — log-only envelopes omit it. */
  message?: string;
  /**
   * Schema version for `data` — only emitted when present. Migration sites
   * that previously stamped `data_version: 1` (apply setup_context, plan
   * setup_context, reset result, whoami) opt in by passing this; sites
   * that never stamped it must pass `undefined` so the wire bytes stay
   * byte-identical.
   */
  dataVersion?: number;
  /**
   * Structured payload. Optional — some sites (reset.ts:70 warn) omit `data`
   * entirely. Passing `undefined` here skips the field so we don't emit
   * `"data":null` into the wire stream.
   */
  data?: Record<string, unknown>;
  /**
   * Override the `@timestamp` field. Defaults to `new Date().toISOString()`.
   * Exposed so tests can pin a deterministic timestamp without freezing the
   * global `Date`. Real production callers should never pass this.
   */
  now?: string;
}

/**
 * Serialize a CLI NDJSON envelope to its exact wire bytes (including the
 * trailing newline). Returns the string rather than writing it directly so
 * callers retain control over the sink — most sites pipe it straight to
 * `process.stdout.write`, but tests can capture it without spying on the
 * global `process.stdout`.
 *
 * The helper guarantees:
 *
 *   - Field order is fixed: `v`, `@timestamp`, `type`, `level?`,
 *     `message?`, `data_version?`, `data?`.
 *   - `v` is always literal `1`.
 *   - Optional fields are **skipped entirely** when `undefined` — the
 *     output never contains `"level":undefined` or `"data_version":null`.
 *     This matches the inline-site behavior, which omits these keys
 *     conditionally rather than emitting null sentinels.
 *   - A trailing `\n` is always appended so the result is one complete
 *     NDJSON line ready for stdout.
 */
export function emitCliEnvelope(opts: CliEnvelopeOpts): string {
  const envelope: Record<string, unknown> = {
    v: 1,
    '@timestamp': opts.now ?? new Date().toISOString(),
    type: opts.type,
  };
  // `level` slot: between `type` and `message` per the canonical order.
  // Conditional assignment — never emit `level: undefined`.
  if (opts.level !== undefined) envelope.level = opts.level;
  if (opts.message !== undefined) envelope.message = opts.message;
  // `data_version` lives BETWEEN `message` and `data` per the canonical
  // order — matches apply/plan/reset/whoami's existing layout. Sites that
  // currently put `data_version` before `message` (projects.ts:64) are
  // deliberately NOT migrated through this helper; rerouting them would
  // change their wire bytes and break orchestrators that key off field
  // position.
  if (opts.dataVersion !== undefined) envelope.data_version = opts.dataVersion;
  if (opts.data !== undefined) envelope.data = opts.data;
  return JSON.stringify(envelope) + '\n';
}

function authOnboardingPathFromArgv(
  options: Record<string, unknown>,
): AuthOnboardingPath | undefined {
  const raw = options.authOnboarding as string | undefined;
  if (raw === 'create-account') return AuthOnboardingPath.CreateAccount;
  if (raw === 'sign-in') return AuthOnboardingPath.SignIn;
  if (options.signup === true) return AuthOnboardingPath.CreateAccount;
  return undefined;
}

// Dynamic import to avoid preloading wizard-session.ts as CJS, which
// prevents the TUI's ESM dynamic imports from resolving named exports.
export const lazyRunWizard = async (
  ...args: Parameters<typeof import('../run')['runWizard']>
) => {
  const { runWizard } = await import('../run.js');
  return runWizard(...args);
};

/**
 * Bootstrap per-project storage state once `installDir` is known. Idempotent:
 *
 *   1. Runs the one-shot migration shim FIRST — moves any pre-refactor paths
 *      (e.g. `/tmp/amplitude-wizard.log`, `<installDir>/.amplitude-events.json`)
 *      into the new layout. Drop after one release.
 *   2. THEN switches the logger from `<cacheRoot>/bootstrap.log` to the
 *      per-project file under `<cacheRoot>/runs/<hash>/log.txt`. Two
 *      parallel wizard runs in different directories no longer share a log.
 *
 * Order matters: migration runs before the logger switches because
 * `setProjectLogFile` writes a "continuing in <target>" marker to the
 * bootstrap log. If that marker created `<cacheRoot>/bootstrap.log` first,
 * the migration's "skip when destination exists" branch would discard the
 * legacy `/tmp/amplitude-wizard.log` content instead of moving it across.
 *
 * Called from `buildSessionFromOptions` so every entry path picks it up
 * automatically (TUI, agent, CI, sub-commands). Skipped when
 * `AMPLITUDE_WIZARD_SKIP_BOOTSTRAP=1` (wizard-internal opt-out) because
 * vitest module mocks don't always intercept the dynamic-import chain
 * bin.ts uses, and CLI tests aren't exercising the storage migration
 * anyway — there's a dedicated test suite for that. We deliberately do
 * NOT gate on `NODE_ENV=test`: real users sometimes run the wizard
 * inside a test harness (e.g. their app's CI), and they should still
 * get migration + per-project log routing.
 */
function bootstrapInstallDir(installDir: string): void {
  if (process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP === '1') return;
  runMigrationShim(installDir);
  setProjectLogFile(installDir);
}

/**
 * Build a WizardSession from CLI argv, avoiding the repeated 12-field literal.
 * Also runs `bootstrapInstallDir` so every command path migrates legacy
 * storage and switches the logger to the per-project location once
 * `installDir` is known.
 *
 * **Mode-gated args:** the resolved execution mode is threaded into
 * `buildSession` so `--auth-onboarding`, `--email`, and `--accept-tos`
 * are dropped in interactive TUI runs (the Intro picker, signup-email
 * screen, and ToS screen own those decisions). Non-interactive modes
 * (`--ci` / `--agent`) honor every flag as today.
 */
export const buildSessionFromOptions = async (
  options: Record<string, unknown>,
  overrides?: { ci?: boolean },
) => {
  const { buildSession } = await import('../lib/wizard-session.js');
  const { resolveMode } = await import('../lib/mode-config.js');
  // Resolve the effective mode using the same inputs `resolveMode` uses
  // elsewhere. `ci` may be forced via the `overrides` arg (e.g. the
  // `apply` subcommand always runs CI-style); otherwise we read it from
  // argv. `--agent` and `--yes` similarly come from argv. `isTTY` reflects
  // the real terminal state — non-TTY auto-routes to ci, TTY + no other
  // flags lands on `interactive`.
  const { mode } = resolveMode({
    ci: overrides?.ci ?? Boolean(options.ci),
    yes: Boolean(options.yes),
    autoApprove: Boolean(options.autoApprove),
    force: Boolean(options.force),
    agent: Boolean(options.agent),
    isTTY: Boolean(process.stdout.isTTY),
  });
  const executionMode = mode;
  const session = buildSession({
    debug: options.debug as boolean | undefined,
    verbose: options.verbose as boolean | undefined,
    forceInstall: options.forceInstall as boolean | undefined,
    installDir: options.installDir as string | undefined,
    ci: overrides?.ci ?? false,
    authOnboardingPath: authOnboardingPathFromArgv(options),
    localMcp: options.localMcp as boolean | undefined,
    apiKey: options.apiKey as string | undefined,
    menu: options.menu as boolean | undefined,
    signupEmail: options.email as string | undefined,
    signupFullName: options['full-name'] as string | undefined,
    acceptTos:
      options.acceptTos === true ||
      (options['accept-tos'] as boolean | undefined) === true,
    // --region is canonical; --zone is a yargs alias, so `options.region`
    // is populated by either flag.
    region: options.region as AmplitudeZone | undefined,
    integration: options.integration as Parameters<
      typeof buildSession
    >[0]['integration'],
    benchmark: options.benchmark as boolean | undefined,
    mode: options.mode as 'fast' | 'standard' | 'thorough' | undefined,
    // --app-id is the canonical flag; --project-id is now a separate flag that
    // refers to the Amplitude project (formerly workspace), not the app.
    appId: options.appId as string | undefined,
    appName: options.appName as string | undefined,
    executionMode,
  });
  bootstrapInstallDir(session.installDir);
  return session;
};

/**
 * Shared credential resolution for non-interactive modes (agent + CI).
 * Handles --api-key shortcut, OAuth token refresh, and pendingOrgs.
 *
 * @param mode - 'agent' prompts via AgentUI, 'ci' auto-selects first env
 */
export const resolveNonInteractiveCredentials = async (
  session: import('../lib/wizard-session').WizardSession,
  options: Record<string, unknown>,
  mode: 'agent' | 'ci',
  agentUI?: import('../ui/agent-ui').AgentUI,
) => {
  // Fast path: --api-key / AMPLITUDE_WIZARD_API_KEY provided. This is a real
  // project API key, safe to embed into generated client-side code (it ends
  // up in amplitude.init('${projectApiKey}') calls).
  //
  // AMPLITUDE_TOKEN / AMPLITUDE_WIZARD_TOKEN is an OAuth *access token*, NOT a
  // project API key. It must never be used as projectApiKey — doing so would
  // (a) leak an OAuth secret into client bundles and (b) break SDK init since
  // it isn't a valid ingestion key. OAuth tokens fall through to
  // resolveCredentials below, which reads the full stored session from
  // ~/.ampli.json (idToken, refreshToken) and fetches the real project API
  // key from the Amplitude API.
  if (session.apiKey) {
    const { DEFAULT_HOST_URL } = await import('../lib/constants.js');
    // Normally `accessToken` and `projectApiKey` are the same value (the
    // project API key — embeddable in client bundles, also accepted by
    // the Amplitude wizard-proxy). For CI / smoke-test scenarios that
    // need to authenticate against the wizard-proxy with a real OAuth
    // bearer (e.g. a Hydra service-account token) while still embedding
    // the project API key into generated SDK init code, set
    // `AMPLITUDE_WIZARD_PROXY_BEARER` to the OAuth bearer. The bearer is
    // used only for outbound auth headers; `session.apiKey` continues to
    // flow into generated `amplitude.init('<projectApiKey>')` calls.
    const proxyBearer =
      process.env.AMPLITUDE_WIZARD_PROXY_BEARER?.trim() || session.apiKey;
    session.credentials = {
      accessToken: proxyBearer,
      projectApiKey: session.apiKey,
      host: DEFAULT_HOST_URL,
      appId: session.appId ?? 0,
    };
    session.projectHasData = false;
    return;
  }

  // Resolve credentials from stored OAuth tokens. AMPLITUDE_TOKEN /
  // AMPLITUDE_WIZARD_TOKEN (if set) overrides the stored access token so
  // an automation can inject a fresh one — but a prior `amplitude-wizard
  // login` is still required because we need the stored idToken to fetch
  // the project API key.
  const envAccessToken =
    process.env.AMPLITUDE_TOKEN ?? process.env.AMPLITUDE_WIZARD_TOKEN;
  const { resolveCredentials, resolveEnvironmentSelection } = await import(
    '../lib/credential-resolution.js'
  );
  // Prefer --project-id (canonical); fall back to --workspace-id (hidden legacy alias).
  const projectIdFlag =
    (options.projectId as string | undefined) ??
    (options.workspaceId as string | undefined);
  await resolveCredentials(session, {
    requireOrgId: false,
    org: options.org as string | undefined,
    env: options.env as string | undefined,
    projectId: projectIdFlag,
    appId: options.appId as string | undefined,
    accessTokenOverride: envAccessToken,
  });

  // ── Non-interactive create-project ────────────────────────────────
  // `--project-name <name>` triggers an inline project creation when the
  // authenticated user has an org but no projects to choose from (or when
  // the orchestrator explicitly asks for a fresh project). Must not prompt.
  const projectName = (options.appName as string | undefined)?.trim();
  if (
    projectName &&
    session.pendingOrgs &&
    !session.credentials &&
    session.pendingAuthIdToken &&
    session.pendingAuthAccessToken
  ) {
    const { createAmplitudeApp, ApiError } = await import('../lib/api.js');
    const { getHostFromRegion } = await import('../utils/urls.js');
    const { persistApiKey } = await import('../utils/api-key-store.js');

    // Pick an org: --org flag if provided, else the first org with access.
    const orgFlag = (options.org as string | undefined)?.toLowerCase();
    const org =
      (orgFlag &&
        session.pendingOrgs.find(
          (o) =>
            o.name.toLowerCase() === orgFlag || o.id.toLowerCase() === orgFlag,
        )) ||
      session.pendingOrgs[0];

    if (!org) {
      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateError({
          code: 'MISSING_ORG',
          message:
            'No Amplitude organization available to create a project in.',
          name: projectName,
        });
      } else {
        getUI().log.error(
          'No Amplitude organization available to create a project in.',
        );
      }
      process.exit(ExitCode.AUTH_REQUIRED);
    }

    const { resolveZone } = await import('../lib/zone-resolution.js');
    const { DEFAULT_AMPLITUDE_ZONE } = await import('../lib/constants.js');
    const { toCredentialAppId } = await import('../lib/wizard-session.js');
    // Pre-OAuth CLI path: session.region may be unset, fall back to disk tiers.
    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: true,
    });
    if (mode === 'agent' && agentUI) {
      agentUI.emitProjectCreateStart({ orgId: org.id, name: projectName });
    } else {
      getUI().log.info(
        `Creating Amplitude project "${projectName}" in ${org.name}…`,
      );
    }

    const { getOrCreateProjectIdempotencyKey, clearProjectIdempotencyKey } =
      await import('../lib/idempotency-key.js');
    try {
      // Source the idempotency key from session state so a network blip
      // mid-create can't double-create the project — proxy dedupes a
      // replay with the same key. CLI orchestrators that retry a failed
      // `wizard --project-name X` invocation will get a fresh process
      // (so a fresh key) — that's the correct behaviour, since "user
      // re-ran the command" is a different logical attempt.
      const idempotencyKey = getOrCreateProjectIdempotencyKey(session);
      const created = await createAmplitudeApp(
        session.pendingAuthAccessToken,
        zone,
        { orgId: org.id, name: projectName, idempotencyKey },
      );

      // Persist outside the API's error path — the project exists on the
      // backend at this point. A local persist failure (FS permission, etc.)
      // must not be reported as a create-project error, because the
      // orchestrator retry would then hit NAME_TAKEN.
      try {
        persistApiKey(created.apiKey, session.installDir);
      } catch (persistErr) {
        const msg =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        getUI().log.warn(
          `Project created but failed to persist API key locally: ${msg}. ` +
            `Set AMPLITUDE_API_KEY=<key> manually or rerun once the issue is resolved.`,
        );
      }
      session.selectedOrgId = org.id;
      session.selectedOrgName = org.name;
      session.selectedEnvName = created.name;
      session.credentials = {
        accessToken: session.pendingAuthAccessToken ?? '',
        idToken: session.pendingAuthIdToken,
        projectApiKey: created.apiKey,
        host: getHostFromRegion(zone),
        appId: toCredentialAppId(created.appId),
      };
      session.projectHasData = false;

      // Successful create — clear the idempotency key so a follow-up
      // create attempt later in the same session starts fresh. We
      // intentionally do NOT clear on error so a user-driven retry
      // replays the same key for proxy-side dedupe.
      clearProjectIdempotencyKey(session);

      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateSuccess({
          appId: created.appId,
          name: created.name,
          orgId: org.id,
        });
      } else {
        getUI().log.info(`Project created: ${created.name} (${created.appId})`);
      }
    } catch (err) {
      const isApi = err instanceof ApiError;
      const code = isApi && err.code ? err.code : 'INTERNAL';
      const message = err instanceof Error ? err.message : String(err);

      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateError({
          code: code as Parameters<
            typeof agentUI.emitProjectCreateError
          >[0]['code'],
          message,
          name: projectName,
        });
      } else {
        getUI().log.error(`Create project failed (${code}): ${message}`);
      }

      // NAME_TAKEN gets a dedicated exit code so orchestrators can
      // distinguish "pick a new name" from generic failures.
      if (code === 'NAME_TAKEN') process.exit(ExitCode.PROJECT_NAME_TAKEN);
      if (code === 'FORBIDDEN' || code === 'QUOTA_REACHED')
        process.exit(ExitCode.AUTH_REQUIRED);
      if (code === 'INVALID_REQUEST') process.exit(ExitCode.INVALID_ARGS);
      // IDEMPOTENCY_CONFLICT is transient (a concurrent request with the
      // same key is in flight) — exit as NETWORK_ERROR so an orchestrator
      // sees it as a "retry shortly" signal rather than a permanent
      // failure. The proxy resolves the conflict within seconds.
      if (code === 'IDEMPOTENCY_CONFLICT') process.exit(ExitCode.NETWORK_ERROR);
      process.exit(ExitCode.AGENT_FAILED);
    }
  }

  // Handle multiple environments
  if (session.pendingOrgs && !session.credentials) {
    if (mode === 'ci') {
      // CI mode: auto-select first environment with an API key
      for (const org of session.pendingOrgs) {
        for (const project of org.projects) {
          const env = (project.environments ?? [])
            .filter((e) => e.app?.apiKey)
            .sort((a, b) => a.rank - b.rank)[0];
          if (env) {
            await resolveEnvironmentSelection(session, {
              orgId: org.id,
              projectId: project.id,
              env: env.name,
            });
            getUI().log.info(
              `Resolved Amplitude API key non-interactively (CI mode): ${org.name} / ${project.name} / ${env.name}`,
            );
            break;
          }
        }
        if (session.credentials) break;
      }
      if (!session.credentials) {
        if (projectName) {
          // --project-name was provided but the create-project block was
          // skipped (e.g. missing idToken). Surface a clear error instead
          // of silently continuing without credentials.
          process.stderr.write(
            'Error: could not create project — authentication token is missing or expired. ' +
              `Run \`${CLI_INVOCATION} login\` and re-run.\n`,
          );
          process.exit(ExitCode.AUTH_REQUIRED);
        } else {
          process.stderr.write(
            'Error: no Amplitude projects with API keys available. ' +
              'Pass `--project-name "<name>"` to create one, or create one ' +
              'in the Amplitude UI and re-run.\n',
          );
          process.exit(ExitCode.INVALID_ARGS);
        }
      }
    } else if (agentUI) {
      // Agent mode short-circuit: if the orchestrator passed a scope
      // flag (`--app-id`, `--project-id`, etc.) that didn't match any
      // known environment, refuse to fall through to auto-select —
      // that would silently write to a different project than the
      // orchestrator asked for. Emit a structured rejection carrying
      // both the bad value AND the candidate list so the orchestrator
      // can re-prompt the human with one round-trip instead of doing
      // a fresh discovery cycle. Without this short-circuit,
      // `promptEnvironmentSelection` would emit `needs_input` and then
      // (with a non-interactive stdin) auto-select the first env in
      // `pendingOrgs` — exactly the data-integrity failure mode the
      // confirm-app gate elsewhere in this codebase exists to prevent.
      if (session.scopeFilterMismatch) {
        const mismatch = session.scopeFilterMismatch;
        const choices = session.pendingOrgs.flatMap((org) =>
          org.projects.flatMap((proj) =>
            (proj.environments ?? [])
              .filter((e) => e.app?.apiKey)
              .sort((a, b) => a.rank - b.rank)
              .map((e) => ({
                orgId: org.id,
                orgName: org.name,
                projectId: proj.id,
                projectName: proj.name,
                appId: e.app?.id ?? null,
                envName: e.name,
                // `rank` is part of the canonical `EnvSelectionChoice` —
                // include it so orchestrators that reuse their
                // env-selection widget against this auth_required envelope
                // (as the JSDoc on emitAuthRequired encourages) don't see
                // `undefined` when accessing `.rank`.
                rank: e.rank,
                label: `${org.name} / ${proj.name} / ${e.name}`,
              })),
          ),
        );
        const choicesField =
          mismatch.flag === '--project-id'
            ? 'projectId'
            : mismatch.flag === '--env'
            ? 'envName'
            : mismatch.flag === '--org'
            ? 'orgName'
            : 'appId';
        agentUI.emitAuthRequired({
          reason: 'env_selection_failed',
          instruction:
            `${mismatch.reason} Re-run ${CLI_INVOCATION} with ` +
            `${mismatch.flag} set to a value from data.choices[].${choicesField} ` +
            `(or another scope flag from data.choices[]).`,
          loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
          previousAttempt: mismatch,
          choices,
        });
        process.exit(ExitCode.AUTH_REQUIRED);
      }

      // Agent mode: emit a structured prompt event with the full
      // org/project/app/env hierarchy. The orchestrator can either
      // reply on stdin with { appId } or re-invoke with --app-id (globally
      // unique, identifies the env directly).
      //
      // If the orchestrator provides an unknown appId, promptEnvironmentSelection
      // THROWS rather than silently picking a random env — we route that to
      // env_selection_failed with the mismatch message in the instruction.
      let selection: Awaited<
        ReturnType<(typeof agentUI)['promptEnvironmentSelection']>
      >;
      try {
        selection = await agentUI.promptEnvironmentSelection(
          session.pendingOrgs,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        agentUI.emitAuthRequired({
          reason: 'env_selection_failed',
          instruction:
            `${detail} Re-run ${CLI_INVOCATION} with --app-id <id> set to ` +
            'a value from the choices array in the last prompt event.',
          loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
        });
        process.exit(ExitCode.AUTH_REQUIRED);
      }
      const resolved = await resolveEnvironmentSelection(session, selection);
      if (!resolved) {
        agentUI.emitAuthRequired({
          reason: 'env_selection_failed',
          instruction:
            'Could not resolve an Amplitude environment with an API key. ' +
            `Pass --app-id <id> when re-running ${CLI_INVOCATION}.`,
          loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
        });
        process.exit(ExitCode.AUTH_REQUIRED);
      }
    }
  }

  // If we still don't have credentials, auth is required. Distinguish
  // "you've never logged in" from "your stored login is broken" — both
  // conditions surface here, but only the first is solvable by a fresh
  // `wizard login`. If a stored token still exists at this point,
  // resolveCredentials decided not to use it (refresh failed, idToken
  // expired, fetchAmplitudeUser 401'd, etc.). Calling that
  // `no_stored_credentials` is wrong: orchestrators that key off the
  // reason will tell the user to run `wizard login` even though they
  // already have, and the underlying token issue won't be obvious.
  if (!session.credentials) {
    if (mode === 'agent' && agentUI) {
      const { getStoredToken } = await import('../utils/ampli-settings.js');
      const { resolveZone } = await import('../lib/zone-resolution.js');
      const { DEFAULT_AMPLITUDE_ZONE } = await import('../lib/constants.js');
      const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: true,
      });
      const stored = getStoredToken(undefined, zone);

      // Three-way reason classification, ordered most→least specific:
      //
      //   1. No stored token at all → user has never logged in.
      //      `no_stored_credentials` — orchestrators tell the user to run
      //      `wizard login`.
      //
      //   2. Stored token whose `expiresAt` is in the past → id_token
      //      legitimately expired. `token_expired` — same remediation
      //      (refresh via login), but the orchestrator now knows credentials
      //      *were* present and the failure is age-related, not setup-related.
      //
      //   3. Stored token whose `expiresAt` is still in the future → silent
      //      refresh failed for a non-token reason (network blip, server-
      //      side refresh_token revoke, transient 5xx, etc). `refresh_failed`
      //      — the user should retry rather than re-login. Telling them
      //      to run `wizard login` for a network blip is actively misleading.
      //
      // expiresAt is sourced from the id_token's `exp` claim post the
      // jwt-exp.ts cleanup, so this check accurately reflects id_token
      // freshness rather than whatever client-side stamp was guessed at
      // login time.
      let reason: 'no_stored_credentials' | 'token_expired' | 'refresh_failed';
      if (!stored) {
        reason = 'no_stored_credentials';
      } else {
        const expiresAtMs = new Date(stored.expiresAt).getTime();
        reason =
          Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
            ? 'refresh_failed'
            : 'token_expired';
      }

      const loginCommand = [...CLI_INVOCATION.split(' '), 'login'];
      const resumeCommand = [...CLI_INVOCATION.split(' '), '--agent'];
      const instruction =
        reason === 'no_stored_credentials'
          ? 'Not signed in to Amplitude. Ask the user to run ' +
            `\`${loginCommand.join(' ')}\` in a terminal to authenticate, ` +
            `then re-run \`${resumeCommand.join(' ')}\` to resume.`
          : reason === 'token_expired'
          ? 'Your stored Amplitude credentials have expired. Ask the user ' +
            `to run \`${loginCommand.join(' ')}\` to refresh, then re-run ` +
            `\`${resumeCommand.join(' ')}\` to resume.`
          : // refresh_failed
            'Stored Amplitude credentials are still within their TTL but ' +
            'the wizard could not contact the auth server (network issue, ' +
            'transient 5xx, or revoked refresh token). Retry the same ' +
            `command; if it persists, run \`${loginCommand.join(' ')}\` ` +
            'to refresh.';

      agentUI.emitAuthRequired({
        reason,
        instruction,
        loginCommand,
        resumeCommand,
      });
      process.exit(ExitCode.AUTH_REQUIRED);
    }
    // CI mode falls through — runWizard will handle missing credentials
  }

  // Log what was resolved so the caller can see it
  if (mode === 'agent' && session.credentials) {
    const parts = [
      session.selectedOrgName,
      session.selectedProjectName,
      session.selectedEnvName,
    ].filter(Boolean);
    if (parts.length > 0) {
      getUI().log.info(`Using: ${parts.join(' / ')}`);
    }
  }
};

/**
 * `@returns` false when create-account inputs cannot proceed (--agent mode:
 * emitted `signup_input_required`; tests mock `process.exit` — see caller).
 */
export function gateAgentSignupArguments(
  session: import('../lib/wizard-session').WizardSession,
  agentUI: AgentUI,
): boolean {
  if (!isCreateAccountOnboarding(session) || !session.agent) return true;

  type MissingFlag = {
    flag: string;
    description: string;
    url?: string;
  };
  const missing: MissingFlag[] = [];
  if (session.region == null) {
    missing.push({
      flag: '--region',
      description: 'Amplitude data center (us or eu)',
    });
  }
  if (!session.signupEmail) {
    missing.push({
      flag: '--email',
      description: 'Email address for the new Amplitude account',
    });
  }
  if (!session.signupFullName) {
    missing.push({
      flag: '--full-name',
      description: 'Full name on the Amplitude account',
    });
  }
  if (session.tosAccepted !== true) {
    missing.push({
      flag: '--accept-tos',
      description:
        'Agree to the Amplitude Terms of Service (' +
        TERMS_OF_SERVICE_URL +
        ')',
      url: TERMS_OF_SERVICE_URL,
    });
  }
  if (missing.length === 0) return true;

  const invocationParts = /\s/.test(CLI_INVOCATION)
    ? CLI_INVOCATION.split(' ')
    : [CLI_INVOCATION];

  agentUI.emitSignupInputsRequired({
    missing,
    resumeCommand: [
      ...invocationParts,
      '--auth-onboarding',
      'create-account',
      '--agent',
      '--install-dir',
      session.installDir,
    ],
  });
  process.exit(ExitCode.INPUT_REQUIRED);
  return false;
}

/**
 * CI signup with `--email`, `--full-name`, and `--region` requires `--accept-tos`.
 *
 * `@returns` false after invalid-args exit (caller must early-return — tests mock
 * `process.exit`).
 */
export function gateCiSignupAcceptToS(
  session: import('../lib/wizard-session').WizardSession,
): boolean {
  if (
    !session.ci ||
    !isCreateAccountOnboarding(session) ||
    !session.signupEmail ||
    !session.signupFullName ||
    session.region == null
  ) {
    return true;
  }
  if (session.tosAccepted !== true) {
    process.stderr.write(
      `${CLI_INVOCATION}: --auth-onboarding create-account in non-interactive mode requires agreeing ` +
        `to the Amplitude Terms of Service (${TERMS_OF_SERVICE_URL}). ` +
        `Pass --accept-tos alongside --region, --email, and --full-name.\n`,
    );
    process.exit(ExitCode.INVALID_ARGS);
    return false;
  }
  return true;
}

/**
 * When `resolveCredentials` returns `needs_user_choice` / `environment_selection`,
 * clear any leftover env / app / credentials pre-selection on the session so
 * `AuthScreen` renders the env picker unambiguously.
 *
 * **Why credentials are cleared too** (regression fix):
 *
 * `Auth.isComplete` in `src/ui/tui/flows.ts` advances past Auth when
 * `credentials != null` AND org/project are set — it does NOT gate on
 * `selectedEnvName` (intentional, so manual-API-key paths still pass through).
 * If a prior wizard run populated `session.credentials` from a stored API key
 * OR a checkpoint rehydration carried credentials forward, that flag stays
 * non-null even after the resolver returns `needs_user_choice` here. The flow
 * gate then evaluates true, the router advances past Auth to Setup, and the
 * env picker never renders — the user lands on Setup with no actionable UI
 * and the only signal of trouble is the `[bin] credential-resolution outcome:
 * needs_user_choice` line buried in the Logs tab.
 *
 * Clearing `credentials` forces `Auth.isComplete` back to false so the router
 * returns to `AuthScreen`, where the existing
 * `needsEnvPick = projectChosen && hasMultipleEnvs && !selectedEnv` logic
 * renders the picker.
 *
 * **Why `pendingEnvSelection` is also set** (race-condition fix):
 *
 * Clearing `credentials` alone wasn't enough. On a first-run rerun where the
 * stepper has already rendered frame 1 with `✓ Auth ─ ● Setup ←` (because the
 * session hydrated with non-null credentials + org + project), the router has
 * already advanced past Auth. The router walks forward only — null'ing
 * `credentials` mid-run does not rewind it. The user stays on Setup with no
 * env-picker surface. Setting `pendingEnvSelection = true` gates both
 * `Auth.isComplete` AND every post-Auth `show:` predicate, forcing the router
 * to collapse back to Auth. The flag is cleared by `AuthScreen` once the user
 * picks an env via `setCredentials` for the chosen environment.
 *
 * Only the `environment_selection` discriminant nulls credentials. Other
 * `needs_user_choice` `kind`s (if added later — see
 * `ResolveCredentialsResult` in `src/lib/credential-resolution.ts`) MUST opt
 * in explicitly, because they may have semantics where preserving credentials
 * is correct.
 *
 * Skipped in --agent / --ci mode (those modes emit structured rejections
 * elsewhere and don't render an interactive picker).
 *
 * Returns true when the deferral was applied (caller may want to log).
 */
export function applyEnvSelectionDeferral(
  session: import('../lib/wizard-session').WizardSession,
  resolution: import('../lib/credential-resolution').ResolveCredentialsResult,
): boolean {
  if (resolution.outcome !== 'needs_user_choice') return false;
  if (resolution.kind !== 'environment_selection') return false;
  if (session.ci || session.agent) return false;
  session.selectedEnvName = null;
  session.selectedAppId = null;
  // CRITICAL: rerun state (stored API key or checkpoint rehydration) can
  // leave `session.credentials` non-null even though the resolver just told
  // us it needs an env pick. With non-null credentials + a rerun org/project
  // still selected, `Auth.isComplete` (flows.ts) returns true and the router
  // advances to Setup with no env-picker surface.
  session.credentials = null;
  // CRITICAL part 2: even with credentials cleared, the router only walks
  // forward — it doesn't rewind on its own. If a prior frame already had
  // the router parked on Setup (because credentials/org/project were
  // populated when the stepper rendered), clearing credentials mid-run
  // doesn't pull the user back to Auth. `pendingEnvSelection` gates
  // Auth.isComplete AND every post-Auth `show:` predicate, so the router
  // collapses back to Auth on the next resolve.
  session.pendingEnvSelection = true;
  return true;
}

/**
 * Whether the TUI auth task should release its wait and proceed to OAuth.
 *
 * The auth task runs concurrently with the screens, so we need a single
 * predicate that holds it until the foreground flow is ready for auth:
 *   - Intro is dismissed  (so the logo / welcome stays visible)
 *   - Region is picked    (so the OAuth URL targets the right zone)
 *   - regionForced is off (so /region mid-session doesn't race the new pick)
 *   - On the create-account path, the signup ceremony has settled — either
 *     `signupAuth` is set (SigningUpScreen captured fresh tokens from the
 *     direct-signup endpoint), or `signupAbandoned` is true (server
 *     redirected / errored, OAuth fallback is the user's path forward).
 *     Without this gate, the auth task races SigningUpScreen and opens
 *     browser OAuth while the screen-driven POST is still in flight,
 *     producing two concurrent auth attempts and an unwinnable UX race.
 *
 * Pure function, exported for unit testing — the original inline closure
 * silently regressed when its individual conditions drifted and there was
 * no test asserting the combined contract.
 */
export function isAuthTaskGateReady(
  session: import('../lib/wizard-session').WizardSession,
): boolean {
  if (!session.introConcluded) return false;
  if (session.region === null) return false;
  if (session.regionForced) return false;
  if (isCreateAccountOnboarding(session)) {
    const ceremonySettled =
      session.signupAuth !== null || session.signupAbandoned;
    if (!ceremonySettled) return false;
  }
  return true;
}

/**
 * Run the direct-signup wrapper for agent / CI modes.
 *
 * No-op when account-creation provisioning inputs aren't all set. On null or
 * thrown errors, logs a human message that points at the mode's fallback
 * path (`fallbackLabel`) and returns — the caller's own auth path runs next.
 */
export const runDirectSignupIfRequested = async (
  session: import('../lib/wizard-session').WizardSession,
  fallbackLabel: string,
): Promise<void> => {
  if (!accountCreationProvisioningInputsReady(session)) {
    return;
  }
  const { performSignupOrAuth, trackSignupAttempt } = await import(
    '../utils/signup-or-auth.js'
  );
  const { LOCAL_DOC_URLS } = await import('../utils/direct-signup.js');
  const { tryResolveZone } = await import('../lib/zone-resolution.js');

  // Non-TUI modes have no RegionSelect screen to disambiguate — and the
  // backend does not route cross-region, so POSTing an EU-intending email
  // to the US provisioning endpoint would silently create the account in
  // the US data center. Require an explicit signal (--region flag, project
  // config, or stored user) before sending the signup request. Exit with
  // AUTH_REQUIRED so orchestrators see a structured failure rather than a
  // misrouted account.
  const zone = tryResolveZone(session);
  if (zone == null) {
    getUI().log.error(
      'Cannot determine data center region for account creation. Pass --region us or --region eu.',
    );
    process.exit(ExitCode.AUTH_REQUIRED);
  }
  let tokens: Awaited<ReturnType<typeof performSignupOrAuth>>;
  try {
    // Non-TUI callers send `kind: 'with_required_fields'` with the user data
    // already collected upstream (--email + --full-name + --accept-tos
    // gated by `accountCreationProvisioningInputsReady`). They never
    // traverse the `needs_information` round-trip because they have no
    // in-band collection screens — sending `kind: 'email_only'` would
    // mean the BE returns needs_information and the helper routes to
    // the OAuth fallback, breaking one-shot signup. Build the
    // follow-up shape with local URL constants since no parser-probe
    // has run to populate session.legalDocumentBundle.
    //
    // Intentional asymmetry vs `SigningUpScreen` (which switches over
    // `RequiredKey` exhaustively): the non-TUI path pre-commits to a
    // fixed body and never honors a per-key contract from the BE. If a
    // future `RequiredKey` is added (e.g. `phone_number`), CI / agent
    // runs without the matching flag get routed to OAuth fallback via
    // `needs_information` — observable, not silently broken. Adding a
    // new field here is a product decision (new `--<field>` flag + its
    // gate in `gateAgentSignupArguments` / `gateCiSignupAcceptToS`)
    // rather than a wire-contract correctness fix, so the compile-error
    // gate the screen has isn't reproduced here.
    //
    // No `signal` here: CI / agent / classic modes have no in-band
    // cancellation surface (no Esc handler, no unmount lifecycle), so
    // there is nothing to thread through. The TUI path passes a signal
    // from SigningUpScreen's useAsyncEffect; this entry point doesn't.
    tokens = await performSignupOrAuth({
      kind: 'with_required_fields',
      email: session.signupEmail,
      fullName: session.signupFullName,
      legalDocumentBundle: LOCAL_DOC_URLS,
      // Non-TUI path uses local URLs directly (no parser-probe ran to
      // populate session.legalDocumentSource). Telemetry tag on every
      // arm reads this directly from `input` rather than from session.
      legalDocumentSource: 'local',
      zone,
    });
  } catch (err) {
    trackSignupAttempt({
      status: 'wrapper_exception',
      zone,
      // Source matches the input the wrapper received: a
      // `'with_required_fields'` body built from LOCAL_DOC_URLS. If
      // `performSignupOrAuth` throws after its internal try/catch (e.g.
      // `replaceStoredUser` errors), this outer catch is the sole
      // telemetry emitter — tagging `'unused'` here would misattribute
      // the URL source in adoption dashboards.
      'legal document source': 'local',
    });
    getUI().log.warn(
      `Direct signup errored: ${
        err instanceof Error ? err.message : String(err)
      }. Continuing to ${fallbackLabel}.`,
    );
    return;
  }
  // Exhaustive switch — `default: assertNever` makes a future arm a
  // compile error so no new ceremony outcome silently routes to the
  // mode's fallback without explicit review.
  switch (tokens.kind) {
    case 'success':
      getUI().log.info('Direct signup succeeded; using newly created account.');
      session.signupMagicLinkUrl = tokens.dashboardUrl ?? null;
      return;
    case 'needs_information':
    case 'redirect':
    case 'error':
      // Wrapper already emitted the appropriate telemetry; non-TUI
      // modes have no in-band collection screens, so all three arms
      // route to the mode's existing fallback path.
      getUI().log.info(
        `Direct signup did not produce credentials (${tokens.kind}); continuing to ${fallbackLabel}.`,
      );
      return;
    default:
      assertNever(tokens);
  }
};

/**
 * Re-export shared UI bootstrap helpers so command modules don't need to
 * re-import them from disparate paths.
 */
export { getUI, setUI, LoggingUI, ExitCode, analytics };
