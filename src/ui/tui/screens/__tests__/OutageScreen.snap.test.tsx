/**
 * OutageScreen — overlay shown when status.amplitude.com reports a degraded
 * gateway. We snapshot the full layout (warning banner + status link +
 * confirmation prompt) plus the empty-state branch (no serviceStatus → null
 * render — no banner flashes when the overlay is pushed before fetch lands).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { OutageScreen } from '../OutageScreen.js';
import {
  makeStoreForSnapshot,
  renderSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('OutageScreen snapshots', () => {
  it('renders an empty frame when no serviceStatus is set yet', () => {
    // Defensive — the overlay can be pushed optimistically before the
    // status fetch resolves. Make sure it doesn't render a half-built
    // banner with "undefined" leakage.
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(<OutageScreen store={store} />, store);
    expect(frame.trim()).toBe('');
  });

  it('renders the degraded-services banner with description, link, and prompt', () => {
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description:
          'Elevated error rates affecting Anthropic API requests via gateway.',
        statusPageUrl: 'https://status.anthropic.com',
      },
    });
    const { frame } = renderSnapshot(<OutageScreen store={store} />, store);
    expect(frame).toMatchSnapshot();
  });

  it('renders the alternate-vendor outage with the right status URL', () => {
    // Same screen, different upstream — verifies the URL is data-driven, not
    // hard-coded to status.anthropic.com.
    const store = makeStoreForSnapshot({
      serviceStatus: {
        description: 'OAuth provider experiencing intermittent timeouts.',
        statusPageUrl: 'https://status.amplitude.com',
      },
    });
    const { frame } = renderSnapshot(<OutageScreen store={store} />, store);
    expect(frame).toContain('status.amplitude.com');
    expect(frame).not.toContain('status.anthropic.com');
  });
});
