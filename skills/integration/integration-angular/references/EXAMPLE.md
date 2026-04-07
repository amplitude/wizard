# Amplitude Angular Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/angular

---

## README.md

# Amplitude Angular Example

This is an [Angular](https://angular.dev/) example demonstrating Amplitude integration with product analytics.

The app runs in the browser and uses the [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): `@amplitude/unified` with one `initAll(apiKey)` call (see `AmplitudeService`). [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) describes that call as initializing every product bundled into the npm package; use an optional second argument for [Unified SDK configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) (`serverZone`, `instanceName`, and the `analytics`, `sessionReplay`, `experiment`, and `engagement` sections). `analytics` settings match [Browser SDK 2](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk).

The `experiment` section configures **Feature Experiment** (`@amplitude/experiment-js-client`). Per Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method), **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) is listed for the Unified **CDN** script, not the Unified **npm** row—the npm `experiment` options still cover code-based flags and the Experiment JS client bundled with `@amplitude/unified`.

This sample does not send events from Node. For API or server-only analytics, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node).

## Features

- **Product analytics**: Track user events and behaviors
- **User authentication**: Demo login system with Amplitude user identification
- **SSR-safe**: Uses platform checks for browser-only Amplitude calls

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env` file in the root directory:

```bash
NG_APP_AMPLITUDE_API_KEY=your_amplitude_api_key
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com/).

### 3. Run the development server

```bash
pnpm start
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.

## Project structure

```
src/
├── app/
│   ├── components/
│   │   └── header/            # Navigation header with auth state
│   ├── pages/
│   │   ├── home/              # Home/Login page
│   │   ├── burrito/           # Demo feature page with event tracking
│   │   └── profile/           # User profile page
│   ├── services/
│   │   ├── amplitude.service.ts # Amplitude service wrapper (SSR-safe)
│   │   └── auth.service.ts    # Auth service with Amplitude integration
│   ├── guards/
│   │   └── auth.guard.ts      # Route guard for protected pages
│   ├── app.component.ts       # Root component with Amplitude init
│   ├── app.routes.ts          # Route definitions
│   └── app.config.ts          # App configuration
├── environments/
│   ├── environment.ts         # Dev environment config
│   └── environment.production.ts
└── main.ts                    # App entry point
```

## Key integration points

### Amplitude service (services/amplitude.service.ts)

A wrapper service that handles SSR safety and provides access to the Amplitude instance:

```typescript
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as amplitude from '@amplitude/unified';

@Injectable({ providedIn: 'root' })
export class AmplitudeService {
  private readonly platformId = inject(PLATFORM_ID);
  private initialized = false;

  get amplitude(): typeof amplitude {
    if (isPlatformBrowser(this.platformId) && this.initialized) {
      return amplitude;
    }
    return new Proxy({} as typeof amplitude, {
      get: () => () => undefined,
    });
  }

  init(apiKey: string): void {
    if (isPlatformBrowser(this.platformId) && !this.initialized) {
      void amplitude.initAll(apiKey);
      this.initialized = true;
    }
  }
}
```

### Amplitude initialization (app.component.ts)

Amplitude is initialized in the root component's `ngOnInit`:

```typescript
import { AmplitudeService } from './services/amplitude.service';
import { environment } from '../environments/environment';

export class AppComponent implements OnInit {
  private readonly amplitudeService = inject(AmplitudeService);

  ngOnInit(): void {
    this.amplitudeService.init(environment.amplitudeApiKey);
  }
}
```

### User identification (services/auth.service.ts)

```typescript
import { AmplitudeService } from './amplitude.service';
import { Identify } from '@amplitude/unified';

const amplitudeService = inject(AmplitudeService);

amplitudeService.amplitude.setUserId(username);
const identifyObj = new Identify();
identifyObj.set('username', username);
amplitudeService.amplitude.identify(identifyObj);
```

### Event tracking (pages/burrito/burrito.component.ts)

```typescript
import { AmplitudeService } from '../../services/amplitude.service';

