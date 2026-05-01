import type { PackageDotJson } from '../../utils/package-json';
import { hasPackageInstalled } from '../../utils/package-json';
import { FRAMEWORK_PACKAGES } from '../javascript-web/utils';
import { isVuePoweredDocsSite } from './vue-powered-docs-site';

/**
 * When true, the JavaScript (Web) fallback should not claim this project:
 * a more specific browser integration already applies.
 *
 * Some stacks still declare a framework package for unrelated reasons (e.g.
 * VitePress lists `vue`); those are handled via per-package exceptions below.
 */
export function javascriptWebBlockedByFrameworkPackage(
  packageJson: PackageDotJson,
): boolean {
  for (const frameworkPkg of FRAMEWORK_PACKAGES) {
    if (!hasPackageInstalled(frameworkPkg, packageJson)) continue;
    if (allowsJavascriptWebDespiteFrameworkSignal(frameworkPkg, packageJson)) {
      continue;
    }
    return true;
  }
  return false;
}

function allowsJavascriptWebDespiteFrameworkSignal(
  frameworkPkg: (typeof FRAMEWORK_PACKAGES)[number],
  packageJson: PackageDotJson,
): boolean {
  switch (frameworkPkg) {
    case 'vue':
      return isVuePoweredDocsSite(packageJson);
    default:
      return false;
  }
}
