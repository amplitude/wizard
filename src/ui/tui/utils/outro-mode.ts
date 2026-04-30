/**
 * Tiny helper for the OutroScreen — should the retry hint be advertised?
 *
 * The OutroScreen is only mounted by the Ink TUI (`start-tui.ts`), so in
 * practice it always runs in interactive mode. CI and agent invocations
 * use `LoggingUI` / `AgentUI` instead and never render React. Still, we
 * gate the hint on an explicit interactive check so:
 *
 *   - any future code path that mounts the screen in a non-TTY context
 *     won't accidentally advertise a hotkey the user can't press;
 *   - tests can mock this module to assert the hint renders / doesn't.
 *
 * "Interactive" here means stdin AND stdout are TTYs and we weren't
 * launched in agent mode via env var.
 */
export function isInteractiveOutro(): boolean {
  if (process.env.AMPLITUDE_WIZARD_AGENT === '1') return false;
  if (!process.stdout.isTTY) return false;
  if (!process.stdin.isTTY) return false;
  return true;
}
