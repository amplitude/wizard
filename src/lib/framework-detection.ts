/**
 * Framework detection — extracted from bin.ts so it can run twice:
 *
 *   1. Once at startup, against the user's initial `installDir`
 *      (cwd or `--install-dir <path>`).
 *   2. Again whenever the IntroScreen user picks "Change directory" and
 *      points the wizard at a different tree. We can't ship a real
 *      "what directory should I instrument?" prompt without this — the
 *      old behavior was to bail out and ask the user to re-run with a
 *      flag, which is the exact CLI anti-pattern the v1 fix was
 *      trying to address.
 *
 * The detection task itself was duplicated inline inside bin.ts. Now
 * both call sites share this helper and stay in sync.
 *
 * Cancellation: the IntroScreen flow can fire detection multiple times
 * in quick succession (user retypes the path, hits Enter, types another
 * one). Each call gets a fresh `AbortSignal`; pass it down so a stale
 * detection can't race a fresh one and stomp on `frameworkConfig` with
 * the wrong result. Detection is read-only fs work — aborting just
 * means we discard the result.
 */

import { detectAllFrameworks, type DetectionResult } from '../run.js';
import { DETECTION_TIMEOUT_MS } from './constants.js';
import { discoverFeatures } from './feature-discovery.js';
import type { FrameworkConfig } from './framework-config.js';
import type { WizardSession } from './wizard-session.js';
import type { Integration } from './constants.js';
import type { DiscoveredFeature } from './wizard-session.js';

/**
 * Structural store interface used by this helper.
 *
 * Defined inline so the lib layer doesn't import from `ui/tui/store`.
 * The real `WizardStore` matches this shape; tests can pass any object
 * that does. Keeping the dependency direction one-way (ui → lib, never
 * the reverse) avoids ESM resolution headaches and keeps the helper
 * usable from non-TUI contexts (CI, agent mode, future apply command).
 */
export interface DetectionTargetStore {
  /** Live view of the wizard session state. */
  readonly session: WizardSession;
  setFrameworkContext(key: string, value: unknown): void;
  setFrameworkConfig(
    integration: Integration | null,
    config: FrameworkConfig | null,
  ): void;
  setDetectedFramework(label: string): void;
  setDetectionResults(results: DetectionResult[]): void;
  addDiscoveredFeature(feature: DiscoveredFeature): void;
  autoEnableInlineAddons(source: 'auto-tui' | 'auto-ci' | 'auto-agent'): void;
  setDetectionComplete(): void;
  subscribe(listener: () => void): () => void;
}

export interface RunFrameworkDetectionOptions {
  /**
   * Cancellation signal. When aborted before detection completes, the
   * helper resolves WITHOUT mutating the store — used so a re-run
   * triggered by the user picking a different directory doesn't have
   * the previous run's `setDetectionComplete()` fire after it.
   */
  signal?: AbortSignal;
}

/**
 * Run detection + per-framework `gatherContext` + feature discovery and
 * mirror the results into the store. Idempotent — safe to call twice
 * for the same `installDir`. The helper returns when detection is
 * complete OR when the abort signal fires, whichever comes first.
 *
 * The store mutations performed (in order):
 *   - `session.detectionResults = results`
 *   - `setFrameworkContext(...)` for each gathered context key
 *   - `setFrameworkConfig(integration, config)` if a framework matched
 *   - `setDetectedFramework(label)` for the friendly label
 *   - `addDiscoveredFeature(...)` for each opt-in addon
 *   - `autoEnableInlineAddons('auto-tui')`
 *   - `setDetectionComplete()` exactly once at the end
 *
 * The returned promise resolves with the raw detection results so
 * callers can log them. On abort, resolves with whatever results were
 * collected before the signal fired.
 */
