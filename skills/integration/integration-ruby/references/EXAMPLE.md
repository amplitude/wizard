# Amplitude Ruby Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/ruby

---

## README.md

# Amplitude Ruby Example - CLI Todo App

A simple command-line todo application built with plain Ruby (no frameworks) demonstrating Amplitude integration for CLIs, scripts, data pipelines, and non-web Ruby applications.

## Purpose

This example serves as:
- **Verification** that the context-hub wizard works for plain Ruby projects
- **Reference implementation** of Amplitude best practices for non-framework Ruby code
- **Working example** you can run and modify

## Features Demonstrated

- **Instance-based API** - Uses `Amplitude::Client.instance` for explicit client management
- **Proper shutdown** - Uses `flush` in `ensure` block to send events before exit
- **Event tracking** - Captures user actions with `user_id` and event properties

## Quick Start

### 1. Install Dependencies

```bash
# Install bundler if needed
gem install bundler

# Install dependencies
bundle install
```

### 2. Configure Amplitude

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your Amplitude API key
# AMPLITUDE_API_KEY=your_amplitude_api_key_here
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Run the App

```bash
# Add a todo
ruby todo.rb add "Buy groceries"

# List all todos
ruby todo.rb list

# Complete a todo
ruby todo.rb complete 1

# Delete a todo
ruby todo.rb delete 1

# Show statistics
ruby todo.rb stats
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
basics/ruby/
├── todo.rb              # Main CLI application
├── Gemfile              # Ruby dependencies
├── .env.example         # Environment variable template
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

## Key Implementation Patterns

### 1. Instance-Based Initialization

```ruby
require 'amplitude-analytics'

client = Amplitude::Client.instance
client.api_key = ENV['AMPLITUDE_API_KEY']
```

### 2. Event Tracking Pattern

```ruby
event = Amplitude::BaseEvent.new(
  event_type: 'event_name',
  user_id: 'user_123',
  event_properties: { key: 'value' }
)
client.track(event)
```

### 3. Proper Shutdown

```ruby
begin
  # Your application code
ensure
  # Always call flush to send events before exit
  amplitude&.flush
end
```

## Running Without Amplitude

The app works fine without Amplitude configured - it simply won't track analytics. You'll see a warning message but the app continues to function normally.

## Learn More

- [Amplitude Documentation](https://amplitude.com/docs)
- [Amplitude Ruby SDK](https://amplitude.com/docs/sdks/analytics/ruby)

---

## .env.example

```example
# Amplitude Configuration
AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## Gemfile

```
source 'https://rubygems.org'

gem 'amplitude-analytics', '~> 1.0'
gem 'dotenv', '~> 3.0'

```

---

## todo.rb

