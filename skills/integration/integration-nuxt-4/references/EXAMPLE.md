# Amplitude Nuxt 4 Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/nuxt-4

---

## README.md

# Amplitude Nuxt 4 Example

This is a [Nuxt 4](https://nuxt.com) example demonstrating Amplitude integration with product analytics and event tracking.

For Nuxt 3.0 - 3.6, see the [Nuxt 3.6 example](../../integration-nuxt-3.6/) for an alternative approach.

### Amplitude SDKs

In the browser, this app uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) with `initAll` in [app/plugins/amplitude.client.ts](app/plugins/amplitude.client.ts). [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) describes `initAll` as initializing every product bundled into Unified npm; see [Unified SDK configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) for optional `serverZone`, `instanceName`, and the `analytics`, `sessionReplay`, `experiment`, and `engagement` blocks. Analytics options follow [Browser SDK 2](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk).

The `experiment` block configures **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the Unified **CDN** script, not the Unified **npm** package.

For Nitro routes and other server code, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node).

## Features

- **Product Analytics**: Track user events and behaviors
- **User Authentication**: Demo login system with Amplitude user identification
- **Server-side & Client-side Tracking**: Examples of both tracking methods
- **SSR Support**: Server-side rendering with Nuxt 4

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
├── app/
│   ├── components/
│   │   └── AppHeader.vue        # Navigation header with auth state
│   ├── composables/
│   │   ├── useAuth.ts           # Authentication composable
│   │   └── useAmplitude.ts      # Amplitude composable
│   ├── middleware/
│   │   └── auth.ts              # Authentication middleware
│   ├── pages/
│   │   ├── index.vue            # Home/Login page
│   │   ├── burrito.vue          # Demo feature page with event tracking
│   │   └── profile.vue          # User profile page
│   ├── plugins/
│   │   └── amplitude.client.ts  # Client-side Amplitude plugin
│   ├── utils/
│   │   └── formValidation.ts    # Form validation utilities
│   └── app.vue                  # Root component
├── assets/
│   └── css/
│       └── main.css              # Global styles
├── server/
│   ├── api/
│   │   ├── auth/
│   │   │   └── login.post.ts     # Login API with server-side tracking
│   │   └── burrito/
│   │       └── consider.post.ts  # Burrito consideration API with server-side tracking
│   └── utils/
│       ├── amplitude.ts          # Server-side Amplitude utility
│       └── users.ts              # In-memory user storage utilities
├── nuxt.config.ts               # Nuxt configuration
└── package.json
```

## Key Integration Points

### Client-side initialization (app/plugins/amplitude.client.ts)

```typescript
import * as amplitude from '@amplitude/unified'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    void amplitude.initAll(apiKey)
  }

  return {
    provide: {
      amplitude,
    },
  }
})
```

### Amplitude composable (app/composables/useAmplitude.ts)

```typescript
import * as amplitude from '@amplitude/unified'

export function useAmplitude() {
  if (process.client) {
    return amplitude
  }
  return null
}
```

### User identification (app/pages/index.vue)

```typescript
import { Identify } from '@amplitude/unified'

const amplitude = useAmplitude()

const handleSubmit = async () => {
  const success = await auth.login(formData.username, formData.password)
  if (success) {
    amplitude?.setUserId(formData.username)
    const identifyObj = new Identify()
    identifyObj.set('username', formData.username)
    amplitude?.identify(identifyObj)

    amplitude?.track('User Logged In', { username: formData.username })
  }
}
```

### Event tracking (app/pages/burrito.vue)

```typescript
const amplitude = useAmplitude()

amplitude?.track('Burrito Considered', {
  total_considerations: response.user.burritoConsiderations,
  username: response.user.username,
})
```

### Server-side tracking (server/api/auth/login.post.ts)

```typescript
import { useServerAmplitude } from '../../utils/amplitude'

