// Finding Chrome (RE-014, RE-022), the fixed launch switches, the CLI, and one run against the real
// browser through the real server: pair, launch on the pipe, drive a page through the relay, and
// leave no temporary profile behind whether the run is closed or cut off. The real-browser part is
// skipped where no Chrome is installed.
import fs from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { candidatePaths, findBrowsers, launchArgs, launchBrowser } from '../helper/src/chrome.js';
import { parseArgs } from '../helper/src/cli.js';
import { HELPER_PROTOCOL, startHelperServer } from '../helper/src/server.js';
import { connectRaw } from './helpers/raw-ws-client.js';

describe('finding Chrome', () => {
    it('looks in the usual places on each platform', () => {
        const win = candidatePaths('win32', { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u');
        expect(win.stable).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
        expect(win.canary).toContain('C:\\Users\\u\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe');
        const mac = candidatePaths('darwin', {}, '/Users/u');
        expect(mac.stable).toEqual(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
        const linux = candidatePaths('linux', { PATH: '/usr/local/bin:/usr/bin' }, '/home/u');
        expect(linux.stable).toEqual(['/usr/local/bin/google-chrome-stable', '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/opt/google/chrome/chrome']);
        expect(linux.dev).toContain('/usr/bin/google-chrome-unstable');
    });

    it('reports the first hit per channel, by real path', () => {
        const present = new Set(['/usr/bin/google-chrome', '/opt/google/chrome-beta/chrome']);
        const found = findBrowsers({
            platform: 'linux', env: { PATH: '/usr/bin' }, home: '/home/u',
            isExecutable: (p) => present.has(p), realpath: (p) => (p === '/usr/bin/google-chrome' ? '/opt/google/chrome/google-chrome' : p),
        });
        expect(found).toEqual([
            { channel: 'stable', path: '/opt/google/chrome/google-chrome' },
            { channel: 'beta', path: '/opt/google/chrome-beta/chrome' },
        ]);
    });
});

describe('launch switches', () => {
    it('always uses the pipe and the throwaway profile, and adds only named features', () => {
        const args = launchArgs({ profileDir: '/tmp/p', headless: false, platform: 'linux', features: ['socketThrottling'] });
        expect(args).toEqual(['--remote-debugging-pipe', '--user-data-dir=/tmp/p', '--no-first-run', '--no-default-browser-check',
            '--enable-features=SocketLayerNetworkThrottling', 'about:blank']);
        expect(launchArgs({ profileDir: '/p', headless: true, platform: 'darwin', features: [] })).toEqual(expect.arrayContaining(['--use-mock-keychain', '--headless=new']));
        expect(() => launchArgs({ profileDir: '/p', headless: false, platform: 'linux', features: ['--disable-web-security'] })).toThrow(/unknown feature/);
    });
});

describe('command line', () => {
    it('defaults to the production capture origin', () => {
        expect(parseArgs([])).toEqual({ origin: 'https://capture.waterfall-tools.com', port: 0 });
    });
    it('accepts an https origin or an http loopback origin for development', () => {
        expect(parseArgs(['--origin', 'http://localhost:5173', '--port', '9000'])).toEqual({ origin: 'http://localhost:5173', port: 9000 });
        expect(parseArgs(['--origin', 'https://example.com/'])).toEqual({ origin: 'https://example.com', port: 0 });
    });
    it.each([
        [['--origin', 'http://example.com']],
        [['--origin', 'https://example.com/path']],
        [['--origin', 'https://example.com#x']],
        [['--port', '70000']],
        [['--verbose']],
    ])('refuses %j', (argv) => {
        expect(() => parseArgs(argv)).toThrow();
    });
});

const chrome = findBrowsers()[0];
const profiles = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('capture-helper-'));

describe.skipIf(!chrome)('a run with the real Chrome', () => {
    const ORIGIN = 'https://capture.waterfall-tools.com';
    const SECRET = 'secret-for-the-integration-test-0123456789ab';
    /** @type {{ port: number, close: () => Promise<void> } | null} */
    let helper = null;
    afterEach(async () => { await helper?.close(); helper = null; });

    async function pairAndLaunch() {
        helper = await startHelperServer({
            captureOrigin: ORIGIN, secret: SECRET, version: 'test', browsers: [chrome],
            launch: (o) => launchBrowser({ ...o, headless: true }),
        });
        const ws = await connectRaw({ port: helper.port, origin: ORIGIN });
        ws.sendJson({ type: 'hello', protocol: HELPER_PROTOCOL, secret: SECRET });
        expect((await ws.nextJson()).type).toBe('welcome');
        ws.sendJson({ type: 'launch', channel: chrome.channel });
        expect(await ws.nextJson()).toEqual({ type: 'launched', channel: chrome.channel });
        let nextId = 1;
        /** @param {string} method @param {object} [params] @param {string} [sessionId] @returns {Promise<any>} */
        const cdp = async (method, params, sessionId) => {
            const id = nextId++;
            ws.sendJson({ type: 'cdp', message: { id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) } });
            for (;;) {
                const m = await ws.nextJson();
                if (m?.type === 'cdp' && m.message.id === id) return m.message;
            }
        };
        return { ws, cdp };
    }

    it('drives a page through the relay, refuses a file URL, and cleans up on close', async () => {
        const before = profiles().length;
        const { ws, cdp } = await pairAndLaunch();
        expect(profiles().length).toBe(before + 1);

        const version = await cdp('Browser.getVersion');
        expect(version.result.product).toMatch(/Chrome\//);
        const target = await cdp('Target.createTarget', { url: 'about:blank' });
        const session = await cdp('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
        const sessionId = session.result.sessionId;
        const evaluated = await cdp('Runtime.evaluate', { expression: '6 * 7', returnByValue: true }, sessionId);
        expect(evaluated.result.result.value).toBe(42);
        const file = await cdp('Page.navigate', { url: `file://${os.homedir()}` }, sessionId);
        expect(file.error.message).toMatch(/may only load/);

        ws.sendJson({ type: 'close' });
        for (;;) if ((await ws.nextJson())?.type === 'closed') break;
        expect(profiles().length).toBe(before);
        ws.destroy();
    }, 60000);

    it('leaves no browser profile behind when the page goes away mid-run', async () => {
        const before = profiles().length;
        const { ws, cdp } = await pairAndLaunch();
        await cdp('Target.createTarget', { url: 'about:blank' });
        ws.destroy(); // the tab closed, or the run was cancelled
        const deadline = Date.now() + 15000;
        while (profiles().length !== before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
        expect(profiles().length).toBe(before);
    }, 60000);
});

