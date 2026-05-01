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
