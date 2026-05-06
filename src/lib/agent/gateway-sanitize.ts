/**
 * Canonical re-export location for gateway request sanitization (Phase D).
 * Implementation lives alongside early wiring in `gateway-request-sanitize.ts`.
 */
export {
  sanitizingFetch,
  sanitizeWizardRequestInit,
  stripSchemaNoise,
} from '../gateway-request-sanitize.js';
