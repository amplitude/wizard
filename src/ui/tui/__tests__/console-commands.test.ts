import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseFeedbackSlashInput,
  parseCreateProjectSlashInput,
  parseDiffSlashInput,
  getHelpText,
  getWhoamiText,
  getDiagnosticsLines,
  getDiagnosticsText,
  getVersionText,
  checkCommandBlockedByRun,
  isKnownCommand,
  COMMANDS,
} from '../console-commands.js';
import { AGENT_EVENT_WIRE_VERSION } from '../../../lib/agent-events.js';
import { WIZARD_VERSION } from '../../../lib/constants.js';
import { RunPhase } from '../../../lib/wizard-session.js';
import { CACHE_ROOT_OVERRIDE_ENV } from '../../../utils/storage-paths.js';

describe('parseCreateProjectSlashInput', () => {
  it('returns the trimmed name after /create-project', () => {
    expect(parseCreateProjectSlashInput('/create-project My Project')).toBe(
      'My Project',
    );
  });

  it('returns empty string when no name is given', () => {
    expect(parseCreateProjectSlashInput('/create-project')).toBe('');
    expect(parseCreateProjectSlashInput('/create-project   ')).toBe('');
  });

  it('is case-insensitive on the command prefix', () => {
    expect(parseCreateProjectSlashInput('/Create-Project Foo')).toBe('Foo');
  });

  it('returns undefined for other commands', () => {
    expect(parseCreateProjectSlashInput('/feedback hi')).toBeUndefined();
    expect(parseCreateProjectSlashInput('/help')).toBeUndefined();
  });
});

describe('parseFeedbackSlashInput', () => {
  it('returns the message after /feedback', () => {
    expect(parseFeedbackSlashInput('/feedback love this tool')).toBe(
      'love this tool',
    );
  });

  it('trims outer whitespace', () => {
    expect(parseFeedbackSlashInput('  /feedback  ok  ')).toBe('ok');
  });

  it('is case-insensitive on the command', () => {
    expect(parseFeedbackSlashInput('/FEEDBACK hi')).toBe('hi');
  });

  it('returns undefined when the message is missing', () => {
    expect(parseFeedbackSlashInput('/feedback')).toBeUndefined();
    expect(parseFeedbackSlashInput('/feedback ')).toBeUndefined();
  });

  it('returns undefined for other commands', () => {
    expect(parseFeedbackSlashInput('/help')).toBeUndefined();
  });
});

describe('getWhoamiText', () => {
  const base = {
    selectedOrgId: null as string | null,
    selectedOrgName: null as string | null,
    selectedProjectName: null as string | null,
    selectedEnvName: null as string | null,
    region: null as string | null,
    credentials: null as {
      accessToken: string;
      projectApiKey: string;
      host: string;
      appId: number;
    } | null,
    userEmail: null as string | null,
  };

  it('shows login prompt when not authenticated and no org', () => {
    const result = getWhoamiText({ ...base });
    expect(result).toBe('Not logged in. Run /login to authenticate.');
  });

  it('shows full context: email, org, project, env with ID, region, key', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Amplitude Website (Portfolio)',
      selectedProjectName: 'Amplitude',
      selectedEnvName: 'Production',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'abcd1234efgh5678',
        host: 'https://api.amplitude.com',
        appId: 187520,
      },
      userEmail: 'kelson.warner@amplitude.com',
    });
    expect(result).toContain('kelson.warner@amplitude.com');
    expect(result).toContain('org: Amplitude Website (Portfolio)');
    expect(result).toContain('project: Amplitude');
    expect(result).toContain('env: Production (187520)');
    expect(result).toContain('region: us');
    expect(result).toContain('key: abcd…5678');
    expect(result).not.toContain('workspace');
  });

  it('falls back to org ID when name is not resolved', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgId: '12345',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        appId: 99,
      },
    });
    expect(result).toContain('org: 12345');
    expect(result).toContain('env: 99');
  });

  it('shows env name without ID when appId is 0', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme',
      selectedEnvName: 'Staging',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        appId: 0,
      },
    });
    expect(result).toContain('env: Staging');
    expect(result).not.toContain('(0)');
  });

  it('shows org info with authenticating hint when no credentials yet', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      region: 'us',
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).toContain('(authenticating…)');
    expect(result).not.toContain('Not logged in');
  });

  it('shows email with authenticating hint during auth flow', () => {
    const result = getWhoamiText({
      ...base,
      userEmail: 'ada@example.com',
      region: 'us',
    });
    expect(result).toContain('ada@example.com');
    expect(result).toContain('(authenticating…)');
  });
});

