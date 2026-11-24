import { describe, expect, it } from 'vitest';
import { declaredLicense, isAllowed, judge } from '../scripts/check-licenses.js';

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

describe('declared licence', () => {
    it('reads the modern field and the old object form', () => {
        expect(declaredLicense({ license: 'MIT' })).toBe('MIT');
        expect(declaredLicense({ license: { type: 'ISC', url: 'https://example.com' } })).toBe('ISC');
        expect(declaredLicense({})).toBe('');
    });

    it('reads the old licenses array as "all apply", so a mixed package cannot slip through', () => {
        expect(isAllowed(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }))).toBe(true);
        expect(isAllowed(declaredLicense({ licenses: ['MIT'] }))).toBe(true);
        expect(isAllowed(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'GPL-3.0-only' }] }))).toBe(false);
        expect(isAllowed(declaredLicense({ licenses: ['MIT OR GPL-3.0-only', 'ISC'] }))).toBe(true);
        expect(isAllowed(declaredLicense({ licenses: [{ type: 'MIT' }, {}] }))).toBe(false);
        expect(isAllowed(declaredLicense({ licenses: [] }))).toBe(false);
    });
});

describe('recorded exceptions', () => {
    const sharp = { name: '@img/sharp-libvips-linux-x64', license: 'LGPL-3.0-or-later' };

    it('cover a package only while it is development tooling', () => {
        expect(judge({ ...sharp, devOnly: true })).toBe('excepted');
        expect(judge({ ...sharp, devOnly: false })).toBe('refused');
        expect(judge({ name: '@speed-highlight/core', license: 'CC0-1.0', devOnly: false })).toBe('refused');
    });

    it('do not reach other packages, and are not needed by allowed ones', () => {
        expect(judge({ name: 'some-gpl-thing', license: 'GPL-3.0-only', devOnly: true })).toBe('refused');
        expect(judge({ name: '@img/sharp-win32-x64', license: 'Apache-2.0', devOnly: false })).toBe('allowed');
    });
});
