/** Re-export v1 console commands with user-facing filtering. */
import { COMMANDS as V1_COMMANDS } from '../tui/console-commands.js';
export {
  getWhoamiText,
  parseFeedbackSlashInput,
  TEST_PROMPT,
} from '../tui/console-commands.js';

export const COMMANDS = V1_COMMANDS.filter((c) => c.cmd !== '/test').map((c) =>
  c.cmd === '/feedback' ? { cmd: c.cmd, desc: 'Send product feedback' } : c,
);
