/**
 * A minimal zip writer that stores entries without compressing them.
 *
 * The result artifact holds payloads that are already compressed (gzipped
 * traces, MP4 video), and storing them as-is lets a reader fetch one member
 * with an HTTP range request instead of the whole archive (docs/features.md,
 * "STORE-mode entries"). That makes a general-purpose zip library unnecessary.
 *
 * Limits, checked rather than silently exceeded: no zip64, so the archive and
 * each entry must be under 4 GiB and there can be at most 65,535 entries.
 */

const encoder = new TextEncoder();

/** @type {Uint32Array | null} */
let crcTable = null;

/**
 * CRC-32 as used by zip and gzip.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit value
 */
export function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name path inside the archive, with forward slashes
 * @property {Uint8Array} data
 */

/**
 * Build a zip archive in memory.
 * @param {ZipEntry[]} entries
 * @param {Date} [modified] timestamp written on every entry
 * @returns {Uint8Array}
 */
export function createZip(entries, modified = new Date()) {
    if (entries.length > 0xffff) throw new Error('too many entries for a zip without zip64');
    const { time, date } = dosDateTime(modified);
    const seen = new Set();
    /** @type {{name: Uint8Array, data: Uint8Array, crc: number, offset: number}[]} */
    const records = [];
    let offset = 0;
    for (const entry of entries) {
        if (!entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) {
            throw new Error(`unsafe zip entry name: ${JSON.stringify(entry.name)}`);
        }
        if (seen.has(entry.name)) throw new Error(`duplicate zip entry name: ${entry.name}`);
        seen.add(entry.name);
        const name = encoder.encode(entry.name);
        if (name.length > 0xffff) throw new Error('zip entry name too long');
        records.push({ name, data: entry.data, crc: crc32(entry.data), offset });
        offset += 30 + name.length + entry.data.length;
    }
    const directoryOffset = offset;
    const directorySize = records.reduce((sum, r) => sum + 46 + r.name.length, 0);
    const total = directoryOffset + directorySize + 22;
    if (total > 0xffffffff) throw new Error('archive too large for a zip without zip64');

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let at = 0;
    for (const r of records) {
        view.setUint32(at, 0x04034b50, true); // local file header
        view.setUint16(at + 4, 10, true); // version needed: 1.0, stored
        view.setUint16(at + 6, 0x0800, true); // flags: names are UTF-8
        view.setUint16(at + 8, 0, true); // method: stored
        view.setUint16(at + 10, time, true);
        view.setUint16(at + 12, date, true);
        view.setUint32(at + 14, r.crc, true);
        view.setUint32(at + 18, r.data.length, true); // compressed size
        view.setUint32(at + 22, r.data.length, true); // uncompressed size
        view.setUint16(at + 26, r.name.length, true);
        view.setUint16(at + 28, 0, true); // extra field length
        out.set(r.name, at + 30);
        out.set(r.data, at + 30 + r.name.length);
        at += 30 + r.name.length + r.data.length;
    }
    for (const r of records) {
        view.setUint32(at, 0x02014b50, true); // central directory header
        view.setUint16(at + 4, 20, true); // version made by
        view.setUint16(at + 6, 10, true); // version needed
        view.setUint16(at + 8, 0x0800, true);
        view.setUint16(at + 10, 0, true);
        view.setUint16(at + 12, time, true);
        view.setUint16(at + 14, date, true);
        view.setUint32(at + 16, r.crc, true);
        view.setUint32(at + 20, r.data.length, true);
        view.setUint32(at + 24, r.data.length, true);
        view.setUint16(at + 28, r.name.length, true);
        // extra length, comment length, disk number, internal and external attributes stay zero
        view.setUint32(at + 42, r.offset, true);
        out.set(r.name, at + 46);
        at += 46 + r.name.length;
    }
    view.setUint32(at, 0x06054b50, true); // end of central directory
    view.setUint16(at + 8, records.length, true);
    view.setUint16(at + 10, records.length, true);
    view.setUint32(at + 12, directorySize, true);
    view.setUint32(at + 16, directoryOffset, true);
    return out;
}

/**
 * MS-DOS date and time fields, in UTC so the same input always gives the same archive.
 * @param {Date} when
 */
function dosDateTime(when) {
    const year = Math.min(Math.max(when.getUTCFullYear(), 1980), 2107);
    return {
        time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    };
}
