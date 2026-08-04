import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.vitepress/**',
      'docs/site/**',
      '**/*.test.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'error',
    },
  },
  {
    // React 组件中的 exhaustive-deps 规则需要 eslint-plugin-react-hooks
    files: ['packages/react/**/*.tsx'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
);
