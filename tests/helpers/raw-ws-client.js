/**
 * A WebSocket client over a raw TCP socket, for attacking the helper in tests: it sends whatever
 * Host and Origin it is told to (or none), which browsers and Node's WebSocket never allow.
 */

import crypto from 'node:crypto';
import net from 'node:net';
import { FrameDecoder, OPCODE, encodeText, findHeaderEnd } from '@capture/shared/ws-framing';

/**
 * @typedef {object} RawWs
 * @property {number} status HTTP status of the upgrade reply (101 when it upgraded)
 * @property {(message: object) => void} sendJson
 * @property {(bytes: Uint8Array) => void} sendRaw
 * @property {() => Promise<any>} nextJson the next text message, parsed
 * @property {Promise<{code: number | null, reason: string}>} closed resolves when the server closes
 * @property {() => void} destroy
 */

/**
 * @param {object} options
 * @param {number} options.port
 * @param {string | null} [options.host] Host header value; null leaves it out
 * @param {string | null} [options.origin] Origin header value; null leaves it out
 * @param {string} [options.path]
 * @returns {Promise<RawWs>}
 */
export function connectRaw({ port, host = `127.0.0.1:${port}`, origin = null, path = '/' }) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        const key = crypto.randomBytes(16).toString('base64');
        const headers = [
            `GET ${path} HTTP/1.1`,
            ...(host !== null ? [`Host: ${host}`] : []),
            ...(origin !== null ? [`Origin: ${origin}`] : []),
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            '', '',
        ];
        socket.write(headers.join('\r\n'));
        let buffered = Buffer.alloc(0);
        let upgraded = false;
        const decoder = new FrameDecoder();
        /** @type {any[]} */
        const inbox = [];
        /** @type {((m: any) => void)[]} */
        const waiters = [];
        /** @type {(v: {code: number | null, reason: string}) => void} */
        let resolveClosed = () => {};
        const closed = new Promise((r) => { resolveClosed = r; });
        let closeInfo = { code: /** @type {number | null} */ (null), reason: '' };

        const deliver = (/** @type {any} */ m) => {
            const w = waiters.shift();
            if (w) w(m); else inbox.push(m);
        };
        socket.on('data', (/** @type {Buffer} */ chunk) => {
            if (!upgraded) {
                buffered = Buffer.concat([buffered, chunk]);
                const end = findHeaderEnd(new Uint8Array(buffered));
                if (end < 0) return;
                const statusLine = buffered.subarray(0, end).toString('latin1').split('\r\n')[0];
                const status = Number(statusLine.split(' ')[1]);
                upgraded = true;
                const rest = buffered.subarray(end);
                resolve(api(status));
                if (rest.length) onFrames(rest);
                return;
            }
            onFrames(chunk);
        });
        const onFrames = (/** @type {Buffer} */ chunk) => {
            for (const { opcode, payload } of decoder.push(new Uint8Array(chunk))) {
                if (opcode === OPCODE.CLOSE) {
                    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
                    closeInfo = { code: payload.length >= 2 ? view.getUint16(0) : null, reason: Buffer.from(payload.subarray(2)).toString('utf8') };
                } else if (opcode === OPCODE.TEXT) {
                    deliver(JSON.parse(Buffer.from(payload).toString('utf8')));
                }
            }
        };
        socket.on('close', () => { resolveClosed(closeInfo); deliver(null); });
        socket.on('error', (e) => { if (!upgraded) reject(e); });

        const mask = () => new Uint8Array(crypto.randomBytes(4));
        /** @param {number} status @returns {RawWs} */
        const api = (status) => ({
            status,
            sendJson: (m) => socket.write(encodeText(JSON.stringify(m), mask())),
            sendRaw: (bytes) => socket.write(bytes),
            nextJson: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r))),
            closed,
            destroy: () => socket.destroy(),
        });
    });
}
