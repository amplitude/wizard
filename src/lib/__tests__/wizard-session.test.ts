import { describe, it, expect } from 'vitest';
import {
  buildSession,
  RunPhase,
  AppIdSchema,
  WorkspaceIdSchema,
  toAppId,
  toWorkspaceId,
  tryToAppId,
  isAuthenticated,
  isConfigured,
  isRunning,
  type WizardSession,
} from '../wizard-session.js';

// ── buildSession / parseAppIdArg ──────────────────────────────────────────

describe('buildSession', () => {
  it('uses sensible defaults when called with no args', () => {
    const session = buildSession({});
    expect(session.debug).toBe(false);
    expect(session.ci).toBe(false);
    expect(session.region).toBeNull();
    expect(session.credentials).toBeNull();
    expect(session.runPhase).toBe(RunPhase.Idle);
    expect(session.introConcluded).toBe(false);
    expect(session.appId).toBeUndefined();
  });

  it('passes through known args', () => {
    const session = buildSession({
      debug: true,
      ci: true,
      installDir: '/tmp/foo',
    });
    expect(session.debug).toBe(true);
    expect(session.ci).toBe(true);
    expect(session.installDir).toBe('/tmp/foo');
  });

  it('generates a unique UUID v4 agentSessionId per session', () => {
    const a = buildSession({});
    const b = buildSession({});

    // RFC 4122 UUID v4 — 8-4-4-4-12 hex with version nibble = 4
    const UUID_V4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(a.agentSessionId).toMatch(UUID_V4);
    expect(b.agentSessionId).toMatch(UUID_V4);
    expect(a.agentSessionId).not.toBe(b.agentSessionId);
  });

  // ── parseAppIdArg (exercised via buildSession appId) ────────────────

  it('parses a valid positive integer string as appId', () => {
    expect(buildSession({ appId: '42' }).appId).toBe(42);
  });

  it('parses "1" as appId', () => {
    expect(buildSession({ appId: '1' }).appId).toBe(1);
  });

  it('returns undefined appId for non-numeric string', () => {
    expect(buildSession({ appId: 'abc' }).appId).toBeUndefined();
  });

  it('returns undefined appId for empty string', () => {
    expect(buildSession({ appId: '' }).appId).toBeUndefined();
  });

  it('returns undefined appId for zero', () => {
    expect(buildSession({ appId: '0' }).appId).toBeUndefined();
  });

  it('returns undefined appId for negative integer', () => {
    expect(buildSession({ appId: '-5' }).appId).toBeUndefined();
  });

  it('returns undefined appId for non-integer float', () => {
    expect(buildSession({ appId: '1.5' }).appId).toBeUndefined();
  });

  it('returns undefined when appId arg is omitted', () => {
    expect(buildSession({}).appId).toBeUndefined();
  });
});

// ── signup profile fields ─────────────────────────────────────────────────────

describe('buildSession signup profile fields', () => {
  it('defaults signupEmail and signupFullName to null', () => {
    const s = buildSession({});
    expect(s.signupEmail).toBeNull();
    expect(s.signupFullName).toBeNull();
  });

  it('accepts signupEmail and signupFullName from options', () => {
    const s = buildSession({
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
    });
    expect(s.signupEmail).toBe('ada@example.com');
    expect(s.signupFullName).toBe('Ada Lovelace');
  });
});

// ── Branded ID schemas / helpers ──────────────────────────────────────────

describe('AppIdSchema / toAppId', () => {
  it('parses a positive integer as a branded AppId', () => {
    const v = toAppId(42);
    // The brand is structural — the runtime value is still the raw number.
    expect(v).toBe(42);
    // Round-tripping through the schema is idempotent.
    expect(AppIdSchema.parse(42)).toBe(42);
  });

  it('rejects zero', () => {
    expect(() => toAppId(0)).toThrow();
  });

  it('rejects negative numbers', () => {
    expect(() => toAppId(-1)).toThrow();
  });

  it('rejects non-integers', () => {
    expect(() => toAppId(1.5)).toThrow();
  });
});

