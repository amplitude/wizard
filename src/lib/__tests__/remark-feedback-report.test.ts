/**
 * Bet 2 Slice 7 — tests the pure reporter in scripts/cluster-remarks.ts.
 *
 * The fetch + cluster functions in the script are stubbed until credentials
 * land, so those paths are intentionally not tested yet. We cover the
 * rendering here so the scheduled workflow always produces well-formed
 * markdown once the clusters plug in.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../../scripts/cluster-remarks';

describe('remark-feedback report renderer', () => {
  it('renders an empty-clusters message when no remarks surface', () => {
    const md = renderMarkdown({
      periodStart: '2026-04-11',
      periodEnd: '2026-04-18',
      totalRemarks: 0,
      clusters: [],
    });
    expect(md).toContain('Wizard Remark Feedback');
    expect(md).toContain('2026-04-11 → 2026-04-18');
    expect(md).toContain('**0**');
    expect(md).toContain('_No prompt-weakness clusters surfaced this week');
  });

  it('renders cluster entries with quotes, frameworks, and a diff block', () => {
    const md = renderMarkdown({
      periodStart: '2026-04-11',
      periodEnd: '2026-04-18',
      totalRemarks: 12,
      clusters: [
        {
          theme: 'package-manager-detection-gaps',
          quotes: [
            'The agent guessed pnpm but the repo uses yarn',
            'detect_package_manager returned none despite package.json presence',
          ],
          frameworks: ['nextjs', 'react-router'],
          suggestedEdit:
            '- detect_package_manager is advisory\n+ detect_package_manager is authoritative; fail the step if it returns none',
        },
      ],
    });
    expect(md).toContain('### package-manager-detection-gaps');
    expect(md).toContain('**Frameworks:** nextjs, react-router');
    expect(md).toContain('> The agent guessed pnpm but the repo uses yarn');
    expect(md).toContain('```diff');
    expect(md).toContain('detect_package_manager is authoritative');
  });

  it('emits the em-dash placeholder when a cluster has no frameworks', () => {
    const md = renderMarkdown({
      periodStart: '2026-04-11',
      periodEnd: '2026-04-18',
      totalRemarks: 1,
      clusters: [
        {
          theme: 'generic-gap',
          quotes: ['q'],
          frameworks: [],
          suggestedEdit: '+ nothing',
        },
      ],
    });
    expect(md).toContain('**Frameworks:** —');
  });
});
