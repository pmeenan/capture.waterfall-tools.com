/**
 * The helper's loopback server (D-022): the only way in, and the checks on it.
 *
 *   1. Loopback only: listens on 127.0.0.1; every plain HTTP request gets a 404.
 *   2. On the WebSocket upgrade, before anything else: the `Host` header must name this server's
 *      own loopback address and port (defeats DNS rebinding), and `Origin` must be exactly the
 *      capture origin. Either failing is a 403, and the socket is never upgraded.
 *   3. The first message must be `hello` with the secret, compared in constant time, within
 *      AUTH_TIMEOUT_MS; otherwise the connection is closed (4003 / 4008). Until then frames are
 *      capped at PRE_AUTH_MAX_BYTES.
 *   4. One paired connection at a time; a second upgrade is refused with 409 while one is open.
 *
 * After pairing, the control protocol (JSON text frames, protocol 1):
 *   page -> helper  { type: 'hello', protocol: 1, secret }
 *   helper -> page  { type: 'welcome', protocol: 1, version, browsers: [{ channel }] }
 *   page -> helper  { type: 'launch', channel, features?: string[], headless?: boolean, netLog?: boolean }
 *   helper -> page  { type: 'launched', channel }            | { type: 'error', code }
 *   page -> helper  { type: 'cdp', message: <CDP command> }   (only while a browser is up)
 *   helper -> page  { type: 'cdp', message: <CDP reply or event> }
 *   page -> helper  { type: 'close' }
 *   helper -> page  { type: 'netlog', data, last }            (the NetLog, in NETLOG_CHUNK pieces)
 *   helper -> page  { type: 'closed', netLog: boolean }       (browser gone, working folder deleted)
 * `netlog` messages come only after a close or exit, and only when the launch asked for one;
 * `closed` follows the last of them, whether Chrome was closed on request or exited by itself.
 * Paths are never sent to the page: they reveal the user's name. The browser also closes when the
 * connection ends.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { FrameDecoder, OPCODE, encodeFrame, encodeText } from '@capture/shared/ws-framing';
import { Relay } from './relay.js';
import { FEATURE_SWITCHES } from './chrome.js';

export const HELPER_PROTOCOL = 1;
export const AUTH_TIMEOUT_MS = 3000;
export const PRE_AUTH_MAX_BYTES = 4096;
/** NetLog text per message; keeps any one WebSocket frame modest. */
export const NETLOG_CHUNK = 1024 * 1024;
/** Close codes in the private range (4000-4999). */
export const CLOSE = Object.freeze({ badSecret: 4003, authTimeout: 4008, protocol: 4002, tooBig: 4009 });

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * @typedef {object} HelperOptions
 * @property {string} captureOrigin the only Origin accepted, e.g. https://capture.waterfall-tools.com
 * @property {string} secret the pairing secret
 * @property {import('./chrome.js').FoundBrowser[]} browsers what may be launched
 * @property {(options: {executable: string, features: string[], headless: boolean, netLog: boolean}) => import('./chrome.js').LaunchedBrowser} launch
 * @property {string} version
 * @property {number} [port] 0 picks a free port
 * @property {(line: string) => void} [log]
 * @property {number} [authTimeoutMs]
 */

/**
 * The secret for a run: 256 random bits, URL-safe.
 * @returns {string}
 */
