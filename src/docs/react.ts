/**
 * React/Vite integration documentation for LLM
 */
import type { DetectedProject } from '../types/index.js';

export function getReactDocumentation(project: DetectedProject): string {
  const { hasTypeScript, envVarPrefix, entryPoint } = project;
  const fileExtension = hasTypeScript ? 'tsx' : 'jsx';
  const apiKeyVar = `${envVarPrefix}AMPLITUDE_API_KEY`;
  const deploymentKeyVar = `${envVarPrefix}AMPLITUDE_DEPLOYMENT_KEY`;

  // Determine how to access environment variables
  const envAccess = envVarPrefix === 'VITE_'
    ? `import.meta.env.${apiKeyVar}`
    : `process.env.${apiKeyVar}`;

  const deploymentEnvAccess = envVarPrefix === 'VITE_'
    ? `import.meta.env.${deploymentKeyVar}`
    : `process.env.${deploymentKeyVar}`;

  return `
# Amplitude Unified SDK Integration for React

## Installation
The @amplitude/unified package should be installed via npm/yarn/pnpm:
\`\`\`bash
npm install @amplitude/unified
\`\`\`

## Integration Steps

### STEP 1: Initialize the Unified SDK in the application entry point

**FILE:** ${entryPoint}

**LOCATION:** Before the React app is rendered

**Changes Required:**
1. Import the \`initAll\` function from @amplitude/unified
2. Call initAll() with your API key and optional experiment configuration
3. This should happen BEFORE ReactDOM.createRoot().render() is called

**Example Implementation:**

\`\`\`${hasTypeScript ? 'typescript' : 'javascript'}
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initAll } from '@amplitude/unified'
import App from './App.${fileExtension}'
import './index.css'

// Initialize Amplitude Unified SDK
initAll(${envAccess} || '', {
  experiment: {
    deploymentKey: ${deploymentEnvAccess},
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
\`\`\`

**Key Points:**
- \`initAll()\` takes the API key as the first parameter
- The second parameter is a configuration object
- \`experiment.deploymentKey\` is optional and enables feature flagging
- If deploymentKey is not provided, it falls back to the API key
- Always use environment variables, never hardcode keys
- Call this before rendering the React app

### STEP 2: Using Analytics

Once initialized, you can track events anywhere in your React components:

\`\`\`${hasTypeScript ? 'typescript' : 'javascript'}
import { analytics } from '@amplitude/unified'

function MyComponent() {
  const handleClick = () => {
    analytics()?.track('Button Clicked', {
      buttonName: 'submit',
      page: 'home',
    })
  }

  return <button onClick={handleClick}>Click Me</button>
}
\`\`\`

### STEP 3: Using Feature Flags (Experiment)

To use feature flags, fetch variants first, then access them:

\`\`\`${hasTypeScript ? 'typescript' : 'javascript'}
import { experiment } from '@amplitude/unified'
import { useEffect, useState } from 'react'

function MyComponent() {
  const [showNewFeature, setShowNewFeature] = useState(false)

  useEffect(() => {
    // Fetch feature flags
    experiment()?.fetch().then(() => {
      const variant = experiment()?.variant('new-feature-flag')
      setShowNewFeature(variant?.value === 'on')
    })
  }, [])

  return (
    <div>
      {showNewFeature && <div>New Feature!</div>}
    </div>
  )
}
\`\`\`

## Environment Variables

Create a \`.env.local\` file in the project root:

\`\`\`
${apiKeyVar}=your_api_key_here
${deploymentKeyVar}=your_deployment_key_here
\`\`\`

Make sure \`.env.local\` is in your \`.gitignore\` to prevent committing secrets.

## Important Notes

- The Unified SDK consolidates Analytics, Session Replay, and Experiment into one package
- Always initialize before rendering your React app
- Use environment variables for all API keys
- Feature flags require calling \`fetch()\` before accessing variants
- The SDK handles user sessions automatically
`;
}

export function getReactCRADocumentation(project: DetectedProject): string {
  // CRA uses similar patterns but with different entry point
  const doc = getReactDocumentation(project);

  return doc.replace(
    'src/main.${fileExtension}',
    'src/index.${fileExtension}'
  );
}
