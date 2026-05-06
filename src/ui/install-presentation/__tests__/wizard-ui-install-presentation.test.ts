import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoggingUI } from '../../logging-ui.js';
import {
  createWizardUiInstallPresentation,
  createNoopWizardInstallPresentation,
} from '../index.js';

describe('createWizardUiInstallPresentation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates intro to WizardUI.intro with subtitle appended', () => {
    const ui = new LoggingUI();
    const introSpy = vi.spyOn(ui, 'intro');
    const sut = createWizardUiInstallPresentation(ui, 'test-surface');

    sut.intro('Title', 'Sub');

    expect(introSpy).toHaveBeenCalledWith('Title — Sub');
  });

  it('rejects interactive prompts with a typed error', async () => {
    const sut = createWizardUiInstallPresentation(
      new LoggingUI(),
      'test-surface',
    );

    await expect(sut.promptPassword({ message: 'pw' })).rejects.toThrow(
      /promptPassword is not available/,
    );
    await expect(sut.confirm({ message: 'ok?' })).rejects.toThrow(
      /confirm is not available/,
    );
    await expect(
      sut.selectFramework({ message: 'fx', options: [] }),
    ).rejects.toThrow(/selectFramework is not available/);
  });

  it('appendToolResult honors ok=false on object form (regression)', () => {
    const ui = new LoggingUI();
    const stepSpy = vi.spyOn(ui.log, 'step');
    const warnSpy = vi.spyOn(ui.log, 'warn');
    const sut = createWizardUiInstallPresentation(ui, 'test-surface');

    sut.appendToolResult({ toolName: 'deploy' }, 'failed step', false);

    expect(stepSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('✖');
    expect(line).toContain('deploy');
    expect(line).toContain('failed step');
  });

  it('appendToolResult honors ok=false on string form (regression)', () => {
    const ui = new LoggingUI();
    const stepSpy = vi.spyOn(ui.log, 'step');
    const warnSpy = vi.spyOn(ui.log, 'warn');
    const sut = createWizardUiInstallPresentation(ui, 'test-surface');

    sut.appendToolResult('deploy', 'broke', false);

    expect(stepSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('✖');
    expect(line).toContain('deploy');
    expect(line).toContain('broke');
  });

  it('appendToolResult uses summary on object form when ok=true', () => {
    const ui = new LoggingUI();
    const stepSpy = vi.spyOn(ui.log, 'step');
    const sut = createWizardUiInstallPresentation(ui, 'test-surface');

    sut.appendToolResult({ toolName: 'deploy' }, 'wrote 3 files', true);

    expect(stepSpy).toHaveBeenCalledTimes(1);
    const line = stepSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('✔');
    expect(line).toContain('deploy');
    expect(line).toContain('wrote 3 files');
  });

  it('delegates spinner to WizardUI.spinner', () => {
    const ui = new LoggingUI();
    const inner = {
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    };
    vi.spyOn(ui, 'spinner').mockReturnValue(inner);

    const sut = createWizardUiInstallPresentation(ui, 'test-surface');
    const spin = sut.createInstallSpinner();

    spin.start('a');
    spin.setMessage('b');
    spin.stop('done');

    expect(inner.start).toHaveBeenCalledWith('a');
    expect(inner.message).toHaveBeenCalledWith('b');
    expect(inner.stop).toHaveBeenCalledWith('done');
  });
});

describe('createNoopWizardInstallPresentation', () => {
  it('returns neutral answers without throwing', async () => {
    const sut = createNoopWizardInstallPresentation();
    expect(await sut.promptPassword({ message: 'x' })).toBeNull();
    expect(await sut.confirm({ message: 'y' })).toBe(false);
    expect(await sut.selectFramework({ message: 'z', options: [] })).toBeNull();
  });
});
