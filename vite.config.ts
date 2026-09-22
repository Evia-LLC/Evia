import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const API_PORT = Number(process.env.EVIA_PORT ?? 5196);
const WEB_PORT = Number(process.env.EVIA_WEB_PORT ?? 5195);

/*
 * Where the database tests point.
 *
 * There is no file to throw away any more — the database is Postgres. The
 * tests that touch it run against whatever NETLIFY_DATABASE_URL names, inside
 * a schema of their own that they create and drop, and skip themselves with a
 * printed reason when nothing is configured. Everything else in the suite never
 * opens a connection.
 */
export default defineConfig({
  plugins: [svelte()],
  test: {
    env: {
      NETLIFY_DATABASE_URL: process.env.NETLIFY_DATABASE_URL ?? '',
    },
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
        // Keep the clinical environment out of the initial bundle (ARCHITECTURE §9).
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