const amplitudeService = inject(AmplitudeService);

amplitudeService.amplitude.track('Burrito Considered', {
  total_considerations: count,
  username: username,
});
```

## Angular-specific details

This example uses Angular 21 with modern features:

1. **Standalone components**: No NgModules, all components use `standalone: true`
2. **Signals**: Reactive state management with Angular signals
3. **SSR support**: Uses `isPlatformBrowser()` checks for SSR safety
4. **Dependency injection**: Amplitude wrapped in an injectable service
5. **Environment files**: Generated from `.env` at build time via prebuild script

## Learn more

- [Amplitude Documentation](https://www.docs.developers.amplitude.com/)
- [Angular Documentation](https://angular.dev/)
- [Amplitude Browser SDK](https://www.docs.developers.amplitude.com/data/sdks/browser-2/)

---

## .env.example

```example
NG_APP_AMPLITUDE_API_KEY=your_amplitude_api_key

```

---

## src/app/app.component.ts

```ts
import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './components/header/header.component';
import { AmplitudeService } from './services/amplitude.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent],
  template: `
    <app-header />
    <router-outlet />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly amplitudeService = inject(AmplitudeService);

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.amplitudeService.init(environment.amplitudeApiKey);
    }
  }
}

```

---

## src/app/app.config.server.ts

```ts
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

```

---

## src/app/app.config.ts

```ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
  ],
};

```

---

## src/app/app.routes.server.ts

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Server,
  },
  {
    path: 'burrito',
    renderMode: RenderMode.Client, // Protected route, render client-side
  },
  {
    path: 'profile',
    renderMode: RenderMode.Client, // Protected route, render client-side
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];

```

---

## src/app/app.routes.ts

```ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'Burrito Consideration App',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'burrito',
    title: 'Burrito Consideration - Burrito Consideration App',
    loadComponent: () =>
      import('./pages/burrito/burrito.component').then(
        (m) => m.BurritoComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    title: 'Profile - Burrito Consideration App',
    loadComponent: () =>
      import('./pages/profile/profile.component').then(
        (m) => m.ProfileComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];

```

---

## src/app/components/header/header.component.ts

```ts
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink],
  template: `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="header" role="banner">
      <div class="header-container">
        <nav aria-label="Main navigation">
          <a routerLink="/">Home</a>
          @if (auth.isAuthenticated()) {
            <a routerLink="/burrito">Burrito Consideration</a>
            <a routerLink="/profile">Profile</a>
          }
        </nav>
        <div class="user-section">
          @if (auth.user(); as user) {
            <span>Welcome, {{ user.username }}!</span>
            <button (click)="auth.logout()" class="btn-logout">Logout</button>
          } @else {
            <span>Not logged in</span>
          }
        </div>
      </div>
    </header>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
}

```

---

## src/app/guards/auth.guard.ts

```ts
import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/']);
};

```

---

## src/app/pages/burrito/burrito.component.ts

