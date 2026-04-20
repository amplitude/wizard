# Amplitude Python Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/python

---

## README.md

# Amplitude Python Example - CLI Todo App

A simple command-line todo application built with plain Python (no frameworks) demonstrating Amplitude integration for CLIs, scripts, data pipelines, and non-web Python applications.

## Purpose

This example serves as:
- **Verification** that the context-hub wizard works for plain Python projects
- **Reference implementation** of Amplitude best practices for non-framework Python code
- **Working example** you can run and modify

## Features Demonstrated

- **Instance-based API** - Uses `Amplitude(api_key)` class for initialization
- **Proper shutdown** - Uses `shutdown()` to flush events before exit
- **Event tracking** - Captures user actions with `BaseEvent` and `event_properties`
- **User identification** - Sets properties on users via `Identify` object

## Quick Start

### 1. Install Dependencies

```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Amplitude

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your Amplitude API key
# AMPLITUDE_API_KEY=your_amplitude_api_key_here
```

### 3. Run the App

```bash
# Add a todo
python todo.py add "Buy groceries"

# List all todos
python todo.py list

# Complete a todo
python todo.py complete 1

# Delete a todo
python todo.py delete 1

# Show statistics
python todo.py stats
```

## What Gets Tracked

The app tracks these events in Amplitude:

| Event | Properties | Purpose |
|-------|-----------|---------|
| `Todo Added` | `todo_id`, `todo_length`, `total_todos` | When user adds a new todo |
| `Todos Viewed` | `total_todos`, `completed_todos` | When user lists todos |
| `Todo Completed` | `todo_id`, `time_to_complete_hours` | When user completes a todo |
| `Todo Deleted` | `todo_id`, `was_completed` | When user deletes a todo |
| `Stats Viewed` | `total_todos`, `completed_todos`, `pending_todos` | When user views stats |

## Code Structure

```
basics/python/
├── todo.py              # Main CLI application
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variable template
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## Key Implementation Patterns

### 1. Instance-Based Initialization

```python
from amplitude import Amplitude, BaseEvent, Identify

client = Amplitude(api_key)
```

### 2. Event Tracking Pattern

```python
client.track(BaseEvent(
    event_type="event_name",
    user_id="user_123",
    event_properties={"key": "value"}
))
```

### 3. Proper Shutdown

```python
try:
    # Your application code
    pass
finally:
    # Always call shutdown() to flush events and close connections
    client.shutdown()
```

### 4. Identifying Users

```python
identify_obj = Identify()
identify_obj.set("email", "user@example.com")
identify_obj.set("plan", "pro")
client.identify(identify_obj, EventOptions(user_id="user_123"))
```

## Running Without Amplitude

The app works fine without Amplitude configured - it simply won't track analytics. You'll see a warning message but the app continues to function normally.

## Next Steps

- Modify `todo.py` to experiment with Amplitude tracking
- Add new commands and track their usage
- Check your Amplitude dashboard to see tracked events

## Learn More

- [Amplitude Python SDK Documentation](https://amplitude.com/docs/sdks/analytics/python)
- [Amplitude Quickstart](https://amplitude.com/docs/get-started/amplitude-quickstart)

---

## .env.example

```example
# Amplitude Configuration
AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## requirements.txt

```txt
amplitude-analytics>=1.0.0
python-dotenv>=1.0.0

```

---

## todo.py

