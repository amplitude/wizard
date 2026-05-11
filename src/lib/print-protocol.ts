/**
 * `--print-protocol` — machine-readable protocol manifest.
 *
 * Audit #5 (protocol completeness) found that `AGENT_EVENT_WIRE_VERSION`
 * had zero non-test consumers outside its own declaration: the only way
 * for an orchestrator (Claude Code, Cursor, Codex, custom CI agent) to
 * learn the wizard's wire-protocol version was to spawn `--agent`, parse
 * one NDJSON line, and read the `v` field from the envelope.
 *
 * That handshake is fragile in two ways:
 *
 *   1. Spawning the wizard has real cost — observability bootstrap,
 *      Sentry init, OAuth token refresh attempts — just to learn a
 *      version number is a lot of side effects for a probe.
 *   2. The wizard might fail at startup (missing config, broken
 *      OAuth tokens, network issues) BEFORE emitting any NDJSON.
 *      Orchestrators would then be unable to learn the protocol version
 *      from a binary that's perfectly capable of telling them about
 *      itself.
 *
 * `--print-protocol` is the missing out-of-band probe. The flag is
 * intercepted in `bin.ts` BEFORE any side effects (no observability,
 * no Sentry, no analytics, no auth, no shell-rc cleanup). The wizard
 * prints a single JSON object to stdout and exits 0.
 *
 * The same payload doubles as the single machine-readable spec
 * orchestrators can probe to learn the wizard's capabilities. Fields:
 *
 *   - `protocolVersion`         — envelope-level wire-format version
 *                                 (mirrors `AGENT_EVENT_WIRE_VERSION`).
 *                                 Bumped only on breaking changes to the
 *                                 top-level envelope shape (`v`, `type`,
 *                                 `data`, etc).
 *   - `wizardProtocolVersion`   — coarser "wizard protocol" version that
 *                                 covers the broader handshake (CLI
 *                                 flags, exit-code semantics, NDJSON
 *                                 framing). Currently `2`. When PR B8
 *                                 lands `WIZARD_PROTOCOL_VERSION` this
 *                                 module will import it directly.
 *   - `eventDataVersions`       — full registry of per-event `data_version`
 *                                 values. Mirrors `EVENT_DATA_VERSIONS`.
 *   - `supportedEvents`         — sorted list of every event discriminator
 *                                 the wizard knows how to emit. Derived
 *                                 from the registry above.
 *   - `exitCodes`               — full `ExitCode` enum, so orchestrators
 *                                 can branch on numeric exit codes
 *                                 without re-deriving the name → number
 *                                 mapping.
 *   - `cliVersion`              — semver string from `package.json`.
 *
 * Stability contract:
 *   - Removing or renaming a key bumps `protocolVersion`.
 *   - Adding a new optional key is non-breaking.
 *   - The value-shape of `eventDataVersions` may grow keys freely;
 *     consumers should treat unknown keys as "data_version 1 implied".
 */
import { AGENT_EVENT_WIRE_VERSION, EVENT_DATA_VERSIONS } from './agent-events';
import { ExitCode } from './exit-codes';
import { WIZARD_VERSION } from '../commands/context';

/**
 * Coarse-grained "wizard protocol" version. Currently hard-coded to `2`
 * — when PR B8/#724 lands `WIZARD_PROTOCOL_VERSION` as an exported
 * constant somewhere, swap this fallback for a direct import. The
 * fallback keeps `--print-protocol` shippable on its own without a
 * cross-PR dependency.
 */
const WIZARD_PROTOCOL_VERSION_FALLBACK = 2;

export interface ProtocolManifest {
  protocolVersion: number;
  wizardProtocolVersion: number;
  cliVersion: string;
  eventDataVersions: Record<string, number>;
  supportedEvents: readonly string[];
  exitCodes: Record<string, number>;
}

/**
 * Build the protocol manifest payload. Pure function — no side effects,
 * no environment reads beyond the constants imported at module scope.
 * Exported for direct unit testing without spawning the CLI.
 */
export function buildProtocolManifest(): ProtocolManifest {
  // EVENT_DATA_VERSIONS is `as const` — clone into a plain Record so the
  // JSON output is a stable POJO that orchestrators can iterate over with
  // `Object.keys()` / `Object.entries()` without TS-narrowed surprises.
  const eventDataVersions: Record<string, number> = {};
  for (const [event, version] of Object.entries(EVENT_DATA_VERSIONS)) {
    eventDataVersions[event] = version;
  }

  const supportedEvents = Object.keys(EVENT_DATA_VERSIONS).sort();

  // ExitCode is `as const` — same treatment. The numeric values are
  // the public contract; the string keys are convenience names.
  const exitCodes: Record<string, number> = {};
  for (const [name, code] of Object.entries(ExitCode)) {
    exitCodes[name] = code;
  }

  return {
    protocolVersion: AGENT_EVENT_WIRE_VERSION,
    wizardProtocolVersion: WIZARD_PROTOCOL_VERSION_FALLBACK,
    cliVersion: WIZARD_VERSION,
    eventDataVersions,
    supportedEvents,
    exitCodes,
  };
}

/**
 * Print the protocol manifest to stdout (pretty-printed, trailing
 * newline) and exit with code 0. Called from `bin.ts` BEFORE any other
 * side effects — observability, Sentry, analytics, OAuth refresh, etc.
 * — so even a wizard that would otherwise fail at startup can still
 * report its protocol.
 *
 * Uses `process.stdout.write` rather than `console.log` so the output
 * is a single, byte-exact JSON object (no formatter quirks) followed by
 * exactly one '\n' — friendly for `jq`, `python -m json.tool`, and
 * orchestrators that read until EOF.
 */
export function printProtocolAndExit(): never {
  const manifest = buildProtocolManifest();
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
  process.exit(0);
}
