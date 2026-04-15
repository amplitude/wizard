import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const EVAL_LINE = `eval "$(amplitude-wizard completion)"`;
/** Substring used to detect whether the eval line is already present. */
const MARKER = 'amplitude-wizard completion';

type SupportedShell = 'zsh' | 'bash';

export function detectShell(): SupportedShell | null {
  const shell = process.env.SHELL ?? '';
  if (shell.endsWith('zsh')) return 'zsh';
  if (shell.endsWith('bash')) return 'bash';
  return null;
}

function getRcFile(shell: SupportedShell): string {
  const home = os.homedir();
  if (shell === 'zsh') return path.join(home, '.zshrc');
  // On macOS bash sessions are login shells; prefer .bash_profile if present.
  const bashProfile = path.join(home, '.bash_profile');
  if (fs.existsSync(bashProfile)) return bashProfile;
  return path.join(home, '.bashrc');
}

// Inject shell variable syntax (${) without triggering TS template interpolation.
const DB = '${';

export const ZSH_COMPLETION_SCRIPT = `###-begin-amplitude-wizard-completions-###

_amplitude_wizard() {
  local state
  local -a commands global_opts wizard_opts

  commands=(
    'login:Log in to your Amplitude account'
    'logout:Log out of your Amplitude account'
    'whoami:Show the currently logged-in Amplitude account'
    'feedback:Send product feedback'
    'slack:Set up Amplitude Slack integration'
    'mcp:MCP server management commands'
    'completion:Print shell completion script'
  )

  global_opts=(
    '--debug[Enable verbose logging]'
    '--verbose[Print diagnostic info to the run log]'
    '--signup[Create a new Amplitude account during setup]'
    '--email[Email for headless signup (used with --signup)]:email:'
    '--full-name[Full name for headless signup (used with --signup)]:name:'
    '--ci[Enable non-interactive CI mode]'
    '--api-key[Amplitude project API key]:key:'
    '--project-id[Amplitude project ID]:id:'
    '--local-mcp[Use local MCP server at http://localhost:8787/mcp]'
    {-h,--help}'[Show help]'
    {-v,--version}'[Show version]'
  )

  wizard_opts=(
    '--force-install[Force package install even if peer checks fail]'
    '--install-dir[Directory to install Amplitude in]:dir:_files -/'
    '--integration[Framework integration to set up]:integration:(nextjs vue react-router django flask fastapi javascript_web javascript_node python)'
    '--menu[Show integration selection menu instead of auto-detecting]'
    '--benchmark[Run in benchmark mode with per-phase token tracking]'
  )

  _arguments -C \\
    '1: :->cmd' \\
    '*:: :->args'

  case $state in
    cmd)
      _describe 'command' commands
      _arguments $global_opts $wizard_opts
      ;;
    args)
      case ${DB}words[1]} in
        mcp)
          local -a mcp_cmds
          mcp_cmds=('add:Install Amplitude MCP server' 'remove:Remove Amplitude MCP server')
          _arguments -C '1: :->sub' '*:: :->subargs'
          case $state in
            sub) _describe 'mcp command' mcp_cmds ;;
            subargs) _arguments '--local[Use local MCP server at http://localhost:8787]' ;;
          esac
          ;;
        login)
          _arguments '--zone[Amplitude data center zone]:zone:(us eu)'
          ;;
        feedback)
          _arguments '--message[Feedback message]:message:' '-m[Feedback message]:message:'
          ;;
        *)
          _arguments $global_opts $wizard_opts
          ;;
      esac
      ;;
  esac
}

(( $+functions[compdef] )) || { autoload -Uz compinit; compinit; }
compdef _amplitude_wizard amplitude-wizard
###-end-amplitude-wizard-completions-###`;

export const BASH_COMPLETION_SCRIPT = `###-begin-amplitude-wizard-completions-###
_amplitude_wizard_completions() {
  local cur prev
  cur="${DB}COMP_WORDS[COMP_CWORD]}"
  prev="${DB}COMP_WORDS[COMP_CWORD-1]}"

  local commands="login logout whoami feedback slack mcp completion"
  local global_flags="--debug --verbose --signup --email --full-name --ci --api-key --project-id --local-mcp --help --version"
  local wizard_flags="--force-install --install-dir --integration --menu --benchmark"
  local integrations="nextjs vue react-router django flask fastapi javascript_web javascript_node python"

  if [[ ${DB}COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands $global_flags $wizard_flags" -- "$cur"))
    return
  fi

  case "${DB}COMP_WORDS[1]}" in
    mcp)
      if [[ ${DB}COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=($(compgen -W "add remove" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "--local" -- "$cur"))
      fi
      ;;
    login)
      if [[ "$prev" == "--zone" ]]; then
        COMPREPLY=($(compgen -W "us eu" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "--zone" -- "$cur"))
      fi
      ;;
    feedback)
      COMPREPLY=($(compgen -W "--message -m" -- "$cur"))
      ;;
    *)
      if [[ "$prev" == "--integration" ]]; then
        COMPREPLY=($(compgen -W "$integrations" -- "$cur"))
      elif [[ "$prev" == "--install-dir" ]]; then
        COMPREPLY=($(compgen -d -- "$cur"))
      else
        COMPREPLY=($(compgen -W "$global_flags $wizard_flags" -- "$cur"))
      fi
      ;;
  esac
}
complete -F _amplitude_wizard_completions amplitude-wizard
###-end-amplitude-wizard-completions-###`;

/**
 * Silently appends `eval "$(amplitude-wizard completion)"` to the user's shell
 * RC file if it isn't already there.  Call fire-and-forget at startup.
 */
export function installCompletions(): void {
  try {
    const shell = detectShell();
    if (!shell) return;

    const rcFile = getRcFile(shell);

    if (fs.existsSync(rcFile)) {
      const contents = fs.readFileSync(rcFile, 'utf-8');
      if (contents.includes(MARKER)) return; // already installed
    }

    const line = `\n# Amplitude Wizard shell completions\n${EVAL_LINE}\n`;
    fs.appendFileSync(rcFile, line, 'utf-8');
  } catch {
    // Never surface completion-install errors to the user.
  }
}
