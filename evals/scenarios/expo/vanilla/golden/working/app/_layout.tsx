import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { init } from '@amplitude/analytics-react-native';

export default function RootLayout() {
  useEffect(() => {
    const apiKey = process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY;
    if (!apiKey) return;
    init(apiKey, undefined, {
      // Auto-capture session events; explicit `track()` calls cover the
      // app-specific events the team confirmed in the wizard's plan.
      defaultTracking: { sessions: true },
    });
  }, []);
  return <Stack />;
}
