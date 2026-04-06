# Amplitude Astro (SSR) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/astro-ssr

---

## README.md

# Amplitude Astro SSR Example

This is an [Astro](https://astro.build/) server-side rendered (SSR) example demonstrating Amplitude integration with both client-side and server-side event tracking.

It uses:

- **Client-side**: Amplitude web snippet for browser analytics
- **Server-side**: `@amplitude/analytics-node` for API route event tracking

This shows how to:

- Initialize Amplitude on both client and server
- Track events from API routes using `@amplitude/analytics-node`
- Pass session IDs from client to server for unified sessions
- Identify users on both client and server
- Capture errors via `amplitude.captureException()`
- Reset Amplitude state on logout

## Features

- **Server-side rendering**: Full SSR with `output: 'server'`
- **API routes**: Server-side endpoints for auth and event tracking
- **Dual tracking**: Events captured on both client and server
- **Session continuity**: Session ID passed to server via headers
- **Product analytics**: Track login and burrito consideration events
- **Session replay**: Enabled via Amplitude snippet configuration
- **Error tracking**: Manual error capture sent to Amplitude
- **Simple auth flow**: Demo login using localStorage + server API

## Getting started

### 1. Install dependencies

```bash
npm install
# or
pnpm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
# Client-side (PUBLIC_ prefix exposes to browser)
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_project_token
PUBLIC_AMPLITUDE_API_KEY=https://us.i.amplitude.com

# Server-side (no PUBLIC_ prefix, server-only)
AMPLITUDE_API_KEY=your_amplitude_project_token
AMPLITUDE_API_KEY=https://us.i.amplitude.com
```

Get your Amplitude project token from your project settings in Amplitude.

### 3. Run the development server

```bash
npm run dev
# or
pnpm dev
```

Open `http://localhost:4321` in your browser.

## Project structure

```text
src/
  components/
    amplitude.astro      # Amplitude snippet for client-side tracking
    Header.astro       # Navigation + logout, calls amplitude.reset()
  layouts/
    AmplitudeLayout.astro # Root layout that includes Amplitude + Header
  lib/
    auth.ts            # Client-side auth utilities
    amplitude-server.ts  # Server-side Amplitude client singleton
  pages/
    index.astro        # Login form, calls /api/auth/login
    burrito.astro      # Burrito demo, calls /api/events/burrito
    profile.astro      # Profile + error tracking demo
    api/
      auth/
        login.ts       # Server-side login endpoint with Amplitude tracking
      events/
        burrito.ts     # Server-side event capture endpoint
  styles/
    global.css         # Global styles
```

## Key integration points

### Server-side Amplitude client (`src/lib/amplitude-server.ts`)

A singleton pattern ensures only one Amplitude client is created:

```typescript
import { Amplitude } from "@amplitude/analytics-node";

let amplitudeClient: Amplitude | null = null;

export function getAmplitudeServer(): Amplitude {
  if (!amplitudeClient) {
    amplitudeClient = new Amplitude(import.meta.env.AMPLITUDE_API_KEY, {
      host: import.meta.env.AMPLITUDE_API_KEY,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return amplitudeClient;
}
```

### API route with server-side tracking (`src/pages/api/auth/login.ts`)

```typescript
import { getAmplitudeServer } from "../../../lib/amplitude-server";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const { username } = body;

  // Get session ID from client
  const sessionId = request.headers.get("X-Amplitude-Session-Id");

  const amplitude = getAmplitudeServer();

  // Capture server-side event
  amplitude.capture({
    distinctId: username,
    event: "server_login",
    properties: {
      $session_id: sessionId || undefined,
      source: "api",
    },
  });

  return new Response(JSON.stringify({ success: true }));
};
```

### Passing session ID to server (`src/pages/index.astro`)

```javascript
// Get the session ID from Amplitude to pass to the server
const sessionId = window.amplitude?.get_session_id?.() || null;

const response = await fetch("/api/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Amplitude-Session-Id": sessionId || "",
  },
  body: JSON.stringify({ username, password }),
});
```

### Client-side identification (`src/pages/index.astro`)

After server login succeeds, also identify on client:

```javascript
window.amplitude?.identify(username);
window.amplitude?.capture("user_logged_in");
```

### Logout and session reset (`src/components/Header.astro`)

On logout, both the local auth state and Amplitude state are cleared:

```javascript
window.amplitude?.capture("user_logged_out");
localStorage.removeItem("currentUser");
window.amplitude?.reset();
```

## Scripts

```bash
# Run dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Learn more

- [Amplitude documentation](https://amplitude.com/docs)
- [Amplitude Astro guide](https://amplitude.com/docs/libraries/astro)
- [Amplitude Node.js SDK](https://amplitude.com/docs/libraries/node)
- [Astro SSR documentation](https://docs.astro.build/en/guides/server-side-rendering/)

---

## .env.example

```example
# Client-side environment variables (PUBLIC_ prefix)
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

# Server-side environment variables (no PUBLIC_ prefix)
AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## astro.config.mjs

```mjs
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  image: {
    service: { entrypoint: "astro/assets/services/noop" },
  },
});

```

---

## src/components/amplitude.astro

```astro
---
// Amplitude analytics snippet for client-side tracking
// Uses is:inline to prevent Astro from processing the script
---
<script is:inline define:vars={{ apiKey: import.meta.env.PUBLIC_AMPLITUDE_API_KEY }}>
  !function(){"use strict";!function(e,t){var r=e.amplitude||{_q:[],_iq:{}};if(r.invoked)e.console&&console.error&&console.error("Amplitude snippet has been loaded.");else{r.invoked=!0;var n=t.createElement("script");n.type="text/javascript",n.integrity="sha384-x0ik2D45ZDEEEpYpEuDpmj05fY91P7EOZkgdKmVBAZoGtzwnlsHI9AqlBJmg+WT4",n.crossOrigin="anonymous",n.async=!0,n.src="https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz",n.onload=function(){e.amplitude.runQueuedFunctions||console.log("[Amplitude] Error: could not load SDK")};var s=t.getElementsByTagName("script")[0];function v(e,t){e.prototype[t]=function(){return this._q.push({name:t,args:Array.prototype.slice.call(arguments,0)}),this}}s.parentNode.insertBefore(n,s);for(var o=function(){return this._q=[],this},a=["add","append","clearAll","prepend","set","setOnce","unset","preInsert","postInsert","remove","getUserProperties"],c=0;c<a.length;c++)v(o,a[c]);r.Identify=o;for(var u=function(){return this._q=[],this},l=["getEventProperties","setProductId","setQuantity","setPrice","setRevenue","setRevenueType","setEventProperties"],p=0;p<l.length;p++)v(u,l[p]);r.Revenue=u;var d=["getDeviceId","setDeviceId","getSessionId","setSessionId","getUserId","setUserId","setOptOut","setTransport","reset","extendSession"],f=["init","add","remove","track","logEvent","identify","groupIdentify","setGroup","revenue","flush"];function m(e){function t(t,r){e[t]=function(){var n={promise:new Promise((r=>{e._q.push({name:t,args:Array.prototype.slice.call(arguments,0),resolve:r})}))};if(r)return n}}for(var r=0;r<d.length;r++)t(d[r],!1);for(var n=0;n<f.length;n++)t(f[n],!0)}m(r),r.getInstance=function(e){return e=(e&&e.length>0&&e||"$default_instance").toLowerCase(),Object.prototype.hasOwnProperty.call(r._iq,e)||(r._iq[e]={_q:[]},m(r._iq[e])),r._iq[e]},e.amplitude=r}}(window,document)}();

  amplitude.init(apiKey || '');
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
      window.amplitude?.track('user_logged_out');
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
    <meta name="description" content="Astro Amplitude SSR Integration Example" />
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

## src/lib/amplitude-server.ts

```ts
import { NodeClient, init, flush } from "@amplitude/analytics-node";

let amplitudeClient: NodeClient | null = null;

/**
 * Get the Amplitude server-side client.
 * Uses a singleton pattern to avoid creating multiple clients.
 */
export function getAmplitudeServer(): NodeClient {
  if (!amplitudeClient) {
    amplitudeClient = init(import.meta.env.AMPLITUDE_API_KEY || "");
  }
  return amplitudeClient;
}

/**
 * Flush the Amplitude client gracefully.
 * Call this when your server is shutting down.
 */
export async function flushAmplitude(): Promise<void> {
  if (amplitudeClient) {
    await flush();
  }
}

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

## src/pages/api/auth/login.ts

```ts
import type { APIRoute } from "astro";
import { getAmplitudeServer } from "../../../lib/amplitude-server";
import { track, identify, Identify } from "@amplitude/analytics-node";

// In-memory user store for demo purposes
const users = new Map<string, { username: string; createdAt: string }>();

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "Username and password are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check if this is a new user
    const isNewUser = !users.has(username);

    if (isNewUser) {
      users.set(username, {
        username,
        createdAt: new Date().toISOString(),
      });
    }

    // Get the Amplitude server client
    getAmplitudeServer();

    // Capture server-side login event
    track("server_login", {
      isNewUser,
      source: "api",
      timestamp: new Date().toISOString(),
    }, { user_id: username });

    // Identify the user server-side
    const identifyEvent = new Identify();
    identifyEvent.set("username", username);
    if (isNewUser) {
      identifyEvent.set("createdAt", new Date().toISOString());
    }
    identify(identifyEvent, { user_id: username });

    return new Response(
      JSON.stringify({
        success: true,
        username,
        isNewUser,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Login error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

```

---

## src/pages/api/events/burrito.ts

```ts
import type { APIRoute } from "astro";
import { getAmplitudeServer } from "../../../lib/amplitude-server";
import { track } from "@amplitude/analytics-node";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { username, totalConsiderations } = body;

    if (!username) {
      return new Response(JSON.stringify({ error: "Username is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the Amplitude server client
    getAmplitudeServer();

    // Capture server-side burrito consideration event
    track("burrito_considered", {
      total_considerations: totalConsiderations,
      source: "api",
      timestamp: new Date().toISOString(),
    }, { user_id: username });

    return new Response(
      JSON.stringify({
        success: true,
        totalConsiderations,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Burrito event error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

```

---

## src/pages/burrito.astro

```astro
---
import AmplitudeLayout from '../layouts/AmplitudeLayout.astro';
---
<AmplitudeLayout title="Burrito Consideration - Astro Amplitude SSR Example">
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

    <p class="note" style="margin-top: 1rem;">
      Events are tracked both client-side and server-side for demonstration.
    </p>
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

  async function handleConsideration() {
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

    // Client-side event tracking
    window.amplitude?.track('burrito_considered', {
      total_considerations: newCount,
      username: currentUser,
      source: 'client'
    });

    // Also send to server-side API for server tracking
    try {
      await fetch('/api/events/burrito', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: currentUser,
          totalConsiderations: newCount
        })
      });
    } catch (error) {
      console.error('Failed to send server-side event:', error);
    }
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
<AmplitudeLayout title="Home - Astro Amplitude SSR Example">
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
        Note: This is a demo app with server-side tracking. Use any username and password to sign in.
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

  async function handleLogin(event) {
    event.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    if (!username || !password) {
      errorMessage.textContent = 'Please provide both username and password';
      errorMessage.style.display = 'block';
      return;
    }

    try {
      // Call the server-side login API
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store in localStorage for client-side state
      localStorage.setItem('currentUser', username);
      if (!localStorage.getItem('burritoConsiderations')) {
        localStorage.setItem('burritoConsiderations', '0');
      }

      // Also identify on the client side (for session continuity)
      window.amplitude?.setUserId(username);
      window.amplitude?.track('user_logged_in');

      // Clear form
      document.getElementById('username').value = '';
      document.getElementById('password').value = '';
      errorMessage.style.display = 'none';

      // Update view
      updateView();

      // Trigger header update
      window.dispatchEvent(new Event('storage'));
    } catch (error) {
      errorMessage.textContent = error.message || 'Login failed';
      errorMessage.style.display = 'block';
    }
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
<AmplitudeLayout title="Profile - Astro Amplitude SSR Example">
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

