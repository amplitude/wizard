/**
 * Preload entry for `NODE_OPTIONS=--require` (see `gateway-fetch-sanitize-node-options.ts`).
 * Do not import this from unit tests — import `register-gateway-fetch-sanitize.ts` instead.
 */

import { installGatewayFetchSanitizer } from './register-gateway-fetch-sanitize.js';

if (process.env.AMPLITUDE_WIZARD_GATEWAY_SANITIZE_FETCH !== '0') {
  installGatewayFetchSanitizer();
}
