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
 * @param {string | null} [options.netLogPath] where Chrome writes its NetLog; chosen by the helper, never the page
 * @returns {string[]}
 */
export function launchArgs({ profileDir, headless, platform, features, netLogPath = null }) {
    const args = [
        '--remote-debugging-pipe',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        // Keep Chrome's own traffic (component and extension updates, and the like) out of the
        // test: on a fresh profile it starts at launch and lands in the trace (RE-025).
        '--disable-background-networking',
        '--disable-component-update',
    ];
    // A fresh profile on macOS may ask the login Keychain for Chrome's storage key, and that
    // dialog appears on whoever's screen is active (RE-022).
    if (platform === 'darwin') args.push('--use-mock-keychain');
    if (headless) args.push('--headless=new');
    // Plain JSON, ended by a clean exit (D-016, RE-009); the default capture mode leaves out cookies
    // and bodies.
    if (netLogPath) args.push(`--log-net-log=${netLogPath}`);
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
 * @property {Promise<{netLog: string | null}>} exited resolves once the process has exited, its NetLog
 *           (if one was asked for) has been read, and the whole working folder is deleted
 * @property {() => Promise<{netLog: string | null}>} close ask Chrome to exit cleanly, kill it if it
 *           does not, then wait for `exited`
 */

/** A command id the page can never use: the relay drops replies to ids the page did not send. */
const HELPER_COMMAND_ID = 2 ** 31 - 1;
/** How long a clean Browser.close may take before the process is killed. */
export const CLOSE_GRACE_MS = 5000;

/**
 * Launch Chrome on the debugging pipe with a new temporary profile, in a working folder that is
 * deleted when the browser exits.
 * @param {object} options
 * @param {string} options.executable
 * @param {string[]} [options.features]
 * @param {boolean} [options.headless]
 * @param {boolean} [options.netLog] write a NetLog, returned by `exited`
 * @param {string} [options.tmpRoot] where the working folder is made; tests give each their own
 * @returns {LaunchedBrowser}
 */
export function launchBrowser({ executable, features = [], headless = false, netLog = false, tmpRoot = os.tmpdir() }) {
    const workDir = fs.mkdtempSync(path.join(tmpRoot, 'capture-helper-'));
    const profileDir = path.join(workDir, 'profile');
    const netLogPath = netLog ? path.join(workDir, 'netlog.json') : null;
    let child;
    try {
        fs.mkdirSync(profileDir);
        child = spawn(executable, launchArgs({ profileDir, headless, platform: process.platform, features, netLogPath }), {
            // fd 3 is what Chrome reads commands from, fd 4 what it writes replies to.
            stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        fs.rmSync(workDir, { recursive: true, force: true });
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

    const running = () => child.exitCode === null && child.signalCode === null;
    /** @type {Promise<{netLog: string | null}>} */
    const exited = new Promise((resolve) => {
        let started = false;
        const done = async () => {
            if (started) return;
            started = true;
            let text = null;
            if (netLogPath) {
                try {
                    text = fs.readFileSync(netLogPath, 'utf8');
                } catch {
                    text = null; // never written, or the browser died before creating it
                }
            }
            // Chrome can hold files in the profile for a moment after exit on Windows.
            await removeWithRetry(workDir);
            resolve({ netLog: text });
        };
        if (!running()) done();
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
            if (running()) {
                // A clean exit is what completes the NetLog's JSON (RE-014); kill only if it hangs.
                if (!toBrowser.destroyed) toBrowser.write(`${JSON.stringify({ id: HELPER_COMMAND_ID, method: 'Browser.close' })}\0`);
                const timer = setTimeout(() => { if (running()) child.kill(); }, CLOSE_GRACE_MS);
                try {
                    return await exited;
                } finally {
                    clearTimeout(timer);
                }
            }
            return exited;
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
