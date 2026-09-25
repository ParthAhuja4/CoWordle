/**
 * HTTP side of the Activity: serves the static page, the OAuth2 code
 * exchange, a health check, and (if enabled) the development login.
 *
 * Inside Discord the page is loaded through Discord's proxy at
 * https://<app-id>.discordsays.com/ and requests arrive with a `/.proxy`
 * prefix; it is stripped so the same routes work locally.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { exchangeCode, devSession } from './activity/auth.js';
import { log } from './util/logger.js';

const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function stripProxy(pathname) {
  return pathname.startsWith('/.proxy/') ? pathname.slice('/.proxy'.length) : pathname === '/.proxy' ? '/' : pathname;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Short fingerprint of the built assets. It goes into the asset URLs so every deploy
 * is a new URL: Discord's mobile clients hold on to a cached style.css / app.js
 * otherwise, and phones keep showing the previous UI.
 */
async function assetVersion() {
  const hash = createHash('sha1');
  for (const name of ['style.css', 'app.js']) {
    try {
      hash.update(await readFile(join(PUBLIC_DIR, name)));
    } catch {
      hash.update(String(Date.now()));
    }
  }
  return hash.digest('hex').slice(0, 10);
}

export function createHttpServer({ config, isReady }) {
  // Served as a separate script (not inline) so it passes the Activity's Content Security Policy.
  const configJs = `window.COWORDLE = ${JSON.stringify({ clientId: config.clientId, devLogin: !!config.allowDevLogin })};\n`;
  const indexHtmlPromise = (async () => {
    const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
    const v = await assetVersion();
    return html.replace(/(href|src)="(style\.css|app\.js|config\.js)"/g, `$1="$2?v=${v}"`);
  })();

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = stripProxy(url.pathname);

    try {
      if (path === '/health' || path === '/api/health') {
        const ok = isReady();
        return json(res, ok ? 200 : 503, { ok, uptime: Math.floor(process.uptime()) });
      }

      if (path === '/api/token' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (typeof body.code !== 'string' || !body.code) return json(res, 400, { error: 'code required' });
        const { access_token, session, user } = await exchangeCode({ code: body.code, guildId: body.guildId ?? null }, config);
        return json(res, 200, { access_token, session, user });
      }

      if (path === '/api/dev-login' && req.method === 'POST') {
        if (!config.allowDevLogin) return json(res, 404, { error: 'not found' });
        const body = JSON.parse((await readBody(req)) || '{}');
        return json(res, 200, devSession({ name: body.name }, config));
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });

      if (path === '/' || path === '/index.html') {
        const html = await indexHtmlPromise;
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
        return res.end(html);
      }
      if (path === '/config.js') {
        res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
        return res.end(configJs);
      }

      const file = normalize(join(PUBLIC_DIR, path));
      if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !TYPES[extname(file)]) {
        return json(res, 404, { error: 'not found' });
      }
      const data = await readFile(file);
      // Versioned URLs (from index.html) never change content, so they may be cached hard;
      // anything else must be revalidated every time.
      const cache = url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': cache });
      return res.end(data);
    } catch (err) {
      log.error(`${req.method} ${path} failed:`, err?.message ?? err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    }
  });
}
