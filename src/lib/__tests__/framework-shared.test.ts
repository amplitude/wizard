import { describe, expect, it } from 'vitest';
import {
  SUCCESS_MESSAGE_INTEGRATION_COMPLETE,
  OUTRO_DASHBOARD_LINE,
  JS_TS_PROJECT_TYPE_DETECTION,
  apiKeyOnlyEnv,
  apiKeyAndServerUrlEnv,
  emptyEnv,
  noVersionFromPackageJson,
  frameworkDocsIdLine,
} from '../framework-shared';

/**
 * These tests pin the wording of the shared framework strings so a future
 * refactor cannot silently change the prompt content the agent receives or
 * the user-facing outro copy. The pre-refactor framework configs inlined
 * these exact strings — keep this file in lockstep with what those configs
 * used to spell.
 */
describe('framework-shared constants', () => {
  it('keeps the success message exactly "Amplitude integration complete"', () => {
    expect(SUCCESS_MESSAGE_INTEGRATION_COMPLETE).toBe(
      'Amplitude integration complete',
    );
  });

  it('keeps the outro dashboard line stable', () => {
    expect(OUTRO_DASHBOARD_LINE).toBe(
      'Visit your Amplitude dashboard to see incoming events',
    );
  });

  it('keeps the JS/TS project-type detection blurb stable', () => {
    expect(JS_TS_PROJECT_TYPE_DETECTION).toBe(
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    );
  });
});

describe('framework-shared env builders', () => {
  it('apiKeyOnlyEnv returns just AMPLITUDE_API_KEY', () => {
    expect(apiKeyOnlyEnv('test-key')).toEqual({
      AMPLITUDE_API_KEY: 'test-key',
    });
  });

  it('apiKeyAndServerUrlEnv returns both keys', () => {
    expect(
      apiKeyAndServerUrlEnv('test-key', 'https://api.example.com'),
    ).toEqual({
      AMPLITUDE_API_KEY: 'test-key',
      AMPLITUDE_SERVER_URL: 'https://api.example.com',
    });
  });

  it('emptyEnv returns an empty object', () => {
    expect(emptyEnv()).toEqual({});
  });
});

describe('framework-shared misc helpers', () => {
  it('noVersionFromPackageJson always returns undefined', () => {
    expect(noVersionFromPackageJson()).toBeUndefined();
  });

  it('frameworkDocsIdLine builds the canonical prompt fragment', () => {
    expect(frameworkDocsIdLine('nextjs')).toBe(
      'Framework docs ID: nextjs (use amplitude://docs/frameworks/nextjs for documentation)',
    );
    expect(frameworkDocsIdLine('react-native')).toBe(
      'Framework docs ID: react-native (use amplitude://docs/frameworks/react-native for documentation)',
    );
  });
});
