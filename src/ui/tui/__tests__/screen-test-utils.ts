import { WizardStore } from '../store.js';
import { buildSession } from '../../../lib/wizard-session.js';
import type { WizardSession } from '../../../lib/wizard-session.js';

/**
 * Constructs a WizardStore suitable for screen unit tests. Starts from a
 * default-built session and applies the given overrides. Analytics is
 * mocked separately per test file (see the vi.mock call in each test).
 */
export function makeScreenTestStore(
  overrides: Partial<WizardSession> = {},
): WizardStore {
  const store = new WizardStore();
  store.session = { ...buildSession({}), ...overrides };
  return store;
}
