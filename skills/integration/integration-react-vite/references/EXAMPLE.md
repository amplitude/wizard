# Amplitude React (Vite) Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/react-vite

---

## README.md

# Amplitude React + Vite example

A minimal [React](https://react.dev) application built with [Vite](https://vite.dev), demonstrating Amplitude integration with product analytics and event tracking.

This example uses no client-side router, so it is a minimal React setup.

The client uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) with `initAll` once in `main.jsx`. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) documents that call as initializing every product bundled with Unified npm. Optional tuning is in [Unified SDK configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration); `analytics` options match [Browser SDK 2](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk). The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the Unified **CDN** script, not Unified **npm**.

For server-side events, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node).

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
# or
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the app.

## Project Structure

```
src/
├── components/
│   └── Header.jsx           # Navigation header with auth state
├── contexts/
│   └── AuthContext.jsx       # Authentication context
├── pages/
│   ├── Home.jsx              # Home/Login page with event tracking
│   ├── Burrito.jsx           # Demo page with event tracking
│   └── Profile.jsx           # User profile page
├── main.jsx                  # Entry point with Amplitude initialization
├── App.jsx                   # App component with page routing
└── globals.css               # Global styles
```

## Key Integration Points

### Initialization (main.jsx)

```javascript
import * as amplitude from '@amplitude/unified'

void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)
```

### User identification (Home.jsx)

```javascript
import * as amplitude from '@amplitude/unified'
import { Identify } from '@amplitude/unified'

amplitude.setUserId(username)
const identifyObj = new Identify()
identifyObj.set('username', username)
amplitude.identify(identifyObj)
amplitude.track('User Logged In', { username })
```

### Event tracking (Burrito.jsx)

```javascript
amplitude.track('Burrito Considered', {
  total_considerations: updatedUser.burritoConsiderations,
  username: user.username,
})
```

### Pageview tracking (Header.jsx)

Without a router, manually track page views on navigation:

