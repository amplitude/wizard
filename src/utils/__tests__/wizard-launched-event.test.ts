/**
 * Unit tests for the `wizard launched` root-event property bag.
 *
 * Focus: prove the sensitive-field redaction policy holds (PII never leaks
 * into properties, only presence booleans and the email domain do) and the
 * subcommand / positional / nested-agent plumbing produces the expected
 * values.
 */

import { describe, it, expect } from 'vitest';
import type { Arguments } from 'yargs';
import {
  emailDomainFromArg,
  wizardLaunchedProperties,
} from '../wizard-launched-event';

function argv(extra: Record<string, unknown> = {}): Arguments {
  return {
    _: [],
    $0: 'wizard',
    ...extra,
  } as unknown as Arguments;
}

/**
 * Empty env shared across most tests so the host shell's `CI`,
 * `DO_NOT_TRACK`, etc. don't leak into assertions. Tests that exercise
 * the env-var capture pass a populated object explicitly.
 */
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('emailDomainFromArg', () => {
  it('returns lowercase domain for a valid email', () => {
    expect(emailDomainFromArg('user@example.com')).toBe('example.com');
  });

  it('lowercases mixed-case domains', () => {
    expect(emailDomainFromArg('USER@EXAMPLE.COM')).toBe('example.com');
  });

  it('uses lastIndexOf so multi-@ inputs resolve to the trailing domain', () => {
    expect(emailDomainFromArg('a@b@c.com')).toBe('c.com');
  });

  it('returns null for missing input', () => {
    expect(emailDomainFromArg(undefined)).toBeNull();
    expect(emailDomainFromArg(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(emailDomainFromArg('')).toBeNull();
  });

  it('returns null when no @ is present', () => {
    expect(emailDomainFromArg('not-an-email')).toBeNull();
  });

  it('returns null when @ is the first character', () => {
    expect(emailDomainFromArg('@example.com')).toBeNull();
  });

  it('returns null when @ is the last character', () => {
    expect(emailDomainFromArg('user@')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(emailDomainFromArg(42)).toBeNull();
    expect(emailDomainFromArg({})).toBeNull();
    expect(emailDomainFromArg([])).toBeNull();
  });
});

describe('wizardLaunchedProperties — defaults', () => {
  it('reports subcommand=default when no positional is present', () => {
    const props = wizardLaunchedProperties(argv(), false, EMPTY_ENV);
    expect(props.subcommand).toBe('default');
  });

  it('reports all boolean flags false when argv is empty', () => {
    const props = wizardLaunchedProperties(argv(), false, EMPTY_ENV);
    expect(props.debug).toBe(false);
    expect(props.verbose).toBe(false);
    expect(props.ci).toBe(false);
    expect(props.agent).toBe(false);
    expect(props.yes).toBe(false);
    expect(props.force).toBe(false);
    expect(props.json).toBe(false);
    expect(props.human).toBe(false);
    expect(props['auto approve']).toBe(false);
    expect(props['accept tos']).toBe(false);
    expect(props['confirm app']).toBe(false);
    expect(props.signup).toBe(false);
    expect(props['local mcp']).toBe(false);
    expect(props.dev).toBe(false);
  });

  it('reports `no defaults` as false when --default is unset or true', () => {
    expect(
      wizardLaunchedProperties(argv(), false, EMPTY_ENV)['no defaults'],
    ).toBe(false);
    expect(
      wizardLaunchedProperties(argv({ default: true }), false, EMPTY_ENV)[
        'no defaults'
      ],
    ).toBe(false);
  });

  it('reports `no defaults` as true ONLY when --no-default was passed', () => {
    expect(
      wizardLaunchedProperties(argv({ default: false }), false, EMPTY_ENV)[
        'no defaults'
      ],
    ).toBe(true);
  });

  it('reports nested agent from the parameter, not from argv', () => {
    expect(
      wizardLaunchedProperties(argv(), false, EMPTY_ENV)['nested agent'],
    ).toBe(false);
    expect(
      wizardLaunchedProperties(argv(), true, EMPTY_ENV)['nested agent'],
    ).toBe(true);
  });
});

describe('wizardLaunchedProperties — subcommand detection', () => {
  it('reports the first string positional as the subcommand', () => {
    expect(
      wizardLaunchedProperties(argv({ _: ['login'] }), false, EMPTY_ENV)
        .subcommand,
    ).toBe('login');
  });

  it('falls back to default for numeric positionals', () => {
    expect(
      wizardLaunchedProperties(argv({ _: [42] }), false, EMPTY_ENV).subcommand,
    ).toBe('default');
  });

  it('uses only the first positional', () => {
    expect(
      wizardLaunchedProperties(
        argv({ _: ['mcp', 'install'] }),
        false,
        EMPTY_ENV,
      ).subcommand,
    ).toBe('mcp');
  });
});

describe('wizardLaunchedProperties — boolean pass-through', () => {
  it('passes true booleans through', () => {
    const props = wizardLaunchedProperties(
      argv({ ci: true, agent: true, debug: true }),
      false,
      EMPTY_ENV,
    );
    expect(props.ci).toBe(true);
    expect(props.agent).toBe(true);
    expect(props.debug).toBe(true);
  });

  it('coerces non-true booleans to false (no truthy coercion)', () => {
    const props = wizardLaunchedProperties(
      argv({ ci: 'true', agent: 1, debug: 'yes' }),
      false,
      EMPTY_ENV,
    );
    expect(props.ci).toBe(false);
    expect(props.agent).toBe(false);
    expect(props.debug).toBe(false);
  });
});

describe('wizardLaunchedProperties — enumerated strings', () => {
  it('passes auth-onboarding value through', () => {
    expect(
      wizardLaunchedProperties(
        argv({ 'auth-onboarding': 'create-account' }),
        false,
        EMPTY_ENV,
      )['auth onboarding'],
    ).toBe('create-account');
  });

  it('reports null for empty strings', () => {
    expect(
      wizardLaunchedProperties(
        argv({ 'auth-onboarding': '' }),
        false,
        EMPTY_ENV,
      )['auth onboarding'],
    ).toBeNull();
  });

  it('reports null when unset', () => {
    expect(
      wizardLaunchedProperties(argv(), false, EMPTY_ENV)['auth onboarding'],
    ).toBeNull();
  });
});

describe('wizardLaunchedProperties — sensitive-field redaction', () => {
  it('reports api key presence but never the value', () => {
    const props = wizardLaunchedProperties(
      argv({ 'api-key': 'secret-amplitude-key-xxx' }),
      false,
      EMPTY_ENV,
    );
    expect(props['api key provided']).toBe(true);
    expect(JSON.stringify(props)).not.toContain('secret-amplitude-key-xxx');
  });

  it('reports token presence but never the value', () => {
    const props = wizardLaunchedProperties(
      argv({ token: 'eyJhbGciOi.SECRET.signature' }),
      false,
      EMPTY_ENV,
    );
    expect(props['token provided']).toBe(true);
    expect(JSON.stringify(props)).not.toContain('eyJhbGciOi.SECRET');
  });

  it('reports full-name presence but never the value', () => {
    const props = wizardLaunchedProperties(
      argv({ 'full-name': 'Jane Doe' }),
      false,
      EMPTY_ENV,
    );
    expect(props['full name provided']).toBe(true);
    expect(JSON.stringify(props)).not.toContain('Jane Doe');
  });

  it('reports email presence + domain but never the local-part', () => {
    const props = wizardLaunchedProperties(
      argv({ email: 'private.local-part@amplitude.com' }),
      false,
      EMPTY_ENV,
    );
    expect(props['email provided']).toBe(true);
    expect(props['email domain']).toBe('amplitude.com');
    expect(JSON.stringify(props)).not.toContain('private.local-part');
  });

  it('reports path presence but never the value', () => {
    const props = wizardLaunchedProperties(
      argv({
        'install-dir': '/Users/jane/projects/secret',
        'cache-dir': '/Users/jane/.cache',
        log: '/Users/jane/wizard.log',
        context: '/Users/jane/.config/orchestrator.json',
        'plan-id': 'plan-abc-123',
      }),
      false,
      EMPTY_ENV,
    );
    expect(props['install dir provided']).toBe(true);
    expect(props['cache dir provided']).toBe(true);
    expect(props['log path provided']).toBe(true);
    expect(props['context path provided']).toBe(true);
    expect(props['plan id provided']).toBe(true);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('/Users/jane');
    expect(serialized).not.toContain('plan-abc-123');
  });

  it('reports targeting-flag presence but never the value', () => {
    const props = wizardLaunchedProperties(
      argv({
        'app-id': 'app-12345',
        'app-name': 'My Cool Project',
        'project-id': 'proj-uuid-aaa',
        'workspace-id': 'ws-uuid-bbb',
        org: 'Acme Corp',
        env: 'production',
      }),
      false,
      EMPTY_ENV,
    );
    expect(props['app id provided']).toBe(true);
    expect(props['app name provided']).toBe(true);
    expect(props['project id provided']).toBe(true);
    expect(props['workspace id provided']).toBe(true);
    expect(props['org provided']).toBe(true);
    expect(props['env provided']).toBe(true);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('My Cool Project');
    expect(serialized).not.toContain('Acme Corp');
    expect(serialized).not.toContain('proj-uuid-aaa');
  });
});

describe('wizardLaunchedProperties — email edge cases', () => {
  it('flags malformed emails as present but with null domain', () => {
    const props = wizardLaunchedProperties(
      argv({ email: 'not-an-email' }),
      false,
      EMPTY_ENV,
    );
    expect(props['email provided']).toBe(true);
    expect(props['email domain']).toBeNull();
  });

  it('treats empty-string email as absent', () => {
    const props = wizardLaunchedProperties(
      argv({ email: '' }),
      false,
      EMPTY_ENV,
    );
    expect(props['email provided']).toBe(false);
    expect(props['email domain']).toBeNull();
  });
});

describe('wizardLaunchedProperties — internal env-var passthroughs', () => {
  it('reports presence for benchmark + event-plan env-var shadows', () => {
    const props = wizardLaunchedProperties(
      argv({
        'event-plan-decision': 'accept',
        'event-plan-feedback': 'looks good',
        'benchmark-file': '/tmp/bench.json',
        'benchmark-config': '/tmp/cfg.json',
        'log-file': '/tmp/wizard.log',
      }),
      false,
      EMPTY_ENV,
    );
    expect(props['event plan decision provided']).toBe(true);
    expect(props['event plan feedback provided']).toBe(true);
    expect(props['benchmark file provided']).toBe(true);
    expect(props['benchmark config provided']).toBe(true);
    expect(props['log file provided']).toBe(true);
    expect(JSON.stringify(props)).not.toContain('looks good');
    expect(JSON.stringify(props)).not.toContain('/tmp');
  });

  it('reports presence false when env-var shadows are unset', () => {
    const props = wizardLaunchedProperties(argv(), false, EMPTY_ENV);
    expect(props['event plan decision provided']).toBe(false);
    expect(props['event plan feedback provided']).toBe(false);
    expect(props['benchmark file provided']).toBe(false);
    expect(props['benchmark config provided']).toBe(false);
    expect(props['log file provided']).toBe(false);
  });
});

describe('wizardLaunchedProperties — undocumented env-var capture', () => {
  it('reports every env-var property as false / null when env is empty', () => {
    const props = wizardLaunchedProperties(argv(), false, EMPTY_ENV);
    expect(props['allow nested env']).toBe(false);
    expect(props['gateway sanitize off env']).toBe(false);
    expect(props['no update check env']).toBe(false);
    expect(props['no theme env']).toBe(false);
    expect(props['data api url override env']).toBe(false);
    expect(props['ingestion host override env']).toBe(false);
    expect(props['signup url override env']).toBe(false);
    expect(props['amplitude server url override env']).toBe(false);
    expect(props['amplitude api key env']).toBe(false);
    expect(props['mcp tool filter env']).toBeNull();
    expect(props['builtin tool filter env']).toBeNull();
    expect(props['max turns env']).toBeNull();
  });

  it('does NOT expose the telemetry opt-out env vars as properties', () => {
    // Existing wizard analytics events ignore DO_NOT_TRACK /
    // AMPLITUDE_WIZARD_NO_TELEMETRY (sentry honors them, the analytics SDK
    // does not). Surfacing them as properties would be a new signal no
    // other event tracks — out of scope for this PR. Lock the omission so
    // a future contributor doesn't re-introduce them by mistake.
    const props = wizardLaunchedProperties(argv(), false, {
      DO_NOT_TRACK: '1',
      AMPLITUDE_WIZARD_NO_TELEMETRY: '1',
    });
    expect(props).not.toHaveProperty('do not track env');
    expect(props).not.toHaveProperty('no telemetry env');
  });

  it('captures AMPLITUDE_WIZARD_ALLOW_NESTED as presence (any value)', () => {
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_ALLOW_NESTED: '1',
      })['allow nested env'],
    ).toBe(true);
    // Any non-empty value counts as set — matches the bypass semantics.
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_ALLOW_NESTED: 'yes',
      })['allow nested env'],
    ).toBe(true);
    // Empty string is not presence.
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_ALLOW_NESTED: '',
      })['allow nested env'],
    ).toBe(false);
  });

  it('matches AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH=0 (off semantics)', () => {
    // The consumer in register-gateway-fetch-sanitize.ts uses `=== '0'` to
    // mean "disable". Funnel must report the same to stay accurate.
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH: '0',
      })['gateway sanitize off env'],
    ).toBe(true);
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH: '1',
      })['gateway sanitize off env'],
    ).toBe(false);
  });

  it('captures URL / endpoint overrides as presence only, not values', () => {
    const props = wizardLaunchedProperties(argv(), false, {
      AMPLITUDE_WIZARD_DATA_API_URL: 'https://internal.example.com/api',
      AMPLITUDE_WIZARD_INGESTION_HOST: 'https://ingest.example.com',
      AMPLITUDE_WIZARD_SIGNUP_URL: 'https://signup.example.com',
      AMPLITUDE_SERVER_URL: 'https://analytics.example.com',
      AMPLITUDE_API_KEY: 'akey-secret-value',
    });
    expect(props['data api url override env']).toBe(true);
    expect(props['ingestion host override env']).toBe(true);
    expect(props['signup url override env']).toBe(true);
    expect(props['amplitude server url override env']).toBe(true);
    expect(props['amplitude api key env']).toBe(true);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('internal.example.com');
    expect(serialized).not.toContain('signup.example.com');
    expect(serialized).not.toContain('akey-secret-value');
  });

  it('passes agent-knob env-var values through (low cardinality)', () => {
    const props = wizardLaunchedProperties(argv(), false, {
      AMPLITUDE_WIZARD_MCP_TOOL_FILTER: 'minimal',
      AMPLITUDE_WIZARD_BUILTIN_TOOL_FILTER: 'full',
      AMPLITUDE_WIZARD_MAX_TURNS: '100',
    });
    expect(props['mcp tool filter env']).toBe('minimal');
    expect(props['builtin tool filter env']).toBe('full');
    expect(props['max turns env']).toBe('100');
  });

  it('captures NO_UPDATE_CHECK and NO_THEME with strict =1 match', () => {
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_NO_UPDATE_CHECK: '1',
        AMPLITUDE_WIZARD_NO_THEME: '1',
      })['no update check env'],
    ).toBe(true);
    expect(
      wizardLaunchedProperties(argv(), false, {
        AMPLITUDE_WIZARD_NO_UPDATE_CHECK: '1',
        AMPLITUDE_WIZARD_NO_THEME: '1',
      })['no theme env'],
    ).toBe(true);
  });

  it('reflects CI env var via `ci env detected` (passes through `env` param)', () => {
    expect(
      wizardLaunchedProperties(argv(), false, { CI: 'true' })[
        'ci env detected'
      ],
    ).toBe(true);
    expect(wizardLaunchedProperties(argv(), false, {})['ci env detected']).toBe(
      false,
    );
  });
});
