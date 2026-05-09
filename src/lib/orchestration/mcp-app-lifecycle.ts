/**
 * MCP-app capability lifecycle.
 *
 * The wizard has long had ad-hoc per-tool install logic spread across
 * `src/steps/mcp-*` and `src/lib/wizard-tools.ts`. This module ADDS a
 * durable lifecycle record for each MCP-app capability without touching
 * the existing install code. The PR 1 → PR 3 plan is:
 *
 *   - PR 2 (this): introduce the lifecycle state machine + storage. The
 *     existing install code keeps working untouched.
 *   - PR 3: retire the duplicate state in `wizard-mcp-server.ts` and the
 *     TUI screens, and have those callers read from this lifecycle as
 *     the source of truth.
 *
 * Why a state machine: the wizard repeatedly bothered the user about
 * MCP installs they had explicitly skipped, because "skipped" was a
 * negative space (absence of a record) rather than an explicit state
 * with a `userDecision`. The legal-transitions table here enforces an
 * **anti-nag invariant**: once a capability is in `install_skipped` with
 * a `userDecision`, the only legal way to revisit `needs_user_choice` is
 * to provide an explicit `lastStateChangeReason` explaining why the user
 * needs to be asked again (e.g. "skipped Slack later became required
 * because the event plan needs Slack notifications"). The transition
 * validator throws when the reason is missing.
 *
 * This is a state machine, NOT a UI controller. Higher-level callers
 * (PR 3 TUI) read `state` and decide what to render; this module never
 * renders.
 */
import { z } from 'zod';

import { SessionIdSchema, TaskIdSchema } from './id-schemas';
import type { SessionId, TaskId } from './state';

// ── Enums ────────────────────────────────────────────────────────────

export const McpAppCapabilityKind = {
  ClaudeCodeInstall: 'claude_code_install',
  CursorInstall: 'cursor_install',
  CodexInstall: 'codex_install',
  SlackApp: 'slack_app',
  VscodeInstall: 'vscode_install',
  GithubApp: 'github_app',
  AmplitudeMcpHttp: 'amplitude_mcp_http',
  WizardToolsInproc: 'wizard_tools_inproc',
  Other: 'other',
} as const;
export type McpAppCapabilityKind =
  (typeof McpAppCapabilityKind)[keyof typeof McpAppCapabilityKind];

export const McpAppCapabilityState = {
  Unavailable: 'unavailable',
  Available: 'available',
  NeedsAuth: 'needs_auth',
  NeedsInstall: 'needs_install',
  NeedsUserChoice: 'needs_user_choice',
  InstallSkipped: 'install_skipped',
  Installed: 'installed',
  Failed: 'failed',
  NotApplicable: 'not_applicable',
} as const;
export type McpAppCapabilityState =
  (typeof McpAppCapabilityState)[keyof typeof McpAppCapabilityState];

export const McpUserDecision = {
  Installed: 'installed',
  Skipped: 'skipped',
  Pending: 'pending',
} as const;
export type McpUserDecision =
  (typeof McpUserDecision)[keyof typeof McpUserDecision];

const TERMINAL_MCP_STATES = new Set<McpAppCapabilityState>([
  McpAppCapabilityState.NotApplicable,
]);

// ── Schemas ──────────────────────────────────────────────────────────

export const McpAppCapabilityIdSchema = z
  .string()
  .regex(/^mcp_[a-z_]+_[A-Za-z0-9_-]+$/, 'expected mcp_<kind>_<id>');

export const McpAppCapabilityKindSchema = z.enum([
  McpAppCapabilityKind.ClaudeCodeInstall,
  McpAppCapabilityKind.CursorInstall,
  McpAppCapabilityKind.CodexInstall,
  McpAppCapabilityKind.SlackApp,
  McpAppCapabilityKind.VscodeInstall,
  McpAppCapabilityKind.GithubApp,
  McpAppCapabilityKind.AmplitudeMcpHttp,
  McpAppCapabilityKind.WizardToolsInproc,
  McpAppCapabilityKind.Other,
]);

