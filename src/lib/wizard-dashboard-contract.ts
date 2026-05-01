/**
 * Shared contract bits for the wizard-proxy `POST /dashboards`.
 * Keep in sync with `wizard-proxy/create-dashboard.ts` (javascript monorepo).
 */

export const WIZARD_DASHBOARD_EVENT_CATEGORIES = [
  'SIGNUP',
  'ACTIVATION',
  'ENGAGEMENT',
  'CONVERSION',
  'OTHER',
] as const;

export type WizardDashboardEventCategory =
  (typeof WIZARD_DASHBOARD_EVENT_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(WIZARD_DASHBOARD_EVENT_CATEGORIES);

export function isWizardDashboardEventCategory(
  value: string | undefined,
): value is WizardDashboardEventCategory {
  return value !== undefined && CATEGORY_SET.has(value);
}
