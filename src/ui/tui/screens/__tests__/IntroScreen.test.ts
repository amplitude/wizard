import { describe, it, expect } from 'vitest';
import { getFrameworkLabelSuffix } from '../IntroScreen.js';

describe('getFrameworkLabelSuffix', () => {
  it('shows "(detected)" when a real framework was auto-detected', () => {
    expect(
      getFrameworkLabelSuffix({ manuallySelected: false, autoFallback: false }),
    ).toBe(' (detected)');
  });

  it('shows no suffix on fallback — the main label already reads "none detected"', () => {
    expect(
      getFrameworkLabelSuffix({ manuallySelected: false, autoFallback: true }),
    ).toBe('');
  });

  it('shows no suffix when the user manually picked a framework', () => {
    expect(
      getFrameworkLabelSuffix({ manuallySelected: true, autoFallback: false }),
    ).toBe('');
  });

  it('prefers manual selection over the fallback state', () => {
    // If the user auto-fell-back to Generic then opened the picker and chose a
    // framework manually, the label must not claim detection or fallback.
    expect(
      getFrameworkLabelSuffix({ manuallySelected: true, autoFallback: true }),
    ).toBe('');
  });
});
