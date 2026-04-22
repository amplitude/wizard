import { describe, it, expect } from 'vitest';
import { osc8Link } from '../osc8';

describe('osc8Link', () => {
  it('wraps the url with OSC 8 hyperlink escape sequences', () => {
    const out = osc8Link('http://localhost:3000');
    expect(out).toBe(
      '\x1b]8;;http://localhost:3000\x1b\\http://localhost:3000\x1b]8;;\x1b\\',
    );
  });

  it('uses a custom label when provided', () => {
    const out = osc8Link('http://localhost:3000', 'click me');
    expect(out).toBe(
      '\x1b]8;;http://localhost:3000\x1b\\click me\x1b]8;;\x1b\\',
    );
  });

  it('defaults the label to the url so terminals without OSC 8 still show it', () => {
    const out = osc8Link('http://localhost:8000/docs');
    expect(out).toContain('http://localhost:8000/docs\x1b]8;;');
  });
});
