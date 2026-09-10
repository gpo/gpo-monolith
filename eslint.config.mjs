// Flat config (ESLint 9). Scoped to the go-forward tool only; the legacy
// .eslintrc.js and gpoAutoTests/eslint.config.mjs are untouched.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/tax-receipts/api/src/generated/**',
      'apps/tax-receipts/web/dist/**',
    ],
  },
  {
    files: ['apps/tax-receipts/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/vitest.config.ts', '**/*.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
