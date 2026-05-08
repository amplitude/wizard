import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { init } from '@amplitude/unified';

/**
 * Client-side Amplitude initialization for React Router 7 framework mode.
 *
 * Reads the API key from `VITE_PUBLIC_AMPLITUDE_API_KEY` (Vite exposes
 * `VITE_*` env vars on `import.meta.env` at build time). Init runs
 * once before hydration so every subsequent track() call has a live
 * client.
 */
const apiKey = import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY;
if (apiKey) {
  init(apiKey, {
    // Auto-capture page views, clicks, sessions, and form interactions.
    // Toggle off any signal you don't need; every flag here is
    // documented at https://amplitude.com/docs.
    autocapture: true,
  });
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
