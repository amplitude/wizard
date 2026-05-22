/**
 * voice — canonical status lines for the new RunScreen.
 *
 * The design kit (docs/design/wizard-design-kit.md) defines a voice
 * library: lowercase, first-person, present tense, no `!`, no emoji.
 * This module is the single place those strings get formed for the
 * RunTimeline composer; never hand-write them at callsites.
 *
 * Kept inline in this PR (PR #784 from the closed redesign track had a
 * larger version that hasn't landed). When that PR lands, the larger
 * library can replace this file.
 */

import path from 'node:path';

const MAX_PATH_DISPLAY = 40;

function shortPath(p: string): string {
  if (p.length <= MAX_PATH_DISPLAY) return p;
  // Head-truncate so the meaningful filename tail survives.
  const segments = p.split(path.sep);
  const basename = segments[segments.length - 1] ?? p;
  if (basename.length >= MAX_PATH_DISPLAY) {
    return '…' + basename.slice(basename.length - (MAX_PATH_DISPLAY - 1));
  }
  let acc = basename;
  for (let i = segments.length - 2; i >= 0; i--) {
    const next = `${segments[i]}/${acc}`;
    if (next.length + 2 > MAX_PATH_DISPLAY) break;
    acc = next;
  }
  return acc === basename ? basename : `…/${acc}`;
}

export const voice = {
  /** `editing src/app/layout.tsx` */
  editing(p: string): string {
    return `editing ${shortPath(p)}`;
  },

  /** `installing @amplitude/analytics-browser with pnpm` */
  installing(pkg: string, mgr?: string): string {
    return mgr ? `installing ${pkg} with ${mgr}` : `installing ${pkg}`;
  },

  /** `installed @amplitude/analytics-browser@2.x` */
  installed(pkg: string): string {
    return `installed ${pkg}`;
  },

  /** `wiring up Signup Completed` */
  wiringEvent(name: string): string {
    return `wiring up ${name}`;
  },

  /** Idle / planning fallback for the voice line. */
  thinking(): string {
    return 'thinking…';
  },
} as const;
