/**
 * Timeline UX feature-flag helper.
 *
 * As of the Timeline UX redesign (PRs 1-10), the new UX is the **default**.
 * Set `WIZARD_OLD_UX=1` to explicitly opt back into the legacy path while
 * we burn down regressions; we plan to remove that escape hatch ~2 weeks
 * after the default flip ships, once the new path is at >=99% completion
 * rate (see `docs/design/timeline-ux-plan.md`).
 *
 * `WIZARD_NEW_UX=1` is retained as a no-op alias so older docs and dogfood
 * shell aliases keep working; it does not need to be set to enable the new
 * UX.
 *
 * Integration step for PRs 1-9: when those branches merge into
 * `feat/timeline-ux`, replace any `process.env.WIZARD_NEW_UX === '1'`
 * conditional with a call to `isNewUxEnabled()` from this module. The
 * ESLint `no-restricted-syntax` guard added in PR 10 prevents the legacy
 * status-string vocabulary from regressing once that sweep happens.
 */
export function isNewUxEnabled(): boolean {
  return process.env.WIZARD_OLD_UX !== '1';
}
