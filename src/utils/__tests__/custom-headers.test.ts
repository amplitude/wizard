import { describe, it, expect } from 'vitest';

import {
  createCustomHeaders,
  parseAnthropicCustomHeaderBlock,
} from '../custom-headers.js';

describe('parseAnthropicCustomHeaderBlock', () => {
  it('round-trips createCustomHeaders.encode()', () => {
    const h = createCustomHeaders();
    h.add('x-amp-wizard-session-id', 'abc');
    h.addFlag('wizard_test', 'on');
    const encoded = h.encode();
    expect(parseAnthropicCustomHeaderBlock(encoded)).toEqual({
      'x-amp-wizard-session-id': 'abc',
      'X-AMPLITUDE-FLAG-WIZARD_TEST': 'on',
    });
  });

  it('ignores blank lines and malformed lines', () => {
    expect(
      parseAnthropicCustomHeaderBlock('\nFoo: bar\nnot-a-header\n'),
    ).toEqual({
      Foo: 'bar',
    });
  });
});
