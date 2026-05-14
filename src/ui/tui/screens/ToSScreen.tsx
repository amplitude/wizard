/**
 * ToSScreen — Terms of Service acceptance on the create-account onboarding path
 * (`--auth-onboarding create-account`; legacy alias: `--signup`).
 *
 * Pattern inspired by Stripe CLI: presents terms and privacy policy
 * links, requires explicit acceptance before proceeding to authentication.
 *
 * URL source: reads `session.legalDocumentBundle`, populated by the parser
 * in `direct-signup.ts` from either the BE-supplied
 * `needs_information.terms_acceptance.documents` (BE flag ON) or local
 * constants via the parser's spoof block (BE flag OFF). The screen never
 * touches `TERMS_OF_SERVICE_URL` / `PRIVACY_POLICY_URL` directly — the
 * parser is the single boundary that decides URL origin.
 */

import { Box, Text } from 'ink';
import type { WizardStore } from '../store.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { useEscapeBack } from '../hooks/useEscapeBack.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors, Icons } from '../styles.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import {
  KNOWN_DOC_KINDS,
  type DocKind,
} from '../../../utils/direct-signup.js';

const TOS_EXTRA_HINTS: readonly KeyHint[] = Object.freeze([
  { key: '↑↓', label: 'Navigate' },
  { key: 'Enter', label: 'Select' },
]);

const DOC_LABELS: Record<DocKind, string> = {
  terms_of_service: 'Terms of Service',
  privacy_policy: 'Privacy Policy',
};

interface ToSScreenProps {
  store: WizardStore;
}

const OPTIONS = [
  {
    label: 'I accept the Terms of Service and Privacy Policy',
    value: 'accept',
  },
  {
    label: 'I do not accept',
    value: 'decline',
  },
];

export const ToSScreen = ({ store }: ToSScreenProps) => {
  useWizardStore(store);
  useEscapeBack(store, { extraHints: TOS_EXTRA_HINTS });

  const handleSelect = (value: string | string[]) => {
    const choice = Array.isArray(value) ? value[0] : value;
    if (choice === 'accept') {
      store.acceptTermsOfService();
    } else {
      store.cancelWizard('Terms of Service not accepted');
    }
  };

  // The flow's `ToS.show` predicate gates on
  // `'terms_acceptance' in signupRequiredFields`, which the parser
  // ensures iff `legalDocumentBundle` is populated. Within this render,
  // the bundle is invariant non-null — but TypeScript needs an explicit
  // narrowing guard. The early-return is defensive: if the invariant
  // ever breaks (predicate weakened, parser bug), the screen renders
  // nothing instead of crashing on a null access.
  const urls = store.session.legalDocumentBundle;
  if (urls === null) {
    return null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.heading}>
          Terms of Service
        </Text>
        <Text color={Colors.muted}>
          By continuing, you agree to Amplitude&apos;s terms
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          Please review and accept our{' '}
          <Text color={Colors.accent}>Terms of Service</Text> and{' '}
          <Text color={Colors.accent}>Privacy Policy</Text> to continue:
        </Text>
        <Box marginTop={1} flexDirection="column">
          {KNOWN_DOC_KINDS.map((kind) => (
            <Text key={kind} color={Colors.muted}>
              {Icons.arrowRight} {DOC_LABELS[kind]}: {urls[kind]}
            </Text>
          ))}
        </Box>
      </Box>

      <PickerMenu<string> options={OPTIONS} onSelect={handleSelect} />

      <Box marginTop={1}>
        <Text color={Colors.muted}>
          {Icons.dot} This is required to create an Amplitude account
        </Text>
      </Box>
    </Box>
  );
};
