/**
 * Golden snapshot test for AgentUI NDJSON output.
 *
 * Pins the bytes emitted on stdout for every public emit method on
 * AgentUI. Any refactor that changes the wire format — even a property
 * rename, field-order shift inside `data`, or a missing field — will
 * mismatch the snapshot and fail in CI.
 *
 * Output is normalized by stripping nondeterministic fields:
 *   - `@timestamp` (changes per run)
 *   - `session_id` and `run_id` (random UUIDs minted by
 *     `initCorrelation`; would diff across runs)
 *
 * Everything else (`v`, `type`, `message`, `level`, `data`,
 * `data_version`) is part of the orchestrator-facing contract and
 * MUST stay stable across refactors.
 *
 * If you intentionally change the wire shape, update the inline
 * snapshot AND bump `EVENT_DATA_VERSIONS` for the affected event in
 * `src/lib/agent-events.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import { __resetDecisionIdCounterForTests } from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp'?: string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  data_version?: number;
  level?: string;
}

/**
 * Capture stdout writes, strip nondeterministic fields (`@timestamp`,
 * `session_id`, `run_id`) and return parsed envelopes. Pinning these
 * three would require booting `initCorrelation` (which mints a fresh
 * UUID per call) under a deterministic UUID stub. Easier and equally
 * load-bearing for a wire-shape test: drop the three runtime-id fields
 * and snapshot everything else.
 */
