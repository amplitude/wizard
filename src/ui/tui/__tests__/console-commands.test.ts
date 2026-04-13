import { describe, expect, it } from 'vitest';
import { parseFeedbackSlashInput, getWhoamiText } from '../console-commands.js';

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
    selectedWorkspaceId: null as string | null,
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

  it('shows login prompt when credentials are undefined', () => {
    const result = getWhoamiText({
      ...base,
      credentials: undefined as never,
    });
    expect(result).toBe('Not logged in. Run /login to authenticate.');
  });

  it('shows email + org/workspace/region/key when authenticated', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: 'Production',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'abcd1234efgh5678',
        host: 'https://api.amplitude.com',
        projectId: 1,
      },
      userEmail: 'ada@example.com',
    });
    expect(result).toContain('ada@example.com');
    expect(result).toContain('org: Acme Corp');
    expect(result).toContain('workspace: Production');
    expect(result).toContain('region: us');
    expect(result).toContain('key: abcd…5678');
  });

  it('shows org/workspace/region without email when email is null', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: 'Production',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        projectId: 1,
      },
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).not.toContain('ada');
  });

  it('falls back to org ID when name is not resolved', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgId: '12345',
      selectedWorkspaceId: 'ws-67890',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        projectId: 1,
      },
      userEmail: 'ada@example.com',
    });
    expect(result).toContain('org: 12345');
    expect(result).toContain('workspace: ws-67890');
  });

  it('shows project name when available', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: 'Production',
      selectedProjectName: 'My App',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.amplitude.com',
        projectId: 1,
      },
    });
    expect(result).toContain('project: My App');
  });

  it('shows (none) for missing org/workspace when partially authenticated', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      region: 'eu',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key12345',
        host: 'https://api.eu.amplitude.com',
        projectId: 0,
      },
      userEmail: 'ada@example.com',
    });
    expect(result).toContain('ada@example.com');
    expect(result).toContain('org: Acme Corp');
    expect(result).toContain('workspace: (none)');
    expect(result).toContain('region: eu');
  });

  it('shows org info even without credentials if org name exists', () => {
    const result = getWhoamiText({
      ...base,
      selectedOrgName: 'Acme Corp',
      region: 'us',
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).not.toContain('Not logged in');
  });
});
