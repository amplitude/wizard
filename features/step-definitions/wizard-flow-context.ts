/**
 * Shared mutable context for wizard-flow step definition files.
 * Both wizard-flow.steps.ts and wizard-overlays.steps.ts import this object.
 * The Before hook in wizard-flow.steps.ts resets it each scenario.
 */
import { WizardRouter } from '../../src/ui/tui/router.js';
import { buildSession, type WizardSession } from '../../src/lib/wizard-session.js';
import { Flow } from '../../src/ui/tui/flows.js';

export const ctx: { router: WizardRouter; session: WizardSession } = {
  router: new WizardRouter(Flow.Wizard),
  session: buildSession({}),
};
