# Amplitude Astro (View Transitions) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/astro-view-transitions

---

## README.md

# Amplitude Astro View Transitions Example

This is an [Astro](https://astro.build/) example demonstrating Amplitude integration with [View Transitions](https://docs.astro.build/en/guides/view-transitions/) (ClientRouter) for SPA-like navigation.

It uses the Amplitude web snippet with special handling to prevent stack overflow errors during soft navigation, and shows how to:

- Initialize Amplitude with an initialization guard for View Transitions
- Track pageviews automatically during soft navigation
- Identify users after login
- Track custom events from pages
- Capture errors via `amplitude.captureException()`
- Reset Amplitude state on logout

## Features

- **View Transitions**: Smooth client-side navigation with `<ClientRouter />`
- **Product analytics**: Track login and burrito consideration events
- **Automatic pageview tracking**: Uses `capture_pageview: 'history_change'` for soft navigation
- **Session replay**: Enabled via Amplitude snippet configuration
- **Error tracking**: Manual error capture sent to Amplitude
- **Simple auth flow**: Demo login using localStorage

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
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_project_token
PUBLIC_AMPLITUDE_API_KEY=https://us.i.amplitude.com
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
    amplitude.astro      # Amplitude snippet WITH initialization guard
    Header.astro       # Navigation + logout, uses astro:page-load event
  layouts/
    AmplitudeLayout.astro # Root layout with <ClientRouter /> and Amplitude
  lib/
    auth.ts            # Auth utilities (localStorage-based)
  pages/
    index.astro        # Login form, identifies user + captures 'user_logged_in'
    burrito.astro      # Burrito consideration demo, captures 'burrito_considered'
    profile.astro      # Profile + error tracking demo
  styles/
    global.css         # Global styles + view transition animations
```

## Key integration points

### Amplitude initialization with View Transitions (`src/components/amplitude.astro`)

When using Astro's View Transitions (ClientRouter), you **must** wrap the Amplitude initialization with a guard to prevent stack overflow errors:

```astro
<script is:inline>
  // IMPORTANT: Guard against multiple initializations during view transitions
  if (!window.__amplitude_initialized) {
    window.__amplitude_initialized = true;
    !function(t,e){...}(document,window.amplitude||[]);
    amplitude.init('<ph_project_token>', {
      api_host: 'https://us.i.amplitude.com',
      defaults: '2026-01-30',
      // IMPORTANT: Use 'history_change' for automatic pageview tracking during soft navigation
      capture_pageview: 'history_change'
    })
  }
</script>
```

Without this guard, ClientRouter's soft navigation can re-execute the inline script during page transitions, causing a stack overflow error.

The `capture_pageview: 'history_change'` option ensures pageviews are tracked automatically as users navigate between pages.

### Layout with ClientRouter (`src/layouts/AmplitudeLayout.astro`)

The layout includes Astro's ClientRouter for smooth page transitions:

```astro
---
import { ClientRouter } from 'astro:transitions';
import Amplitude from '../components/amplitude.astro';
---
<html>
  <head>
    <ClientRouter />
    <Amplitude />
  </head>
  ...
</html>
```

### Handling View Transitions in scripts

When using View Transitions, you need to set up event listeners after each page navigation:

```javascript
function setupPage() {
  // Your setup code here
}

// Run on initial page load
document.addEventListener("DOMContentLoaded", setupPage);

// Run after view transitions complete (for soft navigation)
document.addEventListener("astro:page-load", setupPage);
```

### User identification (`src/pages/index.astro`)

After a successful "login", the app identifies the user and captures a login event:

```javascript
window.amplitude?.identify(username);
window.amplitude?.capture("user_logged_in");
```

### Event tracking (`src/pages/burrito.astro`)

The burrito page tracks a custom event when a user "considers" the burrito:

```javascript
window.amplitude?.capture("burrito_considered", {
  total_considerations: newCount,
  username: currentUser,
});
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
- [Astro View Transitions](https://docs.astro.build/en/guides/view-transitions/)
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
// Amplitude analytics snippet with View Transitions support
// Uses is:inline to prevent Astro from processing the script
// Includes initialization guard to prevent double-loading with ClientRouter
---
<script is:inline define:vars={{ apiKey: import.meta.env.PUBLIC_AMPLITUDE_API_KEY }}>
  // IMPORTANT: Guard against multiple initializations during view transitions
  // Without this guard, ClientRouter's soft navigation can re-execute the inline script
  // during page transitions.
  if (!window.__amplitude_initialized) {
    window.__amplitude_initialized = true;
    !function(){"use strict";!function(e,t){var r=e.amplitude||{_q:[],_iq:{}};if(r.invoked)e.console&&console.error&&console.error("Amplitude snippet has been loaded.");else{r.invoked=!0;var n=t.createElement("script");n.type="text/javascript",n.integrity="sha384-x0ik2D45ZDEEEpYpEuDpmj05fY91P7EOZkgdKmVBAZoGtzwnlsHI9AqlBJmg+WT4",n.crossOrigin="anonymous",n.async=!0,n.src="https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz",n.onload=function(){e.amplitude.runQueuedFunctions||console.log("[Amplitude] Error: could not load SDK")};var s=t.getElementsByTagName("script")[0];function v(e,t){e.prototype[t]=function(){return this._q.push({name:t,args:Array.prototype.slice.call(arguments,0)}),this}}s.parentNode.insertBefore(n,s);for(var o=function(){return this._q=[],this},a=["add","append","clearAll","prepend","set","setOnce","unset","preInsert","postInsert","remove","getUserProperties"],c=0;c<a.length;c++)v(o,a[c]);r.Identify=o;for(var u=function(){return this._q=[],this},l=["getEventProperties","setProductId","setQuantity","setPrice","setRevenue","setRevenueType","setEventProperties"],p=0;p<l.length;p++)v(u,l[p]);r.Revenue=u;var d=["getDeviceId","setDeviceId","getSessionId","setSessionId","getUserId","setUserId","setOptOut","setTransport","reset","extendSession"],f=["init","add","remove","track","logEvent","identify","groupIdentify","setGroup","revenue","flush"];function m(e){function t(t,r){e[t]=function(){var n={promise:new Promise((r=>{e._q.push({name:t,args:Array.prototype.slice.call(arguments,0),resolve:r})}))};if(r)return n}}for(var r=0;r<d.length;r++)t(d[r],!1);for(var n=0;n<f.length;n++)t(f[n],!0)}m(r),r.getInstance=function(e){return e=(e&&e.length>0&&e||"$default_instance").toLowerCase(),Object.prototype.hasOwnProperty.call(r._iq,e)||(r._iq[e]={_q:[]},m(r._iq[e])),r._iq[e]},e.amplitude=r}}(window,document)}();

    amplitude.init(apiKey || '');
  }
</script>

```

---

## src/components/Header.astro

```astro
---
// Header component with navigation and logout functionality
// Works with View Transitions by using data-astro-reload for logout
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

  function setupHeader() {
    updateHeader();
    const logoutBtn = document.querySelector('.btn-logout');
    // Remove existing listeners to prevent duplicates during view transitions
    logoutBtn?.removeEventListener('click', handleLogout);
    logoutBtn?.addEventListener('click', handleLogout);
  }

  // Run on initial page load
  document.addEventListener('DOMContentLoaded', setupHeader);

  // Run after view transitions complete (for soft navigation)
  document.addEventListener('astro:page-load', setupHeader);

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
import { ClientRouter } from 'astro:transitions';
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
    <meta name="description" content="Astro Amplitude Integration with View Transitions" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>{title}</title>
    <ClientRouter />
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
<AmplitudeLayout title="Burrito Consideration - Astro Amplitude with View Transitions">
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
    const totalElement = document.getElementById('total-considerations');
    if (totalElement) {
      totalElement.textContent = count;
    }
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
    if (considerationCount) {
      considerationCount.textContent = newCount;
    }
    if (successMessage) {
      successMessage.style.display = 'block';

      // Hide success message after 2 seconds
      setTimeout(() => {
        successMessage.style.display = 'none';
      }, 2000);
    }

    // Capture burrito consideration event in Amplitude
    window.amplitude?.track('burrito_considered', {
      total_considerations: newCount,
      username: currentUser
    });
  }

  function setupBurritoPage() {
    if (!checkAuth()) return;

    updateStats();
    const btn = document.getElementById('consider-btn');
    // Remove existing listener to prevent duplicates during view transitions
    btn?.removeEventListener('click', handleConsideration);
    btn?.addEventListener('click', handleConsideration);
  }

  // Run on initial page load
  document.addEventListener('DOMContentLoaded', setupBurritoPage);

  // Run after view transitions complete (for soft navigation)
  document.addEventListener('astro:page-load', setupBurritoPage);
</script>

```

---

## src/pages/index.astro

```astro
---
import AmplitudeLayout from '../layouts/AmplitudeLayout.astro';
---
<AmplitudeLayout title="Home - Astro Amplitude with View Transitions">
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
    window.amplitude?.track('user_logged_in');

    // Clear form
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    errorMessage.style.display = 'none';

    // Update view
    updateView();

    // Trigger header update
    window.dispatchEvent(new Event('storage'));
  }

  function setupIndexPage() {
    updateView();
    const form = document.getElementById('login-form');
    // Remove existing listener to prevent duplicates during view transitions
    form?.removeEventListener('submit', handleLogin);
    form?.addEventListener('submit', handleLogin);
  }

  // Run on initial page load
  document.addEventListener('DOMContentLoaded', setupIndexPage);

  // Run after view transitions complete (for soft navigation)
  document.addEventListener('astro:page-load', setupIndexPage);

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
<AmplitudeLayout title="Profile - Astro Amplitude with View Transitions">
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

    const usernameEl = document.getElementById('profile-username');
    const considerationsEl = document.getElementById('profile-considerations');
    const journeyMessage = document.getElementById('journey-message');

    if (usernameEl) usernameEl.textContent = username;
    if (considerationsEl) considerationsEl.textContent = considerations.toString();

    // Update journey message based on consideration count
    if (journeyMessage) {
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
  }

  function setupProfilePage() {
    if (!checkAuth()) return;

    updateProfile();
  }

  // Run on initial page load
  document.addEventListener('DOMContentLoaded', setupProfilePage);

  // Run after view transitions complete (for soft navigation)
  document.addEventListener('astro:page-load', setupProfilePage);
</script>

```

---

