/**
 * NDJSON stream parser + contract assertions.
 *
 * The wizard's `--agent` mode is the SDK eval surface. Every line is a
 * structured `AgentEventEnvelope` (`src/lib/agent-events.ts`). This
 * module:
 *
 *   1. Parses NDJSON into envelopes, dropping malformed lines into
 *      `parseErrors` rather than throwing — a single bad line should
 *      not fail the run, but a flood of them is signal.
 *   2. Validates the envelope version (`v: 1`).
 *   3. Captures the terminal `run_completed` event and (optionally)
 *      the preceding `setup_complete` event.
 *   4. Asserts the four runner contract points from `docs/evals.md`:
 *
 *        a. Every line has `v === 1`.
 *        b. Exactly one `run_completed` event before EOF.
 *        c. `setup_complete` matches outcome:
 *             - success → exactly one `setup_complete` precedes
 *             - failed/cancelled → no `setup_complete`
 *        d. Process exit code is consistent with the outcome per
 *           `src/lib/exit-codes.ts`.
 *
 * The fifth contract point (no raw secrets in stdout/stderr) lives in
 * Layer 0 scorers, not here — secret redaction is a scoring concern,
 * not a parse-time concern. The runner short-circuits on a hit there.
 */

import type {
  AgentEventEnvelope,
  RunCompletedData,
  SetupCompleteData,
} from '../../src/lib/agent-events.js';
import { AGENT_EVENT_WIRE_VERSION } from '../../src/lib/agent-events.js';
import { ExitCode } from '../../src/lib/exit-codes.js';

export interface ParsedStream {
  /** Parsed envelopes, in stream order. */
  events: AgentEventEnvelope[];
  /** Raw lines that failed to parse, with line-number context. */
  parseErrors: Array<{ line: number; raw: string; reason: string }>;
  /** The terminal run_completed event, if present. */
  runCompleted: AgentEventEnvelope<RunCompletedData> | undefined;
  /** The setup_complete event, if present. */
  setupComplete: AgentEventEnvelope<SetupCompleteData> | undefined;
}

export interface ContractViolation {
  /** Stable code so reports can branch on the violation. */
  code:
    | 'envelope_version_mismatch'
    | 'missing_run_completed'
    | 'multiple_run_completed'
    | 'missing_setup_complete'
    | 'unexpected_setup_complete'
    | 'multiple_setup_complete'
    | 'exit_code_outcome_mismatch';
  message: string;
  /** Optional 1-based line number for the offending event. */
  line?: number;
}

export interface ContractCheckResult {
  ok: boolean;
  violations: ContractViolation[];
}

/**
 * Discriminate an envelope's `data.event` field. The wire format
 * stamps a string discriminator on every lifecycle/result/error
 * event; we use it to find terminal events without trusting the
 * outer `type`/`message` fields.
 */
function eventDiscriminator(env: AgentEventEnvelope): string | undefined {
  const data = env.data as { event?: unknown } | undefined;
  if (data && typeof data.event === 'string') return data.event;
  return undefined;
}

/**
 * Parse an NDJSON stream into structured events. Tolerates blank
 * lines and trailing whitespace; rejects malformed JSON or non-object
 * payloads into `parseErrors` so the caller can surface them in the
 * report without aborting the whole run.
 */
export function parseStream(raw: string): ParsedStream {
  const events: AgentEventEnvelope[] = [];
  const parseErrors: ParsedStream['parseErrors'] = [];
  let runCompleted: ParsedStream['runCompleted'];
  let setupComplete: ParsedStream['setupComplete'];

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      parseErrors.push({
        line: i + 1,
        raw: line.slice(0, 200),
        reason: err instanceof Error ? err.message : 'unknown JSON parse error',
      });
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parseErrors.push({
        line: i + 1,
        raw: line.slice(0, 200),
        reason: 'envelope is not a JSON object',
      });
      continue;
    }

    const env = parsed as AgentEventEnvelope;
    events.push(env);

    const discriminator = eventDiscriminator(env);
    if (discriminator === 'run_completed') {
      runCompleted = env as AgentEventEnvelope<RunCompletedData>;
    } else if (discriminator === 'setup_complete') {
      setupComplete = env as AgentEventEnvelope<SetupCompleteData>;
    }
  }

  return { events, parseErrors, runCompleted, setupComplete };
}

