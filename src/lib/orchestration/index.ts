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
} from './schemas';
