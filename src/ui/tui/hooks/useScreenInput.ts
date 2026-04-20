/**
 * useScreenInput — A wrapper around Ink's useInput that automatically
 * deactivates when the slash command bar is in command mode.
 *
 * Use this instead of useInput in all screen components so that
 * typed characters don't trigger screen actions while the user is
 * typing a slash command.
 */

import { useInput } from 'ink';
import { useContext } from 'react';
import { CommandModeContext } from '../context/CommandModeContext.js';

type UseInputHandler = Parameters<typeof useInput>[0];
type UseInputOptions = Parameters<typeof useInput>[1];

export function useScreenInput(
  handler: UseInputHandler,
  options?: UseInputOptions,
): void {
  const commandMode = useContext(CommandModeContext);
  useInput(handler, {
    ...options,
    isActive: !commandMode && (options?.isActive ?? true),
  });
}
