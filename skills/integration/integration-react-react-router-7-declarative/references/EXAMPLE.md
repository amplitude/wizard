# Amplitude React Router v7 - Declarative mode Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/react-react-router-7-declarative

---

## README.md

# Amplitude React Router 7 Declarative example

This is a [React Router 7](https://reactrouter.com) Declarative example demonstrating Amplitude integration with product analytics and event tracking.

### Amplitude SDKs

The client uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) with a single `initAll` call. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) documents that call as initializing every product bundled with Unified npm. See [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) and [Browser SDK 2](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk) for `analytics` options. The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`); Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the [Unified script (CDN)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-script-cdn), not Unified **npm**.

If you add backend events, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node).

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
│   └── Header.tsx           # Navigation header with auth state
├── contexts/
│   └── AuthContext.tsx      # Authentication context with Amplitude integration
├── routes/
│   ├── Root.tsx             # Root route component
│   ├── Home.tsx             # Home/Login page
│   ├── Burrito.tsx          # Demo feature page with event tracking
│   └── Profile.tsx          # User profile page
└── main.tsx                 # App entry point with Amplitude initialization
```

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

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [React Router 7 Documentation](https://reactrouter.com/home)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)

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
    <title>react-react-router-7-declarative</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

```

---

## src/App.tsx

```tsx
import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App

```

---

## src/components/Header.tsx

```tsx
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import * as amplitude from '@amplitude/unified';

export default function Header() {
  const { user, logout } = useAuth();

  const handleLogout = () => {
    amplitude.track('User Logged Out');
    amplitude.reset();
    logout();
  };

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
  );
}

```

---

## src/contexts/AuthContext.tsx

```tsx
import * as amplitude from '@amplitude/unified';
import { Identify } from '@amplitude/unified';
import { createContext, useContext, useState, type ReactNode } from 'react';

interface User {
  username: string;
  burritoConsiderations: number;
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const users: Map<string, User> = new Map();

export function AuthProvider({ children }: { children: ReactNode }) {
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
    // Client-side only fake auth - no server calls
    if (!username || !password) {
      return false;
    }

    let localUser = users.get(username);
    if (!localUser) {
      localUser = {
        username,
        burritoConsiderations: 0
      };
      users.set(username, localUser);
    }

    setUser(localUser);
    localStorage.setItem('currentUser', username);

    // Identify user in Amplitude using username as user ID
    amplitude.setUserId(username);
    const identifyObj = new Identify();
    identifyObj.set('username', username);
    amplitude.identify(identifyObj);
    amplitude.track('User Logged In', { username });

    return true;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
  };

  const setUserState = (newUser: User) => {
    setUser(newUser);
    users.set(newUser.username, newUser);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, setUser: setUserState }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useAuth is the companion hook for AuthProvider
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
import './globals.css'

import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import Root from './routes/Root';
import Home from './routes/Home';
import Burrito from './routes/Burrito';
import Profile from './routes/Profile';

import * as amplitude from '@amplitude/unified';

void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Root />}>
          <Route index element={<Home />} />
          <Route path="burrito" element={<Burrito />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

```

---

## src/routes/Burrito.tsx

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';

export default function BurritoPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [hasConsidered, setHasConsidered] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

  const handleConsideration = () => {
    // Client-side only - no server calls
    const updatedUser = {
      ...user,
      burritoConsiderations: user.burritoConsiderations + 1
    };
    setUser(updatedUser);
    setHasConsidered(true);
    setTimeout(() => setHasConsidered(false), 2000);
  };

  return (
    <div className="container">
      <h1>Burrito consideration zone</h1>
      <p>Take a moment to truly consider the potential of burritos.</p>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleConsideration}
          className="btn-burrito"
        >
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
  );
}


```

---

## src/routes/Home.tsx

```tsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const success = await login(username, password);
    if (success) {
      setUsername('');
      setPassword('');
    } else {
      setError('Please provide both username and password');
    }
  };

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
    );
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
  );
}


```

---

## src/routes/Profile.tsx

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

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
        ) : user.burritoConsiderations === 1 ? (
          <p>You&apos;ve considered the burrito potential once. Keep going!</p>
        ) : user.burritoConsiderations < 5 ? (
          <p>You&apos;re getting the hang of burrito consideration!</p>
        ) : user.burritoConsiderations < 10 ? (
          <p>You&apos;re becoming a burrito consideration expert!</p>
        ) : (
          <p>You are a true burrito consideration master! 🌯</p>
        )}
      </div>
    </div>
  );
}


```

---

## src/routes/Root.tsx

```tsx
import { Outlet } from "react-router";
import Header from "../components/Header";
import { AuthProvider } from "../contexts/AuthContext";

export default function Root() {
  return (
    <AuthProvider>
      <Header />
      <main>
        <Outlet />
      </main>
    </AuthProvider>
  );
}
```

---

## src/vite-env.d.ts

```ts
/// <reference types="vite/client" />


```

---

## vite.config.ts

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})

```

---

