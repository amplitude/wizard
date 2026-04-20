# Amplitude Ruby on Rails Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/ruby-on-rails

---

## README.md

# Amplitude Ruby on Rails example

This is a [Ruby on Rails](https://rubyonrails.org) example demonstrating Amplitude integration with product analytics, user identification, and event tracking via the `amplitude-analytics` gem.

## Features

- **Product analytics**: Track user events and behaviors with `amplitude_track`
- **User identification**: Associate events with authenticated users via `amplitude.identify`
- **Frontend tracking**: Amplitude Browser SDK captures pageviews alongside backend events

## Getting started

### 1. Install dependencies

```bash
bundle install
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and add your Amplitude API key
```

Get your Amplitude API key from your [Amplitude project settings](https://app.amplitude.com).

### 3. Setup database

```bash
bin/rails db:create db:migrate db:seed
```

### 4. Run the development server

```bash
bin/rails server
```

Open [http://localhost:3000](http://localhost:3000) with your browser. Login with `admin@example.com` / `admin`.

## Project structure

```
ruby-on-rails/
├── config/
│   ├── routes.rb                        # URL routing
│   └── initializers/
│       └── amplitude.rb                 # Amplitude configuration
├── app/
│   ├── controllers/
│   │   ├── application_controller.rb    # Base controller with amplitude helpers
│   │   ├── sessions_controller.rb       # Login/logout with Amplitude identify
│   │   ├── registrations_controller.rb  # Signup with Amplitude identify
│   │   ├── dashboard_controller.rb      # Dashboard with event tracking
│   │   ├── burritos_controller.rb       # Custom event tracking
│   │   └── profiles_controller.rb       # Page view tracking
│   ├── models/
│   │   └── user.rb                     # amplitude_user_id + amplitude_user_properties
│   └── views/
│       ├── layouts/application.html.erb # Base layout with Amplitude Browser SDK
│       ├── sessions/new.html.erb        # Login page
│       ├── registrations/new.html.erb   # Signup page
│       ├── dashboard/show.html.erb      # Dashboard
│       ├── burritos/show.html.erb       # Event tracking demo
│       └── profiles/show.html.erb       # User profile page
├── db/
│   ├── migrate/                         # Database migrations
│   └── seeds.rb                         # Default admin user
├── .env.example                         # Environment variable template
├── Gemfile                              # Ruby dependencies
└── README.md                            # This file
```

## Key integration points

### Amplitude initialization (config/initializers/amplitude.rb)

```ruby
require 'amplitude-analytics'

amplitude = Amplitude::Client.instance
amplitude.api_key = ENV.fetch('AMPLITUDE_API_KEY', nil)
```

### User model (app/models/user.rb)

```ruby
class User < ApplicationRecord
  has_secure_password

  def amplitude_user_id
    email
  end

  def amplitude_user_properties
    { email: email, is_staff: is_staff, date_joined: created_at&.iso8601 }
  end
end
```

### Base controller helpers (app/controllers/application_controller.rb)

```ruby
def amplitude_track(event_name, user_id:, properties: {})
  event = Amplitude::BaseEvent.new(
    event_type: event_name,
    user_id: user_id,
    event_properties: properties
  )
  amplitude.track(event)
end
```

### User identification (app/controllers/sessions_controller.rb)

```ruby
identify_event = Amplitude::IdentifyEvent.new(
  user_id: user.amplitude_user_id,
  user_properties: user.amplitude_user_properties
)
amplitude.identify(identify_event)

amplitude_track('User Logged In',
  user_id: user.amplitude_user_id,
  properties: { login_method: 'email' }
)
```

### Event tracking (app/controllers/burritos_controller.rb)

```ruby
amplitude_track('Burrito Considered',
  user_id: user.amplitude_user_id,
  properties: { total_considerations: count }
)
```

## Learn more

- [Amplitude Documentation](https://amplitude.com/docs)
- [Amplitude Ruby SDK](https://amplitude.com/docs/sdks/analytics/ruby)
- [Ruby on Rails documentation](https://guides.rubyonrails.org/)

---

## .env.example

```example
# Amplitude Configuration
AMPLITUDE_API_KEY=your_amplitude_api_key_here

```

---

## app/controllers/application_controller.rb

```rb
class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception

  private

  def current_user
    @current_user ||= User.find_by(id: session[:user_id]) if session[:user_id]
  end
  helper_method :current_user

  def require_login
    unless current_user
      redirect_to login_path
    end
  end

  def amplitude
    @amplitude ||= Rails.application.config.amplitude
  end

  def amplitude_track(event_name, user_id:, properties: {})
    event = Amplitude::BaseEvent.new(
      event_type: event_name,
      user_id: user_id,
      event_properties: properties
    )
    amplitude.track(event)
  end
end

```

---

## app/controllers/burritos_controller.rb

```rb
class BurritosController < ApplicationController
  before_action :require_login

  def show
    @burrito_count = session[:burrito_count] || 0
  end

  def consider
    count = (session[:burrito_count] || 0) + 1
    session[:burrito_count] = count

    user = current_user

    # Amplitude: Track custom event
    amplitude_track('Burrito Considered',
      user_id: user.amplitude_user_id,
      properties: { total_considerations: count }
    )

    render json: { success: true, count: count }
  end
end

```

---

## app/controllers/dashboard_controller.rb

```rb
class DashboardController < ApplicationController
  before_action :require_login

  def show
    user = current_user

    # Amplitude: Track dashboard view
    amplitude_track('Dashboard Viewed',
      user_id: user.amplitude_user_id,
      properties: { is_staff: user.is_staff }
    )

    # TODO: Use Amplitude Experiment for feature flags
    @show_new_feature = false
  end
end

```

---

## app/controllers/errors_controller.rb

```rb
class ErrorsController < ApplicationController
  before_action :require_login

  def test
    render json: { success: true, message: 'Error tracking not available with Amplitude' }
  end
end

```

---

## app/controllers/profiles_controller.rb

```rb
class ProfilesController < ApplicationController
  before_action :require_login

  def show
    # Amplitude: Track profile view
    amplitude_track('Profile Viewed', user_id: current_user.amplitude_user_id)
  end
end

```

---

## app/controllers/registrations_controller.rb

```rb
class RegistrationsController < ApplicationController
  def new
    redirect_to dashboard_path if current_user
  end

  def create
    user = User.new(
      email: params[:email],
      password: params[:password],
      password_confirmation: params[:password_confirmation]
    )

    if user.save
      session[:user_id] = user.id

      # Amplitude: Identify the new user and capture signup event
      identify_event = Amplitude::IdentifyEvent.new(
        user_id: user.amplitude_user_id,
        user_properties: user.amplitude_user_properties
      )
      amplitude.identify(identify_event)

      amplitude_track('User Signed Up',
        user_id: user.amplitude_user_id,
        properties: { signup_method: 'form' }
      )

      redirect_to dashboard_path
    else
      flash[:error] = user.errors.full_messages.join(', ')
      render :new, status: :unprocessable_entity
    end
  end
end

```

---

## app/controllers/sessions_controller.rb

```rb
class SessionsController < ApplicationController
  def new
    redirect_to dashboard_path if current_user
  end

  def create
    user = User.find_by(email: params[:email])

    if user&.authenticate(params[:password])
      session[:user_id] = user.id

      # Amplitude: Identify the user and capture login event
      identify_event = Amplitude::IdentifyEvent.new(
        user_id: user.amplitude_user_id,
        user_properties: user.amplitude_user_properties
      )
      amplitude.identify(identify_event)

      amplitude_track('User Logged In',
        user_id: user.amplitude_user_id,
        properties: { login_method: 'email' }
      )

      redirect_to dashboard_path
    else
      flash[:error] = 'Invalid email or password'
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    if current_user
      # Amplitude: Track logout before session ends
      amplitude_track('User Logged Out', user_id: current_user.amplitude_user_id)
    end

    session.delete(:user_id)
    redirect_to login_path
  end
end

```

---

## app/jobs/application_job.rb

```rb
class ApplicationJob < ActiveJob::Base
end

```

---

## app/jobs/example_job.rb

```rb
class ExampleJob < ApplicationJob
  queue_as :default

  def perform(user_id, should_fail: false)
    if should_fail
      raise StandardError, 'Example job failure'
    end

    Rails.logger.info "ExampleJob completed successfully for #{user_id}"
  end
end

```

---

## app/models/application_record.rb

```rb
class ApplicationRecord < ActiveRecord::Base
  primary_abstract_class
end

```

---

## app/models/user.rb

```rb
class User < ApplicationRecord
  has_secure_password

  validates :email, presence: true, uniqueness: true

  # Helper used by controllers when calling Amplitude to set the user ID.
  def amplitude_user_id
    email
  end

  # Helper used by controllers when calling Amplitude.identify to set user properties.
  def amplitude_user_properties
    {
      email: email,
      is_staff: is_staff,
      date_joined: created_at&.iso8601
    }
  end
end

```

---

## app/views/burritos/show.html.erb

```erb
<% content_for(:title) { 'Burrito - Amplitude Rails example' } %>

<div class="card">
    <h1>Burrito consideration tracker</h1>
    <p>This page demonstrates custom event tracking with Amplitude.</p>
</div>

<div class="card" style="text-align: center;">
    <h2>Times considered</h2>
    <div class="count" id="burrito-count"><%= @burrito_count %></div>
    <button onclick="considerBurrito()" style="font-size: 18px; padding: 15px 30px;">
        Consider a burrito
    </button>
</div>

<div class="card">
    <h3>How event tracking works</h3>
    <p>Each time you click the button, a <code>Burrito Considered</code> event is sent to Amplitude:</p>
    <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto; margin-top: 15px;"><code>amplitude.track(Amplitude::BaseEvent.new(
  event_type: 'Burrito Considered',
  user_id: user.amplitude_user_id,
  event_properties: { total_considerations: count }
))</code></pre>
</div>

<% content_for :scripts do %>
<script>
async function considerBurrito() {
    try {
        const response = await fetch('/api/burrito/consider', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('burrito-count').textContent = data.count;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}
</script>
<% end %>

```

---

## app/views/dashboard/show.html.erb

```erb
<% content_for(:title) { 'Dashboard - Amplitude Rails example' } %>

<div class="card">
    <h1>Dashboard</h1>
    <p>Welcome back, <strong><%= current_user.email %></strong>!</p>
</div>

<div class="card">
    <h2>Feature flags</h2>
    <p>Feature flags allow you to control feature rollouts and run A/B tests.</p>

    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-top: 15px;">
        <p>
            <!-- TODO: Use Amplitude Experiment for feature flags -->
            Feature flags are available via <a href="https://www.docs.developers.amplitude.com/experiment/" target="_blank">Amplitude Experiment</a>.
        </p>
    </div>
</div>

```

---

## app/views/layouts/application.html.erb

```erb
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><%= content_for?(:title) ? yield(:title) : 'Amplitude Rails example' %></title>
    <%= csrf_meta_tags %>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            background-color: #f5f5f5;
            color: #333;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        nav {
            background: #1d4ed8;
            padding: 15px 20px;
            margin-bottom: 30px;
        }
        nav a {
            color: white;
            text-decoration: none;
            margin-right: 20px;
        }
        nav a:hover {
            text-decoration: underline;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1, h2, h3 {
            margin-bottom: 15px;
            color: #1d4ed8;
        }
        button, .btn {
            background: #1d4ed8;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            display: inline-block;
            text-decoration: none;
        }
        button:hover, .btn:hover {
            background: #1e40af;
        }
        button.danger {
            background: #dc2626;
        }
        button.danger:hover {
            background: #b91c1c;
        }
        input {
            width: 100%;
            padding: 10px;
            margin-bottom: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        .flash {
            padding: 10px 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .flash.error {
            background: #fee2e2;
            color: #dc2626;
        }
        .flash.success {
            background: #d1fae5;
            color: #059669;
        }
        .feature-flag {
            background: #fef3c7;
            border: 2px dashed #f59e0b;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        code {
            background: #f3f4f6;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }
        .count {
            font-size: 48px;
            font-weight: bold;
            color: #1d4ed8;
            text-align: center;
            padding: 20px;
        }
    </style>

    <!-- Amplitude frontend tracking -->
    <script type="text/javascript">
      !function(){"use strict";!function(e,t){var r=e.amplitude||{_q:[],_iq:{}};if(r.invoked)e.console&&console.error&&console.error("Amplitude snippet has been loaded.");else{r.invoked=!0;var n=t.createElement("script");n.type="text/javascript";n.integrity="sha384-x0ik2D45ZDEEEpYpEuDpmj05fY91P7hkm2LP+uH0/kA8R0mds/cYnMkEZquh9Kd";n.crossOrigin="anonymous";n.async=!0;n.src="https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz";n.onload=function(){e.amplitude.runQueuedFunctions||console.log("[Amplitude] Error: could not load SDK")};var s=t.getElementsByTagName("script")[0];function v(e,t){e.prototype[t]=function(){return this._q.push({name:t,args:Array.prototype.slice.call(arguments,0)}),this}}s.parentNode.insertBefore(n,s);for(var o=function(){return this._q=[],this},i=["add","append","clearAll","prepend","set","setOnce","unset","preInsert","postInsert","remove","getUserProperties"],a=0;a<i.length;a++)v(o,i[a]);r.Identify=o;for(var c=function(){return this._q=[],this},l=["getEventProperties","setProductId","setQuantity","setPrice","setRevenue","setRevenueType","setEventProperties"],u=0;u<l.length;u++)v(c,l[u]);r.Revenue=c;var p=["getDeviceId","setDeviceId","getSessionId","setSessionId","getUserId","setUserId","setOptOut","setTransport","reset","extendSession"],d=["init","add","remove","track","logEvent","identify","groupIdentify","setGroup","revenue","flush"];function f(e){function t(t,r){e[t]=function(){var n={promise:new Promise((r=>{e._q.push({name:t,args:Array.prototype.slice.call(arguments,0),resolve:r})}))};if(r)for(var s=0;s<r.length;s++)n[r[s]]=n.promise[r[s]].bind(n.promise);return n}}for(var r=0;r<p.length;r++)e[p[r]]=function(){return{promise:new Promise((t=>{e._q.push({name:p[r],args:Array.prototype.slice.call(arguments,0),resolve:t})}))};};for(var n=0;n<d.length;n++)t(d[n],["then","catch","finally"])}f(r),f(r.Identify.prototype),f(r.Revenue.prototype),e.amplitude=r}}(window,document)}();
      amplitude.init('<%= ENV["AMPLITUDE_API_KEY"] %>');
    </script>
</head>
<body>
    <% if current_user %>
    <nav style="display: flex; align-items: center;">
        <a href="<%= dashboard_path %>">Dashboard</a>
        <a href="<%= burrito_path %>">Burrito</a>
        <a href="<%= profile_path %>">Profile</a>
        <%= button_to 'Logout (' + current_user.email + ')', logout_path, method: :delete, form: { style: 'margin-left: auto;' }, style: 'background: transparent; border: none; color: white; cursor: pointer; font-size: inherit; padding: 0;' %>
    </nav>
    <% end %>

    <div class="container">
        <% if flash[:error] %>
        <div class="flash error"><%= flash[:error] %></div>
        <% end %>
        <% if flash[:notice] %>
        <div class="flash success"><%= flash[:notice] %></div>
        <% end %>

        <%= yield %>
    </div>

    <%= yield :scripts %>
</body>
</html>

```

---

## app/views/profiles/show.html.erb

```erb
<% content_for(:title) { 'Profile - Amplitude Rails example' } %>

<div class="card">
    <h1>Profile</h1>
    <p>Your account information.</p>
</div>

<div class="card">
    <h2>User information</h2>
    <table style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><%= current_user.email %></td>
        </tr>
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Date Joined:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><%= current_user.created_at %></td>
        </tr>
        <tr>
            <td style="padding: 10px;"><strong>Staff Status:</strong></td>
            <td style="padding: 10px;"><%= current_user.is_staff ? 'Yes' : 'No' %></td>
        </tr>
    </table>
</div>

```

---

## app/views/registrations/new.html.erb

```erb
<% content_for(:title) { 'Sign Up - Amplitude Rails example' } %>

<div class="card">
    <h1>Sign Up</h1>
    <p>Create an account to see Amplitude analytics in action.</p>

    <form action="<%= signup_path %>" method="post" style="margin-top: 20px;">
        <%= hidden_field_tag :authenticity_token, form_authenticity_token %>
        <input type="email" name="email" placeholder="Email" required>
        <input type="password" name="password" placeholder="Password" required>
        <input type="password" name="password_confirmation" placeholder="Confirm Password" required>
        <button type="submit">Sign Up</button>
    </form>

    <p style="margin-top: 15px; color: #666; font-size: 14px;">
        Already have an account? <a href="<%= login_path %>">Login</a>
    </p>
</div>

```

---

## app/views/sessions/new.html.erb

```erb
<% content_for(:title) { 'Login - Amplitude Rails example' } %>

<div class="card">
    <h1>Amplitude Rails example</h1>
    <p>Welcome! This example demonstrates Amplitude integration with Ruby on Rails for product analytics and user identification.</p>
</div>

<div class="card">
    <h2>Login</h2>
    <p>Login to see Amplitude analytics in action.</p>

    <form action="<%= login_path %>" method="post" style="margin-top: 20px;">
        <%= hidden_field_tag :authenticity_token, form_authenticity_token %>
        <input type="email" name="email" placeholder="Email" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
    </form>

    <p style="margin-top: 15px; color: #666; font-size: 14px;">
        Don't have an account? <a href="<%= signup_path %>">Sign up</a><br>
        Tip: Run <code>bin/rails db:seed</code> to create admin@example.com / admin
    </p>
</div>

<div class="card">
    <h3>What this example demonstrates</h3>
    <ul style="padding-left: 20px;">
        <li><strong>User identification</strong> — Users are identified with <code>Amplitude::IdentifyEvent</code> on login</li>
        <li><strong>Event tracking</strong> — Custom events captured with <code>amplitude.track</code></li>
        <li><strong>Frontend tracking</strong> — Amplitude Browser SDK captures pageviews alongside backend events</li>
    </ul>
</div>

```

---

## bin/rails

```
#!/usr/bin/env ruby
APP_PATH = File.expand_path('../config/application', __dir__)
require_relative '../config/boot'
require 'rails/commands'

```

---

## config.ru

```ru
require_relative 'config/environment'
run Rails.application

```

---

## config/application.rb

```rb
require_relative 'boot'
require 'rails/all'

Bundler.require(*Rails.groups)

module AmplitudeExample
  class Application < Rails::Application
    config.load_defaults 7.1

    # Use SQLite for all stores
    config.active_job.queue_adapter = :async
  end
end

```

---

## config/boot.rb

```rb
ENV['BUNDLE_GEMFILE'] ||= File.expand_path('../Gemfile', __dir__)

require 'bundler/setup'

```

---

## config/environment.rb

```rb
require_relative 'application'
Rails.application.initialize!

```

---

## config/environments/development.rb

```rb
require 'active_support/core_ext/integer/time'

Rails.application.configure do
  config.enable_reloading = true
  config.eager_load = false
  config.consider_all_requests_local = true
  config.server_timing = true

  # Secret key for development (not used in production)
  config.secret_key_base = 'dev-secret-key-for-amplitude-example-only'

  config.action_controller.perform_caching = false
  config.cache_store = :memory_store

  config.active_support.deprecation = :log
  config.active_support.disallowed_deprecation = :raise
  config.active_support.disallowed_deprecation_warnings = []

  config.active_record.migration_error = :page_load
  config.active_record.verbose_query_logs = true
end

```

---

## config/initializers/amplitude.rb

```rb
# Amplitude configuration
#
# Initializes the Amplitude client with the API key from environment variables.
# The client is stored in Rails.application.config.amplitude for use throughout the app.
require 'amplitude-analytics'

api_key = ENV.fetch('AMPLITUDE_API_KEY', nil)

if api_key
  Rails.application.config.amplitude = Amplitude::Client.new(api_key)
end


```

---

## config/routes.rb

```rb
Rails.application.routes.draw do
  # Auth
  get 'login', to: 'sessions#new'
  post 'login', to: 'sessions#create'
  delete 'logout', to: 'sessions#destroy'

  get 'signup', to: 'registrations#new'
  post 'signup', to: 'registrations#create'

  # App
  get 'dashboard', to: 'dashboard#show'
  get 'burrito', to: 'burritos#show'
  post 'api/burrito/consider', to: 'burritos#consider'
  get 'profile', to: 'profiles#show'

  # Error tracking demos
  post 'api/test-error', to: 'errors#test'
  post 'api/test-rails-error', to: 'errors#test_rails_error'

  # Background job demo
  post 'api/test-job', to: 'dashboard#enqueue_test_job'

  root 'sessions#new'
end

```

---

## db/migrate/20240101000000_create_users.rb

```rb
class CreateUsers < ActiveRecord::Migration[7.1]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :password_digest, null: false
      t.boolean :is_staff, default: false

      t.timestamps
    end

    add_index :users, :email, unique: true
  end
end

```

---

## db/schema.rb

```rb
# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[7.2].define(version: 2024_01_01_000000) do
  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "password_digest", null: false
    t.boolean "is_staff", default: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end
end

```

---

## db/seeds.rb

```rb
# Create a default admin user for testing
User.find_or_create_by!(email: 'admin@example.com') do |user|
  user.password = 'admin'
  user.password_confirmation = 'admin'
  user.is_staff = true
end

puts 'Seed data created: admin@example.com / admin'

```

---

## Gemfile

```
source 'https://rubygems.org'

gem 'rails', '~> 7.1'
gem 'sqlite3', '~> 1.7'
gem 'puma', '~> 6.0'
gem 'bcrypt', '~> 3.1'
gem 'dotenv-rails', '~> 3.0'

# Amplitude
gem 'amplitude-analytics', '~> 1.0'

```

---

## Rakefile

```
require_relative 'config/application'
Rails.application.load_tasks

```

---

