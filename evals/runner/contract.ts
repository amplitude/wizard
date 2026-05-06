/**
 * Runner-level envelope assertions for the NDJSON `--agent` stream.
 *
 * These checks fire BEFORE any scorer runs. A contract violation is a
 * runner-level error, not a scorer fail — it means we either crashed
 * mid-stream, emitted invalid JSON, or accidentally leaked a secret.
 * Treat any failure here as "the run did not produce a usable artifact."
 *
 * See docs/evals.md § "Contract points the runner enforces".
 */
import {
  AGENT_EVENT_WIRE_VERSION,
  type AgentEventEnvelope,
} from '../../src/lib/agent-events.js';
import { ExitCode } from '../../src/lib/exit-codes.js';

export interface ContractViolation {
  kind:
    | 'invalid_json'
    | 'wrong_envelope_version'
    | 'missing_run_completed'
    | 'multiple_run_completed'
    | 'setup_complete_outcome_mismatch'
    | 'exit_code_outcome_mismatch'
    | 'secret_leak'
    | 'unexpected_postlude';
  detail: string;
  /** Index into runLog when applicable. */
  index?: number;
}

/**
 * Parse one NDJSON line. Returns the envelope or throws an error the runner
 * surfaces as a contract violation. Throws (rather than returning a result)
 * so the parser hot path stays simple — callers wrap in try/catch.
 */
export function parseEnvelope(line: string): AgentEventEnvelope {
  const trimmed = line.trim();
  if (!trimmed) throw new Error('empty line');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('envelope is not an object');
  }
  const envelope = parsed as Partial<AgentEventEnvelope>;
  if (envelope.v !== AGENT_EVENT_WIRE_VERSION) {
    throw new Error(
      `wrong envelope version: expected ${AGENT_EVENT_WIRE_VERSION}, got ${String(
        envelope.v,
      )}`,
    );
  }
  if (typeof envelope.type !== 'string') {
    throw new Error('envelope.type missing');
  }
  return envelope as AgentEventEnvelope;
}

/**
 * Validate the captured run log + exit code as a single batch. Returns a
 * (possibly empty) array of violations. The runner halts the artifact build
 * if any violation is returned.
 */
export function assertRunContract(args: {
  runLog: AgentEventEnvelope[];
  exitCode: number;
  /** Concatenated stdout+stderr, AFTER NDJSON splitting — used for secret-leak grep. */
  rawOutput: string;
  apiKey: string;
}): ContractViolation[] {
  const { runLog, exitCode, rawOutput, apiKey } = args;
  const violations: ContractViolation[] = [];

  const completed = runLog.filter(
    (e) => isData(e) && e.data?.event === 'run_completed',
  );
  if (completed.length === 0) {
    violations.push({
      kind: 'missing_run_completed',
      detail: 'wizard exited without emitting run_completed (likely crashed)',
    });
    return violations; // remaining checks depend on run_completed
  }
  if (completed.length > 1) {
    violations.push({
      kind: 'multiple_run_completed',
      detail: `expected exactly 1 run_completed, got ${completed.length}`,
    });
  }

  const terminal = completed[completed.length - 1];
  const outcome = (terminal.data as { outcome?: string } | undefined)?.outcome;

  // setup_complete must (and only) accompany a successful run.
  const setupCompletes = runLog.filter(
    (e) => isData(e) && e.data?.event === 'setup_complete',
  );
  if (outcome === 'success' && setupCompletes.length !== 1) {
    violations.push({
      kind: 'setup_complete_outcome_mismatch',
      detail: `outcome=success but setup_complete count is ${setupCompletes.length}`,
    });
  }
  if (outcome !== 'success' && setupCompletes.length > 0) {
    violations.push({
      kind: 'setup_complete_outcome_mismatch',
      detail: `outcome=${String(outcome)} but setup_complete was emitted`,
    });
  }

  // Exit code must match outcome (per src/lib/exit-codes.ts).
  if (!exitCodeMatchesOutcome(exitCode, outcome)) {
    violations.push({
      kind: 'exit_code_outcome_mismatch',
      detail: `exitCode=${exitCode} does not match outcome=${String(outcome)}`,
    });
  }

  // Anything emitted AFTER run_completed is a contract violation —
  // run_completed must be terminal.
  const tailIndex = runLog.indexOf(terminal);
  if (tailIndex >= 0 && tailIndex !== runLog.length - 1) {
    violations.push({
      kind: 'unexpected_postlude',
      detail: `${
        runLog.length - 1 - tailIndex
      } events emitted after run_completed`,
      index: tailIndex,
    });
  }

  // Secret leak grep: full key + 16-char prefix. Short-circuits scoring.
  if (apiKey && rawOutput.length > 0) {
    const prefix = apiKey.slice(0, 16);
    if (rawOutput.includes(apiKey)) {
      violations.push({
        kind: 'secret_leak',
        detail: 'raw API key string appeared in stdout/stderr',
      });
    } else if (prefix.length >= 16 && rawOutput.includes(prefix)) {
      violations.push({
        kind: 'secret_leak',
        detail: 'API key 16-char prefix appeared in stdout/stderr',
      });
    }
  }

  return violations;
}

function isData(
  e: AgentEventEnvelope,
): e is AgentEventEnvelope<{ event?: string }> {
  return !!e.data && typeof e.data === 'object';
}

/**
 * Map a process exit code to the `outcome` field on `run_completed`. Mirrors
 * the table in src/lib/exit-codes.ts. Kept here (not imported) so a future
 * exit-code addition forces a deliberate update — the runner should not
 * silently accept an unknown code.
 */
function exitCodeMatchesOutcome(
  exitCode: number,
  outcome: string | undefined,
): boolean {
  if (outcome === 'success') return exitCode === ExitCode.SUCCESS;
  if (outcome === 'cancelled') return exitCode === ExitCode.USER_CANCELLED;
  if (outcome === 'error') {
    const errorCodes: number[] = [
      ExitCode.GENERAL_ERROR,
      ExitCode.AUTH_REQUIRED,
      ExitCode.NETWORK_ERROR,
      ExitCode.AGENT_FAILED,
      ExitCode.PROJECT_NAME_TAKEN,
      ExitCode.INPUT_REQUIRED,
      ExitCode.WRITE_REFUSED,
      ExitCode.INTERNAL_ERROR,
    ];
    return errorCodes.includes(exitCode);
  }
  return false;
}