export function newSecret() {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * @param {string} a
 * @param {string} b
 */
function sameSecret(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    // timingSafeEqual needs equal lengths; comparing a hash of each keeps the time independent of
    // where they differ and of the length of the guess.
    const hx = crypto.createHash('sha256').update(x).digest();
    const hy = crypto.createHash('sha256').update(y).digest();
    return crypto.timingSafeEqual(hx, hy) && x.length === y.length;
}

/**
 * Start the helper's server.
 * @param {HelperOptions} options
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startHelperServer({ captureOrigin, secret, browsers, launch, version, port = 0, log = () => {}, authTimeoutMs = AUTH_TIMEOUT_MS }) {
    /** @type {import('node:net').Socket | null} */
    let active = null;
    /** @type {Set<() => Promise<void>>} */
    const sessions = new Set();

    const server = http.createServer((_req, res) => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found\n');
    });

    server.on('upgrade', (req, duplex, head) => {
        // An http.Server hands upgrades a net.Socket; the event is typed as the wider Duplex.
        const socket = /** @type {import('node:net').Socket} */ (duplex);
        const refuse = (/** @type {number} */ status, /** @type {string} */ why) => {
            log(`refused a connection: ${why}`);
            socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            socket.destroy();
        };
        const listening = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const allowedHosts = [`127.0.0.1:${listening}`, `localhost:${listening}`];
        if (!allowedHosts.includes(req.headers.host ?? '')) return refuse(403, `Host ${JSON.stringify(req.headers.host ?? null)}`);
        if (req.headers.origin !== captureOrigin) return refuse(403, `Origin ${JSON.stringify(req.headers.origin ?? null)}`);
        if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') return refuse(400, 'not a WebSocket upgrade');
        const key = req.headers['sec-websocket-key'];
        if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16) return refuse(400, 'bad Sec-WebSocket-Key');
        if (active) return refuse(409, 'already paired with another connection');

        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        active = socket;
        const end = serveConnection(socket, head, {
            secret, browsers, launch, version, log, authTimeoutMs,
            onEnd: () => { if (active === socket) active = null; sessions.delete(end); },
        });
        sessions.add(end);
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(undefined));
    });
    return {
        port: /** @type {import('node:net').AddressInfo} */ (server.address()).port,
        async close() {
            await Promise.all([...sessions].map((end) => end()));
            await new Promise((resolve) => server.close(() => resolve(undefined)));
        },
    };
}

/**
 * One WebSocket connection, from the secret check to the browser's cleanup.
 * @param {import('node:net').Socket} socket
 * @param {Buffer} head bytes that arrived with the upgrade request
 * @param {object} ctx
 * @param {string} ctx.secret
 * @param {import('./chrome.js').FoundBrowser[]} ctx.browsers
 * @param {HelperOptions['launch']} ctx.launch
 * @param {string} ctx.version
 * @param {(line: string) => void} ctx.log
 * @param {number} ctx.authTimeoutMs
 * @param {() => void} ctx.onEnd
 * @returns {() => Promise<void>} ends the connection and waits for the browser to be gone
 */
