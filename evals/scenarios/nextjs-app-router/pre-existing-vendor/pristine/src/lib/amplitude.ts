import { init, track } from '@amplitude/analytics-browser';

let initialized = false;

export function ensureAmplitude() {
  if (initialized) return;
  const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  if (!apiKey) return;
  init(apiKey, undefined, {
    defaultTracking: { sessions: true, pageViews: true },
  });
  initialized = true;
}

export { track };
