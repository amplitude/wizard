/**
 * WizardVoice — canonical narration library.
 *
 * The wizard speaks with one voice: lowercase, first-person, present-tense,
 * no exclamation points, no emoji. Proper nouns (Amplitude, Next.js, Slack)
 * and event names ("Signup Completed") keep their natural capitalization
 * inside quotes; everything else is lowercase.
 *
 * Drafted in PR 2 of the Timeline UX redesign. Wired into screens in PR 10.
 * See `docs/design/timeline-ux.md` § "Voice library (canonical lines)" for
 * the canonical strings.
 *
 * No imports from anywhere else in `src/ui/tui/` — this file must stay a
 * pure leaf so screens, components, and tests can depend on it freely.
 */

export interface DoneStats {
  events: number;
  files?: number;
}

export const voice = {
  thinking: 'thinking through what to do next',
  signingIn: "i'll open your browser to sign you in",
  waitingBrowser: 'waiting on your browser tab...',
  signedIn: (email: string): string => `signed in as ${email}`,
  detecting: 'looking at your codebase',
  detected: (framework: string, path: string): string =>
    `found ${framework} in ${path}`,
  editing: (path: string): string => `editing ${path}`,
  installing: (pkg: string, mgr: string): string =>
    `installing ${pkg} with ${mgr}`,
  installed: (pkg: string): string => `installed ${pkg}`,
  wiringEvent: (name: string): string => `wiring up ${name}`,
  tabPrompt: 'what would you like me to do?',
  done: (stats: DoneStats): string =>
    `all set — you're tracking ${stats.events} events in production`,
  errorRecoverable: (reason: string): string => `${reason}. retrying...`,
  errorFatal: (reason: string): string =>
    `i couldn't finish this. here's what to try: ${reason}`,
} as const;

export type Voice = typeof voice;
