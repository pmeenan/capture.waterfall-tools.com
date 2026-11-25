// A whole capture through the real helper (M2 exit criterion: "an agent runs a test through the
// helper unattended and gets a result whose trace converts with waterfall-tools"). Unlike
// tests/pipeline.test.js, nothing here touches Chrome directly: the test pairs with the helper's
// loopback server, asks it to launch, runs the pipeline over the filtered relay, and gets the NetLog
// back over the WebSocket - so an event or reply the relay wrongly drops shows up as a failed run.
// Node's own WebSocket cannot send the capture Origin, so the test speaks the helper protocol over
// the raw client the guard tests use. Skipped where no Chrome is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- waterfall-tools ships no type declarations
import { WaterfallTools } from 'waterfall-tools';
import { Clock } from '@capture/shared/clock';
import { launchBrowser } from '../helper/src/chrome.js';
import { HELPER_PROTOCOL, startHelperServer } from '../helper/src/server.js';
import { runWithHelper } from '../site/src/capture/helper-run.js';
import { ENDING } from '../site/src/capture/page-load.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';
import { connectRaw } from './helpers/raw-ws-client.js';
import { testChrome } from './helpers/test-chrome.js';
import { startTestPages } from './helpers/test-pages.js';

const ORIGIN = 'https://capture.waterfall-tools.com';
const SECRET = 'relay-run-test-secret-0123456789abcdefghijk';
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-relay-run-'));

/**
 * The page's HelperConnection, reduced to what runWithHelper needs, over the raw test client.
 * @param {import('./helpers/raw-ws-client.js').RawWs} ws
 * @returns {import('../site/src/capture/helper-run.js').BrowserHost}
 */
function relayHost(ws) {
    /** What the reader hands messages to; set as the run goes. */
    /** @type {{control: ((message: any) => void) | null, transport: import('@capture/shared/cdp-client').CdpTransport | null, netLog: string[]}} */
    const state = { control: null, transport: null, netLog: [] };
    // One reader for everything the helper sends: CDP to the transport, the rest to `control`.
    (async () => {
        for (;;) {
            const m = await ws.nextJson();
            if (m === null) { state.transport?.onClose?.(); return; }
            if (m.type === 'cdp') state.transport?.onMessage?.(JSON.stringify(m.message));
            else if (m.type === 'netlog') state.netLog.push(m.data);
            else state.control?.(m);
        }
    })();
    const request = (/** @type {object} */ message, /** @type {string} */ expect) => new Promise((resolve, reject) => {
        state.control = (m) => {
            if (m.type === expect) { state.control = null; resolve(m); }
            else if (m.type === 'error') { state.control = null; reject(new Error(m.code)); }
        };
        ws.sendJson(message);
    });
    return {
        async launch(options) { await request({ type: 'launch', ...options }, 'launched'); },
        cdpTransport() {
            state.transport = {
                send: (text) => ws.sendJson({ type: 'cdp', message: JSON.parse(text) }),
                onMessage: null,
                onClose: null,
                close: () => {},
            };
            return state.transport;
        },
        async closeBrowser() {
            state.netLog = [];
            const closed = /** @type {any} */ (await request({ type: 'close' }, 'closed'));
            state.transport?.onClose?.();
            return { netLog: closed.netLog ? state.netLog.join('') : null };
        },
    };
}

describe.skipIf(!testChrome)('a capture through the real helper and its relay', () => {
    afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

    it('pairs, launches, runs, and returns a trace and NetLog that convert', async () => {
        const pages = await startTestPages();
        const helper = await startHelperServer({
            captureOrigin: ORIGIN, secret: SECRET, version: 'test', browsers: [testChrome],
            launch: (o) => launchBrowser({ ...o, headless: true, tmpRoot }),
        });
        const clock = new Clock(createFakeClockWorker());
        try {
            const ws = await connectRaw({ port: helper.port, origin: ORIGIN });
            ws.sendJson({ type: 'hello', protocol: HELPER_PROTOCOL, secret: SECRET });
            expect((await ws.nextJson()).type).toBe('welcome');

            const { zip, manifest, load } = await runWithHelper({
                host: relayHost(ws), clock, url: pages.url('/redirect'), channel: testChrome.channel, headless: true,
                generator: { name: 'test', version: '0' },
            });
            expect(load.ending).toEqual({ reason: ENDING.completed });
            expect(load.document).toMatchObject({ finalUrl: pages.url('/simple'), status: 200 });
            expect(manifest.runs[0].files.netlog).toBeDefined();

            const files = unzipSync(zip);
            for (const key of ['trace', 'netlog']) {
                const tools = new WaterfallTools();
                try {
                    await tools.loadBuffer(files[manifest.runs[0].files[key]]);
                    const urls = tools.getHar().log.entries.map((/** @type {{request: {url: string}}} */ e) => e.request.url);
                    for (const p of ['/simple.css', '/simple.js', '/pixel.png']) expect(urls, `${key} has ${p}`).toContain(pages.url(p));
                } finally {
                    await tools.destroy?.();
                }
            }
            ws.destroy();
            // The helper cleans up after the pairing ends.
            const deadline = Date.now() + 10000;
            while (fs.readdirSync(tmpRoot).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
            expect(fs.readdirSync(tmpRoot)).toEqual([]);
        } finally {
            clock.dispose();
            await helper.close();
            await pages.close();
        }
    }, 60000);
});
