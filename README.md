# Amplitude Wizard

AI-powered CLI wizard to integrate Amplitude Unified SDK into your project. Built as an **envoy** - a tool designed to work seamlessly with both humans and AI agents (Cursor, Claude Code, etc.).

## What is this?

The Amplitude Wizard automates the integration of the [Amplitude Unified SDK](https://amplitude.com/docs/sdks/experiment-sdks/experiment-javascript) into your JavaScript/TypeScript projects. It uses Claude AI to intelligently modify your codebase, ensuring proper setup without common mistakes.

## Features

- 🤖 **AI-Powered Code Generation**: Uses Claude to intelligently modify your code
- 🚀 **Framework Detection**: Automatically detects React (Vite, CRA), Next.js, Vue
- 📦 **Complete Setup**: Installs packages, modifies code, configures environment
- 🔒 **Secure**: Never hardcodes API keys, always uses environment variables
- 🎯 **Smart File Selection**: Only modifies files that need changes
- 🤝 **Agent-Friendly**: Works with human developers and AI coding agents
- 📝 **Post-Install Guidelines**: Creates AI assistant rules for future edits

## Installation

### For Human Developers (Interactive Mode)

```bash
npx @amplitude/wizard
```

The wizard will guide you through the setup process.

### For AI Agents (Non-Interactive Mode)

```bash
npx @amplitude/wizard --default --api-key <your-amplitude-api-key>
```

This mode is perfect for AI coding assistants like Cursor and Claude Code. Simply paste the command and the wizard will complete the integration automatically.

## Usage

### Basic Usage

```bash
# Interactive mode with prompts
npx @amplitude/wizard

# Non-interactive mode for AI agents
npx @amplitude/wizard --default

# Specify API keys
npx @amplitude/wizard --api-key <key> --deployment-key <key>

# Target specific directory
npx @amplitude/wizard --install-dir ./my-app

# Dry run (see what would change)
npx @amplitude/wizard --dry-run

# Debug mode
npx @amplitude/wizard --debug
```

### Command-Line Options

| Option | Description |
|--------|-------------|
| `--install-dir <path>` | Directory to install SDK (default: current directory) |
| `--api-key <key>` | Your Amplitude API key |
| `--deployment-key <key>` | Your Amplitude Deployment key (for Experiment) |
| `--anthropic-api-key <key>` | Anthropic API key for Claude (optional) |
| `--debug` | Enable verbose debug logging |
| `--default` | Non-interactive mode (use defaults for all prompts) |
| `--dry-run` | Show what would be changed without making changes |

## What Does It Do?

The wizard performs the following steps:

1. **Detects Your Framework**: Identifies React, Next.js, Vue, etc.
2. **Installs Package**: Adds `@amplitude/unified` to your dependencies
3. **Modifies Code**: Uses AI to inject initialization code in the right place
4. **Configures Environment**: Creates `.env.local` with your API keys
5. **Updates .gitignore**: Ensures secrets aren't committed
6. **Adds AI Guidelines**: Creates `.cursor/rules` and `.claude` files for future AI assistance

## Supported Frameworks

Currently supported:
- ✅ React with Vite
- ✅ Create React App
- 🚧 Next.js (coming soon)
- 🚧 Vue (coming soon)
- 🚧 React Native (coming soon)

## Example: React + Vite

**Before:**
```typescript
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**After:**
```typescript
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAll } from '@amplitude/unified'
import App from './App.tsx'
import './index.css'

// Initialize Amplitude Unified SDK
initAll(import.meta.env.VITE_AMPLITUDE_API_KEY || '', {
  experiment: {
    deploymentKey: import.meta.env.VITE_AMPLITUDE_DEPLOYMENT_KEY,
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Plus creates `.env.local`:
```bash
VITE_AMPLITUDE_API_KEY=your_api_key
VITE_AMPLITUDE_DEPLOYMENT_KEY=your_deployment_key
```

## How It Works

The wizard uses a **two-phase LLM approach** (inspired by [PostHog's wizard](https://posthog.com/blog/envoy-wizard-llm-agent)):

### Phase 1: File Filtering
Claude analyzes your project structure and selects which files need modification.

### Phase 2: Code Generation
For each selected file, Claude generates the complete updated file content (not diffs), ensuring consistency and avoiding merge conflicts.

### Post-Installation
Creates AI assistant guidelines in `.cursor/rules` and `.claude` directories so future AI edits maintain proper Amplitude integration patterns.

## Environment Variables

The wizard uses framework-specific environment variable prefixes:

| Framework | Prefix | Example |
|-----------|--------|---------|
| Vite | `VITE_` | `VITE_AMPLITUDE_API_KEY` |
| Create React App | `REACT_APP_` | `REACT_APP_AMPLITUDE_API_KEY` |
| Next.js | `NEXT_PUBLIC_` | `NEXT_PUBLIC_AMPLITUDE_API_KEY` |

## Security

- ✅ Never hardcodes API keys in source code
- ✅ Always uses environment variables
- ✅ Automatically adds `.env.local` to `.gitignore`
- ✅ Validates all LLM responses with Zod schemas

## Development

### Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run locally
npm start

# Run in watch mode
npm run dev
```

### Project Structure

```
src/
├── index.ts           # CLI entry point
├── cli.ts             # Commander CLI setup
├── wizard.ts          # Main orchestration
├── detectors/         # Framework detection
├── llm/               # Claude integration
│   ├── client.ts      # Anthropic API client
│   ├── codemod.ts     # Two-phase modification flow
│   └── prompts/       # LLM prompt templates
├── docs/              # Framework integration guides
├── installers/        # Package installation
├── rules/             # AI assistant guidelines
├── utils/             # File operations, logging
└── config/            # Framework configurations
```

## Requirements

- Node.js 18+
- Anthropic API key (optional, can be provided at runtime)

## Roadmap

- [ ] Support for Next.js (App Router and Pages Router)
- [ ] Support for Vue 3
- [ ] Support for React Native
- [ ] Support for Angular
- [ ] Amplitude Analytics-only mode (skip Experiment)
- [ ] Custom integration templates
- [ ] Integration testing suite

## Contributing

This is a hackathon project! Contributions welcome.

## License

MIT

## Learn More

- [Amplitude Unified SDK Documentation](https://amplitude.com/docs/sdks/experiment-sdks/experiment-javascript)
- [PostHog Wizard (Inspiration)](https://github.com/PostHog/wizard)
- [Envoy Pattern Blog Post](https://posthog.com/blog/envoy-wizard-llm-agent)

---

Built with ❤️ using Claude AI
