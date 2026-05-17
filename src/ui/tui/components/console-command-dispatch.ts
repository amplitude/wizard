/**
 * console-command-dispatch — pure dispatcher for slash commands typed
 * into the ConsoleView prompt.
 *
 * Previously inlined in `ConsoleView.tsx` as a ~300-line `executeCommand`
 * switch + a `submitFeedbackWithConsent` helper. The dispatcher and its
 * helpers are all pure logic — they mutate the store and trigger
 * filesystem / network side effects, but never read React state or
 * touch the render tree. Lifting them out shrinks ConsoleView's render
 * file from >900 to ~580 lines and makes the dispatch surface easier to
 * trace.
 *
 * `executeCommand` returns:
 *   - `string`  → ConsoleView should `handleSubmit(string)` to fan the
 *                 follow-up query through the AI flow (currently unused,
 *                 reserved for slash commands that synthesize a query).
 *   - `void`    → command fully handled inline.
 *
 * Keep this file behavior-identical to the prior inline switch. Tests in
 * `ConsoleView.test.tsx` and `console-commands.test.ts` lock down the
 * `/version` / `/diagnostics` / error-handling contracts.
 */

import path from 'node:path';

import type { WizardStore } from '../store.js';
import { OutroKind } from '../session-constants.js';
import { DEFAULT_AMPLITUDE_ZONE } from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';
import { getLogFile } from '../../../utils/storage-paths.js';
import { saveDiagnosticArtifact } from '../utils/save-diagnostic-artifact.js';
import {
  checkCommandBlockedByRun,
  getWhoamiText,
  getDiagnosticsLines,
  getHelpText,
  getVersionText,
  parseDiffSlashInput,
  parseFeedbackSlashInput,
  parseCreateProjectSlashInput,
} from '../console-commands.js';
import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import {
  summarizeLedgerDiffs,
  summarizeLedgerPath,
} from '../../../lib/file-change-diff.js';
import { formatChangeCounts } from './DiffViewer.js';
import { displayPath } from '../utils/display-path.js';
import { analytics } from '../../../utils/analytics.js';
import { trackWizardFeedback } from '../../../utils/track-wizard-feedback.js';
import { collectDiagnostics } from '../../../lib/diagnostics-collector.js';

