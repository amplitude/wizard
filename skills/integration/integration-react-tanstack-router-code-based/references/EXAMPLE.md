# Amplitude React with TanStack Router (code-based) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/react-tanstack-router-code-based

---

## README.md

# Amplitude TanStack Router Example (Code-Based Routing)

This is a React and [TanStack Router](https://tanstack.com/router) example demonstrating Amplitude integration with product analytics and event tracking. This example uses **code-based routing** where routes are defined programmatically.

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
import * as amplitude from '@amplitude/analytics-browser';

amplitude.init(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY);
```

### User identification (contexts/AuthContext.tsx)

```typescript
import * as amplitude from '@amplitude/analytics-browser';
import { Identify } from '@amplitude/analytics-browser';

amplitude.setUserId(username);
const identifyObj = new Identify();
identifyObj.set('username', username);
amplitude.identify(identifyObj);
amplitude.track('user_logged_in', { username });
```

### Event tracking

```typescript
amplitude.track('burrito_considered', {
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
      content="React TanStack Router code-based routing example"
    />
    <link rel="apple-touch-icon" href="/logo192.png" />
    <link rel="manifest" href="/manifest.json" />
    <title>React TanStack Router - Code-Based</title>
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

## src/contexts/AuthContext.tsx

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';
import * as amplitude from '@amplitude/analytics-browser';
import { Identify } from '@amplitude/analytics-browser';

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

  const login = async (username: string, password: string): Promise<boolean> => {
    if (!username || !password) {
      return false;
    }

    // Get or create user in local map
    let user = users.get(username);
    const isNewUser = !user;

    if (!user) {
      user = { username, burritoConsiderations: 0 };
      users.set(username, user);
    }

    setUser(user);
    localStorage.setItem('currentUser', username);

    // Identify user in Amplitude using username as user ID
    amplitude.setUserId(username);
    const identifyObj = new Identify();
    identifyObj.set('username', username);
    amplitude.identify(identifyObj);

    // Capture login event
    amplitude.track('user_logged_in', {
      username,
      isNewUser,
    });

    return true;
  };

  const logout = () => {
    // Capture logout event before resetting
    amplitude.track('user_logged_out');
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
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import * as amplitude from '@amplitude/analytics-browser'

import { AuthProvider, useAuth } from './contexts/AuthContext'
import './styles.css'
import reportWebVitals from './reportWebVitals'

// Initialize Amplitude
amplitude.init(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)

// ============================================================================
// Root Route
// ============================================================================

const rootRoute = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
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
  )
}

// ============================================================================
// Header Component
// ============================================================================

function Header() {
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

// ============================================================================
// Index Route (Home Page)
// ============================================================================

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
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

// ============================================================================
// Burrito Route
// ============================================================================

const burritoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/burrito',
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
    amplitude.track('burrito_considered', {
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

// ============================================================================
// Profile Route
// ============================================================================

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
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
          <p>
            You haven't considered any burritos yet. Visit the Burrito
            Consideration page to start!
          </p>
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

// ============================================================================
// Route Tree & Router Setup
// ============================================================================

const routeTree = rootRoute.addChildren([indexRoute, burritoRoute, profileRoute])

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

// ============================================================================
// Render the App
// ============================================================================

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

## vite.config.ts

```ts
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [viteReact(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

```

---