function serveConnection(socket, head, { secret, browsers, launch, version, log, authTimeoutMs, onEnd }) {
    const decoder = new FrameDecoder();
    let paired = false;
    let received = 0;
    let ended = false;
    /** @type {import('./chrome.js').LaunchedBrowser | null} */
    let browser = null;
    /** @type {Relay | null} */
    let relay = null;
    /** @type {Promise<void>} */
    let browserGone = Promise.resolve();

    const send = (/** @type {object} */ message) => {
        if (!socket.destroyed) socket.write(encodeText(JSON.stringify(message), null));
    };
    /** Close the browser if one is up; resolves with its NetLog text, if it wrote one. */
    const closeBrowser = async () => {
        if (!browser) return { netLog: null };
        const b = browser;
        browser = null;
        relay = null;
        return b.close();
    };
    /** Hand the page the NetLog (if any), then report the browser gone. */
    const reportClosed = (/** @type {string | null} */ netLog) => {
        if (netLog !== null) {
            const pieces = Math.max(1, Math.ceil(netLog.length / NETLOG_CHUNK));
            for (let i = 0; i < pieces; i++) {
                send({ type: 'netlog', data: netLog.slice(i * NETLOG_CHUNK, (i + 1) * NETLOG_CHUNK), last: i === pieces - 1 });
            }
        }
        send({ type: 'closed', netLog: netLog !== null });
    };
    const finish = (/** @type {number} */ code, /** @type {string} */ reason) => {
        if (ended) return browserGone;
        ended = true;
        clearTimeout(authTimer);
        const payload = new Uint8Array(2 + Buffer.byteLength(reason));
        new DataView(payload.buffer).setUint16(0, code);
        payload.set(Buffer.from(reason), 2);
        if (!socket.destroyed) socket.end(encodeFrame(OPCODE.CLOSE, payload, null));
        // The page is gone, so a NetLog has nowhere to go: it is deleted with the working folder.
        browserGone = closeBrowser().then(() => {}).finally(onEnd);
        return browserGone;
    };

    const authTimer = setTimeout(() => {
        log('dropped a connection that did not pair in time');
        finish(CLOSE.authTimeout, 'pairing timed out');
    }, authTimeoutMs);

    /** @param {any} message */
    const onControl = async (message) => {
        if (!paired) {
            if (message?.type !== 'hello' || typeof message.secret !== 'string' || !sameSecret(message.secret, secret)) {
                log('refused a connection: wrong secret');
                return finish(CLOSE.badSecret, 'not paired');
            }
            if (message.protocol !== HELPER_PROTOCOL) return finish(CLOSE.protocol, 'unsupported protocol');
            paired = true;
            clearTimeout(authTimer);
            log('paired with the capture page');
            send({ type: 'welcome', protocol: HELPER_PROTOCOL, version, browsers: browsers.map((b) => ({ channel: b.channel })) });
            return;
        }
        switch (message?.type) {
            case 'launch': {
                if (browser) return send({ type: 'error', code: 'already-launched' });
                const found = browsers.find((b) => b.channel === message.channel);
                if (!found) return send({ type: 'error', code: 'unknown-browser' });
                /** @type {unknown[]} */
                const features = Array.isArray(message.features) ? message.features : [];
                if (!features.every((f) => typeof f === 'string' && Object.hasOwn(FEATURE_SWITCHES, f))) return send({ type: 'error', code: 'unknown-feature' });
                try {
                    browser = launch({ executable: found.path, features: /** @type {string[]} */ (features), headless: message.headless === true, netLog: message.netLog === true });
                } catch {
                    return send({ type: 'error', code: 'launch-failed' });
                }
                relay = new Relay();
                const thisBrowser = browser;
                const thisRelay = relay;
                thisBrowser.onMessage((text) => {
                    if (relay !== thisRelay) return;
                    const out = thisRelay.fromBrowser(text);
                    if (out !== null) send({ type: 'cdp', message: JSON.parse(out) });
                });
                thisBrowser.exited.then(({ netLog }) => {
                    // Chrome exited by itself (a crash, or the user closed its window).
                    if (browser === thisBrowser) {
                        browser = null;
                        relay = null;
                        log('the browser exited');
                        reportClosed(netLog);
                    }
                });
                log(`launched Chrome ${found.channel}${features.length ? ` with ${features.join(', ')}` : ''}`);
                return send({ type: 'launched', channel: found.channel });
            }
            case 'cdp': {
                if (!browser || !relay) return send({ type: 'error', code: 'no-browser' });
                const decision = relay.fromPage(JSON.stringify(message.message ?? null));
                if (decision.toPage) send({ type: 'cdp', message: JSON.parse(decision.toPage) });
                if (decision.toBrowser) browser.send(decision.toBrowser);
                return;
            }
            case 'close': {
                const { netLog } = await closeBrowser();
                log(`closed the browser${netLog !== null ? `, NetLog ${netLog.length.toLocaleString()} characters` : ''}`);
                return reportClosed(netLog);
            }
            default:
                return send({ type: 'error', code: 'unknown-message' });
        }
    };

    const onData = (/** @type {Buffer} */ chunk) => {
        received += chunk.length;
        if (!paired && received > PRE_AUTH_MAX_BYTES) {
            finish(CLOSE.tooBig, 'too much data before pairing');
            return;
        }
        let messages;
        try {
            messages = decoder.push(new Uint8Array(chunk));
        } catch {
            finish(CLOSE.protocol, 'bad frame');
            return;
        }
        for (const { opcode, payload } of messages) {
            if (ended) return;
            if (opcode === OPCODE.CLOSE) {
                finish(1000, 'bye');
                return;
            }
            if (opcode === OPCODE.PING) {
                socket.write(encodeFrame(OPCODE.PONG, payload, null));
                continue;
            }
            if (opcode !== OPCODE.TEXT) {
                if (!paired) finish(CLOSE.badSecret, 'not paired');
                continue;
            }
            let message;
            try {
                message = JSON.parse(Buffer.from(payload).toString('utf8'));
            } catch {
                if (!paired) finish(CLOSE.badSecret, 'not paired');
                continue;
            }
            onControl(message).catch(() => finish(CLOSE.protocol, 'internal error'));
        }
    };

    socket.on('data', onData);
    socket.on('error', () => finish(1006, 'socket error'));
    // The HTTP server leaves upgraded sockets half-open, so a page that goes away sends 'end'
    // and 'close' may never come. Either one ends the session, frees the slot and closes Chrome.
    socket.on('end', () => finish(1006, 'peer went away'));
    socket.on('close', () => finish(1006, 'socket closed'));
    if (head?.length) onData(head);
    return () => finish(1001, 'helper stopping');
}
