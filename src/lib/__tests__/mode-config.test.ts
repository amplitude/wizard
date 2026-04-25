import { describe, it, expect } from 'vitest';
import { resolveMode, evaluateWriteGate } from '../mode-config.js';

describe('resolveMode', () => {
  describe('mode selection', () => {
    it('returns interactive mode when TTY and no auto-approve flags', () => {
      const result = resolveMode({ isTTY: true });
      expect(result.mode).toBe('interactive');
    });

    it('returns agent mode when --agent is set', () => {
      const result = resolveMode({ agent: true, isTTY: true });
      expect(result.mode).toBe('agent');
    });

    it('returns ci mode when --ci is set', () => {
      const result = resolveMode({ ci: true, isTTY: true });
      expect(result.mode).toBe('ci');
    });

    it('returns ci mode when --yes is set', () => {
      const result = resolveMode({ yes: true, isTTY: true });
      expect(result.mode).toBe('ci');
    });

    it('falls back to ci when not TTY and not agent', () => {
      const result = resolveMode({ isTTY: false });
      expect(result.mode).toBe('ci');
    });
  });

  describe('autoApprove', () => {
    it('is true in agent mode', () => {
      expect(resolveMode({ agent: true, isTTY: true }).autoApprove).toBe(true);
    });

    it('is true in ci mode', () => {
      expect(resolveMode({ ci: true, isTTY: true }).autoApprove).toBe(true);
    });

    it('is false in interactive mode', () => {
      expect(resolveMode({ isTTY: true }).autoApprove).toBe(false);
    });
  });

  describe('jsonOutput — the --json / --human / --agent decoupling', () => {
    it('is true in agent mode', () => {
      expect(resolveMode({ agent: true, isTTY: true }).jsonOutput).toBe(true);
    });

    it('is true with --json even when TTY and not agent', () => {
      expect(resolveMode({ json: true, isTTY: true }).jsonOutput).toBe(true);
    });

    it('does NOT enable autoApprove when only --json is set (decoupled from --agent)', () => {
      const result = resolveMode({ json: true, isTTY: true });
      expect(result.jsonOutput).toBe(true);
      expect(result.autoApprove).toBe(false);
      expect(result.mode).toBe('interactive');
    });

    it('is true when piped (non-TTY) with no explicit flags', () => {
      expect(resolveMode({ isTTY: false }).jsonOutput).toBe(true);
    });

    it('is false with --human even when piped', () => {
      expect(resolveMode({ human: true, isTTY: false }).jsonOutput).toBe(false);
    });

    it('is false with --human even with --agent', () => {
      expect(
        resolveMode({ human: true, agent: true, isTTY: false }).jsonOutput,
      ).toBe(false);
    });

    it('is false with --human even with --json', () => {
      expect(
        resolveMode({ human: true, json: true, isTTY: true }).jsonOutput,
      ).toBe(false);
    });

    it('is false by default in interactive TTY', () => {
      expect(resolveMode({ isTTY: true }).jsonOutput).toBe(false);
    });
  });

  describe('quiet', () => {
    it('is true when not TTY', () => {
      expect(resolveMode({ isTTY: false }).quiet).toBe(true);
    });

    it('is false when TTY', () => {
      expect(resolveMode({ isTTY: true }).quiet).toBe(false);
    });
  });

  describe('capability flags — autoApprove / allowWrites / allowDestructive', () => {
    it('--auto-approve grants autoApprove only', () => {
      const r = resolveMode({ autoApprove: true, isTTY: true });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(false);
      expect(r.allowDestructive).toBe(false);
    });

    it('--yes grants autoApprove + allowWrites', () => {
      const r = resolveMode({ yes: true, isTTY: true });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(true);
      expect(r.allowDestructive).toBe(false);
    });

    it('--ci grants autoApprove + allowWrites', () => {
      const r = resolveMode({ ci: true, isTTY: true });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(true);
      expect(r.allowDestructive).toBe(false);
    });

    it('--force grants autoApprove + allowWrites + allowDestructive', () => {
      const r = resolveMode({ force: true, isTTY: true });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(true);
      expect(r.allowDestructive).toBe(true);
    });

    it('--agent (alone) implies autoApprove + allowWrites for back-compat', () => {
      const r = resolveMode({ agent: true, isTTY: true });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(true);
      expect(r.allowDestructive).toBe(false);
    });

    it('--agent + requireExplicitWrites does NOT grant writes', () => {
      const r = resolveMode({
        agent: true,
        requireExplicitWrites: true,
        isTTY: true,
      });
      expect(r.allowWrites).toBe(false);
      expect(r.autoApprove).toBe(false);
    });

    it('--agent + requireExplicitWrites + --auto-approve grants autoApprove only', () => {
      const r = resolveMode({
        agent: true,
        autoApprove: true,
        requireExplicitWrites: true,
        isTTY: true,
      });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(false);
    });

    it('--agent + requireExplicitWrites + --yes grants autoApprove + writes', () => {
      const r = resolveMode({
        agent: true,
        yes: true,
        requireExplicitWrites: true,
        isTTY: true,
      });
      expect(r.autoApprove).toBe(true);
      expect(r.allowWrites).toBe(true);
    });

    it('interactive mode without flags grants nothing', () => {
      const r = resolveMode({ isTTY: true });
      expect(r.autoApprove).toBe(false);
      expect(r.allowWrites).toBe(false);
      expect(r.allowDestructive).toBe(false);
    });
  });
});

