import type { WizardSession } from '../lib/wizard-session.js';
import { EMAIL_REGEX } from '../lib/constants.js';
import { tryResolveZone } from '../lib/zone-resolution.js';

export async function promptForMissingSignupFields(
  session: WizardSession,
): Promise<void> {
  if (!session.accountCreationFlow) return;

  const { select, input } = await import('@inquirer/prompts');

  if (tryResolveZone(session) === null) {
    const region = await select({
      message: 'Which Amplitude data region should your new account live in?',
      choices: [
        { name: 'United States (app.amplitude.com)', value: 'us' as const },
        { name: 'Europe (app.eu.amplitude.com)', value: 'eu' as const },
      ],
    });
    session.region = region;
  }

  if (session.signupFullName === null) {
    const fullName = await input({
      message: 'What name should we use for your new Amplitude account?',
      validate: (v: string) =>
        v.trim().length > 0 || 'Full name cannot be empty',
    });
    session.signupFullName = fullName.trim();
  }

  if (session.signupEmail === null) {
    const email = await input({
      message: 'What email should we use for your new Amplitude account?',
      validate: (v: string) =>
        EMAIL_REGEX.test(v.trim()) || 'Please enter a valid email',
    });
    session.signupEmail = email.trim();
  }
}
