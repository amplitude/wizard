import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Files to ignore globally
  {
    ignores: [
      'eslint.config.mjs',
      '.eslintrc.js',
      'babel.config.js',
      'cucumber.mjs',
      'vitest.config.ts',
      'experiment.mts',
      'build/**',
      'dist/**',
      'esm/**',
      'assets/**',
      'scripts/**',
      'coverage/**',
      'e2e-tests/test-applications/**',
      '.claude/worktrees/**',
      '.claude/knowledge/**',
      // Eval scenario fixtures are raw framework starters — out of
      // scope for the wizard repo's lint config.
      'evals/scenarios/**/pristine/**',
      'evals/scenarios/**/golden/working/**',
      'evals/reports/**',
      // Quality A/B harness ships as .mjs (operator-run scripts that
      // dynamic-import the AI SDK). The TS-typed parts are the unit
      // tests under `evals/model-quality/__tests__/*.test.ts`, which
      // stay in scope for the lint config.
      'evals/model-quality/**/*.mjs',
      'evals/model-quality/results/**',
      'benchmarks/**',
    ],
  },

  // Base + TypeScript recommended with type checking
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,

  // Main config — applies to all linted files
  {
    languageOptions: {
      globals: {
        ...globals.es2015,
        ...globals.node,
        NodeJS: 'readonly',
      },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        project: ['./tsconfig.eslint.json'],
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-undef': 'error',
    },
  },

  // Timeline UX voice guardrail (PR 10).
  //
  // The new design system replaces all-caps status-shout copy ("TASK",
  // "STEP", "PHASE", "INITIALIZING", "EXECUTING") with the lowercase /
  // sentence-case `voice.*` vocabulary documented in
  // `docs/design/timeline-ux.md`. This block is scoped to wizard screens
  // so we don't accidentally flag SQL column names or unrelated constants
  // elsewhere in the codebase.
  //
  // Excludes `__tests__/` because snapshot fixtures intentionally include
  // legacy strings for regression coverage.
  {
    files: ['src/ui/tui/screens/**/*.{ts,tsx}'],
    ignores: ['src/ui/tui/screens/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/\\b(TASK|STEP|PHASE|INITIALIZING|EXECUTING)\\b/]",
          message:
            'Status-shout copy is forbidden in wizard screens. Use the voice.* vocabulary from docs/design/timeline-ux.md (e.g. voice.step, voice.phase) instead.',
        },
        {
          selector:
            "TemplateElement[value.cooked=/\\b(TASK|STEP|PHASE|INITIALIZING|EXECUTING)\\b/]",
          message:
            'Status-shout copy is forbidden in wizard screens. Use the voice.* vocabulary from docs/design/timeline-ux.md (e.g. voice.step, voice.phase) instead.',
        },
        {
          selector:
            "JSXText[value=/\\b(TASK|STEP|PHASE|INITIALIZING|EXECUTING)\\b/]",
          message:
            'Status-shout copy is forbidden in wizard screens. Use the voice.* vocabulary from docs/design/timeline-ux.md (e.g. voice.step, voice.phase) instead.',
        },
      ],
    },
  },

  // Test files — disable type-checked rules, add test globals
  {
    files: [
      'e2e-tests/**/*.ts',
      '**/*.test.js',
      '**/*.test.ts',
      '**/__tests__/**/*.ts',
      '**/__tests__/**/*.js',
      'features/step-definitions/**/*.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.vitest,
        expect: 'readonly',
        test: 'readonly',
        it: 'readonly',
        describe: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
