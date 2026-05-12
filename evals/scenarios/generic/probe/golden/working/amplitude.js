import { init, track } from '@amplitude/unified';

const apiKey =
  /** @type {Record<string,string>|undefined} */ (
    /** @type {any} */ (globalThis).process?.env
  )?.AMPLITUDE_API_KEY;

if (apiKey) {
  init(apiKey, {
    // Auto-capture page views, clicks, sessions, form interactions.
    // Toggle off whichever signal you don't need — every flag here is
    // documented at https://amplitude.com/docs.
    autocapture: true,
  });
  track('Page Viewed', { 'page name': 'index' });
}

export { track };
