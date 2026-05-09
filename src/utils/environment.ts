import readEnv from 'read-env';
import { tryGetPackageJson } from './setup-utils';
import type { WizardOptions } from './types';
import { IS_DEV } from '../lib/constants';

// `fast-glob` is ~13 ms of cold-start parse cost (its sync transitive graph
// loads ~30 modules). It's only needed inside `detectEnvVarPrefix`, which
// runs once per wizard run and only after framework detection — never on
// `--version`, `status --json`, or any other fast path. Defer the import.
type FgFn = typeof import('fast-glob');
let fgPromise: Promise<FgFn> | null = null;
const loadFg = (): Promise<FgFn> => {
  // The CJS export of fast-glob is the function itself (assigned to
  // `module.exports`), so we read the same ref through both entry shapes.
  // Clear the cache on rejection so a transient import failure (broken
  // install, missing transitive dep) can be retried instead of replaying
  // the stale error on every subsequent call.
  if (!fgPromise) {
    fgPromise = import('fast-glob')
      .then((m) => (m as { default?: FgFn }).default ?? (m as unknown as FgFn))
      .catch((err) => {
        fgPromise = null;
        throw err;
      });
  }
  return fgPromise;
};

export function isNonInteractiveEnvironment(): boolean {
  if (IS_DEV) {
    return false;
  }

  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    return true;
  }

  return false;
}

export function readEnvironment(): Record<string, unknown> {
  const result = readEnv('AMPLITUDE_WIZARD');

  return result;
}

export async function detectEnvVarPrefix(
  options: WizardOptions,
): Promise<string> {
  const packageJson = await tryGetPackageJson(options);
  if (!packageJson) return 'VITE_PUBLIC_';

  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const has = (name: string) => name in deps;
  const hasAnyFile = async (patterns: string[]) => {
    const fg = await loadFg();
    const matches = await fg(patterns, {
      cwd: options.installDir,
      absolute: false,
      onlyFiles: true,
      ignore: ['**/node_modules/**'],
    });
    return matches.length > 0;
  };

  // --- Next.js
  if (has('next') || (await hasAnyFile(['**/next.config.{js,ts,mjs,cjs}']))) {
    return 'NEXT_PUBLIC_';
  }

  // --- Create React App
  if (
    has('react-scripts') ||
    has('create-react-app') ||
    (await hasAnyFile(['**/config-overrides.js']))
  ) {
    return 'REACT_APP_';
  }

  // --- Vite (vanilla, TanStack, Solid, etc.)
  // Note: Vite does not need PUBLIC_ but we use it to follow the docs, to improve the chances of an LLM getting it right.
  if (has('vite') || (await hasAnyFile(['**/vite.config.{js,ts,mjs,cjs}']))) {
    return 'VITE_PUBLIC_';
  }

  // --- SvelteKit
  if (
    has('@sveltejs/kit') ||
    (await hasAnyFile(['**/svelte.config.{js,ts}']))
  ) {
    return 'PUBLIC_';
  }

  // --- TanStack Start (uses Vite)
  if (
    has('@tanstack/start') ||
    (await hasAnyFile(['**/tanstack.config.{js,ts}']))
  ) {
    return 'VITE_PUBLIC_';
  }

  // --- SolidStart (uses Vite)
  if (has('solid-start') || (await hasAnyFile(['**/solid.config.{js,ts}']))) {
    return 'VITE_PUBLIC_';
  }

  // --- Astro
  if (has('astro') || (await hasAnyFile(['**/astro.config.{js,ts,mjs}']))) {
    return 'PUBLIC_';
  }

  // We default to Vite if we can't detect a specific framework, since it's the most commonly used.
  return 'VITE_PUBLIC_';
}
