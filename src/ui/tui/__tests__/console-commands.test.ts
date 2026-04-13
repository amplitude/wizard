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
  it('shows login prompt when not authenticated and no org', () => {
    const result = getWhoamiText({
      selectedOrgName: null,
      selectedWorkspaceName: null,
      region: null,
      credentials: null,
    });
    expect(result).toBe('Not logged in. Run /login to authenticate.');
  });

  it('shows login prompt when credentials are undefined', () => {
    const result = getWhoamiText({
      selectedOrgName: null,
      selectedWorkspaceName: null,
      region: null,
      credentials: undefined as never,
    });
    expect(result).toBe('Not logged in. Run /login to authenticate.');
  });

  it('shows org/workspace/region when authenticated', () => {
    const result = getWhoamiText({
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: 'Production',
      region: 'us',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key',
        host: 'https://api.amplitude.com',
        projectId: 1,
      },
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).toContain('workspace: Production');
    expect(result).toContain('region: us');
  });

  it('shows (none) for missing org/workspace when partially authenticated', () => {
    const result = getWhoamiText({
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: null,
      region: 'eu',
      credentials: {
        accessToken: 'tok',
        projectApiKey: 'key',
        host: 'https://api.eu.amplitude.com',
        projectId: 0,
      },
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).toContain('workspace: (none)');
    expect(result).toContain('region: eu');
  });

  it('shows org info even without credentials if org name exists', () => {
    // Edge case: pre-populated from ampli.json but no active credentials
    const result = getWhoamiText({
      selectedOrgName: 'Acme Corp',
      selectedWorkspaceName: null,
      region: 'us',
      credentials: null,
    });
    expect(result).toContain('org: Acme Corp');
    expect(result).not.toContain('Not logged in');
  });
});