describe('COMMANDS registry', () => {
  it('exposes /diagnostics so the help UI surfaces it', () => {
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/diagnostics');
  });

  it('exposes /help — CLAUDE.md documents it as canonical', () => {
    // Pre-fix the registry was missing `/help` even though the docs
    // listed it; users typed `/help` and got no completion match or
    // dispatch. The empty-result path is the worst kind of broken.
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/help');
    const help = COMMANDS.find((c) => c.cmd === '/help');
    expect(help?.requiresIdle).toBeFalsy();
  });

  it('exposes /version so users can pull versions from inside the TUI', () => {
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/version');
    // Informational, runs anytime — must not be blocked mid-run.
    const def = COMMANDS.find((c) => c.cmd === '/version');
    expect(def?.requiresIdle).toBeFalsy();
  });

  it('keeps /snake registered so the overlay is reachable from the slash bar', () => {
    // Snake is no longer in the RunScreen tab strip — it lives in the
    // overlay stack (Overlay.Snake). The /snake slash command is the
    // remaining entry point; if anyone drops it from the registry the
    // overlay becomes unreachable.
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/snake');
  });


  it('marks credential / region / org-mutating commands as requiresIdle', () => {
    // These commands swap the agent's auth, region, or project context
    // out from under it — they MUST be blocked while a run is active so
    // mid-flight Amplitude API / MCP calls don't silently target the
    // wrong project.
    const requiresIdle = COMMANDS.filter((c) => c.requiresIdle).map(
      (c) => c.cmd,
    );
    expect(requiresIdle).toEqual(
      expect.arrayContaining([
        '/region',
        '/login',
        '/logout',
        '/create-project',
      ]),
    );
  });

  it('leaves read-only / overlay commands available during a run', () => {
    // Surfacing /whoami, /mcp, /slack, /feedback, /debug, /diagnostics,
    // /version, /clear, /snake, /exit during a run is fine — they don't
    // mutate the session state the agent depends on.
    for (const cmd of [
      '/whoami',
      '/mcp',
      '/slack',
      '/feedback',
      '/debug',
      '/diagnostics',
      '/version',
      '/clear',
      '/snake',
      '/exit',
    ]) {
      const def = COMMANDS.find((c) => c.cmd === cmd);
      expect(def?.requiresIdle).toBeFalsy();
    }
  });
});

describe('checkCommandBlockedByRun', () => {
  it('returns null for any command outside Running', () => {
    for (const phase of [
      RunPhase.Idle,
      RunPhase.Completed,
      RunPhase.Error,
    ] as const) {
      expect(checkCommandBlockedByRun('/region', phase)).toBeNull();
      expect(checkCommandBlockedByRun('/login', phase)).toBeNull();
      expect(checkCommandBlockedByRun('/logout', phase)).toBeNull();
      expect(checkCommandBlockedByRun('/create-project', phase)).toBeNull();
    }
  });

  it('returns a tailored message during Running for each requiresIdle command', () => {
    expect(checkCommandBlockedByRun('/region', RunPhase.Running)).toContain(
      'Region change is paused',
    );
    expect(checkCommandBlockedByRun('/login', RunPhase.Running)).toContain(
      'Login is paused',
    );
    expect(checkCommandBlockedByRun('/logout', RunPhase.Running)).toContain(
      'Logout is paused',
    );
    expect(
      checkCommandBlockedByRun('/create-project', RunPhase.Running),
    ).toContain('Creating a new project is paused');
  });

  it('every blocked-command message tells the user how to unblock', () => {
    for (const cmd of ['/region', '/login', '/logout', '/create-project']) {
      const msg = checkCommandBlockedByRun(cmd, RunPhase.Running);
      expect(msg).not.toBeNull();
      expect(msg).toContain('Ctrl+C');
      expect(msg).toContain('try again');
    }
  });

  it('returns null for non-requiresIdle commands even during Running', () => {
    // /whoami, /mcp, /slack, /feedback, /clear, /debug, /diagnostics,
    // /version, /snake, /exit must remain dispatchable mid-run.
    for (const cmd of [
      '/whoami',
      '/mcp',
      '/slack',
      '/feedback',
      '/clear',
      '/debug',
      '/diagnostics',
      '/version',
      '/snake',
      '/exit',
    ]) {
      expect(checkCommandBlockedByRun(cmd, RunPhase.Running)).toBeNull();
    }
  });

  it('returns null for unknown commands so /typo falls through to the default error', () => {
    expect(
      checkCommandBlockedByRun('/not-a-real-command', RunPhase.Running),
    ).toBeNull();
  });
});