export const McpAppCapabilityStateSchema = z.enum([
  McpAppCapabilityState.Unavailable,
  McpAppCapabilityState.Available,
  McpAppCapabilityState.NeedsAuth,
  McpAppCapabilityState.NeedsInstall,
  McpAppCapabilityState.NeedsUserChoice,
  McpAppCapabilityState.InstallSkipped,
  McpAppCapabilityState.Installed,
  McpAppCapabilityState.Failed,
  McpAppCapabilityState.NotApplicable,
]);

export const McpUserDecisionSchema = z.enum([
  McpUserDecision.Installed,
  McpUserDecision.Skipped,
  McpUserDecision.Pending,
]);

export const McpAppCapabilitySchema = z.object({
  id: McpAppCapabilityIdSchema,
  kind: McpAppCapabilityKindSchema,
  whyNeeded: z.string().min(1),
  whatItEnables: z.string().min(1),
  required: z.boolean(),
  consequenceIfSkipped: z.string(),
  safeToSkip: z.boolean(),
  state: McpAppCapabilityStateSchema,
  userDecision: McpUserDecisionSchema.nullable(),
  /** ISO-8601 timestamps. */
  userDecisionAt: z.string().nullable(),
  userDecisionResumeCommand: z.array(z.string()),
  /** Whether the user can revisit this decision later. */
  reversible: z.boolean(),
  lastStateChangeAt: z.string(),
  /**
   * Reason for the most recent state transition. Required by the
   * transition validator when re-asking a previously-skipped capability
   * (anti-nag invariant — see module header).
   */
  lastStateChangeReason: z.string().nullable(),
  linkedTaskId: TaskIdSchema.nullable(),
  linkedSessionId: SessionIdSchema,
});

// ── TS types ─────────────────────────────────────────────────────────

export type McpAppCapabilityId = `mcp_${string}`;
export type McpAppCapability = z.infer<typeof McpAppCapabilitySchema>;

export function asMcpAppCapabilityId(raw: string): McpAppCapabilityId {
  if (!raw.startsWith('mcp_')) {
    throw new Error(`Expected mcp_<kind>_<id>, got '${raw}'`);
  }
  return raw as McpAppCapabilityId;
}

export interface AddMcpCapabilityInput {
  kind: McpAppCapabilityKind;
  whyNeeded: string;
  whatItEnables: string;
  required: boolean;
  consequenceIfSkipped: string;
  safeToSkip: boolean;
  initialState?: McpAppCapabilityState;
  reversible: boolean;
  userDecisionResumeCommand: string[];
  linkedTaskId?: TaskId | null;
  linkedSessionId: SessionId;
  lastStateChangeReason?: string | null;
}

// ── Transition validator ─────────────────────────────────────────────
//
// The legal-transitions matrix is intentionally explicit so adding a
// new state requires a deliberate edit (and a new test row in
// `mcp-app-lifecycle.test.ts`). Keep it close to the documented surface
// in `docs/orchestration.md`.
//
//   unavailable        → available, not_applicable
//   available          → needs_auth, needs_install, needs_user_choice,
//                        installed, failed, not_applicable
//   needs_auth         → available, needs_user_choice, needs_install,
//                        installed, install_skipped, failed
//   needs_install      → needs_user_choice, installed, install_skipped, failed
//   needs_user_choice  → installed, install_skipped, failed, needs_auth
//   install_skipped    → needs_user_choice (REQUIRES `lastStateChangeReason`),
//                        installed (operator re-installs out of band)
//   installed          → needs_auth, needs_install, failed, not_applicable
//   failed             → needs_user_choice, needs_install, needs_auth,
//                        install_skipped, installed
//   not_applicable     → (terminal)

const ALLOWED_MCP_TRANSITIONS: ReadonlyMap<
  McpAppCapabilityState,
  ReadonlySet<McpAppCapabilityState>
