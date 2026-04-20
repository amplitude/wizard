import { describe, expect, it } from 'vitest';
import {
  parseFeedbackSlashInput,
  parseCreateProjectSlashInput,
  getWhoamiText,
  renderHelpText,
  COMMANDS,
} from '../console-commands.js';

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
    selectedWorkspaceName: null as string | null,
    selectedProjectName: null as string | null,
    region: null as string | null,
    credentials: null as {
      accessToken: string;
      projectApiKey: string;
      host: string;
      projectId: number;
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
      selectedWorkspaceName: 'Amplitude',
      selectedProjectName: 'Production',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'abcd1234efgh5678',
        host: 'https://api.amplitude.com',
        projectId: 187520,
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
        projectId: 99,
      },
    });
    expect(result).toContain('org: 12345');
    expect(result).toContain('env: 99');
  });

  it('shows env name without ID when projectId is 0', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme',
      selectedProjectName: 'Staging',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        projectId: 0,
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

describe('renderHelpText', () => {
  it('includes every registered command', () => {
    const text = renderHelpText();
    for (const { cmd } of COMMANDS) {
      expect(text).toContain(cmd);
    }
  });

  it('starts with the header', () => {
    expect(renderHelpText()).toMatch(/^Available slash commands:/);
  });

  it('aligns descriptions by padding command column to the longest entry', () => {
    const text = renderHelpText();
    const longest = COMMANDS.reduce((n, c) => Math.max(n, c.cmd.length), 0);
    // Pick one command and confirm its description sits at a predictable offset.
    const region = COMMANDS.find((c) => c.cmd === '/region')!;
    const expectedLine = '  ' + region.cmd.padEnd(longest) + '  ' + region.desc;
    expect(text).toContain(expectedLine);
  });
});
