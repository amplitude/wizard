import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildProtocolManifest, printProtocolAndExit } from '../print-protocol';
import { AGENT_EVENT_WIRE_VERSION, EVENT_DATA_VERSIONS } from '../agent-events';
import { ExitCode } from '../exit-codes';

describe('buildProtocolManifest', () => {
  const manifest = buildProtocolManifest();

  it('reports the envelope wire-protocol version as a number', () => {
    expect(typeof manifest.protocolVersion).toBe('number');
    expect(manifest.protocolVersion).toBe(AGENT_EVENT_WIRE_VERSION);
  });

  it('reports a numeric coarse-grained wizardProtocolVersion', () => {
    expect(typeof manifest.wizardProtocolVersion).toBe('number');
    // Currently fallback = 2 until PR B8/#724 exports WIZARD_PROTOCOL_VERSION.
    expect(manifest.wizardProtocolVersion).toBeGreaterThanOrEqual(1);
  });

  it('exposes the full event-data-version registry', () => {
    // Spec contract: the manifest must list >= 10 events. Today the
    // registry has ~30; this is a floor, not a ceiling.
    expect(
      Object.keys(manifest.eventDataVersions).length,
    ).toBeGreaterThanOrEqual(10);
    // Every value must be a number — orchestrators branch on integers.
    for (const v of Object.values(manifest.eventDataVersions)) {
      expect(typeof v).toBe('number');
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
    }
    // Mirror of `EVENT_DATA_VERSIONS` — no synthetic keys.
    expect(Object.keys(manifest.eventDataVersions).sort()).toEqual(
      Object.keys(EVENT_DATA_VERSIONS).sort(),
    );
  });

  it('returns supportedEvents as a sorted array', () => {
    expect(Array.isArray(manifest.supportedEvents)).toBe(true);
    const sorted = [...manifest.supportedEvents].sort();
    expect(manifest.supportedEvents).toEqual(sorted);
    // Must contain at least the same key count as the registry.
    expect(manifest.supportedEvents.length).toBe(
      Object.keys(EVENT_DATA_VERSIONS).length,
    );
  });

  it('exposes ExitCode names → numeric codes', () => {
    expect(manifest.exitCodes.SUCCESS).toBe(0);
    expect(manifest.exitCodes.SUCCESS).toBe(ExitCode.SUCCESS);
    // Mirror of the enum — every name from the source must appear.
    for (const [name, code] of Object.entries(ExitCode)) {
      expect(manifest.exitCodes[name]).toBe(code);
    }
  });

  it('reports a non-empty cliVersion string', () => {
    expect(typeof manifest.cliVersion).toBe('string');
    expect(manifest.cliVersion.length).toBeGreaterThan(0);
  });

  it('produces a JSON-serializable payload', () => {
    // Stability contract: the manifest is shipped as JSON over stdout,
    // so it must round-trip without losing or aliasing fields.
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(roundTripped).toEqual(manifest);
  });

  it('is pure — repeated calls return structurally equal manifests', () => {
    const a = buildProtocolManifest();
    const b = buildProtocolManifest();
    expect(a).toEqual(b);
  });
});

describe('printProtocolAndExit', () => {
  const stdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
    code?: number,
  ) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);

  afterEach(() => {
    stdoutWrite.mockClear();
    exitSpy.mockClear();
  });

  it('writes a single JSON object + newline to stdout, then exits 0', () => {
    expect(() => printProtocolAndExit()).toThrowError('process.exit(0)');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const written = stdoutWrite.mock.calls[0]![0] as string;
    expect(written.endsWith('\n')).toBe(true);
    const payload = JSON.parse(written) as Record<string, unknown>;
    expect(payload.protocolVersion).toBe(AGENT_EVENT_WIRE_VERSION);
    expect(payload.exitCodes).toMatchObject({ SUCCESS: 0 });
    expect(typeof payload.cliVersion).toBe('string');
  });
});
