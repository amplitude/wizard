import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupShellCompletionLine } from '../cleanup-shell-rc.js';

describe('cleanupShellCompletionLine', () => {
  let tmpHome: string;
  let zshrc: string;
  let bashrc: string;
  let bashProfile: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-rc-test-'));
    zshrc = path.join(tmpHome, '.zshrc');
    bashrc = path.join(tmpHome, '.bashrc');
    bashProfile = path.join(tmpHome, '.bash_profile');
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('removes the completion block from ~/.zshrc', () => {
    const before = [
      'export PATH=$PATH:/usr/local/bin',
      '',
      '# Amplitude Wizard shell completions',
      'eval "$(amplitude-wizard completion)"',
      '',
      'alias ll="ls -la"',
      '',
    ].join('\n');
    fs.writeFileSync(zshrc, before, 'utf-8');

    cleanupShellCompletionLine();

    const after = fs.readFileSync(zshrc, 'utf-8');
    expect(after).not.toContain('amplitude-wizard completion');
    expect(after).not.toContain('# Amplitude Wizard shell completions');
    expect(after).toContain('export PATH=$PATH:/usr/local/bin');
    expect(after).toContain('alias ll="ls -la"');
  });

  it('leaves files without the block untouched', () => {
    const contents = 'export PATH=$PATH:/usr/local/bin\nalias ll="ls -la"\n';
    fs.writeFileSync(zshrc, contents, 'utf-8');

    cleanupShellCompletionLine();

    expect(fs.readFileSync(zshrc, 'utf-8')).toBe(contents);
  });

  it('is a no-op when the rc file does not exist', () => {
    expect(() => cleanupShellCompletionLine()).not.toThrow();
    expect(fs.existsSync(zshrc)).toBe(false);
  });

  it('cleans up .bashrc and .bash_profile too', () => {
    const block =
      '\n# Amplitude Wizard shell completions\neval "$(amplitude-wizard completion)"\n';
    fs.writeFileSync(bashrc, `# bash setup${block}alias x=y\n`, 'utf-8');
    fs.writeFileSync(bashProfile, `# profile${block}`, 'utf-8');

    cleanupShellCompletionLine();

    expect(fs.readFileSync(bashrc, 'utf-8')).not.toContain(
      'amplitude-wizard completion',
    );
    expect(fs.readFileSync(bashProfile, 'utf-8')).not.toContain(
      'amplitude-wizard completion',
    );
  });

  it('does not touch unrelated lines that mention amplitude-wizard', () => {
    const contents = [
      '# Amplitude Wizard shell completions',
      'eval "$(amplitude-wizard completion)"',
      '',
      '# my custom alias',
      'alias aw="amplitude-wizard --debug"',
      '',
    ].join('\n');
    fs.writeFileSync(zshrc, contents, 'utf-8');

    cleanupShellCompletionLine();

    const after = fs.readFileSync(zshrc, 'utf-8');
    expect(after).toContain('alias aw="amplitude-wizard --debug"');
    expect(after).not.toContain('eval "$(amplitude-wizard completion)"');
  });
});
