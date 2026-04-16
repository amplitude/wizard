import { describe, it, expect } from 'vitest';
import { getAgentManifest } from '../agent-manifest.js';

describe('getAgentManifest', () => {
  const manifest = getAgentManifest();

  it('declares a stable schema version', () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.ndjsonSchemaVersion).toBe(1);
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

  it('includes the new agent-native commands', () => {
    const names = manifest.commands.map((c) => c.command);
    expect(names).toContain('detect');
    expect(names).toContain('status');
    expect(names).toContain('auth status');
    expect(names).toContain('auth token');
    expect(names).toContain('manifest');
    expect(names).toContain('mcp serve');
  });

  it('is JSON-serializable (contract: stdout-writable)', () => {
    expect(() => JSON.stringify(manifest)).not.toThrow();
    const roundtripped = JSON.parse(JSON.stringify(manifest));
    expect(roundtripped.bin).toBe('amplitude-wizard');
  });
});
