import { describe, it, expect } from 'vitest';
import { lerpColor } from '../color.js';

describe('lerpColor', () => {
  it('returns the start color at t=0', () => {
    expect(lerpColor('#ff0000', '#00ff00', 0)).toBe('#ff0000');
  });

  it('returns the end color at t=1', () => {
    expect(lerpColor('#ff0000', '#00ff00', 1)).toBe('#00ff00');
  });

  it('returns the midpoint color at t=0.5', () => {
    // (0xff + 0x00) / 2 = 0x7f.8 -> rounds to 0x80
    expect(lerpColor('#ff0000', '#00ff00', 0.5)).toBe('#808000');
  });

  it('handles black-to-white linearly', () => {
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('zero-pads single-digit hex components so output is always #rrggbb', () => {
    // Interpolating to a low-channel value would otherwise produce '#001020'
    // without zero padding; lerpColor MUST always emit a 7-char string.
    const out = lerpColor('#000000', '#0a1020', 1);
    expect(out).toBe('#0a1020');
    expect(out).toHaveLength(7);
  });
});
