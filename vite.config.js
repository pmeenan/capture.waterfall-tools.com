import { defineConfig } from 'vite';

// Development server only (D-025). Production builds go through scripts/build.js and Rollup.
export default defineConfig({
    root: 'site',
    publicDir: 'public',
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
