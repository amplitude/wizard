'use client';

import { useEffect } from 'react';
import { init } from '@amplitude/unified';

/**
 * Client-side Amplitude initialization for the App Router.
 *
 * Wraps the app in `app/layout.tsx`. Reading the API key from
 * `NEXT_PUBLIC_AMPLITUDE_API_KEY` keeps the secret in `.env.local`
 * and out of source control.
 */
function AmplitudeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
    if (!apiKey) return;
    init(apiKey, {
      // Auto-capture page views, clicks, sessions, form interactions.
      // Toggle off whichever signal you don't need — every flag
      // here is documented at https://amplitude.com/docs.
      autocapture: true,
    });
  }, []);
  return <>{children}</>;
}
