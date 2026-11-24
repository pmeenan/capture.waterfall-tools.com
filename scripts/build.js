// Builds the capture site into dist/site (D-025): Rollup for the script, plain copies for the rest.
// Output file names carry a content hash so they can be cached forever; index.html is the only
// file that changes name-for-name between builds.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = path.join(root, 'site');
const out = path.join(root, 'dist', 'site');

/**
 * Replace exactly one occurrence, and fail loudly if index.html no longer has it.
 * @param {string} html
 * @param {string} from
 * @param {string} to
 */
function swap(html, from, to) {
    if (html.split(from).length !== 2) throw new Error(`build: expected exactly one "${from}" in site/index.html`);
    return html.replace(from, to);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.cpSync(path.join(site, 'public'), out, { recursive: true });

const bundle = await rollup({ input: path.join(site, 'src', 'main.js'), plugins: [nodeResolve()] });
const { output } = await bundle.write({ dir: path.join(out, 'assets'), format: 'es', entryFileNames: 'app-[hash].js', chunkFileNames: 'chunk-[hash].js' });
await bundle.close();
const entry = output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
if (!entry) throw new Error('build: Rollup produced no entry chunk');

const css = fs.readFileSync(path.join(site, 'src', 'app.css'));
const cssName = `app-${createHash('sha256').update(css).digest('hex').slice(0, 8)}.css`;
fs.writeFileSync(path.join(out, 'assets', cssName), css);

let html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
html = swap(html, 'href="/src/app.css"', `href="/assets/${cssName}"`);
html = swap(html, 'src="/src/main.js"', `src="/assets/${entry.fileName}"`);
fs.writeFileSync(path.join(out, 'index.html'), html);

/** @param {string} dir @returns {string[]} */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
let total = 0;
for (const file of walk(out).sort()) {
    const size = fs.statSync(file).size;
    total += size;
    console.log(`${String(size).padStart(9)}  ${path.relative(out, file).replaceAll('\\', '/')}`);
}
console.log(`${String(total).padStart(9)}  total, in dist/site`);
