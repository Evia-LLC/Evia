import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const API_PORT = Number(process.env.ELOHIM_PORT ?? 5196);
const WEB_PORT = Number(process.env.ELOHIM_WEB_PORT ?? 5195);

export default defineConfig({
  plugins: [svelte()],
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    exclude: ['node_modules/**', 'test/integration/**', 'test/integration.setup.ts',
      'test/body-store.test.ts', 'test/product-ownership.test.ts', 'test/rate-limit.test.ts',
      'test/ownership-boundaries.test.ts', 'test/request-validation.test.ts', 'test/image-upload-boundaries.test.ts',
      'test/deletion-states.test.ts', 'test/voice-cache-privacy.test.ts', 'test/consents.test.ts',
      'test/registration-store.test.ts', 'test/integrated-migrations.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // three.js stays out of the initial bundle: only the Scan page's
        // hologram uses it, and it loads it with a dynamic import.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
