export type ExecutionMode = 'interactive' | 'ci' | 'agent';

export interface ModeConfig {
  mode: ExecutionMode;
  autoApprove: boolean;
  jsonOutput: boolean;
  quiet: boolean;
}

export function resolveMode(opts: {
  ci?: boolean;
  yes?: boolean;
  agent?: boolean;
  json?: boolean;
  isTTY: boolean;
}): ModeConfig {
  const isAgent = Boolean(opts.agent);
  const autoApprove = opts.yes || opts.ci || isAgent;
  const isInteractive = !autoApprove && opts.isTTY;

  return {
    mode: isAgent ? 'agent' : isInteractive ? 'interactive' : 'ci',
    autoApprove,
    jsonOutput: opts.json ?? isAgent,
    quiet: !opts.isTTY,
  };
}
