# Amplitude Django Example Project

Repository: https://github.com/amplitude/context-hub
Path: basics/django

---

## README.md

# Amplitude Django example

This is a [Django](https://djangoproject.com) example demonstrating Amplitude integration with product analytics, error tracking, feature flags, and user identification.

## Features

- **Product analytics**: Track user events and behaviors
- **Error tracking**: Capture and track exceptions automatically
- **User identification**: Associate events with authenticated users via context
- **Feature flags**: Control feature rollouts with Amplitude feature flags
- **Server-side tracking**: All tracking happens server-side with the Python SDK
- **Context middleware**: Automatic session and user context extraction

## Getting started

### 1. Install dependencies

```bash
pip install amplitude
```

### 2. Configure environment variables

Create a `.env` file in the root directory:

```bash
AMPLITUDE_API_KEY=your_amplitude_project_token
AMPLITUDE_HOST=https://us.i.amplitude.com
```

Get your Amplitude project token from your [Amplitude project settings](https://app.amplitude.com/project/settings).

### 3. Run migrations

```bash
python manage.py migrate
```

### 4. Run the development server

```bash
python manage.py runserver
```

Open [http://localhost:8000](http://localhost:8000) with your browser to see the app.

## Project structure

```
django/
├── manage.py                    # Django management script
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment variable template
├── .gitignore
├── amplitude_example/
│   ├── __init__.py
│   ├── settings.py              # Django settings with Amplitude config
│   ├── urls.py                  # URL routing
│   ├── wsgi.py                  # WSGI application
│   └── asgi.py                  # ASGI application
└── core/
    ├── __init__.py
    ├── apps.py                  # AppConfig with Amplitude initialization
    ├── views.py                 # Views with event tracking examples
    ├── urls.py                  # App URL patterns
    └── templates/
        └── core/
            ├── base.html        # Base template
            ├── home.html        # Home/login page
            ├── burrito.html     # Burrito page with event tracking
            ├── dashboard.html   # Dashboard with feature flag example
            └── profile.html     # Profile page
```

## Key integration points

### Amplitude initialization (core/apps.py)

```python
import amplitude
from django.conf import settings

class CoreConfig(AppConfig):
    name = 'core'

    def ready(self):
        amplitude.api_key = settings.AMPLITUDE_API_KEY
        amplitude.host = settings.AMPLITUDE_HOST
```

### Django settings configuration (settings.py)

```python
import os

# Amplitude configuration
AMPLITUDE_API_KEY = os.environ.get('AMPLITUDE_API_KEY', '<ph_project_token>')
AMPLITUDE_HOST = os.environ.get('AMPLITUDE_HOST', 'https://us.i.amplitude.com')

MIDDLEWARE = [
    # ... other middleware
    'amplitude.integrations.django.PosthogContextMiddleware',
]
```

### Built-in context middleware

The Amplitude SDK includes a Django middleware that automatically wraps all requests with a context. It extracts session and user information from request headers and tags all events captured during the request.

The middleware automatically extracts:

- **Session ID** from the `X-POSTHOG-SESSION-ID` header
- **Distinct ID** from the `X-POSTHOG-DISTINCT-ID` header
- **Current URL** as `$current_url`
- **Request method** as `$request_method`

### User identification (core/views.py)

```python
import amplitude

def login_view(request):
    # ... authentication logic
    if user:
        with amplitude.new_context():
            amplitude.identify_context(str(user.id))
            amplitude.tag('email', user.email)
            amplitude.tag('username', user.username)
            amplitude.capture('user_logged_in', properties={
                'login_method': 'email',
            })
```

### Event tracking (core/views.py)

```python
import amplitude

def consider_burrito(request):
    user_id = str(request.user.id) if request.user.is_authenticated else 'anonymous'

    with amplitude.new_context():
        amplitude.identify_context(user_id)
        amplitude.capture('burrito_considered', properties={
            'total_considerations': request.session.get('burrito_count', 0),
        })
```

### Feature flags (core/views.py)

```python
import amplitude

def dashboard_view(request):
    user_id = str(request.user.id) if request.user.is_authenticated else 'anonymous'

    show_new_feature = amplitude.feature_enabled(
        'new-dashboard-feature',
        distinct_id=user_id
    )

    return render(request, 'core/dashboard.html', {
        'show_new_feature': show_new_feature
    })
```

### Error tracking (core/views.py)

Capture exceptions manually using `capture_exception()`:

```python
import amplitude

def profile_view(request):
    try:
        risky_operation()
    except Exception as e:
        amplitude.capture_exception(e)
```

## Frontend integration (optional)

If you're using Amplitude's JavaScript SDK on the frontend, enable tracing headers to connect frontend sessions with backend events:

```javascript
amplitude.init('<ph_project_token>', {
    api_host: 'https://us.i.amplitude.com',
    __add_tracing_headers: ['your-backend-domain.com'],
})
```

This automatically adds `X-POSTHOG-SESSION-ID` and `X-POSTHOG-DISTINCT-ID` headers to requests, which the Django middleware extracts to maintain context.

## Learn more

- [Amplitude Django integration](https://amplitude.com/docs/libraries/django)
- [Amplitude Python SDK](https://amplitude.com/docs/libraries/python)
- [Amplitude documentation](https://amplitude.com/docs)
- [Django documentation](https://docs.djangoproject.com/)

---

## .env.example

```example
AMPLITUDE_API_KEY=
DJANGO_SECRET_KEY=your-secret-key-here
DEBUG=True

```

---

## core/__init__.py

```py
# Core app for Amplitude Django example

```

---

## core/apps.py

```py
"""
Django AppConfig for the Amplitude example application.

This ensures the app is configured correctly when Django starts.
"""

from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

```

---

## core/templates/core/base.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}Amplitude Django example{% endblock %}</title>
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
        .messages {
            margin-bottom: 20px;
        }
        .message {
            padding: 10px 15px;
            border-radius: 5px;
            margin-bottom: 10px;
        }
        .message.error {
            background: #fee2e2;
            color: #dc2626;
        }
        .message.success {
            background: #d1fae5;
            color: #059669;
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
</head>
<body>
    {% if user.is_authenticated %}
    <nav>
        <a href="{% url 'dashboard' %}">Dashboard</a>
        <a href="{% url 'burrito' %}">Burrito</a>
        <a href="{% url 'profile' %}">Profile</a>
        <a href="{% url 'logout' %}" style="float: right;">Logout ({{ user.username }})</a>
    </nav>
    {% endif %}

    <div class="container">
        {% if messages %}
        <div class="messages">
            {% for message in messages %}
            <div class="message {{ message.tags }}">{{ message }}</div>
            {% endfor %}
        </div>
        {% endif %}

        {% block content %}{% endblock %}
    </div>

    {% block scripts %}{% endblock %}
</body>
</html>

```

---

## core/templates/core/burrito.html

```html
{% extends 'core/base.html' %}

{% block title %}Burrito - Amplitude Django example{% endblock %}

{% block content %}
<div class="card">
    <h1>Burrito consideration tracker</h1>
    <p>This page demonstrates custom event tracking with Amplitude.</p>
</div>

<div class="card" style="text-align: center;">
    <h2>Times considered</h2>
    <div class="count" id="burrito-count">{{ burrito_count }}</div>
    <button onclick="considerBurrito()" style="font-size: 18px; padding: 15px 30px;">
        Consider a burrito
    </button>
</div>

<div class="card">
    <h3>How event tracking works</h3>
    <p>Each time you click the button, a <code>burrito_considered</code> event is sent to Amplitude:</p>
    <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto; margin-top: 15px;"><code>from amplitude import Amplitude, BaseEvent

client = Amplitude(api_key)
client.track(BaseEvent(
    event_type='burrito_considered',
    user_id=user_id,
    event_properties={'total_considerations': count},
))</code></pre>
</div>
{% endblock %}

{% block scripts %}
<script>
async function considerBurrito() {
    try {
        const response = await fetch('{% url "consider_burrito" %}', {
            method: 'POST',
            headers: {
                'X-CSRFToken': '{{ csrf_token }}',
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
{% endblock %}

```

---

## core/templates/core/dashboard.html

```html
{% extends 'core/base.html' %}

{% block title %}Dashboard - Amplitude Django example{% endblock %}

{% block content %}
<div class="card">
    <h1>Dashboard</h1>
    <p>Welcome back, <strong>{{ user.username }}</strong>!</p>
</div>

<div class="card">
    <h2>Analytics tracking</h2>
    <p>This page view is tracked as a <code>dashboard_viewed</code> event in Amplitude.</p>
    <p style="margin-top: 10px; color: #666; font-size: 14px;">
        Note: Feature flags are available via Amplitude Experiment (separate SDK).
    </p>
</div>

<div class="card">
    <h3>How event tracking works</h3>
    <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto;"><code>from amplitude import Amplitude, BaseEvent

client = Amplitude(api_key)
client.track(BaseEvent(
    event_type='dashboard_viewed',
    user_id=user_id,
    event_properties={'is_staff': user.is_staff},
))</code></pre>
</div>
{% endblock %}

```

---

## core/templates/core/home.html

```html
{% extends 'core/base.html' %}

{% block title %}Login - Amplitude Django example{% endblock %}

{% block content %}
<div class="card">
    <h1>Amplitude Django example</h1>
    <p>Welcome! This example demonstrates Amplitude integration with Django.</p>
</div>

<div class="card">
    <h2>Login</h2>
    <p>Login to see Amplitude analytics in action.</p>

    <form method="post" style="margin-top: 20px;">
        {% csrf_token %}
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
    </form>

    <p style="margin-top: 15px; color: #666; font-size: 14px;">
        Tip: Create a user with <code>python manage.py createsuperuser</code>
    </p>
</div>

<div class="card">
    <h3>What this example demonstrates</h3>
    <ul style="padding-left: 20px;">
        <li><strong>User identification</strong> - Users are identified with <code>client.identify()</code> on login</li>
        <li><strong>Event tracking</strong> - Custom events captured with <code>client.track()</code></li>
        <li><strong>Error tracking</strong> - Exceptions tracked as events</li>
    </ul>
</div>
{% endblock %}

```

---

## core/templates/core/profile.html

```html
{% extends 'core/base.html' %}

{% block title %}Profile - Amplitude Django example{% endblock %}

{% block content %}
<div class="card">
    <h1>Profile</h1>
    <p>This page demonstrates error tracking with Amplitude.</p>
</div>

<div class="card">
    <h2>User information</h2>
    <table style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Username:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">{{ user.username }}</td>
        </tr>
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">{{ user.email|default:"Not set" }}</td>
        </tr>
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Date Joined:</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">{{ user.date_joined }}</td>
        </tr>
        <tr>
            <td style="padding: 10px;"><strong>Staff Status:</strong></td>
            <td style="padding: 10px;">{{ user.is_staff|yesno:"Yes,No" }}</td>
        </tr>
    </table>
</div>

<div class="card">
    <h2>Error tracking demo</h2>
    <p>Click the buttons below to trigger different types of errors. These errors are tracked and sent to Amplitude.</p>

    <div style="margin-top: 20px;">
        <button class="danger" onclick="triggerError('value')">
            Trigger ValueError
        </button>
        <button class="danger" onclick="triggerError('key')" style="margin-left: 10px;">
            Trigger KeyError
        </button>
        <button class="danger" onclick="triggerError('generic')" style="margin-left: 10px;">
            Trigger Generic Error
        </button>
    </div>

    <div id="error-result" style="margin-top: 20px; display: none;"></div>
</div>

<div class="card">
    <h3>How error tracking works</h3>
    <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto;"><code>from amplitude import Amplitude, BaseEvent

client = Amplitude(api_key)
try:
    risky_operation()
except Exception as e:
    client.track(BaseEvent(
        event_type='error_triggered',
        user_id=user_id,
        event_properties={'error_message': str(e)},
    ))</code></pre>
</div>
{% endblock %}

{% block scripts %}
<script>
async function triggerError(errorType) {
    const resultDiv = document.getElementById('error-result');

    try {
        const response = await fetch('{% url "trigger_error" %}', {
            method: 'POST',
            headers: {
                'X-CSRFToken': '{{ csrf_token }}',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'error_type=' + errorType,
        });

        const data = await response.json();

        resultDiv.style.display = 'block';
        if (data.success) {
            resultDiv.innerHTML = '<div class="message success">No error occurred</div>';
        } else {
            resultDiv.innerHTML = `
                <div class="message error">
                    <strong>Error captured:</strong> ${data.error}<br>
                    <small>${data.message}</small>
                </div>
            `;
        }
    } catch (error) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<div class="message error">Request failed: ${error}</div>`;
    }
}
</script>
{% endblock %}

```

---

## core/urls.py

```py
"""
URL configuration for the core app.

This module defines all the URL patterns for the Amplitude example views.
"""

from django.urls import path
from . import views

urlpatterns = [
    # Home login page
    path('', views.home_view, name='home'),

    # Authentication
    path('logout/', views.logout_view, name='logout'),

    # Dashboard
    path('dashboard/', views.dashboard_view, name='dashboard'),

    # Burrito example for event tracking
    path('burrito/', views.burrito_view, name='burrito'),
    path('api/burrito/consider/', views.consider_burrito_view, name='consider_burrito'),

    # Profile with error tracking
    path('profile/', views.profile_view, name='profile'),
    path('api/trigger-error/', views.trigger_error_view, name='trigger_error'),
]

```

---

## core/views.py

```py
"""Django views demonstrating Amplitude integration patterns"""

from amplitude import Amplitude, BaseEvent, Identify
from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.conf import settings


def get_amplitude_client():
    """Get the Amplitude client instance."""
    api_key = getattr(settings, 'AMPLITUDE_API_KEY', '')
    if not api_key:
        return None
    return Amplitude(api_key)


def home_view(request):
    """Home page with login functionality"""
    if request.user.is_authenticated:
        return redirect('dashboard')

    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)

            # Amplitude: Identify user and capture login event
            client = get_amplitude_client()
            if client:
                identify_obj = Identify()
                identify_obj.set('email', user.email)
                identify_obj.set('username', user.username)
                identify_obj.set('name', user.get_full_name() or user.username)
                identify_obj.set('is_staff', user.is_staff)
                identify_obj.set('date_joined', user.date_joined.isoformat())
                client.identify(identify_obj, {"user_id": str(user.id)})

                client.track(BaseEvent(
                    event_type='user_logged_in',
                    user_id=str(user.id),
                    event_properties={'login_method': 'email'},
                ))

            return redirect('dashboard')
        else:
            messages.error(request, 'Invalid username or password')

    return render(request, 'core/home.html')


def logout_view(request):
    """Logout the current user"""
    if request.user.is_authenticated:
        user_id = str(request.user.id)

        # Amplitude: Track logout before session ends
        client = get_amplitude_client()
        if client:
            client.track(BaseEvent(
                event_type='user_logged_out',
                user_id=user_id,
            ))

        logout(request)

    return redirect('home')


@login_required
def dashboard_view(request):
    """Dashboard page"""
    user_id = str(request.user.id)

    # Amplitude: Track dashboard view
    client = get_amplitude_client()
    if client:
        client.track(BaseEvent(
            event_type='dashboard_viewed',
            user_id=user_id,
            event_properties={'is_staff': request.user.is_staff},
        ))

    # TODO: Use Amplitude Experiment for feature flags
    # Feature flags are handled by Amplitude Experiment (separate SDK)
    context = {}

    return render(request, 'core/dashboard.html', context)


@login_required
def burrito_view(request):
    """Example page demonstrating event tracking"""
    count = request.session.get('burrito_count', 0)

    context = {
        'burrito_count': count,
    }

    return render(request, 'core/burrito.html', context)


@login_required
@require_POST
def consider_burrito_view(request):
    """API endpoint for tracking burrito considerations"""
    count = request.session.get('burrito_count', 0) + 1
    request.session['burrito_count'] = count

    user_id = str(request.user.id)

    # Amplitude: Track custom event
    client = get_amplitude_client()
    if client:
        client.track(BaseEvent(
            event_type='burrito_considered',
            user_id=user_id,
            event_properties={'total_considerations': count},
        ))

    return JsonResponse({
        'success': True,
        'count': count,
    })


@login_required
def profile_view(request):
    """Profile page"""
    user_id = str(request.user.id)

    # Amplitude: Track profile view
    client = get_amplitude_client()
    if client:
        client.track(BaseEvent(
            event_type='profile_viewed',
            user_id=user_id,
        ))

    context = {
        'user': request.user,
    }

    return render(request, 'core/profile.html', context)


@login_required
@require_POST
def trigger_error_view(request):
    """API endpoint that demonstrates error tracking"""
    try:
        error_type = request.POST.get('error_type', 'generic')

        if error_type == 'value':
            raise ValueError("Invalid value provided by user")
        elif error_type == 'key':
            data = {}
            _ = data['nonexistent_key']
        else:
            raise Exception("Something went wrong!")

    except Exception as e:
        # Amplitude: Track error event
        client = get_amplitude_client()
        if client:
            client.track(BaseEvent(
                event_type='error_triggered',
                user_id=str(request.user.id),
                event_properties={
                    'error_type': error_type,
                    'error_message': str(e),
                },
            ))

        return JsonResponse({
            'success': False,
            'error': str(e),
            'message': 'Error has been tracked by Amplitude',
        }, status=400)

    return JsonResponse({'success': True})

```

---

## manage.py

```py
#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'amplitude_example.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()

```

---

## amplitude_example/__init__.py

```py
# Amplitude Django example project

```

---

## amplitude_example/asgi.py

```py
"""
ASGI config for Amplitude example project
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'amplitude_example.settings')

application = get_asgi_application()

```

---

## amplitude_example/settings.py

```py
"""Django settings for Amplitude example project"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-example-key-change-in-production')

DEBUG = os.environ.get('DEBUG', 'True').lower() == 'true'

ALLOWED_HOSTS = ['localhost', '127.0.0.1']


# Amplitude configuration
AMPLITUDE_API_KEY = os.environ.get('AMPLITUDE_API_KEY', '')
AMPLITUDE_DISABLED = os.environ.get('AMPLITUDE_DISABLED', 'False').lower() == 'true'


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'core.apps.CoreConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'amplitude_example.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'amplitude_example.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

```

---

## amplitude_example/urls.py

```py
"""
URL configuration for Amplitude example project
"""

from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    # Include the core app URLs for Amplitude examples
    path('', include('core.urls')),
]

```

---

## amplitude_example/wsgi.py

```py
"""
WSGI config for Amplitude example project
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'amplitude_example.settings')

application = get_wsgi_application()

```

---

## requirements.txt

```txt
Django>=4.2,<5.0
amplitude-analytics  # Always use latest version
python-dotenv>=1.0.0

```

---

