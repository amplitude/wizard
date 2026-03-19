import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains a Go module project (go.mod present).
 */
export function detectGoProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  return Promise.resolve(
    fs.existsSync(path.join(options.installDir, 'go.mod')),
  );
}