export async function runFrameworkDetection(
  store: DetectionTargetStore,
  installDir: string,
  options: RunFrameworkDetectionOptions = {},
): Promise<DetectionResult[]> {
  const { signal } = options;

  // Lazy import the registry so tests can mock it without dragging the
  // entire framework graph into the unit-test module load.
  const { FRAMEWORK_REGISTRY } = await import('./registry.js');

  if (signal?.aborted) return [];

  const results = await detectAllFrameworks(installDir);
  if (signal?.aborted) return results;

  // Mirror the full detection table onto the session so `/diagnostics`
  // can show what each detector returned, even when we picked one of
  // them as the winner.
  store.setDetectionResults(results);

  const detectedIntegration = results.find((r) => r.detected)?.integration;

  if (detectedIntegration) {
    const config: FrameworkConfig = FRAMEWORK_REGISTRY[detectedIntegration];

    // Run gatherContext for the friendly variant label (e.g. "Next.js
    // (App Router)" vs the bare "Next.js"). Bounded by DETECTION_TIMEOUT_MS
    // so a slow project file scan can't deadlock the intro screen.
    if (config.metadata.gatherContext) {
      try {
        const context = await Promise.race([
          config.metadata.gatherContext({
            installDir,
            debug: store.session.debug,
            forceInstall: store.session.forceInstall,
            default: false,
            signup: store.session.signup,
            localMcp: store.session.localMcp,
            ci: store.session.ci,
            menu: store.session.menu,
            benchmark: store.session.benchmark,
          }),
          new Promise<Record<string, never>>((resolve) =>
            setTimeout(() => resolve({}), DETECTION_TIMEOUT_MS),
          ),
        ]);
        if (signal?.aborted) return results;
        for (const [key, value] of Object.entries(context)) {
          if (!(key in store.session.frameworkContext)) {
            store.setFrameworkContext(key, value);
          }
        }
      } catch {
        // gatherContext failures are non-fatal; we'll fall back to the
        // generic framework name.
      }
    }

    if (signal?.aborted) return results;

    store.setFrameworkConfig(detectedIntegration, config);

    if (!store.session.detectedFrameworkLabel) {
      store.setDetectedFramework(config.metadata.name);
    }
  }

  if (signal?.aborted) return results;

  // Feature discovery — same helper that CI/agent uses, so the package
  // and integration lists never drift between modes.
  //
  // CRITICAL: read `installDir` and `integration` from `store.session`
  // every call, NOT from the surrounding function parameter. The
  // integration-change subscriber below is registered ONCE per store
  // and outlives the closure that registered it. If we captured
  // `installDir` from the parameter, then after a directory change
  // (which keeps the same store + same subscriber) the subscriber
  // would scan the OLD package.json against the NEW integration —
  // potentially adding Stripe / LLM features from a project the user
  // already navigated away from.
  //
  // Dedup: discovery fires from TWO places — the inline call below
  // and the integration-change subscriber. On a normal run both fire
  // for the same (installDir, integration) pair, which is wasteful
  // (and emits two `autoEnableInlineAddons` events). Track the last
  // discovered fingerprint per store so the second call skips. We
  // need the WeakMap, not a function-scope variable, because the
  // subscriber from the first invocation outlives that closure and
  // continues firing on subsequent re-detection runs (when bin.ts
  // hands the same store off to a new directory).
  const runDiscovery = (): void => {
    const installDir = store.session.installDir;
    const integration = store.session.integration;
    const fingerprint = `${installDir}::${integration ?? '__none__'}`;
    if (lastDiscoveryFingerprint.get(store) === fingerprint) return;
    lastDiscoveryFingerprint.set(store, fingerprint);

    for (const f of discoverFeatures({ installDir, integration })) {
      store.addDiscoveredFeature(f);
    }
    // Auto-enable every discovered opt-in addon (Session Replay +
    // Guides & Surveys for unified-SDK web; LLM when the feature flag
    // is on). Per-option inline comments in the generated init code
    // give users a clear, code-level opt-out surface.
    store.autoEnableInlineAddons('auto-tui');
  };
  runDiscovery();

  // Re-run when integration changes (handles manual selection after
  // auto-detection fails). Only the FIRST call wires this subscription
  // — subsequent re-detection calls on a directory change inherit the
  // listener that's already in place. The subscriber re-reads
  // installDir from the store on every fire (see `runDiscovery`), so
  // it stays correct even when bin.ts hands the same store off to a
  // new directory.
  if (!hasIntegrationWatcher.has(store)) {
    let lastIntegration = store.session.integration;
    store.subscribe(() => {
      const integration = store.session.integration;
      if (integration === lastIntegration) return;
      lastIntegration = integration;
      // Skip when the integration was just RESET (e.g., during
      // `changeInstallDir`). Running discovery with a null integration
      // is harmless but wasteful — and worse, fires synchronously
      // mid-`emitChange` on the directory swap, which we want to
      // avoid. The follow-on detection run will set the new
      // integration shortly and the subscriber will fire again with
      // useful work to do.
      if (integration === null) return;
      runDiscovery();
    });
    hasIntegrationWatcher.add(store);
  }

  if (signal?.aborted) return results;

  // Signal detection is done — IntroScreen now shows the picker or
  // results table. The order matters: we set frameworkConfig BEFORE
  // flipping detectionComplete so the "no framework detected" fallback
  // branch in the screen never sees a stale `null` config.
  store.setDetectionComplete();

  return results;
}

/**
 * Tracks which stores already have an integration-change subscriber
 * wired up. We could also store this as a flag on the session, but
 * that would leak an internal listener concern into the persisted
 * shape. A WeakSet keeps it where it belongs — out-of-band per-process
 * state.
 */
const hasIntegrationWatcher = new WeakSet<DetectionTargetStore>();

/**
 * Per-store fingerprint of the last `(installDir, integration)` pair
 * discovery ran against. Lets the dedup guard in `runDiscovery` skip
 * a redundant scan when the inline call and the subscriber-fired call
 * end up with the same pair on the same run.
 *
 * WeakMap (not function-scope variable) because the subscriber from
 * the FIRST `runFrameworkDetection` call survives subsequent calls,
 * so its closure-captured `runDiscovery` keeps firing on later
 * directory changes — and needs a fingerprint that the NEXT run's
 * inline call can also see.
 */
const lastDiscoveryFingerprint = new WeakMap<DetectionTargetStore, string>();
