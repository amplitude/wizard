# Amplitude Astro (Hybrid) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/astro-hybrid

---

## README.md

# Amplitude Astro Hybrid Example

This is an [Astro](https://astro.build/) hybrid rendering example: mostly static pages with SSR or API routes where needed.

### Amplitude SDKs

The client follows the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) with `initAll` in `src/components/amplitude.astro`, plus `window.amplitude` for inline scripts. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) documents `initAll` as initializing every product bundled with Unified npm. See [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) for `analytics`, `sessionReplay`, `experiment`, and `engagement`. The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for Amplitude’s [CDN install](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-script-cdn), not Unified **npm**.

API and server code use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node) in `src/lib/amplitude-server.ts` (for example `AMPLITUDE_API_KEY`, server-only).

## Features

- **Hybrid rendering**: Static by default; opt-in SSR (`export const prerender = false`) where needed
- **API routes** with Node SDK tracking
- **Client** unified SDK

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key
AMPLITUDE_API_KEY=your_amplitude_api_key
```

`PUBLIC_` is for browser `initAll`. `AMPLITUDE_API_KEY` is read in `src/lib/amplitude-server.ts` for API routes (not prefixed with `PUBLIC_`).

### 3. Run the development server

```bash
pnpm dev
```

Open `http://localhost:4321`.

## Key integration points

### Client (`src/components/amplitude.astro`)

Same pattern as the static example: `import * as amplitude from "@amplitude/unified"`, `void amplitude.initAll(apiKey)`, then `window.amplitude = amplitude`.

### Server (`src/lib/amplitude-server.ts`)

```typescript
import { init, flush } from "@amplitude/analytics-node";
import type { NodeClient } from "@amplitude/analytics-node";

let amplitudeClient: NodeClient | null = null;

export function getAmplitudeServer(): NodeClient {
  if (!amplitudeClient) {
    amplitudeClient = init(import.meta.env.AMPLITUDE_API_KEY || "");
  }
  return amplitudeClient;
}
```

### Hybrid config

See `astro.config.mjs` for `output`, adapter, and prerender behavior.

## When to use Hybrid mode

Use hybrid mode when you want:

- **Performance**: Most pages prerendered as static HTML
- **Flexibility**: Some pages need server-side logic (auth, personalization)
- **API routes**: Server-side endpoints for data processing

## Scripts

```bash
pnpm dev
pnpm build
pnpm preview
```

## Learn more

- [Browser Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk) — [npm](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm), [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration), [CDN vs npm products](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method)
- [Node.js SDK](https://amplitude.com/docs/sdks/analytics/node/node-js-sdk)
- [Astro hybrid / on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)

---

## .astro/content-assets.mjs

```mjs
export default new Map();
```

---

## .astro/content-modules.mjs

```mjs
export default new Map();
```

---

## .astro/content.d.ts

```ts
declare module 'astro:content' {
	export interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	export type ReferenceDataEntry<
		C extends CollectionKey,
		E extends keyof DataEntryMap[C] = string,
	> = {
		collection: C;
		id: E;
	};
	export type ReferenceContentEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}) = string,
	> = {
		collection: C;
		slug: E;
	};
	export type ReferenceLiveEntry<C extends keyof LiveContentConfig['collections']> = {
		collection: C;
		id: string;
	};

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getLiveCollection<C extends keyof LiveContentConfig['collections']>(
		collection: C,
		filter?: LiveLoaderCollectionFilterType<C>,
	): Promise<
		import('astro').LiveDataCollectionResult<LiveLoaderDataType<C>, LiveLoaderErrorType<C>>
	>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		entry: ReferenceContentEntry<C, E>,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		entry: ReferenceDataEntry<C, E>,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? string extends keyof DataEntryMap[C]
			? Promise<DataEntryMap[C][E]> | undefined
			: Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getLiveEntry<C extends keyof LiveContentConfig['collections']>(
		collection: C,
		filter: string | LiveLoaderEntryFilterType<C>,
	): Promise<import('astro').LiveDataEntryResult<LiveLoaderDataType<C>, LiveLoaderErrorType<C>>>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: ReferenceContentEntry<C, ValidContentEntrySlug<C>>[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: ReferenceDataEntry<C, keyof DataEntryMap[C]>[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? ReferenceContentEntry<C, ValidContentEntrySlug<C>>
			: ReferenceDataEntry<C, keyof DataEntryMap[C]>
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		
	};

	type DataEntryMap = {
		
	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	type ExtractLoaderTypes<T> = T extends import('astro/loaders').LiveLoader<
		infer TData,
		infer TEntryFilter,
		infer TCollectionFilter,
		infer TError
	>
		? { data: TData; entryFilter: TEntryFilter; collectionFilter: TCollectionFilter; error: TError }
		: { data: never; entryFilter: never; collectionFilter: never; error: never };
	type ExtractDataType<T> = ExtractLoaderTypes<T>['data'];
	type ExtractEntryFilterType<T> = ExtractLoaderTypes<T>['entryFilter'];
	type ExtractCollectionFilterType<T> = ExtractLoaderTypes<T>['collectionFilter'];
	type ExtractErrorType<T> = ExtractLoaderTypes<T>['error'];

	type LiveLoaderDataType<C extends keyof LiveContentConfig['collections']> =
		LiveContentConfig['collections'][C]['schema'] extends undefined
			? ExtractDataType<LiveContentConfig['collections'][C]['loader']>
			: import('astro/zod').infer<
					Exclude<LiveContentConfig['collections'][C]['schema'], undefined>
				>;
	type LiveLoaderEntryFilterType<C extends keyof LiveContentConfig['collections']> =
		ExtractEntryFilterType<LiveContentConfig['collections'][C]['loader']>;
	type LiveLoaderCollectionFilterType<C extends keyof LiveContentConfig['collections']> =
		ExtractCollectionFilterType<LiveContentConfig['collections'][C]['loader']>;
	type LiveLoaderErrorType<C extends keyof LiveContentConfig['collections']> = ExtractErrorType<
		LiveContentConfig['collections'][C]['loader']
	>;

	export type ContentConfig = typeof import("../src/content.config.mjs");
	export type LiveContentConfig = never;
}

```

---

## .astro/types.d.ts

```ts
/// <reference types="astro/client" />
/// <reference path="content.d.ts" />
```

---

## .env.example

```example
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## astro.config.mjs

```mjs
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  // In Astro 5, 'static' is the default and supports per-page SSR opt-in
  // Use `export const prerender = false` in pages that need server rendering
  output: "static",
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
    <meta name="description" content="Astro Amplitude Hybrid Integration Example" />
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
import { init, flush } from "@amplitude/analytics-node";
import type { NodeClient } from "@amplitude/analytics-core";

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

export const prerender = false;

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
    track("Server Login Completed", {
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

export const prerender = false;

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
    track("Burrito Considered", {
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

// Opt this page into on-demand rendering (SSR)
// In hybrid mode, pages are static by default
export const prerender = false;
---
<AmplitudeLayout title="Burrito Consideration - Astro Amplitude Hybrid Example">
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
    window.amplitude?.track('Burrito Considered', {
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

// This page is prerendered (static) by default in hybrid mode
// No need to set prerender = true explicitly
---
<AmplitudeLayout title="Home - Astro Amplitude Hybrid Example">
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
      window.amplitude?.track('User Logged In');

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

// This page is prerendered (static) by default in hybrid mode
---
<AmplitudeLayout title="Profile - Astro Amplitude Hybrid Example">
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

