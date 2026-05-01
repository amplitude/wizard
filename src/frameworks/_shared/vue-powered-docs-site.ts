import type { PackageDotJson } from '../../utils/package-json';
import { hasPackageInstalled } from '../../utils/package-json';

/**
 * Meta-frameworks that depend on `vue` but are documentation sites or
 * presentation tooling, not product Vue applications. The Vue wizard targets
 * SPA entrypoints; these should use the generic browser (JavaScript Web) path.
 */
export const VUE_POWERED_DOCS_SITE_PACKAGES = [
  'vitepress',
  'vuepress',
  'vuepress-vite',
  '@vuepress/core',
  '@vuepress/client',
  'slidev',
  '@slidev/cli',
] as const;

export function isVuePoweredDocsSite(packageJson: PackageDotJson): boolean {
  for (const name of VUE_POWERED_DOCS_SITE_PACKAGES) {
    if (hasPackageInstalled(name, packageJson)) {
      return true;
    }
  }
  return false;
}
