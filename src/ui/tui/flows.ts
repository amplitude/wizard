/**
 * Flow pipelines — declarative screen sequences for each wizard flow.
 *
 * Owns the Screen and Flow enums (re-exported by router.ts) to avoid
 * circular imports between router ↔ flows.
 *
 * Each entry defines a screen, optional visibility predicate, and
 * optional completion predicate. The router walks the active flow
 * to resolve which screen to show.
 */

import {
  type WizardSession,
  isCreateAccountOnboarding,
} from '../../lib/wizard-session.js';
// WizardStore is used by the FlowEntry.revert callback signature below
// (PR 301 — Esc-based back navigation).
import type { WizardStore } from './store.js';
import { RunPhase } from './session-constants.js';
import { tryResolveZone } from '../../lib/zone-resolution.js';
import { assertNever } from '../../utils/assert-never.js';
import type { RequiredKey } from '../../utils/direct-signup.js';

/**
 * Typed alias for the signup `required` field keys (currently
 * `'full_name' | 'terms_acceptance'`). Wraps the canonical `RequiredKey`
 * type from `utils/direct-signup` so signup-flow predicates here read
 * naturally and a future addition to `KNOWN_REQUIRED_KEYS` is caught at
 * compile time at every call site below.
 */
export type SignupField = RequiredKey;

/**
 * Predicate factory: returns `(s) => session.signupRequiredFields?.includes(field) ?? false`.
 *
 * Encapsulates the duplicate `signupRequiredFields !== null &&
 * signupRequiredFields.includes(<field>)` shape that previously appeared
 * five times across the signup-ceremony entries' `show` / `isComplete` /
 * `revert` callbacks. Used directly for `show` predicates, negated for
 * `isComplete`, and called inline inside `revert` guards. The `field`
 * parameter is typed as `SignupField` so a typo (`'fullName'` instead of
 * `'full_name'`) is a TypeScript error rather than a silently-always-false
 * predicate.
 *
 * Semantics preserved exactly:
 *   - `signupRequiredFields === null` → returns `false` (no requirements
 *     known yet, so no specific field is required).
 *   - `signupRequiredFields.includes(field)` → returns `true`.
 *   - Otherwise → returns `false`.
 */
export function requiresSignupField(
  field: SignupField,
): (session: WizardSession) => boolean {
  return (session) => session.signupRequiredFields?.includes(field) ?? false;
}

// ── Screen + Flow enums ──────────────────────────────────────────────

/** Screens that participate in linear flows */
export enum Screen {
  Intro = 'intro',
  Setup = 'setup',
  Auth = 'auth',
  CreateProject = 'create-project',
  RegionSelect = 'region-select',
  SignupEmail = 'signup-email',
  SigningUp = 'signing-up',
  SignupFullName = 'signup-full-name',
  ToS = 'tos',
  DataSetup = 'data-setup',
  ActivationOptions = 'activation-options',
  Run = 'run',
  Mcp = 'mcp',
  DataIngestionCheck = 'data-ingestion-check',
  Slack = 'slack',
  Outro = 'outro',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  SlackSetup = 'slack-setup',
}

/** Named flows the router can run */
export enum Flow {
  Wizard = 'wizard',
  McpAdd = 'mcp-add',
  McpRemove = 'mcp-remove',
  SlackSetup = 'slack-setup',
  RegionSelect = 'region-select',
}

// ── Flow definitions ─────────────────────────────────────────────────

export interface FlowEntry {
  /** Screen to show */
  screen: Screen;
  /** If provided, screen is skipped when this returns false. Omit = always show. */
  show?: (session: WizardSession) => boolean;
  /** If provided, screen is considered complete when this returns true. */
  isComplete?: (session: WizardSession) => boolean;
  /**
   * Back-navigation: undoes whatever made `isComplete` true so the router
   * resolves back to this screen on the next render. Entries without a
   * `revert` act as a wall — back-navigation is blocked past them
   * (e.g. agent Run, which would be destructive to undo).
   *
   * Return `false` when the revert was a no-op (nothing meaningful to undo);
   * the router will keep walking further back. `void` / `true` count as a
   * successful revert.
   */
  revert?: (store: WizardStore) => boolean | void;
  /**
   * State-driven hard wall. When true on a completed entry, back-nav
   * past this entry is blocked outright (`canGoBack` / `goBack` return
   * `false`). Checked BEFORE `revert` so a wall takes precedence over
   * a defined revert callback.
   *
   * Use for committed states the user cannot honestly undo — e.g. a
   * server account created during signup. Distinct from "no `revert`
   * defined" (a flow-definition-time wall): `isWall` is a runtime
   * decision based on session state, so the same entry can revert
   * normally in one state and be a hard wall in another.
   *
   * Today the only `isWall` user is the signup-ceremony entries, gated
   * on `signupCommittedWall` (BA-114). The browser-OAuth callback case
   * is tracked separately as BA-122.
   */
  isWall?: (session: WizardSession) => boolean;
}

