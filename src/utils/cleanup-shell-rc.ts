import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MARKER = '# Amplitude Wizard shell completions';
const BLOCK =
  /\n?# Amplitude Wizard shell completions\s*\neval "\$\(amplitude-wizard completion\)"\s*\n?/g;

/**
 * Earlier versions silently appended a completion eval to the user's shell rc.
 * The `completion` subcommand has since been removed, so sourcing the rc now
 * errors with `command not found: amplitude-wizard`. Remove only the exact
 * block we added so users aren't stuck with a broken shell config.
 */
export function cleanupShellCompletionLine(): void {
  let home: string;
  try {
    home = os.homedir();
  } catch {
    return;
  }

  const candidates = [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
  ];

  // Try each file independently so a failure on one (e.g. read-only
  // permissions on .zshrc) doesn't skip cleanup of the others.
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const contents = fs.readFileSync(file, 'utf-8');
      if (!contents.includes(MARKER)) continue;
      const cleaned = contents.replace(BLOCK, '\n');
      if (cleaned !== contents) {
        fs.writeFileSync(file, cleaned, 'utf-8');
      }
    } catch {
      // Best-effort cleanup; never surface errors.
    }
  }
}
