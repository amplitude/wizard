# Amplitude SvelteKit Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/sveltekit

---

## README.md

# SvelteKit Amplitude example

This example integrates Amplitude with SvelteKit: user identification and custom event tracking on the client, with optional server-side events.

### Amplitude SDKs

On the client, [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) is initialized with `initAll` from client hooks. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) describes that call as initializing every product bundled with Unified npm (Analytics, Session Replay, the **Feature Experiment** client, and Guides & Surveys as covered in the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm) overview). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for Amplitude’s [CDN unified script](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-script-cdn), not the Unified **npm** row—the `experiment` config here is `experiment-js-client`, not `experiment-tag`.

For server-only events, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node) and keep `@amplitude/unified` in the browser.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example environment file and add your Amplitude API key:

```bash
cp .env.example .env
```

Edit `.env` with your Amplitude API key:

```
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Project structure

```
src/
├── lib/
│   ├── auth.svelte.ts              # Auth context with Svelte 5 runes
│   ├── components/
│   │   └── Header.svelte           # Navigation component
│   └── server/
│       └── amplitude.ts            # Server-side Amplitude singleton
├── routes/
│   ├── +layout.svelte              # Root layout with auth provider
│   ├── +page.svelte                # Home/login page
│   ├── burrito/
│   │   └── +page.svelte            # Event tracking demo
│   ├── profile/
│   │   └── +page.svelte            # User profile page
│   └── api/
│       └── auth/
│           └── login/
│               └── +server.ts      # Login API with server-side tracking
├── hooks.client.ts                 # Client-side Amplitude initialization
├── hooks.server.ts                 # Server hooks
├── app.css                         # Global styles
└── app.html                        # HTML template
```

## Key integration points

### Client-side initialization (`src/hooks.client.ts`)

Amplitude is initialized in the SvelteKit client hooks `init` function, which runs once when the app starts:

```typescript
import * as amplitude from '@amplitude/unified';
import { env } from '$env/dynamic/public';

export async function init() {
  void amplitude.initAll(env.PUBLIC_AMPLITUDE_API_KEY ?? '');
}
```

`$env/dynamic/public` avoids build failures when `PUBLIC_AMPLITUDE_API_KEY` is missing at build time (see [SvelteKit `$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)).

### Server-side tracking (`src/lib/server/amplitude.ts`)

A singleton pattern ensures one Amplitude client instance for server-side tracking:

```typescript
import { createInstance } from '@amplitude/analytics-node';
import { env } from '$env/dynamic/public';

type AmplitudeNodeClient = ReturnType<typeof createInstance>;

let amplitudeClient: AmplitudeNodeClient | null = null;

export function getAmplitudeClient(): AmplitudeNodeClient {
  if (!amplitudeClient) {
    amplitudeClient = createInstance();
    amplitudeClient.init(env.PUBLIC_AMPLITUDE_API_KEY ?? '');
  }
  return amplitudeClient;
}
```

### User identification

When a user logs in, they are identified in Amplitude:

```typescript
import * as amplitude from '@amplitude/unified';
import { Identify } from '@amplitude/unified';

// On login
amplitude.setUserId(username);
const identifyObj = new Identify();
identifyObj.set('username', username);
amplitude.identify(identifyObj);
amplitude.track('User Logged In', { username });

// On logout
amplitude.track('User Logged Out');
amplitude.reset();
```

### Event tracking

```typescript
amplitude.track('Burrito Considered', {
  total_considerations: auth.user.burritoConsiderations,
  username: auth.user.username
});
```

## Features demonstrated

1. **Login page** (`/`) - User authentication with Amplitude identification
2. **Burrito page** (`/burrito`) - Custom event tracking with properties
3. **Profile page** (`/profile`) - User profile display

## Learn more