/**
 * State-driven wall for the signup-ceremony entries.
 *
 * Once the user has committed to direct signup — either the POST is
 * mid-flight or it landed successfully — back-nav out of the ceremony
 * is a no-op trapdoor: the server-side account exists (success) or
 * could land any moment (in-flight) on a session that's been wiped.
 *
 * `signupAuth !== null` covers the "direct-signup success" case. The
 * `requires_redirect` arm (browser-OAuth fallback) is intentionally NOT
 * covered here — tracked separately as BA-122.
 *
 * `signupInFlight` covers the in-flight POST window, written
 * exclusively by `WizardStore.runSignupAttempt`'s try/finally.
 *
 * Scope: this wall applies to **back-nav only** (Esc / `goBack`). Slash
 * commands that funnel through `_resetCeremonyKeys` (e.g. `/region` →
 * `setRegionForced`, `switchToLogin`) are out of scope by design — they
 * represent explicit user intent ("I picked the wrong region; restart
 * from there") that should not be silently blocked while a brief POST
 * is in flight. If a slash command fires mid-POST, the ceremony state
 * is wiped atomically alongside `signupInFlight` and the response is
 * dropped on the floor — same outcome as user `/exit` mid-POST.
 */
function signupCommittedWall(s: WizardSession): boolean {
  return s.signupAuth !== null || s.signupInFlight;
}

/**
 * Check if the SetupScreen is needed (unresolved framework questions).
 */
function needsSetup(session: WizardSession): boolean {
  const config = session.frameworkConfig;
  if (!config?.metadata.setup?.questions) return false;

  return config.metadata.setup.questions.some(
    (q: { key: string }) => !(q.key in session.frameworkContext),
  );
}