const amplitude = useServerAmplitude()
amplitude?.track('Server Login Completed', {
  username,
  isNewUser,
  source: 'api',
}, { user_id: username })
```

### Server-side Amplitude utility (server/utils/amplitude.ts)

```typescript
import { NodeClient, createInstance } from '@amplitude/analytics-node'

let client: NodeClient | null = null

export function useServerAmplitude(): NodeClient | null {
  const config = useRuntimeConfig()
  const apiKey = config.public.amplitudeApiKey as string | undefined

  if (!apiKey) return null

  if (!client) {
    client = createInstance()
    client.init(apiKey)
  }
  return client
}
```

This ensures a single Amplitude Node client instance is reused across all server requests.

## Differences from Nuxt 3.6

- **Plugin + composable**: Uses a client plugin with `useAmplitude()` composable instead of `useNuxtApp().$amplitude`
- **Shared server client**: Reuses Amplitude Node client across requests instead of creating per-request
- **Automatic imports**: In Nuxt 4 server routes, h3 functions (`defineEventHandler`, `readBody`, `createError`, `getHeader`, etc.) are auto-imported

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [Nuxt 4 Documentation](https://nuxt.com/docs)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)
- [Amplitude Node.js SDK](https://amplitude.com/docs/sdks/analytics/node)

---

## .env.example

```example
NUXT_PUBLIC_AMPLITUDE_API_KEY=

```

---

## app/app.vue

```vue
<template>
  <div style="min-height: 100vh; display: flex; flex-direction: column; background: #f5f5f5; width: 100%;">
    <AppHeader />
    <main style="flex: 1;">
      <NuxtPage />
    </main>
  </div>
</template>

```

---

## app/components/AppHeader.vue

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
        <span v-if="user">Welcome, {{ user.username }}!</span>
        <span v-else>Not logged in</span>
        <button v-if="user" @click="handleLogout" class="btn-logout">Logout</button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
const amplitude = useAmplitude()
const auth = useAuth()
const user = computed(() => auth.user.value)

const handleLogout = async () => {
  amplitude?.track('User Logged Out')
  amplitude?.reset()
  auth.logout()
  await navigateTo('/')
}
</script>

```

---

## app/composables/useAmplitude.ts

```ts
import * as amplitude from '@amplitude/unified'

export function useAmplitude() {
  if (process.client) {
    return amplitude
  }
  return null
}

```

---

## app/composables/useAuth.ts

```ts
interface User {
  username: string
  burritoConsiderations: number
}

const users: Map<string, User> = new Map()

export function useAuth() {
  const user = useState<User | null>('auth-user', () => {
    if (process.client) {
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
    try {
      const response = await $fetch<{ success: boolean; user: User }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      })

      if (response.success) {
        let localUser = users.get(username)
        if (!localUser) {
          localUser = response.user
          users.set(username, localUser)
        }

        user.value = localUser
        if (process.client) {
          localStorage.setItem('currentUser', username)
        }

        return true
      }
      return false
    } catch (error) {
      console.error('Login error:', error)
      return false
    }
  }

  const logout = () => {
    user.value = null
    if (process.client) {
      localStorage.removeItem('currentUser')
    }
  }

  const incrementBurritoConsiderations = () => {
    if (user.value) {
      user.value.burritoConsiderations++
      users.set(user.value.username, user.value)
      // Trigger reactivity
      user.value = { ...user.value }
    }
  }

  const setUser = (newUser: User) => {
    user.value = newUser
    users.set(newUser.username, newUser)
  }

  return {
    user,
    login,
    logout,
    incrementBurritoConsiderations,
    setUser,
  }
}

```

---

## app/middleware/auth.ts

```ts
export default defineNuxtRouteMiddleware((to, from) => {
  const auth = useAuth()
  const user = auth.user.value

  // If user is not logged in, redirect to home/login page
  if (!user) {
    return navigateTo('/')
  }
})

```

---

## app/pages/burrito.vue