- [Browser Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk) — [npm & `initAll`](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm), [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration)
- [Browser SDK 2 (analytics)](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)
- [Node.js SDK](https://amplitude.com/docs/sdks/analytics/node/node-js-sdk)
- [SvelteKit documentation](https://svelte.dev/docs/kit)

---

## .env.example

```example
# Amplitude configuration
# Get your Amplitude API key from: https://app.amplitude.com
PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## .npmrc

```
engine-strict=true

```

---

## src/app.d.ts

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

```

---

## src/app.html

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		%sveltekit.head%
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>

```

---

## src/hooks.client.ts

```ts
import * as amplitude from '@amplitude/unified';
import { env } from '$env/dynamic/public';

// Initialize Amplitude when the app starts in the browser
export async function init() {
	void amplitude.initAll(env.PUBLIC_AMPLITUDE_API_KEY ?? '');
}

```

---

## src/hooks.server.ts

```ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};

```

---

## src/lib/auth.svelte.ts

```ts
import { getContext, setContext } from 'svelte';
import * as amplitude from '@amplitude/unified';
import { Identify } from '@amplitude/unified';
import { browser } from '$app/environment';

export interface User {
	username: string;
	burritoConsiderations: number;
}

const AUTH_KEY = Symbol('auth');

// Class-based auth state using Svelte 5 $state in class fields
// This is the recommended pattern for encapsulating reactive state + behavior
export class AuthState {
	user = $state<User | null>(null);

	constructor() {
		// Restore user from localStorage on creation (browser only)
		if (browser) {
			const storedUsername = localStorage.getItem('currentUser');
			if (storedUsername) {
				this.user = { username: storedUsername, burritoConsiderations: 0 };
			}
		}
	}

	login = async (username: string, password: string): Promise<boolean> => {
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});

			if (response.ok) {
				const { user: userData } = await response.json();
				this.user = userData as User;

				if (browser) {
					localStorage.setItem('currentUser', username);
					amplitude.setUserId(username);
					const identifyObj = new Identify();
					identifyObj.set('username', username);
					amplitude.identify(identifyObj);
					amplitude.track('User Logged In', { username });
				}

				return true;
			}
			return false;
		} catch (error) {
			console.error('Login error:', error);
			return false;
		}
	};

	logout = (): void => {
		if (browser) {
			amplitude.track('User Logged Out');
			amplitude.reset();
			localStorage.removeItem('currentUser');
		}
		this.user = null;
	};

	incrementBurritoConsiderations = (): void => {
		if (this.user) {
			this.user = {
				...this.user,
				burritoConsiderations: this.user.burritoConsiderations + 1
			};
		}
	};
}

export function setAuthContext(auth: AuthState) {
	setContext(AUTH_KEY, auth);
}

export function getAuthContext(): AuthState {
	return getContext<AuthState>(AUTH_KEY);
}

```

---

## src/lib/components/Header.svelte

```svelte
<script lang="ts">
	import { getAuthContext } from '$lib/auth.svelte';

	const auth = getAuthContext();
</script>

