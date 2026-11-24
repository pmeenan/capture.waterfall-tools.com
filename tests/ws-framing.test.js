import { describe, expect, it } from 'vitest';
import { FrameDecoder, OPCODE, buildUpgradeRequest, encodeFrame, encodeText, findHeaderEnd, parseUpgradeResponse } from '@capture/shared/ws-framing';

const bytes = (/** @type {number[]} */ ...values) => new Uint8Array(values);
const text = (/** @type {Uint8Array} */ payload) => new TextDecoder().decode(payload);
const ascii = (/** @type {string} */ s) => new TextEncoder().encode(s);

/** An unmasked server frame, built independently of the code under test. */
function serverFrame(/** @type {number} */ firstByte, /** @type {Uint8Array} */ payload) {
    const n = payload.length;
    const header = n < 126 ? [firstByte, n] : n < 65536 ? [firstByte, 126, n >>> 8, n & 0xff] : [firstByte, 127, 0, 0, 0, 0, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const out = new Uint8Array(header.length + n);
    out.set(header);
    out.set(payload, header.length);
    return out;
}

describe('WebSocket upgrade', () => {
    it('builds the request Chrome expects, with no Origin header', () => {
        const request = text(buildUpgradeRequest({ path: '/devtools/browser', key: 'dGhlIHNhbXBsZSBub25jZQ==' }));
        expect(request).toBe(
            'GET /devtools/browser HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        );
        expect(request).not.toMatch(/origin/i);
    });

    it('finds the end of the header block, even with data after it', () => {
        const response = ascii('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\nEXTRA');
        const end = findHeaderEnd(response);
        expect(text(response.subarray(end))).toBe('EXTRA');
        expect(findHeaderEnd(ascii('HTTP/1.1 101 Switching Protocols\r\nUpgrade: web'))).toBe(-1);
    });

    it('recognises a successful switch and a refusal', () => {
        expect(parseUpgradeResponse(ascii('HTTP/1.1 101 Switching Protocols\r\n\r\n'))).toMatchObject({ status: 101, switched: true });
        expect(parseUpgradeResponse(ascii('HTTP/1.1 403 Forbidden\r\n\r\n'))).toMatchObject({ status: 403, switched: false });
        expect(parseUpgradeResponse(ascii('garbage'))).toMatchObject({ status: 0, switched: false });
    });
});

describe('encodeFrame', () => {
    it('matches the masked "Hello" example in RFC 6455 section 5.7', () => {
        expect(encodeText('Hello', bytes(0x37, 0xfa, 0x21, 0x3d))).toEqual(bytes(0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58));
    });

    it('uses a 16-bit length from 126 bytes and a 64-bit length from 65536', () => {
        const mask = bytes(1, 2, 3, 4);
        const medium = encodeFrame(OPCODE.BINARY, new Uint8Array(126), mask);
        expect([...medium.subarray(0, 4)]).toEqual([0x82, 0x80 | 126, 0, 126]);
        expect(medium.length).toBe(4 + 4 + 126);
        const large = encodeFrame(OPCODE.BINARY, new Uint8Array(65536), mask);
        expect([...large.subarray(0, 10)]).toEqual([0x82, 0x80 | 127, 0, 0, 0, 0, 0, 1, 0, 0]);
        expect(large.length).toBe(10 + 4 + 65536);
    });

    it('rejects a mask that is not four bytes', () => {
        expect(() => encodeFrame(OPCODE.TEXT, new Uint8Array(1), bytes(1, 2, 3))).toThrow();
    });
});

describe('FrameDecoder', () => {
    it('decodes the unmasked "Hello" example in RFC 6455 section 5.7', () => {
        const [message] = new FrameDecoder().push(bytes(0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f));
        expect(message.opcode).toBe(OPCODE.TEXT);
        expect(text(message.payload)).toBe('Hello');
    });

    it('reassembles the fragmented "Hello" example', () => {
        const decoder = new FrameDecoder();
        expect(decoder.push(bytes(0x01, 0x03, 0x48, 0x65, 0x6c))).toEqual([]);
        const [message] = decoder.push(bytes(0x80, 0x02, 0x6c, 0x6f));
        expect(message.opcode).toBe(OPCODE.TEXT);
        expect(text(message.payload)).toBe('Hello');
    });

    it('delivers a ping that arrives in the middle of a fragmented message', () => {
        const decoder = new FrameDecoder();
        const messages = decoder.push(new Uint8Array([...serverFrame(0x01, ascii('Hel')), ...serverFrame(0x89, ascii('p')), ...serverFrame(0x80, ascii('lo'))]));
        expect(messages.map((m) => [m.opcode, text(m.payload)])).toEqual([
            [OPCODE.PING, 'p'],
            [OPCODE.TEXT, 'Hello'],
        ]);
    });

    it('copes with a frame delivered one byte at a time', () => {
        const decoder = new FrameDecoder();
        const frame = serverFrame(0x81, ascii('x'.repeat(300)));
        /** @type {import('@capture/shared/ws-framing').WsMessage[]} */
        const messages = [];
        for (const byte of frame) messages.push(...decoder.push(bytes(byte)));
        expect(messages).toHaveLength(1);
        expect(text(messages[0].payload)).toBe('x'.repeat(300));
    });

    it('decodes several frames from one chunk, and a frame split across chunks', () => {
        const decoder = new FrameDecoder();
        const stream = new Uint8Array([...serverFrame(0x81, ascii('one')), ...serverFrame(0x81, ascii('two')), ...serverFrame(0x81, ascii('three'))]);
        const first = decoder.push(stream.subarray(0, 12));
        const second = decoder.push(stream.subarray(12));
        expect([...first, ...second].map((m) => text(m.payload))).toEqual(['one', 'two', 'three']);
    });

    it('decodes 16-bit and 64-bit lengths', () => {
        const medium = new Uint8Array(1000).fill(7);
        const large = new Uint8Array(70000).fill(9);
        const decoder = new FrameDecoder();
        const [a] = decoder.push(serverFrame(0x82, medium));
        const [b] = decoder.push(serverFrame(0x82, large));
        expect(a.payload).toEqual(medium);
        expect(b.payload.length).toBe(70000);
        expect(b.payload.every((v) => v === 9)).toBe(true);
    });

    it('round-trips what the encoder produces, unmasking it', () => {
        const payload = ascii('{"id":1,"method":"Browser.getVersion"}');
        const [message] = new FrameDecoder().push(encodeFrame(OPCODE.TEXT, payload, bytes(0xde, 0xad, 0xbe, 0xef)));
        expect(message.payload).toEqual(payload);
    });

    it('delivers a close frame', () => {
        const [message] = new FrameDecoder().push(serverFrame(0x88, bytes(0x03, 0xe8)));
        expect(message.opcode).toBe(OPCODE.CLOSE);
        expect([...message.payload]).toEqual([0x03, 0xe8]);
    });

    it('handles empty payloads and empty chunks', () => {
        const decoder = new FrameDecoder();
        expect(decoder.push(new Uint8Array(0))).toEqual([]);
        const [message] = decoder.push(bytes(0x81, 0x00));
        expect(message.payload.length).toBe(0);
    });
});
