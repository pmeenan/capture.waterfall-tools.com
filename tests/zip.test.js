import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '@capture/shared/zip';

const ascii = (/** @type {string} */ s) => new TextEncoder().encode(s);
const when = new Date('2026-11-23T12:34:56Z');

describe('crc32', () => {
    it('matches the standard check value', () => {
        expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });
});

describe('createZip', () => {
    it('produces an archive an independent zip reader can open', () => {
        const big = new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff);
        const zip = createZip(
            [
                { name: 'manifest.json', data: ascii('{"a":1}') },
                { name: 'runs/1/trace.json.gz', data: big },
                { name: 'empty.bin', data: new Uint8Array(0) },
                { name: 'runs/1/naïve-名前.txt', data: ascii('utf-8 name') },
            ],
            when,
        );
        const files = unzipSync(zip);
        expect(Object.keys(files)).toEqual(['manifest.json', 'runs/1/trace.json.gz', 'empty.bin', 'runs/1/naïve-名前.txt']);
        expect(new TextDecoder().decode(files['manifest.json'])).toBe('{"a":1}');
        expect(files['runs/1/trace.json.gz']).toEqual(big);
        expect(files['empty.bin'].length).toBe(0);
    });

    it('stores entries uncompressed, at a predictable offset', () => {
        const payload = ascii('PAYLOAD-BYTES-AS-STORED');
        const zip = createZip([{ name: 'a.bin', data: payload }], when);
        const view = new DataView(zip.buffer);
        expect(view.getUint32(0, true)).toBe(0x04034b50);
        expect(view.getUint16(8, true)).toBe(0); // method: stored
        // A range reader can find the bytes directly: header (30) + name length.
        expect(zip.subarray(30 + 5, 30 + 5 + payload.length)).toEqual(payload);
    });

    it('is deterministic for the same input and time', () => {
        const entries = [{ name: 'x', data: ascii('same') }];
        expect(createZip(entries, when)).toEqual(createZip(entries, when));
    });

    it('writes an empty but valid archive', () => {
        const zip = createZip([], when);
        expect(zip.length).toBe(22);
        expect(unzipSync(zip)).toEqual({});
    });

    it.each(['', '/absolute.txt', '../escape.txt', 'a/../../b.txt', 'back\\slash.txt'])('refuses the unsafe name %j', (name) => {
        expect(() => createZip([{ name, data: new Uint8Array(1) }], when)).toThrow(/unsafe/);
    });

    it('refuses a name too long for its 16-bit length field', () => {
        expect(() => createZip([{ name: 'a'.repeat(0x10000), data: new Uint8Array(1) }], when)).toThrow(/too long/);
        // The limit is on encoded bytes, not characters: 21846 three-byte characters are 65538 bytes.
        expect(() => createZip([{ name: '€'.repeat(21846), data: new Uint8Array(1) }], when)).toThrow(/too long/);
        expect(Object.keys(unzipSync(createZip([{ name: 'a'.repeat(0xffff), data: new Uint8Array(1) }], when)))[0]).toHaveLength(0xffff);
    });

    it('refuses duplicate names', () => {
        expect(() =>
            createZip(
                [
                    { name: 'a', data: new Uint8Array(1) },
                    { name: 'a', data: new Uint8Array(1) },
                ],
                when,
            ),
        ).toThrow(/duplicate/);
    });
});
