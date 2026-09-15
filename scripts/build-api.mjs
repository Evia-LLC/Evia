/**
 * Bundles the API into one file for Vercel.
 *
 * Vercel compiles a TypeScript function with tsc, file by file, and leaves
 * the import specifiers alone - so `import './app.ts'` survives into output
 * where only `app.js` exists, and the function dies on its first request
 * with a module-not-found. The Netlify path never had this problem because
 * its bundler (esbuild) resolves the extensions. So the same bundler is used
 * here, ahead of time: `server/vercel.ts` and everything it reaches become
 * `api/index.js`, plain JavaScript that Vercel deploys as-is.
 *
 * Runs from `prebuild` (harmless on Netlify, which ignores `api/`) and by hand:
 *
 *   node scripts/build-api.mjs
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, 'server', 'vercel.ts')],
  outfile: path.join(root, 'api', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg's optional native binding is looked up at runtime and never installed.
  external: ['pg-native'],
  // CommonJS dependencies bundled into an ES module still call `require`
  // for a few things at runtime; give them one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});

console.log('api -> api/index.js');