function setupCapture(): { writes: NDJSONEvent[]; restore: () => void } {
  const writes: NDJSONEvent[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString();
      for (const line of s.split('\n')) {
        if (!line) continue;
        const ev = JSON.parse(line) as NDJSONEvent;
        delete ev['@timestamp'];
        delete ev.session_id;
        delete ev.run_id;
        writes.push(ev);
      }
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
}

describe('AgentUI golden snapshot — NDJSON wire shape', () => {
  let writes: NDJSONEvent[];
  let restore: () => void;
  let ui: AgentUI;

  beforeEach(() => {
    ({ writes, restore } = setupCapture());
    __resetDecisionIdCounterForTests();
    ui = new AgentUI();
  });

  afterEach(() => restore());

  it('intro / outro / cancel', async () => {
    ui.intro('Welcome');
    ui.outro('Bye');
    await ui.cancel('Canceled', { docsUrl: 'https://example.com/docs' });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "intro",
          },
          "data_version": 1,
          "message": "Welcome",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "outro",
          },
          "data_version": 1,
          "message": "Bye",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "docsUrl": "https://example.com/docs",
            "event": "cancel",
          },
          "data_version": 1,
          "message": "Canceled",
          "type": "lifecycle",
          "v": 1,
        },
      ]
    `);
  });

  it('startRun / emitRunPhase / emitRunCompleted', () => {
    ui.startRun();
    ui.emitRunPhase('cold_start');
    ui.emitRunPhase('agent_running');
    ui.emitRunPhase('finalizing');
    ui.emitRunPhase('completed');
    ui.emitRunCompleted({
      outcome: 'success',
      exitCode: 0,
      durationMs: 1234,
      reason: undefined,
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "start_run",
          },
          "data_version": 1,
          "message": "run_started",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "run_phase",
            "phase": "cold_start",
          },
          "data_version": 1,
          "message": "run_phase: cold_start",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "run_phase",
            "phase": "agent_running",
          },
          "data_version": 1,
          "message": "run_phase: agent_running",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "run_phase",
            "phase": "finalizing",
          },
          "data_version": 1,
          "message": "run_phase: finalizing",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "run_phase",
            "phase": "completed",
          },
          "data_version": 1,
          "message": "run_phase: completed",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "durationMs": 1234,
            "event": "run_completed",
            "exitCode": 0,
            "outcome": "success",
          },
          "data_version": 1,
          "level": "success",
          "message": "run_completed: success",
          "type": "lifecycle",
          "v": 1,
        },
      ]
    `);
  });

  it('inner-agent lifecycle: file_change_planned / file_change_applied / file_changed', () => {
    ui.emitFileChangePlanned({ path: '/a/foo.ts', operation: 'modify' });
    ui.emitFileChangeApplied({
      path: '/a/foo.ts',
      operation: 'modify',
      bytes: 42,
    });
    ui.emitFileChanged({
      path: '/a/foo.ts',
      operation: 'modify',
      additions: 3,
      deletions: 1,
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 4 }],
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "file_change_planned",
            "operation": "modify",
            "path": "/a/foo.ts",
          },
          "data_version": 1,
          "message": "file_change_planned: modify /a/foo.ts",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "bytes": 42,
            "event": "file_change_applied",
            "operation": "modify",
            "path": "/a/foo.ts",
          },
          "data_version": 1,
          "message": "file_change_applied: modify /a/foo.ts",
          "type": "result",
          "v": 1,
        },
        {
          "data": {
            "additions": 3,
            "deletions": 1,
            "event": "file_changed",
            "hunks": [
              {
                "newLines": 4,
                "newStart": 1,
                "oldLines": 2,
                "oldStart": 1,
              },
            ],
            "operation": "modify",
            "path": "/a/foo.ts",
          },
          "data_version": 1,
          "message": "file_changed: modify /a/foo.ts (+3/-1)",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('event_plan family: proposed / confirmed / setEventPlan / setEventIngestionDetected', () => {
    ui.emitEventPlanProposed({
      events: [{ name: 'click', description: 'btn click' }],
    });
    ui.emitEventPlanConfirmed({ source: 'human', decision: 'approved' });
    ui.setEventPlan([{ name: 'click', description: 'btn click' }]);
    ui.setEventIngestionDetected(['click', 'submit']);
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "event_plan_proposed",
            "events": [
              {
                "description": "btn click",
                "name": "click",
              },
            ],
          },
          "data_version": 1,
          "message": "event_plan_proposed: 1 events",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "decision": "approved",
            "event": "event_plan_confirmed",
            "source": "human",
          },
          "data_version": 1,
          "message": "event_plan_confirmed: approved (human)",
          "type": "result",
          "v": 1,
        },
        {
          "data": {
            "event": "event_plan_set",
            "events": [
              {
                "description": "btn click",
                "name": "click",
              },
            ],
          },
          "data_version": 1,
          "message": "event_plan: 1 events",
          "type": "result",
          "v": 1,
        },
        {
          "data": {
            "event": "events_detected",
            "eventNames": [
              "click",
              "submit",
            ],
          },
          "data_version": 1,
          "message": "events_detected: 2 event types",
          "type": "result",
          "v": 1,
        },
      ]
    `);
  });

  it('verification + dashboard', () => {
    ui.emitVerificationStarted({ phase: 'ingestion' });
    ui.emitVerificationResult({ phase: 'ingestion', success: true });
    ui.emitVerificationResult({
      phase: 'overall',
      success: false,
      failures: ['nope'],
    });
    ui.setDashboardUrl(
      'https://app.amplitude.com/analytics/demo/dashboard/abc',
    );
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "verification_started",
            "phase": "ingestion",
          },
          "data_version": 1,
          "message": "verification_started: ingestion",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "event": "verification_result",
            "phase": "ingestion",
            "success": true,
          },
          "data_version": 1,
          "level": "success",
          "message": "verification_result: ingestion pass",
          "type": "result",
          "v": 1,
        },
        {
          "data": {
            "event": "verification_result",
            "failures": [
              "nope",
            ],
            "phase": "overall",
            "success": false,
          },
          "data_version": 1,
          "level": "error",
          "message": "verification_result: overall fail",
          "type": "error",
          "v": 1,
        },
        {
          "data": {
            "dashboardUrl": "https://app.amplitude.com/login?next=%2Fanalytics%2Fdemo%2Fdashboard%2Fabc&ff.sign-up-sign-in-refresh=true",
            "event": "dashboard_created",
          },
          "data_version": 1,
          "message": "dashboard_created: https://app.amplitude.com/login?next=%2Fanalytics%2Fdemo%2Fdashboard%2Fabc&ff.sign-up-sign-in-refresh=true",
          "type": "result",
          "v": 1,
        },
      ]
    `);
  });

  it('checkpoint family: saved / loaded / cleared', () => {
    ui.emitCheckpointSaved({ path: '/x.json', bytes: 100, phase: 'cold' });
    ui.emitCheckpointLoaded({ path: '/x.json', ageSeconds: 7 });
    ui.emitCheckpointCleared({ path: '/x.json', reason: 'success' });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "bytes": 100,
            "event": "checkpoint_saved",
            "path": "/x.json",
            "phase": "cold",
          },
          "data_version": 1,
          "message": "checkpoint_saved (cold, 100B)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "ageSeconds": 7,
            "event": "checkpoint_loaded",
            "path": "/x.json",
          },
          "data_version": 1,
          "message": "checkpoint_loaded (7s old)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "event": "checkpoint_cleared",
            "path": "/x.json",
            "reason": "success",
          },
          "data_version": 1,
          "message": "checkpoint_cleared (success)",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('progress_estimate / cold_start_breakdown', () => {
    ui.emitProgressEstimate({
      stage: 'post_agent_steps',
      current: 1,
      total: 4,
    });
    ui.emitColdStartBreakdown({
      phase: 'skill_staging',
      startedAt: 1000,
      finishedAt: 1500,
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "current": 1,
            "event": "progress_estimate",
            "percent": 25,
            "stage": "post_agent_steps",
            "total": 4,
          },
          "data_version": 1,
          "message": "progress_estimate: post_agent_steps 1/4 (25%)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "durationMs": 500,
            "event": "cold_start_breakdown",
            "finishedAt": 1500,
            "phase": "skill_staging",
            "startedAt": 1000,
          },
          "data_version": 1,
          "message": "cold_start_breakdown: skill_staging (500ms)",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('mcp_status / discovery_fact / journey_transition', () => {
    ui.emitMcpStatus({
      server: 'wizard_tools',
      state: 'available',
      transition_ts: 1700000000000,
      detail: 'booted',
    });
    ui.pushDiscoveryFact({
      id: 'framework',
      label: 'Framework',
      value: 'Next.js',
      discoveredAt: 1700000000000,
    });
    ui.applyJourneyTransition('detect' as never, 'completed' as never);
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "detail": "booted",
            "event": "mcp_status",
            "server": "wizard_tools",
            "state": "available",
            "transition_ts": 1700000000000,
          },
          "data_version": 1,
          "message": "mcp_status: wizard_tools -> available",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "discoveredAt": 1700000000000,
            "event": "discovery_fact",
            "id": "framework",
            "label": "Framework",
            "value": "Next.js",
          },
          "data_version": 1,
          "message": "discovery_fact: Framework = Next.js",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "event": "journey_transition",
            "status": "completed",
            "stepId": "detect",
          },
          "message": "journey: detect -> completed",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('session_state setters: setRegion / setDetectedFramework / setProjectHasData / setLoginUrl', () => {
    ui.setRegion('us');
    ui.setDetectedFramework('Next.js');
    ui.setProjectHasData(true);
    ui.setLoginUrl('https://login.example.com');
    ui.setLoginUrl(null);
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "field": "region",
            "value": "us",
          },
          "message": "region: us",
          "type": "session_state",
          "v": 1,
        },
        {
          "data": {
            "field": "detectedFramework",
            "value": "Next.js",
          },
          "message": "framework: Next.js",
          "type": "session_state",
          "v": 1,
        },
        {
          "data": {
            "field": "projectHasData",
            "value": true,
          },
          "message": "project_has_data: true",
          "type": "session_state",
          "v": 1,
        },
        {
          "data": {
            "field": "loginUrl",
            "value": "https://login.example.com",
          },
          "message": "login_url: https://login.example.com",
          "type": "session_state",
          "v": 1,
        },
        {
          "data": {
            "field": "loginUrl",
            "value": null,
          },
          "message": "login_url_cleared",
          "type": "session_state",
          "v": 1,
        },
      ]
    `);
  });

  it('emitSetupContext drops undefined / null / empty fields from amplitude scope', () => {
    ui.emitSetupContext({
      phase: 'plan',
      amplitude: {
        region: 'us',
        orgId: 'org-1',
        orgName: 'Acme',
        projectId: undefined,
        projectName: '',
        appId: '12345',
        appName: 'My App',
        envName: 'Production',
      },
      sources: { region: 'flag', orgId: 'saved' },
      requiresConfirmation: true,
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "amplitude": {
              "appId": "12345",
              "appName": "My App",
              "envName": "Production",
              "orgId": "org-1",
              "orgName": "Acme",
              "region": "us",
            },
            "event": "setup_context",
            "phase": "plan",
            "requiresConfirmation": true,
            "sources": {
              "orgId": "saved",
              "region": "flag",
            },
          },
          "data_version": 1,
          "message": "setup_context (plan): Acme / My App / Production",
          "type": "lifecycle",
          "v": 1,
        },
      ]
    `);
  });

  it('emitAgentMetrics drops undefined fields and stamps registered data_version', () => {
    ui.emitAgentMetrics({
      durationMs: 5000,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: undefined,
      costUsd: 0.005,
      numTurns: 3,
      totalToolCalls: 7,
      isError: false,
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "costUsd": 0.005,
            "durationMs": 5000,
            "event": "agent_metrics",
            "inputTokens": 100,
            "isError": false,
            "numTurns": 3,
            "outputTokens": 50,
            "totalToolCalls": 7,
          },
          "data_version": 1,
          "message": "agent_metrics: 5000ms",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('compaction / transient_retry / attempt_started', () => {
    ui.emitCompactionStarted({ trigger: 'manual' });
    ui.emitCompactionCompleted({
      trigger: 'manual',
      preTokens: 1000,
      postTokens: 200,
      durationMs: 60_000,
    });
    ui.emitTransientRetry({
      attempt: 2,
      totalAttempts: 3,
      nextRetryInMs: 1500,
      reason: 'transient_api',
      retryAfterMs: null,
    });
    ui.emitAttemptStarted({
      attemptNumber: 2,
      totalBudget: 3,
      reason: 'network_retry',
      backoffMs: 1500,
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "compaction_started",
            "trigger": "manual",
          },
          "data_version": 1,
          "message": "compaction_started (manual)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "durationMs": 60000,
            "event": "compaction_completed",
            "postTokens": 200,
            "preTokens": 1000,
            "trigger": "manual",
          },
          "data_version": 1,
          "message": "compaction_completed (manual 1000→200 tokens)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "attempt": 2,
            "event": "transient_retry",
            "nextRetryInMs": 1500,
            "reason": "transient_api",
            "retryAfterMs": null,
            "totalAttempts": 3,
          },
          "data_version": 1,
          "message": "transient_retry: attempt 2/3 in 1500ms (transient_api)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "attemptNumber": 2,
            "backoffMs": 1500,
            "event": "attempt_started",
            "reason": "network_retry",
            "totalBudget": 3,
          },
          "data_version": 1,
          "message": "attempt_started: 2/3 (network_retry) after 1500ms backoff",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('current_file / stall_status / run_resumed / file_change_failed', () => {
    ui.emitCurrentFile({
      path: '/a/foo.ts',
      relativePath: 'a/foo.ts',
      operation: 'modify',
    });
    ui.emitStallStatus({
      tier: 'noticed',
      durationMs: 10_000,
      lastActivity: 1700000000000,
      hint: 'Working on a big edit',
    });
    ui.emitRunResumed({
      fromCheckpointAt: '2026-01-01T00:00:00Z',
      lastPhase: 'agent_running',
      restoredStateSummary: 'region=us, framework=Next.js',
    });
    ui.emitFileChangeFailed({
      path: '/a/foo.ts',
      operation: 'modify',
      errorClass: 'syntax',
      errorMessage: 'String to replace not found',
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "current_file",
            "operation": "modify",
            "path": "/a/foo.ts",
            "relativePath": "a/foo.ts",
          },
          "data_version": 1,
          "message": "current_file: modify a/foo.ts",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "durationMs": 10000,
            "event": "stall_status",
            "hint": "Working on a big edit",
            "lastActivity": 1700000000000,
            "tier": "noticed",
          },
          "data_version": 1,
          "message": "stall_status: noticed (10000ms)",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "event": "run_resumed",
            "from_checkpoint_at": "2026-01-01T00:00:00Z",
            "last_phase": "agent_running",
            "restored_state_summary": "region=us, framework=Next.js",
          },
          "data_version": 1,
          "message": "run_resumed (last_phase=agent_running, from=2026-01-01T00:00:00Z)",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "errorClass": "syntax",
            "errorMessage": "String to replace not found",
            "event": "file_change_failed",
            "operation": "modify",
            "path": "/a/foo.ts",
          },
          "data_version": 1,
          "level": "error",
          "message": "file_change_failed: modify /a/foo.ts (syntax)",
          "type": "error",
          "v": 1,
        },
      ]
    `);
  });

  it('inner-agent: emitInnerAgentStarted / emitToolCall / emitToolResponse', () => {
    ui.emitInnerAgentStarted({ model: 'claude-3.5-sonnet', phase: 'apply' });
    ui.emitToolCall({ tool: 'Bash', id: 'tu_001', summary: 'pnpm install' });
    ui.emitToolResponse({
      tool: 'Bash',
      id: 'tu_001',
      outcome: 'success',
      durationMs: 1234,
      exitCode: 0,
      contentHead: 'OK',
      isError: false,
      summary: 'pnpm install',
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "inner_agent_started",
            "model": "claude-3.5-sonnet",
            "phase": "apply",
          },
          "data_version": 1,
          "message": "inner_agent_started: claude-3.5-sonnet",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "event": "tool_call",
            "id": "tu_001",
            "summary": "pnpm install",
            "tool": "Bash",
          },
          "data_version": 2,
          "message": "tool: Bash — pnpm install",
          "type": "progress",
          "v": 1,
        },
        {
          "data": {
            "contentHead": "OK",
            "durationMs": 1234,
            "event": "tool_response",
            "exitCode": 0,
            "id": "tu_001",
            "isError": false,
            "outcome": "success",
            "summary": "pnpm install",
            "tool": "Bash",
          },
          "data_version": 1,
          "message": "tool_response: Bash -> success (1234ms)",
          "type": "progress",
          "v": 1,
        },
      ]
    `);
  });

  it('project_create_start / project_create_success / project_create_error', () => {
    ui.emitProjectCreateStart({ orgId: 'org-1', name: 'demo' });
    ui.emitProjectCreateSuccess({
      appId: '99',
      name: 'demo',
      orgId: 'org-1',
    });
    ui.emitProjectCreateError({
      code: 'NAME_TAKEN',
      message: 'Name taken',
      name: 'demo',
    });
    expect(writes).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "event": "project_create_start",
            "name": "demo",
            "orgId": "org-1",
          },
          "data_version": 1,
          "message": "Creating Amplitude project "demo"",
          "type": "lifecycle",
          "v": 1,
        },
        {
          "data": {
            "appId": "99",
            "event": "project_create_success",
            "name": "demo",
            "orgId": "org-1",
          },
          "data_version": 1,
          "message": "project_created: demo",
          "type": "result",
          "v": 1,
        },
        {
          "data": {
            "code": "NAME_TAKEN",
            "event": "project_create_error",
            "name": "demo",
            "recoverable": "reinvoke_with_flag",
            "suggestedAction": {
              "command": [
                "amplitude-wizard",
                "--app-name",
                "<different-name>",
              ],
            },
          },
          "data_version": 1,
          "level": "error",
          "message": "Name taken",
          "type": "error",
          "v": 1,
        },
      ]
    `);
  });
});
