/**
 * MCP-app capability lifecycle — transition validator + anti-nag invariant.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import {
  McpAppCapabilityKind,
  McpAppCapabilityState,
  McpAppCapabilitySchema,
  IllegalMcpTransitionError,
  canTransitionMcpCapability,
  asMcpAppCapabilityId,
} from '../mcp-app-lifecycle';

let cacheRoot: string;
let installDir: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'orch-mcp-'));
  installDir = mkdtempSync(join(tmpdir(), 'orch-mcp-install-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  _resetOrchestrationStoreCache();
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  _resetOrchestrationStoreCache();
});

describe('McpAppCapability schema', () => {
  it('round-trips a valid capability', () => {
    const c = {
      id: 'mcp_claude_code_install_abc123',
      kind: McpAppCapabilityKind.ClaudeCodeInstall,
      whyNeeded: 'editor needs MCP',
      whatItEnables: 'wizard tools in editor',
      required: false,
      consequenceIfSkipped: 'editor cannot call wizard tools',
      safeToSkip: true,
      state: McpAppCapabilityState.Available,
      userDecision: null,
      userDecisionAt: null,
      userDecisionResumeCommand: ['wizard', 'mcp', 'install'],
      reversible: true,
      lastStateChangeAt: new Date().toISOString(),
      lastStateChangeReason: null,
      linkedTaskId: null,
      linkedSessionId: 'session_abc',
    };
    expect(McpAppCapabilitySchema.parse(c)).toBeDefined();
  });
});

describe('canTransitionMcpCapability — legal transitions', () => {
  it('available -> needs_user_choice -> installed', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Available,
        McpAppCapabilityState.NeedsUserChoice,
      ),
    ).toBe(true);
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.NeedsUserChoice,
        McpAppCapabilityState.Installed,
      ),
    ).toBe(true);
  });
  it('needs_user_choice -> install_skipped', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.NeedsUserChoice,
        McpAppCapabilityState.InstallSkipped,
      ),
    ).toBe(true);
  });
  it('install_skipped -> needs_user_choice (with reason — store-level test)', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.InstallSkipped,
        McpAppCapabilityState.NeedsUserChoice,
      ),
    ).toBe(true);
  });
  it('failed can recover to needs_install / needs_user_choice / installed', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Failed,
        McpAppCapabilityState.NeedsInstall,
      ),
    ).toBe(true);
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Failed,
        McpAppCapabilityState.NeedsUserChoice,
      ),
    ).toBe(true);
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Failed,
        McpAppCapabilityState.Installed,
      ),
    ).toBe(true);
  });
});

describe('canTransitionMcpCapability — illegal transitions', () => {
  it('not_applicable is terminal', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.NotApplicable,
        McpAppCapabilityState.Available,
      ),
    ).toBe(false);
  });
  it('unavailable cannot leap straight to installed', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Unavailable,
        McpAppCapabilityState.Installed,
      ),
    ).toBe(false);
  });
  it('install_skipped cannot leap to needs_install (only via needs_user_choice)', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.InstallSkipped,
        McpAppCapabilityState.NeedsInstall,
      ),
    ).toBe(false);
  });
  it('identity transitions are illegal', () => {
    expect(
      canTransitionMcpCapability(
        McpAppCapabilityState.Available,
        McpAppCapabilityState.Available,
      ),
    ).toBe(false);
  });
});

describe('Anti-nag invariant — store.transitionMcpCapability', () => {
  it('install_skipped → needs_user_choice REQUIRES a non-empty reason', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const cap = store.addMcpCapability({
      kind: McpAppCapabilityKind.SlackApp,
      whyNeeded: 'send incident alerts',
      whatItEnables: 'slack alerts on PR open',
      required: false,
      consequenceIfSkipped: 'no slack alerts',
      safeToSkip: true,
      reversible: true,
      userDecisionResumeCommand: ['wizard', 'slack'],
      linkedSessionId: session.id,
    });
    // Move available -> needs_user_choice -> install_skipped.
    store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.NeedsUserChoice,
      'user opened slack screen',
    );
    store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.InstallSkipped,
      'user clicked skip',
    );
    expect(store.getMcpCapability(asMcpAppCapabilityId(cap.id))?.state).toBe(
      McpAppCapabilityState.InstallSkipped,
    );

    // Re-asking without a reason: anti-nag violation.
    expect(() =>
      store.transitionMcpCapability(
        asMcpAppCapabilityId(cap.id),
        McpAppCapabilityState.NeedsUserChoice,
        null,
      ),
    ).toThrow(IllegalMcpTransitionError);
    // Empty-string reason also violates.
    expect(() =>
      store.transitionMcpCapability(
        asMcpAppCapabilityId(cap.id),
        McpAppCapabilityState.NeedsUserChoice,
        '   ',
      ),
    ).toThrow(IllegalMcpTransitionError);
  });

  it('install_skipped → needs_user_choice succeeds with an explicit reason', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const cap = store.addMcpCapability({
      kind: McpAppCapabilityKind.GithubApp,
      whyNeeded: 'review PRs',
      whatItEnables: 'PR-aware integration',
      required: false,
      consequenceIfSkipped: 'wizard cannot read PRs',
      safeToSkip: true,
      reversible: true,
      userDecisionResumeCommand: ['wizard', 'mcp', 'install', 'github'],
      linkedSessionId: session.id,
    });
    store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.NeedsUserChoice,
      'initial prompt',
    );
    store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.InstallSkipped,
      'user skipped',
    );
    const reAsked = store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.NeedsUserChoice,
      'event plan now requires PR-aware setup; re-asking with justification',
    );
    expect(reAsked.state).toBe(McpAppCapabilityState.NeedsUserChoice);
    expect(reAsked.lastStateChangeReason).toMatch(/event plan/);
  });
});

describe('OrchestrationStore — MCP capability CRUD', () => {
  it('records userDecision on Installed/InstallSkipped transitions', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const cap = store.addMcpCapability({
      kind: McpAppCapabilityKind.CursorInstall,
      whyNeeded: 'editor MCP',
      whatItEnables: 'cursor uses wizard tools',
      required: false,
      consequenceIfSkipped: 'cursor cannot call wizard',
      safeToSkip: true,
      reversible: true,
      userDecisionResumeCommand: ['wizard', 'mcp', 'install'],
      linkedSessionId: session.id,
    });
    store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.NeedsUserChoice,
      'user reached install screen',
    );
    const installed = store.transitionMcpCapability(
      asMcpAppCapabilityId(cap.id),
      McpAppCapabilityState.Installed,
      'user clicked install',
    );
    expect(installed.userDecision).toBe('installed');
    expect(installed.userDecisionAt).not.toBeNull();
  });
});
