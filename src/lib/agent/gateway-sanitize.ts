/**
 * Canonical re-export location for gateway request sanitization (Phase D).
 * Implementation lives alongside early wiring in `gateway-request-sanitize.ts`.
 */
export {
  GATEWAY_STRIPPED_SCHEMA_KEYS,
  sanitizingFetch,
  sanitizeWizardRequestInit,
  stripSchemaNoise,
  treeContainsForbiddenSchemaKeys,
} from '../gateway-request-sanitize.js';
