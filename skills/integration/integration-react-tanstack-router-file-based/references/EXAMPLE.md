# Amplitude React with TanStack Router (file-based) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/react-tanstack-router-file-based

---

## README.md

# Amplitude TanStack Router Example (File-Based Routing)

This is a React and [TanStack Router](https://tanstack.com/router) example demonstrating Amplitude integration with product analytics and event tracking. This example uses **file-based routing** where routes are auto-generated from the file system.

### Amplitude SDKs

The client uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) with `initAll` once in `main.tsx`. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) documents that call as initializing every product bundled with Unified npm; see [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration). The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the [CDN unified script](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-script-cdn), not Unified **npm**.

When you add a backend or API, send events with [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node).

## Features

- **Product Analytics**: Track user events and behaviors
- **User Authentication**: Demo login system with Amplitude user identification
- **Client-side Tracking**: Examples of client-side tracking methods

## Getting Started

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
VITE_PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

## Key Integration Points

### Client-side initialization (main.tsx)

```typescript
import * as amplitude from '@amplitude/unified';

void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY);
```

### User identification (contexts/AuthContext.tsx)

```typescript
import * as amplitude from '@amplitude/unified';
import { Identify } from '@amplitude/unified';

amplitude.setUserId(username);
const identifyObj = new Identify();
identifyObj.set('username', username);
amplitude.identify(identifyObj);
amplitude.track('User Logged In', { username });
```

### Event tracking (routes/burrito.tsx)

```typescript
amplitude.track('Burrito Considered', {
  total_considerations: user.burritoConsiderations + 1,
  username: user.username,
});
```

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [TanStack Router Documentation](https://tanstack.com/router/latest)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)

---

## .env.example

```example
VITE_PUBLIC_AMPLITUDE_API_KEY=

```

---

## .prettierignore

```
package-lock.json
pnpm-lock.yaml
yarn.lock
```

---

## index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="/favicon.ico" />
    <meta name="theme-color" content="#000000" />
    <meta
      name="description"
      content="Web site created using create-tsrouter-app"
    />
    <link rel="apple-touch-icon" href="/logo192.png" />
    <link rel="manifest" href="/manifest.json" />
    <title>Create TanStack App - react-tanstack</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```

---

## prettier.config.js

```js
//  @ts-check

/** @type {import('prettier').Config} */
const config = {
  semi: false,
  singleQuote: true,
  trailingComma: "all",
};

export default config;

```

---

## public/robots.txt

```txt
# https://www.robotstxt.org/robotstxt.html
User-agent: *
Disallow:

```

---

## src/components/Header.tsx

```tsx
import { Link } from '@tanstack/react-router'
import { useAuth } from '../contexts/AuthContext'

export default function Header() {
  const { user, logout } = useAuth()

  return (
    <header className="header">
      <div className="header-container">
        <nav>
          <Link to="/">Home</Link>
          {user && (
            <>
              <Link to="/burrito">Burrito Consideration</Link>
              <Link to="/profile">Profile</Link>
            </>
          )}
        </nav>
        <div className="user-section">
          {user ? (
            <>
              <span>Welcome, {user.username}!</span>
              <button onClick={logout} className="btn-logout">
                Logout
              </button>
            </>
          ) : (
            <span>Not logged in</span>
          )}
        </div>
      </div>
    </header>
  )
}

```

---

## src/contexts/AuthContext.tsx

```tsx
import * as amplitude from '@amplitude/unified';
import { Identify } from '@amplitude/unified';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface User {
  username: string;
  burritoConsiderations: number;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  incrementBurritoConsiderations: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const users: Map<string, User> = new Map();

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use lazy initializer to read from localStorage only once on mount
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null;

    const storedUsername = localStorage.getItem('currentUser');
    if (storedUsername) {
      const existingUser = users.get(storedUsername);
      if (existingUser) {
        return existingUser;
      }
    }
    return null;
  });

  const login = (username: string, password: string): Promise<boolean> => {
    if (!username || !password) {
      return Promise.resolve(false);
    }

    // Get or create user in local map
    let localUser = users.get(username);
    const isNewUser = !localUser;

    if (!localUser) {
      localUser = { username, burritoConsiderations: 0 };
      users.set(username, localUser);
    }

    setUser(localUser);
    localStorage.setItem('currentUser', username);

    // Identify user in Amplitude using username as user ID
    amplitude.setUserId(username);
    const identifyObj = new Identify();
    identifyObj.set('username', username);
    amplitude.identify(identifyObj);

    // Capture login event
    amplitude.track('User Logged In', {
      username,
      isNewUser,
    });

    return Promise.resolve(true);
  };

  const logout = () => {
    // Capture logout event before resetting
    amplitude.track('User Logged Out');
    amplitude.reset();

    setUser(null);
    localStorage.removeItem('currentUser');
  };

  const incrementBurritoConsiderations = () => {
    if (user) {
      user.burritoConsiderations++;
      users.set(user.username, user);
      setUser({ ...user });
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, incrementBurritoConsiderations }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

```

---

## src/main.tsx

```tsx
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import * as amplitude from '@amplitude/unified'

// Import the generated route tree
import { routeTree } from './routeTree.gen.ts'

import './styles.css'
import reportWebVitals from './reportWebVitals.ts'

// Initialize Amplitude
void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()

```

---

## src/reportWebVitals.ts

```ts
const reportWebVitals = (onPerfEntry?: () => void) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
      onCLS(onPerfEntry)
      onINP(onPerfEntry)
      onFCP(onPerfEntry)
      onLCP(onPerfEntry)
      onTTFB(onPerfEntry)
    })
  }
}

