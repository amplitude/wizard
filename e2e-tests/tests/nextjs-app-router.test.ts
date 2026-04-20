import { createFrameworkTest } from '../framework-test-creator';

createFrameworkTest({
  name: 'NextJS',
  projectDir: 'nextjs-app-router-test-app',
  expectedOutput: {
    dev: 'Ready in',
    prod: 'Ready in',
  },
  tests: {
    packageJson: ['amplitude-js', 'amplitude-node'],
    devMode: true,
    build: true,
    prodMode: 'start',
  },
});