/**
 * Structural detector for "the env picker still needs to render before the
 * router can advance past Auth". Pure function of session state — no flag
 * to clobber.
 *
 * Returns true when EVERY one of the following holds:
 *   1. `pendingOrgs` is populated (so `resolveCredentials` ran and the
 *      org/project list is available — distinguishes the SUSI/checkpoint
 *      path from the manual-API-key path, where `pendingOrgs` is null).
 *   2. The resolver-targeted project (either the user's pre-selected
 *      project, or — when nothing's been picked yet — `pendingOrgs[0]
 *      .projects[0]`, which is what `resolveCredentials` itself used when
 *      it landed at `needs_user_choice/environment_selection`) has ≥ 2
 *      environments with usable API keys.
 *   3. The user hasn't picked an env yet (`selectedEnvName === null`).
 *
 * When ALL of those hold, `Auth.isComplete` must return false so the router
 * keeps the user on AuthScreen until they pick an env (or hit Esc / manually
 * enter an API key — both of those paths set `selectedEnvName` or replace
 * `pendingOrgs` in ways that flip this back to false).
 *
 * This is intentionally REDUNDANT with the `pendingEnvSelection` flag in
 * the predicate. The flag is the primary gate; this is defense in depth
 * for the recurring class of bug where the flag gets cleared by an
 * unrelated path before the env is actually picked. Both gates point at
 * the same "env still needs picking" state, but one is mutable state and
 * the other is derived structure — so any single bug that clobbers the
 * flag is now also caught by the structural check (and vice versa).
 *
 * **Restart-after-reset fix (#778 follow-up):** when `git reset --hard`
 * wipes `<installDir>/.amplitude/` and `PR #778`'s `loadCheckpoint`
 * invalidates the per-user checkpoint, the session reaches Auth with
 * `selectedOrgId === null` AND `selectedProjectId === null` —
 * `resolveCredentials` never sets those in the multi-env defer branch.
 * The previous guard 2 short-circuited to `false` in that case, so the
 * structural gate left only `pendingEnvSelection` standing — and a
 * silent clear of that flag landed the user on Setup with no picker.
 * The fallback below mirrors `resolveCredentials`' own "first project
 * of first org" heuristic (`credential-resolution.ts` ~line 483) so the
 * structural gate covers the no-pre-selection path too. Once the user
 * picks an org/project via AuthScreen, guard 2 takes over with the
 * specific selection.
 *
 * **Stale-IDs fix (PRs #747/#760/#762/#775/#778/#780 follow-up — the
 *   one that finally pins the live repro):** PR #780 only fired the
 * `pendingOrgs[0].projects[0]` fallback when BOTH `selectedOrgId` AND
 * `selectedProjectId` are null. In the real restart-after-reset
 * sequence, `AuthScreen`'s auto-resolve effect for single-org/
 * single-project writes `selectedOrgId/ProjectId` from the FIRST
 * `pendingOrgs` snapshot (returned by `resolveCredentials`). The
 * `authTask` then runs OAuth, `fetchAmplitudeUser` fetches a SECOND
 * time, and `setOAuthComplete` REPLACES `pendingOrgs` with the fresh
 * snapshot. If the two snapshots' IDs don't match (re-fetch race, a
 * different ordering, account changes between calls, even just a stale
 * `selectedProjectId` from an earlier session that survived in
 * memory) — the existing `pendingOrgs.find(o => o.id === selectedOrgId)`
 * call returns `undefined` and the structural gate short-circuits to
 * `false`. If anything then clobbers `pendingEnvSelection` (the
 * recurring failure mode 6 prior PRs chased), `Auth.isComplete`
 * returns true and the router walks past Auth into the Setup-bucket
 * screens — exactly the user-reported `✓ Auth ─ ● Setup ←` hang with
 * no env picker on screen. The fix: when stale IDs don't resolve a
 * project in `pendingOrgs`, fall through to the same first-org/
 * first-project heuristic instead of bailing out. The structural gate
 * is now load-bearing across all three states: (a) no IDs picked
 * (#780), (b) IDs picked and valid, (c) IDs picked but stale relative
 * to the fresh `pendingOrgs` (this PR).
 */
function needsEnvPickStillRequired(session: WizardSession): boolean {
  // Guard 1: pendingOrgs must be populated. The manual-API-key path
  // (apiKeyNotice resolver outcome) doesn't populate pendingOrgs, so this
  // check leaves that path's `Auth.isComplete` semantics unchanged.
  const pendingOrgs = session.pendingOrgs;
  if (pendingOrgs === null || pendingOrgs.length === 0) return false;

  // Guard 3: the user hasn't picked an env yet. Either picking an env
  // (real or via auto-select) flips `selectedEnvName` non-null and lets
  // the structural gate stop blocking.
  if (session.selectedEnvName !== null) return false;

  // Resolve the project this run is targeting. Three valid sources,
  // tried in order of specificity:
  //   (a) `selectedOrgId/ProjectId` resolve to a project IN
  //       `pendingOrgs` — the user has a real selection, use it.
  //   (b) `selectedOrgId/ProjectId` are set but DON'T resolve in
  //       `pendingOrgs` (stale IDs from an earlier snapshot — typical
  //       after `setOAuthComplete` replaced the orgs list with a
  //       fresh fetch). Fall through to (c) — stale IDs must not let
  //       the structural gate short-circuit, otherwise the env-picker
  //       hang reproduces.
  //   (c) Use `pendingOrgs[0].projects[0]` — the same tuple
  //       `resolveCredentials` walked when it issued the deferral.
  const orgId = session.selectedOrgId;
  const projectId = session.selectedProjectId;
  let project: (typeof pendingOrgs)[number]['projects'][number] | undefined;
  if (orgId !== null && projectId !== null) {
    // Try (a): exact specific selection.
    const org = pendingOrgs.find((o) => o.id === orgId);
    project = org?.projects.find((p) => p.id === projectId);
    // Fall through to (c) below if not found — that's path (b).
  }
  if (!project) {
    // (c) No selection yet OR stale IDs. Use the first-org/
    //     first-project heuristic `resolveCredentials` did so the gate
    //     detects the exact (org, project, envsWithKey) tuple the
    //     deferral was triggered against.
    project = pendingOrgs[0]?.projects?.[0];
    if (!project) return false;
  }

  // Guard 2: the targeted project has ≥ 2 envs with API keys.
  const selectableEnvs = (project.environments ?? []).filter(
    (e) => e.app?.apiKey,
  );
  if (selectableEnvs.length < 2) return false;

  return true;
}

