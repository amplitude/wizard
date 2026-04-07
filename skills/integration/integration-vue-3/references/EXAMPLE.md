# Amplitude Vue 3 Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/vue-3

---

## README.md

# Amplitude Vue 3 + Vite example

This is a [Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/) example demonstrating Amplitude integration with product analytics and event tracking.

It uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified) and `initAll` in `main.ts`. [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) describes that call as initializing every product bundled with Unified npm; see [configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) for `analytics`, `sessionReplay`, `experiment`, and `engagement`. The `experiment` block is **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the Unified **CDN** script, not Unified **npm** ([choose your installation method](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#choose-your-installation-method)).

This sample shows how to:

- Initialize Amplitude in `main.ts`
- Identify users on login
- Track custom events
- Reset the session on logout

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
VITE_AMPLITUDE_API_KEY=your_amplitude_api_key
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the app.

## Key Integration Points

### Initialization (src/main.ts)

```typescript
import * as amplitude from '@amplitude/unified'

void amplitude.initAll(import.meta.env.VITE_AMPLITUDE_API_KEY || '')
```

### User identification (src/views/Home.vue)

```typescript
import * as amplitude from '@amplitude/unified'
import { Identify } from '@amplitude/unified'

amplitude.setUserId(username)
const identifyObj = new Identify()
identifyObj.set('username', username)
amplitude.identify(identifyObj)
amplitude.track('User Logged In', { username })
```

### Event tracking (src/views/Burrito.vue)

```typescript
amplitude.track('Burrito Considered', {
  total_considerations: updatedUser.burritoConsiderations,
  username: updatedUser.username
})
```

### Session reset on logout (src/components/Header.vue)

```typescript
amplitude.track('User Logged Out')
amplitude.reset()
```

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [Amplitude Browser SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2)
- [Vue 3 Documentation](https://vuejs.org/)
- [Vite Documentation](https://vitejs.dev/)

---

## .editorconfig

```
[*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue,css,scss,sass,less,styl}]
charset = utf-8
indent_size = 2
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true
end_of_line = lf
max_line_length = 100

```

---

## .env.example

```example
VITE_AMPLITUDE_API_KEY=your_amplitude_api_key

```

---

## env.d.ts

```ts
/// <reference types="vite/client" />

```

---

## index.html

```html
<!DOCTYPE html>
<html lang="">
  <head>
    <meta charset="UTF-8">
    <link rel="icon" href="/favicon.ico">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vite App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>

```

---

## src/App.vue

```vue
<script setup lang="ts">
import Header from '@/components/Header.vue'
</script>

<template>
  <Header />
  <main>
    <RouterView />
  </main>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  color: #333;
  background: #f5f5f5;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

main {
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 2rem auto;
  padding: 0 1rem;
}

h1 {
  margin-bottom: 1rem;
}

p {
  margin-bottom: 1rem;
}
</style>

```

---

## src/components/Header.vue

```vue
<template>
  <header class="header">
    <div class="header-container">
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <template v-if="authStore.user">
          <RouterLink to="/burrito">Burrito Consideration</RouterLink>
          <RouterLink to="/profile">Profile</RouterLink>
        </template>
      </nav>
      <div class="user-section">
        <template v-if="authStore.user && authStore.user.username">
          <span>Welcome, {{ authStore.user.username }}!</span>
          <button @click="handleLogout" class="btn-logout">
            Logout
          </button>
        </template>
        <template v-else>
          <span>Not logged in</span>
          <button v-if="authStore.user" @click="handleLogout" class="btn-logout">
            Clear Session
          </button>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import * as amplitude from '@amplitude/unified'

const authStore = useAuthStore()
const router = useRouter()

const handleLogout = () => {
  amplitude.track('User Logged Out')
  authStore.logout()
  amplitude.reset()
  router.push({ name: 'home' })
}
</script>

<style scoped>
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

## src/main.ts

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import * as amplitude from '@amplitude/unified'

void amplitude.initAll(import.meta.env.VITE_AMPLITUDE_API_KEY || '')

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

```

---

## src/router/index.ts

```ts
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Home from '@/views/Home.vue'
import Burrito from '@/views/Burrito.vue'
import Profile from '@/views/Profile.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home
    },
    {
      path: '/burrito',
      name: 'burrito',
      component: Burrito,
      meta: { requiresAuth: true }
    },
    {
      path: '/profile',
      name: 'profile',
      component: Profile,
      meta: { requiresAuth: true }
    }
  ]
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  
  // Check if user exists and has a valid username
  const isValidUser = authStore.user && authStore.user.username
  
  if (to.meta.requiresAuth && !isValidUser) {
    // Clear invalid state
    if (authStore.user && !authStore.user.username) {
      authStore.logout()
    }
    next({ name: 'home' })
  } else {
    next()
  }
})

export default router

```

---

## src/stores/auth.ts

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface User {
  username: string
  burritoConsiderations: number
}

const users = new Map<string, User>()

export const useAuthStore = defineStore('auth', () => {

  const getInitialUser = (): User | null => {
    if (typeof window === 'undefined') return null

    const storedUsername = localStorage.getItem('currentUser')
    if (storedUsername) {
      const existingUser = users.get(storedUsername)
      if (existingUser && existingUser.username) {
        return existingUser
      } else {
        // Clean up invalid state
        localStorage.removeItem('currentUser')
      }
    }
    return null
  }

  const user = ref<User | null>(getInitialUser())

  const isAuthenticated = computed(() => user.value !== null)

  const login = async (username: string, password: string): Promise<boolean> => {
    // Client-side only fake auth - no server calls
    if (!username || !password) {
      return false
    }

    let localUser = users.get(username)
    if (!localUser) {
      localUser = {
        username,
        burritoConsiderations: 0
      }
      users.set(username, localUser)
    }

    user.value = localUser
    localStorage.setItem('currentUser', username)

    return true
  }

  const logout = () => {
    user.value = null
    localStorage.removeItem('currentUser')
  }

  const setUser = (newUser: User) => {
    user.value = newUser
    users.set(newUser.username, newUser)
  }

  return {
    user,
    isAuthenticated,
    login,
    logout,
    setUser
  }
})

```

---

## src/views/Burrito.vue

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
        Thank you for your consideration! Count: {{ authStore.user?.burritoConsiderations }}
      </p>
    </div>

    <div class="stats">
      <h3>Consideration stats</h3>
      <p>Total considerations: {{ authStore.user?.burritoConsiderations }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as amplitude from '@amplitude/unified'

const authStore = useAuthStore()
const hasConsidered = ref(false)

const handleConsideration = () => {
  if (!authStore.user) return

  // Client-side only - no server calls
  const updatedUser = {
    ...authStore.user,
    burritoConsiderations: authStore.user.burritoConsiderations + 1
  }
  authStore.setUser(updatedUser)
  hasConsidered.value = true
  setTimeout(() => {
    hasConsidered.value = false
  }, 2000)

  // Track burrito consideration event
  amplitude.track('Burrito Considered', {
    total_considerations: updatedUser.burritoConsiderations,
    username: updatedUser.username
  })
}
</script>

<style scoped>
.container {
  padding: 2rem;
  max-width: 600px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.btn-burrito {
  background-color: #28a745;
  color: white;
  border: none;
  padding: 1rem 2rem;
  border-radius: 4px;
  font-size: 18px;
  cursor: pointer;
  margin: 2rem 0;
}

.btn-burrito:hover {
  background-color: #218838;
}

.success {
  color: #28a745;
  margin-top: 0.5rem;
}

.stats {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
}

h3 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
</style>

```

---

## src/views/Home.vue

```vue
<template>
  <div class="container">
    <template v-if="authStore.user && authStore.user.username">
      <h1>Welcome back, {{ authStore.user.username }}!</h1>
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
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import * as amplitude from '@amplitude/unified'
import { Identify } from '@amplitude/unified'

const authStore = useAuthStore()
const username = ref('')
const password = ref('')
const error = ref('')

// Clean up invalid user state on mount
onMounted(() => {
  if (authStore.user && !authStore.user.username) {
    authStore.logout()
  }
})

const handleSubmit = async () => {
  error.value = ''

  const success = await authStore.login(username.value, password.value)
  if (success) {
    amplitude.setUserId(username.value)
    const identifyObj = new Identify()
    identifyObj.set('username', username.value)
    amplitude.identify(identifyObj)
    amplitude.track('User Logged In', { username: username.value })

    username.value = ''
    password.value = ''
  } else {
    error.value = 'Please provide both username and password'
  }
}
</script>

<style scoped>
.container {
  padding: 2rem;
  max-width: 600px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.form {
  margin-top: 2rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

.form-group input:focus {
  outline: none;
  border-color: #0070f3;
}

.btn-primary {
  background-color: #0070f3;
  color: white;
  border: none;
  padding: 0.75rem 2rem;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  width: 100%;
  margin-top: 1rem;
}

.btn-primary:hover {
  background-color: #0051cc;
}

.error {
  color: #dc3545;
  margin-top: 0.5rem;
}

.note {
  margin-top: 2rem;
  color: #666;
  font-size: 14px;
  text-align: center;
}

ul {
  margin-top: 1rem;
  padding-left: 1.5rem;
}

li {
  margin-bottom: 0.5rem;
}
</style>

```

---

## src/views/Profile.vue

```vue
<template>
  <div class="container">
    <h1>User Profile</h1>

    <div class="stats">
      <h2>Your Information</h2>
      <p><strong>Username:</strong> {{ authStore.user?.username }}</p>
      <p><strong>Burrito Considerations:</strong> {{ authStore.user?.burritoConsiderations }}</p>
    </div>

    <div style="margin-top: 2rem">
      <h3>Your Burrito Journey</h3>
      <template v-if="authStore.user">
        <p v-if="authStore.user.burritoConsiderations === 0">
          You haven't considered any burritos yet. Visit the Burrito Consideration page to start!
        </p>
        <p v-else-if="authStore.user.burritoConsiderations === 1">
          You've considered the burrito potential once. Keep going!
        </p>
        <p v-else-if="authStore.user.burritoConsiderations < 5">
          You're getting the hang of burrito consideration!
        </p>
        <p v-else-if="authStore.user.burritoConsiderations < 10">
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
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
</script>

<style scoped>
.container {
  padding: 2rem;
  max-width: 600px;
  margin: 0 auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.stats {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 4px;
  margin-top: 1rem;
}

h2 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

h3 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
</style>

```

---

## vite.config.ts

```ts
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})

```

---

