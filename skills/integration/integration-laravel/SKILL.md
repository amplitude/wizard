---
name: integration-laravel
description: Amplitude integration for Laravel applications
metadata:
  author: Amplitude
  version: 1.2.0
---

# Amplitude integration for Laravel

This skill helps you add Amplitude analytics to Laravel applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Laravel example project code
- `references/analytics.md` - Amplitude documentation for Analytics
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

- Create a dedicated AmplitudeService class in app/Services/ — do NOT scatter amplitude track calls throughout controllers
- Register Amplitude configuration in config/amplitude.php using env() for all settings (api_key)
- Do NOT use Laravel's event system or observers for analytics — call track explicitly where actions occur
- Remember that source code is available in the vendor directory after composer install
- amplitude/amplitude-php is the PHP SDK package name (community SDK — check composer.json for availability)
- Check composer.json for existing dependencies and autoload configuration before adding new files
- Initialize the Amplitude client once with your API key and reuse it throughout the application

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
