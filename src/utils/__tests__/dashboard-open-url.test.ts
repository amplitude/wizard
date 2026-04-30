import { describe, expect, it } from 'vitest';
import {
  SIGN_UP_SIGN_IN_REFRESH_FF,
  toWizardDashboardOpenUrl,
} from '../dashboard-open-url.js';

describe('toWizardDashboardOpenUrl', () => {
  it('wraps US app dashboard URLs with login + next + feature flag', () => {
    const canonical =
      'https://app.amplitude.com/analytics/peacock-954884/dashboard/q3bi86xc';
    const open = toWizardDashboardOpenUrl(canonical);
    const u = new URL(open);
    expect(u.pathname).toBe('/login');
    expect(u.searchParams.get('next')).toBe(
      '/analytics/peacock-954884/dashboard/q3bi86xc',
    );
    expect(u.searchParams.get(SIGN_UP_SIGN_IN_REFRESH_FF)).toBe('true');
  });

  it('preserves dashboard query strings in next', () => {
    const canonical = 'https://app.amplitude.com/analytics/o/dash?tab=insights';
    const open = toWizardDashboardOpenUrl(canonical);
    expect(new URL(open).searchParams.get('next')).toBe(
      '/analytics/o/dash?tab=insights',
    );
  });

  it('wraps EU app host the same way', () => {
    const canonical = 'https://app.eu.amplitude.com/analytics/x/dashboard/y';
    expect(toWizardDashboardOpenUrl(canonical)).toMatch(
      /^https:\/\/app\.eu\.amplitude\.com\/login\?/,
    );
  });

  it('passes through non-Amplitude-dashboard URLs unchanged', () => {
    expect(toWizardDashboardOpenUrl('https://example.com/dashboard/1')).toBe(
      'https://example.com/dashboard/1',
    );
  });

  it('trims surrounding whitespace before parsing', () => {
    const canonical = '  https://app.amplitude.com/analytics/d/a  ';
    expect(toWizardDashboardOpenUrl(canonical)).toContain(
      'next=%2Fanalytics%2Fd%2Fa',
    );
  });

  it('returns the trimmed string when the URL is invalid', () => {
    expect(toWizardDashboardOpenUrl('not a url')).toBe('not a url');
  });
});