/** All flow pipelines. Add new screens by appending entries. */
export const FLOWS: Record<Flow, FlowEntry[]> = {
  [Flow.Wizard]: [
    // 1. Welcome + framework detection — always shown first so the user
    //    confirms before the wizard proceeds to region select and auth.
    {
      screen: Screen.Intro,
      isComplete: (s) => s.introConcluded,
      revert: (store) => {
        store.rewindIntro();
      },
    },
    // 2. Region selection — must know US vs EU before opening OAuth URL.
    //    Skipped for returning users (zone resolvable from ampli.json or
    //    stored user). `session.region` represents this-run user intent and
    //    is intentionally NOT populated from disk by resolveCredentials —
    //    so we use `tryResolveZone` here to consult Tier 2/3 (ampli.json
    //    Zone, stored user zone) and skip the picker when a returning user
    //    already has a zone on disk.
    //    Re-shown when /region slash command sets regionForced.
    {
      screen: Screen.RegionSelect,
      show: (s) => tryResolveZone(s) === null || s.regionForced,
      isComplete: (s) => tryResolveZone(s) !== null && !s.regionForced,
      // Back from Auth — re-show the region picker. Region affects OAuth
      // host, so we also have to drop pending tokens / org list / credentials
      // so the next pass actually re-authenticates against the new region.
      revert: (store) => {
        store.resetAuthForRegionChange();
      },
    },
    // 2a. Signup email — create-account path, first step. Always renders
    //     when the session has no email yet (initial entry, or after a
    //     back-nav from a collection screen cleared it).
    {
      screen: Screen.SignupEmail,
      show: (s) => isCreateAccountOnboarding(s) && s.signupEmail === null,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) || s.signupEmail !== null,
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        store.setSignupEmail(null);
      },
      isWall: signupCommittedWall,
    },
    // 2b. Signing up — POSTs the agentic provisioning request and writes
    //     the response into session state. Show predicate gates on email
    //     present + ceremony unsettled + all required-fields satisfied
    //     (covers both the initial probe POST and the retry-after-collection
    //     POST). isComplete fires when signupAuth or signupAbandoned is set.
    //
    //     `revert` returns false on the sign-in path so the entry is
    //     transparent to back-nav — a sign-in user reaching Auth must be
    //     able to back-walk to RegionSelect / Intro without hitting a
    //     create-account-only wall. On the create-account path with the
    //     ceremony in flight, returning false keeps the wall semantics
    //     (no clean undo: a successful signup created a server account;
    //     an abandon already routed to OAuth).
    {
      screen: Screen.SigningUp,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        s.signupEmail !== null &&
        s.signupAuth === null &&
        !s.signupAbandoned &&
        // No required fields known yet (initial probe), OR every required
        // field has been satisfied via its corresponding session state.
        // The exhaustive switch + `assertNever` makes adding a future
        // RequiredKey a compile-time error here until the new kind is
        // explicitly mapped to its "satisfied" condition. The previous
        // `: true` default branch silently passed unknown kinds, which
        // would have masked a contract drift.
        (s.signupRequiredFields === null ||
          s.signupRequiredFields.every((field) => {
            switch (field) {
              case 'full_name':
                return s.signupFullName !== null;
              case 'terms_acceptance':
                return s.tosAccepted === true;
              default:
                return assertNever(field);
            }
          })),
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        s.signupAuth !== null ||
        s.signupAbandoned,
      // SigningUp has no in-band "undo": the in-flight POST to the
      // provisioning endpoint may have already created (or abandoned)
      // the account on the server. Returning false makes back-nav walk
      // past this entry transparently — back-nav lands on the screen
      // *before* SigningUp (typically SignupFullName or SignupEmail),
      // and clearing those inputs via their own revert handlers is what
      // resets the ceremony so the next forward pass fires a fresh
      // probe.
      revert: () => false,
      isWall: signupCommittedWall,
    },
    // 2c. Terms of Service — renders only when the server (or the parser's
    //     spoof) actually requires it: `'terms_acceptance' in
    //     signupRequiredFields`. This is the load-bearing migration
    //     decision: when the BE flag is ON across env tiers and the spoof
    //     is removed, the parser stops injecting `'terms_acceptance'` and
    //     the screen naturally skips. If a future BE business decision
    //     drops the requirement entirely, this predicate evaluates false
    //     with no further wizard work.
    {
      screen: Screen.ToS,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        requiresSignupField('terms_acceptance')(s) &&
        s.tosAccepted !== true,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        !requiresSignupField('terms_acceptance')(s) ||
        s.tosAccepted === true,
      // Returning false when the screen was *skipped* (server never asked,
      // or ToS was never accepted) is critical: `isComplete` returns true
      // via the "screen was skipped" arm too, and a blind `resetToS` would
      // be a no-op that nonetheless stops the back-nav walk — leaving the
      // user on Auth pressing Esc with nothing visibly happening.
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        if (store.session.signupRequiredFields === null) return false;
        if (store.session.tosAccepted === null) return false;
        // Walk past on abandonment BEFORE touching ToS state. `resetToS`
        // emits a 'back navigation to tos' analytics event as a side
        // effect of clearing tosAccepted + the lock-step legal-doc
        // bundle/source — appropriate when the user explicitly
        // back-navigated to ToS, but misleading during an abandonment
        // cascade (no user action targeted ToS). Letting back-nav
        // continue to SignupEmail.revert clears the whole ceremony via
        // _resetCeremonyKeys (which re-nulls tosAccepted +
        // legalDocumentBundle + legalDocumentSource alongside the rest
        // of the ceremony, and resets signupAbandoned), giving the user
        // a clean restart without emitting the misattributed event.
        if (store.session.signupAbandoned) return false;
        store.resetToS();
      },
      isWall: signupCommittedWall,
    },
    // 2d. Signup full name — renders only when the server included
    //     'full_name' in `required` AND the session doesn't already have
    //     a name (e.g. from `--full-name`).
    {
      screen: Screen.SignupFullName,
      show: (s) =>
        isCreateAccountOnboarding(s) &&
        requiresSignupField('full_name')(s) &&
        s.signupFullName === null,
      isComplete: (s) =>
        !isCreateAccountOnboarding(s) ||
        !requiresSignupField('full_name')(s) ||
        s.signupFullName !== null,
      // Same reasoning as ToS above: `isComplete` returns true via "I was
      // skipped" arms (no needs_information, server didn't ask for
      // full_name, or signupFullName never set). Calling
      // `setSignupFullName(null)` in those cases is a no-op that traps
      // back-nav. Return false so the walk continues to entries that can
      // actually do something.
      revert: (store) => {
        if (!isCreateAccountOnboarding(store.session)) return false;
        if (!requiresSignupField('full_name')(store.session)) return false;
        if (store.session.signupFullName === null) return false;
        // Walk past on abandonment: clearing signupFullName alone
        // leaves signupAbandoned=true, so the next forward pass
        // skips SigningUp (its show predicate gates on
        // !signupAbandoned) and lands the user back on Auth without
        // re-firing the POST. Continue back-walking to SignupEmail's
        // revert, which clears the whole ceremony via
        // _resetCeremonyKeys (resetting signupAbandoned too).
        if (store.session.signupAbandoned) return false;
        store.setSignupFullName(null);
      },
      isWall: signupCommittedWall,
    },
    // 3. Authenticate (SUSI for new users, silent login check for returning users).
    //    Skipped on error so auth-failure runs route directly to Outro.
    //
    //    Auth is complete when we have credentials AND the org + project are
    //    resolved. Env name is bonus — it can't always be determined (e.g.,
    //    manual API key entry), and the header renders 2 or 3 segments
    //    gracefully depending on what's known.
    //
    //    IDs count as a resolved identity too. If ampli.json has OrgId /
    //    WorkspaceId but fetchAmplitudeUser fails to hydrate the names (e.g.,
    //    transient network error), we'd otherwise deadlock on the Auth
    //    spinner. Accepting IDs as an alternative degrades header text but
    //    lets the flow continue.
    //
    //    Skipped while the user is in the inline create-project flow.
    {
      screen: Screen.Auth,
      show: (s) => s.runPhase !== RunPhase.Error && !s.createProject.pending,
      isComplete: (s) =>
        s.credentials !== null &&
        (s.selectedOrgName !== null || s.selectedOrgId !== null) &&
        (s.selectedProjectName !== null || s.selectedProjectId !== null) &&
        // Returning-user account confirmation. Blocks the gate until the
        // user explicitly confirms (or changes) the org/project that was
        // resolved silently from disk. Set in bin.ts when resolveCredentials
        // populates the session without going through the SUSI picker.
        !s.requiresAccountConfirmation &&
        // Env-picker race: when `resolveCredentials` returns
        // `needs_user_choice / environment_selection`,
        // `applyEnvSelectionDeferral` clears credentials AND sets this flag
        // so the router collapses back to Auth even if it already advanced
        // past Auth on a prior frame (rehydrated rerun state). Cleared by
        // AuthScreen once `setCredentials` lands the chosen env.
        !s.pendingEnvSelection &&
        // **Defense in depth** against the recurring "stuck on Setup with
        // no env-picker" bug (PRs #747 / #760 / #762 each thought they'd
        // fixed it; the bug kept reproducing). The `pendingEnvSelection`
        // flag above is the primary gate, but it has been getting
        // clobbered through paths that aren't fully understood. A SECOND
        // gate — derived directly from observable structural evidence on
        // the session — closes the bug regardless of which path clobbers
        // the flag.
        //
        // Specifically: when `resolveCredentials` returned
        // `needs_user_choice / environment_selection`, it ALSO populated
        // `session.pendingOrgs` with the (org, project, environments)
        // tuple, and `applyEnvSelectionDeferral` cleared
        // `session.selectedEnvName`. So the structural signature of the
        // "env still needs picking" state is:
        //   - `pendingOrgs` is non-null (the resolver populated it)
        //   - the resolved project has ≥ 2 environments with API keys
        //   - the user hasn't picked one yet (`selectedEnvName === null`)
        //
        // When that signature holds, Auth.isComplete MUST be false even
        // if `pendingEnvSelection` somehow flipped to false — otherwise
        // the router walks past Auth into the Setup-bucket screens with
        // no picker shown, which is exactly the bug users keep reporting.
        //
        // Carve-outs intentionally NOT added here:
        //   - Manual API key entry (`AuthScreen.handleApiKeySubmit`) sets
        //     `credentials.projectApiKey` to a user-supplied key WITHOUT
        //     populating `selectedEnvName`. That path is gated upstream by
        //     `setCredentials` being called BEFORE this predicate evaluates
        //     true, so by the time we'd block on `selectedEnvName === null`,
        //     `pendingEnvSelection` has already been cleared AND
        //     `credentials !== null` — but `pendingOrgs` for a manual-key
        //     path is null (the resolver landed at `'api_key_notice'`,
        //     not `'needs_user_choice'`). The `pendingOrgs !== null` guard
        //     below keeps the manual-key path passing through unchanged.
        !needsEnvPickStillRequired(s),
      // Back from DataSetup — drop the picked org/project/env so the
      // Auth screen re-renders the picker. Credentials stay so we don't
      // force a fresh OAuth round-trip.
      revert: (store) => {
        store.clearOrgAndProjectSelection();
      },
    },
    // 3b. Create-project interrupt. Shown when the user picks "Create new
    //     project…" from the Auth picker or runs /create-project. Sits
    //     between Auth and the data check so success routes directly to
    //     framework detection after `setCredentials()` fires.
    {
      screen: Screen.CreateProject,
      show: (s) =>
        s.runPhase !== RunPhase.Error &&
        s.createProject.pending &&
        // Hidden while the env-picker deferral is active — Auth is the only
        // legitimate screen until the user picks an env.
        !s.pendingEnvSelection,
      isComplete: (s) => !s.createProject.pending,
      // CreateProject is always "complete" for users who never entered it
      // (`!pending` is true by default), so we mark it transparent for
      // back-nav: revert returns false and the router walks past to the
      // previous *meaningful* step (Auth). Re-entering the creation form
      // mid-back is never useful — the user just wants to go further back.
      revert: () => false,
    },
    // 4. Data check — is the project already ingesting events?
    //    Hidden while `pendingEnvSelection` is active so the router collapses
    //    back to Auth for the env picker (see Auth entry above for the full
    //    bug story).
    {
      screen: Screen.DataSetup,
      show: (s) => !s.pendingEnvSelection,
      isComplete: (s) => s.projectHasData !== null,
      // Reset the activation result so the check re-runs after a back-nav.
      revert: (store) => {
        store.resetActivationCheck();
      },
    },
    // 3a. Activation options (SDK installed but few events — partial activation)
    {
      screen: Screen.ActivationOptions,
      show: (s) => s.activationLevel === 'partial' && !s.pendingEnvSelection,
      isComplete: (s) => s.activationOptionsComplete,
      revert: (store) => {
        store.resetActivationOptions();
      },
    },
    // 3b. Framework setup questions — skipped for full users (already have data)
    {
      screen: Screen.Setup,
      show: (s) =>
        needsSetup(s) && s.activationLevel !== 'full' && !s.pendingEnvSelection,
      isComplete: (s) => !needsSetup(s),
      // Pop the most recently-answered framework question. Returns false
      // when there's nothing user-answered to pop (e.g. every question was
      // auto-detected) so the router keeps walking back.
      revert: (store) => store.popLastFrameworkContextAnswer(),
    },
    // (PR 313 removed the FeatureOptIn screen — SR + G&S + autocapture
    //  are auto-enabled inline now, so there's no longer a separate
    //  picklist to back-navigate through here.)
    // 3c. Agent run — skipped for full users (already instrumented)
    //
    //  (No FeatureOptIn step here: SR + G&S + autocapture are
    //   auto-enabled inline as part of the unified SDK init. Users tune
    //   individual features by commenting out lines in their generated
    //   init code rather than via a wizard prompt.)
    {
      screen: Screen.Run,
      show: (s) => s.activationLevel !== 'full' && !s.pendingEnvSelection,
      isComplete: (s) =>
        s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
    },
    // 4. MCP server setup — skipped on error; full users go straight here
    {
      screen: Screen.Mcp,
      show: (s) => s.runPhase !== RunPhase.Error && !s.pendingEnvSelection,
      isComplete: (s) => s.mcpComplete,
      revert: (store) => {
        store.resetMcp();
      },
    },
    // 5. Wait for events — polls activation API until events are flowing.
    //    Passes immediately for full users (already have data) UNLESS
    //    `localInstrumentationComplete` is set (meaning the wizard
    //    pre-flighted to 'full' purely from on-disk signals — the
    //    remote project may not have any events yet, and the user
    //    expects to land here to verify their re-deploy is flowing).
    //    Skipped on error.
    {
      screen: Screen.DataIngestionCheck,
      show: (s) =>
        s.runPhase !== RunPhase.Error &&
        (s.activationLevel !== 'full' || s.localInstrumentationComplete) &&
        !s.pendingEnvSelection,
      isComplete: (s) => s.dataIngestionConfirmed,
      revert: (store) => {
        store.resetDataIngestion();
      },
    },
    // 6. Slack integration setup (skipped on error)
    {
      screen: Screen.Slack,
      show: (s) => s.runPhase !== RunPhase.Error && !s.pendingEnvSelection,
      isComplete: (s) => s.slackComplete,
      revert: (store) => {
        store.resetSlack();
      },
    },
    // Outro is the terminal screen of the Wizard flow. Hidden while
    // pendingEnvSelection is active so the router doesn't fall through to
    // it when every preceding entry is hidden — we want Auth to win
    // unconditionally while the env picker is pending.
    { screen: Screen.Outro, show: (s) => !s.pendingEnvSelection },
  ],

  [Flow.McpAdd]: [
    {
      screen: Screen.McpAdd,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.McpRemove]: [
    {
      screen: Screen.McpRemove,
      isComplete: (s) => s.mcpComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.SlackSetup]: [
    {
      screen: Screen.SlackSetup,
      isComplete: (s) => s.slackComplete,
    },
    { screen: Screen.Outro },
  ],

  [Flow.RegionSelect]: [
    {
      screen: Screen.RegionSelect,
      isComplete: (s) => s.region !== null && !s.regionForced,
    },
  ],
};