```vue
<template>
  <div class="container">
    <h1>Burrito consideration zone</h1>
    <p>Take a moment to truly consider the potential of burritos.</p>

    <div style="text-align: center">
      <button @click="handleConsideration" class="btn-burrito">
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
definePageMeta({
  middleware: 'auth'
})

const auth = useAuth()
const user = computed(() => auth.user.value)
const amplitude = useAmplitude()
const hasConsidered = ref(false)

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
      amplitude?.track('Burrito Considered', {
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

## app/pages/index.vue

```vue
<template>
  <div class="container">
    <h1 v-if="user">Welcome back, {{ user.username }}!</h1>
    <h1 v-else>Welcome to Burrito Consideration App</h1>

    <div v-if="user">
      <p>You are now logged in. Feel free to explore:</p>
      <ul>
        <li>Consider the potential of burritos</li>
        <li>View your profile and statistics</li>
      </ul>
    </div>

    <div v-else>
      <p>Please sign in to begin your burrito journey</p>

      <form @submit.prevent="handleSubmit" class="form" novalidate>
        <div class="form-group">
          <label for="username">Username:</label>
          <input
            id="username"
            v-model="formData.username"
            type="text"
            placeholder="Enter any username"
            :class="{ 'error-input': errors.username }"
            @blur="validateField('username')"
            @input="clearError('username')"
          />
          <p v-if="errors.username" class="field-error">{{ errors.username }}</p>
        </div>

        <div class="form-group">
          <label for="password">Password:</label>
          <input
            id="password"
            v-model="formData.password"
            type="password"
            placeholder="Enter any password"
            :class="{ 'error-input': errors.password }"
            @blur="validateField('password')"
            @input="clearError('password')"
          />
          <p v-if="errors.password" class="field-error">{{ errors.password }}</p>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>

      <p class="note">
        Note: This is a demo app. Use any username and password to sign in.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Identify } from '@amplitude/unified'
import { loginSchema, validateForm, type LoginFormData } from '../utils/formValidation'

const auth = useAuth()
const user = computed(() => auth.user.value)

const amplitude = useAmplitude()

const formData = reactive<LoginFormData>({
  username: '',
  password: '',
})

const errors = reactive<Partial<Record<keyof LoginFormData, string>>>({})
const error = ref('')
const isSubmitting = ref(false)

const validateField = (field: keyof LoginFormData) => {
  const fieldSchema = loginSchema.shape[field]
  if (!fieldSchema) return

  const result = fieldSchema.safeParse(formData[field])
  if (!result.success) {
    errors[field] = result.error.errors[0]?.message || 'Invalid value'
  } else {
    delete errors[field]
  }
}

const clearError = (field: keyof LoginFormData) => {
  delete errors[field]
}

