import { createContext } from 'react';

/** True when the user is actively typing a slash command in the command bar. */
export const CommandModeContext = createContext(false);