export async function submitFeedbackWithConsent(
  message: string,
  store: WizardStore,
): Promise<void> {
  try {
    const includeDiagnostics = await store.promptConfirm(
      'Share diagnostics about your framework and OS to help us improve?',
    );
    analytics.wizardCapture('feedback diagnostics consent', {
      consented: includeDiagnostics,
    });
    const diagnostics = includeDiagnostics
      ? await collectDiagnostics({
          session: store.session,
          wizardVersion: store.version,
          detectedFrameworks: store.session.detectionResults ?? undefined,
        }).catch((err: unknown) => {
          analytics.wizardCapture('feedback diagnostics failed', {
            'error message': err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })
      : undefined;
    await trackWizardFeedback(message, diagnostics);
    store.setCommandFeedback(
      diagnostics
        ? 'Thanks — your feedback and diagnostics were sent.'
        : 'Thanks — your feedback was sent.',
    );
  } catch (err: unknown) {
    store.setCommandFeedback(
      `Could not send feedback: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export function executeCommand(raw: string, store: WizardStore): string | void {
  const [cmd] = raw.trim().split(/\s+/);

  // Guard: commands flagged `requiresIdle` would mutate session credentials,
  // region, or org/project selection out from under an in-flight agent run.
  // Surface a tailored message and bail before dispatching.
  if (cmd) {
    const blockedMessage = checkCommandBlockedByRun(
      cmd,
      store.session.runPhase,
    );
    if (blockedMessage) {
      store.setCommandFeedback(blockedMessage, 6000);
      return;
    }
  }

  switch (cmd) {
    case '/region':
      store.setRegionForced();
      break;
    case '/login':
      store.showLoginOverlay();
      break;
    case '/logout':
      store.showLogoutOverlay();
      break;
    case '/whoami':
      // Show current data immediately, then refresh from API
      store.setCommandFeedback(getWhoamiText(store.session), 30_000);
      if (store.session.credentials?.idToken) {
        // readDisk: true — /whoami may fire at any point in the session,
        // including before RegionSelect is reached.
        const zone = resolveZone(store.session, DEFAULT_AMPLITUDE_ZONE, {
          readDisk: true,
        });
        void import('../../../lib/api.js').then(({ fetchAmplitudeUser }) => {
          fetchAmplitudeUser(store.session.credentials!.idToken!, zone)
            .then((userInfo) => {
              if (userInfo.email) {
                store.session.userEmail = userInfo.email;
                analytics.setDistinctId(userInfo.email);
                analytics.identifyUser({
                  email: userInfo.email,
                  org_id: store.session.selectedOrgId ?? undefined,
                  org_name: store.session.selectedOrgName ?? undefined,
                  project_id: store.session.selectedProjectId ?? undefined,
                  project_name: store.session.selectedProjectName ?? undefined,
                  app_id: store.session.selectedAppId,
                  env_name: store.session.selectedEnvName,
                  region: zone,
                  integration: store.session.integration,
                });
              }
              const orgId = store.session.selectedOrgId;
              if (orgId) {
                const org = userInfo.orgs.find((o) => o.id === orgId);
                if (org) store.session.selectedOrgName = org.name;
              }
              store.setCommandFeedback(getWhoamiText(store.session), 30_000);
            })
            .catch(() => {
              // Non-fatal — keep showing what we have
            });
        });
      }
      break;
    case '/slack':
      store.showSlackOverlay();
      break;
    case '/feedback': {
      const message = parseFeedbackSlashInput(raw);
      if (!message) {
        store.setCommandFeedback('Usage: /feedback <your message>');
        break;
      }
      void submitFeedbackWithConsent(message, store);
      break;
    }
    case '/mcp':
      store.showMcpOverlay();
      break;
    case '/create-project': {
      // Requires an authenticated session with a selected org so the proxy
      // call has an orgId. Surface a friendly message otherwise.
      const hasAuth = Boolean(
        store.session.pendingAuthIdToken || store.session.credentials?.idToken,
      );
      const hasOrg = Boolean(store.session.selectedOrgId);
      if (!hasAuth) {
        store.setCommandFeedback(
          'Sign in first (/login) before creating a project.',
        );
        break;
      }
      if (!hasOrg) {
        store.setCommandFeedback(
          'Pick an organization first (the Auth screen) before creating a project.',
        );
        break;
      }
      const suggested = parseCreateProjectSlashInput(raw);
      store.startCreateProject('slash', suggested || null);
      break;
    }
    case '/snake':
      store.showSnakeOverlay();
      break;
    case '/debug': {
      // Write a redacted diagnostic snapshot to a file the user can read
      // AFTER the wizard exits. Earlier versions wrote to stderr while
      // Ink owned the terminal — Ink's diff-based redraw doesn't account
      // for stderr writes, so the JSON either got painted over or
      // interleaved with the live frame. The file approach is boring,
      // robust, and gives the user something they can copy directly into
      // a bug report.
      void import('../utils/diagnostics.js')
        .then(async ({ createDiagnosticSnapshot }) => {
          const snapshot = createDiagnosticSnapshot(
            store,
            store.version || 'unknown',
          ) as {
            current_screen?: string | null;
            active_flow?: string | null;
            session?: {
              integration?: string | null;
              region?: string | null;
            };
            tasks_count?: number;
          };
          // Multi-line summary so each row stays readable instead of being
          // hard-truncated by the single overflow-hidden command-feedback
          // Text element. The snapshot file on disk is the full-fidelity
          // backup; this panel is what the user actually wanted to read.
          const summaryLines: string[] = [
            'Debug snapshot:',
            `  flow:        ${snapshot.active_flow ?? 'n/a'}`,
            `  screen:      ${snapshot.current_screen ?? 'n/a'}`,
            `  integration: ${snapshot.session?.integration ?? 'n/a'}`,
            `  zone:        ${snapshot.session?.region ?? 'n/a'}`,
            `  tasks:       ${snapshot.tasks_count ?? 0}`,
          ];
          // Filesystem write failures (read-only fs, permissions, etc.)
          // are absorbed by `saveDiagnosticArtifact` — fall back to surfacing
          // the summary alone. Don't write to stderr; corrupting the TUI
          // mid-render is the original bug.
          const { feedbackLines } = await saveDiagnosticArtifact({
            installDir: store.session.installDir,
            fileName: 'debug-snapshot.json',
            payload: JSON.stringify(snapshot, null, 2),
            summaryLines,
            fallbackMessage: '(could not save full snapshot to disk)',
          });
          store.setCommandFeedback(feedbackLines, 30_000);
        })
        .catch(() => {
          // Surface the actual per-project log path. Two parallel runs land
          // their logs in different directories — pointing at /tmp here
          // would send users to the wrong (or shared) file.
          store.setCommandFeedback(
            `Diagnostics unavailable. See ${getLogFile(
              store.session.installDir,
            )}.`,
          );
        });
      break;
    }
    case '/diagnostics': {
      // Render the full storage layout INLINE in the feedback panel as
      // multiple rows so each absolute path stays readable. Previously this
      // packed everything into a single feedback string, which the
      // overflow-hidden Text element truncated to "/Users/…" — the user
      // could see the summary path but not the log path they actually
      // needed to copy. The on-disk diagnostics.txt is still written as a
      // shareable backup.
      const lines = getDiagnosticsLines(store.session.installDir);
      // Bugbot 3221826573: `getDiagnosticsText` was internally calling
      // `getDiagnosticsLines(installDir).join('\n')`, so it walked the
      // storage paths twice for the same install dir. `lines` is
      // already in hand — derive text from it directly.
      const text = lines.join('\n');
      void (async () => {
        const { feedbackLines } = await saveDiagnosticArtifact({
          installDir: store.session.installDir,
          fileName: 'diagnostics.txt',
          payload: text + '\n',
          summaryLines: lines,
          fallbackMessage: '(could not write diagnostics file)',
        });
        store.setCommandFeedback(feedbackLines, 30_000);
      })();
      break;
    }
    case '/diff': {
      // The slash console is a single-line feedback channel — full
      // unified-diff rendering belongs in the DiffViewer component the
      // outro mounts. Here we surface the most actionable information:
      // a tree of touched files with +N/-M counts (no path arg) or
      // the additions/deletions for one file (path arg).
      const arg = parseDiffSlashInput(raw) ?? '';
      const ledger = getFileChangeLedger();
      // Detail mode (`/diff <path>`): use the purpose-built single-path
      // helper so we don't burn `structuredPatch`+`createPatch` on every
      // unrelated file in the ledger just to discard them. The summary
      // mode below still needs the full sweep for the +N/-M tree.
      if (arg) {
        // Hand the raw arg straight to `summarizeLedgerPath` — it already
        // normalizes relative paths against the ledger's install dir, so
        // re-resolving against `store.session.installDir` here would risk
        // silent divergence (e.g. trailing-slash mismatch) without buying
        // anything. The fallback below covers the user-friendly suffix
        // case (`/diff amplitude.ts` matching `<installDir>/src/lib/
        // amplitude.ts`) by walking entries directly.
        let found = summarizeLedgerPath(ledger, arg);
        if (!found) {
          const entries = ledger?.getEntries() ?? [];
          const suffix = path.sep + arg;
          const suffixEntry = entries.find((e) => e.path.endsWith(suffix));
          if (suffixEntry) {
            found = summarizeLedgerPath(ledger, suffixEntry.path);
          }
        }
        if (!found) {
          store.setCommandFeedback(
            `No diff captured for "${arg}". Try /diff with no argument to see all changed files.`,
            15_000,
          );
          break;
        }
        // Surface the patch body in the feedback channel. The slash console
        // can't easily render syntax-coloured diffs inline, but the unified
        // patch text is itself readable and copy-pasteable. Relativize the
        // header path through the same `displayPath` helper the summary
        // mode + FileWritesPanel + DiffViewer use, so detail mode doesn't
        // leak the user's absolute home-directory path.
        const detailRel = displayPath(found.path, store.session.installDir);
        store.setCommandFeedback(
          `${found.operation.toUpperCase()} ${detailRel}  ${formatChangeCounts(
            found.additions,
            found.deletions,
          )}\n\n${found.patch}`,
          60_000,
        );
        break;
      }
      // Summary mode (no arg): walk the whole ledger. The summary only
      // renders +/- counts and the operation glyph — no patch text — so
      // skip the per-entry `createPatch` call (an O(n·m) re-diff that
      // `summarizeDiff` already did) for the whole ledger.
      const diffs = summarizeLedgerDiffs(ledger, { includePatch: false });
      if (diffs.length === 0) {
        store.setCommandFeedback(
          'No file changes captured yet — the agent has not written anything in this session.',
          15_000,
        );
        break;
      }
      const totalAdd = diffs.reduce((s, d) => s + d.additions, 0);
      const totalDel = diffs.reduce((s, d) => s + d.deletions, 0);
      const lines = diffs.map((d) => {
        // Funnel through the shared `displayPath` helper so the `/diff`
        // summary, the live FileWritesPanel, and the outro DiffViewer all
        // agree on the out-of-project fallback (basename, not raw path).
        const rel = displayPath(d.path, store.session.installDir);
        return `${d.operation
          .toUpperCase()
          .padEnd(6)} ${rel}  ${formatChangeCounts(d.additions, d.deletions)}`;
      });
      const summary = `${diffs.length} file${
        diffs.length === 1 ? '' : 's'
      } changed (+${totalAdd}/-${totalDel})\n${lines.join('\n')}`;
      store.setCommandFeedback(summary, 30_000);
      break;
    }
    case '/help': {
      store.setCommandFeedback(getHelpText(), 30_000);
      break;
    }
    case '/version':
      // Surface wizard + agent-mode protocol + Node/platform versions
      // inline so users filing a bug report can grab them without
      // exiting the TUI to run `amplitude-wizard --version` in a shell.
      // Multi-line, so we render it through the same long-lived
      // `setCommandFeedback` slot used by /diagnostics.
      store.setCommandFeedback(getVersionText(), 30_000);
      break;
    case '/exit':
      store.setOutroData({ kind: OutroKind.Cancel, message: 'Exited.' });
      break;
    default:
      if (cmd)
        store.setCommandFeedback(
          `Unknown command: ${cmd}. Type / to see available commands.`,
        );
  }
}
