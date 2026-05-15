/**
 * Tests for WizardVoice — the canonical narration library.
 *
 * Each export is pinned to an exact snapshot AND checked against the voice
 * rules: lowercase (except proper nouns / event names supplied as args),
 * no `!`, no emoji, first-person / present-tense where the line is the
 * wizard speaking about itself.
 *
 * If you change a string here, also update `docs/design/timeline-ux.md`
 * § "Voice library (canonical lines)" to match.
 */
import { describe, expect, it } from 'vitest';

import { voice } from '../voice';

/**
 * Voice rules.
 *
 * Emoji detection uses the broad "Extended Pictographic" category — we
 * don't ship to legacy node, so the `\p{Extended_Pictographic}` Unicode
 * property is available.
 */
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function assertNoExclamation(s: string): void {
  expect(s).not.toMatch(/!/);
}

function assertNoEmoji(s: string): void {
  expect(s).not.toMatch(EMOJI_RE);
}

/**
 * Lowercase rule. We allow uppercase only when it appears inside a
 * caller-supplied substring (proper noun like `Next.js`, event name like
 * `Signup Completed`, email local-part, file path with mixed case, etc.).
 * For pure static strings, the entire line must be lowercase.
 */
function assertAllLowercase(s: string): void {
  expect(s).toBe(s.toLowerCase());
}

function assertLowercaseExcept(
  s: string,
  ...allowedSubstrings: string[]
): void {
  let stripped = s;
  for (const sub of allowedSubstrings) {
    // strip every occurrence so we don't accidentally re-match
    while (stripped.includes(sub)) {
      stripped = stripped.replace(sub, '');
    }
  }
  expect(stripped).toBe(stripped.toLowerCase());
}

describe('voice — pinned strings', () => {
  it('thinking', () => {
    expect(voice.thinking).toBe('thinking through what to do next');
  });

  it('signingIn', () => {
    expect(voice.signingIn).toBe("i'll open your browser to sign you in");
  });

  it('waitingBrowser', () => {
    expect(voice.waitingBrowser).toBe('waiting on your browser tab...');
  });

  it('signedIn(email)', () => {
    expect(voice.signedIn('jane@acme.com')).toBe('signed in as jane@acme.com');
  });

  it('detecting', () => {
    expect(voice.detecting).toBe('looking at your codebase');
  });

  it('detected(framework, path)', () => {
    expect(voice.detected('Next.js 15', 'apps/web')).toBe(
      'found Next.js 15 in apps/web',
    );
  });

  it('editing(path)', () => {
    expect(voice.editing('src/app/layout.tsx')).toBe(
      'editing src/app/layout.tsx',
    );
  });

  it('installing(pkg, mgr)', () => {
    expect(voice.installing('@amplitude/analytics-browser', 'pnpm')).toBe(
      'installing @amplitude/analytics-browser with pnpm',
    );
  });

  it('installed(pkg)', () => {
    expect(voice.installed('@amplitude/analytics-browser')).toBe(
      'installed @amplitude/analytics-browser',
    );
  });

  it('wiringEvent(name) — event names ARE capitalized inside the line', () => {
    expect(voice.wiringEvent('Signup Completed')).toBe(
      'wiring up Signup Completed',
    );
  });

  it('tabPrompt', () => {
    expect(voice.tabPrompt).toBe('what would you like me to do?');
  });

  it('done(stats)', () => {
    expect(voice.done({ events: 7 })).toBe(
      "all set — you're tracking 7 events in production",
    );
  });

  it('done(stats) — files arg is accepted but does not change the canonical line', () => {
    expect(voice.done({ events: 7, files: 3 })).toBe(
      "all set — you're tracking 7 events in production",
    );
  });

  it('errorRecoverable(reason) — interpolates the reason', () => {
    expect(voice.errorRecoverable("couldn't reach the project list")).toBe(
      "couldn't reach the project list. retrying...",
    );
  });

  it('errorFatal(reason) — canonical opener + reason', () => {
    expect(voice.errorFatal('network is offline')).toBe(
      "i couldn't finish this. here's what to try: network is offline",
    );
  });
});

