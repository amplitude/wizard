# Amplitude Nuxt 3.6 Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/nuxt-3.6

---

## README.md

# Amplitude Nuxt 3.6 Example

This is a [Nuxt 3.6](https://nuxt.com) example demonstrating Amplitude integration with product analytics and event tracking.

Nuxt 3.0 - 3.6 **does not** support the `@amplitude/nuxt` package. You must use the `@amplitude/analytics-browser` and `@amplitude/analytics-node` packages directly instead.

## Features

- **Product Analytics**: Track user events and behaviors
- **User Authentication**: Demo login system with Amplitude user identification
- **Server-side & Client-side Tracking**: Examples of both tracking methods
- **SSR Support**: Server-side rendering with Nuxt 3.6

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
NUXT_PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Run the Development Server

```bash
npm run dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

## Project Structure

```
├── assets/
│   └── css/
│       └── main.css          # Global styles
├── components/
│   └── Header.vue            # Navigation header with auth state
├── composables/
│   └── useAuth.ts            # Authentication composable
├── pages/
│   ├── index.vue             # Home/Login page
│   ├── burrito.vue           # Demo feature page with event tracking
│   └── profile.vue           # User profile page
├── plugins/
│   └── amplitude.client.ts   # Client-side Amplitude plugin
├── server/
│   ├── api/
│   │   ├── auth/
│   │   │   └── login.post.ts # Login API with server-side tracking
│   │   └── burrito/
│   │       └── consider.post.ts # Burrito API with server-side tracking
│   └── utils/
│       └── users.ts          # In-memory user storage utilities
├── types/
│   └── nuxt-app.d.ts          # TypeScript declarations for Amplitude
├── app.vue                    # Root component
└── nuxt.config.ts             # Nuxt configuration
```

## Key Integration Points

### Client-side initialization (plugins/amplitude.client.ts)

```typescript
import * as amplitude from '@amplitude/analytics-browser'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    amplitude.init(apiKey)
  }

  return {
    provide: {
      amplitude,
    },
  }
})
```

### User identification (pages/index.vue)

```typescript
import { Identify } from '@amplitude/analytics-browser'

const { $amplitude: amplitude } = useNuxtApp()

const handleSubmit = async () => {
  const success = await auth.login(username.value, password.value)
  if (success) {
    amplitude.setUserId(username.value)
    const identifyObj = new Identify()
    identifyObj.set('username', username.value)
    amplitude.identify(identifyObj)

    amplitude.track('user_logged_in', { username: username.value })
  }
}
```

### Event tracking (pages/burrito.vue)

```typescript
const { $amplitude: amplitude } = useNuxtApp()

amplitude.track('burrito_considered', {
  total_considerations: response.user.burritoConsiderations,
  username: response.user.username,
})
```

### Server-side tracking (server/api/auth/login.post.ts)

```typescript
import { NodeClient, createInstance } from '@amplitude/analytics-node'

const amplitudeClient: NodeClient = createInstance()
amplitudeClient.init(apiKey)
amplitudeClient.track('server_login', { username }, { user_id: username })
await amplitudeClient.flush()
```

### Accessing Amplitude in components

Amplitude is accessed via `useNuxtApp()`:

```typescript
const { $amplitude: amplitude } = useNuxtApp()
amplitude.track('event_name', { property: 'value' })
```

TypeScript types are provided via `types/nuxt-app.d.ts`:

```typescript
import type * as amplitude from '@amplitude/analytics-browser'

declare module '#app' {
  interface NuxtApp {
    $amplitude: typeof amplitude
  }
}
```

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [Nuxt 3 Documentation](https://nuxt.com/docs)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)

---

## .env.example

```example

NUXT_PUBLIC_AMPLITUDE_API_KEY=

```

---

## app.vue

```vue
<template>
  <div>
    <NuxtRouteAnnouncer />
    <Header />
    <main>
      <NuxtPage />
    </main>
  </div>
</template>

```

---

## components/Header.vue

```vue
<template>
  <header class="header">
    <div class="header-container">
      <nav>
        <NuxtLink to="/">Home</NuxtLink>
        <template v-if="user">
          <NuxtLink to="/burrito">Burrito Consideration</NuxtLink>
          <NuxtLink to="/profile">Profile</NuxtLink>
        </template>
      </nav>
      <div class="user-section">
        <template v-if="user">
          <span>Welcome, {{ user.username }}!</span>
          <button @click="handleLogout" class="btn-logout">
            Logout
          </button>
        </template>
        <template v-else>
          <span>Not logged in</span>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
