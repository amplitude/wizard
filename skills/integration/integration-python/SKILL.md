---
name: integration-python
description: Amplitude integration for any Python application using the Python SDK
metadata:
  author: Amplitude
  version: 1.2.1
---

# Amplitude integration for Python

This skill helps you add Amplitude analytics to Python applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Python example project code
- `references/python.md` - Amplitude documentation for Python
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

- Remember that source code is available in the venv/site-packages directory
- amplitude-analytics is the Python SDK package name
- Install dependencies with `pip install amplitude-analytics` or `pip install -r requirements.txt` and do NOT use unquoted version specifiers like `>=` directly in shell commands
- Always initialize with Amplitude(api_key) and configure via Config() — do NOT use module-level config
- In CLIs and scripts: MUST call client.shutdown() before exit or all events are lost
- NEVER send PII in track() event properties — no emails, full names, phone numbers, physical addresses, IP addresses, or user-generated content
- PII belongs in identify() user properties, NOT in track() event properties. Safe event properties are metadata like message_length, form_type, boolean flags.
- Register client.shutdown with atexit.register() to ensure all events are flushed on exit

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
