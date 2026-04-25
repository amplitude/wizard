// Barrel export for every CommandModule registered by bin.ts. Adding a new
// command? Create src/commands/<name>.ts exporting a CommandModule, then
// register it here and in bin.ts's `.command(...)` chain.

export { defaultCommand } from './default';
export { loginCommand } from './login';
export { logoutCommand } from './logout';
export { whoamiCommand } from './whoami';
export { feedbackCommand } from './feedback';
export { slackCommand } from './slack';
export { regionCommand } from './region';
export { detectCommand } from './detect';
export { statusCommand } from './status';
export { authCommand } from './auth';
export { mcpCommand } from './mcp';
export { manifestCommand } from './manifest';
