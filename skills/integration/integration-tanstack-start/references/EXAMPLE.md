# Amplitude TanStack Start Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/tanstack-start

---

## README.md

# Amplitude TanStack Start example

This is a [TanStack Start](https://tanstack.com/start) example demonstrating Amplitude integration with product analytics and event tracking.

## Features

- **Product analytics**: Track user events and behaviors
- **User authentication**: Demo login system with Amplitude user identification
- **Client and server tracking**: Examples of both client-side and server-side tracking

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

### Client-side initialization (src/routes/__root.tsx)

```typescript
import * as amplitude from '@amplitude/analytics-browser'

amplitude.init(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)
```

### User identification (src/contexts/AuthContext.tsx)

```typescript
import * as amplitude from '@amplitude/analytics-browser'
import { Identify } from '@amplitude/analytics-browser'

amplitude.setUserId(username)
const identifyObj = new Identify()
identifyObj.set('username', username)
amplitude.identify(identifyObj)
amplitude.track('user_logged_in', { username })
```

### Server-side tracking (src/utils/amplitude-server.ts)

```typescript
import { NodeClient, createInstance } from '@amplitude/analytics-node'

const amplitude = getAmplitudeClient()
amplitude.track('server_login', { username, source: 'api' }, { user_id: username })
await amplitude.flush()
```

### Event tracking (src/routes/burrito.tsx)

```typescript
amplitude.track('burrito_considered', {
  total_considerations: user.burritoConsiderations + 1,
  username: user.username,
})
```

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [TanStack Start Documentation](https://tanstack.com/start/latest)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)

---

## .env.example

```example
VITE_PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## .prettierignore

```
package-lock.json
pnpm-lock.yaml
yarn.lock
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
import {
  createContext,
  useContext,
  useState,
  ReactNode,
} from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { Identify } from '@amplitude/analytics-browser'

interface User {
  username: string
  burritoConsiderations: number
}

interface AuthContextType {
  user: User | null
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  incrementBurritoConsiderations: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const users: Map<string, User> = new Map()

export function AuthProvider({ children }: { children: ReactNode }) {
  // Use lazy initializer to read from localStorage only once on mount
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window === 'undefined') return null

    const storedUsername = localStorage.getItem('currentUser')
    if (storedUsername) {
      const existingUser = users.get(storedUsername)
      if (existingUser) {
        return existingUser
      }
    }
    return null
  })

  const login = async (
    username: string,
    password: string,
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      if (response.ok) {
        const { user: userData } = await response.json()

        // Get or create user in local map
        let localUser = users.get(username)
        if (!localUser) {
          localUser = userData as User
          users.set(username, localUser)
        }

        setUser(localUser)
        if (typeof window !== 'undefined') {
          localStorage.setItem('currentUser', username)
        }

        // Identify user in Amplitude using username as user ID
        amplitude.setUserId(username)
        const identifyObj = new Identify()
        identifyObj.set('username', username)
        amplitude.identify(identifyObj)

        // Track login event
        amplitude.track('user_logged_in', { username })

        return true
      }
      return false
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }

  const logout = () => {
    // Track logout event before resetting
    amplitude.track('user_logged_out')
    amplitude.reset()

    setUser(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('currentUser')
    }
  }

  const incrementBurritoConsiderations = () => {
    if (user) {
      user.burritoConsiderations++
      users.set(user.username, user)
      setUser({ ...user })
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, login, logout, incrementBurritoConsiderations }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

```

---

## src/router.tsx

```tsx
import { createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

// Create a new router instance
export const getRouter = () => {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })
}

```

---

## src/routes/__root.tsx

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import * as amplitude from '@amplitude/analytics-browser'

import Header from '../components/Header'
import { AuthProvider } from '../contexts/AuthContext'

import appCss from '../styles.css?url'

if (typeof window !== 'undefined') {
  amplitude.init(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          <Header />
          {children}
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
        <Scripts />
      </body>
    </html>
  )
}

```

---

## src/routes/api/auth/login.ts

```ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAmplitudeClient } from '../../../utils/amplitude-server'

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        const { username, password } = body

        // Simple validation (in production, you'd verify against a real database)
        if (!username || !password) {
          return json(
            { error: 'Username and password required' },
            { status: 400 },
          )
        }

        // Check if this is a new user (simplified - in production use a database)
        const isNewUser = !username

        // Create or get user
        const user = {
          username,
          burritoConsiderations: 0,
        }

        // Capture server-side login event
        const amplitude = getAmplitudeClient()
        amplitude.track('server_login', {
          username,
          isNewUser,
          source: 'api',
        }, { user_id: username })

        await amplitude.flush()

        return json({ success: true, user })
      },
    },
  },
})

```

---

## src/routes/api/burrito/consider.ts

```ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAmplitudeClient } from '../../../utils/amplitude-server'

export const Route = createFileRoute('/api/burrito/consider')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json()
        const { username, totalConsiderations } = body

        if (!username) {
          return json(
            { error: 'Username is required' },
            { status: 400 },
          )
        }

        const amplitude = getAmplitudeClient()
        amplitude.track('burrito_considered', {
          total_considerations: totalConsiderations,
          username,
          source: 'api',
        }, { user_id: username })

        await amplitude.flush()

        return json({ success: true })
      },
    },
  },
})

```

---

## src/routes/burrito.tsx

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import * as amplitude from '@amplitude/analytics-browser'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/burrito')({
  component: BurritoPage,
  head: () => ({
    meta: [
      {
        title: 'Burrito Consideration - Burrito Consideration App',
      },
      {
        name: 'description',
        content: 'Consider the potential of burritos',
      },
    ],
  }),
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

  const handleClientConsideration = () => {
    incrementBurritoConsiderations()
    setHasConsidered(true)
    setTimeout(() => setHasConsidered(false), 2000)

    amplitude.track('burrito_considered', {
      total_considerations: user.burritoConsiderations + 1,
      username: user.username,
    })
  }

  const handleServerConsideration = async () => {
    incrementBurritoConsiderations()
    setHasConsidered(true)
    setTimeout(() => setHasConsidered(false), 2000)

    await fetch('/api/burrito/consider', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: user.username,
        totalConsiderations: user.burritoConsiderations + 1,
      }),
    })
  }

  return (
    <main>
      <div className="container">
        <h1>Burrito consideration zone</h1>
        <p>Take a moment to truly consider the potential of burritos.</p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.125rem' }}>
          <button
            onClick={handleClientConsideration}
            className="btn-burrito"
            style={{ backgroundColor: '#e07c24', color: '#fff' }}
          >
            Consider burrito (client)
          </button>
          <button
            onClick={handleServerConsideration}
            className="btn-burrito"
            style={{ backgroundColor: '#4a90d9', color: '#fff' }}
          >
            Consider burrito (server)
          </button>

          {hasConsidered && (
            <p className="success">
              Thank you for your consideration! Count:{' '}
              {user.burritoConsiderations}
            </p>
          )}
        </div>

        <div className="stats">
          <h3>Consideration stats</h3>
          <p>Total considerations: {user.burritoConsiderations}</p>
        </div>
      </div>
    </main>
  )
}

