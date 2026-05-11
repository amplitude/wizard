import { describe, expect, it } from 'vitest';
import { computeIsSlashMode } from '../SlashCommandInput.js';
import { COMMANDS } from '../../console-commands.js';

const commands = COMMANDS.map((c) => ({ cmd: c.cmd, desc: c.desc }));

describe('computeIsSlashMode', () => {
  it('returns false for a file path like /lib/config.ts', () => {
    expect(computeIsSlashMode('/lib/config.ts', commands)).toBe(false);
  });

  it('returns false for a slash-prefixed path in a sentence', () => {
    expect(computeIsSlashMode('/lib/config.ts is broken', commands)).toBe(
      false,
    );
  });

  it('returns true for an exact known command /region', () => {
    expect(computeIsSlashMode('/region', commands)).toBe(true);
  });

  it('returns true for bare / because it is a prefix of every command', () => {
    expect(computeIsSlashMode('/', commands)).toBe(true);
  });

  it('returns true for /r because it is a prefix of /region', () => {
    expect(computeIsSlashMode('/r', commands)).toBe(true);
  });

  it('returns false for plain text without a slash', () => {
    expect(computeIsSlashMode('hello world', commands)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(computeIsSlashMode('', commands)).toBe(false);
  });

  it('returns true for /region with trailing space + text (first word still matches)', () => {
    expect(computeIsSlashMode('/region eu', commands)).toBe(true);
  });

  it('returns false when commands list is empty', () => {
    expect(computeIsSlashMode('/region', [])).toBe(false);
    expect(computeIsSlashMode('/', [])).toBe(false);
  });
});