```ts
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AmplitudeService } from '../../services/amplitude.service';

@Component({
  selector: 'app-burrito',
  template: `
    <main id="main-content" tabindex="-1">
      <div class="container">
        <h1>Burrito consideration zone</h1>
        <p>Take a moment to truly consider the potential of burritos.</p>

        <div style="text-align: center">
          <button (click)="handleConsideration()" class="btn-burrito">
            I have considered the burrito potential
          </button>

          @if (hasConsidered()) {
            <p class="success" role="status" aria-live="polite">
              Thank you for your consideration! Count:
              {{ auth.user()?.burritoConsiderations }}
            </p>
          }
        </div>

        <div class="stats">
          <h3>Consideration stats</h3>
          <p>Total considerations: {{ auth.user()?.burritoConsiderations }}</p>
        </div>
      </div>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BurritoComponent {
  readonly auth = inject(AuthService);
  private readonly amplitudeService = inject(AmplitudeService);
  private readonly router = inject(Router);

  hasConsidered = signal(false);

  constructor() {
    // Redirect if not authenticated
    if (!this.auth.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }

  handleConsideration(): void {
    const user = this.auth.user();
    if (!user) return;

    this.auth.incrementBurritoConsiderations();
    this.hasConsidered.set(true);
    setTimeout(() => this.hasConsidered.set(false), 2000);

    this.amplitudeService.amplitude.track('Burrito Considered', {
      total_considerations: user.burritoConsiderations + 1,
      username: user.username,
    });
  }
}

```

---

## src/app/pages/home/home.component.ts

```ts
import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-home',
  imports: [ReactiveFormsModule],
  template: `
    <main id="main-content" tabindex="-1">
      @if (auth.user(); as user) {
        <div class="container">
          <h1>Welcome back, {{ user.username }}!</h1>
          <p>You are now logged in. Feel free to explore:</p>
          <ul>
            <li>Consider the potential of burritos</li>
            <li>View your profile and statistics</li>
          </ul>
        </div>
      } @else {
        <div class="container">
          <h1>Welcome to Burrito Consideration App</h1>
          <p>Please sign in to begin your burrito journey</p>

          <form [formGroup]="loginForm" (ngSubmit)="handleSubmit()" class="form">
            <div class="form-group">
              <label for="username">Username:</label>
              <input
                type="text"
                id="username"
                formControlName="username"
                placeholder="Enter any username"
                autocomplete="username"
              />
            </div>

            <div class="form-group">
              <label for="password">Password:</label>
              <input
                type="password"
                id="password"
                formControlName="password"
                placeholder="Enter any password"
                autocomplete="current-password"
              />
            </div>

            @if (error()) {
              <p class="error" role="alert">{{ error() }}</p>
            }

            <button type="submit" class="btn-primary">Sign In</button>
          </form>

          <p class="note">
            Note: This is a demo app. Use any username and password to sign in.
          </p>
        </div>
      }
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);

  loginForm = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  error = signal('');

  handleSubmit(): void {
    this.error.set('');

    if (this.loginForm.invalid) {
      this.error.set('Please provide both username and password');
      return;
    }

    const { username, password } = this.loginForm.getRawValue();

    const success = this.auth.login(username, password);
    if (success) {
      this.loginForm.reset();
    } else {
      this.error.set('Please provide both username and password');
    }
  }
}

```

---

## src/app/pages/profile/profile.component.ts

```ts
import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  template: `
    <main id="main-content" tabindex="-1">
      <div class="container">
        <h1>User Profile</h1>

        <div class="stats">
          <h2>Your Information</h2>
          <p><strong>Username:</strong> {{ auth.user()?.username }}</p>
          <p>
            <strong>Burrito Considerations:</strong>
            {{ auth.user()?.burritoConsiderations }}
          </p>
        </div>

        <div style="margin-top: 2rem">
          <h3>Your Burrito Journey</h3>
          <p>{{ journeyMessage() }}</p>
        </div>
      </div>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  journeyMessage = computed(() => {
    const count = this.auth.user()?.burritoConsiderations ?? 0;

    if (count === 0) {
      return "You haven't considered any burritos yet. Visit the Burrito Consideration page to start!";
    } else if (count === 1) {
      return "You've considered the burrito potential once. Keep going!";
    } else if (count < 5) {
      return "You're getting the hang of burrito consideration!";
    } else if (count < 10) {
      return "You're becoming a burrito consideration expert!";
    } else {
      return 'You are a true burrito consideration master!';
    }
  });

  constructor() {
    if (!this.auth.isAuthenticated()) {
      this.router.navigate(['/']);
    }
  }
}

```

---

## src/app/services/amplitude.service.ts

```ts
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as amplitude from '@amplitude/unified';

@Injectable({ providedIn: 'root' })
export class AmplitudeService {
  private readonly platformId = inject(PLATFORM_ID);
  private initialized = false;