describe('tryToAppId', () => {
  it('returns the branded value for a valid string', () => {
    expect(tryToAppId('42')).toBe(42);
  });

  it('returns the branded value for a valid number', () => {
    expect(tryToAppId(42)).toBe(42);
  });

  it.each([null, undefined, '', '0', '-5', '1.5', 'abc'])(
    'returns undefined for invalid input %p',
    (input) => {
      expect(tryToAppId(input)).toBeUndefined();
    },
  );
});

describe('WorkspaceIdSchema / toWorkspaceId', () => {
  it('parses a non-empty string as a branded WorkspaceId', () => {
    const v = toWorkspaceId('0adfd673-c53b-462c-bf88-84c7605286a4');
    expect(v).toBe('0adfd673-c53b-462c-bf88-84c7605286a4');
    expect(WorkspaceIdSchema.parse('ws-1')).toBe('ws-1');
  });

  it('rejects empty strings', () => {
    expect(() => toWorkspaceId('')).toThrow();
  });
});

// ── RunPhase type guards ─────────────────────────────────────────────────

function emptySession(overrides: Partial<WizardSession> = {}): WizardSession {
  return { ...buildSession({}), ...overrides };
}

const VALID_CREDS: NonNullable<WizardSession['credentials']> = {
  accessToken: 'tok',
  projectApiKey: 'pk',
  host: 'https://app.amplitude.com',
  appId: 1,
};

describe('isAuthenticated', () => {
  it('returns false for a fresh session', () => {
    expect(isAuthenticated(emptySession())).toBe(false);
  });

  it('returns false when credentials are present but no orgId', () => {
    const s = emptySession({ credentials: VALID_CREDS, selectedOrgId: null });
    expect(isAuthenticated(s)).toBe(false);
  });

  it('returns false when orgId is present but credentials are null', () => {
    const s = emptySession({ credentials: null, selectedOrgId: 'org-1' });
    expect(isAuthenticated(s)).toBe(false);
  });

  it('returns true when both credentials and orgId are set', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
    });
    expect(isAuthenticated(s)).toBe(true);
    if (isAuthenticated(s)) {
      // Type narrowing: credentials is non-null inside the guard.
      expect(s.credentials.host).toBe('https://app.amplitude.com');
    }
  });

  it('un-narrows correctly: returns false after credentials are cleared', () => {
    // Set up an authenticated session and confirm the guard narrows.
    let s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
    });
    expect(isAuthenticated(s)).toBe(true);

    // Simulate logout / token expiry: clear credentials. The guard must
    // re-evaluate to false on the new session — callers that re-checked
    // after a state change should not still see the narrowed type.
    s = { ...s, credentials: null };
    expect(isAuthenticated(s)).toBe(false);
  });
});

describe('isConfigured', () => {
  it('returns false without a project id', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: null,
      region: 'us',
    });
    expect(isConfigured(s)).toBe(false);
  });

  it('returns false without a region', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: 'ws-1',
      region: null,
    });
    expect(isConfigured(s)).toBe(false);
  });

  it('returns true once auth + project + region are all set', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: 'ws-1',
      region: 'us',
    });
    expect(isConfigured(s)).toBe(true);
  });
});

describe('isRunning', () => {
  it('returns false in Idle phase', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: 'ws-1',
      region: 'us',
      runPhase: RunPhase.Idle,
    });
    expect(isRunning(s)).toBe(false);
  });

  it('returns true once Running with integration + start time', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: 'ws-1',
      region: 'us',
      runPhase: RunPhase.Running,
      // integration values are framework strings; test uses a known one
      integration: 'nextjs' as WizardSession['integration'],
      runStartedAt: Date.now(),
    });
    expect(isRunning(s)).toBe(true);
  });

  it('returns false in Running phase but with no integration', () => {
    const s = emptySession({
      credentials: VALID_CREDS,
      selectedOrgId: 'org-1',
      selectedProjectId: 'ws-1',
      region: 'us',
      runPhase: RunPhase.Running,
      integration: null,
      runStartedAt: Date.now(),
    });
    expect(isRunning(s)).toBe(false);
  });
});