```rb
#!/usr/bin/env ruby
# frozen_string_literal: true

# Simple CLI Todo App with Amplitude Analytics
#
# A minimal plain Ruby CLI application demonstrating Amplitude integration
# for non-framework Ruby projects (CLIs, scripts, data pipelines, etc.).

require 'json'
require 'securerandom'
require 'time'
require 'dotenv/load'
require 'amplitude-analytics'

# Data file location
DATA_FILE = File.join(Dir.home, '.todo_app.json')

def initialize_amplitude
  # Initialize Amplitude with constructor-based API.
  # Returns Amplitude client or nil if API key not configured.
  api_key = ENV['AMPLITUDE_API_KEY']

  unless api_key
    puts 'WARNING: Amplitude not configured (AMPLITUDE_API_KEY not set)'
    puts '         App will work but analytics won\'t be tracked'
    return nil
  end

  Amplitude::Client.new(api_key)
end

def get_user_id
  # Get or create a user ID for this installation.
  # Uses a UUID stored in the data file to represent this user.
  if File.exist?(DATA_FILE)
    data = JSON.parse(File.read(DATA_FILE))
    return data['user_id'] if data['user_id']
  end

  "user_#{SecureRandom.hex(4)}"
end

def load_todos
  # Load todos from disk.
  return { 'user_id' => get_user_id, 'todos' => [] } unless File.exist?(DATA_FILE)

  JSON.parse(File.read(DATA_FILE))
end

def save_todos(data)
  # Save todos to disk.
  File.write(DATA_FILE, JSON.pretty_generate(data))
end

def track_event(amplitude, event_name, properties = {})
  # Track an event with Amplitude.
  return unless amplitude

  event = Amplitude::BaseEvent.new(
    event_type: event_name,
    user_id: get_user_id,
    event_properties: properties
  )
  amplitude.track(event)
end

def cmd_add(text, amplitude)
  # Add a new todo item.
  data = load_todos

  todo = {
    'id' => data['todos'].length + 1,
    'text' => text,
    'completed' => false,
    'created_at' => Time.now.iso8601
  }

  data['todos'] << todo
  save_todos(data)

  puts "Added todo ##{todo['id']}: #{todo['text']}"

  track_event(amplitude, 'Todo Added', {
    'todo_id' => todo['id'],
    'todo_length' => todo['text'].length,
    'total_todos' => data['todos'].length
  })
end

def cmd_list(amplitude)
  # List all todos.
  data = load_todos

  if data['todos'].empty?
    puts "No todos yet! Add one with: ruby todo.rb add 'Your task'"
    return
  end

  puts "\nYour Todos (#{data['todos'].length} total):\n\n"

  data['todos'].each do |todo|
    status = todo['completed'] ? 'X' : ' '
    puts "  [#{status}] ##{todo['id']}: #{todo['text']}"
  end

  puts

  track_event(amplitude, 'Todos Viewed', {
    'total_todos' => data['todos'].length,
    'completed_todos' => data['todos'].count { |t| t['completed'] }
  })
end

def cmd_complete(id, amplitude)
  # Mark a todo as completed.
  data = load_todos

  todo = data['todos'].find { |t| t['id'] == id }

  unless todo
    puts "ERROR: Todo ##{id} not found"
    return
  end

  if todo['completed']
    puts "Todo ##{id} is already completed"
    return
  end

  todo['completed'] = true
  todo['completed_at'] = Time.now.iso8601
  save_todos(data)

  puts "Completed todo ##{todo['id']}: #{todo['text']}"

  time_to_complete = (Time.parse(todo['completed_at']) - Time.parse(todo['created_at'])) / 3600.0

  track_event(amplitude, 'Todo Completed', {
    'todo_id' => todo['id'],
    'time_to_complete_hours' => time_to_complete
  })
end

def cmd_delete(id, amplitude)
  # Delete a todo.
  data = load_todos

  todo = data['todos'].find { |t| t['id'] == id }

  unless todo
    puts "ERROR: Todo ##{id} not found"
    return
  end

  data['todos'].delete(todo)
  save_todos(data)

  puts "Deleted todo ##{id}"

  track_event(amplitude, 'Todo Deleted', {
    'todo_id' => todo['id'],
    'was_completed' => todo['completed']
  })
end

def cmd_stats(amplitude)
  # Show usage statistics.
  data = load_todos

  total = data['todos'].length
  completed = data['todos'].count { |t| t['completed'] }
  pending = total - completed

  puts "\nStats:\n\n"
  puts "  Total todos:     #{total}"
  puts "  Completed:       #{completed}"
  puts "  Pending:         #{pending}"
  puts "  Completion rate: #{total > 0 ? format('%.1f', completed.to_f / total * 100) : '0.0'}%"
  puts

  track_event(amplitude, 'Stats Viewed', {
    'total_todos' => total,
    'completed_todos' => completed,
    'pending_todos' => pending
  })
end

def print_usage
  puts <<~USAGE
    Simple todo app with Amplitude analytics

    Usage:
      ruby todo.rb add "Todo text"    Add a new todo
      ruby todo.rb list               List all todos
      ruby todo.rb complete <id>      Mark todo as completed
      ruby todo.rb delete <id>        Delete a todo
      ruby todo.rb stats              Show statistics
  USAGE
end

# Main entry point
amplitude = nil

begin
  amplitude = initialize_amplitude

  command = ARGV[0]

  unless command
    print_usage
    exit 0
  end

  case command
  when 'add'
    text = ARGV[1]
    unless text
      puts 'ERROR: Please provide todo text'
      puts 'Usage: ruby todo.rb add "Your task"'
      exit 1
    end
    cmd_add(text, amplitude)
  when 'list'
    cmd_list(amplitude)
  when 'complete'
    id = ARGV[1]&.to_i
    unless id && id > 0
      puts 'ERROR: Please provide a valid todo ID'
      puts 'Usage: ruby todo.rb complete <id>'
      exit 1
    end
    cmd_complete(id, amplitude)
  when 'delete'
    id = ARGV[1]&.to_i
    unless id && id > 0
      puts 'ERROR: Please provide a valid todo ID'
      puts 'Usage: ruby todo.rb delete <id>'
      exit 1
    end
    cmd_delete(id, amplitude)
  when 'stats'
    cmd_stats(amplitude)
  else
    puts "ERROR: Unknown command '#{command}'"
    print_usage
    exit 1
  end
rescue StandardError => e
  puts "ERROR: #{e.message}"
  exit 1
ensure
  # IMPORTANT: Always flush Amplitude to send events before exit
  amplitude&.flush
end

```

---