<header class="header">
	<div class="header-container">
		<nav>
			<a href="/">Home</a>
			{#if auth.user}
				<a href="/burrito">Burrito</a>
				<a href="/profile">Profile</a>
			{/if}
		</nav>
		<div class="user-section">
			{#if auth.user}
				<span>Welcome, {auth.user.username}</span>
				<button class="btn-logout" onclick={() => auth.logout()}>Logout</button>
			{/if}
		</div>
	</div>
</header>

```

---

## src/lib/index.ts

```ts
// place files you want to import through the `$lib` alias in this folder.

```

---

## src/lib/server/amplitude.ts

```ts
import { createInstance } from '@amplitude/analytics-node';
import { env } from '$env/dynamic/public';

type AmplitudeNodeClient = ReturnType<typeof createInstance>;

let amplitudeClient: AmplitudeNodeClient | null = null;

export function getAmplitudeClient(): AmplitudeNodeClient {
	if (!amplitudeClient) {
		amplitudeClient = createInstance();
		amplitudeClient.init(env.PUBLIC_AMPLITUDE_API_KEY ?? '');
	}
	return amplitudeClient;
}

export async function flushAmplitude() {
	if (amplitudeClient) {
		await amplitudeClient.flush();
	}
}

```

---

## src/routes/+layout.svelte

```svelte
<script lang="ts">
	import { AuthState, setAuthContext } from '$lib/auth.svelte';
	import Header from '$lib/components/Header.svelte';
	import '../app.css';

	let { children } = $props();

	// Create and provide auth context
	const auth = new AuthState();
	setAuthContext(auth);
</script>

<svelte:head>
	<title>Burrito consideration app</title>
	<meta name="description" content="Consider the potential of burritos with Amplitude analytics" />
</svelte:head>

<Header />
<main>
	{@render children()}
</main>

```

---

## src/routes/+page.svelte

```svelte
<script lang="ts">
	import { getAuthContext } from '$lib/auth.svelte';

	const auth = getAuthContext();

	let username = $state('');
	let password = $state('');
	let error = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';

		try {
			const success = await auth.login(username, password);
			if (success) {
				username = '';
				password = '';
			} else {
				error = 'Please provide both username and password';
			}
		} catch (err) {
			console.error('Login failed:', err);
			error = 'An error occurred during login';
		}
	}
</script>

<div class="container">
	{#if auth.user}
		<h1>Welcome back, {auth.user.username}!</h1>
		<p>You are now logged in. Check out the navigation to explore features.</p>
		<ul>
			<li><a href="/burrito">Consider a burrito</a></li>
			<li><a href="/profile">View your profile</a></li>
		</ul>
	{:else}
		<h1>Welcome to Burrito consideration app</h1>
		<p>Sign in to start considering burritos.</p>

		<form class="form" onsubmit={handleSubmit}>
			<div class="form-group">
				<label for="username">Username:</label>
				<input type="text" id="username" bind:value={username} required />
			</div>

			<div class="form-group">
				<label for="password">Password:</label>
				<input type="password" id="password" bind:value={password} required />
			</div>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			<button type="submit" class="btn-primary">Sign In</button>
		</form>

		<p class="note">
			Enter any username and password to sign in. This is a demo app.
		</p>
	{/if}
</div>

```

---

## src/routes/api/auth/login/+server.ts

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAmplitudeClient } from '$lib/server/amplitude';

const users = new Map<string, { username: string; burritoConsiderations: number }>();

export const POST: RequestHandler = async ({ request }) => {
	const { username, password } = await request.json();

	if (!username || !password) {
		return json({ error: 'Username and password required' }, { status: 400 });
	}

	let user = users.get(username);
	const isNewUser = !user;

	if (!user) {
		user = { username, burritoConsiderations: 0 };
		users.set(username, user);
	}

	// Capture server-side login event with user context
	const amplitude = getAmplitudeClient();
	amplitude.track('Server Login Completed', { isNewUser, source: 'api' }, { user_id: username });

	// Flush events to ensure they're sent
	await amplitude.flush();

	return json({ success: true, user });
};

```

---

## src/routes/burrito/+page.svelte

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import * as amplitude from '@amplitude/unified';
	import { getAuthContext } from '$lib/auth.svelte';

	const auth = getAuthContext();

	let hasConsidered = $state(false);

	// Redirect to home if not logged in
	$effect(() => {
		if (browser && !auth.user) {
			goto('/');
		}
	});

	function handleConsideration() {
		if (!auth.user) return;

		auth.incrementBurritoConsiderations();
		hasConsidered = true;
		setTimeout(() => (hasConsidered = false), 2000);

		// Capture burrito consideration event with Amplitude
		amplitude.track('Burrito Considered', {
			total_considerations: auth.user.burritoConsiderations,
			username: auth.user.username
		});
	}
</script>

<div class="container">
	{#if auth.user}
		<h1>Burrito consideration zone</h1>
		<p>This is where you consider the infinite potential of burritos.</p>
		<p>Current considerations: <strong>{auth.user.burritoConsiderations}</strong></p>

		<button class="btn-burrito" onclick={handleConsideration}>
			I have considered the burrito potential
		</button>

		{#if hasConsidered}
			<p class="success">
				Thank you for your consideration! Count: {auth.user.burritoConsiderations}
			</p>
		{/if}

		<div class="note">
			<p>Each consideration is tracked as an Amplitude event with custom properties.</p>
		</div>
	{:else}
		<p>Please log in to consider burritos.</p>
	{/if}
</div>

```

---

## src/routes/profile/+page.svelte

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { getAuthContext } from '$lib/auth.svelte';

	const auth = getAuthContext();

	// Redirect to home if not logged in
	$effect(() => {
		if (browser && !auth.user) {
			goto('/');
		}
	});
</script>

<div class="container">
	{#if auth.user}
		<h1>User profile</h1>

		<div class="stats">
			<h2>Your information</h2>
			<p><strong>Username:</strong> {auth.user.username}</p>
			<p><strong>Burrito considerations:</strong> {auth.user.burritoConsiderations}</p>
		</div>
	{:else}
		<p>Please log in to view your profile.</p>
	{/if}
</div>

```

---

## static/robots.txt

```txt
# allow crawling everything by default
User-agent: *
Disallow:

```

---

## svelte.config.js

```js
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		// Required for Amplitude Browser SDK (e.g. Session Replay) to work correctly with SSR
		paths: {
			relative: false
		}
	}
};

export default config;

```

---

## vite.config.ts

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()]
});

```

---

