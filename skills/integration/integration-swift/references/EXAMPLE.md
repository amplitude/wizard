# Amplitude Swift (iOS/macOS) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/swift

---

## README.md

# Amplitude Swift (iOS/macOS) example

This is a [SwiftUI](https://developer.apple.com/xcode/swiftui/) example demonstrating Amplitude integration with product analytics and user identification. The app targets both iOS and macOS using `NavigationSplitView`.

## Features

- **Product analytics**: Track user events and behaviors
- **User identification**: Associate events with authenticated users
- **Multi-platform**: Runs on iOS, iPadOS, macOS, and visionOS

## Getting started

### 1. Add the Amplitude dependency

The Xcode project already includes the Amplitude Swift SDK via Swift Package Manager. When you open the project, Xcode will resolve the package automatically.

To add it manually to a new project: File > Add Package Dependencies > enter `https://github.com/amplitude/Amplitude-Swift`.

### 2. Configure environment variables

Set your Amplitude API key as an environment variable in the Xcode scheme:

1. In Xcode, go to **Product > Scheme > Edit Scheme…**
2. Select **Run** in the sidebar
3. Go to the **Arguments** tab
4. Under **Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `AMPLITUDE_API_KEY` | Your Amplitude API key |

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

The app reads this via `ProcessInfo.processInfo.environment` and will crash with a clear message if it's missing.

### 3. Build and run

Open `BurritoConsiderationClient.xcodeproj` in Xcode and run on an iOS Simulator or macOS.

## Project structure

```
BurritoConsiderationClient/
├── BurritoConsiderationClientApp.swift  # App entry point with Amplitude initialization
├── ContentView.swift                    # NavigationSplitView with sidebar routing
├── UserState.swift                      # @Observable user state with Amplitude identify
├── LoginView.swift                      # Login form
├── DashboardView.swift                  # Welcome screen with Dashboard Viewed tracking
├── BurritoView.swift                    # Burrito consideration with event tracking
├── ProfileView.swift                    # Profile with journey progress
└── Assets.xcassets/                     # Asset catalog
```

## Key integration points

### Amplitude initialization (BurritoConsiderationClientApp.swift)

```swift
import AmplitudeSwift

let amplitude = Amplitude(configuration: Configuration(
    apiKey: ProcessInfo.processInfo.environment["AMPLITUDE_API_KEY"] ?? ""
))
```

### User identification (UserState.swift)

```swift
amplitude.setUserId(userId: username)
let identifyEvent = IdentifyEvent()
identifyEvent.userProperties = ["username": username]
amplitude.identify(event: identifyEvent)
```

### Screen view tracking (DashboardView.swift, ProfileView.swift)

```swift
.onAppear {
    amplitude.track(eventType: "Dashboard Viewed", eventProperties: [
        "username": userState.username ?? "unknown",
    ])
}
```

### Event tracking (BurritoView.swift)

```swift
amplitude.track(eventType: "Burrito Considered", eventProperties: [
    "total_considerations": burritoConsiderations,
    "username": username ?? "unknown",
])
```

### User logout (UserState.swift)

```swift
amplitude.track(eventType: "User Logged Out")
amplitude.reset()
```

## Learn more

- [Amplitude iOS SDK Documentation](https://amplitude.com/docs/sdks/analytics/ios)
- [Amplitude Documentation](https://amplitude.com/docs)
- [SwiftUI Documentation](https://developer.apple.com/documentation/swiftui)

---

## BurritoConsiderationClient.xcodeproj/project.xcworkspace/contents.xcworkspacedata

```xcworkspacedata
<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "self:">
   </FileRef>
</Workspace>

```

---

## BurritoConsiderationClient.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved

```resolved
{
  "originHash" : "a2fc303e4b16c93c972ef2ddc4042cf91a9400e5d1639bc9740a80c0336cdd4e",
  "pins" : [
    {
      "identity" : "amplitude-swift",
      "kind" : "remoteSourceControl",
      "location" : "https://github.com/amplitude/Amplitude-Swift",
      "state" : {
        "revision" : "db0d1b9b6a1bfad58ddbe0e2e4b549e0c0d3f28f",
        "version" : "1.12.0"
      }
    }
  ],
  "version" : 3
}

```

---

## BurritoConsiderationClient.xcodeproj/xcshareddata/xcschemes/BurritoConsiderationClient.xcscheme

```xcscheme
<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "2630"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES"
      buildArchitectures = "Automatic">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "1F6BD9732F3520A100189B0B"
               BuildableName = "BurritoConsiderationClient.app"
               BlueprintName = "BurritoConsiderationClient"
               ReferencedContainer = "container:BurritoConsiderationClient.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "1F6BD9732F3520A100189B0B"
            BuildableName = "BurritoConsiderationClient.app"
            BlueprintName = "BurritoConsiderationClient"
            ReferencedContainer = "container:BurritoConsiderationClient.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
      <EnvironmentVariables>
         <EnvironmentVariable
            key = "AMPLITUDE_API_KEY"
            value = "YOUR_AMPLITUDE_API_KEY"
            isEnabled = "YES">
         </EnvironmentVariable>
      </EnvironmentVariables>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "1F6BD9732F3520A100189B0B"
            BuildableName = "BurritoConsiderationClient.app"
            BlueprintName = "BurritoConsiderationClient"
            ReferencedContainer = "container:BurritoConsiderationClient.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>

```

---

## BurritoConsiderationClient/BurritoConsiderationClientApp.swift

```swift
//
//  BurritoConsiderationClientApp.swift
//  BurritoConsiderationClient
//
//  Created by Danilo Campos on 2/5/26.
//

import SwiftUI
import AmplitudeSwift

enum AmplitudeEnv: String {
    case apiKey = "AMPLITUDE_API_KEY"

    var value: String {
        guard let value = ProcessInfo.processInfo.environment[rawValue] else {
            fatalError("Set \(rawValue) in the Xcode scheme environment variables.")
        }
        return value
    }
}

@main
struct BurritoConsiderationClientApp: App {
    @State private var userState: UserState

    init() {
        let amplitude = Amplitude(configuration: Configuration(apiKey: ProcessInfo.processInfo.environment["AMPLITUDE_API_KEY"] ?? ""))
        _userState = State(initialValue: UserState(amplitude: amplitude))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(userState)
        }
    }
}

```

---

## BurritoConsiderationClient/BurritoView.swift

```swift
//
//  BurritoView.swift
//  BurritoConsiderationClient
//

import SwiftUI

struct BurritoView: View {
    @Environment(UserState.self) private var userState
    @State private var showConfirmation = false

    var body: some View {
        VStack(spacing: 24) {
            Text("Take a moment to truly consider the potential of burritos.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Text("🌯")
                .font(.system(size: 80))

            Button("I Have Considered the Burrito Potential") {
                userState.burritoConsiderations += 1

                // Amplitude: Track burrito consideration event
                userState.trackBurritoConsidered()

                showConfirmation = true
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    showConfirmation = false
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            if showConfirmation {
                Text("Thank you for your consideration! Count: \(userState.burritoConsiderations)")
                    .foregroundStyle(.green)
                    .transition(.opacity)
            }

            Text("Total considerations: \(userState.burritoConsiderations)")
                .font(.title2)
                .padding(.top)
        }
        .padding()
        .animation(.default, value: showConfirmation)
        .navigationTitle("Burrito Consideration Zone")
    }
}

```

---

## BurritoConsiderationClient/ContentView.swift

```swift
//
//  ContentView.swift
//  BurritoConsiderationClient
//
//  Created by Danilo Campos on 2/5/26.
//

import SwiftUI

enum Screen: CaseIterable, Identifiable {
    case dashboard, burrito, profile

    var id: Self { self }

    var title: String {
        switch self {
        case .dashboard: "Home"
        case .burrito: "Burrito"
        case .profile: "Profile"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "house"
        case .burrito: "fork.knife"
        case .profile: "person.circle"
        }
    }
}

struct ContentView: View {
    @Environment(UserState.self) private var userState
    @State private var selectedScreen: Screen? = .dashboard

    var body: some View {
        if userState.isLoggedIn {
            NavigationSplitView {
                List(Screen.allCases, selection: $selectedScreen) { screen in
                    Label(screen.title, systemImage: screen.icon)
                }
                .navigationTitle("Menu")
            } detail: {
                if let selectedScreen {
                    switch selectedScreen {
                    case .dashboard:
                        DashboardView()
                    case .burrito:
                        BurritoView()
                    case .profile:
                        ProfileView()
                    }
                } else {
                    Text("Select an item from the sidebar")
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            NavigationStack {
                LoginView()
            }
        }
    }
}

```

---

## BurritoConsiderationClient/DashboardView.swift

```swift
//
//  DashboardView.swift
//  BurritoConsiderationClient
//

import SwiftUI

struct DashboardView: View {
    @Environment(UserState.self) private var userState

    var body: some View {
        VStack(spacing: 20) {
            Text("Welcome back, \(userState.username ?? "")!")
                .font(.largeTitle)
                .padding(.top, 40)

            Text("You are now logged in. Feel free to explore:")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 12) {
                Label("Consider the potential of burritos", systemImage: "fork.knife")
                Label("View your profile and statistics", systemImage: "person.circle")
            }
            .padding()

            Spacer()
        }
        .padding()
        .navigationTitle("Home")
        .onAppear {
            // Amplitude: Track dashboard view
            userState.trackDashboardViewed()
        }
    }
}

```

---

## BurritoConsiderationClient/LoginView.swift

```swift
//
//  LoginView.swift
//  BurritoConsiderationClient
//

import SwiftUI

struct LoginView: View {
    @Environment(UserState.self) private var userState
    @State private var username = ""
    @State private var password = ""
    @State private var showError = false

    var body: some View {
        Form {
            Section("Login") {
                TextField("Username", text: $username)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()

                SecureField("Password", text: $password)
            }

            Section {
                Button("Log In") {
                    if !userState.login(username: username, password: password) {
                        showError = true
                    }
                }
                .disabled(username.isEmpty || password.isEmpty)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Burrito Consideration")
        .alert("Login Failed", isPresented: $showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Please enter a valid username and password.")
        }
    }
}

```

---

## BurritoConsiderationClient/ProfileView.swift

```swift
//
//  ProfileView.swift
//  BurritoConsiderationClient
//

import SwiftUI

struct ProfileView: View {
    @Environment(UserState.self) private var userState

    private var journeyMessage: String {
        switch userState.burritoConsiderations {
        case 0:
            "You haven't considered any burritos yet. Visit the Burrito Consideration page to start!"
        case 1:
            "You've considered the burrito potential once. Keep going!"
        case 2...4:
            "You're getting the hang of burrito consideration!"
        case 5...9:
            "You're becoming a burrito consideration expert!"
        default:
            "You are a true burrito consideration master!"
        }
    }

    var body: some View {
        Form {
            Section("Your Information") {
                LabeledContent("Username", value: userState.username ?? "—")
                LabeledContent("Burrito Considerations", value: "\(userState.burritoConsiderations)")
            }

            Section("Your Burrito Journey") {
                Text(journeyMessage)
            }

            Section {
                Button("Log Out", role: .destructive) {
                    userState.logout()
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Profile")
        .onAppear {
            // Amplitude: Track profile view
            userState.trackProfileViewed()
        }
    }
}

```

---

## BurritoConsiderationClient/UserState.swift

```swift
//
//  UserState.swift
//  BurritoConsiderationClient
//

import Foundation
import AmplitudeSwift

@Observable
class UserState {
    var username: String?
    var burritoConsiderations: Int = 0

    private let amplitude: Amplitude

    init(amplitude: Amplitude) {
        self.amplitude = amplitude
    }

    var isLoggedIn: Bool {
        username != nil
    }

    func login(username: String, password: String) -> Bool {
        // In a real app, validate credentials against a backend
        guard !username.isEmpty, !password.isEmpty else {
            return false
        }

        self.username = username
        self.burritoConsiderations = 0

        // Amplitude: Identify user on login
        amplitude.setUserId(userId: username)
        let identifyEvent = IdentifyEvent()
        identifyEvent.userProperties = ["username": username]
        amplitude.identify(event: identifyEvent)

        // Amplitude: Track login event
        amplitude.track(eventType: "User Logged In", eventProperties: [
            "username": username,
        ])

        return true
    }

    func logout() {
        // Amplitude: Track logout event before reset
        amplitude.track(eventType: "User Logged Out")
        amplitude.reset()

        username = nil
        burritoConsiderations = 0
    }

    func trackBurritoConsidered() {
        // Amplitude: Track burrito consideration event
        amplitude.track(eventType: "Burrito Considered", eventProperties: [
            "total_considerations": burritoConsiderations,
            "username": username ?? "unknown",
        ])
    }

    func trackDashboardViewed() {
        // Amplitude: Track dashboard view
        amplitude.track(eventType: "Dashboard Viewed", eventProperties: [
            "username": username ?? "unknown",
        ])
    }

    func trackProfileViewed() {
        // Amplitude: Track profile view
        amplitude.track(eventType: "Profile Viewed", eventProperties: [
            "username": username ?? "unknown",
        ])
    }
}

```

---

