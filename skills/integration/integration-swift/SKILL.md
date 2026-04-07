---
name: integration-swift
description: Amplitude integration for Swift iOS and macOS applications
metadata:
  author: Amplitude
  version: 1.2.1
---

# Amplitude integration for Swift (iOS/macOS)

This skill helps you add Amplitude analytics to Swift (iOS/macOS) applications.

## Workflow

Follow these steps in order to complete the integration:

1. `basic-integration-1.0-begin.md` - Amplitude Setup - Begin ← **Start here**
2. `basic-integration-1.1-edit.md` - Amplitude Setup - Edit
3. `basic-integration-1.2-revise.md` - Amplitude Setup - Revise
4. `basic-integration-1.3-conclude.md` - Amplitude Setup - Conclusion

## Reference files

- `references/EXAMPLE.md` - Swift (iOS/macOS) example project code
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

- Read configuration from environment variables via a dedicated enum with a computed property that calls ProcessInfo.processInfo.environment and fatalErrors if missing — use AMPLITUDE_API_KEY as the environment variable name
- When adding SPM dependencies to project.pbxproj, create three distinct objects with unique UUIDs — a PBXBuildFile (with productRef), an XCSwiftPackageProductDependency (with package and productName), and an XCRemoteSwiftPackageReference (with repositoryURL and requirement). The build file goes in the Frameworks phase files, the product dependency goes in the target's packageProductDependencies, and the package reference goes in the project's packageReferences.
- Check the latest release version of Amplitude-Swift at https://github.com/amplitude/Amplitude-Swift/releases before setting the minimumVersion in the SPM package reference — do not hardcode a stale version
- If the project uses App Sandbox (macOS), add ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES to the target's build settings so Amplitude can reach its servers — do NOT disable the sandbox entirely

## Identifying users

Identify users during login and signup events. Refer to the example code and documentation for the correct identify pattern for this framework. Call `amplitude.setUserId(userId)` to associate events with a known user, and use `amplitude.identify()` with an `Identify` object to set user properties. If both frontend and backend code exist, pass a consistent user/device ID via custom request headers to maintain event correlation.
