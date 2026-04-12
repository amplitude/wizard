import { describe, expect, it } from 'vitest';
import { getWhoamiText, parseFeedbackSlashInput } from '../console-commands.js';

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
  const baseSession = {
    selectedOrgId: '123',
    selectedOrgName: 'Acme Corp',
    selectedWorkspaceName: 'Acme Workspace',
    selectedProjectName: 'My Project',
    region: 'us' as const,
  };

  it('returns expected parts with all fields populated', () => {
    const result = getWhoamiText(baseSession);
    expect(result).toContain('org:');
    expect(result).toContain('Acme Corp');
    expect(result).toContain('project: My Project');
    expect(result).toContain('region: us');
  });

  it('wraps org name in OSC 8 hyperlink when orgId and region are set', () => {
    const result = getWhoamiText(baseSession);
    const expectedUrl = 'https://app.amplitude.com/analytics/org/123';
    expect(result).toContain(
      `\u001B]8;;${expectedUrl}\u0007Acme Corp\u001B]8;;\u0007`,
    );
  });

  it('uses EU domain in org hyperlink when region is eu', () => {
    const result = getWhoamiText({ ...baseSession, region: 'eu' as const });
    const expectedUrl = 'https://app.eu.amplitude.com/analytics/org/123';
    expect(result).toContain(
      `\u001B]8;;${expectedUrl}\u0007Acme Corp\u001B]8;;\u0007`,
    );
  });

  it('shows plain org name without hyperlink when orgId is missing', () => {
    const result = getWhoamiText({ ...baseSession, selectedOrgId: null });
    expect(result).toContain('org: Acme Corp');
    expect(result).not.toContain('\u001B]8;;');
  });

  it('shows (none) for org without hyperlink when both orgId and orgName are missing', () => {
    const result = getWhoamiText({
      ...baseSession,
      selectedOrgId: null,
      selectedOrgName: null,
    });
    expect(result).toContain('org: (none)');
    expect(result).not.toContain('\u001B]8;;');
  });

  it('shows plain org name without hyperlink when region is missing', () => {
    const result = getWhoamiText({ ...baseSession, region: null });
    expect(result).toContain('org: Acme Corp');
    expect(result).not.toContain('\u001B]8;;');
  });

  it('includes email when opts.email is provided', () => {
    const result = getWhoamiText(baseSession, { email: 'user@example.com' });
    expect(result).toMatch(/^user: user@example\.com/);
  });

  it('omits user part when opts is undefined', () => {
    const result = getWhoamiText(baseSession);
    expect(result).not.toContain('user:');
  });

  it('omits user part when opts.email is undefined', () => {
    const result = getWhoamiText(baseSession, {});
    expect(result).not.toContain('user:');
  });

  it('falls back to workspaceName when projectName is null', () => {
    const result = getWhoamiText({ ...baseSession, selectedProjectName: null });
    expect(result).toContain('project: Acme Workspace');
  });

  it('shows (none) for project when both projectName and workspaceName are null', () => {
    const result = getWhoamiText({
      ...baseSession,
      selectedProjectName: null,
      selectedWorkspaceName: null,
    });
    expect(result).toContain('project: (none)');
  });

  it('shows (none) for all fields when session is empty', () => {
    const result = getWhoamiText({
      selectedOrgId: null,
      selectedOrgName: null,
      selectedWorkspaceName: null,
      selectedProjectName: null,
      region: null,
    });
    expect(result).toBe('org: (none)  project: (none)  region: (none)');
  });
});