  /**
   * The amplitude instance. Use this directly to call amplitude methods.
   * Returns the actual amplitude instance on browser, or a no-op proxy on server.
   */
  get amplitude(): typeof amplitude {
    if (isPlatformBrowser(this.platformId) && this.initialized) {
      return amplitude;
    }
    // Return a no-op proxy for SSR safety
    return new Proxy({} as typeof amplitude, {
      get: () => () => undefined,
    });
  }

  init(apiKey: string): void {
    if (isPlatformBrowser(this.platformId) && !this.initialized) {
      void amplitude.initAll(apiKey);
      this.initialized = true;
    }
  }
}

```

---

## src/app/services/auth.service.ts

```ts
import {
  Injectable,
  signal,
  computed,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AmplitudeService } from './amplitude.service';
import { Identify } from '@amplitude/unified';

export interface User {
  username: string;
  burritoConsiderations: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly amplitudeService = inject(AmplitudeService);

  // In-memory user store (matches TanStack behavior)
  private readonly users = new Map<string, User>();

  // Signals for reactive state
  private readonly _user = signal<User | null>(null);

  // Public computed signals
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  constructor() {
    // Initialize from localStorage on browser
    if (isPlatformBrowser(this.platformId)) {
      const storedUsername = localStorage.getItem('currentUser');
      if (storedUsername) {
        const existingUser = this.users.get(storedUsername);
        if (existingUser) {
          this._user.set(existingUser);
        }
      }
    }
  }

  login(username: string, password: string): boolean {
    if (!username || !password) {
      return false;
    }

    // Get or create user in local map (no API call)
    let user = this.users.get(username);
    const isNewUser = !user;

    if (!user) {
      user = { username, burritoConsiderations: 0 };
      this.users.set(username, user);
    }

    this._user.set(user);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('currentUser', username);
    }

    // Amplitude identification (client-side only)
    this.amplitudeService.amplitude.setUserId(username);
    const identifyObj = new Identify();
    identifyObj.set('username', username);
    identifyObj.set('isNewUser', isNewUser);
    this.amplitudeService.amplitude.identify(identifyObj);

    this.amplitudeService.amplitude.track('User Logged In', {
      username,
      isNewUser,
    });

    return true;
  }

  logout(): void {
    this.amplitudeService.amplitude.track('User Logged Out');
    this.amplitudeService.amplitude.reset();

    this._user.set(null);

    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('currentUser');
    }
  }

  incrementBurritoConsiderations(): void {
    const currentUser = this._user();
    if (currentUser) {
      const updated = {
        ...currentUser,
        burritoConsiderations: currentUser.burritoConsiderations + 1,
      };
      this.users.set(currentUser.username, updated);
      this._user.set(updated);
    }
  }
}

```

---

## src/env.d.ts

```ts
// Define the type of the environment variables.
declare interface Env {
  readonly NODE_ENV: string;
  readonly NG_APP_AMPLITUDE_API_KEY: string;
}

// Use import.meta.env.YOUR_ENV_VAR in your code.
declare interface ImportMeta {
  readonly env: Env;
}

```

---

## src/environments/environment.prod.ts

```ts
export const environment = {
  production: true,
  amplitudeApiKey: import.meta.env['NG_APP_AMPLITUDE_API_KEY'] || '',
};

```

---

## src/environments/environment.production.ts

```ts
export const environment = {
  production: true,
  amplitudeApiKey: import.meta.env['NG_APP_AMPLITUDE_API_KEY'] || '',
};

```

---

## src/environments/environment.ts

```ts
export const environment = {
  production: false,
  amplitudeApiKey: import.meta.env['NG_APP_AMPLITUDE_API_KEY'] || '',
};

```

---

## src/index.html

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Burrito Consideration App</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Consider the potential of burritos">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>

```

---

## src/main.server.ts

```ts
import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;

```

---

## src/main.ts

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err)
);

```

---

