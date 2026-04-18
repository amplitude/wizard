#!/usr/bin/env -S pnpm tsx
/**
 * Cluster `wizard cli: wizard remark` events from the last 7 days into
 * prompt-weakness themes and open a draft PR against src/lib/commandments.ts.
 *
 * Invoked weekly by .github/workflows/remark-feedback.yml. Designed to be
 * runnable locally for iteration: `pnpm tsx scripts/cluster-remarks.ts`.
 *
 * This is scaffolding. The Amplitude query + LLM clustering are stubbed
 * until the backing credentials + MCP integration are configured in CI —
 * see README_SETUP below for what needs to land.
 *
 * Output:
 *   - Writes `.github/remark-feedback-<YYYY-MM-DD>.md` summarizing the
 *     top 3 prompt weaknesses with quoted remarks + suggested commandment
 *     edits.
 *   - Exits 0 on success with the report path on stdout (one line).
 *   - Exits 2 if credentials are missing (expected until CI setup lands).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface RemarkEvent {
  /** ISO timestamp the event was captured. */
  capturedAt: string;
  /** Framework the user was integrating (from session property). */
  integration: string;
  /** Full remark text (capped at 4KB by agent-interface). */
  remark: string;
  /** Wizard CLI version. */
  wizardVersion: string;
}

export interface RemarkCluster {
  /** Short theme label, e.g. "package-manager-detection-gaps". */
  theme: string;
  /** Top 3 quoted remarks supporting the theme. */
  quotes: string[];
  /** Frameworks over-represented in the cluster. */
  frameworks: string[];
  /** Suggested commandment edit — human reviews before landing. */
  suggestedEdit: string;
}

export interface ReportPayload {
  periodStart: string;
  periodEnd: string;
  totalRemarks: number;
  clusters: RemarkCluster[];
}

// ─────────────────────────────────────────────────────────────
// Stubs — fill in when credentials + MCP access are configured
// ─────────────────────────────────────────────────────────────

/**
 * Query Amplitude for `wizard cli: wizard remark` events in the window.
 * Real impl should use the Amplitude MCP `get_events` tool scoped to the
 * wizard project id, with pagination + dedup by (run_id, remark hash).
 */
async function fetchRemarks(
  _periodStart: Date,
  _periodEnd: Date,
): Promise<RemarkEvent[]> {
  const apiKey = process.env.AMPLITUDE_ANALYTICS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AMPLITUDE_ANALYTICS_API_KEY is not set. The weekly remark-feedback scaffold is landed but the Amplitude MCP credential is still pending — see scripts/cluster-remarks.ts:README_SETUP.',
    );
  }
  // TODO(bet-2-slice-7): call Amplitude MCP `get_events` here.
  await Promise.resolve();
  return [];
}

/**
 * Cluster remarks into prompt-weakness themes. Real impl should use an LLM
 * (via the Claude Agent SDK) with the `review-agent-insights` skill.
 */
async function clusterRemarks(
  _remarks: RemarkEvent[],
): Promise<RemarkCluster[]> {
  await Promise.resolve();
  return [];
}

// ─────────────────────────────────────────────────────────────
// Reporter
// ─────────────────────────────────────────────────────────────

function renderMarkdown(report: ReportPayload): string {
  const lines: string[] = [
    `# Wizard Remark Feedback — ${report.periodStart} → ${report.periodEnd}`,
    '',
    `Captured **${report.totalRemarks}** \`wizard cli: wizard remark\` events.`,
    '',
  ];
  if (report.clusters.length === 0) {
    lines.push(
      '_No prompt-weakness clusters surfaced this week. Either the agent is happy, or the clustering threshold is too strict._',
      '',
    );
  } else {
    lines.push('## Top prompt weaknesses', '');
    for (const cluster of report.clusters) {
      lines.push(`### ${cluster.theme}`);
      lines.push('');
      lines.push(`**Frameworks:** ${cluster.frameworks.join(', ') || '—'}`);
      lines.push('');
      lines.push('**Representative remarks:**');
      for (const q of cluster.quotes) lines.push(`> ${q}`);
      lines.push('');
      lines.push('**Suggested commandment edit:**');
      lines.push('');
      lines.push('```diff');
      lines.push(cluster.suggestedEdit);
      lines.push('```');
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Main entry — only runs when invoked as a script
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  const periodEnd = now.toISOString().slice(0, 10);
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const remarks = await fetchRemarks(new Date(periodStart), now);
    const clusters = await clusterRemarks(remarks);
    const report: ReportPayload = {
      periodStart,
      periodEnd,
      totalRemarks: remarks.length,
      clusters,
    };
    const outPath = join('.github', `remark-feedback-${periodEnd}.md`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, renderMarkdown(report));
    // eslint-disable-next-line no-console
    console.log(outPath);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cluster-remarks: ${msg}\n`);
    // Exit 2 = "not yet configured" so the workflow can detect the stub
    // state without failing loudly.
    process.exit(2);
  }
}

if (require.main === module) {
  void main();
}

// README_SETUP
// -----------
// To finish wiring this scaffold:
//   1. Create a read-only Amplitude analytics API key scoped to the wizard
//      project and store it as the GitHub Actions secret
//      AMPLITUDE_ANALYTICS_API_KEY.
//   2. Add an ANTHROPIC_API_KEY secret (zero-retention) for the clustering
//      call.
//   3. Replace the stub bodies of fetchRemarks() and clusterRemarks() above.
//      The existing Amplitude MCP `get_events` + the `review-agent-insights`
//      skill are the recommended primitives.
//   4. Flip .github/workflows/remark-feedback.yml from `if: false` back on.