/**
 * Map a {@link RunCompletedData.outcome} value to the set of exit
 * codes that are valid for it. Mirrors `src/lib/exit-codes.ts` —
 * keep these in sync. The runner asserts the actual exit code lands
 * in this set; a mismatch indicates the wizard's exit funnel and the
 * NDJSON terminal event have drifted apart, which is a real bug.
 */
function validExitCodesForOutcome(outcome: string): number[] {
  switch (outcome) {
    case 'success':
      return [ExitCode.SUCCESS];
    case 'cancelled':
      return [ExitCode.USER_CANCELLED];
    case 'error':
      // Any non-success, non-cancel exit code is consistent with
      // outcome === 'error'. We allow the full failure set rather
      // than enumerate; specific exit-code semantics belong on the
      // wizard side, not in the eval contract.
      return [
        ExitCode.GENERAL_ERROR,
        ExitCode.INVALID_ARGS,
        ExitCode.AUTH_REQUIRED,
        ExitCode.NETWORK_ERROR,
        ExitCode.AGENT_FAILED,
        ExitCode.PROJECT_NAME_TAKEN,
        ExitCode.INPUT_REQUIRED,
        ExitCode.WRITE_REFUSED,
        ExitCode.INTERNAL_ERROR,
      ];
    default:
      return [];
  }
}

/**
 * Assert the four runner contract points against a parsed stream and
 * the observed exit code. Returns a list of violations rather than
 * throwing — the runner can decide whether to short-circuit (a
 * violation is a runner-level error, not a scorer fail), and the
 * report carries the violations so triage doesn't have to dig.
 */
export function assertContract(
  parsed: ParsedStream,
  exitCode: number,
): ContractCheckResult {
  const violations: ContractViolation[] = [];

  // 1) Envelope version. Every parsed event must declare v=1.
  for (let i = 0; i < parsed.events.length; i++) {
    const env = parsed.events[i];
    if (env.v !== AGENT_EVENT_WIRE_VERSION) {
      violations.push({
        code: 'envelope_version_mismatch',
        message: `envelope v=${String(env.v)} (expected ${String(
          AGENT_EVENT_WIRE_VERSION,
        )})`,
        line: i + 1,
      });
    }
  }

  // 2) Exactly one run_completed before EOF.
  const runCompletedCount = parsed.events.filter(
    (e) => eventDiscriminator(e) === 'run_completed',
  ).length;
  if (runCompletedCount === 0) {
    violations.push({
      code: 'missing_run_completed',
      message:
        'stream ended without a run_completed event — wizard crashed mid-stream',
    });
  } else if (runCompletedCount > 1) {
    violations.push({
      code: 'multiple_run_completed',
      message: `expected exactly one run_completed, saw ${runCompletedCount}`,
    });
  }

  // 3) setup_complete consistent with outcome.
  const setupCompleteCount = parsed.events.filter(
    (e) => eventDiscriminator(e) === 'setup_complete',
  ).length;
  const outcome = parsed.runCompleted?.data?.outcome;
  if (outcome === 'success') {
    if (setupCompleteCount === 0) {
      violations.push({
        code: 'missing_setup_complete',
        message:
          'run_completed.outcome=success but no setup_complete preceded it',
      });
    } else if (setupCompleteCount > 1) {
      violations.push({
        code: 'multiple_setup_complete',
        message: `expected exactly one setup_complete on success, saw ${setupCompleteCount}`,
      });
    }
  } else if (outcome === 'error' || outcome === 'cancelled') {
    if (setupCompleteCount > 0) {
      violations.push({
        code: 'unexpected_setup_complete',
        message: `run_completed.outcome=${outcome} but setup_complete was emitted (${setupCompleteCount})`,
      });
    }
  }

  // 4) Exit code matches outcome.
  if (parsed.runCompleted) {
    const valid = validExitCodesForOutcome(outcome ?? '');
    if (valid.length > 0 && !valid.includes(exitCode)) {
      violations.push({
        code: 'exit_code_outcome_mismatch',
        message: `exit code ${exitCode} not consistent with run_completed.outcome=${String(
          outcome,
        )} (expected one of ${valid.join(', ')})`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
