// Temporary config: detects undefined identifiers (ReferenceError at runtime) only.
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';

export default [
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
    },
    plugins: { react: reactPlugin },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
    },
  },
];
