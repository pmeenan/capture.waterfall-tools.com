/**
 * Finding and launching the Chrome the helper drives (D-017, D-022 rule 5).
 *
 * Chrome is found by a fixed list of places per operating system (RE-014, RE-022) and launched on
 * the debugging pipe with a new temporary profile, which is deleted when the browser exits. The
 * page never supplies a path or a raw switch: it picks a channel from what was found and asks for
 * features by name from FEATURE_SWITCHES.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @typedef {'stable' | 'beta' | 'dev' | 'canary' | 'chromium'} Channel */

/**
 * @typedef {object} FoundBrowser
 * @property {Channel} channel
 * @property {string} path real path of the executable
 */

/**
 * Where each channel installs, per platform. Order within a channel is preference order.
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @returns {Record<Channel, string[]>}
 */
export function candidatePaths(platform, env, home) {
    if (platform === 'win32') {
        const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
        const under = (/** @type {string} */ folder) => roots.map((r) => path.win32.join(/** @type {string} */ (r), folder, 'Application', 'chrome.exe'));
        return {
            stable: under('Google\\Chrome'),
            beta: under('Google\\Chrome Beta'),
            dev: under('Google\\Chrome Dev'),
            canary: under('Google\\Chrome SxS'),
            chromium: under('Chromium'),
        };
    }
    if (platform === 'darwin') {
        const app = (/** @type {string} */ name) => ['/Applications', path.posix.join(home, 'Applications')]
            .map((dir) => path.posix.join(dir, `${name}.app`, 'Contents', 'MacOS', name));
        return {
            stable: app('Google Chrome'),
            beta: app('Google Chrome Beta'),
            dev: app('Google Chrome Dev'),
            canary: app('Google Chrome Canary'),
            chromium: app('Chromium'),
        };
    }
    const onPath = (/** @type {string[]} */ names) => names.flatMap((name) => (env.PATH ?? '').split(':').filter(Boolean).map((dir) => path.posix.join(dir, name)));
    return {
        stable: [...onPath(['google-chrome-stable', 'google-chrome']), '/opt/google/chrome/chrome'],
        beta: [...onPath(['google-chrome-beta']), '/opt/google/chrome-beta/chrome'],
        dev: [...onPath(['google-chrome-unstable']), '/opt/google/chrome-unstable/chrome'],
        canary: [...onPath(['google-chrome-canary']), '/opt/google/chrome-canary/chrome'],
        chromium: onPath(['chromium', 'chromium-browser']),
    };
}

/**
 * The first executable that exists for each channel, as a real path.
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.home]
 * @param {(p: string) => boolean} [options.isExecutable]
 * @param {(p: string) => string} [options.realpath]
 * @returns {FoundBrowser[]}
 */
export function findBrowsers({
    platform = process.platform, env = process.env, home = os.homedir(),
    isExecutable = defaultIsExecutable, realpath = (p) => fs.realpathSync(p),
} = {}) {
    /** @type {FoundBrowser[]} */
    const found = [];
    for (const [channel, paths] of Object.entries(candidatePaths(platform, env, home))) {
        const hit = paths.find((p) => isExecutable(p));
        if (hit) found.push({ channel: /** @type {Channel} */ (channel), path: realpath(hit) });
    }
    return found;
}

/** @param {string} p */
function defaultIsExecutable(p) {
    try {
        fs.accessSync(p, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/**
 * Chrome features the page may ask for, by name, and the switch each one adds. Nothing outside
 * this table can reach the command line.
 */
export const FEATURE_SWITCHES = Object.freeze({
    // Socket-layer throttling (RE-001, D-013).
    socketThrottling: '--enable-features=SocketLayerNetworkThrottling',
});

/**
 * The fixed part of every launch.
 * @param {object} options
 * @param {string} options.profileDir
 * @param {boolean} options.headless
 * @param {NodeJS.Platform} options.platform
 * @param {string[]} options.features names from FEATURE_SWITCHES
 * @returns {string[]}
 */
export function launchArgs({ profileDir, headless, platform, features }) {
    const args = [
        '--remote-debugging-pipe',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
    ];
    // A fresh profile on macOS may ask the login Keychain for Chrome's storage key, and that
    // dialog appears on whoever's screen is active (RE-022).
    if (platform === 'darwin') args.push('--use-mock-keychain');
    if (headless) args.push('--headless=new');
    for (const name of features) {
        const sw = FEATURE_SWITCHES[/** @type {keyof typeof FEATURE_SWITCHES} */ (name)];
        if (!sw) throw new Error(`unknown feature: ${name}`);
        args.push(sw);
    }
    args.push('about:blank');
    return args;
}

/**
 * @typedef {object} LaunchedBrowser
 * @property {(message: string) => void} send one CDP message, without the NUL separator
 * @property {(listener: (message: string) => void) => void} onMessage
 * @property {Promise<void>} exited resolves once the process has exited and the profile is gone
 * @property {() => Promise<void>} close kill the browser if still running, then wait for cleanup
 */

/**
 * Launch Chrome on the debugging pipe with a new temporary profile.
 * @param {object} options
 * @param {string} options.executable
 * @param {string[]} [options.features]
 * @param {boolean} [options.headless]
 * @returns {LaunchedBrowser}
 */
export function launchBrowser({ executable, features = [], headless = false }) {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-helper-'));
    let child;
    try {
        child = spawn(executable, launchArgs({ profileDir, headless, platform: process.platform, features }), {
            // fd 3 is what Chrome reads commands from, fd 4 what it writes replies to.
            stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        fs.rmSync(profileDir, { recursive: true, force: true });
        throw error;
    }
    const toBrowser = /** @type {import('node:stream').Writable} */ (child.stdio[3]);
    const fromBrowser = /** @type {import('node:stream').Readable} */ (child.stdio[4]);
    // A write after the browser died raises EPIPE on the stream; that end is reported through `exited`.
    toBrowser.on('error', () => {});
    fromBrowser.on('error', () => {});

    /** @type {Set<(message: string) => void>} */
    const listeners = new Set();
    let pending = '';
    fromBrowser.setEncoding('utf8');
    fromBrowser.on('data', (/** @type {string} */ chunk) => {
        pending += chunk;
        let end;
        while ((end = pending.indexOf('\0')) >= 0) {
            const message = pending.slice(0, end);
            pending = pending.slice(end + 1);
            for (const listener of listeners) listener(message);
        }
    });

    const exited = new Promise((resolve) => {
        const done = () => {
            // Chrome can hold files in the profile for a moment after exit on Windows.
            removeWithRetry(profileDir).finally(() => resolve(undefined));
        };
        if (child.exitCode !== null || child.signalCode !== null) done();
        else child.once('exit', done);
        child.once('error', () => { if (child.exitCode === null) done(); });
    });

    return {
        send(message) {
            if (!toBrowser.destroyed) toBrowser.write(`${message}\0`);
        },
        onMessage(listener) {
            listeners.add(listener);
        },
        exited,
        async close() {
            if (child.exitCode === null && child.signalCode === null) child.kill();
            await exited;
        },
    };
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
async function removeWithRetry(dir) {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
}
