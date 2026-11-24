// Deploys the capture site to Cloudflare. Run by the project owner, never automatically (D-025).
//
//   npm run deploy:dry-run   build, check, and show what would be uploaded
//   npm run deploy           the same, then upload
//
// The capture origin is the trust anchor for the extension and the helper (D-018, D-022), so a
// real deploy only goes ahead from a clean working tree: what is published is always a commit.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dryRun = process.argv.includes('--dry-run');

/** @param {string[]} args */
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} [viaShell] npm is a .cmd shim on Windows and can only be started through a shell
 */
function step(label, command, args, viaShell = false) {
    console.log(`\n== ${label}`);
    // Wrangler reports usage to Cloudflare unless told not to; this project sends no telemetry (D-010).
    const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
    // A shell is used only where it must be: it would split a path containing spaces, such as
    // "C:\Program Files\nodejs\node.exe". Every argument passed here is a fixed string.
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env, shell: viaShell && process.platform === 'win32' });
    if (result.status !== 0) {
        console.error(`\nDeploy stopped: "${label}" failed.`);
        process.exit(result.status ?? 1);
    }
}

const commit = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain');
console.log(`${dryRun ? 'Dry run' : 'Deploy'} of commit ${commit}${dirty ? ' plus uncommitted changes' : ''}`);
if (dirty && !dryRun) {
    console.error('\nDeploy stopped: the working tree has uncommitted changes. Commit or stash them first, so that what is published is a commit.');
    console.error(dirty);
    process.exit(1);
}

step('Lint, type check, tests, build, licence gate', 'npm', ['run', 'check'], true);

const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!fs.existsSync(wrangler)) {
    console.error('\nDeploy stopped: wrangler is not installed. Run "npm ci" first.');
    process.exit(1);
}
step(dryRun ? 'wrangler deploy --dry-run' : 'wrangler deploy', process.execPath, [wrangler, 'deploy', ...(dryRun ? ['--dry-run'] : [])]);
console.log(dryRun ? '\nDry run finished. Nothing was uploaded.' : `\nDeployed commit ${commit}.`);
