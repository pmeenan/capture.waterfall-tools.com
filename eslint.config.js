import js from '@eslint/js';
import globals from 'globals';

// Lint covers every first-party file. When a new directory is added, make sure one
// of the blocks below matches it; only generated output belongs in `ignores`.
export default [
    // waterfall-tools/ is a git submodule with its own lint configuration and gates (D-029).
    { ignores: ['node_modules/', 'dist/', 'coverage/', '.wrangler/', 'waterfall-tools/'] },
    js.configs.recommended,
    {
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        // Runs in the capture page.
        files: ['site/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    },
    {
        // Runs in the page, the extension and the helper: only what all three have.
        files: ['shared/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals['shared-node-browser'], Worker: 'readonly', Blob: 'readonly' } },
    },
    {
        // Runs in the extension's service worker.
        files: ['extension/**/*.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.serviceworker, chrome: 'readonly' } },
    },
    {
        // Runs in Node.
        files: ['helper/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.config.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    },
];
