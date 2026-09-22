/**
 * Screenshot sink.
 *
 * `requestAnimationFrame` does not fire in a browser tab that is not
 * compositing, and a hidden container reports a 0x0 drawing buffer — so in a
 * headless or backgrounded environment the 3D scene renders nothing and cannot
 * be screenshotted by the usual means, even though draw calls and triangle
 * counts still report healthy numbers.
 *
 * The workaround, and the only way to actually *see* the scene here:
 *
 *   1. run this:            node scripts/shoot.mjs [outDir]
 *   2. in the page console: __evia.captureFrame(w, h, settleFrames)
 *      → steps the scene without rAF, renders at an explicit size,
 *        and returns a PNG data URL
 *   3. POST that data URL:  fetch('http://127.0.0.1:5199/name', {method:'POST', body:url})
 *
 * The PNG lands in `shots/name.png`. See README → Developer tools.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'shots'));
const PORT = Number(process.env.EVIA_SHOT_PORT ?? 5199);

fs.mkdirSync(outDir, { recursive: true });

/** Only ever writes into outDir, whatever the request asks for. */
function safeName(raw) {
  const base = path.basename(decodeURIComponent(raw).replace(/^\/+/, '')) || 'shot';
  return base.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
}

http
  .createServer((req, res) => {
    // The page is served from another port, so the browser preflights.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end('POST a data URL');
      return;
    }

    const name = safeName(req.url ?? 'shot');
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      // A 4K PNG data URL is a few MB; anything past this is not a screenshot.
      if (body.length > 40_000_000) req.destroy();
    });
    req.on('end', () => {
      const base64 = body.replace(/^data:image\/\w+;base64,/, '');
      if (!base64) {
        res.writeHead(400).end('empty body');
        return;
      }
      const file = path.join(outDir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(base64, 'base64'));
      const kb = Math.round(fs.statSync(file).size / 1024);
      console.log(`wrote ${path.relative(root, file)} (${kb} KB)`);
      res.writeHead(200).end('ok');
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`shot sink on http://127.0.0.1:${PORT} -> ${path.relative(root, outDir)}/`);
  });