const auth = useAuth()
const user = computed(() => auth.user.value)
const { $amplitude: amplitude } = useNuxtApp()

const handleLogout = () => {
  amplitude?.track('user_logged_out')
  amplitude?.reset()
  auth.logout()
}
</script>

```

---

## composables/useAuth.ts

```ts
interface User {
  username: string
  burritoConsiderations: number
}

const users = new Map<string, User>()

export const useAuth = () => {
  const user = useState<User | null>('auth-user', () => {
    if (typeof window !== 'undefined') {
      const storedUsername = localStorage.getItem('currentUser')
      if (storedUsername) {
        const existingUser = users.get(storedUsername)
        if (existingUser) {
          return existingUser
        }
      }
    }
    return null
  })

  const login = async (username: string, password: string): Promise<boolean> => {
    if (!username || !password) {
      return false
    }

    try {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      })

      if (response.success && response.user) {
        // Update client-side state
        user.value = response.user
        users.set(username, response.user)
        
        if (typeof window !== 'undefined') {
          localStorage.setItem('currentUser', username)
        }

        return true
      }
      return false
    } catch (err) {
      console.error('Login error:', err)
      return false
    }
  }

  const logout = () => {
    user.value = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('currentUser')
    }
  }

  const setUser = (newUser: User) => {
    user.value = newUser
    users.set(newUser.username, newUser)
  }

  const incrementBurritoConsiderations = () => {
    if (user.value) {
      user.value.burritoConsiderations++
      users.set(user.value.username, user.value)
      // Trigger reactivity by creating a new object
      user.value = { ...user.value }
    }
  }

  return {
    user,
    login,
    logout,
    setUser,
    incrementBurritoConsiderations
  }
}

```

---

## nuxt.config.ts

```ts
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      amplitudeApiKey: process.env.NUXT_PUBLIC_AMPLITUDE_API_KEY,
    },
  },
})


```

---

## pages/burrito.vue

```vue
<template>
  <div class="container">
    <h1>Burrito consideration zone</h1>
    <p>Take a moment to truly consider the potential of burritos.</p>

    <div style="text-align: center">
      <button
        @click="handleConsideration"
        class="btn-burrito"
      >
        I have considered the burrito potential
      </button>

      <p v-if="hasConsidered" class="success">
        Thank you for your consideration! Count: {{ user?.burritoConsiderations }}
      </p>
    </div>

    <div class="stats">
      <h3>Consideration stats</h3>
      <p>Total considerations: {{ user?.burritoConsiderations }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const auth = useAuth()
const user = computed(() => auth.user.value)
const router = useRouter()
const hasConsidered = ref(false)
const { $amplitude: amplitude } = useNuxtApp()

// Redirect to home if not logged in
watchEffect(() => {
  if (!user.value) {
    router.push('/')
  }
})

const handleConsideration = async () => {
  if (!user.value) return

  try {
    const response = await $fetch('/api/burrito/consider', {
      method: 'POST',
      body: { username: user.value.username },
    })

    if (response.success && response.user) {
      auth.setUser(response.user)
      hasConsidered.value = true

      // Client-side tracking (in addition to server-side tracking)
      amplitude.track('burrito_considered', {
        total_considerations: response.user.burritoConsiderations,
        username: response.user.username,
      })

      setTimeout(() => {
        hasConsidered.value = false
      }, 2000)
    }
  } catch (err) {
    console.error('Error considering burrito:', err)
  }
}
</script>

```

---

## pages/index.vue

```vue
<template>
  <div class="container">
    <template v-if="user">
      <h1>Welcome back, {{ user.username }}!</h1>
      <p>You are now logged in. Feel free to explore:</p>
      <ul>
        <li>Consider the potential of burritos</li>
        <li>View your profile and statistics</li>
      </ul>
    </template>
    <template v-else>
      <h1>Welcome to Burrito Consideration App</h1>
      <p>Please sign in to begin your burrito journey</p>

      <form @submit.prevent="handleSubmit" class="form">
        <div class="form-group">
          <label for="username">Username:</label>
          <input
            type="text"
            id="username"
            v-model="username"
            placeholder="Enter any username"
          />
        </div>

        <div class="form-group">
          <label for="password">Password:</label>
          <input
            type="password"
            id="password"
            v-model="password"
            placeholder="Enter any password"
          />
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn-primary">Sign In</button>
      </form>

      <p class="note">
        Note: This is a demo app. Use any username and password to sign in.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Identify } from '@amplitude/analytics-browser'

const auth = useAuth()
const user = computed(() => auth.user.value)
const username = ref('')
const password = ref('')
const error = ref('')
const { $amplitude: amplitude } = useNuxtApp()