export default reportWebVitals

```

---

## src/routes/__root.tsx

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import Header from '../components/Header'
import { AuthProvider } from '../contexts/AuthContext'

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <Header />
      <main>
        <Outlet />
      </main>
      <TanStackDevtools
        config={{
          position: 'bottom-right',
        }}
        plugins={[
          {
            name: 'Tanstack Router',
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </AuthProvider>
  ),
})

```

---

## src/routes/burrito.tsx

```tsx
import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as amplitude from '@amplitude/unified'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/burrito')({
  component: BurritoPage,
})

function BurritoPage() {
  const { user, incrementBurritoConsiderations } = useAuth()
  const navigate = useNavigate()
  const [hasConsidered, setHasConsidered] = useState(false)

  // Redirect to home if not logged in
  if (!user) {
    navigate({ to: '/' })
    return null
  }

  const handleConsideration = () => {
    incrementBurritoConsiderations()
    setHasConsidered(true)
    setTimeout(() => setHasConsidered(false), 2000)

    // Capture burrito consideration event
    amplitude.track('Burrito Considered', {
      total_considerations: user.burritoConsiderations + 1,
      username: user.username,
    })
  }

  return (
    <div className="container">
      <h1>Burrito consideration zone</h1>
      <p>Take a moment to truly consider the potential of burritos.</p>

      <div style={{ textAlign: 'center' }}>
        <button onClick={handleConsideration} className="btn-burrito">
          I have considered the burrito potential
        </button>

        {hasConsidered && (
          <p className="success">
            Thank you for your consideration! Count: {user.burritoConsiderations}
          </p>
        )}
      </div>

      <div className="stats">
        <h3>Consideration stats</h3>
        <p>Total considerations: {user.burritoConsiderations}</p>
      </div>
    </div>
  )
}

```

---

## src/routes/index.tsx

```tsx
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const success = await login(username, password)
      if (success) {
        setUsername('')
        setPassword('')
      } else {
        setError('Please provide both username and password')
      }
    } catch (err) {
      console.error('Login failed:', err)
      setError('An error occurred during login')
    }
  }

  if (user) {
    return (
      <div className="container">
        <h1>Welcome back, {user.username}!</h1>
        <p>You are now logged in. Feel free to explore:</p>
        <ul>
          <li>Consider the potential of burritos</li>
          <li>View your profile and statistics</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="container">
      <h1>Welcome to Burrito Consideration App</h1>
      <p>Please sign in to begin your burrito journey</p>

      <form onSubmit={handleSubmit} className="form">
        <div className="form-group">
          <label htmlFor="username">Username:</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter any username"
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password:</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter any password"
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn-primary">
          Sign In
        </button>
      </form>

      <p className="note">
        Note: This is a demo app. Use any username and password to sign in.
      </p>
    </div>
  )
}

```

---

## src/routes/profile.tsx

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Redirect to home if not logged in
  if (!user) {
    navigate({ to: '/' })
    return null
  }

  return (
    <div className="container">
      <h1>User Profile</h1>

      <div className="stats">
        <h2>Your Information</h2>
        <p>
          <strong>Username:</strong> {user.username}
        </p>
        <p>
          <strong>Burrito Considerations:</strong> {user.burritoConsiderations}
        </p>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3>Your Burrito Journey</h3>
        {user.burritoConsiderations === 0 ? (
          <p>You haven't considered any burritos yet. Visit the Burrito Consideration page to start!</p>
        ) : user.burritoConsiderations === 1 ? (
          <p>You've considered the burrito potential once. Keep going!</p>
        ) : user.burritoConsiderations < 5 ? (
          <p>You're getting the hang of burrito consideration!</p>
        ) : user.burritoConsiderations < 10 ? (
          <p>You're becoming a burrito consideration expert!</p>
        ) : (
          <p>You are a true burrito consideration master!</p>
        )}
      </div>
    </div>
  )
}

```

---

## src/routeTree.gen.ts

```ts
/* eslint-disable */

// @ts-nocheck

// noinspection JSUnusedGlobalSymbols

// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter to prevent it from being checked or modified.

import { Route as rootRouteImport } from './routes/__root'
import { Route as ProfileRouteImport } from './routes/profile'
import { Route as BurritoRouteImport } from './routes/burrito'
import { Route as IndexRouteImport } from './routes/index'

const ProfileRoute = ProfileRouteImport.update({
  id: '/profile',
  path: '/profile',
  getParentRoute: () => rootRouteImport,
} as any)
const BurritoRoute = BurritoRouteImport.update({
  id: '/burrito',
  path: '/burrito',
  getParentRoute: () => rootRouteImport,
} as any)
const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/burrito': typeof BurritoRoute
  '/profile': typeof ProfileRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/burrito': typeof BurritoRoute
  '/profile': typeof ProfileRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/burrito': typeof BurritoRoute
  '/profile': typeof ProfileRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/burrito' | '/profile'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/burrito' | '/profile'
  id: '__root__' | '/' | '/burrito' | '/profile'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  BurritoRoute: typeof BurritoRoute
  ProfileRoute: typeof ProfileRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/profile': {
      id: '/profile'
      path: '/profile'
      fullPath: '/profile'
      preLoaderRoute: typeof ProfileRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/burrito': {
      id: '/burrito'
      path: '/burrito'
      fullPath: '/burrito'
      preLoaderRoute: typeof BurritoRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  BurritoRoute: BurritoRoute,
  ProfileRoute: ProfileRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()

```

---

## vite.config.ts

```ts
import { URL, fileURLToPath } from 'node:url'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

```

---

