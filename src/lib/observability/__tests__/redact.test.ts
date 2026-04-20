import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { redact, redactString } from '../redact';

describe('redactString', () => {
  it('redacts JWTs', () => {
    const jwt =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(`token: ${jwt}`)).toBe('token: [REDACTED_JWT]');
  });

  it('redacts Bearer tokens', () => {
    expect(redactString('Authorization: Bearer abc123xyz')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('redacts long hex strings (API keys)', () => {
    const key = 'e5a2c9bdffe949f7da77e6b481e118fa';
    expect(redactString(`key=${key}`)).toBe('key=[REDACTED_KEY]');
  });

  it('redacts absolute file paths', () => {
    expect(
      redactString('Error at /Users/kelson/projects/app/src/index.ts'),
    ).toBe('Error at [~]/...');
    expect(redactString('file: /home/runner/work/wizard/src/lib/foo.ts')).toBe(
      'file: [~]/...',
    );
  });

  it('preserves non-sensitive strings', () => {
    expect(redactString('Detected Next.js 15.2')).toBe('Detected Next.js 15.2');
    expect(redactString('Framework: react-router')).toBe(
      'Framework: react-router',
    );
  });

  it('handles empty strings', () => {
    expect(redactString('')).toBe('');
  });
});

describe('redact (deep)', () => {
  it('redacts sensitive object keys', () => {
    const input = {
      accessToken: 'secret-token-value',
      refreshToken: 'refresh-secret',
      host: 'https://api2.amplitude.com',
      appId: 12345,
    };
    const result = redact(input) as Record<string, unknown>;
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
    expect(result.host).toBe('https://api2.amplitude.com');
    expect(result.appId).toBe(12345);
  });

  it('redacts nested objects', () => {
    const input = {
      credentials: {
        apiKey: 'e5a2c9bdffe949f7da77e6b481e118fa',
        host: 'https://api.amplitude.com',
      },
    };
    const result = redact(input) as Record<string, Record<string, unknown>>;
    expect(result.credentials.apiKey).toBe('[REDACTED]');
    expect(result.credentials.host).toBe('https://api.amplitude.com');
  });

  it('redacts arrays', () => {
    const input = [{ api_key: 'secret123' }, 'Bearer mytoken'];
    const result = redact(input) as unknown[];
    expect((result[0] as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect(result[1]).toBe('Bearer [REDACTED]');
  });

  it('redacts apiKey (camelCase) in create-project success payloads', () => {
    // Ensures project_create_success NDJSON events never leak the key.
    const input = {
      event: 'project_create_success',
      appId: '12345',
      name: 'My Project',
      apiKey: 'a1b2c3d4e5f6789012345678',
    };
    const result = redact(input) as Record<string, unknown>;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.appId).toBe('12345');
    expect(result.name).toBe('My Project');
  });

  it('redacts projectApiKey in credential-like objects', () => {
    const input = {
      credentials: {
        projectApiKey: 'secret-project-key',
        idToken: 'tok',
        host: 'https://api.amplitude.com',
      },
    };
    const result = redact(input) as Record<string, Record<string, unknown>>;
    expect(result.credentials.projectApiKey).toBe('[REDACTED]');
    expect(result.credentials.idToken).toBe('[REDACTED]');
    expect(result.credentials.host).toBe('https://api.amplitude.com');
  });

  it('handles null and undefined', () => {
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('handles primitives', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });

  it('truncates deeply nested objects', () => {
    let obj: Record<string, unknown> = { value: 'deep' };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    const result = JSON.stringify(redact(obj));
    expect(result).toContain('[TRUNCATED]');
  });
});

describe('redact (property-based)', () => {
  it('never leaks JWTs through redaction', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (prefix) => {
        const jwt =
          'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwp';
        const input = `${prefix} ${jwt} suffix`;
        const result = redactString(input);
        expect(result).not.toContain('eyJhbGci');
      }),
    );
  });

  it('never leaks Bearer tokens through redaction', () => {
    fc.assert(
      fc.property(
        // Generate realistic token strings (alphanumeric + common token chars)
        fc.stringMatching(/^[a-zA-Z0-9._-]{10,50}$/),
        (token) => {
          const input = `Bearer ${token}`;
          const result = redactString(input);
          expect(result).not.toContain(token);
        },
      ),
    );
  });

  it('never leaks home directory paths', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z/_.-]{5,30}$/), (pathSuffix) => {
        if (!pathSuffix || pathSuffix === '/') return;
        const input = `/Users/testuser/${pathSuffix}`;
        const result = redactString(input);
        expect(result).not.toContain('/Users/testuser');
      }),
    );
  });

  it('preserves non-sensitive strings unchanged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z ]{1,20}$/), (str) => {
        // Short alphanumeric strings with spaces should pass through
        const result = redactString(str);
        expect(result).toBe(str);
      }),
    );
  });
});
