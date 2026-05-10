/**
 * Unit coverage for the discovered-facts classifiers.
 *
 * Both classifiers are pure data lookups (with one filesystem probe in
 * `inferAppType`), so we test each priority bucket in isolation plus the
 * null-skip case. Adding a new bucket means: add a check above the
 * fallthrough in `classifier.ts`, add a test here, update the PR body.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { inferVertical, inferAppType } from '../classifier.js';
import type { PackageDotJson } from '../../../utils/package-json.js';

const NO_DIR = '/__no_such_install_dir__/should_not_exist';

function pkg(deps: Record<string, string>): PackageDotJson {
  return { dependencies: deps };
}

describe('inferVertical', () => {
  it('returns Ecommerce when stripe is a top-level dep', () => {
    expect(inferVertical(pkg({ stripe: '^15.0.0' }), NO_DIR)).toEqual({
      value: 'Ecommerce',
    });
  });

  it('returns Ecommerce for @stripe/* scoped deps (e.g. @stripe/stripe-js)', () => {
    expect(
      inferVertical(pkg({ '@stripe/stripe-js': '^2.4.0' }), NO_DIR),
    ).toEqual({ value: 'Ecommerce' });
  });

  it('returns AI app for openai dep', () => {
    expect(inferVertical(pkg({ openai: '^4.0.0' }), NO_DIR)).toEqual({
      value: 'AI app',
    });
  });

  it('returns AI app for @anthropic-ai/sdk dep', () => {
    expect(
      inferVertical(pkg({ '@anthropic-ai/sdk': '^0.30.0' }), NO_DIR),
    ).toEqual({ value: 'AI app' });
  });

  it('returns AI app for the Vercel ai SDK dep', () => {
    expect(inferVertical(pkg({ ai: '^3.0.0' }), NO_DIR)).toEqual({
      value: 'AI app',
    });
  });

  it('promotes SaaS to B2B SaaS when an ORM is present alongside auth', () => {
    expect(
      inferVertical(
        pkg({ prisma: '^5.0.0', 'next-auth': '^4.24.0' }),
        NO_DIR,
      ),
    ).toEqual({ value: 'B2B SaaS' });
  });

  it('returns B2B SaaS for drizzle-orm + @clerk/* (prefix-matched)', () => {
    expect(
      inferVertical(
        pkg({ 'drizzle-orm': '^0.30.0', '@clerk/nextjs': '^5.0.0' }),
        NO_DIR,
      ),
    ).toEqual({ value: 'B2B SaaS' });
  });

  it('returns B2B SaaS for mongoose + @auth0/*', () => {
    expect(
      inferVertical(
        pkg({ mongoose: '^8.0.0', '@auth0/nextjs-auth0': '^3.5.0' }),
        NO_DIR,
      ),
    ).toEqual({ value: 'B2B SaaS' });
  });

  it('returns SaaS when only an auth lib is present (no ORM)', () => {
    expect(
      inferVertical(pkg({ 'next-auth': '^4.24.0' }), NO_DIR),
    ).toEqual({ value: 'SaaS' });
  });

  it('returns SaaS for @supabase/auth-* without an ORM', () => {
    expect(
      inferVertical(pkg({ '@supabase/auth-helpers-nextjs': '^0.10.0' }), NO_DIR),
    ).toEqual({ value: 'SaaS' });
  });

  it('does NOT match a bare @supabase/supabase-js as auth (only @supabase/auth-*)', () => {
    // The spec deliberately scopes the prefix to `@supabase/auth-`, not
    // any `@supabase/*` package, so an app using only the data-plane
    // client doesn't get bucketed as SaaS.
    expect(
      inferVertical(pkg({ '@supabase/supabase-js': '^2.0.0' }), NO_DIR),
    ).toBeNull();
  });

  it('returns null when no bucket fires (skip the chip rather than publish "Unknown")', () => {
    expect(
      inferVertical(
        pkg({ react: '^18.0.0', lodash: '^4.0.0' }),
        NO_DIR,
      ),
    ).toBeNull();
  });

  it('returns null when packageJson is null', () => {
    expect(inferVertical(null, NO_DIR)).toBeNull();
  });

  it('Stripe wins over auth (priority order: ecommerce before SaaS)', () => {
    // A Stripe app that also uses next-auth should still be Ecommerce —
    // first match wins.
    expect(
      inferVertical(
        pkg({ stripe: '^15.0.0', 'next-auth': '^4.24.0' }),
        NO_DIR,
      ),
    ).toEqual({ value: 'Ecommerce' });
  });

  it('also matches deps declared in devDependencies', () => {
    // hasPackageInstalled looks across deps + devDeps + optionalDeps.
    // Belt-and-suspenders test: confirm a stripe in devDeps still fires.
    const json: PackageDotJson = { devDependencies: { stripe: '^15.0.0' } };
    expect(inferVertical(json, NO_DIR)).toEqual({ value: 'Ecommerce' });
  });
});

describe('inferAppType', () => {
  // Use a tmpdir-scoped fixture for the "Next.js + app/api" branch since
  // it's the only branch that touches the filesystem.
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-classifier-test-'),
    );
    fs.mkdirSync(path.join(fixtureDir, 'app', 'api'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('returns Full-stack web for Next.js + app/api dir present', () => {
    expect(
      inferAppType(pkg({ next: '^14.0.0', react: '^18.0.0' }), fixtureDir),
    ).toEqual({ value: 'Full-stack web' });
  });

  it('returns Marketing/SPA web for Next.js without api/ dir', () => {
    expect(
      inferAppType(pkg({ next: '^14.0.0', react: '^18.0.0' }), NO_DIR),
    ).toEqual({ value: 'Marketing/SPA web' });
  });

  it('returns SPA web for vite + react-router with no api/ dir', () => {
    expect(
      inferAppType(
        pkg({
          vite: '^5.0.0',
          'react-router-dom': '^6.0.0',
          react: '^18.0.0',
        }),
        NO_DIR,
      ),
    ).toEqual({ value: 'SPA web' });
  });

  it('returns API server for express with no FE framework', () => {
    expect(
      inferAppType(pkg({ express: '^4.18.0' }), NO_DIR),
    ).toEqual({ value: 'API server' });
  });

  it('returns API server for fastify alone', () => {
    expect(
      inferAppType(pkg({ fastify: '^4.0.0' }), NO_DIR),
    ).toEqual({ value: 'API server' });
  });

  it('returns API server for hono alone', () => {
    expect(inferAppType(pkg({ hono: '^4.0.0' }), NO_DIR)).toEqual({
      value: 'API server',
    });
  });

  it('does NOT classify express + react as API server (FE framework gates the bucket)', () => {
    // Express + React is more likely a custom-server SSR or proxy
    // setup; we don't claim it as an API server.
    expect(
      inferAppType(
        pkg({ express: '^4.18.0', react: '^18.0.0' }),
        NO_DIR,
      ),
    ).toBeNull();
  });

  it('returns null for vite + react WITHOUT react-router (no SPA-router signal)', () => {
    expect(
      inferAppType(
        pkg({ vite: '^5.0.0', react: '^18.0.0' }),
        NO_DIR,
      ),
    ).toBeNull();
  });

  it('returns null when packageJson is null', () => {
    expect(inferAppType(null, NO_DIR)).toBeNull();
  });

  it('Next.js classification beats vite+react-router (priority order)', () => {
    // A project with both `next` and vite+react-router shouldn't
    // happen in practice, but if it does, Next.js wins.
    expect(
      inferAppType(
        pkg({
          next: '^14.0.0',
          vite: '^5.0.0',
          'react-router-dom': '^6.0.0',
          react: '^18.0.0',
        }),
        NO_DIR,
      ),
    ).toEqual({ value: 'Marketing/SPA web' });
  });
});