```py
#!/usr/bin/env python3
"""Simple CLI Todo App with Amplitude Analytics

A minimal plain Python CLI application demonstrating Amplitude integration
for non-framework Python projects (CLIs, scripts, data pipelines, etc.).
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from amplitude import Amplitude, BaseEvent, Identify

# Load environment variables
load_dotenv()

# Data file location
DATA_FILE = Path.home() / ".todo_app.json"


def initialize_amplitude():
    """Initialize Amplitude with instance-based API.

    Returns Amplitude instance or None if API key not configured.
    """
    api_key = os.getenv('AMPLITUDE_API_KEY')

    if not api_key:
        print("WARNING: Amplitude not configured (AMPLITUDE_API_KEY not set)")
        print("         App will work but analytics won't be tracked")
        return None

    # Create Amplitude instance
    client = Amplitude(api_key)

    return client


def get_user_id():
    """Get or create a user ID for this installation.

    Uses a UUID stored in the data file to represent this user.
    In a real app, this would be your actual user ID.
    """
    import uuid

    if DATA_FILE.exists():
        data = json.loads(DATA_FILE.read_text())
        if 'user_id' in data:
            return data['user_id']

    # Create new user ID
    return f"user_{uuid.uuid4().hex[:8]}"


def load_todos():
    """Load todos from disk."""
    if not DATA_FILE.exists():
        return {"user_id": get_user_id(), "todos": []}

    return json.loads(DATA_FILE.read_text())


def save_todos(data):
    """Save todos to disk."""
    DATA_FILE.write_text(json.dumps(data, indent=2))


def track_event(client, event_name, properties=None):
    """Track an event with Amplitude.

    Uses the Amplitude Python SDK API.
    """
    if not client:
        return

    client.track(BaseEvent(
        event_type=event_name,
        user_id=get_user_id(),
        event_properties=properties or {}
    ))


def cmd_add(args, client):
    """Add a new todo item."""
    data = load_todos()

    todo = {
        "id": len(data["todos"]) + 1,
        "text": args.text,
        "completed": False,
        "created_at": datetime.now().isoformat()
    }

    data["todos"].append(todo)
    save_todos(data)

    print(f"Added todo #{todo['id']}: {todo['text']}")

    # Track the event
    track_event(client, "Todo Added", {
        "todo_id": todo["id"],
        "todo_length": len(todo["text"]),
        "total_todos": len(data["todos"])
    })


def cmd_list(args, client):
    """List all todos."""
    data = load_todos()

    if not data["todos"]:
        print("No todos yet! Add one with: todo add 'Your task'")
        return

    print(f"\nYour Todos ({len(data['todos'])} total):\n")

    for todo in data["todos"]:
        status = "X" if todo["completed"] else " "
        print(f"  [{status}] #{todo['id']}: {todo['text']}")

    print()

    # Track the event
    track_event(client, "Todos Viewed", {
        "total_todos": len(data["todos"]),
        "completed_todos": sum(1 for t in data["todos"] if t["completed"])
    })


def cmd_complete(args, client):
    """Mark a todo as completed."""
    data = load_todos()

    todo = next((t for t in data["todos"] if t["id"] == args.id), None)

    if not todo:
        print(f"ERROR: Todo #{args.id} not found")
        return

    if todo["completed"]:
        print(f"Todo #{args.id} is already completed")
        return

    todo["completed"] = True
    todo["completed_at"] = datetime.now().isoformat()
    save_todos(data)

    print(f"Completed todo #{todo['id']}: {todo['text']}")

    # Track the event
    track_event(client, "Todo Completed", {
        "todo_id": todo["id"],
        "time_to_complete_hours": (
            datetime.fromisoformat(todo["completed_at"]) -
            datetime.fromisoformat(todo["created_at"])
        ).total_seconds() / 3600
    })


def cmd_delete(args, client):
    """Delete a todo."""
    data = load_todos()

    todo = next((t for t in data["todos"] if t["id"] == args.id), None)

    if not todo:
        print(f"ERROR: Todo #{args.id} not found")
        return

    data["todos"].remove(todo)
    save_todos(data)

    print(f"Deleted todo #{args.id}")

    # Track the event
    track_event(client, "Todo Deleted", {
        "todo_id": todo["id"],
        "was_completed": todo["completed"]
    })


def cmd_stats(args, client):
    """Show usage statistics."""
    data = load_todos()

    total = len(data["todos"])
    completed = sum(1 for t in data["todos"] if t["completed"])
    pending = total - completed

    print(f"\nStats:\n")
    print(f"  Total todos:     {total}")
    print(f"  Completed:       {completed}")
    print(f"  Pending:         {pending}")
    print(f"  Completion rate: {(completed/total*100) if total > 0 else 0:.1f}%")
    print()

    # Track the event
    track_event(client, "Stats Viewed", {
        "total_todos": total,
        "completed_todos": completed,
        "pending_todos": pending
    })


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Simple todo app with Amplitude analytics"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Add command
    add_parser = subparsers.add_parser("add", help="Add a new todo")
    add_parser.add_argument("text", help="Todo text")

    # List command
    subparsers.add_parser("list", help="List all todos")

    # Complete command
    complete_parser = subparsers.add_parser("complete", help="Mark todo as completed")
    complete_parser.add_argument("id", type=int, help="Todo ID")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a todo")
    delete_parser.add_argument("id", type=int, help="Todo ID")

    # Stats command
    subparsers.add_parser("stats", help="Show statistics")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # Initialize Amplitude
    client = initialize_amplitude()

    try:
        # Route to appropriate command
        if args.command == "add":
            cmd_add(args, client)
        elif args.command == "list":
            cmd_list(args, client)
        elif args.command == "complete":
            cmd_complete(args, client)
        elif args.command == "delete":
            cmd_delete(args, client)
        elif args.command == "stats":
            cmd_stats(args, client)

    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    finally:
        # IMPORTANT: Always flush Amplitude to send queued events
        if client:
            client.shutdown()


if __name__ == "__main__":
    main()

```

---