```javascript
amplitude.track('Page Viewed', { page: target })
```

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)
- [Vite Documentation](https://vite.dev)

---

## .env.example

```example
VITE_PUBLIC_AMPLITUDE_API_KEY=

```

---

## index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>react-vite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>

```

---

## src/App.jsx

```jsx
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Home from './pages/Home'
import Burrito from './pages/Burrito'
import Profile from './pages/Profile'
import Header from './components/Header'

function AppContent() {
  const { user } = useAuth()

  if (!user) {
    return <Home />
  }

  return <MainApp />
}

function MainApp() {
  const { page } = useAuth()

  return (
    <>
      {page === 'home' && <Home />}
      {page === 'burrito' && <Burrito />}
      {page === 'profile' && <Profile />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Header />
      <main>
        <AppContent />
      </main>
    </AuthProvider>
  )
}

```

---

## src/components/Header.jsx

```jsx
import { useAuth } from '../contexts/AuthContext'
import * as amplitude from '@amplitude/unified'

export default function Header() {
  const { user, logout, page, setPage } = useAuth()

  const handleLogout = () => {
    logout()
  }

  const navigate = (target) => {
    setPage(target)
    amplitude.track('Page Viewed', { page: target })
  }

  return (
    <header className="header">
      <div className="header-container">
        <nav>
          <button onClick={() => navigate('home')} className={page === 'home' ? 'active' : ''}>
            Home
          </button>
          {user && (
            <>
              <button onClick={() => navigate('burrito')} className={page === 'burrito' ? 'active' : ''}>
                Burrito Consideration
              </button>
              <button onClick={() => navigate('profile')} className={page === 'profile' ? 'active' : ''}>
                Profile
              </button>
            </>
          )}
        </nav>
        <div className="user-section">
          {user ? (
            <>
              <span>Welcome, {user.username}!</span>
              <button onClick={handleLogout} className="btn-logout">
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

## src/contexts/AuthContext.jsx

```jsx
import { createContext, useContext, useState } from 'react'
import * as amplitude from '@amplitude/analytics-browser'

const AuthContext = createContext(undefined)

const users = new Map()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    if (typeof window === 'undefined') return null
    const storedUsername = localStorage.getItem('currentUser')
    if (storedUsername) {
      return users.get(storedUsername) || null
    }
    return null
  })
  const [page, setPage] = useState('home')

  const login = async (username, password) => {
    if (!username || !password) return false

    let localUser = users.get(username)
    if (!localUser) {
      localUser = { username, burritoConsiderations: 0 }
      users.set(username, localUser)
    }

    setUser(localUser)
    localStorage.setItem('currentUser', username)
    return true
  }

  const logout = () => {
    amplitude.track('User Logged Out')
    amplitude.reset()
    setUser(null)
    setPage('home')
    localStorage.removeItem('currentUser')
  }

  const setUserState = (newUser) => {
    setUser(newUser)
    users.set(newUser.username, newUser)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, setUser: setUserState, page, setPage }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- useAuth is the companion hook for AuthProvider
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

```

---

## src/main.jsx

```jsx
import './globals.css'

import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import * as amplitude from '@amplitude/unified'

void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY)

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

ReactDOM.createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

```

---

## src/pages/Burrito.jsx

```jsx
import { useAuth } from '../contexts/AuthContext'
import * as amplitude from '@amplitude/unified'

export default function Burrito() {
  const { user, setUser } = useAuth()

  if (!user) return null

  const handleConsider = () => {
    const updatedUser = {
      ...user,
      burritoConsiderations: user.burritoConsiderations + 1,
    }
    setUser(updatedUser)

    amplitude.track('Burrito Considered', {
      total_considerations: updatedUser.burritoConsiderations,
      username: user.username,
    })
  }

  return (
    <div className="container">
      <h1>Burrito Consideration Zone</h1>

      <div className="burrito-stats">
        <p>Times considered: <strong>{user.burritoConsiderations}</strong></p>
        <button onClick={handleConsider} className="btn-burrito">
          Consider a Burrito
        </button>
      </div>

      <div className="burrito-info">
        <h2>Why Consider Burritos?</h2>
        <ul>
          <li>They are delicious</li>
          <li>They are portable</li>
          <li>They contain multiple food groups</li>
          <li>They bring joy</li>
        </ul>
      </div>
    </div>
  )
}

```

---

## src/pages/Home.jsx

```jsx
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import * as amplitude from '@amplitude/unified'
import { Identify } from '@amplitude/unified'

export default function Home() {
  const { user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const success = await login(username, password)
    if (success) {
      amplitude.setUserId(username)
      const identifyObj = new Identify()
      identifyObj.set('username', username)
      amplitude.identify(identifyObj)
      amplitude.track('User Logged In', { username })
      setUsername('')
      setPassword('')
    } else {
      setError('Please provide both username and password')
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

        <button type="submit" className="btn-primary">Sign In</button>
      </form>

      <p className="note">
        Note: This is a demo app. Use any username and password to sign in.
      </p>
    </div>
  )
}

```

---

## src/pages/Profile.jsx

```jsx
import { useAuth } from '../contexts/AuthContext'

export default function Profile() {
  const { user } = useAuth()

  if (!user) return null

  return (
    <div className="container">
      <h1>User Profile</h1>

      <div className="stats">
        <h2>Your Information</h2>
        <p><strong>Username:</strong> {user.username}</p>
        <p><strong>Burrito Considerations:</strong> {user.burritoConsiderations}</p>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3>Your Burrito Journey</h3>
        {user.burritoConsiderations === 0 ? (
          <p>You haven&apos;t considered any burritos yet. Visit the Burrito Consideration page to start!</p>
        ) : user.burritoConsiderations < 5 ? (
          <p>You&apos;re getting the hang of burrito consideration!</p>
        ) : user.burritoConsiderations < 10 ? (
          <p>You&apos;re becoming a burrito consideration expert!</p>
        ) : (
          <p>You are a true burrito consideration master!</p>
        )}
      </div>
    </div>
  )
}

```

---

## vite.config.js

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})

```

---

