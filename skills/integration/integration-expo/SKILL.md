---
name: integration-expo
description: Amplitude integration for Expo applications
metadata:
  author: Amplitude
  version: 1.2.1
---

# Amplitude integration for Expo

This skill helps you add Amplitude analytics to Expo applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Expo example project code
- `references/react-native-sdk.md` - Amplitude documentation for React Native Sdk
- `references/amplitude-quickstart.md` - Amplitude documentation for Amplitude Quickstart
- `references/basic-integration-1.0-begin.md` - Amplitude setup - begin
- `references/basic-integration-1.1-edit.md` - Amplitude setup - edit
- `references/basic-integration-1.2-revise.md` - Amplitude setup - revise
- `references/basic-integration-1.3-conclude.md` - Amplitude setup - conclusion

The example project shows the target implementation pattern. Consult the documentation for API details.

## Key principles

- **Environment variables**: Always use environment variables for Amplitude keys. Never hardcode them.
- **Minimal changes**: Add Amplitude code alongside existing integrations. Don't replace or restructure existing code.
- **Match the example**: Your implementation should follow the example project's patterns as closely as possible.

## Framework guidelines

- @amplitude/analytics-react-native is the React Native SDK package name (same as bare RN)
- Use expo-constants with app.config.js extras for AMPLITUDE_API_KEY (NOT react-native-config)
- Access config via Constants.expoConfig?.extra?.amplitudeApiKey in your amplitude config file
- For expo-router, initialize Amplitude in app/_layout.tsx and track screen views manually with amplitude.track('Screen Viewed', { screen: pathname })
- @amplitude/analytics-react-native is the React Native SDK package name
- Use react-native-config to load AMPLITUDE_API_KEY from .env (variables are embedded at build time, not runtime)
- @amplitude/analytics-react-native requires @react-native-async-storage/async-storage and @react-native-community/netinfo as peer dependencies — install them alongside it
- Initialize Amplitude once at the top level (e.g., App.tsx) before any track calls

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
