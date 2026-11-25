// Serves dist/site on loopback the way production does, including the response headers in
// site/public/_headers, so the built site can be tried under its real Content-Security-Policy.
// usage: node scripts/preview.js [port] [--viewer <loopback origin>]
//   --viewer adds a viewer served on loopback (the submodule's dev viewer) to frame-src, for this
//   preview only, so the deployed policy never names it (architecture §3.11). Open the page with
//   ?viewer=<the same origin> to use it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../dist/site', import.meta.url));
const args = process.argv.slice(2);
const viewerAt = args.indexOf('--viewer');
const localViewer = viewerAt >= 0 ? new URL(args.splice(viewerAt, 2)[1] ?? '').origin : null;
if (localViewer && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(localViewer).hostname)) {
    console.error('--viewer must be a loopback origin');
    process.exit(2);
}
const port = Number(args[0] ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gz': 'application/gzip', '.zip': 'application/zip', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

/**
 * Parse the subset of Cloudflare's _headers format this project uses: a path
 * pattern on its own line, then indented `Name: value` lines.
 * @returns {{pattern: string, headers: [string, string][]}[]}
 */
function readHeaderRules() {
    const file = path.join(out, '_headers');
    if (!fs.existsSync(file)) return [];
    /** @type {{pattern: string, headers: [string, string][]}[]} */
    const rules = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
        else if (rules.length) {
            const i = line.indexOf(':');
            rules[rules.length - 1].headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
        }
    }
    return rules;
}

/** @param {string} pattern @param {string} pathname */
const matches = (pattern, pathname) => (pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pattern === pathname);

if (!fs.existsSync(path.join(out, 'index.html'))) {
    console.error('dist/site is missing: run "npm run build" first');
    process.exit(1);
}
const rules = readHeaderRules();
http.createServer((req, res) => {
    let pathname = '';
    try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
        // a malformed escape: falls through to "not found"
    }
    const file = path.join(out, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
    if (!pathname || !file.startsWith(out + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || path.basename(file) === '_headers') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
    }
    /** @type {Record<string, string>} */
    const headers = { 'content-type': types[/** @type {keyof typeof types} */ (path.extname(file))] ?? 'application/octet-stream' };
    for (const rule of rules) if (matches(rule.pattern, pathname)) for (const [name, value] of rule.headers) headers[name.toLowerCase()] = value;
    if (localViewer && headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].replace(/frame-src ([^;]*)/, `frame-src $1 ${localViewer}`);
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`previewing dist/site at http://localhost:${port} with ${rules.length} header rule(s)${localViewer ? `, viewer ${localViewer} allowed in frames` : ''}`));
