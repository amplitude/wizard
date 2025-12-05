/**
 * Framework-specific configurations
 */
import { Framework, type FrameworkConfig, type DetectedProject } from '../types/index.js';
import { getReactDocumentation, getReactCRADocumentation } from '../docs/react.js';
import { hasPackageInstalled, readPackageJson } from '../utils/file.js';

/**
 * Framework configurations with detection logic and documentation
 */
export const FRAMEWORK_CONFIGS: Record<Framework, FrameworkConfig> = {
  [Framework.REACT_VITE]: {
    name: 'React with Vite',
    filterPatterns: ['src/**/*.{tsx,ts,jsx,js}', '*.{tsx,ts,jsx,js}'],
    ignorePatterns: [
      '**/*.test.{tsx,ts,jsx,js}',
      '**/*.spec.{tsx,ts,jsx,js}',
      '**/vite.config.*',
      '**/vitest.config.*',
    ],
    detect: async (installDir: string) => {
      const packageJson = await readPackageJson(installDir);
      return (
        hasPackageInstalled('react', packageJson) &&
        hasPackageInstalled('vite', packageJson)
      );
    },
    getDocumentation: (project: DetectedProject) => getReactDocumentation(project),
    filterFilesRules: `
- Focus on the entry point file specified in the documentation
- You typically only need to modify the entry point file and .env.local
- Consider additional config files only if explicitly mentioned in documentation
`,
    generateFilesRules: `
- Use import.meta.env for environment variables in Vite projects
- Place initAll() call before ReactDOM.createRoot().render()
- Maintain existing imports and code style
- Use appropriate file extension (.tsx for TypeScript, .jsx for JavaScript)
`,
    nextSteps: `
## Next Steps

1. **Add your Amplitude API keys** to .env.local:
   - Get your API key from: https://analytics.amplitude.com/settings/projects
   - Get your Deployment Key from: https://experiment.amplitude.com/settings/deployments

2. **Identify users** when they log in:
   \`\`\`typescript
   import { analytics } from '@amplitude/unified'
   analytics()?.identify(userId, { email: user.email })
   \`\`\`

3. **Track important events** in your app:
   \`\`\`typescript
   analytics()?.track('Purchase Completed', { amount: 99.99 })
   \`\`\`

4. **Use feature flags** to control features:
   \`\`\`typescript
   import { experiment } from '@amplitude/unified'
   await experiment()?.fetch()
   const variant = experiment()?.variant('new-feature')
   \`\`\`

5. **Test your integration** by checking the Amplitude dashboard for events
`,
  },

  [Framework.REACT_CRA]: {
    name: 'Create React App',
    filterPatterns: ['src/**/*.{tsx,ts,jsx,js}', 'public/**/*'],
    ignorePatterns: [
      '**/*.test.{tsx,ts,jsx,js}',
      '**/*.spec.{tsx,ts,jsx,js}',
    ],
    detect: async (installDir: string) => {
      const packageJson = await readPackageJson(installDir);
      return (
        hasPackageInstalled('react', packageJson) &&
        hasPackageInstalled('react-scripts', packageJson)
      );
    },
    getDocumentation: (project: DetectedProject) =>
      getReactCRADocumentation(project),
    filterFilesRules: `
- Focus on the entry point file specified in the documentation
- You typically only need to modify the entry point file and .env.local
- Consider additional config files only if explicitly mentioned in documentation
`,
    generateFilesRules: `
- Use process.env.REACT_APP_* for environment variables in CRA
- Place initAll() before ReactDOM render call
- Maintain existing imports and formatting
`,
    nextSteps: `
## Next Steps

1. **Add your Amplitude API keys** to .env.local (use REACT_APP_ prefix)
2. **Restart your development server** for environment variables to take effect
3. **Identify users** when they log in
4. **Track events** throughout your application
5. **Test your integration** in the Amplitude dashboard
`,
  },

  [Framework.NEXTJS_APP]: {
    name: 'Next.js (App Router)',
    filterPatterns: ['app/**/*.{tsx,ts,jsx,js}', 'src/app/**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [],
    detect: async (installDir: string) => {
      // Will be implemented if we extend to Next.js
      return false;
    },
    getDocumentation: () => '// TODO: Next.js App Router documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.NEXTJS_PAGES]: {
    name: 'Next.js (Pages Router)',
    filterPatterns: ['pages/**/*.{tsx,ts,jsx,js}', 'src/pages/**/*.{tsx,ts,jsx,js}'],
    ignorePatterns: [],
    detect: async (installDir: string) => {
      // Will be implemented if we extend to Next.js
      return false;
    },
    getDocumentation: () => '// TODO: Next.js Pages Router documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.VUE]: {
    name: 'Vue',
    filterPatterns: ['src/**/*.{vue,ts,js}'],
    ignorePatterns: [],
    detect: async (installDir: string) => {
      // Will be implemented if we extend to Vue
      return false;
    },
    getDocumentation: () => '// TODO: Vue documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.PYTHON_FLASK]: {
    name: 'Flask',
    filterPatterns: ['**/*.py'],
    ignorePatterns: ['**/*test*.py', '**/__pycache__/**', '**/venv/**', '**/.venv/**'],
    detect: async (installDir: string) => {
      // Detection logic is in src/detectors/python.ts
      return false;
    },
    getDocumentation: () => '// TODO: Flask documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.PYTHON_DJANGO]: {
    name: 'Django',
    filterPatterns: ['**/*.py'],
    ignorePatterns: ['**/*test*.py', '**/__pycache__/**', '**/venv/**', '**/.venv/**'],
    detect: async (installDir: string) => {
      // Detection logic is in src/detectors/python.ts
      return false;
    },
    getDocumentation: () => '// TODO: Django documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.PYTHON_FASTAPI]: {
    name: 'FastAPI',
    filterPatterns: ['**/*.py'],
    ignorePatterns: ['**/*test*.py', '**/__pycache__/**', '**/venv/**', '**/.venv/**'],
    detect: async (installDir: string) => {
      // Detection logic is in src/detectors/python.ts
      return false;
    },
    getDocumentation: () => '// TODO: FastAPI documentation',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },

  [Framework.UNKNOWN]: {
    name: 'Unknown',
    filterPatterns: [],
    ignorePatterns: [],
    detect: async () => false,
    getDocumentation: () => '',
    filterFilesRules: '',
    generateFilesRules: '',
    nextSteps: '',
  },
};

/**
 * Get framework configuration by framework type
 */
export function getFrameworkConfig(framework: Framework): FrameworkConfig {
  return FRAMEWORK_CONFIGS[framework];
}
