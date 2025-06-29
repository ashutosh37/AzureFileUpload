import globals from 'globals';
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  js.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    ignores: ['dist', 'eslint.config.js'],
    rules: {
      'jsx-a11y/anchor-ambiguous-text': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
    },
  },
];