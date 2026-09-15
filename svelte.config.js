import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Needed by svelte-check and by editor tooling, which resolve the Svelte
 * configuration from here rather than from vite.config.ts.
 * `vitePreprocess` is what makes `lang="ts"` work inside components.
 */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
  },
};
