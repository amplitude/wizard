/**
 * AuthScreen — region-aware `credentials.host` regression tests.
 *
 * Production bug: when the user's zone is EU, the cached-API-key and
 * manual-entry paths used to hardcode `DEFAULT_HOST_URL`
 * (https://api2.amplitude.com — US). That pinned `credentials.host` to
 * the US ingestion endpoint, which `console-query.ts` /
 * `agent-runner.ts` then turn into the LLM gateway URL — silently
 * routing EU traffic through the US gateway.
 *
 * Both paths must consult `getHostFromRegion(resolveZone(...))`. The
 * environment-picker (auto-pick) path and the backend-fetch path already
 * did this correctly; these two siblings were the missing fixes.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { AuthScreen } from '../AuthScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { getHostFromRegion } from '../../../../utils/urls.js';

// Mock api-key-store so the cached-key path is deterministic — we want
// to test what host the AuthScreen *writes*, not how it reads disk.
vi.mock('../../../../utils/api-key-store.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../utils/api-key-store.js')
  >('../../../../utils/api-key-store.js');
  return {
    ...actual,
    readApiKeyWithSource: vi.fn(),
    persistApiKey: vi.fn(),
  };
});

// Pull mocked references in for setup.
import {
  readApiKeyWithSource,
  persistApiKey,
} from '../../../../utils/api-key-store.js';

const mockedReadApiKey = vi.mocked(readApiKeyWithSource);
const mockedPersistApiKey = vi.mocked(persistApiKey);

const flushAsync = async () => {
  // Two macrotasks: one for the dynamic-import microtask, one for the
  // subsequent state commit. ink-testing-library's render returns
  // synchronously; the async useEffect chain needs an explicit yield.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe('AuthScreen — region-aware credentials.host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPersistApiKey.mockReturnValue('cache');
  });

  it('cached-key path sets credentials.host to the EU ingestion endpoint when region=eu', async () => {
    mockedReadApiKey.mockReturnValue({ key: 'eu-cached-key', source: 'cache' });

    // Single-project / no-env shape so the auto-resolve effect runs.
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'eu',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme EU',
          projects: [{ id: 'proj-1', name: 'EU Production', environments: [] }],
        },
      ],
      selectedOrgId: 'org-1',
      selectedProjectId: 'proj-1',
    });

    render(<AuthScreen store={store} />);
    await flushAsync();

    const creds = store.session.credentials;
    expect(creds).not.toBeNull();
    expect(creds?.host).toBe(getHostFromRegion('eu'));
    // Sanity: the EU host is NOT the US default — guards against a future
    // refactor that accidentally swaps both branches back to US.
    expect(creds?.host).not.toBe(getHostFromRegion('us'));
  });

  it('cached-key path still uses the US host when region=us (regression guard)', async () => {
    mockedReadApiKey.mockReturnValue({ key: 'us-cached-key', source: 'cache' });

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme US',
          projects: [{ id: 'proj-1', name: 'US Production', environments: [] }],
        },
      ],
      selectedOrgId: 'org-1',
      selectedProjectId: 'proj-1',
    });

    render(<AuthScreen store={store} />);
    await flushAsync();

    expect(store.session.credentials?.host).toBe(getHostFromRegion('us'));
  });

  it('manual-entry path sets credentials.host to the EU ingestion endpoint when region=eu', async () => {
    // Manual entry runs through `handleApiKeySubmit` which is triggered
    // by Ink's TextInput. Driving the TextInput via stdin in
    // ink-testing-library requires the parent screen's render cycle to
    // settle between keystrokes (each character is a separate stdin
    // chunk). We type then `\r` to submit.
    mockedReadApiKey.mockReturnValue(null);

    // Render with a fully-resolved org/project but an env that has no
    // API key — that's the only shape that surfaces the Step-5 manual
    // input. Without it, the useEffect would either find a cached key
    // (path 1) or call the backend (path 3).
    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'eu',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme EU',
          projects: [
            {
              id: 'proj-1',
              name: 'EU Production',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: '42', apiKey: null },
                },
              ],
            },
          ],
        },
      ],
      selectedOrgId: 'org-1',
      selectedProjectId: 'proj-1',
    });

    const { stdin, rerender } = render(<AuthScreen store={store} />);
    await flushAsync();

    // Type the API key one character at a time so the TextInput's
    // controlled state has a tick to commit between writes. Then a
    // separate flush before '\r' so the last char doesn't get coalesced
    // into the submit chunk and dropped. Final '\r' triggers
    // onSubmit → handleApiKeySubmit.
    for (const ch of 'manual-eu-key') {
      stdin.write(ch);
      await flushAsync();
    }
    await flushAsync();
    stdin.write('\r');
    await flushAsync();
    rerender(<AuthScreen store={store} />);
    await flushAsync();

    const creds = store.session.credentials;
    expect(creds).not.toBeNull();
    // Allow the assertion to be tolerant if the last char was eaten by
    // stdin chunking — what matters for this regression is the HOST.
    expect(creds?.projectApiKey?.startsWith('manual-eu-ke')).toBe(true);
    expect(creds?.host).toBe(getHostFromRegion('eu'));
    expect(creds?.host).not.toBe(getHostFromRegion('us'));
  });

  it('manual-entry path still uses the US host when region=us (regression guard)', async () => {
    mockedReadApiKey.mockReturnValue(null);

    const store = makeStoreForSnapshot({
      introConcluded: true,
      region: 'us',
      pendingOrgs: [
        {
          id: 'org-1',
          name: 'Acme US',
          projects: [
            {
              id: 'proj-1',
              name: 'US Production',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: '42', apiKey: null },
                },
              ],
            },
          ],
        },
      ],
      selectedOrgId: 'org-1',
      selectedProjectId: 'proj-1',
    });

    const { stdin, rerender } = render(<AuthScreen store={store} />);
    await flushAsync();

    for (const ch of 'manual-us-key') {
      stdin.write(ch);
      await flushAsync();
    }
    await flushAsync();
    stdin.write('\r');
    await flushAsync();
    rerender(<AuthScreen store={store} />);
    await flushAsync();

    const creds = store.session.credentials;
    expect(creds?.projectApiKey?.startsWith('manual-us-ke')).toBe(true);
    expect(creds?.host).toBe(getHostFromRegion('us'));
  });
});
