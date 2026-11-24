/**
 * WebSocket client framing (RFC 6455) over a raw byte stream.
 *
 * Chrome's DevTools socket on Android is reached through ADB as a plain byte
 * pipe, so the page has to write the HTTP upgrade and the WebSocket frames
 * itself (docs/rough-edges.md RE-007). Because the page writes the handshake,
 * no Origin header is sent and Chrome's remote-debugging origin check does not
 * apply.
 *
 * This module only converts between bytes and messages; it does no I/O.
 */

export const OPCODE = Object.freeze({ CONTINUATION: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The HTTP request that asks the DevTools socket to switch to WebSocket.
 * @param {object} options
 * @param {string} options.path for example `/devtools/browser`
 * @param {string} options.key 16 random bytes, base64-encoded
 * @param {string} [options.host]
 * @returns {Uint8Array}
 */
export function buildUpgradeRequest({ path, key, host = 'localhost' }) {
    return encoder.encode(
        `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
}

/**
 * Find the end of an HTTP header block.
 * @param {Uint8Array} bytes
 * @returns {number} index just past the blank line, or -1 if it has not arrived yet
 */
export function findHeaderEnd(bytes) {
    for (let i = 3; i < bytes.length; i++) {
        if (bytes[i] === 10 && bytes[i - 1] === 13 && bytes[i - 2] === 10 && bytes[i - 3] === 13) return i + 1;
    }
    return -1;
}

/**
 * Read the status line of an HTTP response.
 * @param {Uint8Array} headerBytes the header block, as delimited by {@link findHeaderEnd}
 * @returns {{status: number, statusLine: string, switched: boolean}}
 */
export function parseUpgradeResponse(headerBytes) {
    const statusLine = decoder.decode(headerBytes).split('\r\n')[0] ?? '';
    const match = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
    const status = match ? Number(match[1]) : 0;
    return { status, statusLine, switched: status === 101 };
}

/**
 * Encode one frame. A client always masks its frames; a server never does (RFC 6455 5.1), so
 * the helper's WebSocket server passes `null`. The mask is required, not optional, so client
 * code cannot send an unmasked frame by leaving it out.
 * @param {number} opcode
 * @param {Uint8Array} payload
 * @param {Uint8Array | null} mask 4 random bytes for a client frame, `null` for a server frame
 * @returns {Uint8Array}
 */
export function encodeFrame(opcode, payload, mask) {
    if (mask !== null && mask.length !== 4) throw new Error('a WebSocket mask is exactly 4 bytes');
    const maskBytes = mask === null ? 0 : 4;
    const maskBit = mask === null ? 0 : 0x80;
    const n = payload.length;
    const lengthBytes = n < 126 ? 0 : n < 65536 ? 2 : 8;
    const frame = new Uint8Array(2 + lengthBytes + maskBytes + n);
    frame[0] = 0x80 | opcode; // FIN + opcode: messages are never fragmented on send
    if (lengthBytes === 0) {
        frame[1] = maskBit | n;
    } else if (lengthBytes === 2) {
        frame[1] = maskBit | 126;
        frame[2] = n >>> 8;
        frame[3] = n & 0xff;
    } else {
        frame[1] = maskBit | 127;
        new DataView(frame.buffer).setBigUint64(2, BigInt(n));
    }
    const body = 2 + lengthBytes + maskBytes;
    if (mask === null) {
        frame.set(payload, body);
    } else {
        frame.set(mask, 2 + lengthBytes);
        for (let i = 0; i < n; i++) frame[body + i] = payload[i] ^ mask[i & 3];
    }
    return frame;
}

/**
 * Encode a text message.
 * @param {string} text
 * @param {Uint8Array | null} mask 4 random bytes for a client, `null` for a server
 * @returns {Uint8Array}
 */
export function encodeText(text, mask) {
    return encodeFrame(OPCODE.TEXT, encoder.encode(text), mask);
}

/**
 * @typedef {object} WsMessage
 * @property {number} opcode TEXT or BINARY for data, or CLOSE / PING / PONG
 * @property {Uint8Array} payload for a fragmented message, the reassembled whole
 */

/**
 * Turns a stream of bytes from the server into whole messages. Handles frames
 * split across chunks, 16- and 64-bit lengths, fragmented messages, and
 * control frames arriving in the middle of a fragmented message.
 */
export class FrameDecoder {
    /** @type {Uint8Array[]} */
    #chunks = [];
    #buffered = 0;
    /** @type {Uint8Array[]} */
    #fragments = [];
    #fragmentOpcode = 0;

    /**
     * @param {Uint8Array} chunk
     * @returns {WsMessage[]} every message completed by this chunk, in order
     */
    push(chunk) {
        if (chunk.length) {
            this.#chunks.push(chunk);
            this.#buffered += chunk.length;
        }
        /** @type {WsMessage[]} */
        const messages = [];
        for (;;) {
            const frame = this.#takeFrame();
            if (!frame) break;
            if (frame.opcode >= 8) {
                messages.push({ opcode: frame.opcode, payload: frame.payload });
                continue;
            }
            if (frame.opcode !== OPCODE.CONTINUATION) this.#fragmentOpcode = frame.opcode;
            this.#fragments.push(frame.payload);
            if (frame.fin) {
                messages.push({ opcode: this.#fragmentOpcode, payload: concat(this.#fragments) });
                this.#fragments = [];
            }
        }
        return messages;
    }

    /** @returns {{fin: boolean, opcode: number, payload: Uint8Array} | null} */
    #takeFrame() {
        if (this.#buffered < 2) return null;
        const head = this.#peek(Math.min(this.#buffered, 14));
        const masked = (head[1] & 0x80) !== 0;
        let length = head[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
            if (head.length < 4) return null;
            length = (head[2] << 8) | head[3];
            offset = 4;
        } else if (length === 127) {
            if (head.length < 10) return null;
            const big = new DataView(head.buffer, head.byteOffset, head.byteLength).getBigUint64(2);
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame too large');
            length = Number(big);
            offset = 10;
        }
        const total = offset + (masked ? 4 : 0) + length;
        if (this.#buffered < total) return null;
        const bytes = this.#take(total);
        const payload = bytes.subarray(total - length);
        if (masked) {
            const mask = bytes.subarray(offset, offset + 4);
            for (let i = 0; i < length; i++) payload[i] ^= mask[i & 3];
        }
        return { fin: (bytes[0] & 0x80) !== 0, opcode: bytes[0] & 0x0f, payload };
    }

    /**
     * Copy the first `n` buffered bytes without consuming them.
     * @param {number} n
     */
    #peek(n) {
        const out = new Uint8Array(n);
        let filled = 0;
        for (const chunk of this.#chunks) {
            const k = Math.min(chunk.length, n - filled);
            out.set(chunk.subarray(0, k), filled);
            filled += k;
            if (filled === n) break;
        }
        return out;
    }

    /**
     * Remove and return the first `n` buffered bytes as one array.
     * @param {number} n
     */
    #take(n) {
        const out = new Uint8Array(n);
        let filled = 0;
        // Used-up chunks are dropped in one go at the end. Shifting them off one at a time made a
        // large frame that arrived in small pieces take quadratic time: 34 s for 16 MB in 64-byte
        // chunks.
        let used = 0;
        while (filled < n) {
            const chunk = this.#chunks[used];
            const k = Math.min(chunk.length, n - filled);
            out.set(chunk.subarray(0, k), filled);
            filled += k;
            if (k === chunk.length) used++;
            else this.#chunks[used] = chunk.subarray(k);
        }
        this.#chunks.splice(0, used);
        this.#buffered -= n;
        return out;
    }
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concat(parts) {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
