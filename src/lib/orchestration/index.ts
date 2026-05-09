/**
 * Barrel export for the orchestration module.
 *
 * Consumers (CLI commands, lifecycle hooks, future MCP-server tools) should
 * import from `'../lib/orchestration'` rather than reaching into the
 * individual files. Internal cross-imports stay direct.
 */
export * from './state';
export {
  TaskLifecycle,
  isTerminal,
  isActive,
  ACTIVE_STATES,
  canTransition,
  assertTransition,
  IllegalTaskTransitionError,
} from './lifecycle';
export {
  OrchestrationStore,
  getOrchestrationStore,
  loadStore,
  saveStore,
  emptyStore,
  newSessionId,
  newTaskId,
  newSubagentId,
  _resetOrchestrationStoreCache,
  type LoadResult,
} from './store';
export { computeLastStoppingPoint } from './last-stopping-point';
export { getOrchestrationStoreFile } from './storage-paths';
export {
  TaskLifecycleSchema,
  TaskSchema,
  SessionSchema,
  SubagentSchema,
  OwnershipSchema,
  PendingCheckpointSchema,
  TaskResultSchema,
  NextActionSchema,
  LastStoppingPointSchema,
  OrchestrationStoreFileSchema,
  StatusEnvelopeSchema,
  TasksEnvelopeSchema,
  TaskEnvelopeSchema,
  SessionsEnvelopeSchema,
  SessionEnvelopeSchema,
  ResumeEnvelopeSchema,
  ChoiceSchema,
  ChoiceKindSchema,
  ChoiceStatusSchema,
  ChoiceOptionSchema,
  TimeoutBehaviorSchema,
  ChoiceIdSchema,
  ChoicesEnvelopeSchema,
  ChoiceEnvelopeSchema,
  ChoiceAnswerEnvelopeSchema,
  VerificationSchema,
  VerificationKindSchema,
  VerificationStatusSchema,
  VerificationIdSchema,
  VerificationsEnvelopeSchema,
  VerificationEnvelopeSchema,
  VerificationMarkEnvelopeSchema,
  McpAppCapabilitySchema,
  McpAppCapabilityKindSchema,
  McpAppCapabilityStateSchema,
  McpUserDecisionSchema,
  McpAppCapabilityIdSchema,
} from './schemas';

// PR 2 — checkpoint + MCP-app lifecycle modules.
export {
  ChoiceKind,
  ChoiceStatus,
  isTerminalChoiceStatus,
  asChoiceId,
  canTransitionChoice,
  assertChoiceTransition,
  IllegalChoiceTransitionError,
  type Choice,
  type ChoiceId,
  type ChoiceOption,
  type TimeoutBehavior,
  type AddChoiceInput,
} from './checkpoints/choices';
export {
  VerificationKind,
  VerificationStatus,
  isTerminalVerificationStatus,
  asVerificationId,
  canTransitionVerification,
  assertVerificationTransition,
  IllegalVerificationTransitionError,
  type Verification,
  type VerificationId,
  type AddVerificationInput,
} from './checkpoints/verifications';
export {
  McpAppCapabilityKind,
  McpAppCapabilityState,
  McpUserDecision,
  asMcpAppCapabilityId,
  canTransitionMcpCapability,
  assertMcpTransition,
  IllegalMcpTransitionError,
  type McpAppCapability,
  type McpAppCapabilityId,
  type AddMcpCapabilityInput,
} from './mcp-app-lifecycle';
export { newChoiceId, newVerificationId, newMcpCapabilityId } from './store';