describe('voice — rules (no !, no emoji)', () => {
  /**
   * Every export is funneled through here so we can't regress on the
   * "no `!`, no emoji" rule by adding a new line without a check.
   */
  const samples: Array<[string, string]> = [
    ['thinking', voice.thinking],
    ['signingIn', voice.signingIn],
    ['waitingBrowser', voice.waitingBrowser],
    ['signedIn', voice.signedIn('jane@acme.com')],
    ['detecting', voice.detecting],
    ['detected', voice.detected('Next.js 15', 'apps/web')],
    ['editing', voice.editing('src/app/layout.tsx')],
    ['installing', voice.installing('@amplitude/analytics-browser', 'pnpm')],
    ['installed', voice.installed('@amplitude/analytics-browser')],
    ['wiringEvent', voice.wiringEvent('Signup Completed')],
    ['tabPrompt', voice.tabPrompt],
    ['done', voice.done({ events: 7 })],
    ['errorRecoverable', voice.errorRecoverable("couldn't reach the api")],
    ['errorFatal', voice.errorFatal('network is offline')],
  ];

  for (const [name, line] of samples) {
    it(`${name}: has no '!'`, () => assertNoExclamation(line));
    it(`${name}: has no emoji`, () => assertNoEmoji(line));
  }
});

describe('voice — lowercase rule', () => {
  it('static strings are entirely lowercase', () => {
    assertAllLowercase(voice.thinking);
    assertAllLowercase(voice.signingIn);
    assertAllLowercase(voice.waitingBrowser);
    assertAllLowercase(voice.detecting);
    assertAllLowercase(voice.tabPrompt);
  });

  it('signedIn is lowercase outside the email arg', () => {
    assertLowercaseExcept(voice.signedIn('Jane@Acme.com'), 'Jane@Acme.com');
  });

  it('detected is lowercase outside the framework/path args (proper noun preserved)', () => {
    assertLowercaseExcept(
      voice.detected('Next.js 15', 'apps/web'),
      'Next.js',
      'apps/web',
    );
  });

  it('editing is lowercase outside the path arg', () => {
    assertLowercaseExcept(
      voice.editing('src/App/Layout.tsx'),
      'src/App/Layout.tsx',
    );
  });

  it('installing is lowercase outside the pkg/mgr args', () => {
    assertLowercaseExcept(
      voice.installing('@amplitude/analytics-browser', 'pnpm'),
      '@amplitude/analytics-browser',
      'pnpm',
    );
  });

  it('installed is lowercase outside the pkg arg', () => {
    assertLowercaseExcept(
      voice.installed('@amplitude/analytics-browser'),
      '@amplitude/analytics-browser',
    );
  });

  it('wiringEvent allows capitalized event names inside the line', () => {
    // The event-name segment is capitalized by design (per design doc).
    assertLowercaseExcept(
      voice.wiringEvent('Signup Completed'),
      'Signup Completed',
    );
  });

  it('done is entirely lowercase (numbers OK)', () => {
    assertAllLowercase(voice.done({ events: 7 }));
  });

  it('errorRecoverable is lowercase outside the reason arg', () => {
    assertLowercaseExcept(
      voice.errorRecoverable("couldn't reach the project list"),
      "couldn't reach the project list",
    );
  });

  it('errorFatal is lowercase outside the reason arg', () => {
    assertLowercaseExcept(
      voice.errorFatal('Network is Offline'),
      'Network is Offline',
    );
  });
});

describe('voice — first-person / present-tense markers', () => {
  it("signingIn uses i'll (first-person, future intent in present voice)", () => {
    expect(voice.signingIn).toMatch(/\bi'll\b/);
  });

  it("errorFatal uses the first-person 'i' contraction", () => {
    expect(voice.errorFatal('reason')).toMatch(/\bi\b/);
  });

  it("done uses contracted first-person voice (you're)", () => {
    // The "done" line speaks *to* the user — present tense, contracted.
    expect(voice.done({ events: 7 })).toMatch(/\byou're\b/);
  });

  it('detecting uses present-tense -ing form', () => {
    expect(voice.detecting).toMatch(/ing\b/);
  });

  it('thinking uses present-tense -ing form', () => {
    expect(voice.thinking).toMatch(/^thinking\b/);
  });

  it('waitingBrowser uses present-tense -ing form', () => {
    expect(voice.waitingBrowser).toMatch(/^waiting\b/);
  });
});
