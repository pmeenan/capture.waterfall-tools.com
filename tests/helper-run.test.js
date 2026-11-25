// A whole run through site/src/capture/helper-run.js, from launch to result zip, against real
// Chrome and a controlled page; then the M2 exit check: the trace and the NetLog inside the zip
// convert with the published waterfall-tools. Chrome is driven on the pipe through the same three
// calls the HelperConnection provides. Skipped where no Chrome is installed.
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- waterfall-tools ships no type declarations
import { WaterfallTools } from 'waterfall-tools';
import { Clock } from '@capture/shared/clock';
import { launchBrowser } from '../helper/src/chrome.js';
import { runWithHelper } from '../site/src/capture/helper-run.js';
import { ENDING } from '../site/src/capture/page-load.js';
import { createFakeClockWorker } from './helpers/fake-clock-worker.js';
import { startTestPages } from './helpers/test-pages.js';
import { testChrome } from './helpers/test-chrome.js';

const chrome = testChrome;

/** Chrome on the pipe, behind the BrowserHost interface. @returns {import('../site/src/capture/helper-run.js').BrowserHost} */
function pipeHost() {
    /** @type {import('../helper/src/chrome.js').LaunchedBrowser | null} */
    let browser = null;
    return {
        async launch({ headless, netLog }) {
            browser = launchBrowser({ executable: chrome.path, headless, netLog });
        },
        cdpTransport() {
            const b = /** @type {import('../helper/src/chrome.js').LaunchedBrowser} */ (browser);
            /** @type {import('@capture/shared/cdp-client').CdpTransport} */
            const transport = { send: (text) => b.send(text), onMessage: null, onClose: null, close: () => {} };
            b.onMessage((text) => transport.onMessage?.(text));
            return transport;
        },
        async closeBrowser() {
            const b = /** @type {import('../helper/src/chrome.js').LaunchedBrowser} */ (browser);
            browser = null;
            return b.close();
        },
    };
}

/** @param {Uint8Array} bytes */
async function convert(bytes) {
    const tools = new WaterfallTools();
    try {
        await tools.loadBuffer(bytes);
        return tools.getHar();
    } finally {
        await tools.destroy?.();
    }
}

describe.skipIf(!chrome)('a run through the helper path', () => {
    it('produces a result zip whose trace and NetLog convert with waterfall-tools', async () => {
        const pages = await startTestPages();
        const clock = new Clock(createFakeClockWorker());
        /** @type {string[]} */
        const steps = [];
        try {
            const { zip, manifest, load, browser } = await runWithHelper({
                host: pipeHost(), clock, url: pages.url('/simple'), channel: chrome.channel, headless: true,
                generator: { name: 'test', version: '0' }, onStep: (s) => steps.push(s),
            });
            expect(load.ending.reason).toBe(ENDING.completed);
            expect(browser).toMatch(/^(Headless)?Chrome\//);
            expect(steps).toEqual(['launch Chrome', 'open a tab', 'start the trace', 'navigate', 'collect the trace', 'close the tab', 'close Chrome', 'package the result']);

            const run = manifest.runs[0];
            expect(run.ending).toEqual({ reason: 'completed' });
            expect(run.document).toMatchObject({ url: pages.url('/simple'), status: 200 });
            expect(manifest.environment).toMatchObject({ runner: 'helper', traceScope: 'browser', throttlingEngine: 'none' });

            const files = unzipSync(zip);
            const expected = ['/simple', '/simple.css', '/simple.js', '/pixel.png'].map((p) => pages.url(p));
            for (const key of ['trace', 'netlog']) {
                const har = await convert(files[run.files[key]]);
                const urls = har.log.entries.map((/** @type {{request: {url: string}}} */ e) => e.request.url);
                for (const url of expected) expect(urls, `${key} should contain ${url}`).toContain(url);
            }
        } finally {
            clock.dispose();
            await pages.close();
        }
    }, 60000);
});
