import { describe, it, expect } from 'vitest';
import { getAgentManifest } from '../agent-manifest.js';
import {
  AGENT_EVENT_WIRE_VERSION,
  EVENT_DATA_VERSIONS,
  WIZARD_PROTOCOL_VERSION,
} from '../agent-events.js';
import { ExitCode, ExitCodeDescription } from '../exit-codes.js';

describe('getAgentManifest', () => {
  const manifest = getAgentManifest();

  it('declares a stable schema version', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.ndjsonSchemaVersion).toBe(1);
  });

  it('aliases ndjsonSchemaVersion to ndjsonProtocol.wireVersion (deprecated)', () => {
    // Single-source-of-truth invariant: the legacy `ndjsonSchemaVersion`
    // field is a deprecated alias that MUST equal the new
    // `ndjsonProtocol.wireVersion`. Both come from
    // `AGENT_EVENT_WIRE_VERSION` in `agent-events.ts`. Catches accidental
    // re-introduction of a hardcoded literal.
    expect(manifest.ndjsonSchemaVersion).toBe(
      manifest.ndjsonProtocol.wireVersion,
    );
    expect(manifest.ndjsonProtocol.wireVersion).toBe(AGENT_EVENT_WIRE_VERSION);
  });

  it('names the bin and has a description', () => {
    expect(manifest.bin).toBe('amplitude-wizard');
    expect(manifest.description).toMatch(/Amplitude/);
  });

  it('names the npm package', () => {
    expect(manifest.package).toBe('@amplitude/wizard');
  });

  it('lists invocations with npx first (the recommended form)', () => {
    expect(manifest.invocations.length).toBeGreaterThan(0);
    const first = manifest.invocations[0];
    expect(first.argv).toEqual(['npx', '@amplitude/wizard']);
    expect(first.requiresGlobalInstall).toBe(false);

    const direct = manifest.invocations.find((i) =>
      i.argv.includes('amplitude-wizard'),
    );
    expect(direct).toBeDefined();
    expect(direct?.requiresGlobalInstall).toBe(true);
  });

  it('lists the agent-relevant global flags', () => {
    const names = manifest.globalFlags.map((f) => f.name);
    expect(names).toContain('--agent');
    expect(names).toContain('--json');
    expect(names).toContain('--human');
    expect(names).toContain('--ci');
  });

  it('lists the capability-matrix flags (--yes, --auto-approve, --force)', () => {
    const names = manifest.globalFlags.map((f) => f.name);
    expect(names).toContain('--yes');
    expect(names).toContain('--auto-approve');
    expect(names).toContain('--force');
  });

  it('surfaces --app-id as the single scope selector for agents', () => {
    const names = manifest.globalFlags.map((f) => f.name);
    expect(names).toContain('--app-id');
    // Canonical term: `app` / `app_id` across both monorepos.
    // Legacy --project-id / --workspace-id are parseable aliases but NOT
    // advertised in the manifest, nor are --org / --env — agents should
    // select scope via --app-id alone.
    expect(names).not.toContain('--project-id');
    expect(names).not.toContain('--workspace-id');
    expect(names).not.toContain('--org');
    expect(names).not.toContain('--env');
  });

  it('documents the Amplitude data-model hierarchy', () => {
    // User-facing hierarchy: "project" replaces legacy "workspace" term to
    // match Amplitude's website. The backend still calls the project-level
    // container a "workspace" internally (GraphQL `workspaces` field).
    expect(manifest.concepts.hierarchy).toEqual([
      'org',
      'project',
      'app',
      'environment',
    ]);
  });

  it('glossary distinguishes Amplitude env from POSIX env var', () => {
    const envTerm = manifest.concepts.glossary.find(
      (g) => g.term === 'environment',
    );
    expect(envTerm).toBeDefined();
    expect(envTerm!.describe).toMatch(/NOT a POSIX env|Not a POSIX/i);
  });

  it('glossary distinguishes API key from access token', () => {
    const terms = manifest.concepts.glossary.map((g) => g.term);
    expect(terms).toContain('API key');
    expect(terms).toContain('access token');
  });

  it('documents AMPLITUDE_TOKEN as an env var', () => {
    const names = manifest.env.map((e) => e.name);
    expect(names).toContain('AMPLITUDE_TOKEN');
    expect(names).toContain('AMPLITUDE_WIZARD_TOKEN');
  });

  it('lists exit codes with SUCCESS=0 and AUTH_REQUIRED=3', () => {
    const codes = new Map(manifest.exitCodes.map((c) => [c.name, c.code]));
    expect(codes.get('SUCCESS')).toBe(0);
    expect(codes.get('AUTH_REQUIRED')).toBe(3);
    expect(codes.get('USER_CANCELLED')).toBe(130);
  });

  it('surfaces every ExitCode enum value (no drift between manifest and source)', () => {
    // Audit A4: the manifest's exitCodes block previously stopped at 10
    // and 130, while the runtime emitted 11 (PROJECT_NAME_TAKEN), 12
    // (INPUT_REQUIRED), 13 (WRITE_REFUSED), 14 (LOCK_HELD), and 20
    // (INTERNAL_ERROR). Generating from `ExitCode` enforces parity.
    const manifestNames = new Set(manifest.exitCodes.map((c) => c.name));
    for (const name of Object.keys(ExitCode)) {
      expect(
        manifestNames.has(name),
        `ExitCode.${name} should appear in manifest.exitCodes`,
      ).toBe(true);
    }
    // And the manifest must not invent codes not in the source.
    const enumNames = new Set(Object.keys(ExitCode));
    for (const entry of manifest.exitCodes) {
      expect(
        enumNames.has(entry.name),
        `manifest.exitCodes lists '${entry.name}' but it's not in ExitCode`,
      ).toBe(true);
    }
  });

  it('surfaces every ExitCode the audit listed as missing (B16 regression)', () => {
    // Audit A4 specifically called out these five codes as missing — pin
    // them by number so a future refactor that loses them fails loudly.
    const codes = new Map(manifest.exitCodes.map((c) => [c.code, c.name]));
    expect(codes.get(11)).toBe('PROJECT_NAME_TAKEN');
    expect(codes.get(12)).toBe('INPUT_REQUIRED');
    expect(codes.get(13)).toBe('WRITE_REFUSED');
    expect(codes.get(14)).toBe('LOCK_HELD');
    expect(codes.get(20)).toBe('INTERNAL_ERROR');
  });

  it('every exitCodes entry has a non-empty description from ExitCodeDescription', () => {
    for (const entry of manifest.exitCodes) {
      const expected = ExitCodeDescription[entry.name as keyof typeof ExitCode];
      expect(
        expected,
        `ExitCodeDescription missing entry for ${entry.name}`,
      ).toBeDefined();
      expect(entry.describe).toBe(expected);
      expect(entry.describe.length).toBeGreaterThan(0);
    }
  });

  it('exitCodes are sorted by numeric code (stable ordering for diffs)', () => {
    const codes = manifest.exitCodes.map((c) => c.code);
    const sorted = [...codes].sort((a, b) => a - b);
    expect(codes).toEqual(sorted);
  });

  it('documents AMPLITUDE_WIZARD_ALLOW_NESTED env var', () => {
    const names = manifest.env.map((e) => e.name);
    expect(names).toContain('AMPLITUDE_WIZARD_ALLOW_NESTED');
  });

  it('documents AMPLITUDE_WIZARD_MAX_TURNS env var', () => {
    const names = manifest.env.map((e) => e.name);
    expect(names).toContain('AMPLITUDE_WIZARD_MAX_TURNS');
  });

  it('includes the new agent-native commands', () => {
    const names = manifest.commands.map((c) => c.command);
    expect(names).toContain('detect');
    expect(names).toContain('status');
    expect(names).toContain('auth status');
    expect(names).toContain('auth token');
    expect(names).toContain('manifest');
    expect(names).toContain('mcp serve');
  });

  it('includes the plan / apply / verify subcommands', () => {
    const names = manifest.commands.map((c) => c.command);
    expect(names).toContain('plan');
    expect(names).toContain('apply');
    expect(names).toContain('verify');

    // `apply` must declare --plan-id so agents know how to feed in
    // the planId returned by `plan`.
    const apply = manifest.commands.find((c) => c.command === 'apply');
    const applyFlagNames = apply?.flags?.map((f) => f.name) ?? [];
    expect(applyFlagNames).toContain('--plan-id');
  });

  it('is JSON-serializable (contract: stdout-writable)', () => {
    expect(() => JSON.stringify(manifest)).not.toThrow();
    const roundtripped = JSON.parse(JSON.stringify(manifest));
    expect(roundtripped.bin).toBe('amplitude-wizard');
  });

  // ── ndjsonProtocol block (B16) ───────────────────────────────────
  //
  // Audit-wave consensus (A1, A2, A4): the manifest is the canonical
  // cold-discovery surface for parent agents, so it MUST carry the
  // protocol numbers + per-event registry — not just a hardcoded
  // `ndjsonSchemaVersion: 1` that drifted from runtime. All three
  // values are imported from `agent-events.ts` (single source of
  // truth, same constants `--print-protocol` advertises out-of-band).

  it('exposes ndjsonProtocol.wireVersion from AGENT_EVENT_WIRE_VERSION', () => {
    expect(manifest.ndjsonProtocol.wireVersion).toBe(AGENT_EVENT_WIRE_VERSION);
  });

  it('exposes ndjsonProtocol.protocolVersion from WIZARD_PROTOCOL_VERSION', () => {
    // No drift — the manifest's coarse protocol version MUST equal the
    // runtime constant `--print-protocol` returns, otherwise an
    // orchestrator that probes the manifest sees a different number
    // than the NDJSON stream advertises.
    expect(manifest.ndjsonProtocol.protocolVersion).toBe(
      WIZARD_PROTOCOL_VERSION,
    );
  });

  it('exposes ndjsonProtocol.eventDataVersions as a mirror of EVENT_DATA_VERSIONS', () => {
    // Every key in the registry MUST appear in the manifest, and
    // every value MUST equal the registered version. Catches a
    // re-declared-constant regression.
    const sourceKeys = Object.keys(EVENT_DATA_VERSIONS).sort();
    const manifestKeys = Object.keys(
      manifest.ndjsonProtocol.eventDataVersions,
    ).sort();
    expect(manifestKeys).toEqual(sourceKeys);
    for (const key of sourceKeys) {
      expect(manifest.ndjsonProtocol.eventDataVersions[key]).toBe(
        (EVENT_DATA_VERSIONS as Readonly<Record<string, number>>)[key],
      );
    }
  });

  it('ndjsonProtocol.eventDataVersions has at least 30 entries (size sanity guard)', () => {
    // Snapshot the registry size so an accidental removal (or a
    // misnamed key that breaks the alphabetical merge) shows up as a
    // count delta in the diff, even when individual key assertions
    // still pass. Floor, not ceiling — additions should bump this
    // number along with the registry.
    expect(
      Object.keys(manifest.ndjsonProtocol.eventDataVersions).length,
    ).toBeGreaterThanOrEqual(30);
  });

  it('signup_input_required is registered in eventDataVersions (B16 regression)', () => {
    // Audit A1 caught this discriminator missing from the registry —
    // the event shipped on the wire but had no `data_version` stamp
    // because `lookupDataVersion` had no entry to match. Pin it here
    // so a future re-introduction of the gap fails loudly.
    expect(
      manifest.ndjsonProtocol.eventDataVersions.signup_input_required,
    ).toBe(1);
  });
});
