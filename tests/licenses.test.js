import { describe, expect, it } from 'vitest';
import { isAllowed } from '../scripts/check-licenses.js';

describe('licence expressions', () => {
    it.each(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'BlueOak-1.0.0'])('allows %s', (id) => {
        expect(isAllowed(id)).toBe(true);
    });

    it.each(['GPL-3.0-only', 'GPL-2.0-or-later', 'LGPL-3.0-or-later', 'AGPL-3.0', 'CC0-1.0', 'Unlicense', 'UNLICENSED', 'SEE LICENSE IN LICENSE.txt', ''])('refuses %j', (id) => {
        expect(isAllowed(id)).toBe(false);
    });

    it('needs only one side of an OR', () => {
        expect(isAllowed('MIT OR Apache-2.0')).toBe(true);
        expect(isAllowed('(MIT OR GPL-3.0-only)')).toBe(true);
        expect(isAllowed('GPL-2.0-only OR GPL-3.0-only')).toBe(false);
    });

    it('needs both sides of an AND', () => {
        expect(isAllowed('MIT AND ISC')).toBe(true);
        expect(isAllowed('Apache-2.0 AND LGPL-3.0-or-later')).toBe(false);
        expect(isAllowed('Apache-2.0 AND LGPL-3.0-or-later AND MIT')).toBe(false);
    });

    it('respects parentheses', () => {
        expect(isAllowed('(MIT AND GPL-3.0-only) OR ISC')).toBe(true);
        expect(isAllowed('MIT AND (GPL-3.0-only OR ISC)')).toBe(true);
        expect(isAllowed('MIT AND (GPL-3.0-only OR LGPL-3.0-only)')).toBe(false);
    });
});