describe('evaluateWriteGate', () => {
  const allow = {
    autoApprove: true,
    allowWrites: true,
    allowDestructive: true,
  };
  const writesOnly = {
    autoApprove: true,
    allowWrites: true,
    allowDestructive: false,
  };
  const readOnly = {
    autoApprove: true,
    allowWrites: false,
    allowDestructive: false,
  };

  it('allows Read / Glob / Grep regardless of capabilities', () => {
    for (const tool of ['Read', 'Glob', 'Grep', 'Task']) {
      expect(evaluateWriteGate(tool, {}, readOnly).kind).toBe('allow');
    }
  });

  it('denies Edit / Write / MultiEdit / NotebookEdit when allowWrites is false', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
      const decision = evaluateWriteGate(tool, {}, readOnly);
      expect(decision.kind).toBe('deny');
      if (decision.kind === 'deny') {
        expect(decision.resumeFlag).toBe('--yes');
        expect(decision.reason).toMatch(tool);
      }
    }
  });

  it('allows Edit / Write when allowWrites is true', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      expect(evaluateWriteGate(tool, {}, writesOnly).kind).toBe('allow');
    }
  });

  it('denies destructive Bash patterns when allowDestructive is false', () => {
    const dangerous = [
      'rm -rf node_modules',
      'rm -r build',
      'git reset --hard origin/main',
      'git clean -fdx',
      'git push --force origin main',
      'DROP TABLE users',
    ];
    for (const cmd of dangerous) {
      const decision = evaluateWriteGate('Bash', { command: cmd }, writesOnly);
      expect(decision.kind).toBe('deny');
      if (decision.kind === 'deny') {
        expect(decision.resumeFlag).toBe('--force');
      }
    }
  });

  it('allows destructive Bash when --force granted', () => {
    expect(
      evaluateWriteGate('Bash', { command: 'rm -rf node_modules' }, allow).kind,
    ).toBe('allow');
  });

  it('denies non-destructive Bash when allowWrites is false', () => {
    const decision = evaluateWriteGate(
      'Bash',
      { command: 'pnpm install' },
      readOnly,
    );
    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') {
      expect(decision.resumeFlag).toBe('--yes');
    }
  });

  it('allows non-destructive Bash when allowWrites is true', () => {
    expect(
      evaluateWriteGate('Bash', { command: 'pnpm install' }, writesOnly).kind,
    ).toBe('allow');
  });

  it('treats malformed Bash input safely (no command field)', () => {
    expect(evaluateWriteGate('Bash', null, writesOnly).kind).toBe('allow');
    expect(evaluateWriteGate('Bash', { foo: 'bar' }, writesOnly).kind).toBe(
      'allow',
    );
  });
});
