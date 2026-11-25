/**
 * Controlled test pages (M2): a local server whose pages behave in ways known in advance, so the
 * pipeline's end-of-load rule (D-028) and request accounting can be checked exactly.
 *
 * Every page links `data:,` as its icon so Chrome makes no favicon request, and the server logs
 * every request it serves, so a test can compare what was captured with what was asked for.
 *
 *   /simple          an HTML page and exactly three subresources (css, js, png)
 *   /redirect        302 to /simple
 *   /not-found       a 404 document: a page that loaded, with an error status
 *   /late-fetch      on load, waits 1 s, then fetches /slow?ms=1500 and reads it: the run must wait
 *                    (it reads the body: Chrome reports no loadingFinished for an unread one, RE-024)
 *   /unread-fetch    like /late-fetch, but never reads the body: Chrome then sends no
 *                    loadingFinished (RE-024); the run ends once Content-Length bytes arrived
 *   /event-stream    on load, opens an EventSource that never ends: must not hold the run open
 *   /hanging         on load, fetches /hang, which never answers: holds the run only 10 s
 *   /never-quiet     fetches something every 500 ms forever: only the time limit ends it
 * A navigation to a port with nothing listening (see `closedPortUrl`) fails at once.
 */

import http from 'node:http';
import net from 'node:net';

/** A 1x1 transparent PNG. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** @param {string} title @param {string} [body] @param {string} [script] */
const page = (title, body = '', script = '') => `<!doctype html><html><head><meta charset=utf-8><title>${title}</title>
<link rel=icon href="data:,">${body}</head><body><h1>${title}</h1>${script ? `<script>${script}</script>` : ''}</body></html>`;

/**
 * @typedef {object} TestPages
 * @property {string} origin
 * @property {(path: string) => string} url
 * @property {string[]} log every path served, in order (query strings included)
 * @property {() => void} clearLog
 * @property {() => Promise<string>} closedPortUrl a URL on a loopback port with nothing listening
 * @property {() => Promise<void>} close
 */

/** @returns {Promise<TestPages>} */
export async function startTestPages() {
    /** @type {string[]} */
    const log = [];
    /** Responses held open on purpose; ended when the server closes. */
    /** @type {Set<http.ServerResponse>} */
    const held = new Set();

    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        log.push(`${url.pathname}${url.search}`);
        const send = (/** @type {number} */ status, /** @type {string} */ type, /** @type {string | Buffer} */ body) => {
            // An explicit length, as most servers send for a small response: without one Node
            // switches to chunked encoding, and RE-024's mitigation has nothing to compare against.
            res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(body)) });
            res.end(body);
        };
        switch (url.pathname) {
            case '/simple':
                return send(200, 'text/html', page('simple', '<link rel=stylesheet href="/simple.css"><script src="/simple.js"></script>', '') .replace('</body>', '<img src="/pixel.png"></body>'));
            case '/simple.css': return send(200, 'text/css', 'h1 { color: #333 }');
            case '/simple.js': return send(200, 'text/javascript', 'window.simpleLoaded = true;');
            case '/pixel.png': return send(200, 'image/png', PIXEL);
            case '/redirect':
                res.writeHead(302, { location: '/simple', 'cache-control': 'no-store' });
                return res.end();
            case '/not-found': return send(404, 'text/html', page('not found'));
            case '/late-fetch':
                return send(200, 'text/html', page('late fetch', '', "addEventListener('load', () => setTimeout(() => fetch('/slow?ms=1500').then((r) => r.text()), 1000));"));
            case '/unread-fetch':
                return send(200, 'text/html', page('unread fetch', '', "addEventListener('load', () => setTimeout(() => fetch('/slow?ms=1500'), 1000));"));
            case '/slow': {
                const ms = Math.min(Number(url.searchParams.get('ms')) || 0, 30000);
                const timer = setTimeout(() => { held.delete(res); send(200, 'text/plain', 'slow'); }, ms);
                held.add(res);
                res.on('close', () => clearTimeout(timer));
                return;
            }
            case '/event-stream':
                return send(200, 'text/html', page('event stream', '', "addEventListener('load', () => { window.es = new EventSource('/sse'); });"));
            case '/sse': {
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
                res.write('data: hello\n\n');
                const timer = setInterval(() => res.write(': keep-alive\n\n'), 1000);
                held.add(res);
                res.on('close', () => clearInterval(timer));
                return;
            }
            case '/hanging':
                return send(200, 'text/html', page('hanging', '', "addEventListener('load', () => fetch('/hang'));"));
            case '/hang':
                held.add(res); // never answered
                return;
            case '/never-quiet':
                return send(200, 'text/html', page('never quiet', '', "let n = 0; setInterval(() => fetch('/tick?n=' + (n++)), 500);"));
            case '/tick': return send(200, 'text/plain', 'tick');
            default: return send(404, 'text/plain', 'no such test page');
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const origin = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;

    return {
        origin,
        url: (path) => `${origin}${path}`,
        log,
        clearLog: () => { log.length = 0; },
        async closedPortUrl() {
            // Bind a port, then free it: nothing listens there afterwards.
            const probe = net.createServer();
            await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
            const port = /** @type {net.AddressInfo} */ (probe.address()).port;
            await new Promise((resolve) => probe.close(() => resolve(undefined)));
            return `http://127.0.0.1:${port}/`;
        },
        async close() {
            for (const res of held) res.destroy();
            held.clear();
            server.closeAllConnections();
            await new Promise((resolve) => server.close(() => resolve(undefined)));
        },
    };
}
