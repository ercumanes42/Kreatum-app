import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  console: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'functions/lib/**',
      'functions/vendor/**',
      '.vercel/**',
      'playwright-report/**',
      'test-results/**',
      'tmp/**',
      'output/**',
      'output/playwright/**',
      'public/**',
      'public-app/**',
      'scratch/**',
      '.codex_tmp/**',
      '.codex-*/**',
      'Logo Kreatum/**',
      '.agents/**',
      '.playwright-mcp/**',
      'kreatum_report_builder.html',
      'kreatum_report_builder_v2.js',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: nodeGlobals,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['functions/**/*.ts', 'scripts/**/*.{js,mjs}', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
