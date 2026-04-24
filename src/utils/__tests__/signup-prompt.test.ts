import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptForMissingSignupFields } from '../signup-prompt';

const mockSelect = vi.fn();
const mockInput = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  input: (...args: unknown[]) => mockInput(...args),
}));

function makeSession(
  overrides: Partial<{
    signup: boolean;
    signupEmail: string | null;
    signupFullName: string | null;
    region: 'us' | 'eu' | null;
  }> = {},
) {
  return {
    signup: true,
    signupEmail: null,
    signupFullName: null,
    region: null,
    ...overrides,
  };
}

describe('promptForMissingSignupFields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prompts for all three fields when all are missing, in order region → full name → email', async () => {
    const session = makeSession();
    mockSelect.mockResolvedValueOnce('us');
    mockInput
      .mockResolvedValueOnce('Jane Doe')
      .mockResolvedValueOnce('jane@example.com');

    await promptForMissingSignupFields(session as never);

    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(session.region).toBe('us');
    expect(session.signupFullName).toBe('Jane Doe');
    expect(session.signupEmail).toBe('jane@example.com');
  });

  it('prompts only for email when region and fullName are already set', async () => {
    const session = makeSession({
      region: 'us',
      signupFullName: 'Jane Doe',
      signupEmail: null,
    });
    mockInput.mockResolvedValueOnce('jane@example.com');

    await promptForMissingSignupFields(session as never);

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInput).toHaveBeenCalledOnce();
    expect(session.signupEmail).toBe('jane@example.com');
  });

  it('does nothing when signup is false', async () => {
    const session = makeSession({ signup: false });

    await promptForMissingSignupFields(session as never);

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it('email validator rejects invalid email and accepts valid email', async () => {
    const session = makeSession({
      region: 'us',
      signupFullName: 'Jane Doe',
      signupEmail: null,
    });
    mockInput.mockResolvedValueOnce('jane@example.com');

    await promptForMissingSignupFields(session as never);

    const emailCall = mockInput.mock.calls[0][0] as {
      validate: (v: string) => boolean | string;
    };
    expect(emailCall.validate('not-an-email')).not.toBe(true);
    expect(typeof emailCall.validate('not-an-email')).toBe('string');
    expect(emailCall.validate('jane@example.com')).toBe(true);
  });

  it('full-name validator rejects whitespace-only and accepts real names', async () => {
    const session = makeSession({
      region: 'us',
      signupFullName: null,
      signupEmail: null,
    });
    mockInput
      .mockResolvedValueOnce('Jane Doe')
      .mockResolvedValueOnce('jane@example.com');

    await promptForMissingSignupFields(session as never);

    const nameCall = mockInput.mock.calls[0][0] as {
      validate: (v: string) => boolean | string;
    };
    expect(nameCall.validate('   ')).not.toBe(true);
    expect(typeof nameCall.validate('   ')).toBe('string');
    expect(nameCall.validate('Jane')).toBe(true);
  });

  it('trims full name before writing to session', async () => {
    const session = makeSession({
      region: 'us',
      signupFullName: null,
      signupEmail: 'jane@example.com',
    });
    mockInput.mockResolvedValueOnce('  Jane Doe  ');

    await promptForMissingSignupFields(session as never);

    expect(session.signupFullName).toBe('Jane Doe');
  });

  it('trims email before writing to session', async () => {
    const session = makeSession({
      region: 'us',
      signupFullName: 'Jane Doe',
      signupEmail: null,
    });
    mockInput.mockResolvedValueOnce('  jane@example.com  ');

    await promptForMissingSignupFields(session as never);

    expect(session.signupEmail).toBe('jane@example.com');
  });
});
