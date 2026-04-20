# Amplitude JavaScript Node Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/javascript-node

---

## README.md

# Amplitude Node.js Example - Todo API

A simple Express server demonstrating Amplitude Node.js integration for server-side applications (APIs, backends, workers, etc.).

## Purpose

This example serves as:

- **Verification** that the context-hub wizard works for plain Node.js projects
- **Reference implementation** of Amplitude best practices for server-side Node.js code
- **Working example** you can run and modify

## Features

- **Event capture** – tracks user actions with `amplitude.capture()` on each route
- **User identification** – calls `amplitude.identify()` on write actions to associate user traits
- **Feature flags** – gates the stats endpoint detail level with `amplitude.isFeatureEnabled()`
- **Error tracking** – captures exceptions with `amplitude.captureException()` and `enableExceptionAutocapture`
- **Graceful shutdown** – flushes pending events with `await amplitude.shutdown()` on SIGINT/SIGTERM

## Quick start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Amplitude

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your Amplitude API key
# AMPLITUDE_API_KEY=your_amplitude_api_key
```

### 3. Run the server

```bash
npm start
# Todo API running at http://localhost:3000
```

### 4. Try it out

```bash
# Add a todo
curl -X POST http://localhost:3000/todos \
  -H 'Content-Type: application/json' \
  -d '{"text": "Buy groceries", "user_id": "user_123"}'

# List all todos
curl http://localhost:3000/todos

# Complete a todo
curl -X PATCH http://localhost:3000/todos/1/complete \
  -H 'Content-Type: application/json' \
  -d '{"user_id": "user_123"}'

# Delete a todo
curl -X DELETE http://localhost:3000/todos/1

# Show statistics
curl http://localhost:3000/stats
```

## What gets tracked

The app tracks these events in Amplitude:

| Event | Properties | Purpose |
|-------|-----------|---------|
| `Todo Added` | `todo_id`, `todo_length`, `total_todos` | When a todo is created |
| `Todos Viewed` | `total_todos`, `completed_todos` | When todos are listed |
| `Todo Completed` | `todo_id`, `time_to_complete_hours` | When a todo is completed |
| `Todo Deleted` | `todo_id`, `was_completed` | When a todo is deleted |
| `Stats Viewed` | `total_todos`, `completed_todos`, `pending_todos` | When stats are requested |

## Code structure

```
basics/javascript-node/
├── todo.js              # Express server with Amplitude tracking
├── package.json         # Node.js dependencies
├── .env.example         # Environment variable template
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

## Patterns

### 1. Initialization

```javascript
import { init, track, identify, Identify, flush } from '@amplitude/analytics-node';

init(apiKey);
```

### 2. Event tracking on routes

```javascript
app.post('/todos', (req, res) => {
  // ... create todo ...

  amplitude.capture({
    distinctId: req.body.user_id,
    event: 'Todo Added',
    properties: { todo_id: todo.id },
  });

  res.status(201).json(todo);
});
```

### 3. Graceful shutdown

```javascript
async function shutdown() {
  server.close();
  await amplitude.shutdown(); // Flush pending events
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

## Learn more

- [Amplitude Node.js SDK Documentation](https://amplitude.com/docs/libraries/node)
- [Amplitude Node.js SDK API Reference](https://amplitude.com/docs/references/@amplitude/analytics-node)
- [Amplitude Product Analytics](https://amplitude.com/docs/product-analytics)

---

## .env.example

```example
# Amplitude Configuration
AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## todo.js

```js
/**
 * Simple Todo API with Amplitude Analytics
 *
 * A minimal Express server demonstrating Amplitude Node.js integration
 * for server-side applications (APIs, backends, workers, etc.).
 */

import express from 'express';
import { init, track, identify, Identify, flush } from '@amplitude/analytics-node';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// In-memory store, replaced with a database in production
const todos = [];
let nextId = 1;

// --- Amplitude Setup ---

function initializeAmplitude() {
  const apiKey = process.env.AMPLITUDE_API_KEY;

  if (!apiKey) {
    console.log('WARNING: Amplitude not configured (AMPLITUDE_API_KEY not set)');
    console.log('         App will work but analytics won\'t be tracked');
    return false;
  }

  init(apiKey);
  return true;
}

const amplitudeEnabled = initializeAmplitude();

function trackEvent(userId, event, properties = {}) {
  if (!amplitudeEnabled) return;

  track(event, properties, { user_id: userId });
}

function identifyUser(userId, properties = {}) {
  if (!amplitudeEnabled) return;

  const identifyEvent = new Identify();
  Object.entries(properties).forEach(([key, value]) => identifyEvent.set(key, value));
  identify(identifyEvent, { user_id: userId });
}

// --- Routes ---

// Add a todo
app.post('/todos', (req, res) => {
  const { text, user_id } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  const userId = user_id || 'anonymous';

  const todo = {
    id: nextId++,
    text,
    completed: false,
    created_at: new Date().toISOString(),
  };

  todos.push(todo);

  identifyUser(userId, {
    last_active: new Date().toISOString(),
    total_todos_created: todos.length,
  });

  trackEvent(userId, 'Todo Added', {
    todo_id: todo.id,
    todo_length: text.length,
    total_todos: todos.length,
  });

  res.status(201).json(todo);
});

// List all todos
app.get('/todos', (req, res) => {
  const userId = req.query.user_id || 'anonymous';

  trackEvent(userId, 'Todos Viewed', {
    total_todos: todos.length,
    completed_todos: todos.filter((t) => t.completed).length,
  });

  res.json(todos);
});

// Complete a todo
app.patch('/todos/:id/complete', (req, res) => {
  const todo = todos.find((t) => t.id === parseInt(req.params.id, 10));

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  if (todo.completed) {
    return res.status(400).json({ error: 'Todo already completed' });
  }

  todo.completed = true;
  todo.completed_at = new Date().toISOString();

  const userId = req.body.user_id || 'anonymous';

  trackEvent(userId, 'Todo Completed', {
    todo_id: todo.id,
    time_to_complete_hours:
      (new Date(todo.completed_at) - new Date(todo.created_at)) / 3600000,
  });

  res.json(todo);
});

// Delete a todo
app.delete('/todos/:id', (req, res) => {
  const index = todos.findIndex((t) => t.id === parseInt(req.params.id, 10));

  if (index === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  const todo = todos[index];
  todos.splice(index, 1);

  const userId = req.query.user_id || 'anonymous';

  trackEvent(userId, 'Todo Deleted', {
    todo_id: todo.id,
    was_completed: todo.completed,
  });

  res.status(204).end();
});

// Stats
app.get('/stats', async (req, res) => {
  const total = todos.length;
  const completed = todos.filter((t) => t.completed).length;
  const pending = total - completed;

  const userId = req.query.user_id || 'anonymous';

  const stats = {
    total,
    completed,
    pending,
    completion_rate: total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0',
  };

  // TODO: Use Amplitude Experiment for feature flags

  trackEvent(userId, 'Stats Viewed', {
    total_todos: total,
    completed_todos: completed,
    pending_todos: pending,
  });

  res.json(stats);
});

// --- Error Handling ---

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Server ---

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Todo API running at http://localhost:${PORT}`);
});

// Graceful shutdown, flush Amplitude events before exiting
async function shutdown() {
  console.log('\nShutting down...');
  server.close();
  if (amplitudeEnabled) {
    await flush();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

```

---