const handleSubmit = async () => {
  error.value = ''

  const success = await auth.login(username.value, password.value)
  if (success) {
    // Identify user in Amplitude using username as user ID
    amplitude.setUserId(username.value)
    const identifyObj = new Identify()
    identifyObj.set('username', username.value)
    amplitude.identify(identifyObj)

    // Capture login event
    amplitude.track('user_logged_in', { username: username.value })

    username.value = ''
    password.value = ''
  } else {
    error.value = 'Please provide both username and password'
  }
}
</script>

```

---

## pages/profile.vue

```vue
<template>
  <div class="container">
    <h1>User Profile</h1>

    <div class="stats">
      <h2>Your Information</h2>
      <p><strong>Username:</strong> {{ user?.username }}</p>
      <p><strong>Burrito Considerations:</strong> {{ user?.burritoConsiderations }}</p>
    </div>

    <div style="margin-top: 2rem">
      <h3>Your Burrito Journey</h3>
      <template v-if="user">
        <p v-if="user.burritoConsiderations === 0">
          You haven't considered any burritos yet. Visit the Burrito Consideration page to start!
        </p>
        <p v-else-if="user.burritoConsiderations === 1">
          You've considered the burrito potential once. Keep going!
        </p>
        <p v-else-if="user.burritoConsiderations < 5">
          You're getting the hang of burrito consideration!
        </p>
        <p v-else-if="user.burritoConsiderations < 10">
          You're becoming a burrito consideration expert!
        </p>
        <p v-else>
          You are a true burrito consideration master! 🌯
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const auth = useAuth()
const user = computed(() => auth.user.value)
const router = useRouter()

// Redirect to home if not logged in
watchEffect(() => {
  if (!user.value) {
    router.push('/')
  }
})
</script>

```

---

## plugins/amplitude.client.ts

```ts
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import * as amplitude from '@amplitude/analytics-browser'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    amplitude.init(apiKey)
  }

  return {
    provide: {
      amplitude,
    },
  }
})

```

---

## public/robots.txt

```txt
User-Agent: *
Disallow:

```

---

## server/api/auth/login.post.ts

```ts
import { getOrCreateUser } from '~/server/utils/users'
import { NodeClient, createInstance } from '@amplitude/analytics-node'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  if (event.node.req.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed'
    })
  }

  const body = await readBody(event)
  const { username, password } = body

  if (!username || !password) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username and password required'
    })
  }

  // Fake auth - just get or create user
  const user = getOrCreateUser(username)

  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    const amplitudeClient: NodeClient = createInstance()
    amplitudeClient.init(apiKey)
    amplitudeClient.track('server_login', { username }, { user_id: username })
    await amplitudeClient.flush()
  }

  return {
    success: true,
    user: { ...user }
  }
})

```

---

## server/api/burrito/consider.post.ts

```ts
import { users, incrementBurritoConsiderations } from '~/server/utils/users'
import { NodeClient, createInstance } from '@amplitude/analytics-node'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event) => {
  if (event.node.req.method !== 'POST') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed'
    })
  }

  const body = await readBody(event)
  const { username } = body

  if (!username) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Username required'
    })
  }

  if (!users.has(username)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'User not found'
    })
  }

  // Increment burrito considerations (fake, in-memory)
  const user = incrementBurritoConsiderations(username)

  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    const amplitudeClient: NodeClient = createInstance()
    amplitudeClient.init(apiKey)
    amplitudeClient.track('burrito_considered', {
      total_considerations: user.burritoConsiderations,
      username,
    }, { user_id: username })
    await amplitudeClient.flush()
  }

  return {
    success: true,
    user: { ...user }
  }
})

```

---

## server/utils/users.ts

```ts
interface User {
  username: string
  burritoConsiderations: number
}

// Shared in-memory storage for users (fake, no database)
export const users = new Map<string, User>()

export function getOrCreateUser(username: string): User {
  let user = users.get(username)
  
  if (!user) {
    user = { 
      username, 
      burritoConsiderations: 0 
    }
    users.set(username, user)
  }
  
  return user
}

export function incrementBurritoConsiderations(username: string): User {
  const user = users.get(username)
  
  if (!user) {
    throw new Error('User not found')
  }
  
  user.burritoConsiderations++
  users.set(username, user)
  
  return { ...user }
}

```

---

## types/nuxt-app.d.ts

```ts
import type * as amplitude from '@amplitude/analytics-browser'

declare module '#app' {
  interface NuxtApp {
    $amplitude: typeof amplitude
  }
}

export {}

```

---