describe('isKnownCommand — ConsoleView handleSubmit routing', () => {
  it('returns true for an exact command match', () => {
    expect(isKnownCommand('/region')).toBe(true);
    expect(isKnownCommand('/logout')).toBe(true);
    expect(isKnownCommand('/clear')).toBe(true);
  });

  it('returns true when the command has trailing arguments', () => {
    expect(isKnownCommand('/feedback love this tool')).toBe(true);
    expect(isKnownCommand('/create-project My App')).toBe(true);
  });

  it('returns false for a slash-prefixed file path', () => {
    expect(isKnownCommand('/lib/config.ts')).toBe(false);
    expect(isKnownCommand('/lib/config.ts is broken')).toBe(false);
  });

  it('returns false for a prefix that does not exactly match any command', () => {
    expect(isKnownCommand('/r')).toBe(false);
    expect(isKnownCommand('/reg')).toBe(false);
  });

  it('returns false for plain text without a slash', () => {
    expect(isKnownCommand('hello world')).toBe(false);
    expect(isKnownCommand('what is the best framework?')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isKnownCommand('')).toBe(false);
  });

  it('returns false for bare /', () => {
    expect(isKnownCommand('/')).toBe(false);
  });
});

describe('getDiagnosticsText', () => {
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = '/tmp/wizard-diag-test';
  });

  afterEach(() => {
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  it('lists every storage path the user might need for a bug report', () => {
    const text = getDiagnosticsText('/Users/test/project-a');
    expect(text).toContain('log:');
    expect(text).toContain('log (json):');
    expect(text).toContain('benchmark:');
    expect(text).toContain('checkpoint:');
    expect(text).toContain('events:');
    expect(text).toContain('binding:');
    expect(text).toContain('Cache root:');
    expect(text).toContain('/tmp/wizard-diag-test');
  });

  it('uses per-project paths derived from installDir', () => {
    const a = getDiagnosticsText('/Users/test/project-a');
    const b = getDiagnosticsText('/Users/test/project-b');
    // Two different projects should have different log paths — that's the
    // whole point of the new layout (vs. the previous shared /tmp file).
    expect(a).not.toBe(b);
  });

  it('includes a tar command pointing at the run dir for support bundles', () => {
    const text = getDiagnosticsText('/p');
    expect(text).toContain('tar -czf wizard-logs.tar.gz');
  });
});

describe('parseDiffSlashInput', () => {
  it('returns an empty string when no path is given (summary mode)', () => {
    expect(parseDiffSlashInput('/diff')).toBe('');
    expect(parseDiffSlashInput('/diff   ')).toBe('');
  });

  it('returns the trimmed path argument', () => {
    expect(parseDiffSlashInput('/diff src/foo.ts')).toBe('src/foo.ts');
    expect(parseDiffSlashInput('  /diff   /abs/path.ts ')).toBe('/abs/path.ts');
  });

  it('is case-insensitive on the command prefix', () => {
    expect(parseDiffSlashInput('/DIFF a.ts')).toBe('a.ts');
  });

  it('returns undefined for other commands', () => {
    expect(parseDiffSlashInput('/feedback hi')).toBeUndefined();
    expect(parseDiffSlashInput('/help')).toBeUndefined();
  });
});

