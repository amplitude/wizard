/**
 * Bet 5 Slice 3 — teammate-invite URL builder.
 */

import { describe, it, expect } from 'vitest';
import { OUTBOUND_URLS } from '../constants';

describe('OUTBOUND_URLS.teammateInvite', () => {
  it('builds a share link for a US dashboard URL', () => {
    const url = OUTBOUND_URLS.teammateInvite(
      'us',
      'https://app.amplitude.com/42/dashboard/abc123',
    );
    expect(url).toBe(
      'https://app.amplitude.com/dashboard/abc123/share?source=wizard-teammate-invite',
    );
  });

  it('builds a share link against the EU overview host for EU zones', () => {
    const url = OUTBOUND_URLS.teammateInvite(
      'eu',
      'https://app.eu.amplitude.com/42/dashboard/abc123',
    );
    expect(url).toBe(
      'https://eu.amplitude.com/dashboard/abc123/share?source=wizard-teammate-invite',
    );
  });

  it('returns null when the dashboard id cannot be parsed', () => {
    expect(
      OUTBOUND_URLS.teammateInvite('us', 'https://example.com/'),
    ).toBeNull();
    expect(OUTBOUND_URLS.teammateInvite('us', '')).toBeNull();
  });

  it('strips trailing query params from the dashboard id', () => {
    const url = OUTBOUND_URLS.teammateInvite(
      'us',
      'https://app.amplitude.com/42/dashboard/abc123?ref=foo',
    );
    expect(url).toBe(
      'https://app.amplitude.com/dashboard/abc123/share?source=wizard-teammate-invite',
    );
  });

  it('always tags the source query param', () => {
    const url = OUTBOUND_URLS.teammateInvite(
      'us',
      'https://app.amplitude.com/42/dashboard/abc123',
    );
    expect(url).toContain('source=wizard-teammate-invite');
  });
});
