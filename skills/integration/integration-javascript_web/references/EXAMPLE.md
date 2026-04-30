# Amplitude JavaScript Web Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/javascript-web

---

## README.md

# Amplitude JavaScript Example - Browser Todo App

A simple browser-based todo application built with vanilla JavaScript and Vite, demonstrating Amplitude integration for non-framework JavaScript projects.

This app runs only in the browser.

Use Amplitude’s [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm): add [`@amplitude/unified`](https://www.npmjs.com/package/@amplitude/unified), import it on the client, and call `initAll(apiKey)` once (see `src/amplitude.js`). [Initialize the Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) describes that call as initializing every product bundled with Unified npm. Pass a second argument for shared options (`serverZone`, `instanceName`) and for each product (`analytics`, `sessionReplay`, `experiment`, `engagement`); see [Unified SDK configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration). The `analytics` block accepts the same settings as [Browser SDK 2](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk). Use a non-zero `sessionReplay.sampleRate` when you want Session Replay sampling ([Session Replay plugin](https://amplitude.com/docs/session-replay/session-replay-plugin#configuration)).

The `experiment` block configures **Feature Experiment** (`@amplitude/experiment-js-client`). Amplitude’s [product support table](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#product-support-by-installation-method) lists **Web Experiment** (`@amplitude/experiment-tag`, including the visual editor) for the Unified **CDN** script, not the Unified **npm** row.

For analytics from Node or other servers, use [`@amplitude/analytics-node`](https://www.npmjs.com/package/@amplitude/analytics-node) (for example the [javascript-node](../../integration-javascript_node/) app), not `@amplitude/unified`.

## Purpose

This example serves as:
- **Verification** that the context-hub wizard works for plain JavaScript projects
- **Reference implementation** of Amplitude best practices for vanilla JS browser apps
- **Working example** you can run and modify

## Features Demonstrated

- **Amplitude initialization** - `amplitude.initAll()` via `@amplitude/unified`
- **Autocapture** - Automatic tracking of clicks, form submissions, and pageviews (enabled by default)
- **Custom event tracking** - Manual `amplitude.track()` calls with event properties
- **User identification** - `setUserId`, `Identify`, and `identify()` on login; `reset()` on logout

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Amplitude

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your Amplitude API key
# VITE_PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key
```

### 3. Run the App

```bash
pnpm dev
```

Open http://localhost:3000 in your browser.

## What Gets Tracked

The app tracks these custom events in Amplitude (in addition to autocaptured clicks and pageviews):

| Event | Properties | Purpose |
|-------|-----------|---------|
| `Todo Added` | `todo_id`, `text_length`, `total_todos` | When user adds a new todo |
| `Todo Completed` | `todo_id`, `time_to_complete_hours` | When user completes a todo |
| `Todo Deleted` | `todo_id`, `was_completed` | When user deletes a todo |
| `User Logged In` | (none) | When user logs in |
| `User Logged Out` | (none) | When user logs out |

## Code Structure

```
basics/javascript-web/
├── index.html           # Entry HTML page
├── package.json         # Dependencies (@amplitude/unified, vite)
├── vite.config.js       # Vite configuration
├── .env.example         # Environment variable template
├── .gitignore           # Git ignore rules
├── README.md            # This file
└── src/
    ├── amplitude.js       # Amplitude initialization (import this first)
    ├── main.js          # Todo app logic with event tracking
    └── style.css        # App styles
```

## Key Implementation Patterns

### 1. Initialization (amplitude.js)

```javascript
import * as amplitude from '@amplitude/unified';

void amplitude.initAll(import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY);

export default amplitude;
```

Initialize Amplitude once, early in your app. Other modules import this default export from `amplitude.js`.

### 2. Event tracking

```javascript
// Track events with properties — never send PII or user-generated content
amplitude.track('event_name', {
  item_count: 5,
  action_type: 'create',
});
```

### 3. User identification

```javascript
import { Identify } from '@amplitude/unified';

amplitude.setUserId(username);
const identifyObj = new Identify();
identifyObj.set('name', username);
amplitude.identify(identifyObj);

// On logout — new anonymous device ID
amplitude.reset();
```

## Running Without Amplitude

The app works fine without Amplitude configured. You'll see a console warning but the app continues to function normally.

## Next Steps

- Modify the app to experiment with Amplitude tracking
- Check your Amplitude dashboard to see tracked events and autocaptured data
- See [Browser Unified SDK (npm)—configuration](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#configuration) for Session Replay (`sessionReplay.sampleRate`), Experiment, Guides & Surveys, and shared options

## Learn More

- [Browser Unified SDK](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk) (install methods, **npm vs CDN**, product matrix)
- [Browser Unified SDK (npm)](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#unified-sdk-npm) · [Initialize `initAll`](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#initialize-the-unified-sdk) · [Access SDK features](https://amplitude.com/docs/sdks/analytics/browser/browser-unified-sdk#access-sdk-features)
- [Browser SDK 2 (analytics options)](https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#initialize-the-sdk)
- [Amplitude Product Analytics](https://amplitude.com/docs/product-analytics)

---

## .env.example

```example
# Amplitude Configuration
VITE_PUBLIC_AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## index.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Todo App - Amplitude JavaScript Example</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <div id="app">
      <header>
        <h1>Todo App</h1>
        <div id="auth-section">
          <div id="logged-out">
            <input type="text" id="username-input" placeholder="Enter username" />
            <button id="login-btn">Log In</button>
          </div>
          <div id="logged-in" hidden>
            <span id="username-display"></span>
            <button id="logout-btn">Log Out</button>
          </div>
        </div>
      </header>

      <main>
        <form id="todo-form">
          <input type="text" id="todo-input" placeholder="What needs to be done?" required />
          <button type="submit">Add</button>
        </form>

        <ul id="todo-list"></ul>

        <div id="stats">
          <span id="total-count">0 items</span>
          <span id="completed-count">0 completed</span>
        </div>
      </main>
    </div>

    <script type="module" src="/src/main.js"></script>
  </body>
</html>

```

---

## src/amplitude.js

```js
/**
 * Amplitude initialization for vanilla JavaScript.
 *
 * Initializes @amplitude/unified once and exports the instance for use across the app.
 * This file should be imported before any other modules that call Amplitude methods.
 */
import * as amplitude from '@amplitude/unified';

const apiKey = import.meta.env.VITE_PUBLIC_AMPLITUDE_API_KEY;

if (!apiKey) {
  console.warn(
    'Amplitude not configured (VITE_PUBLIC_AMPLITUDE_API_KEY not set).',
    'App will work but analytics will not be tracked.',
  );
} else {
  void amplitude.initAll(apiKey);
}

export default amplitude;

```

---

## src/main.js

```js
/**
 * Simple Todo App with Amplitude Analytics
 *
 * A minimal vanilla JavaScript application demonstrating Amplitude integration
 * for non-framework browser JavaScript projects.
 */
import amplitude from './amplitude.js';
import { Identify } from '@amplitude/unified';

// --- State ---

let todos = JSON.parse(localStorage.getItem('todos') || '[]');
let currentUser = localStorage.getItem('currentUser') || null;

// --- DOM Elements ---

const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const todoList = document.getElementById('todo-list');
const totalCount = document.getElementById('total-count');
const completedCount = document.getElementById('completed-count');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const usernameInput = document.getElementById('username-input');
const usernameDisplay = document.getElementById('username-display');
const loggedOutSection = document.getElementById('logged-out');
const loggedInSection = document.getElementById('logged-in');

// --- Auth ---

function login() {
  const username = usernameInput.value.trim();
  if (!username) return;

  currentUser = username;
  localStorage.setItem('currentUser', username);

  // Identify user in Amplitude — links all future events to this user
  amplitude.setUserId(username);
  const identifyObj = new Identify();
  identifyObj.set('name', username);
  amplitude.identify(identifyObj);

  amplitude.track('User Logged In');

  updateAuthUI();
  usernameInput.value = '';
}

function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');

  // Reset Amplitude — unlinks future events from the current user
  // and generates a new anonymous device ID
  amplitude.reset();

  amplitude.track('User Logged Out');

  updateAuthUI();
}

function updateAuthUI() {
  if (currentUser) {
    loggedOutSection.hidden = true;
    loggedInSection.hidden = false;
    usernameDisplay.textContent = currentUser;
  } else {
    loggedOutSection.hidden = false;
    loggedInSection.hidden = true;
  }
}

// --- Todos ---

function addTodo(text) {
  const todo = {
    id: Date.now(),
    text,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  todos.push(todo);
  saveTodos();
  renderTodos();

  // Track the event — only metadata, never PII or user-generated content
  amplitude.track('Todo Added', {
    todo_id: todo.id,
    text_length: text.length,
    total_todos: todos.length,
  });
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todo.completed = !todo.completed;
  saveTodos();
  renderTodos();

  if (todo.completed) {
    const timeToComplete =
      (Date.now() - new Date(todo.createdAt).getTime()) / 3600000;

    amplitude.track('Todo Completed', {
      todo_id: todo.id,
      time_to_complete_hours: Math.round(timeToComplete * 100) / 100,
    });
  }
}

function deleteTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;

  todos = todos.filter((t) => t.id !== id);
  saveTodos();
  renderTodos();

  amplitude.track('Todo Deleted', {
    todo_id: todo.id,
    was_completed: todo.completed,
  });
}

function saveTodos() {
  localStorage.setItem('todos', JSON.stringify(todos));
}

// --- Rendering ---

function renderTodos() {
  todoList.innerHTML = '';

  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = `todo-item${todo.completed ? ' completed' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.completed;
    checkbox.addEventListener('change', () => toggleTodo(todo.id));

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

    li.append(checkbox, text, deleteBtn);
    todoList.appendChild(li);
  }

  // Update stats
  const completed = todos.filter((t) => t.completed).length;
  totalCount.textContent = `${todos.length} item${todos.length !== 1 ? 's' : ''}`;
  completedCount.textContent = `${completed} completed`;
}

// --- Event Listeners ---

todoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (text) {
    addTodo(text);
    todoInput.value = '';
  }
});

loginBtn.addEventListener('click', login);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
logoutBtn.addEventListener('click', logout);

// --- Init ---

// Restore auth state and re-identify if already logged in
if (currentUser) {
  amplitude.setUserId(currentUser);
  const identifyObj = new Identify();
  identifyObj.set('name', currentUser);
  amplitude.identify(identifyObj);
}

updateAuthUI();
renderTodos();

```

---

## vite.config.js

```js
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
});

```

---

