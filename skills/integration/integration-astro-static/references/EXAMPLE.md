# Amplitude Astro (Static) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/astro-static

---

## README.md

# Amplitude Astro Static Example

This is an [Astro](https://astro.build/) static site (SSG) example demonstrating Amplitude integration with product analytics.

### Amplitude SDKs

This static site uses only the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm). [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) is bundled in `src/components/amplitude.astro`; `initAll` runs on the client. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) documents that call as initializing every product bundled with Unified npm. See [Unified SDK configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) for `analytics`, `sessionReplay`, `experiment`, and `engagement`. The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the [CDN script](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-script-cdn), not Unified **npm**.

There is no server SDK in this sample. For Node or API routes, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node) (see [astro-ssr](../astro-ssr)).

The layout assigns the unified namespace to `window.amplitude` so `is:inline` scripts can call `track`, `setUserId`, and `reset` without importing the package on every page (see [accessing SDK features](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#access-sdk-features) in the official doc).

## Features

- **Product analytics**: Login and burrito consideration events
- **Simple auth flow**: Demo login using localStorage

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key
```

`PUBLIC_` exposes the variable to the browser. Get your API key from [Amplitude project settings](https://app.amplitude.com).

### 3. Run the development server

```bash
pnpm dev
```

Open `http://localhost:4321` in your browser.

## Project structure

```text
src/
  components/
    amplitude.astro      # initAll() + window.amplitude for inline scripts
    Header.astro         # Logout; track + reset
  layouts/
    AmplitudeLayout.astro
  lib/
    auth.ts
  pages/
    index.astro        # Login; setUserId + track('User Logged In')
    burrito.astro      # track('Burrito Considered', …)
    profile.astro
  styles/
    global.css
```

## Key integration points

### Amplitude initialization (`src/components/amplitude.astro`)

```astro
<script>
  import * as amplitude from "@amplitude/unified";

  const apiKey = import.meta.env.PUBLIC_AMPLITUDE_API_KEY;
  if (apiKey) {
    void amplitude.initAll(apiKey);
  }
  window.amplitude = amplitude;
</script>
```

Session Replay, Experiment, and other products can be configured via the second argument to `initAll()` ([Browser Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk)).

### User identification (`src/pages/index.astro`)

After login, the demo sets the user id and tracks an event:

```javascript
window.amplitude?.setUserId(username);
window.amplitude?.track("User Logged In");
```

### Event tracking (`src/pages/burrito.astro`)

```javascript
window.amplitude?.track("Burrito Considered", {
  total_considerations: newCount,
  username: currentUser,
});
```

### Logout (`src/components/Header.astro`)

On logout, the demo clears local state and resets Amplitude:

```javascript
window.amplitude?.track("User Logged Out");
localStorage.removeItem("currentUser");
localStorage.removeItem("burritoConsiderations");
window.amplitude?.reset();
```

## Scripts

```bash
pnpm dev
pnpm build
pnpm preview
```

## Learn more

- [Browser Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk) — [npm install & `initAll`](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm), [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration)
- [Astro documentation](https://docs.astro.build/)

---

## .env.example

```example
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## astro.config.mjs

```mjs
import { defineConfig } from "astro/config";

export default defineConfig({});

```

---

## src/components/amplitude.astro

```astro
---
// Client-side Amplitude: bundled @amplitude/unified (initAll).
// Exposes the same namespace on window.amplitude for is:inline page scripts.
---
<script>
  import * as amplitude from "@amplitude/unified";

  const apiKey = import.meta.env.PUBLIC_AMPLITUDE_API_KEY;
  if (apiKey) {
    void amplitude.initAll(apiKey);
  }
  window.amplitude = amplitude;
</script>

```

---

## src/components/Header.astro

```astro
---
// Header component with navigation and logout functionality
---
<header class="header">
  <div class="header-container">
    <nav>
      <a href="/">Home</a>
      <a href="/burrito" class="auth-link" style="display: none;">Burrito Consideration</a>
      <a href="/profile" class="auth-link" style="display: none;">Profile</a>
    </nav>
    <div class="user-section">
      <span class="welcome-text" style="display: none;">Welcome, <span class="username"></span>!</span>
      <span class="not-logged-in">Not logged in</span>
      <button class="btn-logout" style="display: none;">Logout</button>
    </div>
  </div>
</header>

<script is:inline>
  function updateHeader() {
    const currentUser = localStorage.getItem('currentUser');
    const authLinks = document.querySelectorAll('.auth-link');
    const welcomeText = document.querySelector('.welcome-text');
    const notLoggedIn = document.querySelector('.not-logged-in');
    const logoutBtn = document.querySelector('.btn-logout');
    const usernameSpan = document.querySelector('.username');

    if (currentUser) {
      authLinks.forEach(link => link.style.display = 'inline');
      welcomeText.style.display = 'inline';
      notLoggedIn.style.display = 'none';
      logoutBtn.style.display = 'inline';
      usernameSpan.textContent = currentUser;
    } else {
      authLinks.forEach(link => link.style.display = 'none');
      welcomeText.style.display = 'none';
      notLoggedIn.style.display = 'inline';
      logoutBtn.style.display = 'none';
    }
  }

  function handleLogout() {
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
      window.amplitude?.track('User Logged Out');
    }
    localStorage.removeItem('currentUser');
    localStorage.removeItem('burritoConsiderations');
    // IMPORTANT: Reset Amplitude to clear the user/session identity
    window.amplitude?.reset();
    window.location.href = '/';
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateHeader();
    document.querySelector('.btn-logout')?.addEventListener('click', handleLogout);
  });

  // Listen for storage changes (login/logout in other tabs)
  window.addEventListener('storage', updateHeader);
</script>

<style>
  .header {
    background-color: #333;
    color: white;
    padding: 1rem;
  }

  .header-container {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header nav {
    display: flex;
    gap: 1rem;
  }

  .header a {
    color: white;
    text-decoration: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    transition: background-color 0.2s;
  }

  .header a:hover {
    background-color: #555;
    text-decoration: none;
  }

  .user-section {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .btn-logout {
    background-color: #dc3545;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-logout:hover {
    background-color: #c82333;
  }
</style>

```

---

## src/env.d.ts

```ts
/// <reference types="astro/client" />

declare global {
  interface Window {
    amplitude?: typeof import("@amplitude/unified");
    __amplitude_initialized?: boolean;
  }
}

export {};

```

---

## src/layouts/AmplitudeLayout.astro

```astro
---
import Amplitude from '../components/amplitude.astro';
import Header from '../components/Header.astro';
import '../styles/global.css';

interface Props {
  title: string;
}

const { title } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Astro Amplitude Static Integration Example" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title}</title>
    <Amplitude />
  </head>
  <body>
    <Header />
    <main>
      <slot />
    </main>
  </body>
</html>

```

---

## src/lib/auth.ts

```ts
// Client-side auth utilities for localStorage-based authentication

export interface User {
  username: string;
  burritoConsiderations: number;
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;

  const username = localStorage.getItem("currentUser");
  if (!username) return null;

  const considerations = parseInt(
    localStorage.getItem("burritoConsiderations") || "0",
    10,
  );

  return {
    username,
    burritoConsiderations: considerations,
  };
}

export function login(username: string, password: string): boolean {
  if (!username || !password) return false;

  localStorage.setItem("currentUser", username);
  // Initialize burrito considerations if not set
  if (!localStorage.getItem("burritoConsiderations")) {
    localStorage.setItem("burritoConsiderations", "0");
  }

  return true;
}

export function logout(): void {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("burritoConsiderations");
}

export function incrementBurritoConsiderations(): number {
  const current = parseInt(
    localStorage.getItem("burritoConsiderations") || "0",
    10,
  );
  const newCount = current + 1;
  localStorage.setItem("burritoConsiderations", newCount.toString());
  return newCount;
}

```

---

## src/pages/burrito.astro

```astro
---
import AmplitudeLayout from '../layouts/AmplitudeLayout.astro';
---
<AmplitudeLayout title="Burrito Consideration - Astro Amplitude Example">
  <div class="container">
    <h1>Burrito consideration zone</h1>
    <p>Take a moment to truly consider the potential of burritos.</p>

    <div style="text-align: center;">
      <button id="consider-btn" class="btn-burrito">
        I have considered the burrito potential
      </button>

      <p id="success-message" class="success" style="display: none;">
        Thank you for your consideration! Count: <span id="consideration-count"></span>
      </p>
    </div>

    <div class="stats">
      <h3>Consideration stats</h3>
      <p>Total considerations: <span id="total-considerations">0</span></p>
    </div>
  </div>
</AmplitudeLayout>

<script is:inline>
  function checkAuth() {
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) {
      window.location.href = '/';
      return false;
    }
    return true;
  }

  function updateStats() {
    const count = localStorage.getItem('burritoConsiderations') || '0';
    document.getElementById('total-considerations').textContent = count;
  }

  function handleConsideration() {
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) return;

    // Increment the count
    const currentCount = parseInt(localStorage.getItem('burritoConsiderations') || '0', 10);
    const newCount = currentCount + 1;
    localStorage.setItem('burritoConsiderations', newCount.toString());

    // Update the UI
    updateStats();

    const successMessage = document.getElementById('success-message');
    const considerationCount = document.getElementById('consideration-count');
    considerationCount.textContent = newCount;
    successMessage.style.display = 'block';

    // Hide success message after 2 seconds
    setTimeout(() => {
      successMessage.style.display = 'none';
    }, 2000);

    // Capture burrito consideration event in Amplitude
    window.amplitude?.track('Burrito Considered', {
      total_considerations: newCount,
      username: currentUser
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    updateStats();
    document.getElementById('consider-btn')?.addEventListener('click', handleConsideration);
  });
</script>

```

---

## src/pages/index.astro

```astro
---
import AmplitudeLayout from '../layouts/AmplitudeLayout.astro';
---
<AmplitudeLayout title="Home - Astro Amplitude Example">
  <div class="container">
    <div id="logged-in-view" style="display: none;">
      <h1>Welcome back, <span id="welcome-username"></span>!</h1>
      <p>You are now logged in. Feel free to explore:</p>
      <ul>
        <li>Consider the potential of burritos</li>
        <li>View your profile and statistics</li>
      </ul>
    </div>

    <div id="logged-out-view">
      <h1>Welcome to Burrito Consideration App</h1>
      <p>Please sign in to begin your burrito journey</p>

      <form id="login-form" class="form">
        <div class="form-group">
          <label for="username">Username:</label>
          <input
            type="text"
            id="username"
            placeholder="Enter any username"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">Password:</label>
          <input
            type="password"
            id="password"
            placeholder="Enter any password"
            required
          />
        </div>

        <p id="error-message" class="error" style="display: none;"></p>

        <button type="submit" class="btn-primary">Sign In</button>
      </form>

      <p class="note">
        Note: This is a demo app. Use any username and password to sign in.
      </p>
    </div>
  </div>
</AmplitudeLayout>

<script is:inline>
  function updateView() {
    const currentUser = localStorage.getItem('currentUser');
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const welcomeUsername = document.getElementById('welcome-username');

    if (currentUser) {
      loggedInView.style.display = 'block';
      loggedOutView.style.display = 'none';
      welcomeUsername.textContent = currentUser;
    } else {
      loggedInView.style.display = 'none';
      loggedOutView.style.display = 'block';
    }
  }

  function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    if (!username || !password) {
      errorMessage.textContent = 'Please provide both username and password';
      errorMessage.style.display = 'block';
      return;
    }

    // Client-side only fake auth - store in localStorage
    localStorage.setItem('currentUser', username);
    if (!localStorage.getItem('burritoConsiderations')) {
      localStorage.setItem('burritoConsiderations', '0');
    }

    // Identify the user in Amplitude (once on login is enough)
    window.amplitude?.setUserId(username);
    window.amplitude?.track('User Logged In');

    // Clear form
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    errorMessage.style.display = 'none';

    // Update view
    updateView();

    // Trigger header update
    window.dispatchEvent(new Event('storage'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateView();
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  });

  // Listen for storage changes
  window.addEventListener('storage', updateView);
</script>

```

---

## src/pages/profile.astro

```astro
---
import AmplitudeLayout from '../layouts/AmplitudeLayout.astro';
---
<AmplitudeLayout title="Profile - Astro Amplitude Example">
  <div class="container">
    <h1>User Profile</h1>

    <div class="stats">
      <h2>Your Information</h2>
      <p><strong>Username:</strong> <span id="profile-username"></span></p>
      <p><strong>Burrito Considerations:</strong> <span id="profile-considerations">0</span></p>
    </div>

    <div style="margin-top: 2rem;">
      <h3>Your Burrito Journey</h3>
      <p id="journey-message"></p>
    </div>
  </div>
</AmplitudeLayout>

<script is:inline>
  function checkAuth() {
    const currentUser = localStorage.getItem('currentUser');
    if (!currentUser) {
      window.location.href = '/';
      return false;
    }
    return true;
  }

  function updateProfile() {
    const username = localStorage.getItem('currentUser') || '';
    const considerations = parseInt(localStorage.getItem('burritoConsiderations') || '0', 10);

    document.getElementById('profile-username').textContent = username;
    document.getElementById('profile-considerations').textContent = considerations;

    // Update journey message based on consideration count
    const journeyMessage = document.getElementById('journey-message');
    if (considerations === 0) {
      journeyMessage.textContent = "You haven't considered any burritos yet. Visit the Burrito Consideration page to start!";
    } else if (considerations === 1) {
      journeyMessage.textContent = "You've considered the burrito potential once. Keep going!";
    } else if (considerations < 5) {
      journeyMessage.textContent = "You're getting the hang of burrito consideration!";
    } else if (considerations < 10) {
      journeyMessage.textContent = "You're becoming a burrito consideration expert!";
    } else {
      journeyMessage.textContent = "You are a true burrito consideration master!";
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;

    updateProfile();
  });
</script>

```

---

