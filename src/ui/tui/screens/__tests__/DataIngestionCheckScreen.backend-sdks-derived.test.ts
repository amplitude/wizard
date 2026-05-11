/**
 * Regression test for the BACKEND_SDK_INTEGRATIONS derivation.
 *
 * Before the migration this set was a hand-maintained literal in
 * DataIngestionCheckScreen.tsx, sitting adjacent to a registry-derived
 * sibling (BROWSER_FRAMEWORKS). Adding a new backend framework (Rails,
 * Spring, Phoenix, …) was a silent regression trap: the literal would
 * not pick it up and the catalog-fallback success signal would skip the
 * new framework's polling screen.
 *
 * Audit #3 fix: a `targetsBackend?: boolean` flag on
 * `FrameworkConfig.metadata`, with the set derived the same way
 * `BROWSER_FRAMEWORKS` is. This test exercises the derivation by
 * mocking `FRAMEWORK_REGISTRY` with a stubbed "new backend framework"
 * entry and re-importing the screen module — proving any future
 * framework that sets `targetsBackend: true` flows in automatically.
 *
 * The post-migration set equivalence (django/flask/fastapi/go/java/
 * javascriptNode/python) is still pinned by the `BACKEND_SDK_INTEGRATIONS
 * gating` describe block in DataIngestionCheckScreen.snap.test.tsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Integration } from '../../../../lib/constants.js';
import type { FrameworkConfig } from '../../../../lib/framework-config.js';

afterEach(() => {
  vi.doUnmock('../../../../lib/registry.js');
  vi.resetModules();
});

describe('BACKEND_SDK_INTEGRATIONS derivation', () => {
  it('picks up a new framework that sets metadata.targetsBackend automatically', async () => {
    // Stub registry: one fake backend framework + one fake non-backend.
    // We re-use an existing Integration value for each so we avoid having
    // to mint a new enum member just for this test.
    const stubBackend = {
      metadata: {
        name: 'Stub Backend',
        integration: Integration.django,
        targetsBackend: true,
        docsUrl: 'https://example.test/backend',
      },
    } as unknown as FrameworkConfig;
    const stubNonBackend = {
      metadata: {
        name: 'Stub Frontend',
        integration: Integration.nextjs,
        targetsBrowser: true,
        docsUrl: 'https://example.test/frontend',
      },
    } as unknown as FrameworkConfig;

    vi.doMock('../../../../lib/registry.js', () => ({
      FRAMEWORK_REGISTRY: {
        [Integration.django]: stubBackend,
        [Integration.nextjs]: stubNonBackend,
      },
    }));

    // Re-import the screen module so the derived constant is re-evaluated
    // against the mocked registry.
    const { BACKEND_SDK_INTEGRATIONS } = await import(
      '../DataIngestionCheckScreen.js'
    );

    expect(BACKEND_SDK_INTEGRATIONS.has(Integration.django)).toBe(true);
    expect(BACKEND_SDK_INTEGRATIONS.has(Integration.nextjs)).toBe(false);
    // Set is exactly the targetsBackend frameworks — no leakage from the
    // pre-migration hand-maintained literal.
    expect(BACKEND_SDK_INTEGRATIONS.size).toBe(1);
  });

  it('produces an empty set when no framework opts in', async () => {
    vi.doMock('../../../../lib/registry.js', () => ({
      FRAMEWORK_REGISTRY: {
        [Integration.nextjs]: {
          metadata: {
            name: 'Stub Frontend',
            integration: Integration.nextjs,
            targetsBrowser: true,
            docsUrl: 'https://example.test/frontend',
          },
        } as unknown as FrameworkConfig,
      },
    }));

    const { BACKEND_SDK_INTEGRATIONS } = await import(
      '../DataIngestionCheckScreen.js'
    );

    expect(BACKEND_SDK_INTEGRATIONS.size).toBe(0);
  });
});