const handleSubmit = async () => {
  // Clear previous errors
  error.value = ''
  Object.keys(errors).forEach((key) => {
    delete errors[key as keyof LoginFormData]
  })

  // Validate entire form
  const validation = validateForm(loginSchema, formData)
  if (!validation.success) {
    Object.assign(errors, validation.errors)
    return
  }

  isSubmitting.value = true

  try {
    const success = await auth.login(formData.username, formData.password)
    if (success) {
      // Identify user in Amplitude using username as user ID
      amplitude?.setUserId(formData.username)
      const identifyObj = new Identify()
      identifyObj.set('username', formData.username)
      amplitude?.identify(identifyObj)

      // Capture login event
      amplitude?.track('User Logged In', { username: formData.username })

      formData.username = ''
      formData.password = ''
      await navigateTo('/')
    } else {
      error.value = 'Login failed. Please check your credentials and try again.'
    }
  } catch (err) {
    console.error('Login failed:', err)
    error.value = 'An error occurred during login. Please try again.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

```

---

## app/pages/profile.vue

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
      <p v-if="user?.burritoConsiderations === 0">
        You haven't considered any burritos yet. Visit the Burrito Consideration page to start!
      </p>
      <p v-else-if="user?.burritoConsiderations === 1">
        You've considered the burrito potential once. Keep going!
      </p>
      <p v-else-if="user && user.burritoConsiderations < 5">
        You're getting the hang of burrito consideration!
      </p>
      <p v-else-if="user && user.burritoConsiderations < 10">
        You're becoming a burrito consideration expert!
      </p>
      <p v-else>You are a true burrito consideration master! 🌯</p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'auth'
})

const auth = useAuth()
const user = computed(() => auth.user.value)
</script>

```

---

## app/plugins/amplitude.client.ts

```ts
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import * as amplitude from '@amplitude/unified'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const apiKey = runtimeConfig.public.amplitudeApiKey as string | undefined

  if (apiKey) {
    void amplitude.initAll(apiKey)
  }

  return {
    provide: {
      amplitude,
    },
  }
})

```

---

## app/utils/formValidation.ts

```ts
import { z } from 'zod'

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be less than 50 characters'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(3, 'Password must be at least 3 characters'),
})

export type LoginFormData = z.infer<typeof loginSchema>

export function validateForm<T>(schema: z.ZodSchema<T>, data: unknown): {
  success: boolean
  data?: T
  errors?: Record<string, string>
} {
  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data }
  }

  const errors: Record<string, string> = {}
  result.error.errors.forEach((error) => {
    const path = error.path.join('.')
    errors[path] = error.message
  })

  return { success: false, errors }
}

```

---

## nuxt.config.ts

```ts
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: [resolve(__dirname, 'assets/css/main.css')],
  runtimeConfig: {
    public: {
      amplitudeApiKey: process.env.NUXT_PUBLIC_AMPLITUDE_API_KEY || '',
    },
  },
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
import { useServerAmplitude } from '../../utils/amplitude'
import { getOrCreateUser, users } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string; password: string }>(event)
  const { username, password } = body || {}

  if (!username || !password) {
    throw createError({
      statusCode: 400,
      message: 'Username and password required',
    })
  }

  const isNewUser = !users.has(username)
  const user = getOrCreateUser(username)

  // Capture server-side login event
  const amplitude = useServerAmplitude()
  amplitude?.track('Server Login Completed', {
    username,
    isNewUser,
    source: 'api',
  }, { user_id: username })

  return {
    success: true,
    user,
  }
})

```

---

## server/api/burrito/consider.post.ts

```ts
import { useServerAmplitude } from '../../utils/amplitude'
import { users, incrementBurritoConsiderations } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username: string }>(event)
  const username = body?.username

  if (!username) {
    throw createError({
      statusCode: 400,
      message: 'Username required',
    })
  }

  if (!users.has(username)) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    })
  }

  // Increment burrito considerations (fake, in-memory)
  const user = incrementBurritoConsiderations(username)

  // Capture server-side burrito consideration event
  const amplitude = useServerAmplitude()
  amplitude?.track('Burrito Considered', {
    username,
    total_considerations: user.burritoConsiderations,
    source: 'api',
  }, { user_id: username })

  return {
    success: true,
    user: { ...user },
  }
})

```

---

## server/utils/amplitude.ts

```ts
import { createInstance } from '@amplitude/analytics-node'
import type { NodeClient } from '@amplitude/analytics-core'

let client: NodeClient | null = null

export function useServerAmplitude(): NodeClient | null {
  const config = useRuntimeConfig()
  const apiKey = config.public.amplitudeApiKey as string | undefined

  if (!apiKey) return null

  if (!client) {
    client = createInstance()
    client.init(apiKey)
  }
  return client
}

```

---

## server/utils/users.ts

```ts
// Shared in-memory storage for users (fake, no database)
export const users = new Map<string, { username: string; burritoConsiderations: number }>()

export function getOrCreateUser(username: string): { username: string; burritoConsiderations: number } {
  let user = users.get(username)
  
  if (!user) {
    user = { username, burritoConsiderations: 0 }
    users.set(username, user)
  }
  
  return user
}

export function incrementBurritoConsiderations(username: string): { username: string; burritoConsiderations: number } {
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

