/**
 * HotkeyPills — backward-compat shim.
 *
 * The implementation moved to `ScreenHotkeyBar.tsx` as part of the
 * timeline-ux refactor. This file is preserved for one release so
 * existing import sites (`../components/HotkeyPills.js`) keep
 * compiling. New code should import `ScreenHotkeyBar` directly.
 *
 * @deprecated Use `ScreenHotkeyBar` from `./ScreenHotkeyBar.js` —
 * removed next release.
 */

export { HotkeyPills, type HotkeyPill } from './ScreenHotkeyBar.js';
