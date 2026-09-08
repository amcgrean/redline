import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'fixtures/**',
      'apps/web/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Node scripts and test helpers may use Node globals.
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.ts', 'packages/*/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // CLAUDE.md non-negotiable #6: pdf-core is DOM-free and has no `any`.
    files: ['packages/pdf-core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'pdf-core is DOM-free (CLAUDE.md #6).' },
        { name: 'document', message: 'pdf-core is DOM-free (CLAUDE.md #6).' },
        { name: 'navigator', message: 'pdf-core is DOM-free (CLAUDE.md #6).' },
      ],
    },
  },
  prettier,
);