> = new Map<McpAppCapabilityState, ReadonlySet<McpAppCapabilityState>>([
  [
    McpAppCapabilityState.Unavailable,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.Available,
      McpAppCapabilityState.NotApplicable,
    ]),
  ],
  [
    McpAppCapabilityState.Available,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.NeedsAuth,
      McpAppCapabilityState.NeedsInstall,
      McpAppCapabilityState.NeedsUserChoice,
      McpAppCapabilityState.Installed,
      McpAppCapabilityState.Failed,
      McpAppCapabilityState.NotApplicable,
    ]),
  ],
  [
    McpAppCapabilityState.NeedsAuth,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.Available,
      McpAppCapabilityState.NeedsUserChoice,
      McpAppCapabilityState.NeedsInstall,
      McpAppCapabilityState.Installed,
      McpAppCapabilityState.InstallSkipped,
      McpAppCapabilityState.Failed,
    ]),
  ],
  [
    McpAppCapabilityState.NeedsInstall,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.NeedsUserChoice,
      McpAppCapabilityState.Installed,
      McpAppCapabilityState.InstallSkipped,
      McpAppCapabilityState.Failed,
    ]),
  ],
  [
    McpAppCapabilityState.NeedsUserChoice,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.Installed,
      McpAppCapabilityState.InstallSkipped,
      McpAppCapabilityState.Failed,
      McpAppCapabilityState.NeedsAuth,
    ]),
  ],
  [
    McpAppCapabilityState.InstallSkipped,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.NeedsUserChoice,
      McpAppCapabilityState.Installed,
    ]),
  ],
  [
    McpAppCapabilityState.Installed,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.NeedsAuth,
      McpAppCapabilityState.NeedsInstall,
      McpAppCapabilityState.Failed,
      McpAppCapabilityState.NotApplicable,
    ]),
  ],
  [
    McpAppCapabilityState.Failed,
    new Set<McpAppCapabilityState>([
      McpAppCapabilityState.NeedsUserChoice,
      McpAppCapabilityState.NeedsInstall,
      McpAppCapabilityState.NeedsAuth,
      McpAppCapabilityState.InstallSkipped,
      McpAppCapabilityState.Installed,
    ]),
  ],
]);

export function canTransitionMcpCapability(
  from: McpAppCapabilityState,
  to: McpAppCapabilityState,
): boolean {
  if (from === to) return false;
  if (TERMINAL_MCP_STATES.has(from)) return false;
  return ALLOWED_MCP_TRANSITIONS.get(from)?.has(to) ?? false;
}

export class IllegalMcpTransitionError extends Error {
  readonly capabilityId: string;
  readonly from: McpAppCapabilityState;
  readonly to: McpAppCapabilityState;
  readonly antiNagViolation: boolean;
  constructor(
    capabilityId: string,
    from: McpAppCapabilityState,
    to: McpAppCapabilityState,
    options?: { antiNagViolation?: boolean },
  ) {
    const reason = options?.antiNagViolation
      ? `MCP capability ${capabilityId}: anti-nag invariant violated. ` +
        `Re-asking a previously-skipped capability requires an explicit ` +
        `lastStateChangeReason explaining why the user must be re-prompted.`
      : `MCP capability ${capabilityId}: illegal state transition ` +
        `'${from}' -> '${to}'.`;
    super(reason);
    this.name = 'IllegalMcpTransitionError';
    this.capabilityId = capabilityId;
    this.from = from;
    this.to = to;
    this.antiNagViolation = options?.antiNagViolation ?? false;
  }
}

/**
 * Throws if the transition is illegal OR if the transition is the
 * "skipped → needs_user_choice" arc and `reason` is missing/blank.
 *
 * The anti-nag check covers the case where a capability the user
 * deliberately skipped is being re-presented. The system MUST justify
 * the re-prompt; otherwise the user has no way to distinguish "a real
 * dependency change made this required again" from "the wizard forgot
 * I said no". A blank-string reason fails the same way as an undefined
 * reason — orchestrators that "log a reason" by passing `''` would
 * otherwise bypass the invariant.
 */
export function assertMcpTransition(
  capabilityId: string,
  from: McpAppCapabilityState,
  to: McpAppCapabilityState,
  reason: string | null | undefined,
): void {
  if (!canTransitionMcpCapability(from, to)) {
    throw new IllegalMcpTransitionError(capabilityId, from, to);
  }
  // Anti-nag invariant.
  if (
    from === McpAppCapabilityState.InstallSkipped &&
    to === McpAppCapabilityState.NeedsUserChoice &&
    (reason === null || reason === undefined || reason.trim() === '')
  ) {
    throw new IllegalMcpTransitionError(capabilityId, from, to, {
      antiNagViolation: true,
    });
  }
}
