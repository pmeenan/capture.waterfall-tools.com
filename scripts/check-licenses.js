// The dependency licence gate (D-002, D-025). Every package in the lockfile must declare a licence
// on the allowed list. For packages that are installed, the licence is read from the package's own
// package.json; for ones the lockfile lists but this platform did not install (optional, per-OS
// binaries), the lockfile's record is used so the gate gives the same answer on every machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * SPDX identifiers that satisfy the dependency policy: MIT, BSD, Apache-2.0, ISC and MPL terms
 * (D-002), plus BlueOak-1.0.0, which the project owner added for any dependency (D-026).
 */
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MPL-2.0', 'BlueOak-1.0.0']);

/**
 * Packages allowed despite a licence outside the list. Each entry is a decision by the project
 * owner and says why; an agent must not add or widen one on its own (AGENTS.md).
 *
 * Both entries below cover packages that arrive only through wrangler, the deploy tool. They are
 * development tooling and must never be part of anything this project ships (D-026).
 * @type {{match: RegExp, reason: string}[]}
 */
const EXCEPTIONS = [
    { match: /^@img\/sharp(-|$)/, reason: 'LGPL-3.0 image libraries pulled in by wrangler via miniflare; deploy tooling only (D-026)' },
    { match: /^@speed-highlight\/core$/, reason: 'CC0-1.0 package pulled in by wrangler via miniflare; deploy tooling only (D-026)' },
];

/**
 * Is an SPDX expression satisfied by the allowed list? `OR` needs one side, `AND` needs both.
 * @param {string} expression
 * @returns {boolean}
 */
export function isAllowed(expression) {
    const text = expression.trim();
    if (!text) return false;
    const parts = splitTopLevel(text, ' OR ');
    if (parts.length > 1) return parts.some(isAllowed);
    const all = splitTopLevel(text, ' AND ');
    if (all.length > 1) return all.every(isAllowed);
    if (text.startsWith('(') && text.endsWith(')')) return isAllowed(text.slice(1, -1));
    return ALLOWED.has(text);
}

/**
 * Split on a separator, ignoring separators inside parentheses.
 * @param {string} text
 * @param {string} separator
 */
function splitTopLevel(text, separator) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        else if (depth === 0 && text.startsWith(separator, i)) {
            parts.push(text.slice(start, i));
            start = i + separator.length;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/**
 * The licence a package.json declares, in SPDX form where possible.
 *
 * The old `licenses` array never said whether its entries were alternatives or all applied at
 * once, and packages used it both ways. It is read as "all apply": that can refuse a package
 * that would have been fine, and can never admit one that is not.
 * @param {any} pkg
 * @returns {string}
 */
export function declaredLicense(pkg) {
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
    if (Array.isArray(pkg.licenses)) return pkg.licenses.map((/** @type {any} */ l) => `(${typeof l === 'string' ? l : (l?.type ?? '')})`).join(' AND ');
    return '';
}

/**
 * The gate's answer for one package.
 * @param {object} pkg
 * @param {string} pkg.name
 * @param {string} pkg.license the declared licence expression
 * @param {boolean} pkg.devOnly reached only through development dependencies, per the lockfile
 * @returns {'allowed' | 'excepted' | 'refused'}
 */
export function judge({ name, license, devOnly }) {
    if (isAllowed(license)) return 'allowed';
    // The exceptions are for development tooling (D-026). The same package arriving as a
    // dependency of something that ships is not covered by them.
    if (devOnly && EXCEPTIONS.some((exception) => exception.match.test(name))) return 'excepted';
    return 'refused';
}

function main() {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    /** @type {string[]} */
    const failures = [];
    /** @type {string[]} */
    const excepted = [];
    let checked = 0;
    let fromLockOnly = 0;
    for (const [location, entry] of Object.entries(/** @type {Record<string, any>} */ (lock.packages))) {
        if (!location.includes('node_modules/') || entry.link) continue; // the root, the workspaces, and their symlinks
        const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
        const manifest = path.join(root, location, 'package.json');
        const installed = fs.existsSync(manifest);
        const license = installed ? declaredLicense(JSON.parse(fs.readFileSync(manifest, 'utf8'))) : typeof entry.license === 'string' ? entry.license : '';
        if (!installed) fromLockOnly++;
        checked++;
        // npm marks a package `dev` only when nothing outside devDependencies reaches it.
        const verdict = judge({ name, license, devOnly: entry.dev === true });
        if (verdict === 'excepted') excepted.push(`${name}@${entry.version}: ${license}`);
        else if (verdict === 'refused') failures.push(`${name}@${entry.version}: ${license || '(no licence declared)'}`);
    }
    if (failures.length) {
        console.error(`Licence gate FAILED: ${failures.length} of ${checked} packages are outside the allowed list (${[...ALLOWED].join(', ')}):`);
        for (const line of failures.sort()) console.error('  ' + line);
        console.error('Replace the dependency, or ask the project owner for an exception in scripts/check-licenses.js.');
        process.exit(1);
    }
    console.log(`Licence gate passed: ${checked} packages (${fromLockOnly} not installed on this platform, checked from the lockfile).`);
    if (excepted.length) console.log(`Allowed by a recorded exception, development tooling only (${excepted.length}):\n  ${excepted.sort().join('\n  ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