describe('/diff and /help command registration', () => {
  it('exposes /diff so the help UI surfaces it', () => {
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/diff');
  });

  it('exposes /help so the help UI surfaces it', () => {
    const cmds = COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/help');
  });

  it('/diff is a read-only command — must not be marked requiresIdle', () => {
    const def = COMMANDS.find((c) => c.cmd === '/diff');
    expect(def?.requiresIdle).toBeFalsy();
  });

  it('/help is a read-only command — must not be marked requiresIdle', () => {
    const def = COMMANDS.find((c) => c.cmd === '/help');
    expect(def?.requiresIdle).toBeFalsy();
  });

  it('isKnownCommand recognizes /diff with and without a path', () => {
    expect(isKnownCommand('/diff')).toBe(true);
    expect(isKnownCommand('/diff src/foo.ts')).toBe(true);
  });

  it('isKnownCommand recognizes /help', () => {
    expect(isKnownCommand('/help')).toBe(true);
  });
});

describe('getHelpText', () => {
  it('lists every registered slash command in the catalogue', () => {
    const text = getHelpText();
    for (const c of COMMANDS) {
      expect(text).toContain(c.cmd);
      expect(text).toContain(c.desc);
    }
  });

  it('starts with a clear header', () => {
    const text = getHelpText();
    expect(text).toMatch(/^Available slash commands:/);
  });
});

describe('getDiagnosticsLines', () => {
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = '/tmp/wizard-diag-lines-test';
  });

  afterEach(() => {
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  it('returns an array so each storage path renders on its own row', () => {
    // Regression: /diagnostics used to pack every path into a single feedback
    // string and the overflow-hidden Text element hard-truncated it to
    // "/Users/…" — the user could not copy the log file path.
    const lines = getDiagnosticsLines('/Users/test/project-a');
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
  });

  it('exposes every labelled path (log, checkpoint, events, binding, etc.) as its own line', () => {
    const lines = getDiagnosticsLines('/Users/test/project-a');
    const findLine = (label: string) => lines.find((l) => l.includes(label));
    expect(findLine('log:')).toBeDefined();
    expect(findLine('log (json):')).toBeDefined();
    expect(findLine('checkpoint:')).toBeDefined();
    expect(findLine('events:')).toBeDefined();
    expect(findLine('binding:')).toBeDefined();
    expect(findLine('Cache root:')).toBeDefined();
  });

  it('keeps each path fully expanded (no truncation, no /Users/… ellipsis)', () => {
    const lines = getDiagnosticsLines('/Users/test/project-a');
    for (const line of lines) {
      // No line should be the literal truncated form the bug reproduces.
      expect(line).not.toMatch(/\/Users\/…/);
      // Any line that mentions /Users must include a full absolute path.
      if (line.includes('/Users')) {
        expect(line).toMatch(/\/Users\/[\w.-]+/);
      }
    }
  });
});

describe('getVersionText', () => {
  it('renders wizard, protocol, Node, and platform on three lines', () => {
    const text = getVersionText({
      nodeVersion: 'v20.11.0',
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(text).toBe(
      [
        `Amplitude Wizard v${WIZARD_VERSION}`,
        `Agent-mode protocol: v${AGENT_EVENT_WIRE_VERSION}`,
        'Node: v20.11.0 (darwin arm64)',
      ].join('\n'),
    );
  });

  it('reflects the live wizard version from constants', () => {
    // If someone bumps WIZARD_VERSION without thinking, the user-facing
    // header still shows the new value — this pin catches "version" being
    // accidentally hardcoded to a stale string.
    const text = getVersionText({
      nodeVersion: 'v20.0.0',
      platform: 'linux',
      arch: 'x64',
    });
    expect(text).toContain(`Amplitude Wizard v${WIZARD_VERSION}`);
  });

  it('uses the agent-mode wire version (not a hardcoded literal)', () => {
    // The protocol line MUST track AGENT_EVENT_WIRE_VERSION so when the
    // wire format bumps, /version follows automatically.
    const text = getVersionText({
      nodeVersion: 'v20.0.0',
      platform: 'linux',
      arch: 'x64',
    });
    expect(text).toContain(`Agent-mode protocol: v${AGENT_EVENT_WIRE_VERSION}`);
  });

  it('falls back to live process.* values when no runtime is provided', () => {
    // No-arg call path used by ConsoleView — make sure it doesn't throw
    // and includes the real Node version string.
    const text = getVersionText();
    expect(text).toContain('Amplitude Wizard v');
    expect(text).toContain('Agent-mode protocol: v');
    expect(text).toContain(`Node: ${process.version}`);
    expect(text).toContain(process.platform);
    expect(text).toContain(process.arch);
  });
});
