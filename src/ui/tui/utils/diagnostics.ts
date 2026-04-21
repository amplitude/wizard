/**
 * Diagnostic snapshot for debugging flow issues.
 *
 * Produces a sanitized JSON object that shows exactly why the router
 * picked the current screen — without leaking tokens or secrets.
 *
 * Used by the /debug slash command and crash report writer.
 */

import type { WizardSession } from '../../../lib/wizard-session.js';
import type { WizardStore } from '../store.js';
import { FLOWS, Flow } from '../flows.js';

export interface FlowStepEvaluation {
  screen: string;
  visible: boolean;
  complete: boolean;
  active: boolean;
}

/** Walk the flow pipeline and explain each routing decision. */
export function evaluateFlow(
  session: WizardSession,
  flow: Flow = Flow.Wizard,
): FlowStepEvaluation[] {
  const entries = FLOWS[flow];
  if (!entries) return [];

  let foundActive = false;
  return entries.map((entry) => {
    const visible = entry.show ? entry.show(session) : true;
    const complete =
      visible && entry.isComplete ? entry.isComplete(session) : false;
    const active = visible && !complete && !foundActive;
    if (active) foundActive = true;
    return { screen: entry.screen, visible, complete, active };
  });
}

/** Create a sanitized diagnostic snapshot safe to share with support. */
export function createDiagnosticSnapshot(
  store: WizardStore,
  version: string,
): object {
  const session = store.session;
  return {
    wizard_version: version,
    node_version: process.version,
    platform: `${process.platform}/${process.arch}`,
    timestamp: new Date().toISOString(),

    // Flow state — the "why did I see this screen?" answer
    current_screen: store.currentScreen,
    active_flow: store.router.activeFlow,
    has_overlay: store.router.hasOverlay,

    // Flow evaluation — shows every predicate result
    flow_evaluation: evaluateFlow(session, store.router.activeFlow),

    // Session state (secrets redacted, only structural/categorical data)
    session: {
      integration: session.integration,
      detected_framework: session.detectedFrameworkLabel,
      detection_complete: session.detectionComplete,
      region: session.region,
      region_forced: session.regionForced,
      run_phase: session.runPhase,
      activation_level: session.activationLevel,
      project_has_data: session.projectHasData,
      setup_confirmed: session.setupConfirmed,
      intro_concluded: session.introConcluded,
      mcp_complete: session.mcpComplete,
      slack_complete: session.slackComplete,
      data_ingestion_confirmed: session.dataIngestionConfirmed,
      dashboard_url: session.dashboardUrl !== null,
      dashboard_id: session.dashboardId !== null,
      dashboard_warnings_count: session.dashboardWarnings?.length ?? 0,
      dashboard_idempotency_key: session.dashboardIdempotencyKey !== null,
      discovered_features: session.discoveredFeatures,
      additional_feature_queue: session.additionalFeatureQueue,
      amplitude_pre_detected: session.amplitudePreDetected,
      outro_kind: session.outroData?.kind ?? null,

      // Redacted credential indicators
      has_credentials: session.credentials !== null,
      has_pending_orgs: session.pendingOrgs !== null,
      selected_org: session.selectedOrgName,
      selected_env: session.selectedEnvName,
    },

    // Counts
    status_messages_count: store.statusMessages.length,
    tasks_count: store.tasks.length,
    event_plan_count: store.eventPlan.length,
  };
}