```

---

## src/routes/index.tsx

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      {
        title: 'Burrito Consideration App',
      },
      {
        name: 'description',
        content: 'Consider the potential of burritos',
      },
    ],
  }),
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

  return (
    <main>
      {user ? (
        <div className="container">
          <h1>Welcome back, {user.username}!</h1>
          <p>You are now logged in. Feel free to explore:</p>
          <ul>
            <li>Consider the potential of burritos</li>
            <li>View your profile and statistics</li>
          </ul>
        </div>
      ) : (
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
      )}
    </main>
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
  head: () => ({
    meta: [
      {
        title: 'Profile - Burrito Consideration App',
      },
      {
        name: 'description',
        content: 'Your burrito consideration profile',
      },
    ],
  }),
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
    <main>
      <div className="container">
        <h1>User Profile</h1>

        <div className="stats">
          <h2>Your Information</h2>
          <p>
            <strong>Username:</strong> {user.username}
          </p>
          <p>
            <strong>Burrito Considerations:</strong>{' '}
            {user.burritoConsiderations}
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
    </main>
  )
}

```

---

## src/utils/amplitude-server.ts

```ts
import { NodeClient, createInstance } from '@amplitude/analytics-node'

let amplitudeClient: NodeClient | null = null

export function getAmplitudeClient(): NodeClient {
  if (!amplitudeClient) {
    const apiKey = process.env.VITE_PUBLIC_AMPLITUDE_API_KEY || import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY!
    amplitudeClient = createInstance()
    amplitudeClient.init(apiKey)
  }
  return amplitudeClient
}

```

---

## vite.config.ts

```ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'

const config = defineConfig({
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ],
})

export default config

```

---

