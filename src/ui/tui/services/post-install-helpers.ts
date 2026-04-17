/**
 * Small helpers we run after MCP install to reduce the number of things the
 * user has to do manually (launch each installed GUI app so the user just
 * has to click Allow in the OAuth dialog, etc.).
 *
 * All helpers are best-effort: they return a boolean for the UI, and any
 * failure (unknown app name, etc.) is silently swallowed.
 */

import { spawn } from 'child_process';

/** Map our detected-client names to the OS-level launcher command. */
const CLIENT_APP_NAMES: Record<string, string> = {
  Cursor: 'Cursor',
  'Claude Desktop': 'Claude',
  'Visual Studio Code': 'Visual Studio Code',
  Zed: 'Zed',
};

/**
 * Launch the GUI app for a given client name. Claude Code is a CLI and can't
 * be launched this way — callers should skip it.
 *
 * Returns true if we dispatched the launch; false if the platform or app is
 * unknown. Never throws.
 */
export function launchAppForClient(clientName: string): boolean {
  const appName = CLIENT_APP_NAMES[clientName];
  if (!appName) return false;
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', appName], {
        stdio: 'ignore',
        detached: true,
      }).unref();
      return true;
    }
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', appName], {
        stdio: 'ignore',
        detached: true,
      }).unref();
      return true;
    }
    // Linux: no reliable cross-distro way. Skip.
    return false;
  } catch {
    return false;
  }
}
